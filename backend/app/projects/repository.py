from datetime import datetime
from typing import Any
from uuid import UUID

from psycopg import Connection

ProjectRow = dict[str, Any]
UPDATE_COLUMNS = {
    "name": "name",
    "project_number": "project_number",
    "description": "description",
}


class ProjectRepository:
    def __init__(self, connection: Connection[Any]) -> None:
        self.connection = connection

    def create(
        self,
        *,
        name: str,
        project_number: str | None,
        description: str | None,
    ) -> ProjectRow:
        return self.connection.execute(
            """
            INSERT INTO projects (name, project_number, description, created_by)
            VALUES (%s, %s, %s, %s)
            RETURNING id, name, project_number, description, created_by,
                      created_at, updated_at
            """,
            (name, project_number, description, "local-user"),
        ).fetchone()

    def list(
        self,
        *,
        limit: int,
        before: tuple[datetime, UUID] | None,
    ) -> list[ProjectRow]:
        if before is None:
            return self.connection.execute(
                """
                SELECT id, name, project_number, description, created_by,
                       created_at, updated_at
                FROM projects
                ORDER BY created_at DESC, id DESC
                LIMIT %s
                """,
                (limit,),
            ).fetchall()

        return self.connection.execute(
            """
            SELECT id, name, project_number, description, created_by,
                   created_at, updated_at
            FROM projects
            WHERE (created_at, id) < (%s, %s)
            ORDER BY created_at DESC, id DESC
            LIMIT %s
            """,
            (*before, limit),
        ).fetchall()

    def get(self, project_id: UUID) -> ProjectRow | None:
        return self.connection.execute(
            """
            SELECT id, name, project_number, description, created_by,
                   created_at, updated_at
            FROM projects
            WHERE id = %s
            """,
            (project_id,),
        ).fetchone()

    def update(self, project_id: UUID, fields: dict[str, Any]) -> ProjectRow | None:
        assignments = ", ".join(f"{UPDATE_COLUMNS[field]} = %s" for field in fields)
        values = [fields[field] for field in fields]
        values.append(project_id)
        return self.connection.execute(
            f"""
            UPDATE projects
            SET {assignments}, updated_at = now()
            WHERE id = %s
            RETURNING id, name, project_number, description, created_by,
                      created_at, updated_at
            """,
            values,
        ).fetchone()

    def delete(self, project_id: UUID) -> bool:
        row = self.connection.execute(
            "DELETE FROM projects WHERE id = %s RETURNING id",
            (project_id,),
        ).fetchone()
        return row is not None
