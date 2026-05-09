# Phase 1 — Schema (DB / 모델)

> **분석 일자**: 2026-05-09
> **추론 비율**: < 5% (모두 코드/DB 직접 인용)
> **Migration 정합성**: ✅ `No changes detected`
> **DB 대조**: ✅ 모든 사용자 모델 ↔ 실제 테이블 1:1 일치 (M2M 자동 테이블 포함)

---

## 1. 모델 카탈로그 (총 **39 모델 / 7 앱**)

| App | 모델 수 | Migration 수 | Backend import | 5단계 라벨 (잠정) |
|---|---:|---:|---:|---|
| `accounts` | 5 + UserManager | 7 | 7 | 🔶 Phase 2에서 검증 |
| `workspaces` | 4 | 5 | 18 | 🔶 활발 |
| `projects` | 7 | 16 | 24 | 🔶 가장 활발 |
| `issues` | 9 | 15 | 6 | 🔶 활발 |
| `documents` | 10 | 18 | 2 | 🔶 자기완결적(내부만 사용) |
| `notifications` | 3 | 5 | 2 | 🔶 자기완결적 |
| `audit` | 1 + helper | 1 | 7 | ✅ **Backend-only by design** (관리자 로깅 헬퍼, frontend 노출 불필요) |

> **참고**: import 카운트는 `from apps.<app>.models import` 패턴만 — 실제 사용은 viewsets/serializers/admin/signals/tasks 모두 합쳐서 더 많음. Phase 2/3에서 정밀 매핑.

### 1.1 모델 → 테이블명 매핑 (요약)

| 모델 | 테이블명 | 비고 |
|---|---|---|
| **accounts** | | |
| `User` | `users` | UUID PK, `is_active`/`is_email_verified`/`is_approved`/`is_suspended`/`deleted_at` 5단 상태 |
| `EmailChangeToken` | `email_change_tokens` | 24h 유효, 1회 사용 |
| `EmailVerificationToken` | `email_verification_tokens` | 24h |
| `PasswordResetToken` | `password_reset_tokens` | 1h |
| `Announcement` | `announcements` | 공지/릴리스 노트, `Category` choices(feature/improvement/bugfix/notice) |
| **workspaces** | | |
| `Workspace` | `workspaces` | `priority_colors` JSONField, `brand_color` |
| `WorkspaceMember` | `workspace_members` | Role IntegerChoices (10/15/20/25 = Guest/Member/Admin/Owner) |
| `WorkspaceInvitation` | `workspace_invitations` | partial unique constraint (status='pending') |
| `WorkspaceJoinRequest` | `workspace_join_requests` | partial unique constraint (status='pending') |
| **projects** | | |
| `Project` | `projects` | unique\[workspace, identifier\], `features` JSONField (board/backlog/calendar/timeline/graph/sprints/analytics/request) |
| `ProjectMember` | `project_members` | Role(10/15/20), 5단 세분권한(can_edit/archive/delete/purge/schedule), `effective_perms` property |
| `Category` | **`project_modules`** ⚠ | 클래스명-테이블명 미스매치 |
| `Sprint` | **`project_cycles`** ⚠ | 클래스명-테이블명 미스매치 |
| `ProjectEvent` | `project_events` | `participants` M2M, `is_global`로 전체 vs 일부 분기 |
| `State` | `project_states` | Group choices(backlog/unstarted/started/completed/cancelled) |
| `SavedFilter` | `saved_filters` | 사용자별 필터 프리셋 |
| **issues** | | |
| `Label` | `issue_labels` | |
| `Issue` | `issues` | unique\[project, sequence_id\], `parent` self-FK CASCADE, `is_field` 폴더 플래그, **`save()` override 복잡** |
| `IssueComment` | `issue_comments` | |
| `IssueLink` | `issue_links` | 외부 URL |
| `IssueNodeLink` | `issue_node_links` | unique\[source, target, link_type\], LinkType 5종(relates_to/blocks/blocked_by/duplicates/references) |
| `IssueAttachment` | `issue_attachments` | soft delete (`deleted_at`) |
| `IssueTemplate` | `issue_templates` | |
| `IssueRequest` | `issue_requests` | 승인 대기 → Issue 변환, `meta` JSONField |
| `IssueActivity` | `issue_activities` | 변경 audit log |
| **documents** | | |
| `DocumentSpace` | `document_spaces` (M2M → `document_spaces_members`) | SpaceType(project/personal/shared), `is_private` 토글 |
| `Document` | `documents` | `parent` self-FK, `yjs_state` BinaryField, `share_token` |
| `DocumentBookmark` | `document_bookmarks` | unique\[user, document\] |
| `DocumentSpaceBookmark` | `document_space_bookmarks` | unique\[user, space\] |
| `DocumentIssueLink` | `document_issue_links` | unique\[document, issue\] |
| `DocumentAttachment` | `document_attachments` | |
| `CommentThread` | `document_comment_threads` | block-level 앵커 텍스트 보존 |
| `DocumentComment` | `document_comments` | thread null이면 문서-전체 댓글 |
| `DocumentTemplate` | `document_templates` | Scope(built_in/user/workspace) |
| `DocumentVersion` | `document_versions` | unique\[document, version_number\], `yjs_state` |
| **notifications** | | |
| `Notification` | `notifications` | Type 10종 (issue_assigned/unassigned/updated/comment_added/comment_replied/issue_created/mentioned/join_*) |
| `NotificationPreference` | `notification_preferences` | **PK = user OneToOne**, 전역 토글 |
| `ProjectNotificationPreference` | `project_notification_preferences` | unique\[user, project\], 전역 override (NULL=상속) |
| **audit** | | |
| `AuditLog` | `audit_logs` | + `log_admin_action()` helper |

