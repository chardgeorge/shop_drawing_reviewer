from typing import Any
from uuid import UUID

from psycopg import Connection

DocumentRow = dict[str, Any]


class DocumentRepository:
    def __init__(self, connection: Connection[Any]) -> None:
        self.connection = connection

    def project_exists(self, project_id: UUID) -> bool:
        row = self.connection.execute(
            "SELECT 1 FROM projects WHERE id = %s",
            (project_id,),
        ).fetchone()
        return row is not None

    def create(
        self,
        *,
        document_id: UUID,
        project_id: UUID,
        role: str,
        document_type: str,
        file_name: str,
        revision: str | None,
        storage_key: str,
        file_size_bytes: int,
        sha256: str,
    ) -> DocumentRow:
        return self.connection.execute(
            """
            INSERT INTO documents (
                id, project_id, role, document_type, file_name, revision,
                storage_key, media_type, file_size_bytes, sha256, uploaded_by
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, 'application/pdf', %s, %s, %s)
            RETURNING id, project_id, role, document_type, file_name, revision,
                      media_type, file_size_bytes, sha256, status, uploaded_by,
                      uploaded_at
            """,
            (
                document_id,
                project_id,
                role,
                document_type,
                file_name,
                revision,
                storage_key,
                file_size_bytes,
                sha256,
                "local-user",
            ),
        ).fetchone()

    def list_for_project(self, project_id: UUID, limit: int) -> list[DocumentRow]:
        return self.connection.execute(
            """
            SELECT id, project_id, role, document_type, file_name, revision,
                   media_type, file_size_bytes, sha256, status, uploaded_by,
                   uploaded_at
            FROM documents
            WHERE project_id = %s
            ORDER BY uploaded_at DESC, id DESC
            LIMIT %s
            """,
            (project_id, limit),
        ).fetchall()

    def get(self, document_id: UUID) -> DocumentRow | None:
        return self.connection.execute(
            """
            SELECT id, project_id, role, document_type, file_name, revision,
                   media_type, file_size_bytes, sha256, status, uploaded_by,
                   uploaded_at
            FROM documents
            WHERE id = %s
            """,
            (document_id,),
        ).fetchone()
