from rest_framework.pagination import PageNumberPagination


class AdminPagination(PageNumberPagination):
    """관리자 콘솔 목록 공통 페이지네이션.

    ?page_size 로 조절은 허용하되 상한을 둔다. 관리자는 "한 번에 많이 보기"가 필요하지만
    무제한을 허용하면 수만 건 테이블에서 DB 를 밀어버린다. 상한이 있으면 뷰마다
    "최근 N개만" 같은 임의 하드컷을 넣을 이유가 사라진다.
    """

    page_size = 50
    page_size_query_param = "page_size"
    max_page_size = 200
