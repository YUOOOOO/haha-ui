// 天气服务类 - 支持多个公开天气 API
class WeatherService {
  constructor(config = {}) {
    this.provider = config.provider || 'qweather' // 默认使用和风天气
    this.apiKey = config.apiKey || ''
    this.location = config.location || 'auto' // 自动定位或指定城市
    this.cache = null
    this.cacheTime = 0
    this.cacheDuration = 30 * 60 * 1000 // 缓存30分钟
  }

  // 获取天气数据
  async getWeather() {
    // 检查缓存
    if (this.cache && Date.now() - this.cacheTime < this.cacheDuration) {
      console.log('🌤️ 使用缓存的天气数据')
      return this.cache
    }

    try {
      let weatherData
      
      switch (this.provider) {
        case 'qweather':
          weatherData = await this.getQWeather()
          break
        case 'openweather':
          weatherData = await this.getOpenWeather()
          break
        case 'wttr':
          weatherData = await this.getWttrWeather()
          break
        default:
          throw new Error(`不支持的天气服务提供商: ${this.provider}`)
      }

      // 更新缓存
      this.cache = weatherData
      this.cacheTime = Date.now()
      
      console.log(`🌤️ 天气数据获取成功 [${this.provider}]:`, weatherData)
      return weatherData
    } catch (error) {
      console.error('❌ 获取天气数据失败:', error)
      
      // 返回缓存数据或默认数据
      if (this.cache) {
        console.log('⚠️ 使用过期的缓存数据')
        return this.cache
      }
      
      return this.getDefaultWeather()
    }
  }

  // 和风天气 API
  async getQWeather() {
    if (!this.apiKey) {
      throw new Error('和风天气需要 API Key')
    }

    // 如果是自动定位，先获取位置
    let locationId = this.location
    if (this.location === 'auto') {
      locationId = await this.getQWeatherLocation()
    }

    const url = `https://devapi.qweather.com/v7/weather/now?location=${locationId}&key=${this.apiKey}`
    const response = await fetch(url)
    const data = await response.json()

    if (data.code !== '200') {
      throw new Error(`和风天气 API 错误: ${data.code}`)
    }

    const now = data.now
    return {
      temperature: parseInt(now.temp),
      condition: this.mapQWeatherCondition(now.icon),
      conditionText: now.text,
      humidity: parseInt(now.humidity),
      windSpeed: parseInt(now.windSpeed),
      feelsLike: parseInt(now.feelsLike),
      provider: 'qweather'
    }
  }

  // 获取和风天气位置 ID
  async getQWeatherLocation() {
    // 使用 IP 定位
    const url = `https://geoapi.qweather.com/v2/city/lookup?location=auto_ip&key=${this.apiKey}`
    const response = await fetch(url)
    const data = await response.json()

    if (data.code !== '200' || !data.location || data.location.length === 0) {
      throw new Error('无法获取位置信息')
    }

    return data.location[0].id
  }

  // OpenWeatherMap API
  async getOpenWeather() {
    if (!this.apiKey) {
      throw new Error('OpenWeatherMap 需要 API Key')
    }

    let url
    if (this.location === 'auto') {
      // 使用 IP 定位（需要先获取坐标）
      const coords = await this.getCoordinates()
      url = `https://api.openweathermap.org/data/2.5/weather?lat=${coords.lat}&lon=${coords.lon}&appid=${this.apiKey}&units=metric&lang=zh_cn`
    } else {
      url = `https://api.openweathermap.org/data/2.5/weather?q=${this.location}&appid=${this.apiKey}&units=metric&lang=zh_cn`
    }

    const response = await fetch(url)
    const data = await response.json()

    if (data.cod !== 200) {
      throw new Error(`OpenWeatherMap API 错误: ${data.message}`)
    }

    return {
      temperature: Math.round(data.main.temp),
      condition: this.mapOpenWeatherCondition(data.weather[0].id),
      conditionText: data.weather[0].description,
      humidity: data.main.humidity,
      windSpeed: Math.round(data.wind.speed * 3.6), // m/s 转 km/h
      feelsLike: Math.round(data.main.feels_like),
      provider: 'openweather'
    }
  }

  // wttr.in API（免费，无需 API Key）
  async getWttrWeather() {
    const location = this.location === 'auto' ? '' : this.location
    const url = `https://wttr.in/${location}?format=j1`
    
    const response = await fetch(url)
    const data = await response.json()

    const current = data.current_condition[0]
    return {
      temperature: parseInt(current.temp_C),
      condition: this.mapWttrCondition(current.weatherCode),
      conditionText: current.weatherDesc[0].value,
      humidity: parseInt(current.humidity),
      windSpeed: parseInt(current.windspeedKmph),
      feelsLike: parseInt(current.FeelsLikeC),
      provider: 'wttr'
    }
  }

  // 获取坐标（用于 IP 定位）
  async getCoordinates() {
    try {
      const response = await fetch('https://ipapi.co/json/')
      const data = await response.json()
      return {
        lat: data.latitude,
        lon: data.longitude
      }
    } catch (error) {
      // 默认坐标（北京）
      return { lat: 39.9042, lon: 116.4074 }
    }
  }

