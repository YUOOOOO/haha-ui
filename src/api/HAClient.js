/**
 * Home Assistant REST + WebSocket client
 * - baseUrl 为空：走 Vite 同源 /api 代理（dev）
 * - WebSocket 订阅 state_changed，支持 call_service / get_states
 */
class HAClient {
  constructor(config = {}) {
    this.baseUrl = Object.prototype.hasOwnProperty.call(config, 'baseUrl')
      ? (config.baseUrl || '')
      : ''
    this.token = config.token || ''
    this.websocket = null
    this.messageId = 1
    this.subscribers = new Map() // id -> callback (event messages)
    this.pending = new Map() // id -> { resolve, reject }
    this.stateCache = new Map() // entity_id -> state object
    this.stateListeners = new Set()
    this.connectionListeners = new Set()
    this.connected = false
    this._reconnectTimer = null
    this._wantConnect = false
  }

  setConfig(baseUrl, token) {
    this.baseUrl = baseUrl
    this.token = token
  }

  getState(entityId) {
    // sync cache hit for UI
    return this.stateCache.get(entityId) || null
  }

  async fetchState(entityId, { force = false } = {}) {
    if (!force && this.stateCache.has(entityId)) return this.stateCache.get(entityId)
    const st = await this.request(`states/${entityId}`)
    if (st?.entity_id) {
      this.stateCache.set(st.entity_id, st)
      this._emitState(st.entity_id, st, null)
    }
    return st
  }

  // 兼容旧调用：async getState
  async getStateAsync(entityId) {
    return this.fetchState(entityId)
  }

  getCachedStates() {
    return this.stateCache
  }

  onStateChange(fn) {
    this.stateListeners.add(fn)
    return () => this.stateListeners.delete(fn)
  }

  onConnectionChange(fn) {
    this.connectionListeners.add(fn)
    return () => this.connectionListeners.delete(fn)
  }

  _emitConnection(connected, reason = '') {
    const prev = this.connected
    this.connected = !!connected
    for (const fn of this.connectionListeners) {
      try {
        fn(this.connected, reason, prev)
      } catch (e) {
        console.error(e)
      }
    }
  }

  _emitState(entityId, state, oldState = null) {
    for (const fn of this.stateListeners) {
      try {
        fn(entityId, state, this.stateCache, oldState)
      } catch (e) {
        console.error(e)
      }
    }
  }

  _apiBase() {
    return (this.baseUrl || '').replace(/\/$/, '')
  }

  _wsUrl() {
    if (this.baseUrl) {
      return this.baseUrl.replace(/^http/, 'ws').replace(/\/$/, '') + '/api/websocket'
    }
    if (typeof window !== 'undefined') {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      return `${proto}//${window.location.host}/api/websocket`
    }
    throw new Error('no baseUrl for websocket')
  }

