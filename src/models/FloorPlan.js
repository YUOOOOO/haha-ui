import * as THREE from 'three'

class FloorPlan {
  constructor(scene) {
    this.scene = scene
    this.rooms = []
    this.walls = []
    this.doors = []
    this.windows = []
  }

  // 创建完整房间（地板+墙+门+窗）
  createRoom(config) {
    const { name, width, depth, position, color, doors = [], windows = [] } = config
    const height = 2.8
    const thickness = 0.12
    
    const roomGroup = new THREE.Group()
    roomGroup.userData.name = name
    
    // 1. 创建地板
    const floorGeometry = new THREE.PlaneGeometry(width, depth)
    const floorMaterial = new THREE.MeshStandardMaterial({ 
      color,
      roughness: 0.9,
      side: THREE.DoubleSide
    })
    const floor = new THREE.Mesh(floorGeometry, floorMaterial)
    floor.rotation.x = -Math.PI / 2
    floor.receiveShadow = true
    roomGroup.add(floor)
    
    // 2. 创建四面墙
    const wallMaterial = new THREE.MeshStandardMaterial({ 
      color: 0xe8e8e8,
      roughness: 0.8
    })
    
    // 上墙（top, z负方向）
    const topWall = this.createWallWithOpenings(
      width, height, thickness,
      { x: 0, y: height/2, z: -depth/2 },
      0,
      windows.filter(w => w.position === 'top'),
      doors.filter(d => d.position === 'top'),
      wallMaterial
    )
    roomGroup.add(topWall)
    
    // 下墙（bottom, z正方向）
    const bottomWall = this.createWallWithOpenings(
      width, height, thickness,
      { x: 0, y: height/2, z: depth/2 },
      Math.PI,
      windows.filter(w => w.position === 'bottom'),
      doors.filter(d => d.position === 'bottom'),
      wallMaterial
    )
    roomGroup.add(bottomWall)
    
    // 左墙（left, x负方向）
    const leftWall = this.createWallWithOpenings(
      depth, height, thickness,
      { x: -width/2, y: height/2, z: 0 },
      Math.PI/2,
      windows.filter(w => w.position === 'left'),
      doors.filter(d => d.position === 'left'),
      wallMaterial
    )
    roomGroup.add(leftWall)
    
    // 右墙（right, x正方向）
    const rightWall = this.createWallWithOpenings(
      depth, height, thickness,
      { x: width/2, y: height/2, z: 0 },
      -Math.PI/2,
      windows.filter(w => w.position === 'right'),
      doors.filter(d => d.position === 'right'),
      wallMaterial
    )
    roomGroup.add(rightWall)
    
    roomGroup.position.set(position.x, 0, position.z)
    this.scene.add(roomGroup)
    this.rooms.push(roomGroup)
    
    return roomGroup
  }

