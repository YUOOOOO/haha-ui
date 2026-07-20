import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 3010,
    open: false,
    // 允许 FRP 域名 / 任意 Host 访问（否则外网会 403 Blocked request）
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'https://ha.yuchaoqun.com',
        changeOrigin: true,
        secure: true,
        ws: true
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
        main: resolve(__dirname, 'index.html'),
        settings: resolve(__dirname, 'settings.html')
      }
    }
  }
})
