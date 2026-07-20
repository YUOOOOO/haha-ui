class HAClient {
  constructor(config = {}) {
    // 允许 baseUrl 为空字符串（开发时走 Vite 同源 /api 代理）
    this.baseUrl = Object.prototype.hasOwnProperty.call(config, 'baseUrl')
      ? (config.baseUrl || '')
      : 'http://homeassistant.local:8123'
    this.token = config.token || ''
    this.websocket = null
    this.messageId = 1
    this.subscribers = new Map()
  }

  // 设置连接配置
  setConfig(baseUrl, token) {
    this.baseUrl = baseUrl
    this.token = token
  }

  // REST API 请求（空 baseUrl 走同源/代理 /api；带超时避免卡住 3D）
  async request(endpoint, options = {}) {
    if (!this.token) {
      throw new Error('HA token empty')
    }
    const base = (this.baseUrl || '').replace(/\/$/, '')
    const url = `${base}/api/${endpoint}`
    const headers = {
      'Authorization': `Bearer ${this.token}`,
      'Content-Type': 'application/json',
      ...options.headers
    }

    const controller = new AbortController()
    const timeoutMs = options.timeoutMs ?? 4000
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

      return await response.json()
    } catch (error) {
      console.error('HA API Request Error:', error)
      throw error
    } finally {
      clearTimeout(timer)
    }
  }

  // 获取所有状态
  async getStates() {
    return await this.request('states')
  }

  // 获取特定实体状态
  async getState(entityId) {
    return await this.request(`states/${entityId}`)
  }

  // 调用服务
  async callService(domain, service, data = {}) {
    return await this.request(`services/${domain}/${service}`, {
      method: 'POST',
      body: JSON.stringify(data)
    })
  }

  // 连接 WebSocket
  connectWebSocket() {
    return new Promise((resolve, reject) => {
      const wsUrl = this.baseUrl.replace('http', 'ws') + '/api/websocket'
      this.websocket = new WebSocket(wsUrl)

      this.websocket.onopen = () => {
        console.log('WebSocket connected')
      }

      this.websocket.onmessage = (event) => {
        const message = JSON.parse(event.data)
        
        if (message.type === 'auth_required') {
          this.websocket.send(JSON.stringify({
            type: 'auth',
            access_token: this.token
          }))
        } else if (message.type === 'auth_ok') {
          console.log('WebSocket authenticated')
          resolve()
        } else if (message.type === 'auth_invalid') {
          reject(new Error('WebSocket authentication failed'))
        } else if (message.type === 'event') {
          this.handleEvent(message)
        }
      }

      this.websocket.onerror = (error) => {
        console.error('WebSocket error:', error)
        reject(error)
      }

      this.websocket.onclose = () => {
        console.log('WebSocket disconnected')
      }
    })
  }

  // 订阅状态变化
  subscribeStateChanged(callback) {
    const id = this.messageId++
    this.subscribers.set(id, callback)

    if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
      this.websocket.send(JSON.stringify({
        id,
        type: 'subscribe_events',
        event_type: 'state_changed'
      }))
    }

    return id
  }

  // 取消订阅
  unsubscribe(subscriptionId) {
    this.subscribers.delete(subscriptionId)
  }

  // 处理事件
  handleEvent(message) {
    const callback = this.subscribers.get(message.id)
    if (callback && message.event) {
      callback(message.event)
    }
  }

  // 断开连接
  disconnect() {
    if (this.websocket) {
      this.websocket.close()
      this.websocket = null
    }
    this.subscribers.clear()
  }
}

export default HAClient
