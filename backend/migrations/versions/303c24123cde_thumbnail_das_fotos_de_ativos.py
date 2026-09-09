"""thumbnail das fotos de ativos

Revision ID: 303c24123cde
Revises: 8648e6e0942f
Create Date: 2026-09-09 15:00:23.447057

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '303c24123cde'
down_revision: Union[str, None] = '8648e6e0942f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('asset_photos', sa.Column('thumbnail_storage_key', sa.String(length=1000), nullable=True))
    op.create_unique_constraint(
        'uq_asset_photos_thumbnail_storage_key', 'asset_photos', ['thumbnail_storage_key']
    )


def downgrade() -> None:
    op.drop_constraint('uq_asset_photos_thumbnail_storage_key', 'asset_photos', type_='unique')
    op.drop_column('asset_photos', 'thumbnail_storage_key')
