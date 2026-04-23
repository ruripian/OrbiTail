import uuid
from django.conf import settings
from django.contrib.auth.models import AbstractBaseUser, PermissionsMixin, BaseUserManager
from django.db import models
from django.utils import timezone as tz


class UserManager(BaseUserManager):
    def create_user(self, email, password=None, **extra_fields):
        if not email:
            raise ValueError("Email is required")
        email = self.normalize_email(email)
        user = self.model(email=email, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, email, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        extra_fields.setdefault("is_active", True)
        extra_fields.setdefault("is_email_verified", True)
        extra_fields.setdefault("is_approved", True)
        return self.create_user(email, password, **extra_fields)


class User(AbstractBaseUser, PermissionsMixin):
    class Theme(models.TextChoices):
        LIGHT = "light", "Light"
        DARK = "dark", "Dark"
        SYSTEM = "system", "System"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.EmailField(unique=True)
    display_name = models.CharField(max_length=100)
    first_name = models.CharField(max_length=50, blank=True, default="")
    last_name = models.CharField(max_length=50, blank=True, default="")
    avatar = models.ImageField(upload_to="avatars/", blank=True, null=True)
    is_active = models.BooleanField(default=False)
    is_email_verified = models.BooleanField(default=False)
    is_approved = models.BooleanField(default=False)
    is_staff = models.BooleanField(default=False)
    # 관리자가 계정을 일시 정지한 상태 — 로그인 차단 (is_active와 독립적으로 토글 가능)
    is_suspended = models.BooleanField(default=False)
    timezone = models.CharField(max_length=100, default="Asia/Seoul")
    language = models.CharField(max_length=10, default="ko")
    # 주의 시작 요일: 0=일요일, 1=월요일
    first_day_of_week = models.IntegerField(default=0)
    # 마지막으로 본 공지 ID — null이면 모든 공지가 unread
    last_seen_announcement = models.ForeignKey(
        "Announcement",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )
    theme = models.CharField(max_length=10, choices=Theme.choices, default=Theme.SYSTEM)
    # 보기 설정 — 사용자별 UI 글자 크기/폰트. 프론트는 :root CSS 변수로 적용.
    ui_font_scale = models.FloatField(default=1.0)          # 0.8 ~ 1.4
    ui_font_family = models.CharField(max_length=32, default="pretendard")
    ui_font_mono = models.CharField(max_length=32, default="jetbrains")
    # 소프트 삭제: 계정 탈퇴 시 설정. 이 값이 set이면 로그인 불가 (is_active=False와 병행).
    deleted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = ["display_name"]

    objects = UserManager()

    class Meta:
        db_table = "users"

    def __str__(self):
        return self.email


class EmailChangeToken(models.Model):
    """이메일 변경 인증 토큰 — 24시간 유효, 1회 사용"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="email_change_tokens",
    )
    new_email = models.EmailField()
    token = models.UUIDField(default=uuid.uuid4, unique=True, db_index=True)
    expires_at = models.DateTimeField()
    is_used = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "email_change_tokens"

    def is_valid(self) -> bool:
        return not self.is_used and self.expires_at > tz.now()


class EmailVerificationToken(models.Model):
    """이메일 인증 토큰 — 회원가입 시 생성, 24시간 유효"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="email_verification_tokens",
    )
    token = models.UUIDField(default=uuid.uuid4, unique=True, db_index=True)
    expires_at = models.DateTimeField()
    is_used = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "email_verification_tokens"

    def is_valid(self) -> bool:
        return not self.is_used and self.expires_at > tz.now()


class PasswordResetToken(models.Model):
    """비밀번호 찾기 토큰 — 1시간 유효"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="password_reset_tokens",
    )
    token = models.UUIDField(default=uuid.uuid4, unique=True, db_index=True)
    expires_at = models.DateTimeField()
    is_used = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "password_reset_tokens"

    def is_valid(self) -> bool:
        return not self.is_used and self.expires_at > tz.now()


class Announcement(models.Model):
    """제품 공지/업데이트 — 모든 워크스페이스 사용자에게 공유.
    버전 태그를 붙여 릴리스 노트로도 활용. is_staff 만 작성/편집 가능."""

    class Category(models.TextChoices):
        FEATURE     = "feature",     "신규 기능"
        IMPROVEMENT = "improvement", "개선"
        BUGFIX      = "bugfix",      "버그 수정"
        NOTICE      = "notice",      "공지"

    id          = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    title       = models.CharField(max_length=255)
    body        = models.TextField()  # markdown
    version     = models.CharField(max_length=32, blank=True, default="")  # 예: "v1.4.0"
    category    = models.CharField(max_length=20, choices=Category.choices, default=Category.NOTICE)
    is_published = models.BooleanField(default=True)
    created_by  = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="created_announcements",
    )
    created_at  = models.DateTimeField(auto_now_add=True)
    updated_at  = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "announcements"
        ordering = ["-created_at"]

    def __str__(self):
        return f"[{self.version or '-'}] {self.title}"
