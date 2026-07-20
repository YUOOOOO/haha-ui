import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import SimpleLightManager from './managers/SimpleLightManager.js'
import { LIGHT_CONFIG } from './config/light-config.js'
import HAClient from './api/HAClient.js'
import { HA_CONFIG } from './config/ha-config.js'
import WeatherService from './api/WeatherService.js'
import { WEATHER_CONFIG } from './config/weather-config.js'
import SettingsManager from './utils/SettingsManager.js'

class App {
  constructor() {
    this.container = document.getElementById('canvas-container')
    this.loading = document.getElementById('loading')
    this.sunState = 'unknown'
    this.sunElevation = 0
    this.weatherData = null
    
    // 初始化设置管理器
    this.settingsManager = new SettingsManager()
    const settings = this.settingsManager.getSettings()
    
    // 使用设置中的配置初始化服务
    this.weatherService = new WeatherService(settings.weather)
    
    this.init()
  }

  async init() {
    this.setupRenderer()
    this.setupScene()
    this.setupCamera()
    this.setupControls()
    this.setupLights()

    // 显示时间模式（先本地时间，HA 稍后异步补）
    this.getSunStateFromLocalTime()
    this.updateModeIndicator()

    // 从设置中获取 Home Assistant 配置（不阻塞 3D）
    const haConfig = this.settingsManager.getHAConfig()
    this.haClient = new HAClient({
      baseUrl: haConfig.baseUrl || HA_CONFIG.baseUrl || '',
      token: haConfig.token || HA_CONFIG.token || ''
    })

    // 初始化灯光管理器
    this.lightManager = new SimpleLightManager(this.scene)

    // 添加点击事件
    this.renderer.domElement.addEventListener('click', (event) => {
      this.lightManager.handleClick(this.camera, event)
    })

    // 优先加载 GLB 模型（不因 HA 失败卡住）
    let modelOk = false
    try {
      await this.loadModel()
      modelOk = true
    } catch (error) {
      console.error('❌ 模型加载失败，继续显示场景', error)
      this.showLoadError(error)
    }

    // 添加配置的灯光
    this.setupSceneLights()

    if (modelOk) this.hideLoading()
    this.animate()

    window.addEventListener('resize', () => this.onWindowResize())

    // HA / 天气异步，不阻塞模型
    this.getSunState().catch((e) => console.warn('HA sun/weather skip', e))
    setInterval(() => {
      this.getSunState().catch(() => {})
    }, 60000)

    // 每秒更新时间显示
    setInterval(() => {
      this.updateModeIndicator()
    }, 1000)
  }

  showLoadError(error) {
    const el = document.getElementById('loading')
    if (!el) return
    el.style.display = 'block'
    el.style.whiteSpace = 'pre-wrap'
    el.style.maxWidth = '80vw'
    el.textContent = `模型加载失败\n${error?.message || error}\n请确认 /models/huxingtu.glb 可访问`
  }

  async getSunState() {
    try {
      const sunEntity = await this.haClient.getState('sun.sun')
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
      return 'night'  // 夜晚
    }
    
    // 太阳在地平线以上
    if (this.sunElevation < 6) {
      // 太阳高度角 < 6° 为黄昏/黎明
      const hour = new Date().getHours()
      if (hour >= 17) {
        return 'dusk'  // 黄昏
      } else {
        return 'dawn'  // 黎明（当作白天处理）
      }
    }
    
    return 'day'  // 白天
  }

  updateSceneByTime() {
    const timeOfDay = this.getTimeOfDay()
    
    switch (timeOfDay) {
      case 'day':
        // 白天 - 冷白、亮灰
        this.scene.background = new THREE.Color(0xe8e8e8)
        this.ambientLight.intensity = 0.6
        this.ambientLight.color.setHex(0xffffff)
        this.directionalLight.intensity = 0.4
        break
        
      case 'dusk':
        // 黄昏 - 橙色
        this.scene.background = new THREE.Color(0x4a3a2a)
        this.ambientLight.intensity = 0.3
        this.ambientLight.color.setHex(0xffaa66)
        this.directionalLight.intensity = 0.2
        break
        
      case 'night':
        // 夜晚 - 深蓝/深灰，但保持可读（过暗会导致“看不到模型”）
        this.scene.background = new THREE.Color(0x1a1a2e)
        this.ambientLight.intensity = 0.55
        this.ambientLight.color.setHex(0xaaccff)
        this.directionalLight.intensity = 0.45
        if (this.fillLight) this.fillLight.intensity = 0.3
        break
        
      case 'dawn':
        // 黎明（当作白天）
        this.scene.background = new THREE.Color(0xe8e8e8)
        this.ambientLight.intensity = 0.5
        this.ambientLight.color.setHex(0xffeedd)
        this.directionalLight.intensity = 0.3
        break
    }
  }

