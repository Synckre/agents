"""Quita temporal_workflow_id de tasks.

Revision ID: 003_drop_temporal
Revises: 002_jobs
Create Date: 2026-08-24
"""

from alembic import op

revision = "003_drop_temporal"
down_revision = "002_jobs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE synckre.tasks DROP COLUMN IF EXISTS temporal_workflow_id;")


def downgrade() -> None:
    op.execute(
        "ALTER TABLE synckre.tasks ADD COLUMN IF NOT EXISTS temporal_workflow_id VARCHAR(255) DEFAULT NULL;"
    )
