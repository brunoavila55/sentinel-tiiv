import io

import pytest
from PIL import Image

from app.core.image_processing import InvalidImageError, generate_thumbnail, validate_image


def _image_bytes(fmt: str, size: tuple[int, int] = (4, 4)) -> bytes:
    img = Image.new("RGB", size, color=(120, 120, 200))
    buffer = io.BytesIO()
    img.save(buffer, format=fmt)
    return buffer.getvalue()


def test_validate_image_accepts_jpeg_png_webp() -> None:
    assert validate_image(_image_bytes("JPEG"), "image/jpeg") == "jpg"
    assert validate_image(_image_bytes("PNG"), "image/png") == "png"
    assert validate_image(_image_bytes("WEBP"), "image/webp") == "webp"


def test_validate_image_rejects_unsupported_mime() -> None:
    with pytest.raises(InvalidImageError):
        validate_image(_image_bytes("PNG"), "image/gif")


def test_validate_image_rejects_content_that_does_not_match_declared_mime() -> None:
    # PNG de verdade, mas declarado como JPEG — não confia no header sozinho.
    with pytest.raises(InvalidImageError):
        validate_image(_image_bytes("PNG"), "image/jpeg")


def test_validate_image_rejects_non_image_bytes() -> None:
    with pytest.raises(InvalidImageError):
        validate_image(b"isto nao e uma imagem, so texto puro", "image/png")


def test_validate_image_rejects_oversized_file(monkeypatch: pytest.MonkeyPatch) -> None:
    import app.core.image_processing as module

    monkeypatch.setattr(module.settings, "max_upload_size_bytes", 10)
    with pytest.raises(InvalidImageError):
        validate_image(_image_bytes("PNG"), "image/png")


def test_generate_thumbnail_produces_smaller_valid_jpeg() -> None:
    original = _image_bytes("PNG", size=(1000, 1000))
    thumb = generate_thumbnail(original)
    with Image.open(io.BytesIO(thumb)) as img:
        assert img.format == "JPEG"
        assert max(img.size) <= 320
    assert len(thumb) < len(original)
