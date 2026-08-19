from rest_framework.pagination import PageNumberPagination


class StandardPagination(PageNumberPagination):
    """일반 사용자 목록 API 공통 페이지네이션.

    무한 스크롤(?page 순차 요청)과 "한 화면에 N개만" 위젯을 같은 뷰로 처리하기 위한 것.
    ?page_size 로 호출 측이 분량을 정하되 상한을 둬서, 뷰마다 "최근 N개만" 같은
    임의 하드컷(그 뒤 데이터에 아예 접근 못 하는 상태)을 넣을 이유를 없앤다.

    관리자 콘솔은 상한이 더 큰 별도 정책(apps.admin_console.pagination.AdminPagination)을 쓴다.
    """

    page_size = 20
    page_size_query_param = "page_size"
    max_page_size = 100
