import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

class ModelLoader {
  constructor() {
    this.loader = new GLTFLoader()
    this.cache = new Map()
  }

  // 加载 GLB/GLTF 模型
  async load(url, options = {}) {
    const {
      onProgress = null,
      enableShadows = true,
      scale = 1,
      position = { x: 0, y: 0, z: 0 },
      rotation = { x: 0, y: 0, z: 0 }
    } = options

    // 检查缓存
    if (this.cache.has(url)) {
      console.log(`从缓存加载模型: ${url}`)
      return this.cache.get(url).scene.clone()
    }

    return new Promise((resolve, reject) => {
      this.loader.load(
        url,
        (gltf) => {
          console.log(`模型加载成功: ${url}`)
          
          const model = gltf.scene
          
          // 设置阴影
          if (enableShadows) {
            model.traverse((child) => {
              if (child.isMesh) {
                child.castShadow = true
                child.receiveShadow = true
              }
            })
          }
          
          // 设置缩放
          if (scale !== 1) {
            model.scale.set(scale, scale, scale)
          }
          
          // 设置位置
          model.position.set(position.x, position.y, position.z)
          
          // 设置旋转
          model.rotation.set(rotation.x, rotation.y, rotation.z)
          
          // 缓存模型
          this.cache.set(url, gltf)
          
          resolve({
            model,
            animations: gltf.animations,
            scene: gltf.scene,
            cameras: gltf.cameras,
            asset: gltf.asset
          })
        },
        (progress) => {
          if (onProgress) {
            const percentComplete = (progress.loaded / progress.total) * 100
            onProgress(percentComplete, progress)
          }
        },
        (error) => {
          console.error(`模型加载失败: ${url}`, error)
          reject(error)
        }
      )
    })
  }

  // 清除缓存
  clearCache() {
    this.cache.clear()
  }

  // 获取缓存的模型
  getCached(url) {
    return this.cache.get(url)
  }
}

export default ModelLoader
