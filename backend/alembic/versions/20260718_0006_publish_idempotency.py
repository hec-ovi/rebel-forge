"""enforce one publication attempt and result per draft

Revision ID: 20260718_0006
Revises: 20260328_0005
Create Date: 2026-07-18
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260718_0006"
down_revision: str | None = "20260328_0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_unique_constraint("uq_publish_job_draft", "publish_jobs", ["draft_id"])


def downgrade() -> None:
    op.drop_constraint("uq_publish_job_draft", "publish_jobs", type_="unique")
