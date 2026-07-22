#!/bin/bash
# 相容 wrapper:管線本體已抽到 packages/asset-pipeline/tools/(可跨專案共用)。
# 舊呼叫習慣 tools/gen-queue.sh <name>... 照舊可用,專案根即本 repo。
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export RPG_PROJECT_ROOT="$(dirname "$SELF_DIR")"
exec "$SELF_DIR/../packages/asset-pipeline/tools/gen-queue.sh" "$@"