  updateModeIndicator() {
    // 使用浏览器本地时间
    const now = new Date()
    const displayConfig = this.settingsManager.getDisplayConfig()
    
    let hours = now.getHours()
    const minutes = now.getMinutes().toString().padStart(2, '0')
    
    // 根据设置选择时间格式
    let timeString
    if (displayConfig.timeFormat === '12h') {
      const ampm = hours >= 12 ? 'PM' : 'AM'
      hours = hours % 12 || 12
      timeString = `${hours.toString().padStart(2, '0')}:${minutes} ${ampm}`
    } else {
      timeString = `${hours.toString().padStart(2, '0')}:${minutes}`
    }
    
    // 获取当前日期
    const year = now.getFullYear()
    const month = (now.getMonth() + 1).toString().padStart(2, '0')
    const day = now.getDate().toString().padStart(2, '0')
    const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']
    const weekday = weekdays[now.getDay()]
    
    // 更新时间显示
    document.getElementById('current-time').textContent = timeString
    
    // 根据设置显示日期
    if (displayConfig.showDate) {
      document.getElementById('current-date').textContent = `${year}-${month}-${day} ${weekday}`
      document.getElementById('current-date').style.display = 'block'
    } else {
      document.getElementById('current-date').style.display = 'none'
    }
    
    // 更新天气显示
    if (this.weatherData && displayConfig.showWeather) {
      const weatherSection = document.getElementById('weather-section')
      weatherSection.style.display = 'flex'
      
      const weatherIcon = this.getWeatherIcon(this.weatherData.condition)
      document.getElementById('weather-icon').textContent = weatherIcon
      
      // 根据设置选择温度单位
      let temperature = this.weatherData.temperature
      let unit = '°C'
      if (displayConfig.temperatureUnit === 'fahrenheit') {
        temperature = Math.round(temperature * 9 / 5 + 32)
        unit = '°F'
      }
      
      document.getElementById('weather-temp').textContent = `${temperature}${unit}`
      document.getElementById('weather-condition').textContent = this.weatherData.conditionText || this.getWeatherText(this.weatherData.condition)
    } else {
      document.getElementById('weather-section').style.display = 'none'
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
    console.log('🔆 设置场景灯光...')
    
    LIGHT_CONFIG.forEach(config => {
      this.lightManager.addLight(config)
    })
    
    console.log(`✅ 已添加 ${LIGHT_CONFIG.length} 个灯光`)
    console.log('💡 点击模型可以开关灯光')
  }

  async loadModel() {
    const loader = new GLTFLoader()
    
    return new Promise((resolve, reject) => {
      loader.load(
        '/models/huxingtu.glb',
        (gltf) => {
          console.log('✅ 模型加载成功')
          
          const model = gltf.scene
          model.scale.set(10, 10, 10)  // 放大 10 倍
          
          // 启用阴影并调整材质以更好地反射灯光
          model.traverse((child) => {
            if (child.isMesh) {
              // 关闭阴影以提高性能
              child.castShadow = false
              child.receiveShadow = false
              
              // 调整材质以更好地接收灯光
              if (child.material) {
                const mats = Array.isArray(child.material) ? child.material : [child.material]
                mats.forEach((mat) => {
                  if (!mat) return
                  mat.needsUpdate = true
                  if (mat.color) {
                    // 夜间场景略提亮，避免全黑
                    mat.color.multiplyScalar(1.2)
                  }
                  if (mat.roughness !== undefined) {
                    mat.roughness = Math.min(0.9, Math.max(0.35, mat.roughness * 0.85))
                  }
                  if (mat.metalness !== undefined) {
                    mat.metalness = Math.min(mat.metalness, 0.35)
                  }
                  // 确保不被透明/裁剪搞没
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
          
          // 计算边界并调整相机
          const box = new THREE.Box3().setFromObject(model)
          const size = box.getSize(new THREE.Vector3())
          const center = box.getCenter(new THREE.Vector3())
          const maxDim = Math.max(size.x, size.y, size.z)
          
          console.log('模型尺寸:', {
            width: size.x.toFixed(2),
            height: size.y.toFixed(2),
            depth: size.z.toFixed(2)
          })
          
          // 略带倾斜的俯视，避免纯顶视 + 过暗材质导致“看不见”
          const dist = Math.max(maxDim * 1.6, 8)
          this.camera.position.set(
            center.x + dist * 0.35,
            center.y + dist * 1.1,
            center.z + dist * 0.55
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
            center: center.toArray().map(n => n.toFixed(2)),
            maxDim: maxDim.toFixed(2)
          })

          resolve()
        },
        (progress) => {
          const percent = (progress.loaded / progress.total * 100).toFixed(1)
          console.log(`加载进度: ${percent}%`)
        },
        (error) => {
          console.error('❌ 模型加载失败:', error)
          reject(error)
        }
      )
    })
  }

  setupRenderer() {
    this.renderer = new THREE.WebGLRenderer({ 
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true
    })
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setClearColor(0x1a1a2e, 1)
    // 关闭阴影以提高性能
    this.renderer.shadowMap.enabled = false
    // 更亮的色调映射，避免 GLB 发黑
    if (THREE.ACESFilmicToneMapping !== undefined) {
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping
      this.renderer.toneMappingExposure = 1.35
    }
    this.container.appendChild(this.renderer.domElement)
  }

  setupScene() {
    this.scene = new THREE.Scene()
    // 初始背景色（会在 getSunState 后更新）
    this.scene.background = new THREE.Color(0xe8e8e8)
  }

  setupCamera() {
    this.camera = new THREE.PerspectiveCamera(
      30,  // 进一步减小视野角度，放大一倍（45° → 30°）
      window.innerWidth / window.innerHeight,
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
  }

  setupLights() {
    // 环境光/主光稍亮，保证 GLB 在无 HA 时也能看清
    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.85)
    this.scene.add(this.ambientLight)

    this.directionalLight = new THREE.DirectionalLight(0xffffff, 0.7)
    this.directionalLight.position.set(10, 20, 10)
    this.scene.add(this.directionalLight)

    // 补一盏从侧面的填充光
    this.fillLight = new THREE.DirectionalLight(0xffffff, 0.35)
    this.fillLight.position.set(-12, 15, -8)
    this.scene.add(this.fillLight)

    // 根据太阳状态更新（本地时间已先跑过）
    this.updateSceneByTime()
  }

  hideLoading() {
    this.loading.style.display = 'none'
  }

  onWindowResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(window.innerWidth, window.innerHeight)
  }

  animate() {
    requestAnimationFrame(() => this.animate())
    
    this.controls.update()
    
    this.renderer.render(this.scene, this.camera)
  }
}

// 启动应用
new App()
