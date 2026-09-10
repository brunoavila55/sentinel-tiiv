"""logo e favicon da organizacao

Revision ID: b2d5e8a41f30
Revises: a1c4f9b3d7e2
Create Date: 2026-09-09 23:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b2d5e8a41f30'
down_revision: Union[str, None] = 'a1c4f9b3d7e2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('organizations', sa.Column('logo_storage_key', sa.String(length=1000), nullable=True))
    op.add_column('organizations', sa.Column('favicon_storage_key', sa.String(length=1000), nullable=True))
    op.create_unique_constraint('uq_organizations_logo_storage_key', 'organizations', ['logo_storage_key'])
    op.create_unique_constraint('uq_organizations_favicon_storage_key', 'organizations', ['favicon_storage_key'])


def downgrade() -> None:
    op.drop_constraint('uq_organizations_favicon_storage_key', 'organizations', type_='unique')
    op.drop_constraint('uq_organizations_logo_storage_key', 'organizations', type_='unique')
    op.drop_column('organizations', 'favicon_storage_key')
    op.drop_column('organizations', 'logo_storage_key')
