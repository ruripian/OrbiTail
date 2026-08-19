# Tier 3 — 문서 도메인 추가 기능 6종 설계

작성일: 2026-08-19 / 선행 문서: `2026-08-19_document-space-settings-gap.md`
대상 브랜치: `feat/admin-console-overhaul`

Tier 1(설정 4탭) · Tier 2(역할 권한)는 출하 완료. 이 문서는 그때 범위에서 뺀 6가지를
**각각 독립 실행 가능한 단위**로 설계한다. 순서는 권장 착수 순.

---

## 0. 공통 전제

- 권한 판정은 `apps/documents/views.py:_space_role()` 하나로 모여 있다.
  새 API는 전부 `_check_space_access`(VIEWER+) / `_check_space_edit`(EDITOR+) / `_check_space_admin`(ADMIN) 을 재사용한다.
- 스페이스 설정은 4탭(`일반 / 멤버 / 콘텐츠 / 연동`). 새 UI는 **탭을 늘리지 않고** 기존 탭 안에 섹션으로 넣는 것을 기본으로 한다.
  (탭이 8개가 되면 프로젝트 설정을 7→4로 줄인 PASS4-3 의 결정을 되돌리는 셈)
- 프론트 폭은 `max-w-regular` 토큰을 쓴다.

---

## 1. 문서 라벨 ★ 가장 효용이 큼

### 현황
- 이슈에는 `apps/issues/models.py:6 Label` 이 있다 — `name`, `color`, `project` FK. 프로젝트 단위.
- **문서에는 분류 수단이 전혀 없다.** 트리(폴더)와 제목 검색이 전부다.
- Confluence 에서 라벨은 스페이스를 가로지르는 핵심 분류 축이다.

### 설계
```python
# apps/documents/models.py
class DocumentLabel(models.Model):
    """문서 라벨 — 워크스페이스 단위.

    이슈 Label 이 project FK 인 것과 달리 workspace 단위로 둔다. 문서는 스페이스를 가로질러
    묶이는 게 정상이고(회의록·정책·회고), 스페이스마다 같은 라벨을 다시 만들게 하면 의미가 없다.
    """
    id        = UUIDField(pk)
    workspace = FK("workspaces.Workspace", related_name="document_labels")
    name      = CharField(max_length=100)
    color     = CharField(max_length=7, default="#6b7280")
    created_by= FK(User, null=True, SET_NULL)
    created_at= DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "document_labels"
        unique_together = [("workspace", "name")]   # 같은 이름 중복 생성 방지

# Document 에 추가
labels = ManyToManyField(DocumentLabel, blank=True, related_name="documents")
```

**이슈 Label 을 재사용하지 않는 이유**: 이슈 Label 은 `project` FK 필수라 독립 스페이스 문서에 붙일 수 없고,
색 기본값·정렬 규칙도 다르다. 억지로 공유하면 `project=null` 예외 분기가 양쪽에 번진다.

### API
| 메서드 | 경로 | 권한 |
|---|---|---|
| GET/POST | `/workspaces/<slug>/documents/labels/` | 조회=워크스페이스 멤버, 생성=워크스페이스 멤버 |
| PATCH/DELETE | `/workspaces/<slug>/documents/labels/<id>/` | 워크스페이스 ADMIN 또는 생성자 |
| PATCH | 기존 문서 상세에 `labels: [id]` 추가 | EDITOR+ |

검색 확장: `DocumentSearchView` 에 `?labels=id,id` 추가 (`views.py:554`).
현재 `title/content_html icontains` 만 있으므로 `.filter(labels__in=...)` 한 줄.

### UI
1. 문서 편집 화면 제목 아래 라벨 칩 + 추가 팝오버 (`DocumentSpacePage`)
2. 스페이스 설정 → **콘텐츠 탭에 "라벨" 섹션** (이름·색 편집, 사용 문서 수, 삭제)
3. 문서 탐색기/검색에 라벨 필터 — `ProjectFilterDropdown` 과 같은 형태의 드롭다운

### 마이그레이션 / 리스크
- 신규 테이블 + M2M(auto table). 기존 데이터 영향 없음
- 리스크: 낮음. 다만 `unique_together` 때문에 이름 중복 시 400 을 UI 에서 안내해야 함
- 작업량: 백엔드 소(모델+CRUD+검색 1줄), 프론트 중(3곳)

### 검증
1. 라벨 생성 → 문서에 부착 → 검색 `?labels=` 로 그 문서만 나오는지
2. 라벨 삭제 시 문서는 남고 연결만 끊기는지(M2M 이므로 자동)
3. 다른 워크스페이스 라벨이 목록에 섞이지 않는지

---

## 2. 스페이스 전용 템플릿

