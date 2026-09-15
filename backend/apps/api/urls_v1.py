"""공개 API v1 — 여기에 올린 것만 외부 계약이다.

내부 API(/api/workspaces/…)는 화면을 위해 자유롭게 바뀐다. 그걸 그대로 열면 내부 리팩터가
곧 외부 연동 파괴가 되므로, 외부에 약속할 것만 이 파일에 따로 올린다.
"""
from django.urls import path

from .views import V1MeView

urlpatterns = [
    path("me/", V1MeView.as_view(), name="v1-me"),
]
