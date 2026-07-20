# 设置页面使用说明

## 功能概述

设置页面允许用户自定义配置以下内容：
- 🌤️ 天气服务（选择提供商、API Key、位置）
- 🏠 Home Assistant 连接（服务器地址、访问令牌）
- 🎨 显示设置（时间格式、温度单位、显示选项）

## 打开设置页面

在主页面底部点击 **⚙️ 设置** 按钮，会在新窗口中打开设置页面。

## 配置项说明

### 1. 天气服务

#### 天气服务提供商
- **wttr.in**（默认）
  - ✅ 完全免费，无需注册
  - ✅ 无需 API Key
  - ⚠️ 国内访问可能较慢
  
- **和风天气**（推荐国内用户）
  - ✅ 国内服务，速度快
  - ✅ 数据准确，中文支持好
  - ⚠️ 需要注册获取 API Key
  - 📝 注册地址：https://dev.qweather.com/
  - 💰 免费额度：每天 1000 次请求
  
- **OpenWeatherMap**
  - ✅ 国际知名服务
  - ✅ 数据丰富
  - ⚠️ 需要注册获取 API Key
  - ⚠️ 国内访问可能较慢
  - 📝 注册地址：https://openweathermap.org/api
  - 💰 免费额度：每分钟 60 次请求

#### API Key
- 仅在选择和风天气或 OpenWeatherMap 时需要
- 点击 **👁️ 显示/隐藏** 按钮可以查看输入的 API Key
- API Key 会安全地保存在浏览器本地存储中

#### 位置
- **auto**（默认）：自动根据 IP 地址定位
- **城市名称**：手动指定城市，如 `Beijing`、`Shanghai`
- **城市 ID**（和风天气）：如 `101010100`（北京）

### 2. Home Assistant

#### 服务器地址
- Home Assistant 服务器的完整地址
- 格式：`http://IP地址:端口`
- 示例：`http://192.168.1.100:8123`
- 默认：`http://ha.yuchaoqun.com:8123`

#### 访问令牌
- Home Assistant 的长期访问令牌
- 获取方式：
  1. 登录 Home Assistant
  2. 点击左下角用户名
  3. 选择 **安全**
  4. 在 **长期访问令牌** 部分点击 **创建令牌**
  5. 输入令牌名称（如 `HA Home UI`）
  6. 复制生成的令牌

#### 测试连接
- 点击 **🔌 测试连接** 按钮可以验证配置是否正确
- 成功会显示 Home Assistant 版本号
- 失败会显示错误信息

### 3. 显示设置

#### 显示天气信息
- ✅ 勾选：在主页面顶部显示天气信息
- ❌ 取消：隐藏天气信息

#### 显示日期
- ✅ 勾选：在时间下方显示日期和星期
- ❌ 取消：只显示时间

#### 时间格式
- **24小时制**：显示为 `14:30`
- **12小时制**：显示为 `02:30 PM`

#### 温度单位
- **摄氏度 (°C)**：国际标准，中国常用
- **华氏度 (°F)**：美国常用

## 操作说明

### 保存设置
1. 修改需要的配置项
2. 点击 **💾 保存设置** 按钮
3. 看到 "✅ 设置已保存" 提示
4. 刷新主页面使设置生效

### 恢复默认
1. 点击 **🔄 恢复默认** 按钮
2. 确认操作
3. 所有设置恢复为初始值

### 测试连接
1. 填写 Home Assistant 服务器地址和令牌
2. 点击 **🔌 测试连接** 按钮
3. 查看连接结果

## 数据存储

- 所有设置保存在浏览器的 **localStorage** 中
- 数据仅存储在本地，不会上传到服务器
- 清除浏览器数据会删除所有设置
- 不同浏览器的设置互不影响

## 常见问题

### Q: 设置保存后没有生效？
A: 需要刷新主页面（按 F5 或 Ctrl+R）才能使新设置生效。

### Q: 天气数据不更新？
A: 天气数据有 30 分钟缓存，等待缓存过期或刷新页面。

### Q: Home Assistant 连接失败？
A: 检查以下几点：
- 服务器地址是否正确（包括 http:// 和端口号）
- 访问令牌是否正确
- 网络是否可以访问 Home Assistant
- Home Assistant 是否正常运行

### Q: 和风天气 API Key 在哪里获取？
A: 
1. 访问 https://dev.qweather.com/
2. 注册账号
3. 创建应用
4. 复制 API Key

### Q: 如何查看我输入的 API Key？
A: 点击输入框下方的 **👁️ 显示/隐藏** 按钮。

### Q: 设置会同步到其他设备吗？
A: 不会，设置仅保存在当前浏览器的本地存储中。

## 安全提示

- API Key 和访问令牌仅保存在本地浏览器中
- 不要在公共电脑上保存敏感信息
- 定期更换 Home Assistant 访问令牌
- 不要将 API Key 分享给他人

## 技术细节

### 存储格式
```javascript
{
  weather: {
    provider: 'wttr',
    apiKey: '',
    location: 'auto'
  },
  homeAssistant: {
    baseUrl: 'http://ha.yuchaoqun.com:8123',
    token: ''
  },
  display: {
    showWeather: true,
    showDate: true,
    timeFormat: '24h',
    temperatureUnit: 'celsius'
  }
}
```

### 存储位置
- localStorage key: `ha-homeui-settings`
- 可以在浏览器开发者工具中查看：
  - F12 → Application → Local Storage → 当前域名

### 导出/导入设置（高级）
可以在浏览器控制台中执行：

```javascript
// 导出设置
const settings = localStorage.getItem('ha-homeui-settings')
console.log(settings)

// 导入设置
localStorage.setItem('ha-homeui-settings', '你的设置JSON')
```