### 현황
`DocumentTemplate.Scope` = `built_in` / `workspace` / `user` (`models.py:298~`).
스페이스 단위가 없어서, 특정 스페이스에서만 쓰는 양식도 워크스페이스 전체에 노출된다.

### 설계
```python
class Scope(models.TextChoices):
    BUILT_IN  = "built_in"
    WORKSPACE = "workspace"
    SPACE     = "space"      # 신규
    USER      = "user"

space = FK(DocumentSpace, null=True, blank=True, on_delete=CASCADE, related_name="templates")
```
- 목록 필터(`DocumentTemplateListCreateView`, `views.py:916~`)에 `Q(scope=SPACE, space_id=<현재 스페이스>)` 추가
- 생성 권한: 해당 스페이스 EDITOR+ (워크스페이스 scope 는 지금처럼 워크스페이스 OWNER/ADMIN)
- 템플릿 선택 다이얼로그(`TemplatePickerDialog`)는 현재 스페이스를 알고 있으므로 파라미터만 추가

### 마이그레이션 / 리스크
- `space` nullable FK 추가 + choices 확장. 기존 행 영향 없음
- 리스크: 낮음. 단 **스페이스 삭제 시 템플릿도 CASCADE 삭제**되는 점을 UI 경고 문구에 포함
- 작업량: 백엔드 소, 프론트 소

### 검증
스페이스 A에서 만든 템플릿이 A의 새 문서 다이얼로그에만 보이고 B에는 안 보이는지

---

## 3. 홈 문서 지정

### 현황
스페이스에 들어가면 문서 목록만 뜬다. Confluence 는 스페이스마다 홈(개요) 페이지가 있다.

### 설계
```python
# DocumentSpace 에 추가
home_document = FK("Document", null=True, blank=True, on_delete=SET_NULL, related_name="+")
```
- 설정 → **일반 탭에 "홈 문서" 선택** (스페이스 내 문서 드롭다운, 해제 가능)
- `/:ws/documents/space/:spaceId` 진입 시 `home_document` 가 있으면 그 문서를 연다
  (라우팅 변경 없이 `DocumentSpacePage` 안에서 초기 선택만 바꾸면 됨)
- 홈 문서가 삭제되면 `SET_NULL` 로 자동 해제

### 리스크
- `related_name="+"` 로 역참조를 만들지 않아야 `Document.documentspace_set` 같은 혼란이 안 생긴다
- 순환 참조 주의: `DocumentSpace` → `Document` FK 는 문자열 참조(`"Document"`)로 선언
- 작업량: 백엔드 소(필드 1개), 프론트 소

### 검증
홈 문서 지정 후 스페이스 재진입 시 그 문서가 열리고, 그 문서를 삭제하면 목록 화면으로 되돌아가는지

---

## 4. 스페이스 구독(알림)

### 현황
- 알림 인프라는 갖춰져 있다: `Notification`(type/recipient/actor/workspace/issue), `NotificationPreference`,
  `ProjectNotificationPreference`(프로젝트별 mute), 발송은 `notifications/signals.py` 시그널.
- **`Notification` 에 문서 FK 가 없다.** type 도 이슈·댓글·가입 위주다.
- 문서 댓글은 WebSocket 브로드캐스트(`_broadcast_thread_event`)만 하고 알림은 남기지 않는다.

### 설계
```python
# notifications/models.py — Type 확장
DOC_UPDATED   = "doc_updated",   "Document Updated"
DOC_COMMENTED = "doc_commented", "Document Commented"

# Notification 에 추가 (issue 와 같은 방식)
document = FK("documents.Document", null=True, blank=True, on_delete=CASCADE, related_name="notifications")

# documents/models.py
class DocumentSpaceSubscription(models.Model):
    """스페이스 구독 — 이 스페이스의 문서 변경·댓글을 알림으로 받는다."""
    user       = FK(User, related_name="space_subscriptions")
    space      = FK(DocumentSpace, related_name="subscriptions")
    notify_updates  = BooleanField(default=True)
    notify_comments = BooleanField(default=True)
    class Meta:
        db_table = "document_space_subscriptions"
        unique_together = [("user", "space")]
```
- 발송: `documents/views.py` 의 문서 저장 / 댓글 생성 지점에서 구독자 조회 후 `Notification` 생성.
  **작성자 본인은 제외**(자기 변경으로 자기 알림이 오면 소음).
- UI: 스페이스 헤더에 종 아이콘 토글 + 설정 → 일반 탭에 세부(변경/댓글) 스위치

### 리스크 — 이 항목이 6개 중 가장 크다
- **알림 폭주**: 활발한 스페이스는 문서 저장마다 알림이 쏟아진다.
  → 저장 단위가 아니라 **문서별 30분 디바운스**(마지막 알림 이후 30분 내 중복 생략)를 넣어야 실사용 가능.
