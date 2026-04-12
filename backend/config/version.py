"""애플리케이션 버전 — 루트 `/VERSION`이 단일 source of truth.

`scripts/bump-version.sh`가 root VERSION → backend/VERSION → frontend/package.json
세 곳을 함께 갱신. 백엔드는 `BASE_DIR/VERSION`(=/app/VERSION)에서 읽음.
환경변수 `APP_VERSION`이 있으면 그것이 우선(정적 빌드/배포 환경 대응).
"""
from __future__ import annotations

import os
import subprocess
from functools import lru_cache
from pathlib import Path

from django.conf import settings
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView


@lru_cache(maxsize=1)
def get_version() -> str:
    env_v = os.environ.get("APP_VERSION", "").strip()
    if env_v:
        return env_v
    candidates = [
        Path(settings.BASE_DIR) / "VERSION",
        Path(settings.BASE_DIR).resolve().parent / "VERSION",
    ]
    for p in candidates:
        try:
            text = p.read_text(encoding="utf-8").strip()
            if text:
                return text
        except OSError:
            continue
    return "0.0.0"


@lru_cache(maxsize=1)
def get_commit() -> str | None:
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=Path(settings.BASE_DIR).resolve().parent,
            capture_output=True,
            text=True,
            timeout=2,
            check=True,
        )
        return out.stdout.strip() or None
    except (FileNotFoundError, subprocess.SubprocessError):
        return None


class VersionView(APIView):
    """공개 엔드포인트 — 인증 불필요"""

    permission_classes = [AllowAny]

    def get(self, request):
        return Response(
            {
                "version": get_version(),
                "commit": get_commit(),
                "repo": "https://github.com/ruripian/OrbiTail",
            }
        )
