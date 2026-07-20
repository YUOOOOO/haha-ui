import * as THREE from 'three'

class SimpleLightManager {
  constructor(scene) {
    this.scene = scene
    this.lights = []
    this.raycaster = new THREE.Raycaster()
    this.mouse = new THREE.Vector2()
  }

  // 添加灯光
  addLight(config) {
    const { name, position, color, intensity, distance } = config

    // 创建点光源（直接添加到场景）
    const pointLight = new THREE.PointLight(color, 0, distance)
    pointLight.position.set(position.x, position.y, position.z)
    // 关闭阴影以减少性能消耗和纹理单元使用
    pointLight.castShadow = false
    pointLight.userData.name = name
    pointLight.userData.isLight = true
    pointLight.userData.isOn = false
    pointLight.userData.lightIndex = this.lights.length
    
    // 设置衰减参数，让光照范围更大
    pointLight.decay = 1  // 降低衰减，默认是2
    
    this.scene.add(pointLight)

    // 保存引用
    this.lights.push({
      pointLight,
      config: { ...config, intensity },
      isOn: false
    })

    console.log(`💡 添加灯光: ${name} at (${position.x}, ${position.y}, ${position.z})`)
    return pointLight
  }

  // 切换灯光状态
  toggleLight(index) {
    const light = this.lights[index]
    if (!light) return

    light.isOn = !light.isOn
    const isOn = light.isOn

    // 更新点光源亮度
    light.pointLight.intensity = isOn ? light.config.intensity : 0

    console.log(`💡 ${light.config.name}: ${isOn ? 'ON ☀️' : 'OFF'}`)
  }

  // 处理点击事件（点击模型任何位置切换最近的灯）
  handleClick(camera, event) {
    // 计算鼠标位置（归一化设备坐标）
    this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1
    this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1

    // 射线检测
    this.raycaster.setFromCamera(this.mouse, camera)
    
    // 检测所有场景对象
    const intersects = this.raycaster.intersectObjects(this.scene.children, true)

    if (intersects.length > 0) {
      const clickPoint = intersects[0].point
      
      // 找到最近的灯
      let nearestIndex = 0
      let minDistance = Infinity
      
      this.lights.forEach((light, index) => {
        const distance = clickPoint.distanceTo(light.pointLight.position)
        if (distance < minDistance) {
          minDistance = distance
          nearestIndex = index
        }
      })
      
      // 切换最近的灯
      this.toggleLight(nearestIndex)
      console.log(`👆 点击位置距离 ${this.lights[nearestIndex].config.name} 最近 (${minDistance.toFixed(2)}m)`)
      return true
    }

    return false
  }

  // 全部开启
  turnOnAll() {
    this.lights.forEach((light, index) => {
      if (!light.isOn) {
        this.toggleLight(index)
      }
    })
  }

  // 全部关闭
  turnOffAll() {
    this.lights.forEach((light, index) => {
      if (light.isOn) {
        this.toggleLight(index)
      }
    })
  }

  // 清除所有灯光
  clear() {
    this.lights.forEach(light => {
      this.scene.remove(light.pointLight)
    })
    this.lights = []
  }
}

export default SimpleLightManager
