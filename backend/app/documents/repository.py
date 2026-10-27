from typing import Any
from uuid import UUID

from psycopg import Connection
from psycopg.types.json import Jsonb

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
                           'id', er.id,
                           'status', er.status,
                           'page_count', er.page_count,
                           'diagnostics', er.diagnostics,
                           'error_code', er.error_code,
                           'error_message', er.error_message
                       )
                   END AS extraction
            FROM documents d
            LEFT JOIN LATERAL (
                SELECT id, status, page_count, diagnostics, error_code, error_message
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
                           'id', er.id,
                           'status', er.status,
                           'page_count', er.page_count,
                           'diagnostics', er.diagnostics,
                           'error_code', er.error_code,
                           'error_message', er.error_message
                       )
                   END AS extraction
            FROM documents d
            LEFT JOIN LATERAL (
                SELECT id, status, page_count, diagnostics, error_code, error_message
                FROM extraction_runs
                WHERE document_id = d.id
                ORDER BY run_number DESC
                LIMIT 1
            ) er ON true
            WHERE d.id = %s
            """,
            (document_id,),
        ).fetchone()

    def get_storage_key(self, document_id: UUID) -> str | None:
        row = self.connection.execute(
            "SELECT storage_key FROM documents WHERE id = %s",
            (document_id,),
        ).fetchone()
        return row["storage_key"] if row is not None else None

    def list_schedule_rows(
        self,
        document_id: UUID,
        extraction_run_id: UUID,
    ) -> list[DocumentRow] | None:
        run = self.connection.execute(
            """
            SELECT 1
            FROM extraction_runs
            WHERE id = %s AND document_id = %s
            """,
            (extraction_run_id, document_id),
        ).fetchone()
        if run is None:
            return None

        return self.connection.execute(
            """
            SELECT id, extraction_run_id, row_number, member_mark_raw,
                   member_mark_normalized, section_raw, section_normalized,
                   page_number, page_width, page_height, source_bbox, confidence,
                   review_state, correction, reviewed_by, reviewed_at,
                   COALESCE(correction->>'member_mark', member_mark_raw)
                       AS member_mark,
                   COALESCE(correction->>'section', section_raw) AS section
            FROM schedule_rows
            WHERE extraction_run_id = %s
            ORDER BY page_number, row_number, id
            """,
            (extraction_run_id,),
        ).fetchall()

    def update_schedule_row(
        self,
        row_id: UUID,
        *,
        review_state: str | None,
        member_mark: str | None,
        section: str | None,
    ) -> DocumentRow | None:
        with self.connection.transaction():
            current = self.connection.execute(
                "SELECT review_state, correction FROM schedule_rows WHERE id = %s",
                (row_id,),
            ).fetchone()
            if current is None:
                return None

            correction = dict(current["correction"])
            if member_mark is not None:
                correction["member_mark"] = member_mark.strip()
            if section is not None:
                correction["section"] = section.strip()
            row = self.connection.execute(
                """
                UPDATE schedule_rows
                SET review_state = %s,
                    correction = %s,
                    reviewed_by = 'local-user',
                    reviewed_at = now()
                WHERE id = %s
                RETURNING id, extraction_run_id, row_number, member_mark_raw,
                          member_mark_normalized, section_raw, section_normalized,
                          page_number, page_width, page_height, source_bbox,
                          confidence, review_state, correction, reviewed_by,
                          reviewed_at,
                          COALESCE(correction->>'member_mark', member_mark_raw)
                              AS member_mark,
                          COALESCE(correction->>'section', section_raw) AS section
                """,
                (
                    review_state or current["review_state"],
                    Jsonb(correction),
                    row_id,
                ),
            ).fetchone()
            self.connection.execute(
                """
                UPDATE documents AS document
                SET status = 'ready'
                FROM extraction_runs AS run
                WHERE run.id = (
                    SELECT extraction_run_id
                    FROM schedule_rows
                    WHERE id = %s
                )
                  AND document.id = run.document_id
                  AND run.status = 'completed'
                  AND NOT EXISTS (
                      SELECT 1
                      FROM schedule_rows AS remaining
                      WHERE remaining.extraction_run_id = run.id
                        AND remaining.review_state = 'needs_review'
                  )
                  AND jsonb_array_length(
                      COALESCE(run.diagnostics->'warnings', '[]'::jsonb)
                  ) = 0
                """,
                (row_id,),
            )
            return row

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