  // 创建带开口的墙（门窗）
  createWallWithOpenings(width, height, thickness, position, rotation, windows, doors, material) {
    const wallGroup = new THREE.Group()
    
    // 收集所有开口
    const openings = []
    
    windows.forEach(w => {
      openings.push({
        type: 'window',
        offset: w.offset,
        width: w.width,
        height: w.height || 1.5,
        bottomY: w.bottomY || 1.0
      })
    })
    
    doors.forEach(d => {
      openings.push({
        type: 'door',
        offset: d.offset,
        width: d.width,
        height: d.height || 2.1,
        bottomY: 0,
        isOpen: d.type === 'open'
      })
    })
    
    // 如果没有开口，创建完整墙体
    if (openings.length === 0) {
      const geometry = new THREE.BoxGeometry(width, height, thickness)
      const mesh = new THREE.Mesh(geometry, material)
      mesh.castShadow = true
      mesh.receiveShadow = true
      wallGroup.add(mesh)
    } else {
      // 有开口时，分段创建墙体
      openings.sort((a, b) => a.offset - b.offset)
      
      let lastX = -width / 2
      
      openings.forEach(opening => {
        const openingLeft = opening.offset - opening.width / 2
        const openingRight = opening.offset + opening.width / 2
        
        // 开口左侧的墙
        if (openingLeft > lastX) {
          const segmentWidth = openingLeft - lastX
          const segmentGeometry = new THREE.BoxGeometry(segmentWidth, height, thickness)
          const segment = new THREE.Mesh(segmentGeometry, material)
          segment.position.x = (lastX + openingLeft) / 2
          segment.castShadow = true
          segment.receiveShadow = true
          wallGroup.add(segment)
        }
        
        // 开口上方的墙（如果不是大开门）
        if (!opening.isOpen && opening.bottomY + opening.height < height) {
          const topHeight = height - (opening.bottomY + opening.height)
          const topGeometry = new THREE.BoxGeometry(opening.width, topHeight, thickness)
          const topSegment = new THREE.Mesh(topGeometry, material)
          topSegment.position.x = opening.offset
          topSegment.position.y = (opening.bottomY + opening.height + height) / 2 - height / 2
          topSegment.castShadow = true
          topSegment.receiveShadow = true
          wallGroup.add(topSegment)
        }
        
        // 开口下方的墙
        if (opening.bottomY > 0) {
          const bottomHeight = opening.bottomY
          const bottomGeometry = new THREE.BoxGeometry(opening.width, bottomHeight, thickness)
          const bottomSegment = new THREE.Mesh(bottomGeometry, material)
          bottomSegment.position.x = opening.offset
          bottomSegment.position.y = bottomHeight / 2 - height / 2
          bottomSegment.castShadow = true
          bottomSegment.receiveShadow = true
          wallGroup.add(bottomSegment)
        }
        
        // 创建门窗框架
        if (opening.type === 'window') {
          this.addWindowFrame(wallGroup, opening, height, thickness)
        } else if (opening.type === 'door' && !opening.isOpen) {
          this.addDoorFrame(wallGroup, opening, height, thickness)
        }
        
        lastX = openingRight
      })
      
      // 最后一段墙
      if (lastX < width / 2) {
        const segmentWidth = width / 2 - lastX
        const segmentGeometry = new THREE.BoxGeometry(segmentWidth, height, thickness)
        const segment = new THREE.Mesh(segmentGeometry, material)
        segment.position.x = (lastX + width / 2) / 2
        segment.castShadow = true
        segment.receiveShadow = true
        wallGroup.add(segment)
      }
    }
    
    wallGroup.position.set(position.x, position.y, position.z)
    wallGroup.rotation.y = rotation
    
    return wallGroup
  }

  // 添加窗框
  addWindowFrame(parent, opening, wallHeight, thickness) {
    const frameGeometry = new THREE.BoxGeometry(opening.width, opening.height, 0.05)
    const frameMaterial = new THREE.MeshStandardMaterial({ color: 0xaaaaaa })
    const frame = new THREE.Mesh(frameGeometry, frameMaterial)
    frame.position.x = opening.offset
    frame.position.y = opening.bottomY + opening.height / 2 - wallHeight / 2
    frame.position.z = thickness / 2
    parent.add(frame)
    
    // 玻璃
    const glassGeometry = new THREE.BoxGeometry(opening.width - 0.05, opening.height - 0.05, 0.02)
    const glassMaterial = new THREE.MeshPhysicalMaterial({ 
      color: 0x88ccff,
      transparent: true,
      opacity: 0.3,
      roughness: 0.1
    })
    const glass = new THREE.Mesh(glassGeometry, glassMaterial)
    glass.position.x = opening.offset
    glass.position.y = opening.bottomY + opening.height / 2 - wallHeight / 2
    glass.position.z = thickness / 2
    parent.add(glass)
  }

  // 添加门框
  addDoorFrame(parent, opening, wallHeight, thickness) {
    const frameGeometry = new THREE.BoxGeometry(opening.width, opening.height, 0.05)
    const frameMaterial = new THREE.MeshStandardMaterial({ color: 0x8b7355 })
    const frame = new THREE.Mesh(frameGeometry, frameMaterial)
    frame.position.x = opening.offset
    frame.position.y = opening.height / 2 - wallHeight / 2
    frame.position.z = thickness / 2
    parent.add(frame)
  }

  // 清除所有元素
  clear() {
    [...this.rooms, ...this.walls, ...this.doors, ...this.windows].forEach(obj => {
      this.scene.remove(obj)
      obj.traverse(child => {
        if (child.geometry) child.geometry.dispose()
        if (child.material) child.material.dispose()
      })
    })
    
    this.rooms = []
    this.walls = []
    this.doors = []
    this.windows = []
  }
}

export default FloorPlan
