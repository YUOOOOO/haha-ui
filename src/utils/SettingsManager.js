// 设置管理器
class SettingsManager {
  constructor() {
    this.storageKey = 'ha-homeui-settings'
    this.defaultSettings = {
      // 天气配置
      weather: {
        provider: 'wttr',
        apiKey: '',
        location: 'auto'
      },
      // Home Assistant 配置
      homeAssistant: {
        // 开发默认走 Vite 代理（空 baseUrl → /api）；生产可填 https://ha.yuchaoqun.com
        baseUrl: '',
        token: ''
      },
      // 显示配置
      display: {
        showWeather: true,
        showDate: true,
        timeFormat: '24h',
        temperatureUnit: 'celsius'
      }
    }
    this.settings = this.loadSettings()
  }

  // 加载设置
  loadSettings() {
    try {
      const stored = localStorage.getItem(this.storageKey)
      if (stored) {
        const parsed = JSON.parse(stored)
        // 合并默认设置和存储的设置
        const merged = this.mergeSettings(this.defaultSettings, parsed)
        return this.sanitizeSettings(merged)
      }
    } catch (error) {
      console.error('加载设置失败:', error)
    }
    return this.sanitizeSettings({ ...this.defaultSettings })
  }

  // 清理无效/旧版 HA 地址，避免卡在 homeassistant.local
  sanitizeSettings(settings) {
    const ha = settings.homeAssistant || {}
    const badHosts = [
      'http://homeassistant.local:8123',
      'https://homeassistant.local:8123',
      'http://ha.yuchaoqun.com:8123'
    ]
    if (!ha.baseUrl || badHosts.includes(ha.baseUrl)) {
      ha.baseUrl = ''
    }
    // 占位 token 清空
    if (ha.token && (ha.token.includes('...') || ha.token.length < 20)) {
      ha.token = ''
    }
    settings.homeAssistant = ha
    return settings
  }

  // 合并设置
  mergeSettings(defaults, stored) {
    const merged = { ...defaults }
    for (const key in stored) {
      if (typeof stored[key] === 'object' && !Array.isArray(stored[key])) {
        merged[key] = { ...defaults[key], ...stored[key] }
      } else {
        merged[key] = stored[key]
      }
    }
    return merged
  }

  // 保存设置
  saveSettings(settings) {
    try {
      this.settings = settings
      localStorage.setItem(this.storageKey, JSON.stringify(settings))
      console.log('✅ 设置已保存')
      return true
    } catch (error) {
      console.error('❌ 保存设置失败:', error)
      return false
    }
  }

  // 获取设置
  getSettings() {
    return { ...this.settings }
  }

  // 获取特定配置
  getWeatherConfig() {
    return { ...this.settings.weather }
  }

  getHAConfig() {
    return { ...this.settings.homeAssistant }
  }

  getDisplayConfig() {
    return { ...this.settings.display }
  }

  // 更新特定配置
  updateWeatherConfig(config) {
    this.settings.weather = { ...this.settings.weather, ...config }
    return this.saveSettings(this.settings)
  }

  updateHAConfig(config) {
    this.settings.homeAssistant = { ...this.settings.homeAssistant, ...config }
    return this.saveSettings(this.settings)
  }

  updateDisplayConfig(config) {
    this.settings.display = { ...this.settings.display, ...config }
    return this.saveSettings(this.settings)
  }

  // 重置为默认设置
  resetToDefaults() {
    this.settings = { ...this.defaultSettings }
    return this.saveSettings(this.settings)
  }

  // 导出设置
  exportSettings() {
    return JSON.stringify(this.settings, null, 2)
  }

  // 导入设置
  importSettings(jsonString) {
    try {
      const imported = JSON.parse(jsonString)
      this.settings = this.mergeSettings(this.defaultSettings, imported)
      return this.saveSettings(this.settings)
    } catch (error) {
      console.error('导入设置失败:', error)
      return false
    }
  }
}

export default SettingsManager
