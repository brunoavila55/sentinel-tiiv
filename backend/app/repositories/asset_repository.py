import uuid
from collections.abc import Sequence

from sqlalchemy import ColumnElement, String, and_, cast, case, func, or_, select
from sqlalchemy.engine import Row
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.asset import Asset
from app.models.asset_photo import AssetPhoto
from app.models.check import Check
from app.models.check_result import CheckResult
from app.models.enums import AssetStatus
from app.models.site import Site
from app.models.topology_link import TopologyLink

AssetDetailRow = Row  # (Asset, site_name: str, checks_count: int, photos_count: int, parent_asset_id: UUID | None)


def _parent_asset_id_expr():
    """Subquery correlacionada: o source_asset_id do link_type="parent" que
    aponta para este ativo (no máximo um, mantido pelo asset_service)."""
    return (
        select(TopologyLink.source_asset_id)
        .where(TopologyLink.target_asset_id == Asset.id, TopologyLink.link_type == "parent")
        .correlate(Asset)
        .scalar_subquery()
    )

_SORTABLE_COLUMNS: dict[str, ColumnElement] = {
    "name": Asset.name,
    "status": Asset.status,
    "last_rtt_ms": Asset.last_rtt_ms,
    "packet_loss": Asset.packet_loss,
    "last_check_at": Asset.last_check_at,
    "site_name": Site.name,
}


def _order_by(sort: str | None) -> list[ColumnElement]:
    """`sort` é uma coluna suportada, com "-" opcional na frente pra
    descendente (ex.: "-last_check_at"). Nome do ativo como critério de
    desempate, sempre — ordem estável mesmo com muitos empates."""
    if not sort:
        return [Asset.name]
    descending = sort.startswith("-")
    key = sort[1:] if descending else sort
    column = _SORTABLE_COLUMNS.get(key)
    if column is None:
        return [Asset.name]
    primary = column.desc().nulls_last() if descending else column.asc().nulls_last()
    return [primary, Asset.name]


def _filters(
    organization_id: uuid.UUID,
    *,
    search: str | None,
    site_id: uuid.UUID | None,
    status: AssetStatus | None,
    enabled: bool | None,
) -> list[ColumnElement[bool]]:
    clauses: list[ColumnElement[bool]] = [Asset.organization_id == organization_id]
    if site_id is not None:
        clauses.append(Asset.site_id == site_id)
    if status is not None:
        clauses.append(Asset.status == status)
    if enabled is not None:
        clauses.append(Asset.enabled == enabled)
    if search:
        pattern = f"%{search.strip().lower()}%"
        clauses.append(
            or_(
                func.lower(Asset.name).like(pattern),
                func.lower(Asset.hostname).like(pattern),
                func.lower(cast(Asset.ip_address, String)).like(pattern),
            )
        )
    return clauses


async def count_assets(
    db: AsyncSession,
    organization_id: uuid.UUID,
    *,
    search: str | None = None,
    site_id: uuid.UUID | None = None,
    status: AssetStatus | None = None,
    enabled: bool | None = None,
) -> int:
    clauses = _filters(organization_id, search=search, site_id=site_id, status=status, enabled=enabled)
    result = await db.execute(select(func.count()).select_from(Asset).where(and_(*clauses)))
    return result.scalar_one()


