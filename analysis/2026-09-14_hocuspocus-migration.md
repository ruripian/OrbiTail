# 실시간 협업 서버를 Hocuspocus 로 — 서버가 문서를 읽을 수 있게 만들기

작성일: 2026-09-14 / 선행: `2026-09-14_notion-db-and-public-api.md`

## 1. 왜 했나

"노션처럼 만드는 게 낫지 않나"에서 출발해, 축이 둘이라는 걸 정리한 결과다.

|  | 구조를 서버가 아는가 | 병합을 누가 하는가 |
|---|---|---|
| 전 | ✗ | Yjs |
| **후 (이번 작업)** | **✓** | **Yjs (그대로)** |
| 노션·구글식 | ✓ | 직접 구현 |

세 번째로 가지 않은 이유는 품질이다. 동시편집 병합을 직접 떠안으면 잘해야 본전이고 못하면
사용자가 타이핑을 잃는다 — 노션조차 같은 문단 안 동시편집은 구글 문서보다 약하다.
가운데 자리는 그 위험을 지지 않으면서 **서버가 문서를 읽고 쓸 수 있게** 한다.

이게 열어주는 것(전부 이 하나를 기다리고 있었다): 블록 참조·트랜스클루전, 문단 단위 공개 API,
AI 기능(브라우저가 켜져 있지 않아도), 내용 기반 검색, 자동화에서 문서 쓰기, 구조적 버전 비교.

## 2. 한 일

### 2-1. 스키마를 한 벌로 — `frontend/src/components/documents/doc-schema.ts`

17개 커스텀 노드·마크 정의를 React 노드뷰에서 떼어냈다.

```
doc-schema.ts    스키마 목록 한 벌   ← 서버와 브라우저가 같이 쓰는 단 하나의 원본
DocumentEditor   목록 + NODE_VIEWS   ← "이 노드는 이 React 컴포넌트로 그린다"만 얹음
```

**드리프트를 구조적으로 막았다.** 에디터가 자기 목록을 따로 갖지 않고 `docExtensions()` 를 받아
노드뷰만 덧입히므로, 한쪽에만 노드를 추가하는 사고가 일어날 수 없다.

스키마를 파이썬으로 다시 구현하지 않은 것이 이 설계의 핵심이다 — 그랬다면 같은 문법이 두 언어에
생겨 영원히 어긋날 위험을 안는다. Node 서버라서 **진짜 TipTap 스키마를 그대로 불러 쓴다.**

`DocumentEditor.tsx` 는 2660 → 2296줄.

### 2-2. 협업 서버 — `frontend/collab/server.ts`

frontend 패키지 **안에** 두었다. node_modules 와 TipTap 버전을 프론트와 한 벌로 쓰기 위해서다.

| 훅 | 하는 일 |
|---|---|
| `onAuthenticate` | 사용자 JWT 를 Django 에 그대로 물어본다 — **권한 규칙은 Django 한 곳에만** 있다. 편집 권한이 없으면 `readOnly` 로 붙인다 |
| `onLoadDocument` | 저장된 Yjs 상태를 싣는다. 없으면 `content_html` 로 **서버가 시드한다** |
| `onStoreDocument` | Yjs 상태와 **서버가 만든 HTML** 을 한 번에 저장 |

Node 에는 DOM 이 없어 TipTap 의 HTML 파싱·직렬화가 둘 다 실패한다. jsdom 으로 최소 전역만
채우되 **다른 import 보다 먼저** 해야 한다(TipTap 로드 시점에 이미 있어야 한다).

### 2-3. Django 내부 엔드포인트 — `apps/documents/collab_views.py`

- `GET  /api/internal/collab/documents/<id>/auth/` — 사용자 JWT 로 판정
- `GET/POST /api/internal/collab/documents/<id>/state/` — 공유 비밀(`COLLAB_SHARED_SECRET`)로 보호

인증을 둘로 나눈 이유: 열람 허가는 **사용자 본인 토큰**으로 물어야 하고, 저장은 연결이 끊긴 뒤에도
일어나므로 사용자 토큰으로 할 수 없다. 비밀값이 비어 있으면 내부 엔드포인트는 **항상 403** —
설정을 빠뜨린 채 열려 있는 상태가 가장 나쁘다.

### 2-4. 덤으로 고쳐진 것

