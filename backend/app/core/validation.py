import ipaddress
import re

# Baseado em RFC 1123 (labels até 63 chars por label, 253 no total, sem
# hífen/underscore nas pontas do label), mas também aceita "_" pois é comum
# em nomes de equipamentos de rede (switches, roteadores) mesmo não sendo
# estritamente válido em DNS público.
_HOSTNAME_RE = re.compile(
    r"^(?=.{1,253}$)(?![-_])[A-Za-z0-9_-]{1,63}(?<![-_])(\.(?![-_])[A-Za-z0-9_-]{1,63}(?<![-_]))*$"
)


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
