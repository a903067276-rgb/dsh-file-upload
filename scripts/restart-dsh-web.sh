#!/bin/bash
# ============================================================
# restart-dsh-web.sh — 重启 dsh web：杀当前端口进程 → 等一会 → 重开
#
# 浏览器无需刷新：DSH 客户端有断线自动重连（指数退避），
# 页面短暂显示"重连中"，服务起来后自动恢复，当前会话/草稿不丢。
#
# 用法:
#   ./scripts/restart-dsh-web.sh              # 默认端口 3080
#   DSH_WEB_PORT=8080 ./scripts/restart-dsh-web.sh
# ============================================================
set -euo pipefail

PORT="${DSH_WEB_PORT:-3080}"
DSH_BIN="${DSH_BIN:-/Users/xinbanzhuan/.npm-global/bin/dsh}"
LOG_FILE="${DSH_LOG_DIR:-$HOME/.dsh/logs}/dsh-web.log"

find_pid() {
  lsof -t -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | head -1 || true
}

# ---- 1. 杀掉当前端口进程（先 SIGTERM 优雅退出，5 秒未退再强杀）----
PID="$(find_pid)"
if [ -n "$PID" ]; then
  echo "==> 停止 dsh web (pid $PID)"
  kill -TERM "$PID" 2>/dev/null || true
  for _ in $(seq 1 5); do
    if ! kill -0 "$PID" 2>/dev/null; then break; fi
    sleep 1
  done
  if kill -0 "$PID" 2>/dev/null; then
    echo "==> 5 秒未退出，强制结束"
    kill -KILL "$PID" 2>/dev/null || true
    sleep 1
  fi
fi

# ---- 2. 等端口完全释放 ----
for _ in $(seq 1 10); do
  if [ -z "$(find_pid)" ]; then break; fi
  sleep 1
done

# ---- 3. 重开（后台 + 日志）----
echo "==> 启动 dsh web (port $PORT)"
mkdir -p "$(dirname "$LOG_FILE")"
nohup "$DSH_BIN" web --port "$PORT" >> "$LOG_FILE" 2>&1 &
NEW_PID=$!

# ---- 4. 等就绪（新进程独占端口）----
for _ in $(seq 1 30); do
  OWNER="$(find_pid)"
  if [ "$OWNER" = "$NEW_PID" ]; then
    echo "==> dsh web 已就绪: http://127.0.0.1:$PORT (pid $NEW_PID)"
    echo "==> 浏览器无需刷新，页面会自动重连"
    exit 0
  fi
  if ! kill -0 "$NEW_PID" 2>/dev/null && [ -n "$OWNER" ]; then
    echo "!! 新实例启动失败且端口仍被 pid $OWNER 占用，日志: $LOG_FILE" >&2
    exit 1
  fi
  sleep 1
done

echo "!! dsh web 启动失败（30 秒内未就绪），日志: $LOG_FILE" >&2
exit 1
