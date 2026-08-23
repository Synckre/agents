"""Baseline del esquema synckre (idempotente).

Revision ID: 001_baseline
Revises:
Create Date: 2026-08-23
"""

from alembic import op
from sqlalchemy import text

from app.infrastructure.db.schema import SETUP_SCHEMA_SQL

revision = "001_baseline"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.get_bind().execute(text(SETUP_SCHEMA_SQL))


def downgrade() -> None:
    op.execute("DROP SCHEMA IF EXISTS synckre CASCADE")
