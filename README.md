# HA Home UI

基于 Three.js 和 Home Assistant API 实现的 3D 户型图可视化系统。

## 功能特性

- 🏠 3D 户型图展示
- 🔌 Home Assistant 设备集成
- 🎮 交互式场景控制
- 📱 实时状态同步
- 🎨 自定义场景编辑

## 技术栈

- **Three.js** - 3D 渲染引擎
- **Home Assistant API** - 智能家居设备控制
- **Vite** - 构建工具

## 项目结构

```
ha-homeui/
├── src/
│   ├── main.js              # 应用入口
│   ├── scene/               # 场景管理
│   │   └── SceneManager.js  # 场景管理器
│   ├── models/              # 3D 模型
│   ├── api/                 # API 接口
│   │   └── HAClient.js      # Home Assistant 客户端
│   ├── utils/               # 工具函数
│   │   └── helpers.js       # 辅助函数
│   └── components/          # 组件
├── public/                  # 静态资源
├── index.html              # HTML 入口
└── package.json            # 项目配置
```

## 快速开始

### 安装依赖

```bash
npm install
```

### 开发模式

```bash
npm run dev
```

### 构建生产版本

```bash
npm run build
```

### 预览生产版本

```bash
npm run preview
```

## Home Assistant 配置

在使用前需要配置 Home Assistant 连接信息：

```javascript
const haClient = new HAClient({
  baseUrl: 'http://homeassistant.local:8123',
  token: 'YOUR_LONG_LIVED_ACCESS_TOKEN'
})
```

### 获取 Long-Lived Access Token

1. 登录 Home Assistant
2. 点击左下角用户名
3. 滚动到底部 "Long-Lived Access Tokens"
4. 点击 "Create Token"
5. 复制生成的 token

## 开发计划

- [ ] 基础 3D 场景搭建
- [ ] 户型图编辑器
- [ ] Home Assistant 设备映射
- [ ] 设备状态可视化
- [ ] 设备控制交互
- [ ] 场景配置保存/加载
- [ ] 多楼层支持
- [ ] 移动端适配

## License

MIT
