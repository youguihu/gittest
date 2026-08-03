#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

for f in bin/www package.json server/app.js server/TradeLogQueryServer.conf server/client/public/index.html; do
  if [ ! -f "$f" ]; then
    echo "缺少必需文件: $f" >&2
    exit 1
  fi
done

HASH="$(git rev-parse --short HEAD 2>/dev/null || echo nogit)"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT_DIR="$ROOT/dist"
mkdir -p "$OUT_DIR"
OUT="$OUT_DIR/tradelogqueryserver-$HASH-$STAMP.tgz"

tar -czf "$OUT" \
  --exclude='.git' --exclude='.idea' --exclude='dist' --exclude='data' \
  --exclude='*.log' --exclude='scripts/build-taf.ps1' --exclude='scripts/build-taf.sh' \
  bin package.json package-lock.json server

echo "打包完成: $OUT"
echo "包大小: $(du -h "$OUT" | cut -f1)"
echo "--- 包内顶层结构 ---"
tar -tzf "$OUT" | awk -F/ '{print $1}' | sort -u
