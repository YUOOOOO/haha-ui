# 天气服务使用说明

## 概述

项目已集成天气服务模块，支持多个公开天气 API，可根据需要选择使用。

## 支持的天气服务

### 1. wttr.in（默认，推荐）
- **优点**：完全免费，无需注册，无需 API Key
- **缺点**：国内访问可能较慢
- **配置**：
```javascript
// src/config/weather-config.js
export const WEATHER_CONFIG = {
  provider: 'wttr',
  apiKey: '',
  location: 'auto'  // 或指定城市如 'Beijing'
}
```

### 2. 和风天气（推荐国内用户）
- **优点**：国内服务，速度快，数据准确
- **缺点**：需要注册获取 API Key
- **注册地址**：https://dev.qweather.com/
- **免费额度**：每天 1000 次请求
- **配置**：
```javascript
export const WEATHER_CONFIG = {
  provider: 'qweather',
  apiKey: '你的和风天气API Key',
  location: 'auto'  // 或指定城市ID如 '101010100'
}
```

### 3. OpenWeatherMap
- **优点**：国际知名服务，数据丰富
- **缺点**：需要注册获取 API Key，国内访问可能较慢
- **注册地址**：https://openweathermap.org/api
- **免费额度**：每分钟 60 次请求
- **配置**：
```javascript
export const WEATHER_CONFIG = {
  provider: 'openweather',
  apiKey: '你的OpenWeatherMap API Key',
  location: 'auto'  // 或指定城市如 'Beijing'
}
```

## 功能特性

1. **自动缓存**：天气数据缓存 30 分钟，减少 API 调用
2. **自动定位**：支持基于 IP 的自动定位
3. **降级处理**：API 失败时使用缓存或默认数据
4. **统一接口**：不同服务提供商返回统一的数据格式

## 返回数据格式

```javascript
{
  temperature: 25,           // 温度（°C）
  condition: 'sunny',        // 天气状况代码
  conditionText: '晴天',     // 天气状况文本
  humidity: 60,              // 湿度（%）
  windSpeed: 10,             // 风速（km/h）
  feelsLike: 25,             // 体感温度（°C）
  provider: 'wttr'           // 数据来源
}
```

## 天气状况代码

- `sunny` - 晴天
- `clear-night` - 晴夜
- `partlycloudy` - 多云
- `cloudy` - 阴天
- `rainy` - 雨天
- `pouring` - 大雨
- `snowy` - 雪天
- `fog` - 雾天
- `windy` - 大风
- `lightning` - 雷阵雨
- `exceptional` - 异常天气

## 使用示例

### 切换天气服务

编辑 `src/config/weather-config.js`：

```javascript
// 使用和风天气
export const WEATHER_CONFIG = {
  provider: 'qweather',
  apiKey: 'your-qweather-api-key',
  location: 'auto',
  cacheDuration: 30 * 60 * 1000
}
```

### 指定城市

```javascript
// 和风天气 - 使用城市ID
location: '101010100'  // 北京

// OpenWeatherMap 或 wttr.in - 使用城市名
location: 'Beijing'
location: 'Shanghai'
```

### 手动刷新天气

```javascript
// 清除缓存并重新获取
app.weatherService.clearCache()
await app.getWeather()
```

## 注意事项

1. **API Key 安全**：不要将 API Key 提交到公开仓库
2. **请求频率**：注意各服务的免费额度限制
3. **网络环境**：国内用户推荐使用和风天气
4. **缓存时间**：可根据需要调整 `cacheDuration`

## 故障排查

### 天气数据不更新
- 检查缓存时间设置
- 手动清除缓存：`weatherService.clearCache()`

### API 调用失败
- 检查 API Key 是否正确
- 检查网络连接
- 查看浏览器控制台错误信息

### 定位不准确
- 使用 `location` 参数手动指定城市
- 检查 IP 定位服务是否可用