**본문이 두 벌이고 하나가 최대 2초 낡던 문제.** 전에는 브라우저가 2초마다 `content_html` 을
REST 로 덮어썼다. 이제 서버가 같은 순간의 Y.Doc 에서 `yjs_state` 와 `content_html` 을 함께
만들어 한 번에 저장한다 — 둘이 어긋날 수 없다.

브라우저의 자동저장은 **협업 연결이 서지 않았을 때만** 돈다. 협업 서버가 죽어 있어도 타이핑이
날아가지 않게 남긴 안전망이다. 붙어 있을 때 쓰면 같은 값을 두 번 쓰고 순서 문제까지 생긴다.

**시드 경합도 사라졌다.** 전에는 "먼저 접속한 브라우저"가 HTML 을 Y.Doc 에 뿌렸고, 동시에
들어오면 누가 뿌릴지 겨루는 문제가 있어 300ms 지연으로 완화해야 했다. 서버가 하면 경합 자체가 없다.

### 2-5. 배선

- 개발: vite 프록시 `/collab` → `ws://collab:1234`, compose 에 `collab` 서비스
- 운영: `nginx.conf` 에 `/collab` 블록, `docker-compose.prod.yml` 에 `collab` + `Dockerfile.collab`
- **Caddy 변경 없음** — 협업 서버는 내부 전용이고 기존 프론트 경로(같은 오리진)로만 닿는다

## 3. 검증

**스키마가 같은가 (가장 중요)** — `doc-schema.server.test.ts`
실제 DB 에서 뽑은 문서의 `yjs_state`(브라우저가 협업하며 쌓은 바이너리)를 **브라우저 없이**
공용 스키마만으로 HTML 로 만들어, 브라우저가 저장한 `content_html` 과 대조 → **완전 일치**.
고정 자료를 저장소에 박아 두었으므로 앞으로도 계속 지킨다.

**스키마 잠금** — `doc-schema.test.ts` 가 노드 33종·마크 11종 이름을 고정. 실수로 노드가 빠지면
그 노드가 든 기존 문서가 열릴 때 조용히 사라지는데, 그 사고가 여기서 걸린다.
(이 테스트를 쓰다가 내 손으로 적은 목록에서 `inlineMath` 가 빠진 걸 실제로 잡았다.)

**end-to-end (실제 서버 + 실제 토큰 + 실제 문서)**

| 확인 | 결과 |
|---|---|
| 엉터리 토큰 | 거부됨 |
| Yjs 상태 없는 문서 | 서버가 `content_html` 로 시드, 클라이언트가 전체 본문 수신 |
| 두 클라이언트 수렴 | A 가 쓴 줄이 B 에 그대로 — HTML 동일 |
| 저장 | `yjs_state` + **서버가 만든** `content_html` 이 DB 에 기록, `sync_document_links` 까지 실행 |
| vite `/collab` 프록시 | 200 |

143 tests passed (22 files), `npm run build` · `typecheck:collab` · `manage.py check` 통과.
검증용 문서·스크립트는 모두 원복·삭제.

## 4. 남은 것 / 알아둘 것

- **브라우저 확인 미실시.** 지금까지 전부 API·테스트 수준 검증이다
- **새 의존성**: `@hocuspocus/server` `@hocuspocus/provider` `y-prosemirror` `jsdom` (+dev `tsx`).
  운영 배포 시 프론트·collab 이미지 **재빌드 필요**
- **`.env` 에 `COLLAB_SHARED_SECRET` 추가됨.** 다른 환경에 배포할 때 반드시 생성해 넣어야 한다
  (비어 있으면 저장이 전부 403 으로 조용히 실패하는 대신, 협업 서버가 **시작하지 않는다**)
- **옛 경로는 남겨 뒀다.** `yroom.py` / `consumers.py` 의 문서 WS 는 이제 쓰이지 않지만 삭제하지
  않았다 — `check_document_access` 는 새 경로에서도 쓰이고, 되돌리려면 프론트 훅만 되돌리면 된다.
  파일 머리에 그 사실을 적어 뒀다. 정리는 브라우저 확인 뒤에 판단할 일
- **기존 결함 하나 발견, 고치지 않음**: StarterKit v3 가 link·underline 을 내장하는데 그 둘을
  따로도 등록하고 있어 `Duplicate extension names` 경고가 난다. 이번 변경 이전부터 있던 상태이고,
  고치려면 `StarterKit.configure({ link: false, underline: false })` 인데 링크 클릭 동작이 바뀔 수
  있어 별도 판단이 필요하다. 서버·브라우저 일관성에는 영향 없다(양쪽이 같은 함수를 쓴다)
