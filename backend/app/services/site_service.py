import uuid

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.site import Site
from app.repositories import site_repository
from app.schemas.site import SiteCreateRequest, SiteUpdateRequest
from app.services import audit_service


async def list_sites(
    db: AsyncSession, organization_id: uuid.UUID, *, search: str | None = None
) -> list[tuple[Site, int]]:
    return await site_repository.list_sites(db, organization_id, search=search)


async def get_site(db: AsyncSession, organization_id: uuid.UUID, site_id: uuid.UUID) -> Site:
    site = await site_repository.get_by_id(db, organization_id, site_id)
    if site is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Site não encontrado")
    return site


async def count_assets(db: AsyncSession, site_id: uuid.UUID) -> int:
    return await site_repository.count_assets(db, site_id)


async def create_site(
    db: AsyncSession, organization_id: uuid.UUID, payload: SiteCreateRequest, actor_user_id: uuid.UUID
) -> Site:
    site = await site_repository.create(
        db,
        organization_id=organization_id,
        name=payload.name,
        description=payload.description,
        address=payload.address,
    )
    await db.flush()
    await audit_service.record(
        db,
        organization_id=organization_id,
        user_id=actor_user_id,
        action="site.created",
        entity_type="site",
        entity_id=site.id,
        metadata={"name": site.name},
    )
    await db.commit()
    await db.refresh(site)
    return site


async def update_site(
    db: AsyncSession,
    organization_id: uuid.UUID,
    site_id: uuid.UUID,
    payload: SiteUpdateRequest,
    actor_user_id: uuid.UUID,
) -> Site:
    site = await get_site(db, organization_id, site_id)
    changed_fields = list(payload.model_dump(exclude_unset=True).keys())
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(site, field, value)
    await audit_service.record(
        db,
        organization_id=organization_id,
        user_id=actor_user_id,
        action="site.updated",
        entity_type="site",
        entity_id=site.id,
        metadata={"fields": changed_fields},
    )
    await db.commit()
    await db.refresh(site)
    return site


async def delete_site(
    db: AsyncSession, organization_id: uuid.UUID, site_id: uuid.UUID, actor_user_id: uuid.UUID
) -> None:
    site = await get_site(db, organization_id, site_id)
    asset_count = await site_repository.count_assets(db, site_id)
    if asset_count > 0:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Não é possível remover: {asset_count} ativo(s) ainda vinculado(s) a este site.",
        )
    site_name = site.name
    await site_repository.delete(db, site)
    await audit_service.record(
        db,
        organization_id=organization_id,
        user_id=actor_user_id,
        action="site.deleted",
        entity_type="site",
        entity_id=site_id,
        metadata={"name": site_name},
    )
    await db.commit()