  // 和风天气图标代码映射
  mapQWeatherCondition(icon) {
    const iconMap = {
      '100': 'sunny',           // 晴
      '101': 'partlycloudy',    // 多云
      '102': 'partlycloudy',    // 少云
      '103': 'partlycloudy',    // 晴间多云
      '104': 'cloudy',          // 阴
      '150': 'clear-night',     // 晴（夜间）
      '151': 'partlycloudy',    // 多云（夜间）
      '152': 'partlycloudy',    // 少云（夜间）
      '153': 'partlycloudy',    // 晴间多云（夜间）
      '300': 'rainy',           // 阵雨
      '301': 'rainy',           // 强阵雨
      '302': 'lightning',       // 雷阵雨
      '303': 'lightning',       // 强雷阵雨
      '304': 'lightning',       // 雷阵雨伴有冰雹
      '305': 'rainy',           // 小雨
      '306': 'rainy',           // 中雨
      '307': 'rainy',           // 大雨
      '308': 'pouring',         // 极端降雨
      '309': 'rainy',           // 毛毛雨
      '310': 'pouring',         // 暴雨
      '311': 'pouring',         // 大暴雨
      '312': 'pouring',         // 特大暴雨
      '313': 'rainy',           // 冻雨
      '314': 'rainy',           // 小到中雨
      '315': 'rainy',           // 中到大雨
      '316': 'pouring',         // 大到暴雨
      '317': 'pouring',         // 暴雨到大暴雨
      '318': 'pouring',         // 大暴雨到特大暴雨
      '399': 'rainy',           // 雨
      '400': 'snowy',           // 小雪
      '401': 'snowy',           // 中雪
      '402': 'snowy',           // 大雪
      '403': 'snowy',           // 暴雪
      '404': 'rainy',           // 雨夹雪
      '405': 'rainy',           // 雨雪天气
      '406': 'rainy',           // 阵雨夹雪
      '407': 'snowy',           // 阵雪
      '408': 'snowy',           // 小到中雪
      '409': 'snowy',           // 中到大雪
      '410': 'snowy',           // 大到暴雪
      '499': 'snowy',           // 雪
      '500': 'fog',             // 薄雾
      '501': 'fog',             // 雾
      '502': 'fog',             // 霾
      '503': 'fog',             // 扬沙
      '504': 'fog',             // 浮尘
      '507': 'fog',             // 沙尘暴
      '508': 'fog',             // 强沙尘暴
      '509': 'fog',             // 浓雾
      '510': 'fog',             // 强浓雾
      '511': 'fog',             // 中度霾
      '512': 'fog',             // 重度霾
      '513': 'fog',             // 严重霾
      '514': 'fog',             // 大雾
      '515': 'fog',             // 特强浓雾
      '900': 'exceptional',     // 热
      '901': 'exceptional',     // 冷
      '999': 'exceptional'      // 未知
    }
    return iconMap[icon] || 'partlycloudy'
  }

  // OpenWeatherMap 天气代码映射
  mapOpenWeatherCondition(code) {
    if (code >= 200 && code < 300) return 'lightning'      // 雷暴
    if (code >= 300 && code < 400) return 'rainy'          // 毛毛雨
    if (code >= 500 && code < 600) return 'rainy'          // 雨
    if (code >= 600 && code < 700) return 'snowy'          // 雪
    if (code >= 700 && code < 800) return 'fog'            // 雾霾
    if (code === 800) return 'sunny'                       // 晴天
    if (code > 800) return 'cloudy'                        // 多云
    return 'partlycloudy'
  }

  // wttr.in 天气代码映射
  mapWttrCondition(code) {
    const codeMap = {
      '113': 'sunny',           // 晴天
      '116': 'partlycloudy',    // 多云
      '119': 'cloudy',          // 阴天
      '122': 'cloudy',          // 阴天
      '143': 'fog',             // 雾
      '176': 'rainy',           // 小雨
      '179': 'snowy',           // 小雪
      '182': 'rainy',           // 雨夹雪
      '185': 'rainy',           // 雨夹雪
      '200': 'lightning',       // 雷阵雨
      '227': 'snowy',           // 暴雪
      '230': 'snowy',           // 暴雪
      '248': 'fog',             // 雾
      '260': 'fog',             // 雾
      '263': 'rainy',           // 小雨
      '266': 'rainy',           // 小雨
      '281': 'rainy',           // 雨夹雪
      '284': 'rainy',           // 雨夹雪
      '293': 'rainy',           // 小雨
      '296': 'rainy',           // 小雨
      '299': 'rainy',           // 中雨
      '302': 'rainy',           // 中雨
      '305': 'pouring',         // 大雨
      '308': 'pouring',         // 大雨
      '311': 'rainy',           // 雨夹雪
      '314': 'rainy',           // 雨夹雪
      '317': 'rainy',           // 雨夹雪
      '320': 'snowy',           // 小雪
      '323': 'snowy',           // 小雪
      '326': 'snowy',           // 中雪
      '329': 'snowy',           // 中雪
      '332': 'snowy',           // 大雪
      '335': 'snowy',           // 大雪
      '338': 'snowy',           // 暴雪
      '350': 'rainy',           // 雨夹雪
      '353': 'rainy',           // 小雨
      '356': 'rainy',           // 中雨
      '359': 'pouring',         // 大雨
      '362': 'rainy',           // 雨夹雪
      '365': 'rainy',           // 雨夹雪
      '368': 'snowy',           // 小雪
      '371': 'snowy',           // 中雪
      '374': 'rainy',           // 雨夹雪
      '377': 'rainy',           // 雨夹雪
      '386': 'lightning',       // 雷阵雨
      '389': 'lightning',       // 雷阵雨
      '392': 'lightning',       // 雷阵雨
      '395': 'lightning'        // 雷阵雨
    }
    return codeMap[code] || 'partlycloudy'
  }

  // 获取默认天气数据
  getDefaultWeather() {
    return {
      temperature: 25,
      condition: 'partlycloudy',
      conditionText: '多云',
      humidity: 60,
      windSpeed: 10,
      feelsLike: 25,
      provider: 'default'
    }
  }

  // 清除缓存
  clearCache() {
    this.cache = null
    this.cacheTime = 0
  }
}

export default WeatherService
