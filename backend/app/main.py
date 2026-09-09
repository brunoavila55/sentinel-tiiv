from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import (
    asset_photos,
    assets,
    audit_logs,
    auth,
    checks,
    dashboard,
    health,
    invites,
    organizations,
    problems,
    sites,
    topology,
)
from app.core.config import get_settings
from app.core.logging import configure_logging
from app.core.request_logging import log_requests, register_exception_handlers

settings = get_settings()
configure_logging("backend")

app = FastAPI(title="Sentinel", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.middleware("http")(log_requests)
register_exception_handlers(app)

# Rota /health na raiz.
app.include_router(health.router)
# Rota /api/health, mesmo router sob o prefixo da API.
app.include_router(health.router, prefix="/api")
app.include_router(auth.router, prefix="/api")
app.include_router(organizations.router, prefix="/api")
app.include_router(invites.router, prefix="/api")
app.include_router(sites.router, prefix="/api")
app.include_router(assets.router, prefix="/api")
app.include_router(asset_photos.router, prefix="/api")
app.include_router(checks.router, prefix="/api")
app.include_router(problems.router, prefix="/api")
app.include_router(topology.router, prefix="/api")
app.include_router(dashboard.router, prefix="/api")
app.include_router(audit_logs.router, prefix="/api")