---

## 2. 관계 그래프 (FK / OneToOne / M2M)

### 2.1 자기참조 (순환 검증 필요)

- `Issue.parent` → `Issue` (CASCADE) — 트리 구조
- `Document.parent` → `Document` (CASCADE) — 트리 구조

→ frontend `DocumentLayout.tsx:118` `wouldCreateCycle()` 함수로 순환 차단 확인됨. **Issue 트리 순환 차단 로직 존재 여부는 Phase 2/3에서 확인 필요**.

### 2.2 핵심 종속 트리

```
Workspace
├─ projects (CASCADE)
│  ├─ members (CASCADE)
│  ├─ states / categories / sprints / events / saved_filters / labels (CASCADE)
│  ├─ issues (CASCADE)
│  │  ├─ comments / links / node_links / attachments / activities (CASCADE)
│  │  ├─ source_request (IssueRequest.approved_issue, SET_NULL)
│  │  └─ document_links (CASCADE)
│  ├─ requests (IssueRequest, CASCADE)
│  ├─ issue_templates (CASCADE)
│  ├─ user_notification_preferences (CASCADE)
│  └─ document_space (OneToOne, SET_NULL) ⚠ 좀비 가능성
├─ members (CASCADE) → User
├─ invitations / join_requests (CASCADE)
├─ document_spaces (CASCADE)
│  └─ documents (CASCADE)
│     ├─ comment_threads → comments (CASCADE)
│     ├─ attachments / versions / bookmarks (CASCADE)
│     └─ issue_links (CASCADE)
├─ document_templates (CASCADE)
├─ requests (IssueRequest, CASCADE)
├─ issues (CASCADE)
└─ notifications (CASCADE)

User (settings.AUTH_USER_MODEL) — 대부분 SET_NULL (히스토리 보존)
├─ owned_workspaces (SET_NULL)
├─ memberships / bookmarks / preferences (CASCADE)
├─ created_* / actor / submitted_by / reviewer ... (대부분 SET_NULL)
└─ Notification.recipient + .actor (둘 다 CASCADE) ⚠ 의도 확인 필요
```

### 2.3 OnDelete 정책 패턴

| 패턴 | 사용처 | 비고 |
|---|---|---|
| **CASCADE** | 트리 종속, M2M relations, bookmarks, memberships | 정상 |
| **SET_NULL** | created_by/actor/lead 등 사용자 참조 | 사용자 삭제 시 히스토리 보존 |
| **SET_NULL OneToOne** | DocumentSpace.project | ⚠ 프로젝트 삭제 시 space_type='project'+project=null 좀비 |
| **CASCADE on User** | Notification.recipient/actor, memberships, tokens | 의도적 (개인 데이터) |

---

## 3. 필드 정책 핵심 (Phase 0 hot-spot 검증)

> Phase 0에서 "필드 정책 정리" 커밋(`15daded`)이 최근 머지됨. 그 결과로:

| 정책 | 적용 모델 | 검증 |
|---|---|---|
| UUID PK | 모든 사용자 모델 (39개) | ✅ 일관 |
| `created_at` `auto_now_add` | 모든 모델 | ✅ |
| `updated_at` `auto_now` | 변경 가능 모델 (Issue/Project/Workspace/Document 등) | ✅ |
| Soft delete (`deleted_at`) | Issue, IssueAttachment, Document, User | ✅ 일관 |
| Archive (`archived_at`) | Issue, Project, DocumentSpace, Notification | ✅ 일관 |
| `db_index` | token UUIDField, AuditLog.created_at, Document.share_token | ✅ |
| Composite indexes | Notification, Document, IssueRequest, DocumentBookmark 등 | ✅ 적절 |
| Partial unique constraints | WorkspaceInvitation/JoinRequest (status='pending') | ✅ 좋은 패턴 |

---

## 4. Migration 정합성 — ✅ PASS

```bash
docker compose exec -T backend python manage.py makemigrations --dry-run --check
# → No changes detected
```

→ **모델 vs migration 완전 일치**. Phase 0의 의심 S4(`documents/models.py 10회 변경 → migration 누락 가능성`)는 **거짓 양성**으로 판정.

---

## 5. DB 테이블 대조 — ✅ PASS

전체 57개 테이블 분류:

