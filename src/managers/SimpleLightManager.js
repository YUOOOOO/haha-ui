import * as THREE from 'three'
import { LIGHT_CONFIG, resolveLightEntityId } from '../config/light-config.js'

/**
 * 3D 灯光纯展示：
 * - 只从状态缓存读 entity（米家桥 / HA 均可）
 * - 不发送 turn_on/off（控制在设备页/控制栏）
 * - 支持 entity_id 精确匹配 + friendly_name 回退
 */
class SimpleLightManager {
  constructor(scene, haClient = null, backend = 'mijia') {
    this.scene = scene
    this.haClient = haClient
    this.backend = backend === 'ha' ? 'ha' : 'mijia'
    this.lights = []
    this._pollTimer = null
    this._unsub = null
  }

  setHaClient(haClient) {
    this.haClient = haClient
    this._bindStateListener()
  }

  setBackend(backend) {
    this.backend = backend === 'ha' ? 'ha' : 'mijia'
    // 重绑 entity_id
    for (const light of this.lights) {
      const id = resolveLightEntityId(light.config, this.backend)
      light.config.entity_id = id
      light.pointLight.userData.entity_id = id
    }
  }

  addLight(config) {
    const entity_id = resolveLightEntityId(config, this.backend)
    const { name, position, color, intensity, distance, decay = 1.2 } = config
    const cfg = { ...config, entity_id, intensity }

    const pointLight = new THREE.PointLight(color, 0, distance, decay)
    pointLight.position.set(position.x, position.y, position.z)
    pointLight.castShadow = false
    pointLight.userData.name = name
    pointLight.userData.isLight = true
    pointLight.userData.isOn = false
    pointLight.userData.entity_id = entity_id || null
    pointLight.userData.lightIndex = this.lights.length

    this.scene.add(pointLight)

    const entry = {
      index: this.lights.length,
      pointLight,
      config: cfg,
      isOn: false
    }
    this.lights.push(entry)

    console.log(
      `💡 展示灯: ${name}` +
        (entity_id ? ` ← ${entity_id}` : ' (无 entity)') +
        ` @ (${position.x.toFixed?.(1) ?? position.x}, ${position.y}, ${position.z}) d=${distance}`
    )
    return pointLight
  }

  /** 从 LIGHT_CONFIG 批量添加（若尚未添加） */
  addFromConfig(list = LIGHT_CONFIG) {
    for (const cfg of list) {
      if (this.lights.some((l) => l.config.name === cfg.name)) continue
      this.addLight(cfg)
    }
  }

  _applyVisual(light, isOn) {
    light.isOn = isOn
    light.pointLight.intensity = isOn ? light.config.intensity : 0
    light.pointLight.userData.isOn = isOn
  }

  _namesFor(light) {
    const names = new Set()
    if (light.config.name) names.add(String(light.config.name).trim())
    for (const n of light.config.match_names || []) {
      if (n) names.add(String(n).trim())
    }
    return names
  }

  /** 按 entity_id 或名称找到 3D 灯 */
  _findLight(entityId, stateObj = null) {
    let light = this.lights.find((l) => l.config.entity_id === entityId)
    if (light) return light
    // 回退：friendly_name
    const fname = stateObj?.attributes?.friendly_name
    if (fname) {
      const t = String(fname).trim()
      light = this.lights.find((l) => this._namesFor(l).has(t))
      if (light) {
        // 学到的 entity_id 写回，后续精确匹配
        light.config.entity_id = entityId
        light.pointLight.userData.entity_id = entityId
        return light
      }
    }
    return null
  }

  updateByEntityId(entityId, state, stateObj = null) {
    const light = this._findLight(entityId, stateObj)
    if (!light) return
    const isOn = state === 'on'
    if (light.isOn === isOn) return
    this._applyVisual(light, isOn)
    console.log(`📺 3D 跟随 ${entityId}: ${isOn ? 'ON' : 'OFF'}`)
  }

  _bindStateListener() {
    if (this._unsub) {
      try {
        this._unsub()
      } catch (_) {}
      this._unsub = null
    }
    if (!this.haClient?.onStateChange) return
    this._unsub = this.haClient.onStateChange((entityId, state, _cache, _old) => {
      if (!entityId) return
      // light.* 或 名称含灯的 switch（可选）
      const st = state || this.haClient.getState?.(entityId)
      if (entityId.startsWith('light.') || entityId.startsWith('switch.')) {
        this.updateByEntityId(entityId, st?.state ?? state?.state, st || state)
      }
    })
  }

  async syncStates() {
    if (!this.haClient) {
      console.warn('⚠️ 无客户端，3D 无法跟随灯状态')
      return
    }
    try {
      let states = []
      if (typeof this.haClient.getStates === 'function') {
        states = await this.haClient.getStates()
      } else if (this.haClient.stateCache?.size) {
        states = [...this.haClient.stateCache.values()]
      } else {
        // 尝试 REST
        states = (await this.haClient.request?.('/states')) || []
      }
      const map = new Map((states || []).map((s) => [s.entity_id, s]))
      let n = 0
      for (const light of this.lights) {
        let id = light.config.entity_id
        let st = id ? map.get(id) : null
        // 名称回退
        if (!st) {
          const names = this._namesFor(light)
          for (const s of map.values()) {
            const fn = String(s?.attributes?.friendly_name || '').trim()
            if (names.has(fn) && String(s.entity_id || '').startsWith('light.')) {
              st = s
              light.config.entity_id = s.entity_id
              light.pointLight.userData.entity_id = s.entity_id
              break
            }
          }
        }
        if (!st) continue
        this._applyVisual(light, st.state === 'on')
        n++
      }
      console.log(`✅ 3D 已同步 ${n} 盏灯状态（只读 · ${this.backend}）`)
      return n
    } catch (e) {
      console.error('❌ 同步灯光失败', e)
      return 0
    }
  }

  startPolling(intervalMs = 3000) {
    this.stopPolling()
    this._pollTimer = setInterval(() => {
      this.syncStates().catch(() => {})
    }, intervalMs)
  }

  stopPolling() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer)
      this._pollTimer = null
    }
  }

  clear() {
    this.stopPolling()
    if (this._unsub) {
      try {
        this._unsub()
      } catch (_) {}
      this._unsub = null
    }
    this.lights.forEach((light) => {
      this.scene.remove(light.pointLight)
    })
    this.lights = []
  }
}

export default SimpleLightManager
