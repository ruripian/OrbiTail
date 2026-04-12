#!/usr/bin/env bash
# 버전 bump — root VERSION → backend/VERSION → frontend/VERSION → frontend/package.json
# 사용:
#   scripts/bump-version.sh patch   # 0.1.0 → 0.1.1
#   scripts/bump-version.sh minor   # 0.1.0 → 0.2.0
#   scripts/bump-version.sh major   # 0.1.0 → 1.0.0
#   scripts/bump-version.sh 1.2.3   # 명시적
#
# 동작:
#   1) 4 곳의 VERSION을 동일하게 갱신
#   2) CHANGELOG.md 상단에 새 버전 헤더 추가 (편집 안내)
#   3) git add + commit "chore(release): vX.Y.Z" + tag vX.Y.Z
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ $# -lt 1 ]; then
  echo "usage: $0 <patch|minor|major|X.Y.Z>" >&2
  exit 1
fi

current=$(cat VERSION | tr -d '[:space:]')
IFS='.' read -r MAJ MIN PAT <<< "$current"

case "$1" in
  patch) new="$MAJ.$MIN.$((PAT + 1))" ;;
  minor) new="$MAJ.$((MIN + 1)).0" ;;
  major) new="$((MAJ + 1)).0.0" ;;
  *)
    if [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      new="$1"
    else
      echo "invalid bump type: $1" >&2; exit 1
    fi
    ;;
esac

echo "bump: $current → $new"

echo "$new" > VERSION
echo "$new" > backend/VERSION
echo "$new" > frontend/VERSION

# package.json — node로 안전하게 갱신
node -e '
  const fs = require("fs");
  const p = "frontend/package.json";
  const j = JSON.parse(fs.readFileSync(p, "utf-8"));
  j.version = process.argv[1];
  fs.writeFileSync(p, JSON.stringify(j, null, 2) + "\n");
' "$new"

# CHANGELOG 헤더 추가 — 사용자가 편집할 수 있도록 빈 섹션 삽입
today=$(date +%Y-%m-%d)
tmp=$(mktemp)
{
  head -n 3 CHANGELOG.md
  echo
  echo "## [$new] — $today"
  echo
  echo "### Added"
  echo "- "
  echo
  echo "### Fixed"
  echo "- "
  tail -n +4 CHANGELOG.md
} > "$tmp"
mv "$tmp" CHANGELOG.md

echo "✓ files updated. CHANGELOG.md 에 변경 항목을 채운 뒤:"
echo "    git add VERSION backend/VERSION frontend/VERSION frontend/package.json CHANGELOG.md"
echo "    git commit -m \"chore(release): v$new\""
echo "    git tag -a v$new -m \"v$new\""
