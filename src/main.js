import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import SimpleLightManager from './managers/SimpleLightManager.js'
import { LIGHT_CONFIG } from './config/light-config.js'
import HAClient from './api/HAClient.js'
import MijiaClient from './api/MijiaClient.js'
import { resolveHaConfig } from './config/ha-config.js'
import WeatherService from './api/WeatherService.js'
import { WEATHER_CONFIG } from './config/weather-config.js'
import DashboardShell from './ui/DashboardShell.js'

class App {
  constructor() {
    this.container = document.getElementById('canvas-container')
    this.loading = document.getElementById('loading')
    this.sunState = 'unknown'
    this.sunElevation = 0
    this.weatherData = null
    this.shell = null
    this._renderPaused = false
    this._resizeRaf = 0
    // 无设置页：固定简洁显示
    this.displayConfig = {
      showWeather: true,
      showDate: true,
      timeFormat: '24h',
      temperatureUnit: 'celsius'
    }
    this.weatherService = new WeatherService(WEATHER_CONFIG || {})
    this.init()
  }

  _viewSize() {
    const el = this.container
    // 非首页 canvas 可能 display:none / 宽高为 0，避免 setSize(0)
    const w = el?.clientWidth || 0
    const h = el?.clientHeight || 0
    if (w < 2 || h < 2) {
      return { w: Math.max(1, window.innerWidth), h: Math.max(1, window.innerHeight), invalid: true }
    }
    return { w, h, invalid: false }
  }

  async init() {
    // 默认米家；仅 ?backend=ha 走 HA（调试，页面无 HA 配置）
    const haConfig = resolveHaConfig()
    this.backend = haConfig.backend === 'ha' ? 'ha' : 'mijia'
    if (this.backend === 'ha') {
      this.haClient = new HAClient({
        baseUrl: haConfig.baseUrl || '',
        token: haConfig.token || ''
      })
    } else {
      this.haClient = new MijiaClient({
        baseUrl: haConfig.mijiaBase || '',
        apiPrefix: '/mijia'
      })
      this.haClient.token = 'mijia'
    }

    // 3D 仅展示：灯光跟随设备状态；开关在右侧控制栏 / 设备页
    this.lightManager = new SimpleLightManager(this.scene, this.haClient, this.backend)

    // 先挂左右布局外壳（把 canvas 放进 Banner 左半）
    this.shell = new DashboardShell({
      haClient: this.haClient,
      lightManager: this.lightManager,
      onViewChange: (view) => this.onShellViewChange(view),
      backend: this.backend
    })
    this.shell.mount()
    this.container = document.getElementById('canvas-container')
    this.loading = document.getElementById('loading')

    this.setupRenderer()
    this.setupScene()
    this.setupCamera()
    this.setupControls()
    this.setupLights()
    // lightManager 需要 scene，重建后补绑
    this.lightManager.scene = this.scene
    this.lightManager.setBackend(this.backend)
    this.lightManager.setHaClient(this.haClient)

    // 显示时间模式（先本地时间，HA 稍后异步补）
    this.getSunStateFromLocalTime()
    this.updateModeIndicator()

    // 优先加载 GLB 模型（不因 HA 失败卡住）
    let modelOk = false
    try {
      await this.loadModel()
      modelOk = true
    } catch (error) {
      console.error('❌ 模型加载失败，继续显示场景', error)
      this.showLoadError(error)
    }

    // 添加场景点光源（由控制栏开关 / HA 状态驱动展示）
    this.setupSceneLights()

    if (modelOk) this.hideLoading()
    this.animate()

    window.addEventListener('resize', () => this.scheduleResize())
    // Banner 布局后 canvas 尺寸才稳定（只直接调一次，不 dispatch 假事件）
    requestAnimationFrame(() => this.onWindowResize())
    setTimeout(() => this.onWindowResize(), 200)

    // HA / 天气异步，不阻塞模型
    this.getSunState().catch((e) => console.warn('HA sun/weather skip', e))
    setInterval(() => {
      this.getSunState().catch(() => {})
    }, 60000)

    // 连接：HA WebSocket 或 米家桥
    this.bootstrapHa().catch((e) => console.warn('bootstrap skip', e))
  }

