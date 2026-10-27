from pathlib import Path

import psycopg
from psycopg.rows import dict_row

from app.database import get_database_url

MIGRATIONS_DIR = Path(__file__).resolve().parents[1] / "migrations"


def apply_migrations() -> list[str]:
    migrations = sorted(MIGRATIONS_DIR.glob("*.sql"))
    applied_now: list[str] = []

    with psycopg.connect(get_database_url(), row_factory=dict_row) as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version text PRIMARY KEY,
                applied_at timestamptz NOT NULL DEFAULT now()
            )
            """
        )
        applied = {
            row["version"]
            for row in connection.execute(
                "SELECT version FROM schema_migrations"
            ).fetchall()
        }

        for migration in migrations:
            if migration.name in applied:
                continue

            sql = migration.read_text(encoding="utf-8")
            with connection.transaction():
                connection.execute(sql, prepare=False)
                connection.execute(
                    "INSERT INTO schema_migrations (version) VALUES (%s)",
                    (migration.name,),
                )
            applied_now.append(migration.name)

    return applied_now


if __name__ == "__main__":
    applied = apply_migrations()
    if applied:
        print(f"Applied migrations: {', '.join(applied)}")
    else:
        print("Database schema is up to date.")
