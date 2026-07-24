/**
 * 左右布局外壳：
 * 左栏 = 时间/日期/天气/环境
 * 右栏 Banner 首页 = 平面图 7 | 控制 3
 * 菜单：首页 / 日志 / 设置（非首页隐藏左栏，仅留齿轮）
 *
 * 注意：切页禁止 window.dispatchEvent('resize')，避免 3D resize 连环卡死。
 */
import { LIGHTS, ENV_METRICS, WEATHER_ENTITY, SCENES, WEEKDAYS, WEATHER_ICON } from '../config/panel-config.js'
import { genieCollapse, genieExpand } from './genieEffect.js'

export class DashboardShell {
  constructor({ haClient, lightManager, onViewChange, backend } = {}) {
    this.ha = haClient
    this.lightManager = lightManager
    this.onViewChange = typeof onViewChange === 'function' ? onViewChange : null
    this.backend = backend === 'mijia' ? 'mijia' : 'ha'
    this._clockTimer = null
    this._unsub = null
    this._modalEl = null
    this._modalKeyHandler = null
    this._bannerPage = 0
    this._bannerTrack = null
    this._bannerViewport = null
    this._bannerDots = []
    this._currentView = 'home'
    this._logs = []
    this._menuOpen = false
    this._onDocClick = null
    this._onMenuKey = null
    this._onBannerResize = null
    this._switching = false
    this._drawerOpen = false
    this._unsubConn = null
    this._lastConnLog = ''
    this._entityNameMap = null
    this._logSeen = new Set() // 去重 key
    this._logbookLoaded = false
    this._devFilter = 'all'
    this._devSearch = ''
    this._devBound = false
  }

  _buildEntityNameMap() {
    if (this._entityNameMap) return this._entityNameMap
    const map = new Map()
    for (const l of LIGHTS) map.set(l.entity_id, l.name)
    for (const s of SCENES) {
      for (const id of s.entities || []) {
        if (!map.has(id)) {
          // 场景实体：用场景名作后缀提示
          map.set(id, id.split('.').pop() || id)
        }
      }
    }
    this._entityNameMap = map
    return map
  }

  _entityLabel(entityId) {
    if (!entityId) return '未知设备'
    const map = this._buildEntityNameMap()
    if (map.has(entityId)) return map.get(entityId)
    const st = this.ha?.getState?.(entityId)
    const fn = st?.attributes?.friendly_name
    if (fn) return fn
    return entityId
  }

  _stateLabel(domain, state) {
    if (state == null || state === '') return '—'
    if (domain === 'light' || domain === 'switch') {
      if (state === 'on') return '开'
      if (state === 'off') return '关'
    }
    if (domain === 'cover') {
      if (state === 'open' || state === 'opening') return '开'
      if (state === 'closed' || state === 'closing') return '关'
    }
    if (domain === 'climate') {
      if (state === 'off') return '关'
      if (state === 'cool') return '制冷'
      if (state === 'heat') return '制热'
      if (state === 'auto') return '自动'
      if (state === 'fan_only') return '送风'
      if (state === 'dry') return '除湿'
    }
    if (domain === 'media_player') {
      if (state === 'playing') return '播放'
      if (state === 'paused') return '暂停'
      if (state === 'idle' || state === 'off') return '停止'
    }
    return String(state)
  }

  /** 是否值得记入操作日志的实体状态变化 */
  _isActionEntity(entityId) {
    if (!entityId) return false
    return (
      entityId.startsWith('light.') ||
      entityId.startsWith('switch.') ||
      entityId.startsWith('climate.') ||
      entityId.startsWith('cover.') ||
      entityId.startsWith('media_player.') ||
      entityId.startsWith('scene.') ||
      entityId.startsWith('script.') ||
      entityId.startsWith('input_boolean.')
    )
  }

  /** WebSocket state_changed → 操作日志 */
  _logFromWsState(entityId, newState, oldState) {
    if (!entityId || !this._isActionEntity(entityId)) return
    const ns = newState?.state
    const os = oldState?.state
    if (ns == null) return
    // 首次灌入 / 无 old / 状态相同：不记
    if (os == null || os === ns) return
    // unavailable 抖动忽略
    if (ns === 'unavailable' || ns === 'unknown' || os === 'unavailable' || os === 'unknown') return

    const domain = entityId.split('.')[0]
    const name = this._entityLabel(entityId)
    const from = this._stateLabel(domain, os)
    const to = this._stateLabel(domain, ns)
    const msg = `WS · ${name} ${from} → ${to}`
    // 去重：同一实体同一变化 1.5s 内只记一次
    const key = `${entityId}|${os}|${ns}`
    if (this._logSeen.has(key)) return
    this._logSeen.add(key)
    setTimeout(() => this._logSeen.delete(key), 1500)
    this._pushLog(msg, { source: 'ws' })
  }

  /** 连接成功后，经 WS 拉近期 Logbook 填进日志页 */
  async _loadLogbookHistory() {
    if (this._logbookLoaded || !this.ha?.getLogbookEvents) return
    this._logbookLoaded = true
    try {
      const watchIds = [
        ...LIGHTS.map((l) => l.entity_id),
        ...SCENES.flatMap((s) => s.entities || [])
      ].filter(Boolean)
      // 去重
      const entityIds = [...new Set(watchIds)]
      const events = await this.ha.getLogbookEvents({
        startTime: new Date(Date.now() - 6 * 3600 * 1000).toISOString(),
        entityIds: entityIds.length ? entityIds : undefined
      })
      if (!events?.length) {
        this._pushLog('WS · 已订阅实时状态（近 6h Logbook 无记录或接口不可用）', { source: 'ws' })
        return
      }
      // HA logbook 通常时间升序，倒序插入
      const parsed = []
      for (const ev of events) {
        const entityId = ev.entity_id
        if (!entityId || !this._isActionEntity(entityId)) continue
        const name = ev.name || this._entityLabel(entityId)
        const state = ev.state != null ? String(ev.state) : ''
        const domain = entityId.split('.')[0]
        const to = this._stateLabel(domain, state)
        const when = ev.when || ev.timestamp || ev.time || null
        const msg = state ? `WS · ${name} → ${to}` : `WS · ${name}${ev.message ? ' · ' + ev.message : ''}`
        parsed.push({ when, msg })
      }
      // 最近 40 条：按时间升序 unshift → 列表最新在前
      const recent = parsed
        .map((p) => ({
          ...p,
          ts: p.when ? new Date(p.when).getTime() : 0
        }))
        .sort((a, b) => a.ts - b.ts)
        .slice(-40)
      for (const item of recent) {
        this._pushLog(item.msg, {
          source: 'ws',
          time: item.when ? this._formatLogTime(item.when) : null
        })
      }
      this._pushLog(`WS · 已载入 Logbook ${recent.length} 条`, { source: 'ws' })
      if (this._currentView === 'logs') this._renderLogs()
    } catch (e) {
      console.warn('load logbook', e)
      this._pushLog('WS · Logbook 拉取失败，仅显示实时事件', { source: 'ws' })
    }
  }

  _formatLogTime(input) {
    try {
      const d = input instanceof Date ? input : new Date(input)
      if (Number.isNaN(d.getTime())) return null
      const hh = String(d.getHours()).padStart(2, '0')
      const mm = String(d.getMinutes()).padStart(2, '0')
      const ss = String(d.getSeconds()).padStart(2, '0')
      return `${hh}:${mm}:${ss}`
    } catch {
      return null
    }
  }