  /** 菜单/抽屉：首页保持 3D 渲染；不改 URL */
  onShellViewChange(view) {
    // 抽屉盖在首页上，3D 继续跑
    this._renderPaused = false
    if (view === 'home') {
      requestAnimationFrame(() => {
        this.onWindowResize()
        requestAnimationFrame(() => this.onWindowResize())
      })
    }
  }

  scheduleResize() {
    if (this._renderPaused) return
    if (this._resizeRaf) return
    this._resizeRaf = requestAnimationFrame(() => {
      this._resizeRaf = 0
      this.onWindowResize()
    })
  }

  async bootstrapHa() {
    // 默认米家；HA 仅 ?backend=ha 调试
    if (this.backend !== 'ha') {
      this.shell?.setStatus('连接米家…', false)
      try {
        await this.haClient.connect()
        const st = await this.haClient.authStatus().catch(() => ({}))
        if (st?.logged_in) {
          this.shell?.setStatus(`已连接米家 · ${st.entities ?? this.haClient.stateCache.size} 设备`, true)
          this.shell?._pushLog?.(`米家已连接 · ${st.entities ?? 0} 设备`)
        } else {
          this.shell?.setStatus('米家未登录 · 请扫码', false)
          this.shell?._pushLog?.('米家未登录：请到设置扫码')
          this.shell?._showMijiaLoginHint?.()
        }
        this.updateHaHint(!!st?.logged_in)
        // 3D 灯效：同步米家 light.* 状态
        const n = await this.lightManager.syncStates().catch(() => 0)
        if (n) this.shell?._pushLog?.(`3D 灯效已同步 ${n} 盏`)
        // 轮询兜底（WS 推送为主）
        this.lightManager.startPolling(8000)
      } catch (e) {
        console.warn('mijia bridge fail', e)
        this.shell?.setStatus(`米家连接失败 · ${e.message || e}`, false)
        this.shell?._pushLog?.(`米家连接失败：${e.message || e}`)
        this.updateHaHint(false)
      }
      return
    }

    // —— 以下仅调试 HA ——
    if (!this.haClient?.token) {
      this.shell?.setStatus('未连接', false)
      this.updateHaHint(false)
      return
    }
    try {
      await this.haClient.connectWebSocket()
      if (this.haClient.isConnected()) {
        this.shell?.setStatus('已连接', true)
      }
      this.updateHaHint(true)
      for (const cfg of LIGHT_CONFIG) {
        if (!cfg.entity_id) continue
        const st = this.haClient.getState(cfg.entity_id)
        if (st) this.lightManager.updateByEntityId(cfg.entity_id, st.state)
      }
      this.getSunState().catch(() => {})
    } catch (e) {
      console.warn('WS 失败，降级 REST 轮询', e)
      this.shell?.setStatus('连接失败 · 轮询', false)
      this.updateHaHint(false)
      await this.lightManager.syncStates()
      this.lightManager.startPolling(2000)
    }
  }

  async bootstrapHaLights() {
    return this.bootstrapHa()
  }

  updateHaHint(ok) {
    const el = document.getElementById('ha-link-hint')
    if (!el) return
    el.textContent = ok ? '3D 展示 · 灯光跟随状态' : '未连接 · 仅展示模型'
    el.classList.toggle('ok', ok)
  }

  showLoadError(error) {
    const el = document.getElementById('loading')
    if (!el) return
    el.style.display = 'block'
    el.style.whiteSpace = 'pre-wrap'
    el.style.maxWidth = '80vw'
    el.textContent = `模型加载失败\n${error?.message || error}\n请打开 /local/3d-home/models/huxingtu.glb`
  }

  async getSunState() {
    try {
      // 米家桥无 sun.sun：用本地时间
      if (this.backend === 'mijia') {
        this.getSunStateFromLocalTime()
        await this.getWeather().catch(() => {})
        if (this.scene) this.updateSceneByTime()
        return
      }
      // 优先缓存（WS 已连），否则 REST
      let sunEntity = this.haClient.getState('sun.sun')
      if (!sunEntity) sunEntity = await this.haClient.fetchState('sun.sun')
      this.sunState = sunEntity.state  // 'above_horizon' or 'below_horizon'
      this.sunElevation = sunEntity.attributes.elevation || 0
      
      // 获取天气信息
      await this.getWeather()
      
      console.log(`☀️ 太阳状态: ${this.sunState}, 高度角: ${this.sunElevation.toFixed(1)}°`)
      
      // 如果场景已经创建，更新场景
      if (this.scene) {
        this.updateSceneByTime()
      }
    } catch (error) {
      console.warn('⚠️ 无法获取太阳状态，使用本地时间', error)
      // 降级到本地时间
      this.getSunStateFromLocalTime()
    }
  }

