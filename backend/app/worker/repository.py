from typing import Any
from uuid import UUID

from psycopg import Connection
from psycopg.types.json import Jsonb

from app.worker.extraction import ExtractedDocument

JobRow = dict[str, Any]


class IngestionRepository:
    def __init__(self, connection: Connection[Any]) -> None:
        self.connection = connection

    def claim_next(self, *, stale_after_seconds: int = 300) -> JobRow | None:
        with self.connection.transaction():
            exhausted = self.connection.execute(
                """
                UPDATE ingestion_jobs
                SET status = 'failed',
                    locked_at = NULL,
                    completed_at = now(),
                    error_code = 'WORKER_INTERRUPTED',
                    error_message = 'Worker stopped before completing the job.',
                    updated_at = now()
                WHERE status = 'processing'
                  AND locked_at < now() - make_interval(secs => %s)
                  AND attempts >= max_attempts
                RETURNING document_id, extraction_run_id
                """,
                (stale_after_seconds,),
            ).fetchall()
            for row in exhausted:
                self._set_terminal_failure(
                    document_id=row["document_id"],
                    extraction_run_id=row["extraction_run_id"],
                    error_code="WORKER_INTERRUPTED",
                    error_message="Worker stopped before completing the job.",
                )

            job = self.connection.execute(
                """
                WITH candidate AS (
                    SELECT id
                    FROM ingestion_jobs
                    WHERE (
                        status = 'queued'
                        AND available_at <= now()
                        AND attempts < max_attempts
                    ) OR (
                        status = 'processing'
                        AND locked_at < now() - make_interval(secs => %s)
                        AND attempts < max_attempts
                    )
                    ORDER BY available_at, created_at, id
                    FOR UPDATE SKIP LOCKED
                    LIMIT 1
                )
                UPDATE ingestion_jobs AS job
                SET status = 'processing',
                    attempts = job.attempts + 1,
                    locked_at = now(),
                    started_at = COALESCE(job.started_at, now()),
                    updated_at = now()
                FROM candidate, documents AS document
                WHERE job.id = candidate.id
                  AND document.id = job.document_id
                RETURNING job.id, job.document_id, job.extraction_run_id,
                          job.attempts, job.max_attempts, document.storage_key
                """,
                (stale_after_seconds,),
            ).fetchone()
            if job is None:
                return None

            self.connection.execute(
                """
                UPDATE extraction_runs
                SET status = 'processing',
                    started_at = COALESCE(started_at, now()),
                    error_code = NULL,
                    error_message = NULL
                WHERE id = %s
                """,
                (job["extraction_run_id"],),
            )
            self.connection.execute(
                "UPDATE documents SET status = 'processing' WHERE id = %s",
                (job["document_id"],),
            )
            return job

    def complete(
        self,
        *,
        job_id: UUID,
        document_id: UUID,
        extraction_run_id: UUID,
        result: ExtractedDocument,
    ) -> None:
        with self.connection.transaction():
            for page in result.pages:
                self.connection.execute(
                    """
                    INSERT INTO extracted_pages (
                        extraction_run_id, page_number, page_width, page_height,
                        text_content, text_char_count
                    )
                    VALUES (%s, %s, %s, %s, %s, %s)
                    """,
                    (
                        extraction_run_id,
                        page.page_number,
                        page.page_width,
                        page.page_height,
                        page.text_content,
                        len(page.text_content),
                    ),
                )

            for row in result.schedule_rows:
                self.connection.execute(
                    """
                    INSERT INTO schedule_rows (
                        extraction_run_id, schedule_type, row_number,
                        member_mark_raw, member_mark_normalized,
                        section_raw, section_normalized, page_number,
                        page_width, page_height, source_bbox, extractor,
                        confidence, review_state
                    )
                    VALUES (%s, 'beam', %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        extraction_run_id,
                        row.row_number,
                        row.member_mark_raw,
                        row.member_mark_normalized,
                        row.section_raw,
                        row.section_normalized,
                        row.page_number,
                        row.page_width,
                        row.page_height,
                        Jsonb(row.source_bbox),
                        row.extractor,
                        row.confidence,
                        row.review_state,
                    ),
                )

            self.connection.execute(
                """
                UPDATE extraction_runs
                SET status = 'completed',
                    page_count = %s,
                    diagnostics = %s,
                    error_code = NULL,
                    error_message = NULL,
                    completed_at = now()
                WHERE id = %s
                """,
                (
                    len(result.pages),
                    Jsonb(result.diagnostics),
                    extraction_run_id,
                ),
            )
            self.connection.execute(
                "UPDATE documents SET status = %s WHERE id = %s",
                ("needs_review" if result.needs_review else "ready", document_id),
            )
            self.connection.execute(
                """
                UPDATE ingestion_jobs
                SET status = 'completed',
                    locked_at = NULL,
                    completed_at = now(),
                    error_code = NULL,
                    error_message = NULL,
                    updated_at = now()
                WHERE id = %s
                """,
                (job_id,),
            )

    def fail(
        self,
        *,
        job_id: UUID,
        document_id: UUID,
        extraction_run_id: UUID,
        attempts: int,
        max_attempts: int,
        error_code: str,
        error_message: str,
        retryable: bool,
    ) -> bool:
        will_retry = retryable and attempts < max_attempts
        with self.connection.transaction():
            if will_retry:
                delay_seconds = min(30 * (2 ** (attempts - 1)), 900)
                self.connection.execute(
                    """
                    UPDATE ingestion_jobs
                    SET status = 'queued',
                        available_at = now() + make_interval(secs => %s),
                        locked_at = NULL,
                        error_code = %s,
                        error_message = %s,
                        updated_at = now()
                    WHERE id = %s
                    """,
                    (delay_seconds, error_code, error_message, job_id),
                )
                self.connection.execute(
                    """
                    UPDATE extraction_runs
                    SET status = 'queued',
                        diagnostics = jsonb_build_object(
                            'last_error_code', %s,
                            'last_error_message', %s,
                            'retry_scheduled', true
                        )
                    WHERE id = %s
                    """,
                    (error_code, error_message, extraction_run_id),
                )
                self.connection.execute(
                    "UPDATE documents SET status = 'queued' WHERE id = %s",
                    (document_id,),
                )
                return True

            self._set_terminal_failure(
                document_id=document_id,
                extraction_run_id=extraction_run_id,
                error_code=error_code,
                error_message=error_message,
            )
            self.connection.execute(
                """
                UPDATE ingestion_jobs
                SET status = 'failed',
                    locked_at = NULL,
                    completed_at = now(),
                    error_code = %s,
                    error_message = %s,
                    updated_at = now()
                WHERE id = %s
                """,
                (error_code, error_message, job_id),
            )
            return False

    def _set_terminal_failure(
        self,
        *,
        document_id: UUID,
        extraction_run_id: UUID,
        error_code: str,
        error_message: str,
    ) -> None:
        self.connection.execute(
            """
            UPDATE extraction_runs
            SET status = 'failed',
                diagnostics = jsonb_build_object(
                    'error_code', %s,
                    'error_message', %s
                ),
                error_code = %s,
                error_message = %s,
                completed_at = now()
            WHERE id = %s
            """,
            (
                error_code,
                error_message,
                error_code,
                error_message,
                extraction_run_id,
            ),
        )
        self.connection.execute(
            "UPDATE documents SET status = 'failed' WHERE id = %s",
            (document_id,),
        )
