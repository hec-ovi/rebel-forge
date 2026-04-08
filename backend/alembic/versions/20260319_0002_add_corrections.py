"""add corrections table for pgvector learning

Revision ID: 20260319_0002
Revises: 20260317_0001
Create Date: 2026-03-19
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from pgvector.sqlalchemy import Vector


revision: str = "20260319_0002"
down_revision: Union[str, None] = "20260317_0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "corrections",
        sa.Column("id", sa.UUID(), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("workspace_id", sa.UUID(), sa.ForeignKey("workspaces.id"), nullable=False),
        sa.Column("draft_id", sa.UUID(), sa.ForeignKey("content_drafts.id"), nullable=True),
        sa.Column("original_text", sa.Text(), nullable=False),
        sa.Column("corrected_text", sa.Text(), nullable=False),
        sa.Column("context", sa.JSON(), nullable=True),  # platform, topic, tone, etc.
        sa.Column("embedding", Vector(1024), nullable=True),  # bge-m3 is 1024-dim
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )

    # Index for similarity search
    op.create_index(
        "ix_corrections_embedding",
        "corrections",
        ["embedding"],
        postgresql_using="ivfflat",
        postgresql_with={"lists": 10},
        postgresql_ops={"embedding": "vector_cosine_ops"},
    )


def downgrade() -> None:
    op.drop_index("ix_corrections_embedding")
    op.drop_table("corrections")