  async getWeather() {
    try {
      this.weatherData = await this.weatherService.getWeather()
      console.log(`🌤️ 天气: ${this.weatherData.conditionText}, ${this.weatherData.temperature}°C, 湿度: ${this.weatherData.humidity}%`)
    } catch (error) {
      console.warn('⚠️ 无法获取天气信息', error)
      this.weatherData = this.weatherService.getDefaultWeather()
    }
    this.shell?.setWeather?.(this.weatherData)
  }

  getSunStateFromLocalTime() {
    const now = new Date()
    const hour = now.getHours()
    const minute = now.getMinutes()
    const timeInMinutes = hour * 60 + minute
    
    // 简单的日出日落估算（夏季 6:00-19:00，冬季 7:00-17:00）
    const month = now.getMonth() + 1
    let sunrise, sunset
    
    if (month >= 5 && month <= 8) {
      // 夏季
      sunrise = 6 * 60  // 6:00
      sunset = 19 * 60  // 19:00
    } else if (month >= 11 || month <= 2) {
      // 冬季
      sunrise = 7 * 60  // 7:00
      sunset = 17 * 60  // 17:00
    } else {
      // 春秋
      sunrise = 6.5 * 60  // 6:30
      sunset = 18 * 60    // 18:00
    }
    
    if (timeInMinutes < sunrise || timeInMinutes > sunset) {
      this.sunState = 'below_horizon'
      this.sunElevation = -10
    } else {
      this.sunState = 'above_horizon'
      // 估算太阳高度角
      const dayLength = sunset - sunrise
      const timeSinceSunrise = timeInMinutes - sunrise
      const progress = timeSinceSunrise / dayLength
      this.sunElevation = Math.sin(progress * Math.PI) * 60  // 最高60°
    }
    
    console.log(`☀️ 本地时间: ${hour}:${minute.toString().padStart(2, '0')}, 太阳状态: ${this.sunState}, 高度角: ${this.sunElevation.toFixed(1)}°`)
  }

  getTimeOfDay() {
    if (this.sunState === 'below_horizon') {
      return 'night'
    }
    // 太阳在地平线以上：用高度角细分黎明/白天/黄昏
    if (this.sunElevation < 6) {
      const hour = new Date().getHours()
      return hour >= 15 ? 'dusk' : 'dawn'
    }
    if (this.sunElevation < 12) {
      const hour = new Date().getHours()
      return hour >= 15 ? 'dusk' : 'dawn'
    }
    return 'day'
  }

