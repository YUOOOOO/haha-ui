// 天气服务配置
export const WEATHER_CONFIG = {
  // 天气服务提供商: 'qweather' | 'openweather' | 'wttr'
  provider: 'wttr',  // 默认使用 wttr.in（免费，无需 API Key）

  // API Key（如果使用需要 Key 的服务）
  apiKey: '',

  // 位置设置
  // 'auto' - 自动定位
  // 或指定城市名称，如: 'Beijing', 'Shanghai', '北京'
  location: 'auto',

  // 缓存时长（毫秒）
  cacheDuration: 30 * 60 * 1000  // 30分钟
}

// 使用说明：
//
// 1. wttr.in（免费，无需注册）
//    provider: 'wttr'
//    apiKey: ''  // 不需要
//    location: 'auto' 或 'Beijing'
//
// 2. 和风天气（需要注册获取 API Key）
//    注册地址: https://dev.qweather.com/
//    provider: 'qweather'
//    apiKey: '你的 API Key'
//    location: 'auto' 或 '101010100'（城市 ID）
//
// 3. OpenWeatherMap（需要注册获取 API Key）
//    注册地址: https://openweathermap.org/api
//    provider: 'openweather'
//    apiKey: '你的 OpenWeatherMap API Key'
//    location: 'auto' 或 'Beijing'
