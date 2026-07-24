/** 面板实体绑定 — 默认米家桥 entity_id（HA id 仅调试保留注释） */

// 米家 light.*（与 /mijia/states 一致）
export const LIGHTS = [
  { entity_id: 'light.mijia_2047904263', name: '客厅大灯' },
  { entity_id: 'light.mijia_1164116265', name: '主卧灯' },
  { entity_id: 'light.mijia_1127956977', name: '客卧灯' },
  { entity_id: 'light.mijia_1167899031', name: '书房灯' },
  { entity_id: 'light.mijia_1167766609', name: '儿童房灯' },
  { entity_id: 'light.mijia_944866629', name: '餐厅灯' }
]

// 环境指标：室温取自客厅左空调 current_temperature；湿度/空气/噪声暂无米家实体
export const ENV_METRICS = [
  {
    entity_id: 'climate.mijia_2158499015',
    name: '室温',
    unit: '°C',
    icon: '🌡️',
    attr: 'current_temperature',
    source_name: '客厅左空调'
  },
  { entity_id: '', name: '湿度', unit: '% RH', icon: '💧' },
  { entity_id: '', name: '空气', unit: '', icon: '🍃' },
  { entity_id: '', name: '噪声', unit: 'dB', icon: '🔊' }
]

export const WEATHER_ENTITY = '' // 米家无 weather 实体；天气走 WeatherService

const ALL_LIGHTS = LIGHTS.map((l) => l.entity_id)
const LIVING_LIGHTS = ['light.mijia_2047904263', 'light.mijia_944866629']

// 参考图场景卡；id/name/icon 用于 UI，domain/service/entities 用于下发
export const SCENES = [
  {
    id: 'home',
    name: '回家',
    icon: '⌂',
    primary: true,
    domain: 'light',
    service: 'turn_on',
    entities: LIVING_LIGHTS
  },
  {
    id: 'away',
    name: '离家',
    icon: '↪',
    domain: 'light',
    service: 'turn_off',
    entities: ALL_LIGHTS
  },
  {
    id: 'dining',
    name: '就餐',
    icon: '◓',
    domain: 'light',
    service: 'turn_on',
    entities: ['light.mijia_944866629']
  },
  {
    id: 'sleep',
    name: '就寝',
    icon: '☾',
    domain: 'light',
    service: 'turn_off',
    entities: ALL_LIGHTS
  },
  {
    id: 'morning',
    name: '晨起',
    icon: '☀',
    domain: 'cover',
    service: 'open_cover',
    entities: [
      'cover.mijia_2188714852',
      'cover.mijia_2188801741',
      'cover.mijia_2188766144',
      'cover.mijia_2188769345',
      'cover.mijia_2188767918',
      'cover.mijia_2188806221',
      'cover.mijia_2170032048'
    ]
  },
  {
    id: 'guest',
    name: '会客',
    icon: '☷',
    domain: 'light',
    service: 'turn_on',
    entities: LIVING_LIGHTS
  },
  {
    id: 'reading',
    name: '阅读',
    icon: '▤',
    domain: 'light',
    service: 'turn_on',
    entities: ['light.mijia_1167899031']
  },
  {
    id: 'cinema',
    name: '影院',
    icon: '▣',
    domain: 'light',
    service: 'turn_off',
    entities: ['light.mijia_2047904263', 'light.mijia_944866629']
  }
]

export const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

export const WEATHER_ICON = {
  sunny: '☀️',
  'clear-night': '🌙',
  partlycloudy: '⛅',
  cloudy: '☁️',
  rainy: '🌧️',
  pouring: '🌧️',
  snowy: '❄️',
  fog: '🌫️',
  windy: '💨',
  lightning: '⛈️'
}
