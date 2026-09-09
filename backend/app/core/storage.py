"""Abstração sobre o storage S3-compatible (MinIO hoje).

Nenhum código de negócio deve importar boto3 diretamente — só esta classe.
Isso é o que permite trocar MinIO por AWS S3, Cloudflare R2 ou qualquer
outro storage S3-compatible sem tocar em services/repositories.
"""

from functools import lru_cache

import anyio
import boto3
from botocore.client import Config as BotoConfig
from botocore.exceptions import ClientError

from app.core.config import get_settings

settings = get_settings()


def _client(endpoint: str, use_ssl: bool):
    scheme = "https" if use_ssl else "http"
    return boto3.client(
        "s3",
        endpoint_url=f"{scheme}://{endpoint}",
        aws_access_key_id=settings.minio_root_user,
        aws_secret_access_key=settings.minio_root_password,
        config=BotoConfig(signature_version="s3v4"),
        region_name="us-east-1",
    )


class StorageService:
    def __init__(self) -> None:
        # Cliente interno: fala com o MinIO dentro da rede do compose.
        self._client = _client(settings.minio_endpoint, settings.minio_use_ssl)
        # Cliente de assinatura: gera presigned URLs usando o host que o
        # NAVEGADOR vai bater. SigV4 assina o Host — assinar com um host
        # diferente do que recebe a requisição quebra a validação.
        self._presign_client = _client(settings.minio_public_endpoint, settings.minio_public_use_ssl)
        self._bucket = settings.minio_bucket

    async def upload(self, key: str, data: bytes, content_type: str) -> None:
        await anyio.to_thread.run_sync(
            lambda: self._client.put_object(Bucket=self._bucket, Key=key, Body=data, ContentType=content_type)
        )

    async def delete(self, key: str) -> None:
        await anyio.to_thread.run_sync(lambda: self._client.delete_object(Bucket=self._bucket, Key=key))

    async def exists(self, key: str) -> bool:
        def _check() -> bool:
            try:
                self._client.head_object(Bucket=self._bucket, Key=key)
                return True
            except ClientError as exc:
                code = exc.response.get("Error", {}).get("Code")
                if code in ("404", "NoSuchKey"):
                    return False
                raise

        return await anyio.to_thread.run_sync(_check)

    def get_presigned_url(self, key: str, *, expires_in_seconds: int | None = None) -> str:
        # Assinatura pura (HMAC local, sem I/O de rede): seguro chamar
        # diretamente em contexto async.
        return self._presign_client.generate_presigned_url(
            "get_object",
            Params={"Bucket": self._bucket, "Key": key},
            ExpiresIn=expires_in_seconds or settings.presigned_url_expire_seconds,
        )


@lru_cache
def get_storage_service() -> StorageService:
    return StorageService()
