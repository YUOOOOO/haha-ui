import * as THREE from 'three'

class LightManager {
  constructor(scene, haClient) {
    this.scene = scene
    this.haClient = haClient
    this.lights = new Map() // entityId -> { light3D, state, position }
    this.raycaster = new THREE.Raycaster()
    this.mouse = new THREE.Vector2()
  }

  // 添加灯光到场景
  addLight(entityId, position, config = {}) {
    const {
      color = 0xffaa00,
      intensity = 2,
      distance = 5,
      name = entityId
    } = config

    // 创建灯光组
    const lightGroup = new THREE.Group()
    lightGroup.userData.entityId = entityId
    lightGroup.userData.type = 'light'
    lightGroup.userData.name = name

    // 创建点光源
    const pointLight = new THREE.PointLight(color, 0, distance)
    pointLight.castShadow = true
    lightGroup.add(pointLight)

    // 创建灯泡网格（可点击）
    const bulbGeometry = new THREE.SphereGeometry(0.15, 16, 16)
    const bulbMaterial = new THREE.MeshStandardMaterial({
      emissive: 0x000000,
      emissiveIntensity: 0,
      color: 0xffffff
    })
    const bulbMesh = new THREE.Mesh(bulbGeometry, bulbMaterial)
    bulbMesh.userData.clickable = true
    bulbMesh.userData.entityId = entityId
    lightGroup.add(bulbMesh)

    // 创建光晕效果
    const glowGeometry = new THREE.SphereGeometry(0.2, 16, 16)
    const glowMaterial = new THREE.MeshBasicMaterial({
      color: color,
      transparent: true,
      opacity: 0
    })
    const glowMesh = new THREE.Mesh(glowGeometry, glowMaterial)
    lightGroup.add(glowMesh)

    // 设置位置
    lightGroup.position.set(position.x, position.y, position.z)
    this.scene.add(lightGroup)

    // 保存引用
    this.lights.set(entityId, {
      group: lightGroup,
      pointLight,
      bulbMesh,
      glowMesh,
      state: 'off',
      intensity,
      color,
      position
    })

    console.log(`💡 添加灯光: ${name} (${entityId})`)
    return lightGroup
  }

  // 更新灯光状态
  updateLightState(entityId, state) {
    const light = this.lights.get(entityId)
    if (!light) return

    const isOn = state === 'on'
    light.state = state

    // 更新点光源
    light.pointLight.intensity = isOn ? light.intensity : 0

    // 更新灯泡材质
    light.bulbMesh.material.emissive.setHex(isOn ? light.color : 0x000000)
    light.bulbMesh.material.emissiveIntensity = isOn ? 1 : 0

    // 更新光晕
    light.glowMesh.material.opacity = isOn ? 0.3 : 0

    console.log(`💡 ${entityId}: ${state}`)
  }

  // 切换灯光状态
  async toggleLight(entityId) {
    const light = this.lights.get(entityId)
    if (!light) return

    try {
      const newState = light.state === 'on' ? 'off' : 'on'
      const service = newState === 'on' ? 'turn_on' : 'turn_off'
      
      await this.haClient.callService('light', service, {
        entity_id: entityId
      })

      console.log(`🔄 切换灯光 ${entityId} -> ${newState}`)
    } catch (error) {
      console.error(`❌ 切换灯光失败:`, error)
    }
  }

  // 处理点击事件
  handleClick(camera, event) {
    // 计算鼠标位置
    this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1
    this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1

    // 射线检测
    this.raycaster.setFromCamera(this.mouse, camera)
    
    const clickableObjects = []
    this.lights.forEach(light => {
      if (light.bulbMesh.userData.clickable) {
        clickableObjects.push(light.bulbMesh)
      }
    })

    const intersects = this.raycaster.intersectObjects(clickableObjects)
    
    if (intersects.length > 0) {
      const entityId = intersects[0].object.userData.entityId
      this.toggleLight(entityId)
      return true
    }
    
    return false
  }

  // 从 Home Assistant 同步所有灯光状态
  async syncStates() {
    try {
      const states = await this.haClient.getStates()
      
      states.forEach(entity => {
        if (entity.entity_id.startsWith('light.')) {
          if (this.lights.has(entity.entity_id)) {
            this.updateLightState(entity.entity_id, entity.state)
          }
        }
      })
      
      console.log('✅ 灯光状态已同步')
    } catch (error) {
      console.error('❌ 同步灯光状态失败:', error)
    }
  }

  // 订阅状态变化
  subscribeStateChanges() {
    this.haClient.subscribeStateChanged((event) => {
      const entityId = event.data.entity_id
      
      if (entityId.startsWith('light.') && this.lights.has(entityId)) {
        const newState = event.data.new_state.state
        this.updateLightState(entityId, newState)
      }
    })
  }

  // 移除灯光
  removeLight(entityId) {
    const light = this.lights.get(entityId)
    if (light) {
      this.scene.remove(light.group)
      this.lights.delete(entityId)
    }
  }

  // 清除所有灯光
  clear() {
    this.lights.forEach((light, entityId) => {
      this.scene.remove(light.group)
    })
    this.lights.clear()
  }
}

export default LightManager
