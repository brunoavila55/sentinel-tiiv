"""logo claro e escuro da organizacao

Revision ID: c3f6a9d02e11
Revises: b2d5e8a41f30
Create Date: 2026-09-09 23:40:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c3f6a9d02e11'
down_revision: Union[str, None] = 'b2d5e8a41f30'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('organizations', sa.Column('logo_light_storage_key', sa.String(length=1000), nullable=True))
    op.add_column('organizations', sa.Column('logo_dark_storage_key', sa.String(length=1000), nullable=True))

    # Logo já existente vira a variante clara: era a única disponível até
    # agora, e o padrão visual do produto (ver PROMPT 13) é claro.
    op.execute("UPDATE organizations SET logo_light_storage_key = logo_storage_key")

    op.drop_constraint('uq_organizations_logo_storage_key', 'organizations', type_='unique')
    op.drop_column('organizations', 'logo_storage_key')

    op.create_unique_constraint('uq_organizations_logo_light_storage_key', 'organizations', ['logo_light_storage_key'])
    op.create_unique_constraint('uq_organizations_logo_dark_storage_key', 'organizations', ['logo_dark_storage_key'])


def downgrade() -> None:
    op.add_column('organizations', sa.Column('logo_storage_key', sa.String(length=1000), nullable=True))
    op.execute("UPDATE organizations SET logo_storage_key = logo_light_storage_key")
    op.create_unique_constraint('uq_organizations_logo_storage_key', 'organizations', ['logo_storage_key'])

    op.drop_constraint('uq_organizations_logo_dark_storage_key', 'organizations', type_='unique')
    op.drop_constraint('uq_organizations_logo_light_storage_key', 'organizations', type_='unique')
    op.drop_column('organizations', 'logo_dark_storage_key')
    op.drop_column('organizations', 'logo_light_storage_key')
