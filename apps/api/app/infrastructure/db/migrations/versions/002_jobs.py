"""Cola de jobs diferidos (retries, HITL, follow-ups).

Revision ID: 002_jobs
Revises: 001_baseline
Create Date: 2026-08-24
"""

from alembic import op

revision = "002_jobs"
down_revision = "001_baseline"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS synckre.jobs (
            id VARCHAR(255) PRIMARY KEY,
            kind VARCHAR(100) NOT NULL,
            run_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
            payload JSONB NOT NULL DEFAULT '{}'::jsonb,
            status VARCHAR(50) NOT NULL DEFAULT 'pending',
            attempts INT NOT NULL DEFAULT 0,
            max_attempts INT NOT NULL DEFAULT 5,
            locked_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
            idempotency_key VARCHAR(255),
            last_error TEXT,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_jobs_idempotency_key
            ON synckre.jobs(idempotency_key)
            WHERE idempotency_key IS NOT NULL;
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_jobs_due
            ON synckre.jobs(run_at)
            WHERE status IN ('pending', 'running');
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS synckre.jobs;")
