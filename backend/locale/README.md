# 백엔드 번역

서버가 사용자에게 보내는 문장(API 오류, 메일, 알림)은 **코드에 영어로 쓰고**, 한국어는
`ko/LC_MESSAGES/django.po` 에 번역으로 둔다. 응답 언어는 요청의 `Accept-Language`
(프론트가 화면 언어를 보낸다)로, 요청이 없는 메일·알림은 받는 사람의 `User.language` 로 정한다.

## 문장을 추가할 때

```python
from django.utils.translation import gettext, gettext_lazy

raise PermissionDenied(gettext("Only a project administrator can do this."))
gettext("Updated %(count)s issues.") % {"count": n}      # 변수는 이름 붙은 자리표시자로
MEETING = "meeting", gettext_lazy("Meeting")               # 모듈·클래스 수준, 데코레이터 인자는 _lazy
```

- f-string 은 번역할 수 없다. `%(name)s` 자리표시자를 쓴다.
- 요청 없이 만드는 문장은 `translation.override(user_language(user))` 안에서 만든다
  (`apps.accounts.models.user_language`).

그다음 백엔드 컨테이너에서:

```bash
python manage.py makemessages -l ko -i "staticfiles/*" -i "mediafiles/*" \
  -i "*/migrations/*" -i "*/management/*" -i "*/tests*" --no-location --no-obsolete
```

`django.po` 에 새로 생긴 `msgstr ""` 에 한국어를 채우고 커밋한다. `.mo` 는 커밋하지 않는다 —
컨테이너 기동 때 `compilemessages` 가 만든다.

## 검사

- `apps/core/tests_i18n.py` — 빈 번역·fuzzy·자리표시자 불일치, 코드에 남은 한국어 문자열
- CI — 위 `makemessages` 를 다시 돌려 커밋된 `.po` 와 다르면 실패 (번역 누락)

한국어가 꼭 필요한 줄(한글 매칭 정규식 등)은 줄 끝에 `# i18n-ignore`.
