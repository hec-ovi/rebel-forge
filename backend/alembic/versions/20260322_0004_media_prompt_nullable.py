"""make media_prompt nullable — text-only posts don't need image generation

Revision ID: 20260322_0004
Revises: 20260321_0003
Create Date: 2026-03-22
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260322_0004"
down_revision: str | None = "20260321_0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column("content_drafts", "media_prompt", existing_type=sa.Text(), nullable=True)


def downgrade() -> None:
    op.execute("UPDATE content_drafts SET media_prompt = '' WHERE media_prompt IS NULL")
    op.alter_column("content_drafts", "media_prompt", existing_type=sa.Text(), nullable=False)
