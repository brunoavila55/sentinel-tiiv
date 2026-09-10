import uuid
from collections.abc import Sequence

from sqlalchemy import and_, exists, or_, select
from sqlalchemy.engine import Row
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.asset import Asset
from app.models.asset_photo import AssetPhoto
from app.models.topology_link import TopologyLink


async def list_nodes_for_site(db: AsyncSession, organization_id: uuid.UUID, site_id: uuid.UUID) -> Sequence[Row]:
    # Só considera fotos "general" — fotos de backup não devem acender o
    # indicador de foto do node na topologia (elas vivem na seção de backup).
    has_photo = (
        exists()
        .where(AssetPhoto.asset_id == Asset.id, AssetPhoto.category == "general")
        .label("has_photo")
    )
    stmt = select(Asset, has_photo).where(Asset.organization_id == organization_id, Asset.site_id == site_id)
    result = await db.execute(stmt)
    return result.all()


async def list_links_for_site(
    db: AsyncSession, organization_id: uuid.UUID, site_id: uuid.UUID
) -> list[TopologyLink]:
    result = await db.execute(
        select(TopologyLink).where(
            TopologyLink.organization_id == organization_id, TopologyLink.site_id == site_id
        )
    )
    return list(result.scalars().all())


async def get_link(db: AsyncSession, organization_id: uuid.UUID, link_id: uuid.UUID) -> TopologyLink | None:
    result = await db.execute(
        select(TopologyLink).where(TopologyLink.id == link_id, TopologyLink.organization_id == organization_id)
    )
    return result.scalar_one_or_none()


async def link_pair_exists(
    db: AsyncSession, organization_id: uuid.UUID, asset_a: uuid.UUID, asset_b: uuid.UUID
) -> bool:
    """Trata A-B e B-A como o mesmo link para fins de duplicata — numa
    topologia de rede física a direção do clique não deveria importar."""
    result = await db.execute(
        select(TopologyLink.id).where(
            TopologyLink.organization_id == organization_id,
            or_(
                and_(TopologyLink.source_asset_id == asset_a, TopologyLink.target_asset_id == asset_b),
                and_(TopologyLink.source_asset_id == asset_b, TopologyLink.target_asset_id == asset_a),
            ),
        )
    )
    return result.scalar_one_or_none() is not None


async def get_link_between(
    db: AsyncSession, organization_id: uuid.UUID, asset_a: uuid.UUID, asset_b: uuid.UUID
) -> TopologyLink | None:
    """Igual a `link_pair_exists`, mas devolve o link (em qualquer direção)
    em vez de um bool — usado para substituir/promover um link existente."""
    result = await db.execute(
        select(TopologyLink).where(
            TopologyLink.organization_id == organization_id,
            or_(
                and_(TopologyLink.source_asset_id == asset_a, TopologyLink.target_asset_id == asset_b),
                and_(TopologyLink.source_asset_id == asset_b, TopologyLink.target_asset_id == asset_a),
            ),
        )
    )
    return result.scalar_one_or_none()


async def get_parent_link(
    db: AsyncSession, organization_id: uuid.UUID, asset_id: uuid.UUID
) -> TopologyLink | None:
    """O link com link_type="parent" que aponta PARA `asset_id` (ou seja,
    a aresta hierárquica pai→filho). No máximo um por ativo — invariante
    mantida pela camada de serviço, não por constraint de banco, já que
    `topology_links` continua sendo um grafo genérico."""
    result = await db.execute(
        select(TopologyLink).where(
            TopologyLink.organization_id == organization_id,
            TopologyLink.target_asset_id == asset_id,
            TopologyLink.link_type == "parent",
        )
    )
    return result.scalar_one_or_none()


async def create(db: AsyncSession, **fields: object) -> TopologyLink:
    link = TopologyLink(**fields)
    db.add(link)
    await db.flush()
    return link


async def delete(db: AsyncSession, link: TopologyLink) -> None:
    await db.delete(link)
