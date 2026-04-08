"""add conversations table for chat history

Revision ID: 20260321_0003
Revises: 20260319_0002
Create Date: 2026-03-21
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260321_0003"
down_revision: Union[str, None] = "20260319_0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "conversations",
        sa.Column("id", sa.UUID(), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("workspace_id", sa.UUID(), sa.ForeignKey("workspaces.id"), nullable=False),
        sa.Column("mode", sa.String(50), nullable=False),  # "general" or "onboarding"
        sa.Column("role", sa.String(20), nullable=False),  # "user", "assistant", "system"
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("tool_name", sa.String(100), nullable=True),  # if this was a tool call
        sa.Column("tool_result", sa.JSON(), nullable=True),  # tool result data
        sa.Column("request_payload", sa.JSON(), nullable=True),  # what was sent to LLM
        sa.Column("response_meta", sa.JSON(), nullable=True),  # token usage, model, etc.
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )

    op.create_index("ix_conversations_workspace_created", "conversations", ["workspace_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_conversations_workspace_created")
    op.drop_table("conversations")
