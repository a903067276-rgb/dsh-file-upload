#!/bin/bash
# ============================================================
# restart-dsh-web.sh — 重启 dsh web：杀端口监听者 → 等端口释放 → 重开
#
# 设计（防"自己搞死自己"，借鉴 ~/.dsh/restart-self.sh）：
#   1. 脚本自我 detached：前台调用立即返回，实际工作转入后台独立进程
#      （nohup 脱离 DSH 进程树，DSH 被杀后脚本照跑，agent 调用不卡死）
#   2. 只杀 LISTEN 状态监听者（lsof -sTCP:LISTEN），不动浏览器客户端连接
#   3. 杀完等端口释放 → 起新进程（绝对路径）→ curl 轮询 200 → 写日志
#
# 浏览器无需刷新：DSH 客户端有断线自动重连，页面短暂"重连中"后自动恢复。
#
# 用法:
#   ./scripts/restart-dsh-web.sh              # 默认端口 3080
#   DSH_WEB_PORT=8080 ./scripts/restart-dsh-web.sh
#
# 日志: /tmp/dsh-restart.log（本脚本）/ /tmp/dsh-web.log（DSH 本体）
# ============================================================
set -euo pipefail

PORT="${DSH_WEB_PORT:-3080}"
DSH_BIN="${DSH_BIN:-/Users/xinbanzhuan/.npm-global/bin/dsh}"
LOG=/tmp/dsh-restart.log
WEBLOG=/tmp/dsh-web.log

# ---- 0. 自我 detached：未 detach 时先转入后台，调用方立即返回 ----
if [ "${RESTART_DETACHED:-}" != "1" ]; then
  RESTART_DETACHED=1 nohup bash "$0" "$@" > /dev/null 2>&1 &
  echo "==> 重启已在后台进行（detached），日志: $LOG；约 10~30 秒后服务恢复，浏览器自动重连"
  exit 0
fi

listener() {
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null | tr '\n' ' '
}

{
  echo "=== $(date '+%F %T') restart begin (port $PORT) ==="
  echo "old listener: $(listener)"

  # 缓冲期：让调用方 shell 先退出/回复完用户
  sleep 2

  # ---- 1. 杀旧监听者（只杀 LISTEN；SIGTERM 优雅退出，10 秒未退再强杀）----
  OLD="$(listener)"
  if [ -n "$OLD" ]; then
    # shellcheck disable=SC2086
    kill $OLD 2>/dev/null || true
    for _ in $(seq 1 10); do
      [ -z "$(listener)" ] && break
      sleep 1
    done
    STILL="$(listener)"
    if [ -n "$STILL" ]; then
      echo "==> 优雅退出超时，强制结束: $STILL"
      # shellcheck disable=SC2086
      kill -KILL $STILL 2>/dev/null || true
    fi
  fi

  # ---- 2. 等端口完全释放（最多 20 秒）----
  for _ in $(seq 1 20); do
    [ -z "$(listener)" ] && break
    sleep 1
  done

  # ---- 3. 起新进程（绝对路径，后台 + 日志）----
  nohup "$DSH_BIN" web --port "$PORT" > "$WEBLOG" 2>&1 &

  # ---- 4. 等健康（最多 60 秒，200 即成功）----
  code=""
  for _ in $(seq 1 30); do
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 "http://127.0.0.1:$PORT/" 2>/dev/null || true)
    [ "$code" = "200" ] && break
    sleep 2
  done

  echo "new listener: $(listener)"
  echo "final http_code: ${code:-none}"
  echo "=== restart end ==="
} >> "$LOG" 2>&1
