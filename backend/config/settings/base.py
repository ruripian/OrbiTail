from pathlib import Path
from datetime import timedelta
from decouple import config

BASE_DIR = Path(__file__).resolve().parent.parent.parent

SECRET_KEY = config("SECRET_KEY", default="django-insecure-change-me")

INSTALLED_APPS = [
    "daphne",
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    # Third party
    "rest_framework",
    "rest_framework_simplejwt",
    "rest_framework_simplejwt.token_blacklist",
    "corsheaders",
    "django_filters",
    "drf_spectacular",
    # 로그인 brute-force 방어 — 5회 실패 시 IP+계정 조합 잠금
    "axes",
    # Local
    "apps.accounts",
    "apps.workspaces",
    "apps.projects",
    "apps.issues",
    "apps.notifications",
    "apps.audit",
    "apps.documents",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    # axes — 마지막에 위치해야 정상 동작 (다른 미들웨어가 request 처리 후)
    "axes.middleware.AxesMiddleware",
]

# axes — 인증 backend 추가 (가장 앞). 실패 시 record + lockout.
AUTHENTICATION_BACKENDS = [
    "axes.backends.AxesStandaloneBackend",
    "django.contrib.auth.backends.ModelBackend",
]

# axes — 로그인 brute-force 방어
AXES_FAILURE_LIMIT = 5
AXES_COOLOFF_TIME = timedelta(minutes=15)
# 계정 단위 잠금 — credential stuffing(여러 IP에서 같은 계정 시도)도 자동 방어.
# IP 기반 단순 brute-force 는 DRF AnonRateThrottle (60/min) 이 막는다.
AXES_LOCKOUT_PARAMETERS = ["username"]
# OrbiTail 의 login 필드명은 "email" 이므로 axes 가 이를 username 으로 매핑해야 카운터가 정상 증가
AXES_USERNAME_FORM_FIELD = "email"
# JWT 응답 메시지(403 Forbidden + JSON) 반환
AXES_LOCKOUT_RESPONSE = "apps.accounts.lockout.lockout_response"
# 로그인 성공 시 카운터 리셋
AXES_RESET_ON_SUCCESS = True
# 프록시 뒤일 때 IP 신뢰 — axes 7.x 는 IPWARE_META_PRECEDENCE_ORDER 사용 권장.
# nginx → X-Forwarded-For 헤더로 클라이언트 IP 추출.
AXES_IPWARE_PROXY_COUNT = config("AXES_IPWARE_PROXY_COUNT", default=0, cast=int)

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": config("POSTGRES_DB", default="orbitail"),
        "USER": config("POSTGRES_USER", default="orbitail"),
        "PASSWORD": config("POSTGRES_PASSWORD", default="orbitail"),
        "HOST": config("DB_HOST", default="db"),
        "PORT": config("DB_PORT", default="5432"),
    }
}

AUTH_USER_MODEL = "accounts.User"

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator", "OPTIONS": {"min_length": 8}},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
    # 커스텀: 영문/숫자/특수문자 중 2종 이상 조합 강제
    {"NAME": "apps.accounts.validators.PasswordComplexityValidator"},
]

# --- 파일 업로드 크기 제한 ---
# MAX_UPLOAD_SIZE_MB env 로 nginx/Django 모두 동일 값 유지 (.env)
MAX_UPLOAD_SIZE_MB = config("MAX_UPLOAD_SIZE_MB", default=10, cast=int)
DATA_UPLOAD_MAX_MEMORY_SIZE = MAX_UPLOAD_SIZE_MB * 1024 * 1024
FILE_UPLOAD_MAX_MEMORY_SIZE = MAX_UPLOAD_SIZE_MB * 1024 * 1024

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "mediafiles"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# DRF
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": ("rest_framework.permissions.IsAuthenticated",),
    "DEFAULT_FILTER_BACKENDS": (
        "django_filters.rest_framework.DjangoFilterBackend",
        "rest_framework.filters.SearchFilter",
        "rest_framework.filters.OrderingFilter",
    ),
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 50,
    # --- API 요청 스로틀링 (로그인 시도 제한, DDoS 방어) ---
    "DEFAULT_THROTTLE_CLASSES": [
        "rest_framework.throttling.AnonRateThrottle",
        "rest_framework.throttling.UserRateThrottle",
    ],
    "DEFAULT_THROTTLE_RATES": {
        "anon": "60/minute",      # 비인증 사용자
        "user": "1200/minute",    # 인증 사용자 — 상호작용 UI(테이블 토글, 리치 쿼리 invalidate) 감안해 여유 확보
        "auth": "10/minute",      # 로그인/회원가입 엔드포인트
    },
}

# JWT
SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(
        minutes=config("JWT_ACCESS_TOKEN_LIFETIME_MINUTES", default=60, cast=int)
    ),
    "REFRESH_TOKEN_LIFETIME": timedelta(
        days=config("JWT_REFRESH_TOKEN_LIFETIME_DAYS", default=7, cast=int)
    ),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    "AUTH_HEADER_TYPES": ("Bearer",),
}

# Celery
CELERY_BROKER_URL = config("REDIS_URL", default="redis://redis:6379/0")
CELERY_RESULT_BACKEND = config("REDIS_URL", default="redis://redis:6379/0")
CELERY_ACCEPT_CONTENT = ["json"]
CELERY_TASK_SERIALIZER = "json"
CELERY_RESULT_SERIALIZER = "json"

# Cache
CACHES = {
    "default": {
        "BACKEND": "django_redis.cache.RedisCache",
        "LOCATION": config("REDIS_URL", default="redis://redis:6379/0"),
        "OPTIONS": {"CLIENT_CLASS": "django_redis.client.DefaultClient"},
    }
}

# Django Channels — WebSocket 실시간 업데이트
CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels_redis.core.RedisChannelLayer",
        "CONFIG": {
            "hosts": [config("REDIS_URL", default="redis://redis:6379/0")],
        },
    },
}

# 이메일 발송 기본값 (환경별 settings에서 오버라이드)
EMAIL_BACKEND = config("EMAIL_BACKEND", default="django.core.mail.backends.smtp.EmailBackend")
EMAIL_HOST = config("EMAIL_HOST", default="localhost")
EMAIL_PORT = config("EMAIL_PORT", default=587, cast=int)
EMAIL_USE_TLS = config("EMAIL_USE_TLS", default=True, cast=bool)
EMAIL_USE_SSL = config("EMAIL_USE_SSL", default=False, cast=bool)
EMAIL_HOST_USER = config("EMAIL_HOST_USER", default="")
EMAIL_HOST_PASSWORD = config("EMAIL_HOST_PASSWORD", default="")
DEFAULT_FROM_EMAIL = config("DEFAULT_FROM_EMAIL", default="noreply@orbitail.local")
FRONTEND_URL = config("FRONTEND_URL", default="http://localhost:5173")

# DRF Spectacular
SPECTACULAR_SETTINGS = {
    "TITLE": "OrbiTail API",
    "DESCRIPTION": "Project management API",
    "VERSION": "1.0.0",
    "SERVE_INCLUDE_SCHEMA": False,
}
