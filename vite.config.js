import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  // 部署到 HA /local/3d-home/ 时用相对资源路径
  base: './',
  server: {
    host: '0.0.0.0',
    port: 3010,
    open: false,
    allowedHosts: true,
    proxy: {
      // 开发走局域网 HA，更稳；公网可改 https://ha.yuchaoqun.com
      '/api': {
        target: 'http://10.10.10.202:8123',
        changeOrigin: true,
        secure: false,
        ws: true
      },
      // mijiaAPI 本地桥（见 /tmp/ha-homeui/mijia-bridge）
      '/mijia': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
        secure: false,
        ws: true,
        rewrite: (path) => path.replace(/^\/mijia/, '')
      }
    }
  },
  preview: {
    host: '0.0.0.0',
    port: 3010,
    allowedHosts: true
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html')
      }
    }
  }
})
