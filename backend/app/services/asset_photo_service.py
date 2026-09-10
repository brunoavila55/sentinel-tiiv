import uuid

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.image_processing import InvalidImageError, generate_thumbnail, validate_image
from app.core.storage import get_storage_service
from app.models.asset_photo import AssetPhoto
from app.repositories import asset_photo_repository, asset_repository
from app.services import audit_service, entitlement_service


def _storage_key(organization_id: uuid.UUID, asset_id: uuid.UUID, extension: str) -> str:
    # organizations/{org}/assets/{asset}/{uuid}.{ext} — exatamente como
    # especificado; nome interno gerado com UUID, nunca derivado do nome
    # de arquivo enviado pelo cliente.
    return f"organizations/{organization_id}/assets/{asset_id}/{uuid.uuid4()}.{extension}"


async def _ensure_asset_in_org(db: AsyncSession, organization_id: uuid.UUID, asset_id: uuid.UUID) -> None:
    asset = await asset_repository.get_model(db, organization_id, asset_id)
    if asset is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ativo não encontrado")


async def list_photos(
    db: AsyncSession, organization_id: uuid.UUID, asset_id: uuid.UUID, category: str = "general"
) -> list[AssetPhoto]:
    await _ensure_asset_in_org(db, organization_id, asset_id)
    return await asset_photo_repository.list_for_asset(db, organization_id, asset_id, category)


async def upload_photo(
    db: AsyncSession,
    *,
    organization_id: uuid.UUID,
    asset_id: uuid.UUID,
    filename: str,
    content_type: str,
    content: bytes,
    caption: str | None,
    category: str = "general",
    uploaded_by: uuid.UUID,
) -> AssetPhoto:
    await _ensure_asset_in_org(db, organization_id, asset_id)

    try:
        extension = validate_image(content, content_type)
    except InvalidImageError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc

    await entitlement_service.ensure_can_upload_storage(db, organization_id, len(content))

    storage = get_storage_service()
    key = _storage_key(organization_id, asset_id, extension)
    thumbnail_key = key.rsplit(".", 1)[0] + "_thumb.jpg"
    thumbnail_bytes = generate_thumbnail(content)

    await storage.upload(key, content, content_type)
    try:
        await storage.upload(thumbnail_key, thumbnail_bytes, "image/jpeg")
    except Exception:
        # Não deixa o objeto original órfão se a thumbnail falhar.
        await storage.delete(key)
        raise

    position = await asset_photo_repository.next_position(db, asset_id, category)
    photo = await asset_photo_repository.create(
        db,
        organization_id=organization_id,
        asset_id=asset_id,
        storage_key=key,
        thumbnail_storage_key=thumbnail_key,
        filename=filename,
        mime_type=content_type,
        size_bytes=len(content),
        caption=caption,
        position=position,
        category=category,
        uploaded_by=uploaded_by,
    )
    await db.flush()
    await audit_service.record(
        db,
        organization_id=organization_id,
        user_id=uploaded_by,
        action="asset.photo_uploaded",
        entity_type="asset_photo",
        entity_id=photo.id,
        metadata={"asset_id": str(asset_id), "filename": filename, "category": category},
    )
    await db.commit()
    await db.refresh(photo)
    return photo


async def _get_or_404(
    db: AsyncSession, organization_id: uuid.UUID, asset_id: uuid.UUID, photo_id: uuid.UUID
) -> AssetPhoto:
    photo = await asset_photo_repository.get_by_id(db, organization_id, asset_id, photo_id)
    if photo is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Foto não encontrada")
    return photo


async def _reorder(
    db: AsyncSession, organization_id: uuid.UUID, asset_id: uuid.UUID, target: AssetPhoto, new_position: int
) -> None:
    # Reordena somente dentro da mesma categoria do alvo — "principal" da
    # galeria geral e a ordem das fotos de backup são sequências independentes.
    photos = await asset_photo_repository.list_for_asset(db, organization_id, asset_id, target.category)
    new_position = max(0, min(new_position, len(photos) - 1))
    old_position = target.position
    if new_position == old_position:
        return
    for photo in photos:
        if photo.id == target.id:
            continue
        if new_position < old_position and new_position <= photo.position < old_position:
            photo.position += 1
        elif new_position > old_position and old_position < photo.position <= new_position:
            photo.position -= 1
    target.position = new_position


async def update_photo(
    db: AsyncSession,
    *,
    organization_id: uuid.UUID,
    asset_id: uuid.UUID,
    photo_id: uuid.UUID,
    data: dict,
) -> AssetPhoto:
    photo = await _get_or_404(db, organization_id, asset_id, photo_id)

    if "caption" in data:
        photo.caption = data["caption"]

    if data.get("position") is not None:
        await _reorder(db, organization_id, asset_id, photo, data["position"])

    await db.commit()
    await db.refresh(photo)
    return photo


async def delete_photo(
    db: AsyncSession, *, organization_id: uuid.UUID, asset_id: uuid.UUID, photo_id: uuid.UUID, actor_user_id: uuid.UUID
) -> None:
    photo = await _get_or_404(db, organization_id, asset_id, photo_id)
    storage = get_storage_service()
    await storage.delete(photo.storage_key)
    if photo.thumbnail_storage_key:
        await storage.delete(photo.thumbnail_storage_key)
    await asset_photo_repository.delete(db, photo)
    await audit_service.record(
        db,
        organization_id=organization_id,
        user_id=actor_user_id,
        action="asset.photo_deleted",
        entity_type="asset_photo",
        entity_id=photo_id,
        metadata={"asset_id": str(asset_id), "filename": photo.filename},
    )
    await db.commit()


def build_signed_urls(photo: AssetPhoto) -> tuple[str, str]:
    """Sempre a partir de um AssetPhoto já resolvido por uma query com
    filtro de organization_id — nunca a partir de um storage_key vindo
    direto do cliente. É isso que impede o Cliente A de obter uma URL
    assinada para uma foto do Cliente B mesmo conhecendo IDs."""
    storage = get_storage_service()
    url = storage.get_presigned_url(photo.storage_key)
    thumbnail_key = photo.thumbnail_storage_key or photo.storage_key
    thumbnail_url = storage.get_presigned_url(thumbnail_key)
    return url, thumbnail_url