  /**
   * 按日出日落调全局打光（不控制房灯）：
   * - 白天：以用户确认的「当前亮度」为基准（可看清整屋）
   * - 黄昏/黎明：偏暖、介于日夜之间
   * - 夜晚：明显更暗，但禁止 #000 纯黑（仍能看见户型轮廓）
   * - 房灯：仪表盘开关叠加高亮
   * 优先用 HA sun.sun 高度角连续插值
   */
  updateSceneByTime() {
    const elev = Number.isFinite(this.sunElevation) ? this.sunElevation : 0
    // tDay: 0=深夜, 1=正午级白天
    let tDay
    if (elev <= -6) tDay = 0
    else if (elev >= 35) tDay = 1
    else if (elev < 0) tDay = (elev + 6) / 6 * 0.15 // -6..0 → 0..0.15
    else if (elev < 12) tDay = 0.15 + (elev / 12) * 0.45 // 0..12 → 0.15..0.6
    else tDay = 0.6 + Math.min(1, (elev - 12) / 23) * 0.4 // 12..35 → 0.6..1

    const timeOfDay = this.getTimeOfDay()
    this._timeOfDay = timeOfDay

    // —— 用户确认的「白天亮度」基准 ——
    const day = {
      ambient: 0.55,
      key: 0.35,
      fill: 0.28,
      hemi: 0.3,
      top: 0.22,
      exposure: 1.7,
      emissive: 0.18
    }
    // 夜晚：比白天明显暗，但必须能看清户型轮廓（禁止视觉上全黑）
    // 约白天 55% 底光；开灯再叠加房灯
    const night = {
      ambient: 0.3,
      key: 0.16,
      fill: 0.14,
      hemi: 0.15,
      top: 0.12,
      exposure: 1.35,
      emissive: 0.1
    }
    // 傍晚 = 日夜中间值
    const dusk = {
      ambient: (day.ambient + night.ambient) / 2,
      key: (day.key + night.key) / 2,
      fill: (day.fill + night.fill) / 2,
      hemi: (day.hemi + night.hemi) / 2,
      top: (day.top + night.top) / 2,
      exposure: (day.exposure + night.exposure) / 2,
      emissive: (day.emissive + night.emissive) / 2
    }

    // 分段：tDay 0→night，0.35→dusk（中间），1→day
    const t = Math.max(0, Math.min(1, tDay))
    const mix = (a, b, w) => a + (b - a) * w
    let ambientI, keyI, fillI, hemiI, topI, exposure, emissiveI
    if (t <= 0.35) {
      const w = t / 0.35
      ambientI = mix(night.ambient, dusk.ambient, w)
      keyI = mix(night.key, dusk.key, w)
      fillI = mix(night.fill, dusk.fill, w)
      hemiI = mix(night.hemi, dusk.hemi, w)
      topI = mix(night.top, dusk.top, w)
      exposure = mix(night.exposure, dusk.exposure, w)
      emissiveI = mix(night.emissive, dusk.emissive, w)
    } else {
      const w = (t - 0.35) / (1 - 0.35)
      ambientI = mix(dusk.ambient, day.ambient, w)
      keyI = mix(dusk.key, day.key, w)
      fillI = mix(dusk.fill, day.fill, w)
      hemiI = mix(dusk.hemi, day.hemi, w)
      topI = mix(dusk.top, day.top, w)
      exposure = mix(dusk.exposure, day.exposure, w)
      emissiveI = mix(dusk.emissive, day.emissive, w)
    }

    // 平面图区域保持透明，不铺独立背景色
    this.scene.background = null
    if (this.renderer) {
      this.renderer.setClearColor(0x000000, 0)
      this.renderer.toneMappingExposure = exposure
    }

    // 色温：夜冷白灰、昏暖、日白（光色用亮色，靠 intensity 分日夜）
    let ambColor, keyColor, fillColor, hemiSky, hemiGround
    if (tDay < 0.2) {
      ambColor = 0xb8c2d4
      keyColor = 0xa8b6cc
      fillColor = 0x98a8c0
      hemiSky = 0xb0bcd0
      hemiGround = 0x2e333c
    } else if (tDay < 0.55) {
      ambColor = 0xffe8d0
      keyColor = 0xffc090
      fillColor = 0xffd8b0
      hemiSky = 0xffe0c0
      hemiGround = 0x3a3038
    } else {
      ambColor = 0xffffff
      keyColor = 0xffffff
      fillColor = 0xf0f4ff
      hemiSky = 0xe8f0ff
      hemiGround = 0x3a3a45
    }

    if (this.ambientLight) {
      this.ambientLight.intensity = ambientI
      this.ambientLight.color.setHex(ambColor)
    }
    if (this.directionalLight) {
      this.directionalLight.intensity = keyI
      this.directionalLight.color.setHex(keyColor)
      const h = Math.max(0.15, Math.sin(Math.max(0, elev) * Math.PI / 180) || tDay)
      this.directionalLight.position.set(80, 40 + h * 160, 80)
    }
    if (this.fillLight) {
      this.fillLight.intensity = fillI
      this.fillLight.color.setHex(fillColor)
    }
    if (this.hemiLight) {
      this.hemiLight.intensity = hemiI
      this.hemiLight.color.setHex(hemiSky)
      this.hemiLight.groundColor.setHex(hemiGround)
    }
    if (this.topLight) {
      this.topLight.intensity = topI
      this.topLight.color.setHex(keyColor)
    }

    this.applyNightMaterialBoost(tDay, emissiveI)

    console.log(
      `🌤️ 打光 ${timeOfDay} elev=${elev.toFixed?.(1) ?? elev}° tDay=${tDay.toFixed(2)} ambient=${ambientI.toFixed(2)} exp=${exposure.toFixed(2)}`
    )
  }

