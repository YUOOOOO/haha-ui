# CORS 跨域问题解决方案

## 问题
浏览器阻止了从 `http://localhost:3000` 访问 `http://ha.yuchaoqun.com:8123` 的请求。

## 解决方案

### 方法 1: 配置 Home Assistant CORS（推荐）

编辑 Home Assistant 的 `configuration.yaml` 文件：

```yaml
http:
  cors_allowed_origins:
    - http://localhost:3000
    - http://127.0.0.1:3000
    - http://ha.yuchaoqun.com:8123
  use_x_forwarded_for: true
  trusted_proxies:
    - 127.0.0.1
```

然后重启 Home Assistant。

### 方法 2: 使用 HTTPS（如果你的 HA 支持）

修改 `src/config/ha-config.js`：
```javascript
baseUrl: 'https://ha.yuchaoqun.com:8123'  // 改为 https
```

### 方法 3: 部署到 Home Assistant 的 www 目录

1. 构建项目：
```bash
npm run build
```

2. 复制 `dist/` 目录到 Home Assistant 的 `config/www/3d-home/`

3. 访问：`http://ha.yuchaoqun.com:8123/local/3d-home/index.html`

这样就不会有跨域问题，因为是同源访问。

### 方法 4: 开发时使用代理

修改 `vite.config.js`：
```javascript
import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    port: 3000,
    open: true,
    proxy: {
      '/api': {
        target: 'http://ha.yuchaoqun.com:8123',
        changeOrigin: true
      }
    }
  }
})
```

然后修改 `src/config/ha-config.js`：
```javascript
baseUrl: ''  // 使用相对路径，通过代理访问
```

## 推荐方案

**开发阶段**: 使用方法 4（Vite 代理）
**生产部署**: 使用方法 3（部署到 HA 的 www 目录）

这样既方便开发，又不会有跨域问题。
