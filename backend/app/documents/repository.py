from typing import Any
from uuid import UUID

from psycopg import Connection

from app.worker.extraction import PDF_EXTRACTOR_VERSION

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
            SELECT d.id, d.project_id, d.role, d.document_type, d.file_name,
                   d.revision, d.media_type, d.file_size_bytes, d.sha256,
                   d.status, d.uploaded_by, d.uploaded_at,
                   CASE WHEN er.status IS NULL THEN NULL ELSE
                       jsonb_build_object(
                           'status', er.status,
                           'page_count', er.page_count,
                           'diagnostics', er.diagnostics,
                           'error_code', er.error_code,
                           'error_message', er.error_message
                       )
                   END AS extraction
            FROM documents d
            LEFT JOIN LATERAL (
                SELECT status, page_count, diagnostics, error_code, error_message
                FROM extraction_runs
                WHERE document_id = d.id
                ORDER BY run_number DESC
                LIMIT 1
            ) er ON true
            WHERE d.project_id = %s
            ORDER BY d.uploaded_at DESC, d.id DESC
            LIMIT %s
            """,
            (project_id, limit),
        ).fetchall()

    def get(self, document_id: UUID) -> DocumentRow | None:
        return self.connection.execute(
            """
            SELECT d.id, d.project_id, d.role, d.document_type, d.file_name,
                   d.revision, d.media_type, d.file_size_bytes, d.sha256,
                   d.status, d.uploaded_by, d.uploaded_at,
                   CASE WHEN er.status IS NULL THEN NULL ELSE
                       jsonb_build_object(
                           'status', er.status,
                           'page_count', er.page_count,
                           'diagnostics', er.diagnostics,
                           'error_code', er.error_code,
                           'error_message', er.error_message
                       )
                   END AS extraction
            FROM documents d
            LEFT JOIN LATERAL (
                SELECT status, page_count, diagnostics, error_code, error_message
                FROM extraction_runs
                WHERE document_id = d.id
                ORDER BY run_number DESC
                LIMIT 1
            ) er ON true
            WHERE d.id = %s
            """,
            (document_id,),
        ).fetchone()

    def create_with_ingestion(
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
        with self.connection.transaction():
            self.create(
                document_id=document_id,
                project_id=project_id,
                role=role,
                document_type=document_type,
                file_name=file_name,
                revision=revision,
                storage_key=storage_key,
                file_size_bytes=file_size_bytes,
                sha256=sha256,
            )
            run = self.connection.execute(
                """
                INSERT INTO extraction_runs (
                    document_id, run_number, extractor_version, status
                )
                VALUES (%s, 1, %s, 'queued')
                RETURNING id
                """,
                (document_id, PDF_EXTRACTOR_VERSION),
            ).fetchone()
            self.connection.execute(
                """
                INSERT INTO ingestion_jobs (document_id, extraction_run_id)
                VALUES (%s, %s)
                """,
                (document_id, run["id"]),
            )
            self.connection.execute(
                """
                UPDATE documents
                SET status = 'queued'
                WHERE id = %s
                RETURNING id, project_id, role, document_type, file_name, revision,
                          media_type, file_size_bytes, sha256, status, uploaded_by,
                          uploaded_at
                """,
                (document_id,),
            ).fetchone()
            return self.get(document_id)
