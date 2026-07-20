import * as THREE from 'three'

class TeslaStyleLightManager {
  constructor(scene) {
    this.scene = scene
    this.lights = []
    this.lines = []
    this.buttons = []
  }

  // 添加灯光（带线条和按钮）
  addLight(config) {
    const { name, position, color, intensity, distance } = config

    // 创建点光源
    const pointLight = new THREE.PointLight(color, 0, distance)
    pointLight.position.set(position.x, position.y, position.z)
    pointLight.castShadow = false
    pointLight.decay = 1
    this.scene.add(pointLight)

    // 创建小圆点标记灯光位置
    const markerGeometry = new THREE.SphereGeometry(0.1, 8, 8)
    const markerMaterial = new THREE.MeshBasicMaterial({
      color: color,
      transparent: true,
      opacity: 0.5
    })
    const marker = new THREE.Mesh(markerGeometry, markerMaterial)
    marker.position.copy(pointLight.position)
    this.scene.add(marker)

    // 保存引用
    const lightData = {
      name,
      pointLight,
      marker,
      config: { ...config, intensity },
      isOn: false,
      line: null,
      buttonElement: null
    }

    this.lights.push(lightData)
    console.log(`💡 添加灯光: ${name}`)
    
    return lightData
  }

  // 创建从灯光到控制面板的线条
  createLines(camera) {
    this.lights.forEach((light, index) => {
      const lightPos = light.pointLight.position.clone()
      
      // 计算延伸方向：向右延伸到模型外
      // 假设模型中心在原点，计算到边缘的距离
      const modelRadius = 12  // 模型大致半径（根据你的户型图调整）
      
      // 计算从灯光位置向外延伸的方向
      const direction = new THREE.Vector3(1, 0, 0)  // 向右
      
      // 计算需要延伸多远才能到模型外
      const distanceToEdge = modelRadius - Math.abs(lightPos.x)
      const extensionLength = Math.max(distanceToEdge + 1, 1)  // 至少延伸1个单位
      
      const endPos = new THREE.Vector3(
        lightPos.x + extensionLength,
        lightPos.y,
        lightPos.z
      )

      // 创建线条
      const points = [lightPos, endPos]
      const geometry = new THREE.BufferGeometry().setFromPoints(points)
      const material = new THREE.LineBasicMaterial({
        color: light.config.color,
        transparent: true,
        opacity: 0.3,
        linewidth: 2
      })
      const line = new THREE.Line(geometry, material)
      this.scene.add(line)

      light.line = line
      light.lineEndPos = endPos  // 保存线条终点位置
      this.lines.push(line)
    })
  }

  // 创建控制面板 UI（独立按钮）
  createControlPanel() {
    this.lights.forEach((light, index) => {
      // 为每个灯光创建独立的按钮
      const button = document.createElement('div')
      button.className = 'tesla-switch-standalone'
      button.dataset.index = index
      button.style.position = 'fixed'
      button.style.zIndex = '100'
      
      button.innerHTML = `
        <div class="light-label">${light.name}</div>
        <div class="tesla-switch" data-index="${index}">
          <div class="tesla-switch-track">
            <div class="tesla-switch-thumb"></div>
          </div>
        </div>
      `
      
      document.body.appendChild(button)
      
      // 添加点击事件
      const switchElement = button.querySelector('.tesla-switch')
      switchElement.addEventListener('click', () => {
        this.toggleLight(index)
      })
      
      light.buttonElement = switchElement
      light.buttonContainer = button
      this.buttons.push(button)
    })
    
    // 初始化按钮位置
    this.updateButtonPositions()
  }

  // 更新按钮位置（根据灯光在屏幕上的投影）
  updateButtonPositions() {
    this.lights.forEach((light, index) => {
      if (!light.buttonContainer) return
      
      // 简单布局：右侧垂直排列
      const buttonHeight = 60
      const spacing = 10
      const startY = 100
      
      light.buttonContainer.style.right = '20px'
      light.buttonContainer.style.top = `${startY + index * (buttonHeight + spacing)}px`
    })
  }

  // 切换灯光状态
  toggleLight(index) {
    const light = this.lights[index]
    if (!light) return

    light.isOn = !light.isOn
    const isOn = light.isOn

    // 更新点光源
    light.pointLight.intensity = isOn ? light.config.intensity : 0

    // 更新标记点
    light.marker.material.opacity = isOn ? 1 : 0.5

    // 更新线条
    if (light.line) {
      light.line.material.opacity = isOn ? 0.8 : 0.3
    }

    // 更新按钮状态
    if (light.buttonElement) {
      if (isOn) {
        light.buttonElement.classList.add('active')
      } else {
        light.buttonElement.classList.remove('active')
      }
    }

    console.log(`💡 ${light.name}: ${isOn ? 'ON ☀️' : 'OFF'}`)
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

  // 更新线条位置（相机移动时）
  updateLines() {
    // 线条位置是固定的，不需要更新
  }

  // 清除所有
  clear() {
    this.lights.forEach(light => {
      this.scene.remove(light.pointLight)
      this.scene.remove(light.marker)
      if (light.line) {
        this.scene.remove(light.line)
      }
    })
    this.lights = []
    this.lines = []
    
    const panel = document.getElementById('tesla-control-panel')
    if (panel) {
      panel.remove()
    }
  }
}

export default TeslaStyleLightManager
