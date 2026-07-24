#!/usr/bin/env bash
# 一键部署 ha-homeui 到 Home Assistant /local，并自动改 iframe 版本号
# 用法：
#   ./deploy-to-ha.sh              # 默认用时间戳路径 3d-home-YYYYMMDDHHMM
#   ./deploy-to-ha.sh v5           # 指定版本目录名后缀
#   VER=v5 HA_HOST=10.10.10.202 ./deploy-to-ha.sh
#
# 关键：HA 对 /config/www 静态文件默认 Cache-Control: max-age≈31天
# 所以每次必须换「目录或 query」，让仪表盘 iframe 指向新 URL，用户无需清缓存。

set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
HA_HOST="${HA_HOST:-10.10.10.202}"
HA_SSH_USER="${HA_SSH_USER:-root}"
SSH_OPTS="-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o BatchMode=yes -o ConnectTimeout=15"
DASHBOARDS="${DASHBOARDS:-lovelace.dashboard_future,lovelace.dashboard_3d}"

# 版本名：参数 > 环境变量 > 时间戳
VER="${1:-${VER:-$(date +%Y%m%d%H%M)}}"
# 只保留安全字符
VER="$(echo "$VER" | tr -cd 'A-Za-z0-9._-')"
DIR_NAME="3d-home-${VER}"
# query 再带一次，双重破缓存
Q="v=${VER}-$(date +%s)"
IFRAME_URL="/local/${DIR_NAME}/index.html?${Q}"
REMOTE_WWW="/config/www/${DIR_NAME}"

echo "==> build"
cd "$ROOT"
npm run build

echo "==> prepare remote ${REMOTE_WWW}"
ssh $SSH_OPTS "${HA_SSH_USER}@${HA_HOST}" "rm -rf '${REMOTE_WWW}' && mkdir -p '${REMOTE_WWW}'"

echo "==> rsync dist"
rsync -az -e "ssh $SSH_OPTS" \
  --exclude '.DS_Store' \
  "$ROOT/dist/" "${HA_SSH_USER}@${HA_HOST}:${REMOTE_WWW}/"

echo "==> runtime token + first-paint bg + cache meta"
ssh $SSH_OPTS "${HA_SSH_USER}@${HA_HOST}" bash -s -- "$DIR_NAME" <<'REMOTE'
set -euo pipefail
DIR_NAME="$1"
DEST="/config/www/${DIR_NAME}"
# 复用已有 token 配置（不进 git）
for src in \
  /config/www/3d-home-v4/ha-runtime-config.js \
  /config/www/3d-home-v3/ha-runtime-config.js \
  /config/www/3d-home-v2/ha-runtime-config.js \
  /config/www/3d-home/ha-runtime-config.js
do
  if [ -f "$src" ]; then
    cp "$src" "${DEST}/ha-runtime-config.js"
    break
  fi
done
f="${DEST}/index.html"
# 强首屏底色，避免 iframe 白闪
if ! grep -q 'color-scheme:dark' "$f"; then
  sed -i 's|<html lang="zh-CN">|<html lang="zh-CN" style="background:#262b2f!important;color-scheme:dark">|' "$f"
fi
if ! grep -q 'body style=' "$f"; then
  sed -i 's|<body>|<body style="background:#262b2f!important;margin:0">|' "$f"
fi
if ! grep -q 'no-cache' "$f"; then
  sed -i 's|<meta name="viewport"|<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">\n  <meta http-equiv="Pragma" content="no-cache">\n  <meta name="viewport"|' "$f"
fi
# JS/CSS 引用加 query，进一步破缓存（相对路径仍有效）
python3 - <<'PY'
from pathlib import Path
import re, time
f = Path("/config/www/'''"$DIR_NAME"'''/index.html".replace("'''",""))
# DIR_NAME comes from outer; use DEST env
import os
f = Path(os.environ.get("DEST", "/config/www/3d-home-v5") + "/index.html")
t = f.read_text()
q = "b=%d" % int(time.time())
t2 = re.sub(
    r'(src=")(\./assets/[^"]+\.js)(")',
    lambda m: m.group(1) + m.group(2) + ("?" + q if "?" not in m.group(2) else "") + m.group(3) if "?" not in m.group(2) else m.group(0),
    t,
)
# simpler replace
def add_q(m):
    url = m.group(2)
    if "?" in url:
        return m.group(0)
    return m.group(1) + url + "?" + q + m.group(3)