- 실시간 협업(Yjs) 저장이 잦아 디바운스 없이는 확실히 시끄럽다.
- 기존 알림 토스트 누수 차단 로직(2026-06-08 user-scoped 처리)과 충돌하지 않는지 확인 필요.
- 작업량: 백엔드 중(모델 2 + 시그널/발송 + 디바운스), 프론트 소

### 검증
1. 구독 후 다른 사람이 문서를 고치면 알림이 오고, 내가 고치면 안 오는지
2. 연속 저장 10회에 알림이 1건인지(디바운스)
3. 구독 해제 후 알림이 끊기는지

---

## 5. 스페이스 내보내기

### 현황
- 문서 하나를 HTML 파일로 받는 기능은 있다 — `DocumentSpacePage.tsx:332 exportDocx`
  (이름은 docx 지만 실제로는 **HTML 다운로드**다. 함수명이 내용과 다르다.)
- 스페이스 단위 일괄 내보내기는 없다.

### 설계 — 백엔드에서 zip 생성
```
GET /workspaces/<slug>/documents/spaces/<id>/export/   → application/zip
```
- Python 표준 `zipfile` + `io.BytesIO` 로 메모리 생성 → **새 라이브러리 불필요**
  (프론트에서 만들면 `jszip` 설치가 필요하고, 브라우저 메모리도 부담)
- 구성: `문서제목.html` 을 트리 구조 그대로 폴더로 재현 + `index.html`(목차)
- 권한: VIEWER+ (읽을 수 있으면 내보낼 수 있다)
- 파일명 충돌·경로 문자 처리: 슬러그화 + 중복 시 `-2` 접미

### 리스크
- 문서가 많은 스페이스에서 응답이 커진다 → 문서 수 상한(예: 500) 후 초과 시 안내.
  **상한을 두면 반드시 응답에 명시**한다(하드컷을 조용히 하지 않는다는 기존 원칙).
- 첨부 이미지는 절대 URL 로 남긴다(파일까지 넣으면 크기가 급증). 로그인 없이는 안 보인다는 점을 안내.
- 작업량: 백엔드 중, 프론트 소(버튼 하나)

### 검증
폴더 3단 깊이 문서를 만든 뒤 내보내 압축 구조가 트리와 일치하는지, 한글 파일명이 깨지지 않는지

---

## 6. 조회 분석

### 현황
조회 기록 모델이 없다. `updated_at` 만 있어 "누가 얼마나 봤는지"는 전혀 모른다.

### 설계
```python
class DocumentView(models.Model):
    """문서 조회 기록 — 사용자·문서·일자 단위로 1행(같은 날 여러 번 봐도 카운트만 증가)."""
    document  = FK(Document, related_name="views")
    user      = FK(User, null=True, SET_NULL)
    viewed_on = DateField()          # 날짜 단위 집계 — 타임스탬프를 다 쌓으면 금방 수천만 행
    count     = PositiveIntegerField(default=1)
    class Meta:
        db_table = "document_views"
        unique_together = [("document", "user", "viewed_on")]
        indexes = [Index(fields=["document", "-viewed_on"])]
```
- 기록: 문서 상세 GET 시 `update_or_create` + `F("count") + 1`
- 집계 API: `GET /spaces/<id>/analytics/?days=30` → 인기 문서 Top N, 총 조회수, 조회자 수
- UI: 설정 → 콘텐츠 탭에 "많이 본 문서" 섹션 (별도 탭 만들지 않음)

### 리스크
- **쓰기 부하**: 문서 열 때마다 UPSERT. 날짜 단위로 묶어 행 증가를 억제했지만,
  그래도 읽기 경로에 쓰기가 붙는다. 트래픽이 커지면 비동기(Celery)로 옮겨야 한다 — celery 는 이미 떠 있다.
- **프라이버시**: "누가 봤는지"를 어디까지 노출할지 결정 필요. 기본은 **집계만 노출**(개인 조회 이력 비공개)을 권장.
- 6개 중 **효용 대비 비용이 가장 낮다**. 마지막에 하거나 생략해도 무방.
- 작업량: 백엔드 중, 프론트 소

### 검증
같은 문서를 하루에 5번 열면 행 1개·count 5 인지, 다음 날 열면 행이 하나 더 생기는지

---

## 7. 권장 순서와 판단

| 순서 | 기능 | 효용 | 비용 | 리스크 |
|---|---|---|---|---|
| 1 | 문서 라벨 | ★★★ | 중 | 낮음 |
| 2 | 홈 문서 지정 | ★★ | 소 | 낮음 |
| 3 | 스페이스 템플릿 | ★★ | 소 | 낮음 |
| 4 | 내보내기 | ★★ | 중 | 중(응답 크기) |
| 5 | 구독 알림 | ★★ | 중 | **높음(알림 폭주)** |
| 6 | 조회 분석 | ★ | 중 | 중(쓰기 부하·프라이버시) |