  async request(endpoint, options = {}) {
    if (!this.token) throw new Error('HA token empty')
    const base = this._apiBase()
    const url = `${base}/api/${endpoint}`
    const headers = {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
      ...options.headers
    }
    const controller = new AbortController()
    const timeoutMs = options.timeoutMs ?? 8000
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal
      })
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }
      if (response.status === 204) return null
      return await response.json()
    } finally {
      clearTimeout(timer)
    }
  }

  async getStates() {
    return await this.request('states')
  }

  async getStateRest(entityId) {
    return await this.request(`states/${entityId}`)
  }

  _formatHaError(err) {
    if (!err) return '未知错误'
    if (typeof err === 'string') return err
    if (err instanceof Error) return err.message || String(err)
    if (err.message) return String(err.message)
    if (err.code && err.message) return `${err.code}: ${err.message}`
    try {
      return JSON.stringify(err)
    } catch {
      return String(err)
    }
  }

  async callService(domain, service, data = {}) {
    if (!this.token) throw new Error('HA token empty')
    // Prefer WebSocket when connected；失败自动回退 REST（避免“点了没反应”）
    if (this.connected && this.websocket?.readyState === WebSocket.OPEN) {
      const payload = {
        type: 'call_service',
        domain,
        service,
        service_data: data || {}
      }
      // 新版 HA 推荐 target；同时保留 service_data.entity_id 兼容小米等集成
      if (data?.entity_id != null) {
        payload.target = { entity_id: data.entity_id }
      }
      try {
        return await this.send(payload)
      } catch (e) {
        console.warn('[HA] WS call_service failed, fallback REST', domain, service, e)
        // fall through to REST
      }
    }
    try {
      return await this.request(`services/${domain}/${service}`, {
        method: 'POST',
        body: JSON.stringify(data),
        timeoutMs: 12000
      })
    } catch (e) {
      throw new Error(this._formatHaError(e))
    }
  }

  send(payload) {
    if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('HA WS not open'))
    }
    const id = this.messageId++
    const msg = { ...payload, id }
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.websocket.send(JSON.stringify(msg))
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error('HA WS timeout'))
        }
      }, 15000)
    })
  }

  connectWebSocket() {
    this._wantConnect = true
    if (this.websocket && this.websocket.readyState === WebSocket.OPEN && this.connected) {
      return Promise.resolve()
    }
    return new Promise((resolve, reject) => {
      let settled = false
      const done = (ok, err) => {
        if (settled) return
        settled = true
        if (ok) resolve()
        else reject(err || new Error('WS failed'))
      }

      try {
        this.websocket = new WebSocket(this._wsUrl())
      } catch (e) {
        done(false, e)
        return
      }

      this.websocket.onopen = () => {
        console.log('[HA] WebSocket open')
      }

      this.websocket.onmessage = (event) => {
        let message
        try {
          message = JSON.parse(event.data)
        } catch {
          return
        }

        if (message.type === 'auth_required') {
          this.websocket.send(
            JSON.stringify({
              type: 'auth',
              access_token: this.token
            })
          )
          return
        }

        if (message.type === 'auth_ok') {
          console.log('[HA] WebSocket authenticated')
          this._emitConnection(true, 'auth_ok')
          this._bootstrapAfterAuth()
            .then(() => done(true))
            .catch((e) => {
              console.warn('[HA] bootstrap after auth', e)
              done(true) // still connected
            })
          return
        }

        if (message.type === 'auth_invalid') {
          this._emitConnection(false, 'auth_invalid')
          done(false, new Error('WebSocket authentication failed'))
          return
        }

        if (message.type === 'event' && message.event) {
          this.handleEvent(message)
          return
        }

        if (message.id != null && this.pending.has(message.id)) {
          const { resolve: res, reject: rej } = this.pending.get(message.id)
          this.pending.delete(message.id)
          if (message.success === false) {
            const err = message.error
            const msg =
              typeof err === 'string'
                ? err
                : err?.message
                  ? `${err.code ? err.code + ': ' : ''}${err.message}`
                  : 'HA call_service failed'
            rej(new Error(msg))
          } else {
            res(message.result)
          }
        }
      }

      this.websocket.onerror = (error) => {
        console.error('[HA] WebSocket error', error)
        if (!this.connected) done(false, error)
      }

      this.websocket.onclose = () => {
        console.log('[HA] WebSocket closed')
        this._emitConnection(false, 'closed')
        if (this._wantConnect) {
          clearTimeout(this._reconnectTimer)
          this._reconnectTimer = setTimeout(() => {
            this.connectWebSocket().catch(() => {})
          }, 3000)
        }
      }
    })
  }

  async _bootstrapAfterAuth() {
    // get_states via WS
    const states = await this.send({ type: 'get_states' })
    this.stateCache = new Map((states || []).map((s) => [s.entity_id, s]))
    // 全量缓存灌入：entityId=null，UI 刷新但不写操作日志
    this._emitState(null, null, null)

    const subId = this.messageId++
    this.subscribers.set(subId, (event) => {
      if (event.event_type !== 'state_changed') return
      const ns = event.data?.new_state
      const os = event.data?.old_state
      if (ns?.entity_id) {
        this.stateCache.set(ns.entity_id, ns)
        this._emitState(ns.entity_id, ns, os || null)
      }
    })
    this.websocket.send(
      JSON.stringify({
        id: subId,
        type: 'subscribe_events',
        event_type: 'state_changed'
      })
    )
  }

  /**
   * 经 WebSocket 拉 HA Logbook 近期事件（操作日志历史）。
   * 失败返回 []（旧版 HA 可能无此命令）。
   */
  async getLogbookEvents({ startTime, endTime, entityIds } = {}) {
    if (!this.isConnected()) return []
    const end = endTime || new Date().toISOString()
    const start =
      startTime ||
      new Date(Date.now() - 6 * 3600 * 1000).toISOString()
    try {
      const payload = {
        type: 'logbook/get_events',
        start_time: start,
        end_time: end
      }
      if (entityIds?.length) payload.entity_ids = entityIds
      const result = await this.send(payload)
      // 不同版本返回 events 数组或直接数组
      if (Array.isArray(result)) return result
      if (Array.isArray(result?.events)) return result.events
      return []
    } catch (e) {
      console.warn('[HA] logbook/get_events 不可用', e)
      return []
    }
  }

  subscribeStateChanged(callback) {
    const id = this.messageId++
    this.subscribers.set(id, callback)
    if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
      this.websocket.send(
        JSON.stringify({
          id,
          type: 'subscribe_events',
          event_type: 'state_changed'
        })
      )
    }
    return id
  }

  unsubscribe(subscriptionId) {
    this.subscribers.delete(subscriptionId)
  }

  handleEvent(message) {
    // Legacy: message.id may match subscriber for subscribe_events
    const byId = this.subscribers.get(message.id)
    if (byId && message.event) {
      byId(message.event)
      return
    }
    // Also fan-out all state_changed to any subscriber that registered without matching id path
    if (message.event?.event_type === 'state_changed') {
      for (const cb of this.subscribers.values()) {
        try {
          cb(message.event)
        } catch (e) {
          console.error(e)
        }
      }
      const ns = message.event.data?.new_state
      const os = message.event.data?.old_state
      if (ns?.entity_id) {
        this.stateCache.set(ns.entity_id, ns)
        this._emitState(ns.entity_id, ns, os || null)
      }
    }
  }

  disconnect() {
    this._wantConnect = false
    clearTimeout(this._reconnectTimer)
    if (this.websocket) {
      this.websocket.close()
      this.websocket = null
    }
    this._emitConnection(false, 'disconnect')
    this.subscribers.clear()
    this.pending.clear()
  }

  isConnected() {
    return !!this.connected && this.websocket?.readyState === WebSocket.OPEN
  }
}

export default HAClient
