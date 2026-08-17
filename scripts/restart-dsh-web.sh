#!/bin/bash
# ============================================================
# restart-dsh-web.sh — 自动重启 dsh web（插件安装/更新后使用）
#
# 原则：优雅停止（SIGTERM → 等待会话落盘）→ 重新拉起 → 健康检查。
# 会话数据持久化在 ~/.dsh/sessions/，重启后浏览器回到同一会话即可继续。
#
# 用法:
#   ./scripts/restart-dsh-web.sh              # 默认端口 3080
#   DSH_WEB_PORT=8080 ./scripts/restart-dsh-web.sh
#
# 可调环境变量:
#   DSH_BIN         dsh 可执行文件路径（默认 /Users/xinbanzhuan/.npm-global/bin/dsh）
#   DSH_WEB_PORT    监听端口（默认 3080）
#   DSH_WAIT_SECONDS 停止/启动等待秒数（默认 30）
# ============================================================
set -euo pipefail

DSH_BIN="${DSH_BIN:-/Users/xinbanzhuan/.npm-global/bin/dsh}"
LOG_DIR="${DSH_LOG_DIR:-$HOME/.dsh/logs}"
LOG_FILE="$LOG_DIR/dsh-web.log"
PORT="${DSH_WEB_PORT:-3080}"
WAIT="${DSH_WAIT_SECONDS:-30}"

mkdir -p "$LOG_DIR"

# ---- 1. 优雅停止现有 dsh web 进程 ----
# 按端口找监听进程（lsof 可靠）；pgrep 在受限 shell 中可能看不到宿主进程
find_pid() {
  lsof -t -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | head -1 || true
}
PID="$(find_pid)"
if [ -z "$PID" ]; then
  PID="$(pgrep -f 'node .*/dsh web' | head -1 || true)"
fi
if [ -n "$PID" ]; then
  echo "==> 优雅停止 dsh web (pid $PID)"
  kill -TERM "$PID" 2>/dev/null || true
  for _ in $(seq 1 "$WAIT"); do
    if ! kill -0 "$PID" 2>/dev/null; then break; fi
    sleep 1
  done
  if kill -0 "$PID" 2>/dev/null; then
    echo "==> 优雅停止超时（${WAIT}s），强制结束"
    kill -KILL "$PID" 2>/dev/null || true
    sleep 1
  fi
fi

# ---- 2. 重新拉起（后台 + 日志）----
echo "==> 启动 dsh web (port $PORT)"
nohup "$DSH_BIN" web --port "$PORT" >> "$LOG_FILE" 2>&1 &
NEW_PID=$!

# ---- 3. 健康检查：等新进程独占端口（避免旧进程未杀净时误判）----
for _ in $(seq 1 "$WAIT"); do
  OWNER="$(find_pid)"
  if [ -n "$OWNER" ] && [ "$OWNER" = "$NEW_PID" ]; then
    echo "==> dsh web 已就绪: http://127.0.0.1:$PORT (pid $NEW_PID)"
    exit 0
  fi
  # 新进程已死且端口仍被其他进程占用 → 提前报错
  if ! kill -0 "$NEW_PID" 2>/dev/null && [ -n "$OWNER" ]; then
    echo "!! 新实例已退出且端口被 pid $OWNER 占用，日志: $LOG_FILE" >&2
    exit 1
  fi
  sleep 1
done

echo "!! dsh web 启动失败（${WAIT} 秒内未就绪），日志: $LOG_FILE" >&2
exit 1
