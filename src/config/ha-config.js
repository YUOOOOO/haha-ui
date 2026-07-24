// 数据源：mijia（默认）| ha（已禁用页面配置，仅 ?backend=ha 调试）
// 米家桥：Vite 代理 /mijia → :8787
export const HA_CONFIG = {
  baseUrl: '',
  token: (typeof import.meta !== 'undefined' && import.meta.env?.VITE_HASS_TOKEN) || '',
  // 默认米家；HA 配置入口已从页面移除
  backend:
    (typeof import.meta !== 'undefined' && import.meta.env?.VITE_BACKEND) || 'mijia'
}

/**
 * 解析连接配置
 * 默认 backend=mijia；HA 仅在 URL 显式 ?backend=ha 时启用（调试，页面不展示）
 */
export function resolveHaConfig() {
  let token = ''
  let baseUrl = HA_CONFIG.baseUrl || ''
  let backend = 'mijia'
  let mijiaBase = ''

  try {
    const params = new URLSearchParams(window.location.search)
    const be = (params.get('backend') || params.get('source') || '').toLowerCase()
    if (be === 'ha') {
      backend = 'ha'
      try {
        sessionStorage.setItem('ha-homeui-backend', 'ha')
      } catch (_) {}
    } else if (be === 'mijia' || be === 'mi') {
      backend = 'mijia'
      try {
        sessionStorage.setItem('ha-homeui-backend', 'mijia')
      } catch (_) {}
    } else {
      // 无参数：强制米家，清掉旧的 ha session
      try {
        sessionStorage.setItem('ha-homeui-backend', 'mijia')
      } catch (_) {}
      backend = 'mijia'
    }

    // 仅 HA 调试需要 token
    if (backend === 'ha') {
      const fromQuery = params.get('token') || params.get('access_token') || ''
      if (fromQuery && fromQuery.length > 20 && !fromQuery.includes('...')) {
        token = fromQuery
        sessionStorage.setItem('ha-homeui-token', token)
        params.delete('token')
        params.delete('access_token')
        const q = params.toString()
        const clean = window.location.pathname + (q ? `?${q}` : '') + window.location.hash
        window.history.replaceState({}, '', clean)
      }
    }
  } catch (_) {}

  if (backend === 'ha') {
    if (!token) {
      try {
        token = sessionStorage.getItem('ha-homeui-token') || ''
      } catch (_) {}
    }
    if (!token) {
      try {
        const stored = localStorage.getItem('ha-homeui-settings')
        if (stored) {
          const parsed = JSON.parse(stored)
          const t = parsed?.homeAssistant?.token || ''
          if (t && t.length > 20 && !t.includes('...')) token = t
          const b = parsed?.homeAssistant?.baseUrl || ''
          if (b && !baseUrl) baseUrl = b
        }
      } catch (_) {}
    }
    if (!token && HA_CONFIG.token) token = HA_CONFIG.token
    try {
      const rt = typeof window !== 'undefined' ? window.HA_HOMEUI_RUNTIME : null
      if (rt && typeof rt === 'object') {
        if (!token && rt.token) token = String(rt.token)
        if (!baseUrl && rt.baseUrl) baseUrl = String(rt.baseUrl)
      }
    } catch (_) {}
  } else {
    token = 'mijia'
    try {
      const rt = typeof window !== 'undefined' ? window.HA_HOMEUI_RUNTIME : null
      if (rt && typeof rt === 'object' && rt.mijiaBase) mijiaBase = String(rt.mijiaBase)
    } catch (_) {}
  }

  return { baseUrl, token, backend, mijiaBase }
}
