from functools import lru_cache

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Valores de exemplo que só existem para permitir `docker compose up` sem
# exigir um .env em dev local (docker-compose.yml e .env.example). Nunca
# devem chegar a rodar fora de desenvolvimento — ver Settings.__init__
# abaixo (PROMPT 25: secret hardcoded é exatamente o tipo de risco que
# esse guard existe para evitar).
_INSECURE_SECRET_KEY_PLACEHOLDERS = {
    "INSECURE-DEV-ONLY-CHANGE-ME",
    "dev-insecure-secret-change-me",
}


class Settings(BaseSettings):
    """Configuração central da aplicação, lida a partir de variáveis de ambiente."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_env: str = "development"

    database_url: str = (
        "postgresql+asyncpg://sentinel:sentinel@postgres:5432/sentinel"
    )

    # Endpoint interno: usado pelo backend para falar com o MinIO dentro da
    # rede do Docker Compose (upload/delete/exists).
    minio_endpoint: str = "minio:9000"
    # Endpoint público: usado só para ASSINAR URLs presigned. Precisa ser o
    # host:porta que o navegador realmente vai usar — SigV4 assina o Host,
    # então assinar com um endpoint diferente do que o browser bate quebra
    # a validação da assinatura no MinIO.
    minio_public_endpoint: str = "localhost:9000"
    minio_root_user: str = "minioadmin"
    minio_root_password: str = "minioadmin123"
    minio_bucket: str = "sentinel-assets"
    minio_use_ssl: bool = False
    minio_public_use_ssl: bool = False

    max_upload_size_bytes: int = 10 * 1024 * 1024  # 10 MB
    presigned_url_expire_seconds: int = 300

    cors_origins: str = "http://localhost,http://localhost:5173"

    # Auth. O default só serve para desenvolvimento local — em qualquer
    # outro ambiente, SECRET_KEY precisa vir de uma variável de ambiente
    # real (nunca hardcoded no código-fonte).
    secret_key: str = "dev-insecure-secret-change-me"
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 30
    refresh_cookie_name: str = "sentinel_refresh_token"
    invite_expire_days: int = 7

    # URL pública do frontend, usada para montar o link de convite. Em dev
    # aponta para o Caddy local; em outro ambiente deve vir de env var.
    public_app_url: str = "http://localhost"

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def cookie_secure(self) -> bool:
        return self.app_env != "development"

    @model_validator(mode="after")
    def _reject_placeholder_secret_outside_dev(self) -> "Settings":
        if self.app_env != "development" and self.secret_key in _INSECURE_SECRET_KEY_PLACEHOLDERS:
            raise ValueError(
                "SECRET_KEY está com o valor placeholder de desenvolvimento. "
                "Defina uma SECRET_KEY real (ex.: `python3 -c \"import secrets; "
                "print(secrets.token_urlsafe(32))\"`) antes de rodar fora de "
                "APP_ENV=development."
            )
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
