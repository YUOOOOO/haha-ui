import * as THREE from 'three'
import FloorPlan from '../models/FloorPlan.js'
import { houseConfig } from '../models/houseConfig.js'
import ModelLoader from '../loaders/ModelLoader.js'

class SceneManager {
  constructor(scene) {
    this.scene = scene
    this.objects = []
    this.floorPlan = new FloorPlan(scene)
    this.modelLoader = new ModelLoader()
    this.houseModel = null
    
    // 不在构造函数中调用 init，由外部显式调用
  }

  async init() {
    console.log('🚀 SceneManager.init() 开始')
    this.createBaseFloor()
    this.createGrid()
    
    // 加载 GLB 户型图模型
    console.log('📦 准备加载 GLB 模型...')
    const modelInfo = await this.loadHouseModel()
    
    // 如果模型加载成功，返回模型信息用于调整相机
    if (modelInfo) {
      console.log('✅ SceneManager.init() 完成，返回模型信息')
      return modelInfo
    }
    
    console.log('✅ SceneManager.init() 完成')
    return null
  }

  // 创建基础地板
  createBaseFloor() {
    const geometry = new THREE.PlaneGeometry(50, 50)
    const material = new THREE.MeshStandardMaterial({ 
      color: 0x2a2a2a,
      roughness: 0.8,
      metalness: 0.2
    })
    const floor = new THREE.Mesh(geometry, material)
    floor.rotation.x = -Math.PI / 2
    floor.position.y = -0.01
    floor.receiveShadow = true
    this.scene.add(floor)
  }

  // 创建网格辅助线
  createGrid() {
    const gridHelper = new THREE.GridHelper(50, 50, 0x444444, 0x333333)
    this.scene.add(gridHelper)
  }

  // 加载 GLB 户型图模型
  async loadHouseModel() {
    try {
      console.log('开始加载户型图模型...')
      
      const result = await this.modelLoader.load(new URL('./models/huxingtu.glb', window.location.href).href, {
        enableShadows: true,
        scale: 10,  // 放大 10 倍
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        onProgress: (percent) => {
          console.log(`加载进度: ${percent.toFixed(1)}%`)
        }
      })
      
      this.houseModel = result.model
      
      // 确保材质正确显示
      this.houseModel.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true
          child.receiveShadow = true
          
          // 确保材质正确设置
          if (child.material) {
            child.material.needsUpdate = true
          }
        }
      })
      
      this.scene.add(this.houseModel)
      
      console.log('✅ 户型图模型加载成功')
      console.log('模型信息:', {
        animations: result.animations.length,
        cameras: result.cameras.length
      })
      
      // 计算模型边界，用于调整相机
      const box = new THREE.Box3().setFromObject(this.houseModel)
      const size = box.getSize(new THREE.Vector3())
      const center = box.getCenter(new THREE.Vector3())
      
      console.log('模型尺寸:', {
        width: size.x.toFixed(2),
        height: size.y.toFixed(2),
        depth: size.z.toFixed(2),
        center: {
          x: center.x.toFixed(2),
          y: center.y.toFixed(2),
          z: center.z.toFixed(2)
        }
      })
      
      // 返回模型信息，用于调整相机
      return { size, center }
      
    } catch (error) {
      console.error('❌ 户型图模型加载失败:', error)
      // 如果加载失败，回退到程序化生成
      console.log('回退到程序化生成房间...')
      this.buildHouse()
      return null
    }
  }

  // 根据配置构建房屋（程序化生成，作为备用方案）
  buildHouse() {
    const config = houseConfig
    
    // 创建每个房间
    config.rooms.forEach(room => {
      this.floorPlan.createRoom(room)
    })
  }



  // 更新场景
  update() {
    // 动画更新逻辑
  }

  // 清除所有对象
  clear() {
    this.floorPlan.clear()
    this.objects.forEach(obj => {
      this.scene.remove(obj)
    })
    this.objects = []
  }
}

export default SceneManager
