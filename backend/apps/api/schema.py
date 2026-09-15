from drf_spectacular.extensions import OpenApiAuthenticationExtension


class ApiTokenAuthenticationScheme(OpenApiAuthenticationExtension):
    """Swagger 의 [Authorize] 에 토큰 입력칸이 뜨게 한다."""

    target_class = "apps.api.authentication.ApiTokenAuthentication"
    name = "ApiToken"

    def get_security_definition(self, auto_schema):
        return {"type": "http", "scheme": "bearer", "bearerFormat": "orbt_…"}