  mount() {
    const app = document.getElementById('app')
    if (!app) return

    const canvas = document.getElementById('canvas-container')
    const loading = document.getElementById('loading')
    const hint = document.getElementById('ha-link-hint')
    const topBar = document.getElementById('top-bar')
    if (topBar) topBar.style.display = 'none'
    if (hint) hint.style.display = 'none'

    app.innerHTML = ''
    app.classList.add('panel-root')

    const shell = document.createElement('div')
    shell.className = 'panel-shell view-home'
    shell.innerHTML = `
      <aside class="panel-left" aria-label="信息栏">
        <!-- 参考图：时间大号 → 天气(图标+温度) → 日期 -->
        <div class="left-hero" id="panel-hero">
          <div class="left-clock" id="panel-clock" role="button" tabindex="0" title="查看时间与日期">
            <div class="left-time-row">
              <span class="left-time" id="panel-time">--:--</span>
              <span class="left-period" id="panel-period">--</span>
            </div>
            <div class="left-weather-inline" id="panel-weather" role="button" tabindex="0" title="查看天气">
              <span class="wx-icon" id="wx-icon">⛅</span>
              <span class="wx-temp" id="wx-temp">--°C</span>
              <span class="wx-cond" id="wx-cond"></span>
            </div>
            <div class="left-date" id="panel-date">----</div>
          </div>
          <div class="wx-forecast" id="wx-forecast"></div>
        </div>
        <div class="left-env" id="panel-env"></div>
        <!-- 连接状态仅给 JS 写设置页用，页面不展示 -->
        <div id="panel-status" class="sr-only" aria-hidden="true"></div>
        <div id="panel-status-menu" class="sr-only" aria-hidden="true"></div>
      </aside>
      <section class="panel-banner" aria-label="Banner 主区域" id="panel-banner">
        <div class="view-pane active" id="view-home" data-view="home">
          <div class="banner-viewport" id="banner-viewport">
            <div class="banner-track" id="banner-track">
              <div class="banner-page" data-page="0" aria-label="主页">
                <div class="home-hero-layout">
                  <div class="home-visual">
                    <div class="plan-stage" id="plan-stage"></div>
                  </div>
                  <nav class="right-menu" id="right-menu" aria-label="右侧菜单">
                    <button type="button" class="right-menu-item active" data-view="home" title="首页" aria-label="首页">🏠</button>
                    <button type="button" class="right-menu-item" data-view="devices" title="设备" aria-label="设备">🔌</button>
                    <button type="button" class="right-menu-item" data-view="logs" title="日志" aria-label="日志">📋</button>
                    <button type="button" class="right-menu-item" data-view="settings" title="设置" aria-label="设置">⚙</button>
                  </nav>
                </div>
                <div class="home-bottom">
                  <div class="ctrl-scenes" id="ctrl-scenes"></div>
                </div>
                <div class="ctrl-lights" id="ctrl-lights" hidden></div>
              </div>
            </div>
          </div>
          <div class="banner-dots" id="banner-dots" role="tablist" aria-label="Banner 分页">
            <button type="button" class="banner-dot active" data-page="0" role="tab" aria-label="主页" aria-selected="true"></button>
          </div>
        </div>
      </section>
    `
    app.appendChild(shell)

    // 抽屉挂到 body：纯浮层 + Genie 开合，不进首页 flex
    const drawer = document.createElement('div')
    drawer.className = 'drawer-root'
    drawer.id = 'drawer-root'
    drawer.setAttribute('aria-hidden', 'true')
    drawer.innerHTML = `
      <div class="drawer-mask" id="drawer-mask"></div>
      <aside class="drawer-panel genie-docked" id="drawer-panel" role="dialog" aria-modal="true" aria-label="功能抽屉">
        <button type="button" class="drawer-close" id="drawer-close" title="关闭" aria-label="关闭">✕</button>
        <div class="drawer-body">
          <div class="view-pane view-log drawer-view" id="view-logs" data-view="logs" inert>
            <div class="view-head">日志</div>
            <div class="log-list" id="log-list"><div class="log-empty">暂无操作记录</div></div>
          </div>
          <div class="view-pane view-devices drawer-view" id="view-devices" data-view="devices" inert>
            <div class="view-head">设备 <span class="view-head-sub">仅实体设备</span></div>
            <div class="dev-toolbar">
              <input type="search" class="dev-search" id="dev-search" placeholder="搜索设备…" autocomplete="off" enterkeyhint="search" />
              <div class="dev-meta" id="dev-meta">—</div>
            </div>
            <div class="dev-filters" id="dev-filters" role="tablist" aria-label="设备分类"></div>
            <div class="dev-list" id="dev-list"><div class="log-empty">连接米家后加载设备</div></div>
          </div>
          <div class="view-pane view-settings drawer-view" id="view-settings" data-view="settings" inert>
            <div class="view-head">设置</div>
            <div class="settings-group">
              <div class="settings-label">连接</div>
              <div class="settings-row"><span>数据源</span><span id="set-backend">米家</span></div>
              <div class="settings-row"><span>米家桥</span><span id="set-mijia-state">—</span></div>
            </div>
            <div class="settings-group" id="mijia-login-group">
              <div class="settings-label">米家登录</div>
              <div class="settings-row">
                <span>扫码登录</span>
                <button type="button" id="btn-mijia-qr">获取二维码</button>
              </div>
              <div id="mijia-qr-box" class="settings-hint" style="display:none;word-break:break-all"></div>
              <div class="settings-row">
                <span>刷新设备</span>
                <button type="button" id="btn-mijia-refresh">刷新</button>
              </div>
              <div class="settings-hint">本机 mijia-bridge（:8787）。凭证保存在服务器，页面不保存小米账号。</div>
            </div>
            <div class="settings-group">
              <div class="settings-label">界面</div>
              <div class="settings-row">
                <span>当前页面</span>
                <span id="set-current-view">首页</span>
              </div>
              <div class="settings-row">
                <span>清空日志</span>
                <button type="button" id="btn-clear-logs">清空</button>
              </div>
            </div>
            <div class="settings-hint">3D 仅展示；设备控制走米家云接口。</div>
          </div>
        </div>
      </aside>
    `
    document.body.appendChild(drawer)

    const stage = shell.querySelector('#plan-stage')
    if (canvas) stage.appendChild(canvas)
    if (loading) stage.appendChild(loading)

    this._bindBanner(shell)
    this._bindRightMenu(shell)
    this._bindDrawer(shell)
    this._renderEnv()
    this._renderLights()
    this._renderScenes()
    this._bindInfoClicks()
    this._bindSettings()
    this._bindDevices()
    this._tickClock()
    this._clockTimer = setInterval(() => this._tickClock(), 1000)

    if (this.ha) {
      this._unsub = this.ha.onStateChange((entityId, state, _cache, oldState) => {
        if (
          !entityId ||
          entityId.startsWith('light.') ||
          entityId === WEATHER_ENTITY ||
          entityId === 'sun.sun' ||
          entityId.startsWith('sensor.') ||
          entityId.startsWith('weather.')
        ) {
          this._refreshFromCache()
          if (!entityId || entityId === 'sun.sun') this._tickClock()
        }
        if (entityId?.startsWith('light.') && this.lightManager) {
          const st = state || this.ha.getState(entityId)
          if (st) this.lightManager.updateByEntityId(entityId, st.state, st)
        }
        // 操作日志：来自 WebSocket state_changed
        if (entityId && oldState) {
          this._logFromWsState(entityId, state, oldState)
        }
        // 设备页实时刷新（节流，避免 state 风暴卡死）
        if (this._currentView === 'devices') {
          clearTimeout(this._devRefreshTimer)
          this._devRefreshTimer = setTimeout(() => this._renderDevices(), 280)
        }
        // 详情弹窗打开时同步刷新
        if (this._modalEntityId && entityId === this._modalEntityId) {
          clearTimeout(this._modalRefreshTimer)
          this._modalRefreshTimer = setTimeout(() => this._refreshDeviceModal(entityId), 200)
        }
      })
      // 连接状态变化 → 状态栏 + 日志同步
      this._unsubConn = this.ha.onConnectionChange?.((connected, reason, prev) => {
        this._applyConnectionStatus(connected, reason, prev)
        if (connected && this.backend !== 'mijia') {
          // 连上后拉 Logbook 历史（仅 HA）
          this._loadLogbookHistory()
        }
        if (connected) this._refreshDevicesList?.()
      })
      this._refreshFromCache()
      this._tickClock()
      this._bindMijiaSettings()
      // 初始：只写「连接中」，等真正 auth_ok / 失败后再记日志
      if (this.ha.isConnected?.() || this.ha.connected) {
        this._applyConnectionStatus(true, 'already', false)
        if (this.backend !== 'mijia') this._loadLogbookHistory()
      } else if (this.backend === 'mijia') {
        this._setStatus('连接米家…', false)
        this._pushLog('正在连接米家桥…')
      } else {
        this._setStatus('连接中…', false)
        this._pushLog('正在连接…')
      }
    }

    // 首页常驻；抽屉内容不改 URL
    this._currentView = 'home'
    this._notifyViewChange('home')
  }