  /** 材质轮廓：日/夜用插值后的 emissive，避免死黑 */
  applyNightMaterialBoost(tDay, emissiveI = 0.12) {
    if (!this.scene) return
    this.scene.traverse((child) => {
      if (!child.isMesh || !child.material) return
      const mats = Array.isArray(child.material) ? child.material : [child.material]
      mats.forEach((mat) => {
        if (!mat?.emissive || !mat.userData?._homeuiEmissive) return
        mat.emissiveIntensity = emissiveI
        if (tDay < 0.25) mat.emissive.setHex(0x2a3038)
        else mat.emissive.setHex(0x333840)
      })
    })
  }

  updateModeIndicator() {
    const now = new Date()
    const displayConfig = this.displayConfig

    let hours = now.getHours()
    const minutes = now.getMinutes().toString().padStart(2, '0')

    let timeString
    if (displayConfig.timeFormat === '12h') {
      const ampm = hours >= 12 ? 'PM' : 'AM'
      hours = hours % 12 || 12
      timeString = `${hours.toString().padStart(2, '0')}:${minutes} ${ampm}`
    } else {
      timeString = `${hours.toString().padStart(2, '0')}:${minutes}`
    }

    const year = now.getFullYear()
    const month = (now.getMonth() + 1).toString().padStart(2, '0')
    const day = now.getDate().toString().padStart(2, '0')
    const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']
    const weekday = weekdays[now.getDay()]

    const timeEl = document.getElementById('current-time')
    const dateEl = document.getElementById('current-date')
    if (timeEl) timeEl.textContent = timeString

    if (dateEl) {
      if (displayConfig.showDate) {
        dateEl.textContent = `${year}-${month}-${day} ${weekday}`
        dateEl.style.display = 'block'
      } else {
        dateEl.style.display = 'none'
      }
    }

    const weatherSection = document.getElementById('weather-section')
    if (!weatherSection) return

    if (this.weatherData && displayConfig.showWeather) {
      weatherSection.style.display = 'flex'
      const weatherIcon = this.getWeatherIcon(this.weatherData.condition)
      const iconEl = document.getElementById('weather-icon')
      if (iconEl) iconEl.textContent = weatherIcon

      let temperature = this.weatherData.temperature
      let unit = '°C'
      if (displayConfig.temperatureUnit === 'fahrenheit') {
        temperature = Math.round(temperature * 9 / 5 + 32)
        unit = '°F'
      }
      const tempEl = document.getElementById('weather-temp')
      const condEl = document.getElementById('weather-condition')
      if (tempEl) tempEl.textContent = `${temperature}${unit}`
      if (condEl) {
        condEl.textContent =
          this.weatherData.conditionText || this.getWeatherText(this.weatherData.condition)
      }
      // 同步左栏（panel 布局）
      this.shell?.setWeather?.(this.weatherData)
    } else {
      weatherSection.style.display = 'none'
    }
  }

  getWeatherIcon(condition) {
    const icons = {
      'sunny': '☀️',
      'clear-night': '🌙',
      'partlycloudy': '⛅',
      'cloudy': '☁️',
      'rainy': '🌧️',
      'pouring': '🌧️',
      'snowy': '❄️',
      'fog': '🌫️',
      'windy': '💨',
      'lightning': '⛈️'
    }
    return icons[condition] || '🌤️'
  }

  getWeatherText(condition) {
    const texts = {
      'sunny': '晴天',
      'clear-night': '晴夜',
      'partlycloudy': '多云',
      'cloudy': '阴天',
      'rainy': '雨天',
      'pouring': '大雨',
      'snowy': '雪天',
      'fog': '雾天',
      'windy': '大风',
      'lightning': '雷阵雨'
    }
    return texts[condition] || '多云'
  }

  setupSceneLights() {
    console.log('🔆 设置场景灯光（米家状态 → 3D 展示）...')
    this.lightManager.setBackend(this.backend)
    LIGHT_CONFIG.forEach((config) => {
      this.lightManager.addLight(config)
    })
    const bound = LIGHT_CONFIG.filter((c) => c.entity_id || c.ha_entity_id).length
    console.log(`✅ 已添加 ${LIGHT_CONFIG.length} 个展示灯（${bound} 个绑定实体 · ${this.backend}）`)
    console.log('📺 控制：首页开关 / 设备页；3D 只读亮灭')
  }

