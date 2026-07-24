/**
 * Mijia bridge client — HAClient-compatible surface for DashboardShell / lights.
 * Talks to local mijia-bridge (default /mijia via Vite proxy → :8787).
 */
class MijiaClient {
  constructor(config = {}) {
    this.baseUrl = (config.baseUrl || '').replace(/\/$/, '')
    // empty baseUrl → same-origin /mijia proxy
    this.apiPrefix = config.apiPrefix || '/mijia'
    this.websocket = null
    this.stateCache = new Map()
    this.stateListeners = new Set()
    this.connectionListeners = new Set()
    this.connected = false
    this._wantConnect = false
    this._reconnectTimer = null
    this._pollTimer = null
  }

  setConfig(baseUrl) {
    if (baseUrl != null) this.baseUrl = String(baseUrl).replace(/\/$/, '')
  }

  _root() {
    // absolute bridge host or same-origin prefix
    if (this.baseUrl) return this.baseUrl
    return this.apiPrefix
  }

  async request(path, { method = 'GET', body } = {}) {
    const url = `${this._root()}${path.startsWith('/') ? path : `/${path}`}`
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' }
    }
    if (body != null) opts.body = JSON.stringify(body)
    const res = await fetch(url, opts)
    const text = await res.text()
    let data = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      data = text
    }
    if (!res.ok) {
      const msg = (data && (data.detail || data.message || data.error)) || text || res.statusText
      throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg))
    }
    return data
  }

  getState(entityId) {
    return this.stateCache.get(entityId) || null
  }

  async fetchState(entityId, { force = false } = {}) {
    if (!force && this.stateCache.has(entityId)) return this.stateCache.get(entityId)
    const st = await this.request(`/states/${encodeURIComponent(entityId)}`)
    if (st?.entity_id) {
      const old = this.stateCache.get(st.entity_id) || null
      this.stateCache.set(st.entity_id, st)
      this._emitState(st.entity_id, st, old)
    }
    return st
  }

  async getStateAsync(entityId) {
    return this.fetchState(entityId)
  }

  getCachedStates() {
    return this.stateCache
  }

  /** HAClient 兼容：返回状态数组 */
  async getStates() {
    if (this.stateCache.size) return [...this.stateCache.values()]
    const states = await this.request('/states')
    this._ingestStates(states)
    return [...this.stateCache.values()]
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

  _ingestStates(list) {
    if (!Array.isArray(list)) return
    for (const st of list) {
      if (!st?.entity_id) continue
      const old = this.stateCache.get(st.entity_id) || null
      this.stateCache.set(st.entity_id, st)
      this._emitState(st.entity_id, st, old)
    }
  }

  async connect() {
    this._wantConnect = true
    // REST bootstrap
    try {
      const health = await this.request('/health')
      if (!health?.logged_in) {
        this._emitConnection(false, '未登录米家（请扫码）')
      }
      const states = await this.request('/states')
      this._ingestStates(states)
      this._emitConnection(true, 'mijia-bridge')
    } catch (e) {
      this._emitConnection(false, e.message || String(e))
      this._scheduleReconnect()
      throw e
    }
    this._connectWs()
    this._startPoll()
  }

  disconnect() {
    this._wantConnect = false
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer)
    if (this._pollTimer) clearInterval(this._pollTimer)
    try {
      this.websocket?.close()
    } catch (_) {}
    this.websocket = null
    this._emitConnection(false, 'disconnect')
  }

  _scheduleReconnect() {
    if (!this._wantConnect) return
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer)
    this._reconnectTimer = setTimeout(() => {
      this.connect().catch(() => {})
    }, 4000)
  }

  _wsUrl() {
    const root = this._root()
    if (root.startsWith('http://') || root.startsWith('https://')) {
      const u = new URL(root)
      u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'
      u.pathname = `${u.pathname.replace(/\/$/, '')}/ws`
      return u.toString()
    }
    // same origin /mijia/ws
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${proto}//${location.host}${root}/ws`
  }

  _connectWs() {
    try {
      if (this.websocket) {
        try {
          this.websocket.close()
        } catch (_) {}
      }
      const ws = new WebSocket(this._wsUrl())
      this.websocket = ws
      ws.onopen = () => {
        this._emitConnection(true, 'ws')
      }
      ws.onmessage = (ev) => {
        let msg
        try {
          msg = JSON.parse(ev.data)
        } catch {
          return
        }
        if (msg.type === 'states' && Array.isArray(msg.states)) {
          this._ingestStates(msg.states)
        } else if (msg.type === 'state_changed' && Array.isArray(msg.states)) {
          this._ingestStates(msg.states)
        } else if (msg.type === 'ping') {
          try {
            ws.send('ping')
          } catch (_) {}
        }
      }
      ws.onclose = () => {
        if (this._wantConnect) this._scheduleReconnect()
      }
      ws.onerror = () => {
        try {
          ws.close()
        } catch (_) {}
      }
    } catch (e) {
      console.warn('[MijiaClient] ws fail', e)
    }
  }

  _startPoll() {
    if (this._pollTimer) clearInterval(this._pollTimer)
    this._pollTimer = setInterval(() => {
      this.request('/states')
        .then((states) => this._ingestStates(states))
        .catch(() => {})
    }, 15000)
  }

  async callService(domain, service, data = {}) {
    // 多灯场景：并行下发，避免串行等很久
    const eid = data?.entity_id
    if (Array.isArray(eid) && eid.length > 1) {
      const parts = await Promise.allSettled(
        eid.map((id) => this.callService(domain, service, { ...data, entity_id: id }))
      )
      const results = parts.map((p) => (p.status === 'fulfilled' ? p.value : { ok: false, error: String(p.reason) }))
      return { ok: true, results }
    }

    // 乐观：先改本地缓存，UI/3D 立刻响应
    if (typeof eid === 'string' && (domain === 'light' || domain === 'switch' || domain === 'fan')) {
      const old = this.stateCache.get(eid) || null
      if (old || service === 'turn_on' || service === 'turn_off' || service === 'toggle') {
        let next = service
        if (service === 'toggle') next = old?.state === 'on' ? 'turn_off' : 'turn_on'
        const st = {
          ...(old || { entity_id: eid, attributes: {} }),
          entity_id: eid,
          state: next === 'turn_on' ? 'on' : next === 'turn_off' ? 'off' : old?.state || 'off',
          attributes: { ...(old?.attributes || {}) }
        }
        this.stateCache.set(eid, st)
        this._emitState(eid, st, old)
      }
    }

    const payload = {
      domain,
      service,
      service_data: data,
      data
    }
    try {
      const ret = await this.request('/call_service', { method: 'POST', body: payload })
      if (ret?.state?.entity_id) {
        const old = this.stateCache.get(ret.state.entity_id) || null
        this.stateCache.set(ret.state.entity_id, ret.state)
        this._emitState(ret.state.entity_id, ret.state, old)
      }
      return ret
    } catch (e) {
      console.error('[MijiaClient] callService', domain, service, e)
      throw e
    }
  }

  async authStatus() {
    return this.request('/auth/status')
  }

  async startQrLogin(opts = {}) {
    const force = !!opts.force
    // 已登录：默认不打 /auth/qr/start（避免按钮一点就「获取二维码」）
    if (!force) {
      try {
        const st = await this.authStatus()
        if (st?.logged_in) {
          return {
            refreshed: true,
            already: true,
            message: '已登录，无需再扫码',
            qr: null,
            loginUrl: null,
            userId: st.userId,
            entities: st.entities ?? this.stateCache.size
          }
        }
      } catch (_) {}
    }
    const q = force ? '?force=true' : ''
    return this.request(`/auth/qr/start${q}`, { method: 'POST', body: {} })
  }

  /** 优先短轮询 /auth/qr/poll（不阻塞）；失败再 POST wait */
  async waitQrLogin({ timeoutMs = 120000, intervalMs = 2000 } = {}) {
    const t0 = Date.now()
    // 先查一次是否已登录（扫码其实已完成、wait 卡住的情况）
    try {
      const st = await this.authStatus()
      if (st?.logged_in) {
        await this.refreshDevices().catch(() => {})
        return { ok: true, message: '已登录', entities: st.entities ?? this.stateCache.size }
      }
    } catch (_) {}

    while (Date.now() - t0 < timeoutMs) {
      try {
        const poll = await this.request('/auth/qr/poll')
        if (poll?.logged_in || poll?.ok) {
          await this.refreshDevices().catch(() => {})
          return {
            ok: true,
            message: poll.message || '登录成功',
            entities: poll.entities ?? this.stateCache.size,
            userId: poll.userId
          }
        }
      } catch (_) {}
      await new Promise((r) => setTimeout(r, intervalMs))
    }

    // 最后兜底：服务端 wait（已修为已登录立即返回）
    try {
      return await this.request('/auth/qr/wait', { method: 'POST', body: {} })
    } catch (e) {
      const st = await this.authStatus().catch(() => ({}))
      if (st?.logged_in) {
        await this.refreshDevices().catch(() => {})
        return { ok: true, message: '已登录（wait 超时）', entities: st.entities }
      }
      throw e
    }
  }

  async refreshDevices() {
    const ret = await this.request('/auth/refresh_devices', { method: 'POST', body: {} })
    const states = await this.request('/states')
    this._ingestStates(states)
    return ret
  }

  isConnected() {
    return !!this.connected
  }
}

export default MijiaClient