  _bindBanner(shell) {
    this._bannerTrack = shell.querySelector('#banner-track')
    this._bannerViewport = shell.querySelector('#banner-viewport')
    this._bannerDots = Array.from(shell.querySelectorAll('.banner-dot'))

    this._layoutBannerPages = () => {
      if (this._currentView !== 'home') return
      if (!this._bannerTrack) return
      this._bannerTrack.querySelectorAll('.banner-page').forEach((page) => {
        page.style.flex = ''
        page.style.width = ''
        page.style.minWidth = ''
        page.style.maxWidth = ''
      })
      this._bannerTrack.style.transform = 'translate3d(0,0,0)'
    }
    this._layoutBannerPages()

    let raf = 0
    this._onBannerResize = () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        this._layoutBannerPages?.()
      })
    }
    window.addEventListener('resize', this._onBannerResize)
  }

  _goBannerPage() {
    this._bannerPage = 0
    if (this._bannerTrack) {
      this._bannerTrack.classList.remove('page-1')
      this._bannerTrack.style.transform = 'translate3d(0,0,0)'
    }
    this._bannerDots.forEach((dot) => {
      const active = Number(dot.dataset.page) === 0
      dot.classList.toggle('active', active)
      dot.setAttribute('aria-selected', active ? 'true' : 'false')
    })
  }

  setStatus(text, ok = false) {
    this._setStatus(text, ok)
    // 与 _applyConnectionStatus 共用去重：同文案不重复写日志
    const key = String(text)
    if (key !== this._lastConnLog) {
      this._lastConnLog = key
      this._pushLog(text)
    }
  }

  _setStatus(text, ok = false) {
    const els = [
      document.getElementById('panel-status'),
      document.getElementById('panel-status-menu')
    ].filter(Boolean)
    if (!els.length) return
    const same = els.every(
      (el) => el.textContent === text && el.classList.contains('ok') === !!ok
    )
    if (same) return
    for (const el of els) {
      el.textContent = text
      el.classList.toggle('ok', !!ok)
    }
    this._refreshSettings()
  }

  /** 连接事件 → 状态栏绿字 + 日志最新一条 */
  _applyConnectionStatus(connected, reason = '', prev = null) {
    let text
    let ok = false
    // 默认/主路径：米家（HA 文案不再展示）
    if (this.backend !== 'ha') {
      if (connected) {
        const n = this.ha?.stateCache?.size ?? 0
        text = n ? `已连接米家 · ${n} 设备` : '已连接米家'
        ok = true
      } else if (reason && String(reason).includes('未登录')) {
        text = '米家未登录 · 请扫码'
      } else if (reason === 'disconnect') {
        text = '米家已断开'
      } else {
        text = reason ? `米家 · ${reason}` : '未连接米家'
      }
    } else if (connected) {
      text = '已连接'
      ok = true
    } else if (reason === 'auth_invalid') {
      text = '认证无效'
    } else if (reason === 'closed' && prev) {
      text = '已断开 · 重连中…'
    } else if (reason === 'disconnect') {
      text = '已断开'
    } else {
      text = '未连接'
    }
    this._setStatus(text, ok)
    const key = String(text)
    if (key !== this._lastConnLog) {
      this._lastConnLog = key
      this._pushLog(text)
    }
  }

  _bindMijiaSettings() {
    const group = document.getElementById('mijia-login-group')
    // 米家为默认；HA 调试时仍可隐藏登录区
    if (group) group.style.display = this.backend === 'ha' ? 'none' : ''
    const be = document.getElementById('set-backend')
    if (be) be.textContent = this.backend === 'ha' ? '调试·HA' : '米家'

    const btnQr = document.getElementById('btn-mijia-qr')
    const btnRf = document.getElementById('btn-mijia-refresh')
    const box = document.getElementById('mijia-qr-box')
    // 根据登录态更新按钮文案（已登录 → 不提示「获取二维码」）
    this._syncMijiaLoginUi()

    if (btnQr && !btnQr._bound) {
      btnQr._bound = true
      btnQr.addEventListener('click', async () => {
        if (!this.ha?.startQrLogin) {
          this._pushLog('当前后端不支持扫码')
          return
        }
        // 前端先查登录态：已登录则只刷新，不请求二维码接口
        btnQr.disabled = true
        try {
          let loggedIn = false
          try {
            const st = await this.ha.authStatus?.()
            loggedIn = !!st?.logged_in
          } catch (_) {
            loggedIn = !!(this.ha?.isConnected?.() || this.ha?.connected)
          }
          if (loggedIn) {
            this._pushLog('已登录，无需扫码')
            await this.ha.refreshDevices?.().catch(() => {})
            await this.ha.connect?.().catch(() => {})
            const n = this.ha.stateCache?.size ?? 0
            this._setStatus(n ? `已连接米家 · ${n} 设备` : '已连接米家', true)
            this._refreshFromCache()
            if (box) box.style.display = 'none'
            this._syncMijiaLoginUi(true)
            return
          }

          const start = await this.ha.startQrLogin()
          if (start?.refreshed || start?.already) {
            this._pushLog(start.message || '米家已登录，无需再扫')
            await this.ha.refreshDevices?.()
            await this.ha.connect?.().catch(() => {})
            this._setStatus(
              `已连接米家 · ${start.entities ?? this.ha.stateCache?.size ?? 0} 设备`,
              true
            )
            this._refreshFromCache()
            if (box) box.style.display = 'none'
            this._syncMijiaLoginUi(true)
            return
          }
          if (box) {
            box.style.display = ''
            const qr = start?.qr || start?.loginUrl || ''
            box.innerHTML = qr
              ? `请用<strong>米家 App</strong>扫码：<br/><a href="${qr}" target="_blank" rel="noopener">${qr}</a><br/>扫码确认后会自动检测`
              : '未返回二维码，检查桥日志'
          }
          this._pushLog('已取米家登录二维码，请扫码…')
          this.ha
            .waitQrLogin({ timeoutMs: 150000, intervalMs: 2000 })
            .then(async (r) => {
              this._pushLog(`米家登录成功 · ${r?.entities ?? 0} 实体`)
              this._setStatus(`已连接米家 · ${r?.entities ?? 0} 设备`, true)
              await this.ha.connect?.().catch(() => {})
              this._refreshFromCache()
              if (box) box.style.display = 'none'
              this._syncMijiaLoginUi(true)
            })
            .catch((e) => {
              this._pushLog(`扫码等待失败：${e.message || e}（若已扫过可点「刷新设备」）`)
            })
        } catch (e) {
          this._pushLog(`获取二维码失败：${e.message || e}`)
        } finally {
          btnQr.disabled = false
          this._syncMijiaLoginUi()
        }
      })
    }
    if (btnRf && !btnRf._bound) {
      btnRf._bound = true
      btnRf.addEventListener('click', async () => {
        try {
          await this.ha.refreshDevices?.()
          this._refreshFromCache()
          this._pushLog('已刷新米家设备列表')
          this._syncMijiaLoginUi()
        } catch (e) {
          this._pushLog(`刷新失败：${e.message || e}`)
        }
      })
    }
  }

  /** 已登录时：按钮改成「已登录」/灰掉，不展示二维码区 */
  _syncMijiaLoginUi(forceLoggedIn) {
    const btnQr = document.getElementById('btn-mijia-qr')
    const box = document.getElementById('mijia-qr-box')
    const rowLabel = btnQr?.closest('.settings-row')?.querySelector('span')
    let logged =
      forceLoggedIn === true ||
      !!(this.ha?.isConnected?.() || this.ha?.connected) ||
      (this.ha?.stateCache?.size ?? 0) > 0
    if (btnQr) {
      if (logged) {
        btnQr.textContent = '已登录'
        btnQr.title = '已登录，无需扫码（如需重登请清服务器 auth）'
        btnQr.classList.add('is-logged')
        if (box) box.style.display = 'none'
        if (rowLabel) rowLabel.textContent = '登录状态'
      } else {
        btnQr.textContent = '获取二维码'
        btnQr.title = ''
        btnQr.classList.remove('is-logged')
        if (rowLabel) rowLabel.textContent = '扫码登录'
      }
    }
  }

  _showMijiaLoginHint() {
    this._bindMijiaSettings()
    this._syncMijiaLoginUi()
    try {
      this.switchView?.('settings')
    } catch (_) {}
    this._pushLog('请到「设置」扫码登录米家')
  }

  _bindGearMenu(shell) {
    const gear = shell.querySelector('#status-gear')
    const menu = shell.querySelector('#gear-menu')
    if (!gear || !menu) return

    const close = () => {
      this._menuOpen = false
      menu.classList.remove('open')
      gear.classList.remove('open')
      gear.setAttribute('aria-expanded', 'false')
    }
    const open = () => {
      this._menuOpen = true
      menu.classList.add('open')
      gear.classList.add('open')
      gear.setAttribute('aria-expanded', 'true')
    }

    gear.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      if (this._menuOpen) close()
      else open()
    })

    menu.querySelectorAll('.gear-menu-item').forEach((item) => {
      item.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        const view = item.dataset.view || 'home'
        close()
        // 下一帧切换，避开菜单关闭与布局同时抢主线程
        requestAnimationFrame(() => this._switchView(view))
      })
    })

    this._onDocClick = (e) => {
      if (!this._menuOpen) return
      if (shell.querySelector('#status-bar')?.contains(e.target)) return
      close()
    }
    document.addEventListener('click', this._onDocClick)

    this._onMenuKey = (e) => {
      if (e.key === 'Escape' && this._menuOpen) close()
    }
    document.addEventListener('keydown', this._onMenuKey)
  }

  _bindRightMenu(shell) {
    const menu = shell.querySelector('#right-menu')
    if (!menu) return
    menu.querySelectorAll('.right-menu-item').forEach((item) => {
      item.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        this._switchView(item.dataset.view || 'home', item)
      })
    })
  }

  _bindDrawer(_shell) {
    // 抽屉在 body 上，不在 shell 内
    const closeBtn = document.getElementById('drawer-close')
    const mask = document.getElementById('drawer-mask')
    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        this._closeDrawer()
      })
    }
    if (mask) {
      mask.addEventListener('click', (e) => {
        e.preventDefault()
        this._closeDrawer()
      })
    }
    this._onDrawerKey = (e) => {
      if (e.key === 'Escape' && this._drawerOpen) this._closeDrawer()
    }
    document.addEventListener('keydown', this._onDrawerKey)
  }

  _resolveMenuAnchor(fromEl) {
    const btn =
      fromEl ||
      this._drawerAnchorEl ||
      document.querySelector(`.right-menu-item[data-view="${this._drawerAnchorView || 'devices'}"]`) ||
      document.querySelector('.right-menu-item')
    if (btn) {
      this._drawerAnchorEl = btn
      this._drawerAnchorView = btn.dataset?.view || this._drawerAnchorView || 'devices'
    }
    return btn
  }

  _cancelGenieAnim() {
    try {
      this._genieCancel?.()
    } catch (_) {}
    this._genieCancel = null
    try {
      this._genieAnim?.cancel?.()
    } catch (_) {}
    this._genieAnim = null
    document.querySelectorAll('.genie-fx-canvas').forEach((c) => {
      try {
        c.remove()
      } catch (_) {}
    })
  }

  async _openDrawer(view, fromEl) {
    const root = document.getElementById('drawer-root')
    const panel = document.getElementById('drawer-panel')
    if (!root || !panel) return
    if (this._drawerAnimating) return

    this._drawerOpen = true
    this._drawerAnchorView = view
    if (fromEl) this._drawerAnchorEl = fromEl
    const anchor = this._resolveMenuAnchor(fromEl)
    this._cancelGenieAnim()

    // 先显示 root（mask + 布局），panel 先藏起来给 genie 抓图
    root.classList.add('open')
    root.setAttribute('aria-hidden', 'false')
    document.body.classList.add('drawer-open')
    panel.classList.remove('genie-docked', 'genie-closing')
    panel.classList.add('genie-open')
    panel.style.visibility = 'hidden'
    panel.style.opacity = '0'
    void panel.offsetWidth

    // 内容先渲染，截图才是真内容
    if (view === 'logs') this._renderLogs()
    if (view === 'devices') this._renderDevices()
    if (view === 'settings') this._refreshSettings()

    this._drawerAnimating = true
    const finish = () => {
      clearTimeout(this._drawerAnimTimer)
      this._drawerAnimating = false
      this._genieCancel = null
      panel.style.visibility = ''
      panel.style.opacity = ''
      panel.classList.remove('genie-docked', 'genie-closing')
      panel.classList.add('genie-open')
      document.getElementById('drawer-close')?.focus?.({ preventScroll: true })
    }

    try {
      // 等一帧让列表 DOM 进树
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      const ok = await genieExpand(panel, anchor, { duration: 560, slices: 40 })
      if (!ok) {
        // 兜底：简单从右滑入
        panel.style.visibility = ''
        panel.style.opacity = ''
        panel.style.transform = 'translate3d(18%,0,0)'
        void panel.offsetWidth
        panel.style.transition = 'transform .38s cubic-bezier(.2,.85,.25,1), opacity .28s'
        panel.style.transform = 'translate3d(0,0,0)'
        setTimeout(() => {
          panel.style.transition = ''
          panel.style.transform = ''
          finish()
        }, 400)
        return
      }
      finish()
    } catch (e) {
      console.warn('[drawer] genie expand failed', e)
      panel.style.visibility = ''
      panel.style.opacity = ''
      finish()
    }
    clearTimeout(this._drawerAnimTimer)
    this._drawerAnimTimer = setTimeout(finish, 900)
  }

  async _closeDrawer() {
    const root = document.getElementById('drawer-root')
    const panel = document.getElementById('drawer-panel')
    if (!root || !panel) return
    if (!this._drawerOpen && !root.classList.contains('open')) return
    if (this._drawerAnimating) return

    const anchor = this._resolveMenuAnchor(this._drawerAnchorEl)
    this._cancelGenieAnim()
    this._drawerAnimating = true
    panel.classList.remove('genie-open', 'genie-docked')
    panel.classList.add('genie-closing')

    const finish = () => {
      clearTimeout(this._drawerAnimTimer)
      this._drawerAnimating = false
      this._genieCancel = null
      this._drawerOpen = false
      root.classList.remove('open')
      root.setAttribute('aria-hidden', 'true')
      document.body.classList.remove('drawer-open')
      panel.classList.remove('genie-closing', 'genie-open')
      panel.classList.add('genie-docked')
      panel.style.visibility = ''
      panel.style.opacity = ''
      panel.style.transform = ''
      panel.style.transition = ''

      this._currentView = 'home'
      document.querySelectorAll('.drawer-view').forEach((pane) => {
        pane.classList.remove('active')
        pane.setAttribute('inert', '')
      })
      document.querySelectorAll('.right-menu-item').forEach((item) => {
        item.classList.toggle('active', item.dataset.view === 'home')
      })
      this._notifyViewChange('home')
      this._refreshSettings()
    }

    try {
      const ok = await genieCollapse(panel, anchor, { duration: 480, slices: 40 })
      if (!ok) {
        panel.style.transition = 'transform .32s ease, opacity .28s'
        panel.style.transform = 'translate3d(18%,0,0)'
        panel.style.opacity = '0'
        setTimeout(finish, 340)
        return
      }
      finish()
    } catch (e) {
      console.warn('[drawer] genie collapse failed', e)
      finish()
    }
    clearTimeout(this._drawerAnimTimer)
    this._drawerAnimTimer = setTimeout(finish, 900)
  }

  _switchView(view, fromEl) {
    if (this._switching) return
    const allowed = ['home', 'devices', 'logs', 'settings']
    const next = allowed.includes(view) ? view : 'home'

    // 首页 = Genie 关抽屉；其它 = 从图标反向 Genie 展开
    if (next === 'home') {
      if (this._drawerOpen) this._closeDrawer()
      else {
        this._currentView = 'home'
        document.querySelectorAll('.right-menu-item').forEach((item) => {
          item.classList.toggle('active', item.dataset.view === 'home')
        })
      }
      return
    }

    this._switching = true
    try {
      this._currentView = next
      if (fromEl) this._drawerAnchorEl = fromEl

      document.querySelectorAll('.drawer-view').forEach((pane) => {
        const on = pane.dataset.view === next
        pane.classList.toggle('active', on)
        if (on) pane.removeAttribute('inert')
        else pane.setAttribute('inert', '')
      })
      document.querySelectorAll('.right-menu-item').forEach((item) => {
        item.classList.toggle('active', item.dataset.view === next)
      })

      // 已打开时只切内容，不重播 Genie
      if (this._drawerOpen) {
        if (next === 'logs') this._renderLogs()
        if (next === 'devices') this._renderDevices()
        if (next === 'settings') this._refreshSettings()
        this._notifyViewChange(next)
      } else {
        this._openDrawer(next, fromEl)
        this._notifyViewChange(next)
      }
    } finally {
      setTimeout(() => {
        this._switching = false
      }, 80)
    }
  }

  _notifyViewChange(view) {
    if (this.onViewChange) {
      try {
        this.onViewChange(view)
      } catch (e) {
        console.warn('onViewChange', e)
      }
    }
  }

  _pushLog(msg, opts = {}) {
    const now = new Date()
    const time =
      opts.time ||
      `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`
    const entry = {
      time,
      msg: String(msg),
      source: opts.source || 'local'
    }
    if (opts.prependOldest) {
      // 历史 Logbook：插到列表尾（更旧）
      this._logs.push(entry)
    } else {
      this._logs.unshift(entry)
    }
    if (this._logs.length > 120) this._logs.length = 120
    if (this._currentView === 'logs') this._renderLogs()
  }

  _renderLogs() {
    const root = document.getElementById('log-list')
    if (!root) return
    if (!this._logs.length) {
      root.innerHTML = '<div class="log-empty">暂无操作记录（连接后实时同步）</div>'
      return
    }
    root.innerHTML = this._logs
      .map(
        (l) => `
      <div class="log-item${l.source === 'ws' ? ' log-ws' : ''}">
        <div class="log-time">${l.time}${l.source === 'ws' ? ' · WS' : ''}</div>
        <div>${l.msg}</div>
      </div>`
      )
      .join('')
  }

  _bindSettings() {
    document.getElementById('btn-clear-logs')?.addEventListener('click', () => {
      this._logs = []
      this._pushLog('已清空日志')
      this._renderLogs()
    })
  }

  _refreshSettings() {
    const names = { home: '首页', devices: '设备', logs: '日志', settings: '设置' }
    const viewEl = document.getElementById('set-current-view')
    if (viewEl) viewEl.textContent = names[this._currentView] || this._currentView

    const ok = !!(this.ha?.isConnected?.() || this.ha?.connected)
    const n = this.ha?.stateCache?.size ?? 0
    const mj = document.getElementById('set-mijia-state')
    if (mj) {
      if (this.backend === 'ha') {
        mj.textContent = ok ? '调试·已连接' : '调试·未连接'
      } else {
        mj.textContent = ok ? (n ? `已连接 · ${n} 设备` : '已连接') : '未连接'
      }
    }
    const be = document.getElementById('set-backend')
    if (be) be.textContent = this.backend === 'ha' ? '调试·HA' : '米家'
    // 打开设置时同步登录按钮状态
    this._syncMijiaLoginUi?.()
  }

  _bindDevices() {
    if (this._devBound) return
    this._devBound = true
    const search = document.getElementById('dev-search')
    if (search) {
      let t = 0
      search.addEventListener('input', () => {
        clearTimeout(t)
        t = setTimeout(() => {
          this._devSearch = (search.value || '').trim().toLowerCase()
          this._renderDevices()
        }, 120)
      })
    }
  }

  _domainMeta(domain) {
    const map = {
      light: { label: '灯光', icon: '💡' },
      switch: { label: '开关', icon: '⏻' },
      climate: { label: '空调', icon: '❄' },
      cover: { label: '窗帘', icon: '🪟' },
      media_player: { label: '媒体', icon: '🔊' },
      sensor: { label: '传感器', icon: '📡' },
      binary_sensor: { label: '二元传感', icon: '📶' },
      weather: { label: '天气', icon: '⛅' },
      fan: { label: '风扇', icon: '🌀' },
      vacuum: { label: '扫地机', icon: '🤖' },
      camera: { label: '摄像', icon: '📷' },
      lock: { label: '锁', icon: '🔒' },
      scene: { label: '场景', icon: '🎬' },
      script: { label: '脚本', icon: '📜' },
      automation: { label: '自动化', icon: '⚡' },
      person: { label: '人员', icon: '👤' },
      device_tracker: { label: '定位', icon: '📍' },
      button: { label: '按钮', icon: '🔲' },
      number: { label: '数值', icon: '🔢' },
      select: { label: '选择', icon: '☰' },
      input_boolean: { label: '布尔输入', icon: '☑' },
      input_number: { label: '数值输入', icon: '🔢' },
      input_select: { label: '选择输入', icon: '☰' },
      input_text: { label: '文本输入', icon: '✏' },
      sun: { label: '太阳', icon: '☀' },
      update: { label: '更新', icon: '⬆' },
      remote: { label: '遥控', icon: '🎛' },
      water_heater: { label: '热水', icon: '♨' },
      humidifier: { label: '加湿', icon: '💧' },
      air_quality: { label: '空气质量', icon: '🌬' }
    }
    return map[domain] || { label: domain, icon: '📦' }
  }

  /** 实体设备域：物理可控设备（不含传感器/辅助/自动化等） */
  _isDeviceDomain(domain) {
    return (
      domain === 'light' ||
      domain === 'switch' ||
      domain === 'fan' ||
      domain === 'cover' ||
      domain === 'climate' ||
      domain === 'media_player' ||
      domain === 'lock' ||
      domain === 'vacuum' ||
      domain === 'humidifier' ||
      domain === 'water_heater' ||
      domain === 'remote' ||
      domain === 'siren' ||
      domain === 'camera' ||
      domain === 'alarm_control_panel' ||
      domain === 'lawn_mower' ||
      domain === 'valve'
    )
  }

  /** 需要详情面板的设备（滑条/模式等） */
  _isDetailDomain(domain) {
    return domain === 'cover' || domain === 'climate' || domain === 'light' || domain === 'fan'
  }

  _hvacLabel(mode) {
    const map = {
      off: '关闭',
      heat: '制热',
      cool: '制冷',
      auto: '自动',
      dry: '除湿',
      fan_only: '送风',
      heat_cool: '冷热'
    }
    return map[mode] || mode || '—'
  }

  _fanLabel(mode) {
    const map = {
      auto: '自动',
      low: '低',
      medium: '中',
      high: '高',
      Low: '低',
      Medium: '中',
      High: '高',
      Auto: '自动'
    }
    return map[mode] || mode || '—'
  }

  async _devCall(domain, service, data, label, btnEl = null) {
    const id = data?.entity_id
    const name = id ? this._entityLabel(id) : domain
    // 防止弹窗 state 刷新打断点击
    this._modalBusy = true
    if (btnEl) {
      btnEl.classList.add('busy')
      btnEl.disabled = true
    }
    this._setModalHint(label ? `正在${label}…` : '下发中…')
    this._pushLog(`${name} · 请求${label || service}`)
    try {
      // 小米窗帘：标准 set_cover_position 常返回成功但不改状态；改用 xiaomi_miot
      if (domain === 'cover' && service === 'set_cover_position') {
        const pos = Number(data?.position)
        await this._setCoverPositionReliable(id, pos)
      } else {
        await this.ha.callService(domain, service, data)
      }
      this._setModalHint(label ? `已下发：${label}` : '已下发')
      this._pushLog(`${name} · 已下发「${label || service}」`)
      // 米家：状态已乐观回写，少等；窗帘仍稍候再刷
      if (id) {
        const waitMs =
          this.backend === 'mijia' || this.backend !== 'ha'
            ? domain === 'cover'
              ? 400
              : 120
            : domain === 'cover' || service === 'set_property'
              ? 1200
              : 600
        await new Promise((r) => setTimeout(r, waitMs))
        let cur = this.ha.getState(id)
        try {
          // 米家不强制全量 REST；本地缓存已更新
          if (this.backend === 'ha') {
            cur = (await this.ha.fetchState(id, { force: true })) || cur
          }
        } catch (_) {}
        // 部分小米灯 REST 成功但状态不变
        if (domain === 'light' && (service === 'turn_on' || service === 'turn_off')) {
          const want = service === 'turn_on' ? 'on' : 'off'
          if (cur?.state && cur.state !== want) {
            this._setModalHint(`已下发，设备仍为 ${cur.state}（集成可能假成功）`)
            this._pushLog(`${name} · 设备状态未变（仍为 ${cur.state}）`)
          }
        }
        // 窗帘：校验目标位
        if (domain === 'cover' && service === 'set_cover_position') {
          const want = Number(data?.position)
          const a = cur?.attributes || {}
          const { current, target } = this._coverPositions(a, cur)
          if (Number.isFinite(want)) {
            if (current === want) {
              this._setModalHint(`已到位 ${current}%`)
              this._pushLog(`${name} · 已到位 ${current}%`)
            } else if (target === want || cur?.state === 'opening' || cur?.state === 'closing') {
              this._setModalHint(
                `目标 ${want}% · 当前位置 ${current}%（${cur?.state === 'closing' || cur?.state === 'opening' ? '电机移动中' : '等待回写'}）`
              )
              this._pushLog(`${name} · 目标 ${want}% / 当前 ${current}%`)
            } else {
              this._setModalHint(
                `命令已发 ${want}%，但 HA 仍为当前 ${current}% / 目标 ${target}% — 这扇电机可能未执行（儿童房窗帘已实测如此）`
              )
              this._pushLog(`${name} · 当前 ${current}% 目标 ${target}%（设备未执行）`)
            }
          }
        }
        if (this._modalEntityId === id) this._refreshDeviceModal(id)
        if (this._currentView === 'devices') this._renderDevices()
      }
    } catch (e) {
      console.error(e)
      const msg = e?.message || String(e)
      this._setModalHint(`失败：${msg}`)
      this._pushLog(`${name} · 失败：${msg}`)
    } finally {
      this._modalBusy = false
      if (btnEl) {
        btnEl.classList.remove('busy')
        btnEl.disabled = false
      }
    }
  }

  /**
   * 小米窗帘位置：
   * - 0/100：优先 close/open + motor_control（比纯 set_position 更可靠）
   * - 中间值：xiaomi_miot.set_property(target_position)
   * - 标准 cover.set_cover_position 实测常假成功
   */
  async _setCoverPositionReliable(entityId, position) {
    const pos = Math.round(Math.min(100, Math.max(0, Number(position) || 0)))

    const miotSet = async (field, value) => {
      await this.ha.callService('xiaomi_miot', 'set_property', {
        entity_id: entityId,
        field,
        value
      })
    }

    try {
      if (pos === 0) {
        // 全关：目标 0 + close + 电机关向
        try {
          await miotSet('target_position', 0)
        } catch (_) {}
        try {
          await this.ha.callService('cover', 'close_cover', { entity_id: entityId })
        } catch (_) {}
        try {
          await miotSet('motor_control', 2) // 常见：2=关
        } catch (_) {}
      } else if (pos === 100) {
        try {
          await miotSet('target_position', 100)
        } catch (_) {}
        try {
          await this.ha.callService('cover', 'open_cover', { entity_id: entityId })
        } catch (_) {}
        try {
          await miotSet('motor_control', 1) // 常见：1=开
        } catch (_) {}
      } else {
        // 中间开合
        await miotSet('target_position', pos)
        // 部分电机只写 target 不转，再推一次标准服务（无害）
        try {
          await this.ha.callService('cover', 'set_cover_position', {
            entity_id: entityId,
            position: pos
          })
        } catch (_) {}
      }
      this._optimisticCoverTarget(entityId, pos)
      return
    } catch (e1) {
      console.warn('[cover] miot path failed, try standard', e1)
    }

    // 最后兜底
    if (pos === 0) {
      await this.ha.callService('cover', 'close_cover', { entity_id: entityId })
    } else if (pos === 100) {
      await this.ha.callService('cover', 'open_cover', { entity_id: entityId })
    } else {
      await this.ha.callService('cover', 'set_cover_position', {
        entity_id: entityId,
        position: pos
      })
    }
    this._optimisticCoverTarget(entityId, pos)
  }

  _optimisticCoverTarget(entityId, pos) {
    const st = this.ha?.getState?.(entityId)
    if (!st || !this.ha?.stateCache) return
    const next = {
      ...st,
      attributes: {
        ...(st.attributes || {}),
        'curtain.target_position': pos,
        target_position: pos
      }
    }
    // 若正在从关→开的中间态，可标 opening
    if ((st.state === 'closed' || st.state === 'closing') && pos > 0) next.state = 'opening'
    if ((st.state === 'open' || st.state === 'opening') && pos === 0) next.state = 'closing'
    this.ha.stateCache.set(entityId, next)
    try {
      this.ha._emitState?.(entityId, next, st)
    } catch (_) {}
  }

  _setModalHint(text) {
    if (!this._modalEl) return
    let hint = this._modalEl.querySelector('.dev-modal-hint')
    if (!hint) {
      const body = this._modalEl.querySelector('.ha-modal-body')
      if (!body) return
      hint = document.createElement('div')
      hint.className = 'dev-modal-hint'
      body.prepend(hint)
    }
    hint.textContent = text || ''
    hint.classList.toggle('err', /失败|未变|错误/.test(text || ''))
    hint.classList.toggle('ok', /已下发|成功/.test(text || '') && !/失败|未变/.test(text || ''))
  }

  _refreshDeviceModal(entityId) {
    if (!this._modalEl || this._modalEntityId !== entityId) return
    // 操作进行中不整页重绑，避免“点了没反应”
    if (this._modalBusy) return
    const body = this._modalEl.querySelector('.ha-modal-body')
    const titleEl = this._modalEl.querySelector('.ha-modal-title')
    if (!body) return
    const st = this.ha?.getState?.(entityId)
    if (!st) return
    const name = st.attributes?.friendly_name || this._entityLabel(entityId)
    if (titleEl) titleEl.textContent = name
    const prevHint = body.querySelector('.dev-modal-hint')?.textContent || ''
    body.innerHTML = this._buildDeviceDetailBody(entityId, st)
    if (prevHint) {
      const h = document.createElement('div')
      h.className = 'dev-modal-hint'
      h.textContent = prevHint
      body.prepend(h)
    }
    this._bindDeviceDetail(entityId, body)
  }

  _buildDeviceDetailBody(entityId, st) {
    const domain = entityId.split('.')[0]
    const a = st.attributes || {}
    if (domain === 'cover') return this._bodyCover(entityId, st, a)
    if (domain === 'climate') return this._bodyClimate(entityId, st, a)
    if (domain === 'light') return this._bodyLight(entityId, st, a)
    if (domain === 'fan') return this._bodyFan(entityId, st, a)
    return `<div class="ha-modal-sub">暂无详情控制</div>`
  }

  _coverPositions(a, st) {
    const curRaw = a.current_position ?? a['curtain.current_position']
    let current = Number(curRaw)
    if (!Number.isFinite(current)) {
      current = st?.state === 'open' || st?.state === 'opening' ? 100 : 0
    }
    current = Math.round(Math.min(100, Math.max(0, current)))
    const tgtRaw = a['curtain.target_position'] ?? a.target_position
    let target = Number(tgtRaw)
    if (!Number.isFinite(target)) target = current
    target = Math.round(Math.min(100, Math.max(0, target)))
    return { current, target }
  }

  _bodyCover(entityId, st, a) {
    const { current, target } = this._coverPositions(a, st)
    const moving = st.state === 'opening' || st.state === 'closing'
    const pending = !moving && target !== current
    const stateLabel = this._stateLabel('cover', st.state)
    // 滑条优先显示目标（你刚调的位置），大字显示真实位置
    const sliderPos = target
    let sub = `状态：${this._escapeHtml(stateLabel)} · 当前 ${current}%`
    if (pending) sub += ` · 目标 ${target}%（设备未到位）`
    else if (moving) sub += ` · 移动中 → ${target}%`
    return `
      <div class="dev-detail">
        <div class="ha-modal-big">${current}<span style="font-size:18px;opacity:.55">%</span></div>
        <div class="ha-modal-sub">${sub}</div>
        ${
          pending
            ? `<div class="dev-modal-hint err">目标 ${target}% · 当前位置仍 ${current}% — 命令可能已到 HA，但电机未到位/未回写位置（非前端显示错误）</div>`
            : ''
        }
        <div class="dev-ctrl-row">
          <button type="button" class="dev-ctrl-btn" data-act="open">全开</button>
          <button type="button" class="dev-ctrl-btn" data-act="stop">停止</button>
          <button type="button" class="dev-ctrl-btn" data-act="close">全关</button>
        </div>
        <div class="dev-slider-block">
          <div class="dev-slider-label"><span>设定开合</span><span class="dev-slider-val" id="cover-pos-val">${sliderPos}%</span></div>
          <input type="range" class="dev-slider" id="cover-pos" min="0" max="100" step="1" value="${sliderPos}" />
          <div class="dev-slider-marks"><span>关 0</span><span>半开</span><span>开 100</span></div>
        </div>
        <div class="dev-ctrl-row dev-presets">
          <button type="button" class="dev-chip-btn${sliderPos === 0 ? ' active' : ''}" data-pos="0">0%</button>
          <button type="button" class="dev-chip-btn${sliderPos === 25 ? ' active' : ''}" data-pos="25">25%</button>
          <button type="button" class="dev-chip-btn${sliderPos === 50 ? ' active' : ''}" data-pos="50">50%</button>
          <button type="button" class="dev-chip-btn${sliderPos === 75 ? ' active' : ''}" data-pos="75">75%</button>
          <button type="button" class="dev-chip-btn${sliderPos === 100 ? ' active' : ''}" data-pos="100">100%</button>
        </div>
        <div class="ha-modal-row"><span class="ha-modal-k">当前位置</span><span class="ha-modal-v">${current}%</span></div>
        <div class="ha-modal-row"><span class="ha-modal-k">目标位置</span><span class="ha-modal-v">${target}%</span></div>
        <div class="ha-modal-row"><span class="ha-modal-k">实体</span><span class="ha-modal-v">${entityId}</span></div>
      </div>`
  }

  _bodyClimate(entityId, st, a) {
    const cur = a.current_temperature ?? a['environment.temperature']
    const target = a.temperature ?? a['target_temperature-2-3'] ?? 26
    const min = Number(a.min_temp ?? 16)
    const max = Number(a.max_temp ?? 32)
    const step = Number(a.target_temp_step ?? 1) || 1
    const modes = Array.isArray(a.hvac_modes) ? a.hvac_modes : ['off', 'cool', 'heat', 'auto']
    const fanModes = Array.isArray(a.fan_modes) ? a.fan_modes : []
    const fanMode = a.fan_mode || ''
    const mode = st.state
    const t = Number(target)
    const safeT = Number.isFinite(t) ? t : 26
    const modesHtml = modes
      .map(
        (m) =>
          `<button type="button" class="dev-chip-btn${m === mode ? ' active' : ''}" data-hvac="${this._escapeHtml(m)}">${this._hvacLabel(m)}</button>`
      )
      .join('')
    const fanHtml = fanModes.length
      ? `<div class="dev-section-label">风速</div>
         <div class="dev-ctrl-row dev-presets wrap">
           ${fanModes
             .map(
               (f) =>
                 `<button type="button" class="dev-chip-btn${String(f).toLowerCase() === String(fanMode).toLowerCase() ? ' active' : ''}" data-fan="${this._escapeHtml(f)}">${this._fanLabel(f)}</button>`
             )
             .join('')}
         </div>`
      : ''
    return `
      <div class="dev-detail">
        <div class="ha-modal-big">${cur != null ? cur : '—'}<span style="font-size:18px;opacity:.55">°C</span></div>
        <div class="ha-modal-sub">室内温度 · 模式 ${this._hvacLabel(mode)}</div>
        <div class="dev-temp-ctrl">
          <button type="button" class="dev-temp-btn" data-act="temp-down">−</button>
          <div class="dev-temp-val"><span id="climate-temp-val">${safeT}</span><span class="u">°C</span></div>
          <button type="button" class="dev-temp-btn" data-act="temp-up">+</button>
        </div>
        <div class="dev-slider-block">
          <div class="dev-slider-label"><span>设定温度</span><span class="dev-slider-val" id="climate-slider-val">${safeT}°C</span></div>
          <input type="range" class="dev-slider" id="climate-temp" min="${min}" max="${max}" step="${step}" value="${safeT}" />
          <div class="dev-slider-marks"><span>${min}°</span><span></span><span>${max}°</span></div>
        </div>
        <div class="dev-section-label">模式</div>
        <div class="dev-ctrl-row dev-presets wrap">${modesHtml}</div>
        ${fanHtml}
        <div class="dev-ctrl-row" style="margin-top:12px">
          <button type="button" class="dev-ctrl-btn" data-act="power-on">开机</button>
          <button type="button" class="dev-ctrl-btn danger" data-act="power-off">关机</button>
        </div>
        <div class="ha-modal-row"><span class="ha-modal-k">实体</span><span class="ha-modal-v">${entityId}</span></div>
      </div>`
  }

  _bodyLight(entityId, st, a) {
    const on = st.state === 'on'
    const bri = a.brightness != null ? Math.round((Number(a.brightness) / 255) * 100) : on ? 100 : 0
    const hasBri = a.brightness != null || (a.supported_color_modes || []).some((m) => m === 'brightness' || m === 'color_temp' || m === 'hs' || m === 'xy' || m === 'rgb')
    const hasCt = a.color_temp_kelvin != null || a.min_color_temp_kelvin != null
    const ct = a.color_temp_kelvin ?? a['light.color_temperature'] ?? a.min_color_temp_kelvin ?? 4000
    const minK = a.min_color_temp_kelvin ?? 2700
    const maxK = a.max_color_temp_kelvin ?? 6500
    return `
      <div class="dev-detail">
        <div class="ha-modal-big">${on ? '开' : '关'}</div>
        <div class="ha-modal-sub">${this._escapeHtml(st.attributes?.friendly_name || entityId)}</div>
        <div class="dev-ctrl-row">
          <button type="button" class="dev-ctrl-btn${on ? ' active' : ''}" data-act="on">开启</button>
          <button type="button" class="dev-ctrl-btn${!on ? ' active' : ''}" data-act="off">关闭</button>
        </div>
        ${
          hasBri
            ? `<div class="dev-slider-block">
          <div class="dev-slider-label"><span>亮度</span><span class="dev-slider-val" id="light-bri-val">${bri}%</span></div>
          <input type="range" class="dev-slider" id="light-bri" min="1" max="100" step="1" value="${bri || 1}" />
        </div>`
            : ''
        }
        ${
          hasCt
            ? `<div class="dev-slider-block">
          <div class="dev-slider-label"><span>色温</span><span class="dev-slider-val" id="light-ct-val">${Math.round(ct)}K</span></div>
          <input type="range" class="dev-slider" id="light-ct" min="${minK}" max="${maxK}" step="50" value="${Math.round(ct)}" />
          <div class="dev-slider-marks"><span>暖</span><span></span><span>冷</span></div>
        </div>`
            : ''
        }
        <div class="ha-modal-row"><span class="ha-modal-k">实体</span><span class="ha-modal-v">${entityId}</span></div>
      </div>`
  }

  _bodyFan(entityId, st, a) {
    const on = st.state === 'on'
    const pct = a.percentage != null ? Number(a.percentage) : on ? 50 : 0
    return `
      <div class="dev-detail">
        <div class="ha-modal-big">${on ? '开' : '关'}</div>
        <div class="dev-ctrl-row">
          <button type="button" class="dev-ctrl-btn" data-act="on">开启</button>
          <button type="button" class="dev-ctrl-btn" data-act="off">关闭</button>
        </div>
        <div class="dev-slider-block">
          <div class="dev-slider-label"><span>风速</span><span class="dev-slider-val" id="fan-pct-val">${pct}%</span></div>
          <input type="range" class="dev-slider" id="fan-pct" min="0" max="100" step="${a.percentage_step || 1}" value="${pct}" />
        </div>
        <div class="ha-modal-row"><span class="ha-modal-k">实体</span><span class="ha-modal-v">${entityId}</span></div>
      </div>`
  }

  _bindDeviceDetail(entityId, root) {
    const domain = entityId.split('.')[0]
    const st = () => this.ha?.getState?.(entityId)

    // 统一绑定：带按钮反馈 + 防重复
    root.querySelectorAll('[data-act]').forEach((btn) => {
      btn.addEventListener('click', async (ev) => {
        ev.preventDefault()
        ev.stopPropagation()
        if (this._modalBusy || btn.disabled) return
        const act = btn.dataset.act
        if (domain === 'cover') {
          if (act === 'open') await this._devCall('cover', 'open_cover', { entity_id: entityId }, '全开', btn)
          else if (act === 'close') await this._devCall('cover', 'close_cover', { entity_id: entityId }, '全关', btn)
          else if (act === 'stop') await this._devCall('cover', 'stop_cover', { entity_id: entityId }, '停止', btn)
        } else if (domain === 'climate') {
          if (act === 'power-on') await this._devCall('climate', 'turn_on', { entity_id: entityId }, '开机', btn)
          else if (act === 'power-off') await this._devCall('climate', 'turn_off', { entity_id: entityId }, '关机', btn)
          else if (act === 'temp-up' || act === 'temp-down') {
            const cur = st()
            const a = cur?.attributes || {}
            const min = Number(a.min_temp ?? 16)
            const max = Number(a.max_temp ?? 32)
            const step = Number(a.target_temp_step ?? 1) || 1
            let t = Number(a.temperature ?? 26)
            if (!Number.isFinite(t)) t = 26
            t = act === 'temp-up' ? Math.min(max, t + step) : Math.max(min, t - step)
            const valEl = root.querySelector('#climate-temp-val')
            const slider = root.querySelector('#climate-temp')
            const sval = root.querySelector('#climate-slider-val')
            if (valEl) valEl.textContent = String(t)
            if (slider) slider.value = String(t)
            if (sval) sval.textContent = `${t}°C`
            await this._devCall(
              'climate',
              'set_temperature',
              { entity_id: entityId, temperature: t },
              `设定 ${t}°C`,
              btn
            )
          }
        } else if (domain === 'light') {
          if (act === 'on') await this._devCall('light', 'turn_on', { entity_id: entityId }, '开启', btn)
          else if (act === 'off') await this._devCall('light', 'turn_off', { entity_id: entityId }, '关闭', btn)
        } else if (domain === 'fan') {
          if (act === 'on') await this._devCall('fan', 'turn_on', { entity_id: entityId }, '开启', btn)
          else if (act === 'off') await this._devCall('fan', 'turn_off', { entity_id: entityId }, '关闭', btn)
        }
      })
    })

    // cover position presets
    root.querySelectorAll('[data-pos]').forEach((btn) => {
      btn.addEventListener('click', async (ev) => {
        ev.preventDefault()
        ev.stopPropagation()
        if (this._modalBusy || btn.disabled) return
        const pos = Number(btn.dataset.pos)
        const slider = root.querySelector('#cover-pos')
        const val = root.querySelector('#cover-pos-val')
        if (slider) slider.value = String(pos)
        if (val) val.textContent = `${pos}%`
        await this._devCall(
          'cover',
          'set_cover_position',
          { entity_id: entityId, position: pos },
          `位置 ${pos}%`,
          btn
        )
      })
    })

    // climate modes
    root.querySelectorAll('[data-hvac]').forEach((btn) => {
      btn.addEventListener('click', async (ev) => {
        ev.preventDefault()
        ev.stopPropagation()
        if (this._modalBusy || btn.disabled) return
        const mode = btn.dataset.hvac
        await this._devCall(
          'climate',
          'set_hvac_mode',
          { entity_id: entityId, hvac_mode: mode },
          `模式 ${this._hvacLabel(mode)}`,
          btn
        )
      })
    })
    root.querySelectorAll('[data-fan]').forEach((btn) => {
      btn.addEventListener('click', async (ev) => {
        ev.preventDefault()
        ev.stopPropagation()
        if (this._modalBusy || btn.disabled) return
        const fan = btn.dataset.fan
        await this._devCall(
          'climate',
          'set_fan_mode',
          { entity_id: entityId, fan_mode: fan },
          `风速 ${this._fanLabel(fan)}`,
          btn
        )
      })
    })

    // sliders with debounce
    const bindSlider = (sel, onCommit, onInput) => {
      const el = root.querySelector(sel)
      if (!el) return
      let timer = 0
      el.addEventListener('input', () => {
        if (this._modalBusy) return
        onInput?.(Number(el.value))
        clearTimeout(timer)
        timer = setTimeout(() => onCommit(Number(el.value)), 320)
      })
      el.addEventListener('change', () => {
        if (this._modalBusy) return
        clearTimeout(timer)
        onCommit(Number(el.value))
      })
    }

    bindSlider(
      '#cover-pos',
      (v) =>
        this._devCall('cover', 'set_cover_position', { entity_id: entityId, position: v }, `位置 ${v}%`),
      (v) => {
        const val = root.querySelector('#cover-pos-val')
        if (val) val.textContent = `${v}%`
      }
    )
    bindSlider(
      '#climate-temp',
      (v) =>
        this._devCall(
          'climate',
          'set_temperature',
          { entity_id: entityId, temperature: v },
          `设定 ${v}°C`
        ),
      (v) => {
        const val = root.querySelector('#climate-temp-val')
        const sval = root.querySelector('#climate-slider-val')
        if (val) val.textContent = String(v)
        if (sval) sval.textContent = `${v}°C`
      }
    )
    bindSlider(
      '#light-bri',
      (v) => {
        const brightness = Math.max(1, Math.min(255, Math.round((v / 100) * 255)))
        return this._devCall(
          'light',
          'turn_on',
          { entity_id: entityId, brightness },
          `亮度 ${v}%`
        )
      },
      (v) => {
        const val = root.querySelector('#light-bri-val')
        if (val) val.textContent = `${v}%`
      }
    )
    bindSlider(
      '#light-ct',
      (v) =>
        this._devCall(
          'light',
          'turn_on',
          { entity_id: entityId, color_temp_kelvin: Math.round(v) },
          `色温 ${Math.round(v)}K`
        ),
      (v) => {
        const val = root.querySelector('#light-ct-val')
        if (val) val.textContent = `${Math.round(v)}K`
      }
    )
    bindSlider(
      '#fan-pct',
      (v) =>
        this._devCall(
          'fan',
          'set_percentage',
          { entity_id: entityId, percentage: v },
          `风速 ${v}%`
        ),
      (v) => {
        const val = root.querySelector('#fan-pct-val')
        if (val) val.textContent = `${v}%`
      }
    )
  }

  _openDeviceDetail(entityId) {
    const st = this.ha?.getState?.(entityId)
    if (!st) {
      this._showModal({ title: '设备', body: '<div class="ha-modal-sub">未找到实体状态</div>' })
      return
    }
    const name = st.attributes?.friendly_name || this._entityLabel(entityId)
    this._modalEntityId = entityId
    this._showModal({
      title: name,
      body: this._buildDeviceDetailBody(entityId, st),
      wide: true,
      onReady: (root) => this._bindDeviceDetail(entityId, root)
    })
  }

  _isToggleDomain(domain) {
    // 可一点切换/触发的设备域
    return (
      domain === 'light' ||
      domain === 'switch' ||
      domain === 'fan' ||
      domain === 'media_player' ||
      domain === 'lock' ||
      domain === 'cover' ||
      domain === 'climate' ||
      domain === 'vacuum' ||
      domain === 'humidifier' ||
      domain === 'water_heater' ||
      domain === 'remote' ||
      domain === 'siren' ||
      domain === 'valve'
    )
  }

  /** 只读设备（如摄像头） */
  _isReadOnlyDomain(domain) {
    return domain === 'camera'
  }

  async _controlDevice(entityId, domain, curState) {
    const id = entityId
    switch (domain) {
      case 'light':
      case 'switch':
      case 'fan':
      case 'humidifier':
      case 'water_heater':
      case 'siren':
      case 'remote': {
        const on = curState === 'on'
        await this.ha.callService(domain, on ? 'turn_off' : 'turn_on', { entity_id: id })
        return on ? '关闭' : '开启'
      }
      case 'media_player': {
        if (curState === 'playing') {
          await this.ha.callService('media_player', 'media_pause', { entity_id: id })
          return '暂停'
        }
        if (curState === 'off') {
          await this.ha.callService('media_player', 'turn_on', { entity_id: id })
          return '开启'
        }
        await this.ha.callService('media_player', 'media_play', { entity_id: id })
        return '播放'
      }
      case 'lock': {
        const locked = curState === 'locked'
        await this.ha.callService('lock', locked ? 'unlock' : 'lock', { entity_id: id })
        return locked ? '开锁' : '上锁'
      }
      case 'cover': {
        const open = curState === 'open' || curState === 'opening'
        await this.ha.callService(
          'cover',
          open ? 'close_cover' : 'open_cover',
          { entity_id: id }
        )
        return open ? '关闭' : '打开'
      }
      case 'climate': {
        if (curState === 'off') {
          await this.ha.callService('climate', 'turn_on', { entity_id: id })
          return '开启'
        }
        await this.ha.callService('climate', 'turn_off', { entity_id: id })
        return '关闭'
      }
      case 'vacuum': {
        if (curState === 'cleaning' || curState === 'on') {
          await this.ha.callService('vacuum', 'return_to_base', { entity_id: id })
          return '回充'
        }
        await this.ha.callService('vacuum', 'start', { entity_id: id })
        return '开始清扫'
      }
      case 'valve': {
        const open = curState === 'open' || curState === 'opening'
        await this.ha.callService('valve', open ? 'close_valve' : 'open_valve', { entity_id: id })
        return open ? '关闭' : '打开'
      }
      default:
        throw new Error(`暂不支持控制：${domain}`)
    }
  }

  _collectDevices() {
    const cache = this.ha?.getCachedStates?.() || this.ha?.stateCache
    if (!cache || typeof cache.forEach !== 'function') return []
    const list = []
    cache.forEach((st, entityId) => {
      if (!entityId || entityId.startsWith('_')) return
      const domain = entityId.split('.')[0]
      // 只显示实体设备（灯/开关/空调/窗帘等），过滤传感器、自动化、辅助项
      if (!this._isDeviceDomain(domain)) return
      list.push({
        entity_id: entityId,
        domain,
        state: st?.state ?? '—',
        name: st?.attributes?.friendly_name || this._entityLabel(entityId) || entityId,
        unit: st?.attributes?.unit_of_measurement || '',
        device_class: st?.attributes?.device_class || '',
        unavailable: st?.state === 'unavailable' || st?.state === 'unknown',
        controllable: this._isToggleDomain(domain)
      })
    })
    list.sort((a, b) => {
      if (a.controllable !== b.controllable) return a.controllable ? -1 : 1
      if (a.domain !== b.domain) return a.domain.localeCompare(b.domain)
      return String(a.name).localeCompare(String(b.name), 'zh')
    })
    return list
  }

  _renderDevices() {
    const listEl = document.getElementById('dev-list')
    const filtersEl = document.getElementById('dev-filters')
    const metaEl = document.getElementById('dev-meta')
    if (!listEl) return

    const all = this._collectDevices()
    if (!all.length) {
      listEl.innerHTML = `<div class="log-empty">${
        this.ha?.isConnected?.() || this.ha?.connected ? '暂无设备' : '未连接米家'
      }</div>`
      if (metaEl) metaEl.textContent = '0 台'
      if (filtersEl) filtersEl.innerHTML = ''
      return
    }

    // 域统计
    const counts = new Map()
    for (const d of all) counts.set(d.domain, (counts.get(d.domain) || 0) + 1)
    const domains = [...counts.keys()].sort((a, b) => (counts.get(b) || 0) - (counts.get(a) || 0))

    if (filtersEl) {
      const ctrlCount = all.filter((d) => d.controllable).length
      const chips = [
        { id: 'all', label: `全部 ${all.length}` },
        { id: '__ctrl__', label: `可控制 ${ctrlCount}` },
        ...domains.slice(0, 12).map((dom) => {
          const m = this._domainMeta(dom)
          return { id: dom, label: `${m.icon} ${m.label} ${counts.get(dom)}` }
        })
      ]
      filtersEl.innerHTML = chips
        .map(
          (c) =>
            `<button type="button" class="dev-chip${this._devFilter === c.id ? ' active' : ''}" data-domain="${c.id}">${c.label}</button>`
        )
        .join('')
      filtersEl.querySelectorAll('.dev-chip').forEach((btn) => {
        btn.addEventListener('click', () => {
          this._devFilter = btn.dataset.domain || 'all'
          this._renderDevices()
        })
      })
    }

    const q = this._devSearch
    let filtered = all
    if (this._devFilter === '__ctrl__') {
      filtered = filtered.filter((d) => d.controllable)
    } else if (this._devFilter && this._devFilter !== 'all') {
      filtered = filtered.filter((d) => d.domain === this._devFilter)
    }
    if (q) {
      filtered = filtered.filter(
        (d) =>
          d.name.toLowerCase().includes(q) ||
          d.entity_id.toLowerCase().includes(q) ||
          d.domain.includes(q)
      )
    }

    if (metaEl) {
      const c = filtered.filter((d) => d.controllable && !d.unavailable).length
      metaEl.textContent = `显示 ${filtered.length} / 共 ${all.length} · 可点控 ${c}`
    }

    if (!filtered.length) {
      listEl.innerHTML = '<div class="log-empty">无匹配设备</div>'
      return
    }

    // 按域分组渲染
    let html = ''
    let lastDom = ''
    for (const d of filtered) {
      if (d.domain !== lastDom) {
        lastDom = d.domain
        const m = this._domainMeta(d.domain)
        const tip = d.controllable ? ' · 可点击控制' : ' · 只读'
        html += `<div class="dev-group-title">${m.icon} ${m.label}<span class="dev-group-tip">${tip}</span></div>`
      }
      const on =
        d.state === 'on' ||
        d.state === 'open' ||
        d.state === 'playing' ||
        d.state === 'home' ||
        d.state === 'locked' ||
        d.state === 'cleaning' ||
        d.state === 'heat' ||
        d.state === 'cool' ||
        d.state === 'auto' ||
        d.state === 'dry' ||
        d.state === 'fan_only'
      const canToggle = d.controllable && !d.unavailable
      const detail = this._isDetailDomain(d.domain)
      // 列表摘要：窗帘显示位置，空调显示设定温度
      let stateText = d.unit ? `${d.state}${d.unit}` : this._stateLabel(d.domain, d.state)
      const full = this.ha?.getState?.(d.entity_id)
      const attrs = full?.attributes || {}
      if (d.domain === 'cover') {
        const { current, target } = this._coverPositions(attrs, full || { state: d.state })
        stateText = current !== target ? `${current}%→${target}%` : `${current}%`
      } else if (d.domain === 'climate') {
        const t = attrs.temperature ?? attrs['target_temperature-2-3']
        const cur = attrs.current_temperature
        stateText =
          t != null
            ? `${this._hvacLabel(d.state)} · ${t}°`
            : this._hvacLabel(d.state)
        if (cur != null) stateText = `${cur}° · ${stateText}`
      } else if (d.domain === 'light' && attrs.brightness != null && d.state === 'on') {
        stateText = `${Math.round((Number(attrs.brightness) / 255) * 100)}%`
      }
      const actionHint = detail ? '详情' : canToggle ? '切换' : '只读'
      html += `
        <button type="button" class="dev-item${on ? ' on' : ''}${d.unavailable ? ' unavailable' : ''}${canToggle || detail ? ' tappable' : ' readonly'}"
          data-entity="${d.entity_id}" data-domain="${d.domain}" data-detail="${detail ? '1' : '0'}"
          ${canToggle || detail ? '' : 'disabled'}
          title="${detail ? '打开控制面板' : canToggle ? '点击控制' : '只读实体'}">
          <div class="dev-item-main">
            <div class="dev-name">${this._escapeHtml(d.name)}</div>
            <div class="dev-id">${d.entity_id}</div>
          </div>
          <div class="dev-right">
            <div class="dev-state">${this._escapeHtml(stateText)}</div>
            <div class="dev-action">${actionHint}</div>
          </div>
        </button>`
    }
    listEl.innerHTML = html

    listEl.querySelectorAll('.dev-item.tappable').forEach((btn) => {
      btn.addEventListener('click', async (ev) => {
        ev.preventDefault()
        const id = btn.dataset.entity
        const domain = btn.dataset.domain
        if (!id || !this.ha) {
          this._pushLog('无法控制：未连接')
          return
        }
        // 窗帘/空调/灯/风扇 → 详情控制面板
        if (btn.dataset.detail === '1' || this._isDetailDomain(domain)) {
          this._openDeviceDetail(id)
          return
        }
        if (!this.ha.isConnected?.() && !this.ha.connected) {
          this._pushLog(`${this._entityLabel(id)} · 未连接，尝试控制…`)
        }
        const st = this.ha.getState(id)
        const cur = st?.state
        const name = this._entityLabel(id)
        btn.classList.add('busy')
        this._pushLog(`${name} · 请求控制`)
        try {
          const action = await this._controlDevice(id, domain, cur)
          this._pushLog(`${name} · 已下发「${action}」`)
          // 米家乐观更新已够；少睡
          if (this.backend === 'ha') {
            await new Promise((r) => setTimeout(r, 700))
            try {
              await this.ha.fetchState(id, { force: true })
            } catch (_) {}
          } else {
            await new Promise((r) => setTimeout(r, 80))
          }
          this._renderDevices()
        } catch (e) {
          console.error(e)
          this._pushLog(`${name} · 失败：${e?.message || e}`)
        } finally {
          btn.classList.remove('busy')
        }
      })
    })
  }

  _escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  _tickClock() {
    const now = new Date()
    const h = now.getHours()
    // 参考图：不补零 7:25 + 上午/下午
    const hh = String(h)
    const mm = String(now.getMinutes()).padStart(2, '0')
    const timeEl = document.getElementById('panel-time')
    const periodEl = document.getElementById('panel-period')
    const dateEl = document.getElementById('panel-date')
    if (timeEl) timeEl.textContent = `${hh}:${mm}`
    if (periodEl) {
      // 凌晨 0–5 用「凌晨」；上午 5–12；下午 12–18；晚上 18–24
      let period = '上午'
      if (h < 5) period = '凌晨'
      else if (h < 12) period = '上午'
      else if (h < 18) period = '下午'
      else period = '晚上'
      periodEl.textContent = period
    }
    if (dateEl) {
      const m = now.getMonth() + 1
      const d = now.getDate()
      dateEl.textContent = `${m}月${d}日 星期${WEEKDAYS[now.getDay()]}`
    }
  }

  /** WeatherService / HA weather → 左栏图标+温度 */
  setWeather(data) {
    if (!data) return
    this._weatherData = data
    const icon = document.getElementById('wx-icon')
    const temp = document.getElementById('wx-temp')
    const cond = document.getElementById('wx-cond')
    if (icon) {
      icon.textContent = WEATHER_ICON[data.condition] || this._weatherEmoji(data.condition) || '⛅'
    }
    if (temp) {
      const t = data.temperature
      temp.textContent = t != null && t !== '' ? `${Math.round(Number(t))}°C` : '--°C'
    }
    if (cond) {
      // 只显示中文：优先 condition 映射，英文原文丢掉
      const zh = this._condLabel(data.condition)
      const raw = data.conditionText || ''
      const looksEnglish = /^[A-Za-z][A-Za-z\s/-]*$/.test(String(raw).trim())
      const text = looksEnglish || !raw ? zh : raw
      cond.textContent = text && text !== '--' ? text : ''
    }
  }

  _weatherEmoji(condition) {
    const map = {
      sunny: '☀️',
      'clear-night': '🌙',
      partlycloudy: '⛅',
      cloudy: '☁️',
      rainy: '🌧️',
      pouring: '🌧️',
      snowy: '❄️',
      fog: '🌫️',
      windy: '💨',
      lightning: '⛈️'
    }
    return map[condition] || '🌤️'
  }

  _getGreeting(now = new Date()) {
    const hour = now.getHours() + now.getMinutes() / 60
    const sun = this.ha?.getState?.('sun.sun')
    if (sun) {
      const above = sun.state === 'above_horizon'
      const elev = Number(sun.attributes?.elevation)
      const rising = !!sun.attributes?.rising

      if (!above) {
        if (hour >= 5 && hour < 9) return '早上好'
        if (hour >= 22 || hour < 5) return '夜深了'
        return '晚上好'
      }

      if (rising && (hour < 11 || elev < 40)) return '早上好'
      if (hour < 11) return '早上好'
      if (hour < 13.5 || (elev >= 45 && hour < 14)) return '中午好'
      if (hour < 18 || elev >= 12) return '下午好'
      return '晚上好'
    }

    if (hour >= 5 && hour < 11) return '早上好'
    if (hour < 14) return '中午好'
    if (hour < 18) return '下午好'
    if (hour < 22) return '晚上好'
    return '夜深了'
  }

  _bindInfoClicks() {
    const clockEl = document.getElementById('panel-clock')
    const weatherEl = document.getElementById('panel-weather')

    const openClock = () => this._openClockModal()
    const openWeather = (e) => {
      e?.stopPropagation?.()
      this._openWeatherModal()
    }

    if (clockEl) {
      clockEl.addEventListener('click', openClock)
      clockEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          openClock()
        }
      })
    }
    if (weatherEl) {
      weatherEl.addEventListener('click', openWeather)
      weatherEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          e.stopPropagation()
          openWeather(e)
        }
      })
    }
  }

  _renderEnv() {
    const root = document.getElementById('panel-env')
    if (!root) return
    root.innerHTML = ENV_METRICS.map(
      (m, i) => `
      <div class="env-cell" data-idx="${i}" role="button" tabindex="0" title="查看${m.name}">
        <div class="env-icon">${m.icon}</div>
        <div class="env-name">${m.name}</div>
        <div class="env-val" id="env-val-${i}">—</div>
      </div>`
    ).join('')

    root.querySelectorAll('.env-cell').forEach((cell) => {
      const open = () => this._openEnvModal(Number(cell.dataset.idx))
      cell.addEventListener('click', open)
      cell.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          open()
        }
      })
    })
  }

  _renderLights() {
    const root = document.getElementById('ctrl-lights')
    if (!root) return
    root.innerHTML = LIGHTS.map(
      (l) => `
      <button type="button" class="sw-btn" data-entity="${l.entity_id}" id="sw-${l.entity_id}">
        <span class="sw-dot"></span>
        <span class="sw-name">${l.name}</span>
      </button>`
    ).join('')

    root.querySelectorAll('.sw-btn').forEach((btn) => {
      btn.addEventListener('click', async (ev) => {
        ev.preventDefault()
        ev.stopPropagation()
        const id = btn.dataset.entity
        const name = btn.querySelector('.sw-name')?.textContent || id
        if (!this.ha) {
          this._pushLog(`${name} · 未连接，无法控制`)
          return
        }
        if (!this.ha.isConnected?.() && !this.ha.connected) {
          this._pushLog(`${name} · 未连接，尝试控制…`)
        }
        const st = this.ha.getState(id)
        const on = st?.state === 'on'
        const want = on ? 'off' : 'on'
        const action = on ? '关闭' : '开启'
        btn.classList.add('busy')
        // 立刻写日志，避免“点了没反应”
        this._pushLog(`${name} · 请求${action}`)
        try {
          await this.ha.callService('light', on ? 'turn_off' : 'turn_on', { entity_id: id })
          // 乐观 UI
          btn.classList.toggle('on', want === 'on')
          if (this.backend === 'ha') {
            await new Promise((r) => setTimeout(r, 900))
            let cur = this.ha.getState(id)
            if (!cur || cur.state === st?.state) {
              try {
                cur = await this.ha.fetchState(id, { force: true })
              } catch (_) {
                /* ignore */
              }
            }
            this._refreshFromCache()
            if (cur?.state === want) {
              this._pushLog(`${name} · 已${action}`, { source: 'ws' })
            } else {
              this._pushLog(
                `${name} · 已下发，设备状态未变（仍为 ${cur?.state || '未知'}；xiaomi_miot 常见假成功）`
              )
            }
          } else {
            // 米家：callService 已乐观回写
            this._refreshFromCache()
            this._pushLog(`${name} · 已${action}`)
          }
        } catch (e) {
          console.error(e)
          this._pushLog(`${name} · 操作失败：${e?.message || e}`)
          this._refreshFromCache()
        } finally {
          btn.classList.remove('busy')
        }
      })
    })
  }

  _renderScenes() {
    const root = document.getElementById('ctrl-scenes')
    if (!root) return
    root.innerHTML = SCENES.map(
      (s) => `
      <button type="button" class="sc-btn ${s.primary ? 'primary' : ''}" data-scene="${s.id}" data-icon="${s.icon || '◦'}">${s.name}</button>`
    ).join('')

    root.querySelectorAll('.sc-btn').forEach((btn) => {
      btn.addEventListener('click', async (ev) => {
        ev.preventDefault()
        ev.stopPropagation()
        const scene = SCENES.find((s) => s.id === btn.dataset.scene)
        if (!scene) return
        if (!this.ha) {
          this._pushLog(`场景 · ${scene.name}：未连接`)
          return
        }
        btn.classList.add('busy')
        this._pushLog(`场景 · ${scene.name} · 已下发`)
        try {
          await this.ha.callService(scene.domain, scene.service, { entity_id: scene.entities })
        } catch (e) {
          console.error(e)
          this._pushLog(`场景 · ${scene.name} 失败：${e?.message || e}`)
        } finally {
          btn.classList.remove('busy')
        }
      })
    })
  }

  _refreshFromCache() {
    if (!this.ha) return
    for (const l of LIGHTS) {
      const btn = document.getElementById(`sw-${l.entity_id}`)
      const st = this.ha.getState(l.entity_id)
      if (!btn) continue
      const on = st?.state === 'on'
      btn.classList.toggle('on', on)
      btn.classList.toggle('unavailable', !st || st.state === 'unavailable' || st.state === 'unknown')
    }

    const wx = this.ha.getState(WEATHER_ENTITY)
    if (wx) {
      const icon = document.getElementById('wx-icon')
      const cond = document.getElementById('wx-cond')
      const temp = document.getElementById('wx-temp')
      if (icon) icon.textContent = WEATHER_ICON[wx.state] || '⛅'
      if (cond) cond.textContent = this._condLabel(wx.state)
      if (temp) {
        const t = wx.attributes?.temperature
        temp.textContent = t != null ? `${t}°C` : '--°C'
      }
      const fc = document.getElementById('wx-forecast')
      if (fc) {
        const days = wx.attributes?.forecast?.slice?.(0, 4) || []
        if (days.length) {
          fc.innerHTML = days
            .map((d) => {
              const dt = d.datetime ? new Date(d.datetime) : null
              const label = dt ? WEEKDAYS[dt.getDay()].replace('星期', '') : ''
              const hi = d.temperature ?? d.templow ?? '—'
              const lo = d.templow ?? '—'
              return `<div class="fc-day"><div>${label}</div><div>${WEATHER_ICON[d.condition] || '☁️'}</div><div class="fc-t">${hi}°/${lo}°</div></div>`
            })
            .join('')
        }
      }
    }

    ENV_METRICS.forEach((m, i) => {
      const el = document.getElementById(`env-val-${i}`)
      if (!el) return
      if (!m.entity_id) {
        el.textContent = '—'
        return
      }
      const st = this.ha.getState(m.entity_id)
      if (!st || st.state === 'unavailable' || st.state === 'unknown') {
        el.textContent = '—'
        return
      }
      if (m.attr) {
        const v = st.attributes?.[m.attr]
        el.textContent = v != null ? `${v}${m.unit || ''}` : '—'
      } else {
        el.textContent = `${st.state}${m.unit || ''}`
      }
    })
  }

  _openClockModal() {
    const now = new Date()
    const hh = String(now.getHours()).padStart(2, '0')
    const mm = String(now.getMinutes()).padStart(2, '0')
    const ss = String(now.getSeconds()).padStart(2, '0')
    const y = now.getFullYear()
    const m = String(now.getMonth() + 1).padStart(2, '0')
    const d = String(now.getDate()).padStart(2, '0')
    this._showModal({
      title: '时间与日期',
      body: `
        <div class="ha-modal-big">${hh}:${mm}<span style="font-size:22px;opacity:.55">:${ss}</span></div>
        <div class="ha-modal-sub">${y}年${m}月${d}日 · ${WEEKDAYS[now.getDay()]}</div>
        <div class="ha-modal-row"><span class="ha-modal-k">问候</span><span class="ha-modal-v">${this._getGreeting(now)}</span></div>
        <div class="ha-modal-row"><span class="ha-modal-k">时区</span><span class="ha-modal-v">${Intl.DateTimeFormat().resolvedOptions().timeZone || 'local'}</span></div>
        <div class="ha-modal-row"><span class="ha-modal-k">本地时间戳</span><span class="ha-modal-v">${now.toLocaleString('zh-CN')}</span></div>
      `
    })
  }

  _openWeatherModal() {
    const wx = this.ha?.getState?.(WEATHER_ENTITY)
    if (!wx) {
      this._showModal({
        title: '天气',
        body: `<div class="ha-modal-sub">暂无天气数据（需连接 HA / 有效令牌）</div>`
      })
      return
    }
    const a = wx.attributes || {}
    const temp = a.temperature != null ? `${a.temperature}°C` : '—'
    const humidity = a.humidity != null ? `${a.humidity}%` : '—'
    const pressure = a.pressure != null ? `${a.pressure} hPa` : '—'
    const wind = a.wind_speed != null ? `${a.wind_speed} ${a.wind_speed_unit || ''}`.trim() : '—'
    const days = a.forecast?.slice?.(0, 4) || []
    const fcHtml = days.length
      ? `<div class="ha-modal-forecast">${days
          .map((d) => {
            const dt = d.datetime ? new Date(d.datetime) : null
            const label = dt ? WEEKDAYS[dt.getDay()] : ''
            const hi = d.temperature ?? '—'
            const lo = d.templow ?? '—'
            return `<div class="ha-modal-fc"><div>${label}</div><div style="font-size:20px;margin:4px 0">${WEATHER_ICON[d.condition] || '☁️'}</div><div>${hi}° / ${lo}°</div></div>`
          })
          .join('')}</div>`
      : ''

    this._showModal({
      title: '天气详情',
      body: `
        <div class="ha-modal-big">${WEATHER_ICON[wx.state] || '⛅'} ${temp}</div>
        <div class="ha-modal-sub">${this._condLabel(wx.state)}</div>
        <div class="ha-modal-row"><span class="ha-modal-k">体感/气温</span><span class="ha-modal-v">${temp}</span></div>
        <div class="ha-modal-row"><span class="ha-modal-k">湿度</span><span class="ha-modal-v">${humidity}</span></div>
        <div class="ha-modal-row"><span class="ha-modal-k">气压</span><span class="ha-modal-v">${pressure}</span></div>
        <div class="ha-modal-row"><span class="ha-modal-k">风速</span><span class="ha-modal-v">${wind}</span></div>
        <div class="ha-modal-row"><span class="ha-modal-k">实体</span><span class="ha-modal-v">${WEATHER_ENTITY}</span></div>
        ${fcHtml}
      `
    })
  }

  _openEnvModal(idx) {
    const m = ENV_METRICS[idx]
    if (!m) return
    const st = m.entity_id ? this.ha?.getState?.(m.entity_id) : null
    let value = '—'
    let unit = m.unit || ''
    let extra = ''
    if (st && st.state !== 'unavailable' && st.state !== 'unknown') {
      if (m.attr) {
        const v = st.attributes?.[m.attr]
        value = v != null ? String(v) : '—'
      } else {
        value = String(st.state)
        unit = unit || st.attributes?.unit_of_measurement || ''
      }
      // 绑定名优先：配置 source_name → 设备 friendly_name → 指标名
      const boundName =
        m.source_name ||
        st.attributes?.friendly_name ||
        m.name ||
        '已绑定'
      extra = `
        <div class="ha-modal-row"><span class="ha-modal-k">来源</span><span class="ha-modal-v">${this._escapeHtml(boundName)}</span></div>
        <div class="ha-modal-row"><span class="ha-modal-k">更新</span><span class="ha-modal-v">${st.last_changed ? new Date(st.last_changed).toLocaleString('zh-CN') : '—'}</span></div>
      `
    } else if (!m.entity_id) {
      extra = `<div class="ha-modal-sub">尚未绑定传感器</div>`
    } else {
      const boundName = m.source_name || m.name || m.entity_id
      extra = `<div class="ha-modal-sub">暂不可用：${this._escapeHtml(boundName)}</div>`
    }

    this._showModal({
      title: `${m.icon} ${m.name}`,
      body: `
        <div class="ha-modal-big">${value}<span style="font-size:20px;opacity:.6">${value !== '—' ? unit : ''}</span></div>
        ${extra}
      `
    })
  }

  _showModal({ title, body, wide = false, onReady = null }) {
    this._closeModal()
    const backdrop = document.createElement('div')
    backdrop.className = 'ha-modal-backdrop'
    backdrop.innerHTML = `
      <div class="ha-modal${wide ? ' wide' : ''}" role="dialog" aria-modal="true" aria-label="${this._escapeHtml(title)}">
        <div class="ha-modal-head">
          <div class="ha-modal-title">${this._escapeHtml(title)}</div>
          <button type="button" class="ha-modal-close" aria-label="关闭">×</button>
        </div>
        <div class="ha-modal-body">${body}</div>
      </div>
    `
    const close = () => this._closeModal()
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close()
    })
    backdrop.querySelector('.ha-modal-close')?.addEventListener('click', close)
    const onKey = (e) => {
      if (e.key === 'Escape') close()
    }
    this._modalKeyHandler = onKey
    document.addEventListener('keydown', onKey)
    document.body.appendChild(backdrop)
    this._modalEl = backdrop
    const modalBody = backdrop.querySelector('.ha-modal-body')
    if (typeof onReady === 'function' && modalBody) onReady(modalBody)
  }

  _closeModal() {
    if (this._modalKeyHandler) {
      document.removeEventListener('keydown', this._modalKeyHandler)
      this._modalKeyHandler = null
    }
    if (this._modalEl) {
      this._modalEl.remove()
      this._modalEl = null
    }
    this._modalEntityId = null
  }

  _condLabel(state) {
    const map = {
      sunny: '晴',
      'clear-night': '晴',
      partlycloudy: '多云',
      cloudy: '阴',
      rainy: '雨',
      pouring: '大雨',
      snowy: '雪',
      fog: '雾',
      windy: '大风',
      lightning: '雷阵雨',
      'lightning-rainy': '雷雨',
      exceptional: '异常'
    }
    return map[state] || '多云'
  }

  destroy() {
    clearInterval(this._clockTimer)
    if (this._unsub) this._unsub()
    if (this._unsubConn) this._unsubConn()
    if (this._onBannerResize) {
      window.removeEventListener('resize', this._onBannerResize)
      this._onBannerResize = null
    }
    if (this._onDocClick) {
      document.removeEventListener('click', this._onDocClick)
      this._onDocClick = null
    }
    if (this._onMenuKey) {
      document.removeEventListener('keydown', this._onMenuKey)
      this._onMenuKey = null
    }
    this._closeModal()
  }
}

export default DashboardShell
