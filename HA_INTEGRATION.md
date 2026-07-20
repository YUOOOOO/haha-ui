# Home Assistant 集成说明

## 🏠 在 Home Assistant 中使用

### 方法 1: Webpage Card（推荐）

在 Home Assistant Dashboard 中添加 Webpage Card：

```yaml
type: iframe
url: http://YOUR_SERVER:3000?ha_url=http://homeassistant.local:8123&ha_token=YOUR_TOKEN
aspect_ratio: 16:9
```

**参数说明：**
- `ha_url`: Home Assistant 服务器地址
- `ha_token`: Long-Lived Access Token

### 方法 2: 手动配置

1. 访问 http://localhost:3000
2. 点击右上角 "⚙️ 配置" 按钮
3. 输入 Home Assistant 地址和访问令牌
4. 点击"连接"

## 🔑 获取 Long-Lived Access Token

1. 登录 Home Assistant
2. 点击左下角用户名
3. 滚动到底部 "Long-Lived Access Tokens"
4. 点击 "Create Token"
5. 输入名称（如 "3D Home UI"）
6. 复制生成的 token

## 💡 功能说明

### 灯光控制
- **点击灯泡** - 开关灯光
- **实时同步** - 通过 WebSocket 实时同步状态
- **左侧面板** - 显示所有灯光设备列表

### 灯光位置配置

默认灯光位置在 `src/main.js` 的 `setupLights()` 方法中：

```javascript
const lightPositions = [
  { x: 5, y: 2, z: 3 },   // 客厅
  { x: -3, y: 2, z: 5 },  // 卧室
  { x: 8, y: 2, z: -2 },  // 厨房
  { x: -5, y: 2, z: -4 }  // 卫生间
]
```

**根据你的户型图调整这些坐标！**

### 如何找到正确的灯光位置？

1. 在浏览器控制台运行：
```javascript
// 显示鼠标点击位置的坐标
window.addEventListener('click', (e) => {
  const rect = canvas.getBoundingClientRect()
  const x = ((e.clientX - rect.left) / rect.width) * 2 - 1
  const y = -((e.clientY - rect.top) / rect.height) * 2 + 1
  console.log('点击位置:', { x, y })
})
```

2. 点击户型图上你想放灯的位置
3. 记录坐标并更新 `lightPositions`

## 🎮 交互说明

- **鼠标左键拖动** - 旋转视角
- **鼠标右键拖动** - 平移视角
- **鼠标滚轮** - 缩放
- **点击灯泡** - 开关灯光

## 🔧 高级配置

### 自定义灯光颜色

在 `addLight()` 调用中修改：

```javascript
this.lightManager.addLight(light.entity_id, pos, {
  name: light.attributes.friendly_name,
  color: 0xffaa00,      // 灯光颜色（橙黄色）
  intensity: 2,         // 亮度
  distance: 5           // 照射距离
})
```

### 根据灯光类型设置不同颜色

```javascript
const color = light.attributes.rgb_color 
  ? rgbToHex(light.attributes.rgb_color) 
  : 0xffaa00
```

## 📝 Home Assistant 配置示例

### 完整的 Dashboard 配置

```yaml
views:
  - title: 3D 户型图
    path: 3d-home
    cards:
      - type: iframe
        url: http://192.168.1.100:3000?ha_url=http://homeassistant.local:8123&ha_token=YOUR_LONG_LIVED_TOKEN
        aspect_ratio: 16:9
```

### 使用 Secrets

在 `secrets.yaml` 中：
```yaml
ha_3d_token: eyJ0eXAiOiJKV1QiLCJhbGc...
```

在 Dashboard 中：
```yaml
url: http://192.168.1.100:3000?ha_url=http://homeassistant.local:8123&ha_token=!secret ha_3d_token
```

## 🚀 部署

### 开发模式
```bash
npm run dev
```

### 生产构建
```bash
npm run build
```

构建后的文件在 `dist/` 目录，可以部署到：
- Nginx
- Apache
- Home Assistant 的 `www` 目录
- 任何静态文件服务器

### 部署到 Home Assistant

1. 构建项目：
```bash
npm run build
```

2. 复制 `dist/` 目录到 Home Assistant 的 `config/www/3d-home/`

3. 在 Dashboard 中使用：
```yaml
type: iframe
url: /local/3d-home/index.html?ha_url=http://homeassistant.local:8123&ha_token=YOUR_TOKEN
aspect_ratio: 16:9
```

## 🐛 故障排除

### 连接失败
- 检查 Home Assistant 地址是否正确
- 检查 Token 是否有效
- 检查浏览器控制台的错误信息

### 灯光不显示
- 确保 Home Assistant 中有 `light.*` 实体
- 检查灯光位置坐标是否在模型范围内
- 查看控制台日志

### WebSocket 连接失败
- 系统会自动降级到轮询模式
- 检查 Home Assistant 的 WebSocket 配置

## 📊 支持的设备类型

当前版本支持：
- ✅ `light.*` - 灯光设备

未来计划支持：
- ⏳ `switch.*` - 开关
- ⏳ `sensor.*` - 传感器
- ⏳ `climate.*` - 空调/暖气
- ⏳ `cover.*` - 窗帘/百叶窗
