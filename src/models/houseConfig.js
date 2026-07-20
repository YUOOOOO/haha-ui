// 简化的户型配置
export const houseConfig = {
  wallHeight: 2.8,
  
  rooms: [
    // 客厅
    {
      name: '客厅',
      width: 4.5,
      depth: 4.0,
      position: { x: -4.5, z: 0 },
      color: 0xf5f5dc,
      windows: [
        {
          position: 'left',
          offset: 0,
          width: 2.0,
          height: 1.5,
          bottomY: 1.0
        }
      ]
    },
    // 卧室
    {
      name: '卧室',
      width: 3.5,
      depth: 4.0,
      position: { x: 0, z: 0 },
      color: 0xffe4e1,
      doors: [
        {
          type: 'normal',
          position: 'left',
          offset: 0,
          width: 0.9,
          height: 2.1
        }
      ],
      windows: [
        {
          position: 'top',
          offset: 0,
          width: 1.5,
          height: 1.5,
          bottomY: 1.0
        }
      ]
    },
    // 卫生间
    {
      name: '卫生间',
      width: 2.0,
      depth: 4.0,
      position: { x: 3.5, z: 0 },
      color: 0xe0ffff,
      doors: [
        {
          type: 'normal',
          position: 'left',
          offset: 0,
          width: 0.8,
          height: 2.1
        }
      ]
    }
  ]
}
