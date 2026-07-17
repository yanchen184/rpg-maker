#!/bin/bash
# 依序(一次一個)用 codex CLI 生素材 sprite sheet,狀態寫 assets/raw/queue-status.log
# 用法: tools/gen-queue.sh <name> [<name> ...]   (name 對應 assets/prompts/<name>.txt)
set -uo pipefail
ROOT="/Users/yanchen/workspace/rpg-maker"
RAW="$ROOT/assets/raw"
STATUS="$RAW/queue-status.log"
mkdir -p "$RAW"

for NAME in "$@"; do
  PROMPT_FILE="$ROOT/assets/prompts/$NAME.txt"
  OUT="$RAW/${NAME}_sheet.png"
  LOG="$RAW/${NAME}.codex.log"
  if [ ! -f "$PROMPT_FILE" ]; then
    echo "$(date +%T) FAIL $NAME (no prompt file)" >>"$STATUS"
    continue
  fi
  if [ -f "$OUT" ]; then
    echo "$(date +%T) SKIP $NAME (already exists)" >>"$STATUS"
    continue
  fi
  echo "$(date +%T) START $NAME" >>"$STATUS"
  codex exec "$(cat "$PROMPT_FILE")" </dev/null >"$LOG" 2>&1
  SID=$(grep -oE 'session id: [0-9a-f-]+' "$LOG" | head -1 | awk '{print $3}')
  SRC=""
  if [ -n "${SID:-}" ]; then
    SRC=$(ls -t "$HOME/.codex/generated_images/$SID/"*.png 2>/dev/null | head -1)
  fi
  if [ -n "${SRC:-}" ]; then
    cp "$SRC" "$OUT"
    # 物件/角色類素材去背(floor/wall 不透明,STRIP=0 跳過)
    if [ "${STRIP:-1}" = "1" ]; then
      python3 "$ROOT/tools/strip-bg.py" "$OUT" >>"$STATUS" 2>&1
    fi
    echo "$(date +%T) DONE $NAME <- $SRC" >>"$STATUS"
  else
    echo "$(date +%T) FAIL $NAME (sid=${SID:-none}, no image produced)" >>"$STATUS"
  fi
done
echo "$(date +%T) QUEUE_COMPLETE" >>"$STATUS"
