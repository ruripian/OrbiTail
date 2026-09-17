"""요청을 보낸 실제 클라이언트 IP.

리버스 프록시 뒤에서는 REMOTE_ADDR 가 바로 앞 프록시(nginx)라 모든 요청이 같은
IP 로 보인다. 진짜 주소는 X-Forwarded-For 에 있는데, 이 헤더는 클라이언트가
마음대로 채워 보낼 수 있다. 믿을 수 있는 건 **우리 프록시가 덧붙인 항목**뿐이고,
그건 오른쪽 끝에 있다.

    클라이언트가 위조한 값 …, 첫 번째 우리 프록시가 본 주소, …, 마지막 프록시가 본 주소

그래서 앞단 신뢰 프록시 수(TRUSTED_PROXY_COUNT)만큼 오른쪽에서 센다.
    nginx 만                → 1   (XFF[-1] = nginx 가 본 주소)
    Caddy → nginx           → 2   (XFF[-2] = Caddy 가 본 주소)
    0 (기본)                → XFF 를 믿지 않고 REMOTE_ADDR

규칙은 DRF 의 NUM_PROXIES 와 같다 — settings 에서 같은 값을 넘기므로 스로틀,
로그인 잠금 기록(axes), 데모 발급 제한이 같은 주소를 본다.

한계: 앞단 프록시를 건너뛰고 직접 들어오는 경로가 있으면(XFF 항목이 설정보다
적으면) 맨 왼쪽 값, 즉 위조 가능한 값을 쓰게 된다. DRF 도 같다. 백엔드·nginx 를
바깥에 직접 열지 않는 것이 전제다.
"""

from django.conf import settings


def client_ip(request) -> str:
    remote = request.META.get("REMOTE_ADDR", "") or ""
    count = getattr(settings, "TRUSTED_PROXY_COUNT", 0)
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR")
    if count <= 0 or not forwarded:
        return remote
    addrs = [a.strip() for a in forwarded.split(",") if a.strip()]
    if not addrs:
        return remote
    return addrs[-min(count, len(addrs))]
