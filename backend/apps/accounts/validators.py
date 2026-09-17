"""
패스워드 복잡도 검증기
- 8자리 이상, 영문 + 숫자 + 특수문자 3종류 모두 포함
"""
import re

from django.core.exceptions import ValidationError
from django.utils.translation import gettext as _


class PasswordComplexityValidator:
    """영문 + 숫자 + 특수문자 3종류 모두 포함하는지 검증"""

    def validate(self, password, user=None):
        has_letter  = bool(re.search(r"[a-zA-Z]", password))
        has_digit   = bool(re.search(r"\d", password))
        has_special = bool(re.search(r"[^a-zA-Z0-9\s]", password))

        if not (has_letter and has_digit and has_special):
            raise ValidationError(
                _("The password must contain letters, digits and symbols."),
                code="password_too_simple",
            )

    def get_help_text(self):
        return _("The password must contain letters, digits and symbols.")
