"""v1 스키마만 따로 뽑기 위한 urlconf — 내부 API 가 공개 문서에 섞이지 않게 한다."""
from django.urls import include, path

urlpatterns = [path("api/v1/", include("apps.api.urls_v1"))]
