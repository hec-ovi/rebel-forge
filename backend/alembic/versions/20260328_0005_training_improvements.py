"""Training improvements: add platform column to corrections, add platform_styles table

Revision ID: 20260328_0005
Revises: 20260322_0004
Create Date: 2026-03-28
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260328_0005"
down_revision: Union[str, None] = "20260322_0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add platform column to corrections for direct filtering
    op.add_column("corrections", sa.Column("platform", sa.String(50), nullable=True))
    op.add_column("corrections", sa.Column("rating", sa.Integer(), nullable=True))
    op.add_column("corrections", sa.Column("feedback", sa.Text(), nullable=True))
    op.add_column("corrections", sa.Column("had_edits", sa.Boolean(), nullable=True, server_default="false"))
    op.add_column("corrections", sa.Column("source", sa.String(50), nullable=True, server_default="'training'"))
    op.create_index("ix_corrections_platform", "corrections", ["workspace_id", "platform"])

    # Platform style descriptions
    op.create_table(
        "platform_styles",
        sa.Column("id", sa.UUID(), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("workspace_id", sa.UUID(), sa.ForeignKey("workspaces.id"), nullable=False),
        sa.Column("platform", sa.String(50), nullable=False),
        sa.Column("style_description", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_platform_styles_workspace", "platform_styles", ["workspace_id", "platform"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_platform_styles_workspace")
    op.drop_table("platform_styles")
    op.drop_index("ix_corrections_platform")
    op.drop_column("corrections", "source")
    op.drop_column("corrections", "had_edits")
    op.drop_column("corrections", "feedback")
    op.drop_column("corrections", "rating")
    op.drop_column("corrections", "platform")
