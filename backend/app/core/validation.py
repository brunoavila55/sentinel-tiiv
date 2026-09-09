import ipaddress
import re

# RFC 1123: labels alfanuméricos/hífen, sem hífen nas pontas, até 63 chars
# por label, 253 no total.
_HOSTNAME_RE = re.compile(r"^(?=.{1,253}$)(?!-)[A-Za-z0-9-]{1,63}(?<!-)(\.(?!-)[A-Za-z0-9-]{1,63}(?<!-))*$")


def clean_optional_str(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    return value or None


def validate_hostname(value: str | None) -> str | None:
    value = clean_optional_str(value)
    if value is not None and not _HOSTNAME_RE.match(value):
        raise ValueError("hostname inválido")
    return value


def validate_ip_address(value: str | None) -> str | None:
    """Aceita IPv4 e IPv6."""
    value = clean_optional_str(value)
    if value is not None:
        try:
            ipaddress.ip_address(value)
        except ValueError as exc:
            raise ValueError("endereço IP inválido") from exc
    return value
