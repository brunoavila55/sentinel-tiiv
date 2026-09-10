import uuid

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.authorization import ROLES_WRITE_OPERATIONAL, require_role
from app.core.database import get_db
from app.core.dependencies import get_current_membership
from app.models.asset_photo import AssetPhoto
from app.models.organization_user import OrganizationUser
from app.schemas.asset_photo import AssetPhotoOut, AssetPhotoUpdateRequest, PhotoCategory
from app.services import asset_photo_service

router = APIRouter(prefix="/assets/{asset_id}/photos", tags=["asset-photos"])


def _photo_out(photo: AssetPhoto) -> AssetPhotoOut:
    url, thumbnail_url = asset_photo_service.build_signed_urls(photo)
    return AssetPhotoOut(
        id=photo.id,
        asset_id=photo.asset_id,
        filename=photo.filename,
        mime_type=photo.mime_type,
        size_bytes=photo.size_bytes,
        caption=photo.caption,
        position=photo.position,
        category=photo.category,
        is_primary=photo.position == 0,
        url=url,
        thumbnail_url=thumbnail_url,
        created_at=photo.created_at,
    )


@router.get("", response_model=list[AssetPhotoOut])
async def list_photos(
    asset_id: uuid.UUID,
    category: PhotoCategory = Query(default="general"),
    membership: OrganizationUser = Depends(get_current_membership),
    db: AsyncSession = Depends(get_db),
) -> list[AssetPhotoOut]:
    photos = await asset_photo_service.list_photos(db, membership.organization_id, asset_id, category)
    return [_photo_out(p) for p in photos]


@router.post("", response_model=AssetPhotoOut, status_code=status.HTTP_201_CREATED)
async def upload_photo(
    asset_id: uuid.UUID,
    file: UploadFile = File(...),
    caption: str | None = Form(default=None),
    category: PhotoCategory = Form(default="general"),
    membership: OrganizationUser = Depends(require_role(*ROLES_WRITE_OPERATIONAL)),
    db: AsyncSession = Depends(get_db),
) -> AssetPhotoOut:
    content = await file.read()
    photo = await asset_photo_service.upload_photo(
        db,
        organization_id=membership.organization_id,
        asset_id=asset_id,
        filename=file.filename or "upload",
        content_type=file.content_type or "application/octet-stream",
        content=content,
        caption=caption,
        category=category,
        uploaded_by=membership.user_id,
    )
    return _photo_out(photo)


@router.patch("/{photo_id}", response_model=AssetPhotoOut)
async def update_photo(
    asset_id: uuid.UUID,
    photo_id: uuid.UUID,
    payload: AssetPhotoUpdateRequest,
    membership: OrganizationUser = Depends(require_role(*ROLES_WRITE_OPERATIONAL)),
    db: AsyncSession = Depends(get_db),
) -> AssetPhotoOut:
    photo = await asset_photo_service.update_photo(
        db,
        organization_id=membership.organization_id,
        asset_id=asset_id,
        photo_id=photo_id,
        data=payload.model_dump(exclude_unset=True),
    )
    return _photo_out(photo)


@router.delete("/{photo_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_photo(
    asset_id: uuid.UUID,
    photo_id: uuid.UUID,
    membership: OrganizationUser = Depends(require_role(*ROLES_WRITE_OPERATIONAL)),
    db: AsyncSession = Depends(get_db),
) -> None:
    await asset_photo_service.delete_photo(
        db,
        organization_id=membership.organization_id,
        asset_id=asset_id,
        photo_id=photo_id,
        actor_user_id=membership.user_id,
    )