async def list_assets(
    db: AsyncSession,
    organization_id: uuid.UUID,
    *,
    search: str | None = None,
    site_id: uuid.UUID | None = None,
    status: AssetStatus | None = None,
    enabled: bool | None = None,
    sort: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> Sequence[AssetDetailRow]:
    clauses = _filters(organization_id, search=search, site_id=site_id, status=status, enabled=enabled)
    checks_count = func.count(func.distinct(Check.id)).label("checks_count")
    # Só conta fotos "general" — fotos de backup pertencem à seção de
    # backup, não à galeria principal que este contador representa.
    photos_count = func.count(func.distinct(AssetPhoto.id)).filter(AssetPhoto.category == "general").label(
        "photos_count"
    )
    parent_asset_id = _parent_asset_id_expr().label("parent_asset_id")
    stmt = (
        select(Asset, Site.name, checks_count, photos_count, parent_asset_id)
        .join(Site, Site.id == Asset.site_id)
        .outerjoin(Check, Check.asset_id == Asset.id)
        .outerjoin(AssetPhoto, AssetPhoto.asset_id == Asset.id)
        .where(and_(*clauses))
        .group_by(Asset.id, Site.name)
        .order_by(*_order_by(sort))
        .limit(limit)
        .offset(offset)
    )
    result = await db.execute(stmt)
    return result.all()


async def get_by_id(db: AsyncSession, organization_id: uuid.UUID, asset_id: uuid.UUID) -> AssetDetailRow | None:
    checks_count = func.count(func.distinct(Check.id)).label("checks_count")
    photos_count = func.count(func.distinct(AssetPhoto.id)).filter(AssetPhoto.category == "general").label(
        "photos_count"
    )
    parent_asset_id = _parent_asset_id_expr().label("parent_asset_id")
    stmt = (
        select(Asset, Site.name, checks_count, photos_count, parent_asset_id)
        .join(Site, Site.id == Asset.site_id)
        .outerjoin(Check, Check.asset_id == Asset.id)
        .outerjoin(AssetPhoto, AssetPhoto.asset_id == Asset.id)
        .where(Asset.id == asset_id, Asset.organization_id == organization_id)
        .group_by(Asset.id, Site.name)
    )
    result = await db.execute(stmt)
    return result.first()


async def get_model(db: AsyncSession, organization_id: uuid.UUID, asset_id: uuid.UUID) -> Asset | None:
    result = await db.execute(
        select(Asset).where(Asset.id == asset_id, Asset.organization_id == organization_id)
    )
    return result.scalar_one_or_none()


async def create(db: AsyncSession, **fields: object) -> Asset:
    asset = Asset(**fields)
    db.add(asset)
    await db.flush()
    return asset


async def delete(db: AsyncSession, asset: Asset) -> None:
    await db.delete(asset)


async def list_problems(
    db: AsyncSession,
    organization_id: uuid.UUID,
    *,
    site_id: uuid.UUID | None = None,
    status: AssetStatus | None = None,
    search: str | None = None,
) -> Sequence[Row]:
    """Ativos em warning/down (ou só um dos dois, se `status` for passado).
    Ordem: DOWN mais antigo primeiro, depois DOWN mais recente, depois
    WARNING (PROMPT 11). `message` é a mensagem normalizada do check_result
    mais recente do ativo — "por que" ele está em problema (PROMPT 20)."""
    latest_message = (
        select(CheckResult.message)
        .where(CheckResult.asset_id == Asset.id)
        .order_by(CheckResult.checked_at.desc())
        .limit(1)
        .correlate(Asset)
        .scalar_subquery()
    )

    # "Problemas" só é warning/down por definição — um status fora desse
    # par (ex.: up) é ignorado, não silenciosamente devolve ativos saudáveis
    # numa tela que promete só mostrar problema.
    problem_statuses = (
        [status] if status in (AssetStatus.WARNING, AssetStatus.DOWN) else [AssetStatus.WARNING, AssetStatus.DOWN]
    )
    down_first = case((Asset.status == AssetStatus.DOWN, 0), else_=1)
    stmt = (
        select(Asset, Site.name, latest_message.label("message"))
        .join(Site, Site.id == Asset.site_id)
        .where(Asset.organization_id == organization_id, Asset.status.in_(problem_statuses))
        .order_by(down_first, Asset.status_since.asc())
    )
    if site_id is not None:
        stmt = stmt.where(Asset.site_id == site_id)
    if search:
        pattern = f"%{search.strip().lower()}%"
        stmt = stmt.where(
            or_(
                func.lower(Asset.name).like(pattern),
                func.lower(Asset.hostname).like(pattern),
                func.lower(cast(Asset.ip_address, String)).like(pattern),
            )
        )

    result = await db.execute(stmt)
    return result.all()