- **1~3 은 함께 해도 서로 간섭하지 않는다** (모델이 겹치지 않고 UI 위치도 다르다).
- **4~6 은 각각 독립 착수**를 권한다. 특히 5번은 디바운스 설계를 먼저 합의해야 한다.
- 6번은 "있으면 좋은" 축이라 **하지 않는 선택도 합리적**이다.

---

## 8. 결정 사항 (사용자 확정)

1. **착수 범위**: 구독 알림(4번)만 제외하고 **나머지 5종 전부**
2. **라벨 범위**: 워크스페이스 단위 (권장안)
3. **조회 분석**: 집계만 노출, 개인 조회 이력 비공개 (권장안)
4. 구독 알림은 미착수 — 이 문서의 설계는 그대로 두어 나중에 착수할 때 쓴다

---

## 9. 구현 결과 (2026-08-19)

### 백엔드 — 마이그레이션 `0020_tier3_labels_home_templates_views`
| 기능 | 변경 |
|---|---|
| 라벨 | `DocumentLabel`(workspace 단위, `unique_together(workspace, name)`) + `Document.labels` M2M |
| | `DocumentLabelListCreateView` — **같은 이름이면 새로 만들지 않고 기존 라벨 반환**(분류가 갈라지지 않게) |
| | `DocumentLabelDetailView` — 수정·삭제는 생성자 또는 워크스페이스 관리자 |
| | `DocumentSearchView` 에 `?labels=id,id` (조인 중복 때문에 `distinct()` 필수) |
| 홈 문서 | `DocumentSpace.home_document` FK(`SET_NULL`, `related_name="+"`) |
| 스페이스 템플릿 | `Scope.SPACE` + `DocumentTemplate.space` FK. 목록은 **`?space=` 를 준 경우에만** 노출, 생성·삭제는 그 스페이스 EDITOR+ |
| 내보내기 | `SpaceExportView` — 표준 `zipfile` 로 트리 구조 재현 + `index.html`. 상한 500개, **자른 사실을 index 에 명시** |
| 조회 분석 | `DocumentView`(문서·사용자·일자 1행, count 증가) + `SpaceAnalyticsView`(Top 10·총 조회·조회자 수) |

- 조회 기록은 `DocumentDetailView.retrieve()` 에서 남기되 **예외를 삼킨다** — 통계는 부수 기능이라
  실패가 문서 조회를 막으면 안 된다.
- 내보내기 파일명은 RFC 5987(`filename*=UTF-8''`)로 내려 한글이 깨지지 않게 했다.

### 프론트
- **`components/documents/DocumentLabelPicker.tsx` 신설** — 라벨을 다루는 곳의 단일 컴포넌트.
  `LabelChip`(칩 렌더) + `DocumentLabelPicker`(검색·토글·즉석 생성)를 함께 제공하고,
  새 라벨 색은 `LABEL_COLORS` 를 돌아가며 자동 배정한다.
- 문서 편집 화면: 제목 메타 아래 라벨 줄(편집 권한자만 부착·해제, 읽기 모드에서는 칩만)
- 탐색기: 라벨 필터 — **필터가 걸리면 폴더 경계를 넘어 스페이스 전체에서 찾는다**
  (라벨은 트리와 다른 분류 축이라 폴더 안만 뒤지면 의미가 없다)
- 설정 · 일반: 홈 문서 선택
- 설정 · 콘텐츠: 라벨 관리(이름·색 인라인 편집, 사용 문서 수, 삭제) / 많이 본 문서 / zip 내보내기 / 템플릿(범위 배지)
- `SaveAsTemplateDialog` 에 "이 스페이스" 범위 추가

### 검증 (실데이터 end-to-end)
1. 라벨 생성 201 → 같은 이름 재요청 200(중복 생성 없음, 총 1개)
2. 문서에 라벨 부착 → `?labels=` 검색이 그 문서만 반환
3. 홈 문서 지정 200 → 스페이스 진입 시 `Navigate replace` 로 그 문서를 연다
4. 스페이스 템플릿: 목록이 `?space=` 없을 때 6건 / 있을 때 7건 — 지정 시에만 노출됨
5. 조회 3회 → 행 1개·count 3, 통계 API 가 Top 문서·조회자 수 반환
6. export 200 `application/zip` 8,936 bytes
7. `manage.py check` 이상 없음, 프론트 `npm run build` 통과
   (검증용으로 만든 템플릿·홈문서·라벨 연결은 모두 원복)

### 남은 것
- **구독 알림** — 미착수. 3장 4번 설계 참조(디바운스 합의가 선행돼야 함)
- 브라우저 확인: 라벨 칩 부착/해제, 탐색기 라벨 필터, 홈 문서 진입, zip 내려받기
