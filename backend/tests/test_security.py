"""Testes da revisão de segurança (PROMPT 25): rate limit em endpoints
sensíveis, mensagem de erro que não distingue email inexistente de senha
errada, e recusa de subir com o SECRET_KEY placeholder fora de dev."""

import pytest
from httpx import AsyncClient

from app.core.config import Settings


async def test_login_rate_limited_after_repeated_failures(client: AsyncClient) -> None:
    for _ in range(10):
        response = await client.post(
            "/api/auth/login", json={"email": "ninguem@example.com", "password": "senha-errada"}
        )
        assert response.status_code == 401

    response = await client.post(
        "/api/auth/login", json={"email": "ninguem@example.com", "password": "senha-errada"}
    )
    assert response.status_code == 429


async def test_register_rate_limited_after_repeated_attempts(client: AsyncClient) -> None:
    for i in range(5):
        response = await client.post(
            "/api/auth/register",
            json={
                "name": "Fulano",
                "email": f"fulano{i}@example.com",
                "password": "senha12345",
                "organization_name": "Empresa",
            },
        )
        assert response.status_code == 201

    response = await client.post(
        "/api/auth/register",
        json={
            "name": "Fulano",
            "email": "fulano-extra@example.com",
            "password": "senha12345",
            "organization_name": "Empresa",
        },
    )
    assert response.status_code == 429


async def test_login_same_error_for_missing_user_and_wrong_password(client: AsyncClient) -> None:
    await client.post(
        "/api/auth/register",
        json={
            "name": "Joao",
            "email": "joao@example.com",
            "password": "senha-correta-123",
            "organization_name": "Empresa A",
        },
    )

    missing_user = await client.post(
        "/api/auth/login", json={"email": "nao-existe@example.com", "password": "qualquer-coisa"}
    )
    wrong_password = await client.post(
        "/api/auth/login", json={"email": "joao@example.com", "password": "senha-errada"}
    )

    assert missing_user.status_code == 401
    assert wrong_password.status_code == 401
    assert missing_user.json()["detail"] == wrong_password.json()["detail"]


def test_settings_reject_placeholder_secret_outside_development(monkeypatch: pytest.MonkeyPatch) -> None:
    with pytest.raises(ValueError):
        Settings(app_env="production", secret_key="INSECURE-DEV-ONLY-CHANGE-ME")


def test_settings_allow_placeholder_secret_in_development() -> None:
    settings = Settings(app_env="development", secret_key="INSECURE-DEV-ONLY-CHANGE-ME")
    assert settings.secret_key == "INSECURE-DEV-ONLY-CHANGE-ME"