  async loadModel() {
    const loader = new GLTFLoader()
    const candidates = this.resolveModelUrls()
    console.log('📦 模型候选路径', candidates)

    let lastError = null
    for (const modelUrl of candidates) {
      try {
        await this._loadModelFromUrl(loader, modelUrl)
        console.log('✅ 模型加载成功', modelUrl)
        return
      } catch (error) {
        console.warn('❌ 模型路径失败，尝试下一个', modelUrl, error)
        lastError = error
      }
    }
    throw lastError || new Error('所有模型路径均失败')
  }

  /** HA /local 部署 + 开发环境兼容；优先正确绝对路径，避免旧缓存/错误 base */
  resolveModelUrls() {
    const urls = []
    const loc = window.location
    // 1) 同目录相对（/local/3d-home/index.html → .../models/...）
    try {
      urls.push(new URL('./models/huxingtu.glb', loc.href).href)
    } catch (_) {}
    // 2) HA 静态目录绝对路径（最稳，不吃 base 错误）
    urls.push(`${loc.origin}/local/3d-home/models/huxingtu.glb`)
    // 3) 仅开发：根路径 /models（Vite public）
    if (loc.port === '3010' || loc.port === '3000' || loc.hostname === '127.0.0.1' || loc.hostname === 'localhost') {
      urls.push(`${loc.origin}/models/huxingtu.glb`)
    }
    // 去重
    return [...new Set(urls)]
  }

  _loadModelFromUrl(loader, modelUrl) {
    return new Promise((resolve, reject) => {
      loader.load(
        modelUrl,
        (gltf) => {
          const model = gltf.scene
          model.scale.set(10, 10, 10)  // 放大 10 倍

          // 调整材质：提高可读性，避免缩小时整片发黑
          model.traverse((child) => {
            if (child.isMesh) {
              child.castShadow = false
              child.receiveShadow = false

              if (child.material) {
                const mats = Array.isArray(child.material) ? child.material : [child.material]
                mats.forEach((mat) => {
                  if (!mat) return
                  mat.needsUpdate = true
                  if (mat.color && !mat.userData._homeuiBrightened) {
                    mat.color.multiplyScalar(1.5)
                    mat.userData._homeuiBrightened = true
                  }
                  if (mat.roughness !== undefined) {
                    mat.roughness = Math.min(0.8, Math.max(0.2, mat.roughness * 0.7))
                  }
                  if (mat.metalness !== undefined) {
                    mat.metalness = Math.min(mat.metalness, 0.15)
                  }
                  if (mat.emissive && !mat.userData._homeuiEmissive) {
                    mat.emissive.setHex(0x333840)
                    mat.emissiveIntensity = 0.2
                    mat.userData._homeuiEmissive = true
                  }
                  mat.side = THREE.DoubleSide
                  if (mat.transparent && mat.opacity < 0.05) {
                    mat.opacity = 1
                    mat.transparent = false
                  }
                })
              }
            }
          })

          this.scene.add(model)

          const box = new THREE.Box3().setFromObject(model)
          const size = box.getSize(new THREE.Vector3())
          const center = box.getCenter(new THREE.Vector3())
          const maxDim = Math.max(size.x, size.y, size.z)

          console.log('模型尺寸:', {
            width: size.x.toFixed(2),
            height: size.y.toFixed(2),
            depth: size.z.toFixed(2)
          })

          const dist = Math.max(maxDim * 1.35, 8)
          // 参考图主视觉：3D 家居/户型占中右，略低视角、靠近沙发展示位
          this.camera.position.set(
            center.x + dist * 0.62,
            center.y + dist * 0.78,
            center.z + dist * 0.72
          )
          this.camera.near = 0.1
          this.camera.far = Math.max(1000, dist * 20)
          this.camera.updateProjectionMatrix()
          this.camera.lookAt(center)
          this.controls.target.copy(center)
          this.controls.minDistance = Math.max(2, maxDim * 0.2)
          this.controls.maxDistance = Math.max(50, maxDim * 4)
          this.controls.update()

          console.log('📷 相机已对准模型中心', {
            center: center.toArray().map((n) => n.toFixed(2)),
            maxDim: maxDim.toFixed(2)
          })

          // 模型加载后立刻按当前时段再刷一次（材质已就绪）
          this.updateSceneByTime()

          resolve()
        },
        (progress) => {
          if (!progress.total) return
          const percent = ((progress.loaded / progress.total) * 100).toFixed(0)
          const el = document.getElementById('loading')
          if (el) el.textContent = `加载模型 ${percent}%`
        },
        (error) => {
          reject(error)
        }
      )
    })
  }

