"""Importa uma planilha de topologia (Nome, IP, Parent) como dados reais.

Ferramenta administrativa de carga inicial — não é um fluxo de cliente,
então escreve direto via repositories (não por `asset_service`), o que
significa que os limites de plano do `EntitlementService`
(`app/services/entitlement_service.py`) não se aplicam aqui de propósito.
Se a organização de destino estiver num plano com `max_assets` baixo,
ajuste o plano dela manualmente antes de rodar em produção.

Uso:
    python -m scripts.import_topology --org-slug minha-empresa

A planilha precisa ter as colunas Nome, IP, Parent (Parent = "(raiz)"
para os nós de topo). Idempotente: pode rodar de novo sem duplicar site,
ativos ou links.
"""

import argparse
import asyncio
import ipaddress
import sys
from datetime import datetime, timezone

import openpyxl
from sqlalchemy import select

from app.core.database import AsyncSessionLocal
from app.models.asset import Asset
from app.models.organization import Organization
from app.repositories import asset_repository, check_repository, site_repository, topology_repository

ROOT_MARKER = "(raiz)"


def _parse_rows(path: str) -> list[tuple[str, str, str]]:
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb.worksheets[0]
    rows: list[tuple[str, str, str]] = []
    for name, ip, parent in ws.iter_rows(min_row=2, max_col=3, values_only=True):
        if not name:
            continue
        rows.append((str(name).strip(), str(ip).strip() if ip else "", str(parent).strip() if parent else ROOT_MARKER))
    return rows


def _ip_and_hostname(value: str) -> tuple[str | None, str | None]:
    if not value:
        return None, None
    try:
        ipaddress.ip_address(value)
        return value, None
    except ValueError:
        return None, value


async def _get_organization(db, org_slug: str) -> Organization:
    result = await db.execute(select(Organization).where(Organization.slug == org_slug))
    org = result.scalar_one_or_none()
    if org is None:
        available = await db.execute(select(Organization.slug))
        slugs = ", ".join(s for (s,) in available.all()) or "(nenhuma organização cadastrada)"
        print(f"Organização com slug '{org_slug}' não encontrada. Disponíveis: {slugs}", file=sys.stderr)
        raise SystemExit(1)
    return org


async def _get_or_create_site(db, organization_id, site_name: str):
    existing = await site_repository.list_sites(db, organization_id, search=site_name)
    for site, _count in existing:
        if site.name == site_name:
            return site
    return await site_repository.create(db, organization_id=organization_id, name=site_name)


async def _get_or_create_asset(db, organization_id, site_id, name: str, ip: str, stats: dict):
    result = await db.execute(
        select(Asset).where(Asset.organization_id == organization_id, Asset.site_id == site_id, Asset.name == name)
    )
    existing = result.scalar_one_or_none()
    if existing is not None:
        stats["assets_skipped"] += 1
        return existing

    ip_address, hostname = _ip_and_hostname(ip)
    asset = await asset_repository.create(
        db,
        organization_id=organization_id,
        site_id=site_id,
        name=name,
        hostname=hostname,
        ip_address=ip_address,
        enabled=True,
    )
    stats["assets_created"] += 1
    return asset


async def _ensure_parent_link(db, organization_id, site_id, parent_asset_id, child_asset_id, stats: dict) -> None:
    if await topology_repository.get_parent_link(db, organization_id, child_asset_id) is not None:
        stats["links_skipped"] += 1
        return
    if await topology_repository.link_pair_exists(db, organization_id, parent_asset_id, child_asset_id):
        stats["links_skipped"] += 1
        return
    await topology_repository.create(
        db,
        organization_id=organization_id,
        site_id=site_id,
        source_asset_id=parent_asset_id,
        target_asset_id=child_asset_id,
        link_type="parent",
    )
    stats["links_created"] += 1


async def _ensure_ping_check(db, organization_id, asset_id, stats: dict) -> None:
    existing = await check_repository.list_for_asset(db, organization_id, asset_id)
    if any(check.type == "ping" for check in existing):
        stats["checks_skipped"] += 1
        return
    await check_repository.create(
        db,
        organization_id=organization_id,
        asset_id=asset_id,
        type="ping",
        enabled=True,
        interval_seconds=30,
        timeout_seconds=1,
        config={"packets": 3},
        next_check_at=datetime.now(timezone.utc),
    )
    stats["checks_created"] += 1


async def run(args: argparse.Namespace) -> None:
    rows = _parse_rows(args.file)
    stats = {
        "assets_created": 0,
        "assets_skipped": 0,
        "links_created": 0,
        "links_skipped": 0,
        "checks_created": 0,
        "checks_skipped": 0,
    }

    async with AsyncSessionLocal() as db:
        organization = await _get_organization(db, args.org_slug)
        site = await _get_or_create_site(db, organization.id, args.site_name)

        name_to_asset_id: dict[str, object] = {}
        for name, ip, _parent in rows:
            asset = await _get_or_create_asset(db, organization.id, site.id, name, ip, stats)
            name_to_asset_id[name] = asset.id
            if not args.no_checks:
                await _ensure_ping_check(db, organization.id, asset.id, stats)

        for name, _ip, parent in rows:
            if parent == ROOT_MARKER:
                continue
            parent_id = name_to_asset_id.get(parent)
            if parent_id is None:
                print(f"Aviso: '{name}' referencia pai desconhecido '{parent}', pulando link.", file=sys.stderr)
                continue
            await _ensure_parent_link(db, organization.id, site.id, parent_id, name_to_asset_id[name], stats)

        await db.commit()

    print(
        f"Site: {args.site_name}\n"
        f"Ativos: {stats['assets_created']} criados, {stats['assets_skipped']} já existiam\n"
        f"Links de hierarquia: {stats['links_created']} criados, {stats['links_skipped']} já existiam\n"
        + (
            f"Checks de ping: {stats['checks_created']} criados, {stats['checks_skipped']} já existiam\n"
            if not args.no_checks
            else "Checks de ping: não criados (--no-checks)\n"
        )
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--file", default="topologia_nodes.xlsx", help="Caminho da planilha (Nome, IP, Parent)")
    parser.add_argument("--org-slug", required=True, help="Slug da organização de destino")
    parser.add_argument("--site-name", default="Rede importada", help="Nome do site a usar/criar")
    parser.add_argument(
        "--no-checks", action="store_true", help="Não criar um check de ping por ativo importado"
    )
    args = parser.parse_args()
    asyncio.run(run(args))


if __name__ == "__main__":
    main()
