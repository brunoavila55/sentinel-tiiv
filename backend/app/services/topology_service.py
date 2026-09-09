import uuid
from collections.abc import Sequence

from fastapi import HTTPException, status
from sqlalchemy.engine import Row
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.site import Site
from app.models.topology_link import TopologyLink
from app.repositories import asset_repository, site_repository, topology_repository
from app.schemas.topology import TopologyLinkCreateRequest
from app.services import audit_service


async def _ensure_site_in_org(db: AsyncSession, organization_id: uuid.UUID, site_id: uuid.UUID) -> Site:
    site = await site_repository.get_by_id(db, organization_id, site_id)
    if site is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Site não encontrado")
    return site


async def _creates_cycle(
    db: AsyncSession, organization_id: uuid.UUID, asset_id: uuid.UUID, candidate_parent_id: uuid.UUID
) -> bool:
    """Sobe a cadeia de pais a partir de `candidate_parent_id`: se chegar em
    `asset_id`, torná-lo pai criaria um ciclo (asset_id já é ancestral de
    candidate_parent_id)."""
    current: uuid.UUID | None = candidate_parent_id
    visited: set[uuid.UUID] = set()
    while current is not None:
        if current == asset_id:
            return True
        if current in visited:
            return False
        visited.add(current)
        parent_link = await topology_repository.get_parent_link(db, organization_id, current)
        current = parent_link.source_asset_id if parent_link else None
    return False


async def get_topology(
    db: AsyncSession, organization_id: uuid.UUID, site_id: uuid.UUID
) -> tuple[Site, Sequence[Row], list[TopologyLink]]:
    site = await _ensure_site_in_org(db, organization_id, site_id)
    node_rows = await topology_repository.list_nodes_for_site(db, organization_id, site_id)
    links = await topology_repository.list_links_for_site(db, organization_id, site_id)
    return site, node_rows, links


async def create_link(
    db: AsyncSession, organization_id: uuid.UUID, payload: TopologyLinkCreateRequest, actor_user_id: uuid.UUID
) -> TopologyLink:
    await _ensure_site_in_org(db, organization_id, payload.site_id)

    source = await asset_repository.get_model(db, organization_id, payload.source_asset_id)
    target = await asset_repository.get_model(db, organization_id, payload.target_asset_id)
    if source is None or target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ativo de origem ou destino não encontrado")

    if source.site_id != payload.site_id or target.site_id != payload.site_id:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "Origem e destino precisam pertencer ao site informado"
        )

    if await topology_repository.link_pair_exists(db, organization_id, source.id, target.id):
        raise HTTPException(status.HTTP_409_CONFLICT, "Já existe uma conexão entre estes dois ativos")

    # link_type="parent" carrega uma semântica hierárquica (um único pai por
    # ativo, sem ciclos) que os outros tipos de conexão não têm — a mesma
    # regra vale independentemente de o link ter sido criado aqui, no editor
    # manual de topologia, ou por `sync_parent` a partir do formulário do ativo.
    if payload.link_type == "parent":
        if await topology_repository.get_parent_link(db, organization_id, target.id) is not None:
            raise HTTPException(status.HTTP_409_CONFLICT, "Este ativo já possui um pai definido")
        if await _creates_cycle(db, organization_id, target.id, source.id):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Essa relação criaria um ciclo na hierarquia")

    link = await topology_repository.create(
        db,
        organization_id=organization_id,
        site_id=payload.site_id,
        source_asset_id=source.id,
        target_asset_id=target.id,
        link_type=payload.link_type,
    )
    await db.flush()
    await audit_service.record(
        db,
        organization_id=organization_id,
        user_id=actor_user_id,
        action="topology.link_created",
        entity_type="topology_link",
        entity_id=link.id,
        metadata={"source_asset_id": str(source.id), "target_asset_id": str(target.id)},
    )
    await db.commit()
    await db.refresh(link)
    return link


async def sync_parent(
    db: AsyncSession,
    organization_id: uuid.UUID,
    site_id: uuid.UUID,
    asset_id: uuid.UUID,
    parent_asset_id: uuid.UUID | None,
    actor_user_id: uuid.UUID,
) -> None:
    """Mantém o link_type="parent" que aponta para `asset_id` em sincronia
    com o `parent_asset_id` escolhido no formulário do ativo. Não dá commit:
    quem chama (asset_service) já commita a transação do ativo por inteiro.

    Não existe coluna `parent_id` em `assets` — a hierarquia continua sendo
    representada como uma aresta de `topology_links`, só que com uma
    convenção de UX em cima: no máximo um link "parent" por ativo, sem
    ciclos. Isso preserva a possibilidade de a topologia virar um grafo
    mais rico no futuro sem precisar migrar essa coluna."""
    existing = await topology_repository.get_parent_link(db, organization_id, asset_id)

    if parent_asset_id is None:
        if existing is not None:
            await topology_repository.delete(db, existing)
            await audit_service.record(
                db,
                organization_id=organization_id,
                user_id=actor_user_id,
                action="topology.link_removed",
                entity_type="topology_link",
                entity_id=existing.id,
                metadata={"source_asset_id": str(existing.source_asset_id), "target_asset_id": str(asset_id)},
            )
        return

    if parent_asset_id == asset_id:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Um ativo não pode ser pai de si mesmo")

    if existing is not None and existing.source_asset_id == parent_asset_id:
        return  # já é o pai atual, nada a fazer

    parent = await asset_repository.get_model(db, organization_id, parent_asset_id)
    if parent is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ativo pai não encontrado")
    if parent.site_id != site_id:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "O ativo pai precisa pertencer ao mesmo site")

    if await _creates_cycle(db, organization_id, asset_id, parent_asset_id):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Essa relação criaria um ciclo na hierarquia")

    if existing is not None:
        await topology_repository.delete(db, existing)

    # Se já existir qualquer link (de outro tipo, ou na direção inversa)
    # entre esses dois ativos, ele é substituído — evita violar a
    # constraint de unicidade (source, target) e uma dupla aresta confusa
    # representando a mesma relação duas vezes.
    duplicate = await topology_repository.get_link_between(db, organization_id, parent_asset_id, asset_id)
    if duplicate is not None:
        await topology_repository.delete(db, duplicate)

    await db.flush()

    link = await topology_repository.create(
        db,
        organization_id=organization_id,
        site_id=site_id,
        source_asset_id=parent_asset_id,
        target_asset_id=asset_id,
        link_type="parent",
    )
    await audit_service.record(
        db,
        organization_id=organization_id,
        user_id=actor_user_id,
        action="topology.link_created",
        entity_type="topology_link",
        entity_id=link.id,
        metadata={"source_asset_id": str(parent_asset_id), "target_asset_id": str(asset_id)},
    )


async def delete_link(
    db: AsyncSession, organization_id: uuid.UUID, link_id: uuid.UUID, actor_user_id: uuid.UUID
) -> None:
    link = await topology_repository.get_link(db, organization_id, link_id)
    if link is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conexão não encontrada")
    await topology_repository.delete(db, link)
    await audit_service.record(
        db,
        organization_id=organization_id,
        user_id=actor_user_id,
        action="topology.link_removed",
        entity_type="topology_link",
        entity_id=link_id,
        metadata={"source_asset_id": str(link.source_asset_id), "target_asset_id": str(link.target_asset_id)},
    )
    await db.commit()
