"""관리자 콘솔 목록 API 공통 베이스.

콘솔의 모든 목록은 검색 · 필터 · 정렬 · 페이지네이션을 같은 방식으로 제공한다.
뷰마다 이걸 손으로 구현하면 어딘가는 반드시 빠지고(그래서 첨부 검색이 200개 하드컷이었다),
쿼리 파라미터 이름도 조금씩 달라진다. 여기서 한 번만 정의한다.
"""
from datetime import datetime, time

from django.db.models import Q
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime
from rest_framework import generics
from rest_framework.exceptions import ValidationError

from apps.accounts.permissions import IsSuperUser

from .pagination import AdminPagination


# ── filter_spec 에서 쓰는 값 변환기 ──────────────────────────────
# 잘못된 입력은 500 이 아니라 400 으로 돌려준다. 관리자가 URL 을 손으로 고치는 일이 흔하다.

def _aware(value: datetime) -> datetime:
    """USE_TZ=True 환경이라 naive datetime 을 그대로 필터에 넣으면 경고 + 경계가 어긋난다."""
    return timezone.make_aware(value) if timezone.is_naive(value) else value


def as_datetime(raw: str):
    """ISO 날짜/일시 문자열 → aware datetime. 날짜만 오면 그 날 00:00 으로 본다."""
    value = parse_datetime(raw)
    if value is None:
        date_only = parse_date(raw)
        if date_only is None:
            raise ValidationError(f"날짜 형식이 올바르지 않습니다: {raw}")
        value = datetime.combine(date_only, time.min)
    return _aware(value)


def as_datetime_end(raw: str):
    """종료일 필터용 — 날짜만 오면 그 날의 끝(23:59:59.999999)으로 본다.

    날짜만 준 '~8/13' 을 8/13 00:00 으로 해석하면 8/13 하루가 통째로 빠져
    "어제까지만 나온다"는 버그로 보인다.
    """
    value = parse_datetime(raw)
    if value is None:
        date_only = parse_date(raw)
        if date_only is None:
            raise ValidationError(f"날짜 형식이 올바르지 않습니다: {raw}")
        value = datetime.combine(date_only, time.max)
    return _aware(value)


def as_int(raw: str) -> int:
    try:
        return int(raw)
    except (TypeError, ValueError):
        raise ValidationError(f"숫자가 필요합니다: {raw}")


def as_bool(raw: str) -> bool:
    lowered = str(raw).strip().lower()
    if lowered in ("1", "true", "yes"):
        return True
    if lowered in ("0", "false", "no"):
        return False
    raise ValidationError(f"true/false 가 필요합니다: {raw}")


class AdminResourceListView(generics.ListAPIView):
    """슈퍼유저 콘솔 목록 뷰의 공통 부모.

    하위 클래스가 선언하는 것:
      - queryset 또는 get_queryset()  — 뷰 고유의 기본 범위와 프리셋 조건
      - serializer_class
      - search_fields    : ?search= 를 OR 로 매칭할 ORM lookup 목록
      - filter_spec      : {쿼리파라미터: ORM lookup} 또는 {파라미터: (lookup, 변환기)}
      - ordering_allow   : ?ordering= 으로 허용할 필드 (하위호환/성능 때문에 화이트리스트)
      - default_ordering : ordering 파라미터가 없을 때의 정렬

    페이지네이션은 베이스에 고정되어 있어 하위 클래스에서 [:N] 슬라이스를 넣을 자리가 없다.
    """

    permission_classes = [IsSuperUser]
    pagination_class = AdminPagination

    search_fields: list[str] = []
    filter_spec: dict = {}
    ordering_allow: list[str] = []
    default_ordering: str = "-created_at"

    def filter_queryset(self, queryset):
        queryset = super().filter_queryset(queryset)
        queryset = self._apply_search(queryset)
        queryset = self._apply_filters(queryset)
        return self._apply_ordering(queryset)

    def _apply_search(self, queryset):
        term = self.request.query_params.get("search", "").strip()
        if not term or not self.search_fields:
            return queryset
        condition = Q()
        for field in self.search_fields:
            condition |= Q(**{f"{field}__icontains": term})
        return queryset.filter(condition)

    def _apply_filters(self, queryset):
        for param, spec in self.filter_spec.items():
            raw = self.request.query_params.get(param)
            if raw is None or raw == "":
                continue
            lookup, convert = spec if isinstance(spec, tuple) else (spec, None)
            queryset = queryset.filter(**{lookup: convert(raw) if convert else raw})
        return queryset

    def _apply_ordering(self, queryset):
        requested = self.request.query_params.get("ordering", "").strip()
        if requested:
            field = requested.lstrip("-")
            if field not in self.ordering_allow:
                raise ValidationError(
                    f"정렬할 수 없는 필드입니다: {field} "
                    f"(가능: {', '.join(self.ordering_allow) or '없음'})"
                )
            return queryset.order_by(requested)
        return queryset.order_by(self.default_ordering) if self.default_ordering else queryset