  setupRenderer() {
    // 平面图区无独立底色：透明 clear，透出页面 #262b2f
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true,
      precision: 'highp'
    })
    const { w, h } = this._viewSize()
    this.renderer.setSize(w, h)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.shadowMap.enabled = false
    if (THREE.ACESFilmicToneMapping !== undefined) {
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping
      // 默认=白天基准曝光；会由 updateSceneByTime 按日夜覆盖
      this.renderer.toneMappingExposure = 1.7
    }
    if (THREE.SRGBColorSpace !== undefined) {
      this.renderer.outputColorSpace = THREE.SRGBColorSpace
    }
    const host = document.getElementById('canvas-container') || this.container
    host.appendChild(this.renderer.domElement)
  }

  setupScene() {
    this.scene = new THREE.Scene()
    // 透明背景：平面图区域不出现独立色块，透出页面底
    this.scene.background = null
  }

  setupCamera() {
    const { w, h } = this._viewSize()
    this.camera = new THREE.PerspectiveCamera(
      30,  // 进一步减小视野角度，放大一倍（45° → 30°）
      w / h,
      0.1,
      1000
    )
    // 初始位置（会在模型加载后调整）
    this.camera.position.set(0, 20, 0)
    this.camera.lookAt(0, 0, 0)
  }

  setupControls() {
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.05

    // 限制垂直旋转角度，保持俯视
    this.controls.maxPolarAngle = Math.PI / 2.5  // 不能转到底部
    this.controls.minPolarAngle = 0  // 可以完全俯视

    // 缩放范围
    this.controls.minDistance = 5   // 最近距离
    this.controls.maxDistance = 100  // 最远距离

    // 启用平移
    this.controls.enablePan = true

    // 手机：单指不抢手势，整页可纵向滚动；双指仍可缩放
    this._applyMobileControls = () => {
      const mobile = window.matchMedia('(max-width: 900px)').matches
      if (mobile) {
        this.controls.enableRotate = false
        this.controls.enablePan = false
        this.controls.enableZoom = true
      } else {
        this.controls.enableRotate = true
        this.controls.enablePan = true
        this.controls.enableZoom = true
      }
    }
    this._applyMobileControls()
    window.addEventListener('resize', this._applyMobileControls)
  }

  setupLights() {
    // 全局光由 updateSceneByTime() 按日出日落调；默认先按本地时间算一档
    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.5)
    this.scene.add(this.ambientLight)

    this.hemiLight = new THREE.HemisphereLight(0xe8f0ff, 0x3a3a45, 0.3)
    this.scene.add(this.hemiLight)

    this.directionalLight = new THREE.DirectionalLight(0xffffff, 0.5)
    this.directionalLight.position.set(80, 160, 80)
    this.scene.add(this.directionalLight)

    this.fillLight = new THREE.DirectionalLight(0xf0f4ff, 0.3)
    this.fillLight.position.set(-100, 120, -70)
    this.scene.add(this.fillLight)

    this.topLight = new THREE.DirectionalLight(0xffffff, 0.2)
    this.topLight.position.set(0, 200, 0)
    this.scene.add(this.topLight)

    this.updateSceneByTime()
  }

  hideLoading() {
    this.loading.style.display = 'none'
  }

  onWindowResize() {
    if (this._renderPaused) return
    if (!this.camera || !this.renderer) return
    const { w, h, invalid } = this._viewSize()
    if (invalid) return
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(w, h, false)
  }

  animate() {
    requestAnimationFrame(() => this.animate())
    if (this._renderPaused) return
    if (!this.renderer || !this.scene || !this.camera) return
    this.controls?.update?.()
    this.renderer.render(this.scene, this.camera)
  }
}

// 启动应用
new App()
