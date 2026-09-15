from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView

from ..authentication import ApiTokenAuthentication
from ..permissions import TokenScopePermission
from ..throttling import ApiTokenRateThrottle


class V1Pagination(PageNumberPagination):
    """`?page=2&page_size=100`. 응답은 {count, next, previous, results}."""

    page_size = 50
    page_size_query_param = "page_size"
    max_page_size = 100


class PublicApiView(APIView):
    """v1 뷰의 바탕. 워크스페이스는 URL 이 아니라 토큰에서 온다(`self.workspace`)."""

    authentication_classes = [ApiTokenAuthentication]
    permission_classes = [IsAuthenticated, TokenScopePermission]
    throttle_classes = [ApiTokenRateThrottle]

    @property
    def workspace(self):
        return self.request.auth.workspace

    def paginate(self, queryset, serializer_class):
        paginator = V1Pagination()
        page = paginator.paginate_queryset(queryset, self.request, view=self)
        data = serializer_class(page, many=True, context={"request": self.request}).data
        return paginator.get_paginated_response(data)