t2 = re.sub(r'(src=")(\./assets/[^"]+\.js)(")', add_q, t)
t2 = re.sub(r'(href=")(\./assets/[^"]+\.css)(")', add_q, t2)
f.write_text(t2)
print("index asset query ok", q)
PY
echo "deployed files:"
ls -la "$DEST" | head
REMOTE

echo "==> rewrite dashboard iframes -> ${IFRAME_URL}"
ssh $SSH_OPTS "${HA_SSH_USER}@${HA_HOST}" bash -s -- "$IFRAME_URL" "$DASHBOARDS" <<'REMOTE'
set -euo pipefail
IFRAME_URL="$1"
IFS=',' read -r -a DASHES <<< "$2"
python3 - <<PY
import json
from pathlib import Path
NEW = """${IFRAME_URL}"""
STYLE = """
      ha-card {
        background: #262b2f !important;
        border: none;
        box-shadow: none;
        overflow: hidden;
        border-radius: 16px;
        height: calc(100vh - 120px);
        min-height: 520px;
      }
      iframe {
        width: 100%;
        height: calc(100vh - 120px);
        min-height: 520px;
        border: none;
        border-radius: 16px;
        background: #262b2f !important;
      }
"""
names = """${DASHBOARDS}""".split(",")
for name in names:
    name = name.strip()
    if not name:
        continue
    p = Path("/config/.storage") / name
    if not p.exists():
        print("skip missing", p)
        continue
    d = json.loads(p.read_text())
    cfg = d.get("data", {}).get("config")
    if not cfg:
        print("skip no config", name)
        continue
    n = 0
    stack = [cfg]
    while stack:
        o = stack.pop()
        if isinstance(o, dict):
            if o.get("type") == "iframe" and "3d-home" in str(o.get("url", "")):
                o["url"] = NEW
                o["card_mod"] = {"style": STYLE}
                n += 1
            stack.extend(o.values())
        elif isinstance(o, list):
            stack.extend(o)
    cfg["background"] = "#262b2f"
    for v in cfg.get("views") or []:
        if isinstance(v, dict):
            v["background"] = "#262b2f"
    # backup once
    bak = Path(str(p) + ".bak-deploy")
    if not bak.exists():
        bak.write_text(json.dumps(d, ensure_ascii=False, indent=2))
    p.write_text(json.dumps(d, ensure_ascii=False, indent=2) + "\n")
    print(name, "iframe patches", n, "->", NEW)
print("storage ok")
PY
REMOTE

echo "==> soft reload resources (core restart only if needed)"
# 优先不重启：用户刷新侧边栏即可；storage 文件改完后新开会读到新 url
# 若仍旧，可手动: ha core restart

echo "==> verify"
ssh $SSH_OPTS "${HA_SSH_USER}@${HA_HOST}" \
  "curl -sS -m 8 -o /dev/null -w 'http %{http_code}\n' http://127.0.0.1:8123/local/${DIR_NAME}/index.html; \
   grep -o '3d-home[^\"]*' /config/.storage/lovelace.dashboard_3d | head -3; \
   grep -o '262b2f' /config/www/${DIR_NAME}/index.html | head -3"

cat <<EOF

✅ 部署完成（用户无需清缓存）
  静态目录: /config/www/${DIR_NAME}
  iframe:   ${IFRAME_URL}
  仪表盘:   未来之家 + 3D 控制中心 已改 URL

请用户：关掉旧标签 → 重新打开「3D 控制中心」或「未来之家」
（新 URL 会绕过 31 天静态缓存；一般不用 Ctrl+F5）

若极少数仍旧：侧边栏切走再切回，或 App 杀进程重开。
EOF