| 분류 | 수 | 설명 |
|---|---:|---|
| **사용자 모델** | 39 | 위 카탈로그 1:1 매칭 |
| **M2M 자동 테이블** | 4 | `issues_assignees`, `issues_label`, `project_events_participants`, `document_spaces_members` |
| **Django auth/admin** | 7 | auth_group, auth_permission, auth_group_permissions, users_groups, users_user_permissions, django_admin_log, django_session, django_content_type |
| **Django migrations** | 1 | django_migrations |
| **django-axes (보안)** | 3 | axes_accessattempt/failurelog/log |
| **simple-jwt blacklist** | 2 | token_blacklist_blacklistedtoken/outstandingtoken |

**합계 검증**: 39 + 4 + 8 + 1 + 3 + 2 = 57 ✅

---

## 6. 발견된 특이사항 / 의심 단서 (Phase 2~5에서 정밀 검증)

| # | 발견 | 위험도 | 검증 Phase |
|---|---|---|---|
| **F1** | `Category` → `project_modules`, `Sprint` → `project_cycles` 테이블명 미스매치 | 🟢 낮음 | 의도적 별칭일 가능성. frontend가 어느 이름으로 부르는지 Phase 2 |
| **F2** | `Issue.save()` override — sequence_id auto + 카테고리 자손 전파 + is_field 강제 null | 🟡 중간 | 동시 생성 시 race condition. Phase 4 (WS) |
| **F3** | `IssueNodeLink.LinkType` DB는 5종, UI(`86a6022`)는 2종만 노출 | 🟢 낮음 | 데이터 보존 의도. 신규 생성 검증 — Phase 2 ViewSet |
| **F4** | `DocumentSpace.project` OneToOne `SET_NULL` → 좀비 (space_type='project' + project=null) | 🟡 중간 | 정리 로직 있는지 Phase 2 |
| **F5** | `User` 5단 상태 (active/email_verified/approved/suspended/deleted_at) | 🟡 중간 | 로그인 흐름이 모두 처리하는지 Phase 2 |
| **F6** | `Notification.actor` CASCADE — 액터 삭제 시 알림 자체 삭제 | 🟢 낮음 | 의도 확인. 트리거 사용자 잘림 → 알림 사라짐 OK? |
| **F7** | `Notification.Type`에 `comment_replied`/`mentioned` 정의됨 | 🟡 | memory 메모: "comment_replied + mention parser 보류". 모델은 있는데 발송 로직? Phase 2/4 |
| **F8** | `Project.features` JSONField 키 (board/backlog/calendar/timeline/graph/sprints/analytics/request) | 🟢 | frontend `useProjectFeatures.ts`와 키 일치 검증 — Phase 3 |
| **F9** | `audit` app — backend-only by design (admin 로깅) | ✅ Working | Phase 0 의심 S1은 false positive. 의도적 분리. |
| **F10** | `pycrdt` 백엔드 ↔ `Document.yjs_state`/`DocumentVersion.yjs_state` BinaryField | 🟡 | 실시간 동기화 로직 — Phase 4 |

---

## 7. 5단계 라벨 (Phase 1 잠정 — Phase 2~3에서 정밀화)

| 라벨 | 모델 | 사유 |
|---|---|---|
| ✅ **Working (확정)** | AuditLog | backend-only이지만 7회 호출 확인 |
| 🔶 **추정 Working** | User, Workspace, Project, Issue, Document, ProjectMember, WorkspaceMember | hot-spot 상위, import 다수 |
| 🔶 **검증 필요** | 위 외 모든 모델 | Phase 2 ViewSet 매핑 후 확정 |
| 🟡 **의심 Stub/부분구현** | Notification COMMENT_REPLIED/MENTIONED 타입 (memory 근거) | 발송 로직 grep 필요 (Phase 2) |
| 💀 **Dead 후보** | 현 단계에서 없음 | Phase 2~3에서 ViewSet/frontend 매핑 후 판정 |

---

## 8. 검증 명령 (재현 가능)

```bash
# 1. Migration 정합성
docker compose exec -T backend python manage.py makemigrations --dry-run --check

# 2. DB 테이블 카운트
docker compose exec -T db psql -U orbitail -d orbitail -c "\dt" | wc -l

# 3. 특정 테이블 스키마 확인 (예: issues)
docker compose exec -T db psql -U orbitail -d orbitail -c "\d issues"

# 4. 모델 import 카운트
grep -rn "from apps\.<app>\.models" backend --include="*.py" | wc -l
```

---

## 9. 다음 Phase 실행 계획

**Phase 2 — API & 권한** sub-task 5개:
1. `backend/config/urls.py` + 각 app `urls.py` 추출 → URL 트리
2. ViewSet 클래스 카탈로그 (모델 ↔ ViewSet 매핑)
3. permission_classes / 데코레이터 권한 매트릭스 (역할 × 액션)
4. drf-spectacular schema dump → 자동 생성 OpenAPI 스펙
5. **frontend/src/api/*.ts** 매핑 — 각 endpoint가 호출되는지 검증 (5단계 라벨 1차 확정)

**예상 시간**: 20~25분
