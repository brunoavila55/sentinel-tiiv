import asyncio
from collections.abc import AsyncIterator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import get_settings
from app.core.database import Base, get_db
from app.core.rate_limit import reset_all as reset_rate_limiters
from app.main import app

settings = get_settings()

_db_name = settings.database_url.rsplit("/", 1)[-1] + "_test"
TEST_DATABASE_URL = settings.database_url.rsplit("/", 1)[0] + "/" + _db_name
_ADMIN_DATABASE_URL = settings.database_url.rsplit("/", 1)[0] + "/postgres"

# Ordem não importa para TRUNCATE ... CASCADE, mas listar explicitamente
# deixa claro quais tabelas a suíte conhece.
_TABLES = [
    "refresh_tokens",
    "check_results",
    "topology_links",
    "checks",
    "asset_photos",
    "assets",
    "sites",
    "organization_invites",
    "organization_users",
    "audit_logs",
    "organizations",
    "users",
]


async def _create_test_database() -> None:
    admin_engine = create_async_engine(_ADMIN_DATABASE_URL, isolation_level="AUTOCOMMIT")
    async with admin_engine.connect() as conn:
        await conn.execute(text(f'DROP DATABASE IF EXISTS "{_db_name}"'))
        await conn.execute(text(f'CREATE DATABASE "{_db_name}"'))
    await admin_engine.dispose()

    schema_engine = create_async_engine(TEST_DATABASE_URL)
    async with schema_engine.begin() as conn:
        # create_all (não Alembic) por velocidade: a migration em si já é
        # validada manualmente (upgrade/downgrade) fora da suíte de testes.
        await conn.run_sync(Base.metadata.create_all)
    await schema_engine.dispose()


@pytest.fixture(scope="session", autouse=True)
def _test_database() -> None:
    """Fixture síncrona de propósito: roda seu próprio asyncio.run() isolado,
    evitando qualquer engine/conexão asyncpg atravessar o event loop
    por-teste que o pytest-asyncio cria para cada test function."""
    asyncio.run(_create_test_database())


@pytest_asyncio.fixture
async def _test_engine() -> AsyncIterator[AsyncEngine]:
    engine = create_async_engine(TEST_DATABASE_URL)
    yield engine
    await engine.dispose()


@pytest_asyncio.fixture(autouse=True)
async def _clean_tables(_test_engine: AsyncEngine) -> None:
    async with _test_engine.begin() as conn:
        await conn.execute(text(f"TRUNCATE {', '.join(_TABLES)} RESTART IDENTITY CASCADE"))
    # Todo teste bate no client de teste como o mesmo IP; sem isso o rate
    # limiter (PROMPT 25) acumularia hits entre testes não relacionados.
    reset_rate_limiters()


@pytest_asyncio.fixture
async def db_session(_test_engine: AsyncEngine, _clean_tables: None) -> AsyncIterator[AsyncSession]:
    session_factory = async_sessionmaker(_test_engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session


@pytest_asyncio.fixture
async def client(db_session: AsyncSession) -> AsyncIterator[AsyncClient]:
    async def _override_get_db() -> AsyncIterator[AsyncSession]:
        # Nota: não fazemos rollback-on-exception aqui. Um teste faz várias
        # chamadas HTTP reaproveitando a mesma sessão; um rollback expira
        # TODOS os objetos rastreados (não só o da mutação com erro), e o
        # lazy-load subsequente de um atributo expirado fora de um await
        # explícito quebra com MissingGreenlet. A prevenção real é nos
        # services: nunca deixar um objeto rastreado mutado antes de
        # validar (ver asset_service.update_asset).
        yield db_session

    app.dependency_overrides[get_db] = _override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()
