// 灯光配置：position / distance 按「模型 scale=10 后的世界坐标」
// entity_id：米家桥实体（默认）；ha_entity_id：仅 ?backend=ha 调试
// 3D 只读展示：仪表盘/设备页开关 → 状态 → 3D 点光源

const S = 10 // 与 main.js 里 model.scale 一致

function L(cfg) {
  return {
    ...cfg,
    position: {
      x: cfg.position.x * S,
      y: cfg.position.y * S,
      z: cfg.position.z * S
    },
    intensity: (cfg.intensity ?? 18) * 4,
    distance: (cfg.distance ?? 15) * S * 1.8,
    decay: 1.2
  }
}

/**
 * 米家实体 ID 来自桥 /states（did 短 id）
 * 名称需与米家设备名一致，便于运行时按 friendly_name 回退匹配
 */
export const LIGHT_CONFIG = [
  L({
    name: '客厅大灯',
    entity_id: 'light.mijia_2047904263',
    ha_entity_id: 'light.ftd_wfilmp_e3e1_light',
    position: { x: 5, y: 2.5, z: 3 },
    color: 0xffcc66,
    intensity: 22,
    distance: 22
  }),
  L({
    name: '餐厅灯',
    entity_id: 'light.mijia_944866629',
    ha_entity_id: 'light.lemesh_wy0a22_d0d9_light',
    position: { x: 0, y: 2.5, z: 3 },
    color: 0xffffff,
    intensity: 20,
    distance: 18
  }),
  L({
    name: '主卧灯',
    entity_id: 'light.mijia_1164116265',
    ha_entity_id: 'light.lemesh_wy0c24_ebad_light',
    position: { x: -3, y: 2.5, z: 5 },
    color: 0xffe0b0,
    intensity: 20,
    distance: 20
  }),
  L({
    name: '客卧灯',
    entity_id: 'light.mijia_1127956977',
    ha_entity_id: 'light.ftd_ftdlmp_d188_light',
    position: { x: -8, y: 2.5, z: 3 },
    color: 0xffe0b0,
    intensity: 18,
    distance: 18
  }),
  L({
    name: '儿童房灯',
    entity_id: 'light.mijia_1167766609',
    ha_entity_id: 'light.ftd_ftdlmp_6396_light',
    position: { x: -8, y: 2.5, z: -3 },
    color: 0xffe0b0,
    intensity: 18,
    distance: 18
  }),
  L({
    name: '书房灯',
    // 米家名是「书房」
    entity_id: 'light.mijia_1167899031',
    ha_entity_id: 'light.ftd_ftdlmp_2e26_light',
    match_names: ['书房灯', '书房'],
    position: { x: 5, y: 2.5, z: -5 },
    color: 0xffffff,
    intensity: 20,
    distance: 18
  })
]

/** 按后端选 entity_id（默认米家） */
export function resolveLightEntityId(cfg, backend = 'mijia') {
  if (backend === 'ha') return cfg.ha_entity_id || cfg.entity_id || null
  return cfg.entity_id || cfg.ha_entity_id || null
}

/** 侧边开关卡片只显示带 entity 的灯 */
export function getBoundLights(backend = 'mijia') {
  return LIGHT_CONFIG.filter((c) => resolveLightEntityId(c, backend))
}
