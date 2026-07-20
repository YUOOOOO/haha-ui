# Home Assistant 3D 户型图 - 使用说明

## 📝 配置步骤

### 1. 修改配置文件

编辑 `src/config/ha-config.js`：

```javascript
export const HA_CONFIG = {
  // 你的 Home Assistant 地址
  baseUrl: 'http://192.168.1.100:8123',  // 改成你的 HA 地址
  
  // 你的 Long-Lived Access Token
  token: 'eyJ0eXAiOiJKV1QiLCJhbGc...',  // 改成你的 Token
  
  // 灯光配置
  lights: [
    {
      entityId: 'light.living_room',      // 改成你的灯光实体ID
      position: { x: 5, y: 2, z: 3 },     // 根据户型图调整位置
      color: 0xffaa00,
      intensity: 2
    },
    // 添加更多灯光...
  ]
}
```

### 2. 获取 Long-Lived Access Token

1. 登录 Home Assistant
2. 点击左下角你的用户名
3. 滚动到底部 "Long-Lived Access Tokens"
4. 点击 "Create Token"
5. 输入名称（如 "3D Home UI"）
6. 复制生成的 token 到配置文件

### 3. 获取灯光实体 ID

在 Home Assistant 中：
1. 进入 开发者工具 -> 状态
2. 搜索 `light.`
3. 找到你的灯光设备，复制实体 ID（如 `light.living_room`）

### 4. 调整灯光位置

运行项目后，在浏览器控制台输入：

```javascript
// 显示点击位置的 3D 坐标
window.addEventListener('click', (e) => {
  console.log('点击位置:', e.clientX, e.clientY)
})
```

点击户型图上你想放灯的位置，记录坐标并更新配置文件。

## 🚀 运行项目

### 开发模式
```bash
npm run dev
```

访问 http://localhost:3000

### 生产构建
```bash
npm run build
```

## 🏠 在 Home Assistant 中使用

### 方法 1: 本地开发服务器

在 Home Assistant Dashboard 添加 Webpage Card：

```yaml
type: iframe
url: http://192.168.1.XXX:3000
aspect_ratio: 16:9
```

### 方法 2: 部署到 Home Assistant

1. 构建项目：
```bash
npm run build
```

2. 复制 `dist/` 目录到 Home Assistant 的 `config/www/3d-home/`

3. 在 Dashboard 中使用：
```yaml
type: iframe
url: /local/3d-home/index.html
aspect_ratio: 16:9
```

### 方法 3: 使用 Nginx/Apache

1. 构建项目并部署到 Web 服务器
2. 在 Dashboard 中使用：
```yaml
type: iframe
url: http://your-server/3d-home/
aspect_ratio: 16:9
```

## 💡 功能说明

- **点击灯泡** - 开关灯光
- **实时同步** - 通过 WebSocket 自动同步状态
- **鼠标控制**:
  - 左键拖动 - 旋转视角
  - 右键拖动 - 平移视角
  - 滚轮 - 缩放

## 🔧 配置示例

### 完整配置示例

```javascript
export const HA_CONFIG = {
  baseUrl: 'http://192.168.1.100:8123',
  token: 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  
  lights: [
    {
      entityId: 'light.living_room_main',
      position: { x: 5, y: 2.5, z: 3 },
      color: 0xffaa00,
      intensity: 2.5
    },
    {
      entityId: 'light.living_room_corner',
      position: { x: 7, y: 2, z: 5 },
      color: 0xffffff,
      intensity: 1.5
    },
    {
      entityId: 'light.bedroom',
      position: { x: -3, y: 2.5, z: 5 },
      color: 0xffddaa,
      intensity: 2
    },
    {
      entityId: 'light.kitchen',
      position: { x: 8, y: 2.5, z: -2 },
      color: 0xffffff,
      intensity: 3
    },
    {
      entityId: 'light.bathroom',
      position: { x: -5, y: 2.5, z: -4 },
      color: 0xffffff,
      intensity: 2
    }
  ]
}
```

## 🐛 故障排除

### 连接失败

检查：
- HA 地址是否正确（包括端口号）
- Token 是否有效
- 浏览器控制台的错误信息
- 网络连接是否正常

### 灯光不显示

检查：
- 实体 ID 是否正确
- 灯光位置是否在模型范围内
- 控制台是否有错误信息

### WebSocket 连接失败

- 系统会自动降级到轮询模式（每5秒更新一次）
- 检查 Home Assistant 的 WebSocket 配置

### CORS 错误

如果遇到跨域问题，在 Home Assistant 的 `configuration.yaml` 中添加：

```yaml
http:
  cors_allowed_origins:
    - http://localhost:3000
    - http://192.168.1.XXX:3000
```

## 📊 支持的功能

当前版本：
- ✅ 灯光开关控制
- ✅ 实时状态同步
- ✅ 点击交互
- ✅ WebSocket 连接
- ✅ 自动降级到轮询

未来计划：
- ⏳ 开关设备
- ⏳ 传感器显示
- ⏳ 空调控制
- ⏳ 窗帘控制
- ⏳ 自定义设备图标

## 🎨 自定义

### 修改灯光颜色

```javascript
color: 0xffaa00  // 橙黄色
color: 0xffffff  // 白色
color: 0xff0000  // 红色
```

### 修改灯光亮度

```javascript
intensity: 1    // 暗
intensity: 2    // 中等
intensity: 3    // 亮
```

### 修改灯光照射距离

```javascript
distance: 3     // 近
distance: 5     // 中等（默认）
distance: 10    // 远
```

## 📞 技术支持

如有问题，请检查：
1. 浏览器控制台的错误信息
2. Home Assistant 日志
3. 网络连接状态
