import enum


class UserStatus(str, enum.Enum):
    ACTIVE = "active"
    DISABLED = "disabled"


class OrganizationStatus(str, enum.Enum):
    ACTIVE = "active"
    DISABLED = "disabled"


class OrganizationRole(str, enum.Enum):
    OWNER = "owner"
    ADMIN = "admin"
    OPERATOR = "operator"
    VIEWER = "viewer"


class AssetStatus(str, enum.Enum):
    UNKNOWN = "unknown"
    UP = "up"
    WARNING = "warning"
    DOWN = "down"
