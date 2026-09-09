"""Validação e processamento de imagens de upload.

Nunca confia apenas no nome do arquivo ou no Content-Type declarado pelo
cliente: o conteúdo é decodificado de verdade (Pillow) e o formato real é
comparado contra o que foi declarado.
"""

import io

from PIL import Image, UnidentifiedImageError

from app.core.config import get_settings

settings = get_settings()

# Content-Type declarado -> (formato Pillow esperado, extensão interna).
_ALLOWED_CONTENT_TYPES: dict[str, tuple[str, str]] = {
    "image/jpeg": ("JPEG", "jpg"),
    "image/png": ("PNG", "png"),
    "image/webp": ("WEBP", "webp"),
}

THUMBNAIL_MAX_DIMENSION = 320
THUMBNAIL_CONTENT_TYPE = "image/jpeg"


class InvalidImageError(ValueError):
    pass


def validate_image(content: bytes, declared_content_type: str) -> str:
    """Levanta InvalidImageError se MIME, tamanho ou conteúdo forem
    inválidos. Retorna a extensão interna a usar na storage_key."""
    if declared_content_type not in _ALLOWED_CONTENT_TYPES:
        raise InvalidImageError("Formato não suportado. Use JPEG, PNG ou WebP.")

    if len(content) > settings.max_upload_size_bytes:
        limit_mb = settings.max_upload_size_bytes // (1024 * 1024)
        raise InvalidImageError(f"Arquivo excede o limite de {limit_mb} MB.")

    expected_format, extension = _ALLOWED_CONTENT_TYPES[declared_content_type]

    try:
        with Image.open(io.BytesIO(content)) as img:
            img.verify()
    except (UnidentifiedImageError, OSError) as exc:
        raise InvalidImageError("Arquivo não é uma imagem válida.") from exc

    # verify() deixa o objeto inutilizável para nova leitura — reabre para
    # comparar o formato real contra o Content-Type declarado.
    with Image.open(io.BytesIO(content)) as img:
        if img.format != expected_format:
            raise InvalidImageError("O conteúdo do arquivo não corresponde ao formato declarado.")

    return extension


def generate_thumbnail(content: bytes) -> bytes:
    with Image.open(io.BytesIO(content)) as img:
        img = img.convert("RGB")
        img.thumbnail((THUMBNAIL_MAX_DIMENSION, THUMBNAIL_MAX_DIMENSION))
        buffer = io.BytesIO()
        img.save(buffer, format="JPEG", quality=80)
        return buffer.getvalue()
