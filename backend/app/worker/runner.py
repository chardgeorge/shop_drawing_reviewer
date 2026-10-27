import gc
import logging
import tempfile
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any, BinaryIO, Protocol

import psycopg
from psycopg.rows import dict_row

from app.database import get_database_url
from app.documents.storage import LocalFileStorage, default_storage_root
from app.worker.extraction import ExtractedDocument, IngestionError, extract_pdf
from app.worker.repository import IngestionRepository

logger = logging.getLogger(__name__)


class IngestionJobs(Protocol):
    def claim_next(self) -> dict[str, Any] | None: ...

    def complete(
        self,
        *,
        job_id: Any,
        document_id: Any,
        extraction_run_id: Any,
        result: ExtractedDocument,
    ) -> None: ...

    def fail(
        self,
        *,
        job_id: Any,
        document_id: Any,
        extraction_run_id: Any,
        attempts: int,
        max_attempts: int,
        error_code: str,
        error_message: str,
        retryable: bool,
    ) -> bool: ...


class PdfStorageReader(Protocol):
    def open(self, storage_key: str) -> BinaryIO: ...


class IngestionWorker:
    def __init__(
        self,
        repository: IngestionJobs,
        storage: PdfStorageReader,
        connection: psycopg.Connection[Any] | None = None,
    ) -> None:
        self.repository = repository
        self.storage = storage
        self.connection = connection

    def close(self) -> None:
        if self.connection is not None:
            self.connection.close()

    def run_once(self) -> bool:
        job = self.repository.claim_next()
        if job is None:
            return False

        try:
            with self.storage.open(job["storage_key"]) as pdf_file:
                result = extract_pdf_from_stream(pdf_file)
            self.repository.complete(
                job_id=job["id"],
                document_id=job["document_id"],
                extraction_run_id=job["extraction_run_id"],
                result=result,
            )
        except IngestionError as error:
            self._record_failure(job, error.code, str(error), error.retryable)
        except FileNotFoundError:
            self._record_failure(
                job,
                "STORAGE_FILE_MISSING",
                "The stored PDF file is missing from local storage.",
                False,
            )
        except OSError:
            self._record_failure(
                job,
                "STORAGE_READ_ERROR",
                "The stored PDF could not be read.",
                True,
            )
            logger.exception(
                "Unable to read stored PDF for ingestion job %s.",
                job["id"],
            )
        else:
            logger.info("Completed ingestion job %s.", job["id"])
        return True

    def _record_failure(
        self,
        job: dict[str, Any],
        code: str,
        message: str,
        retryable: bool,
    ) -> None:
        will_retry = self.repository.fail(
            job_id=job["id"],
            document_id=job["document_id"],
            extraction_run_id=job["extraction_run_id"],
            attempts=job["attempts"],
            max_attempts=job["max_attempts"],
            error_code=code,
            error_message=message,
            retryable=retryable,
        )
        if will_retry:
            logger.warning(
                "Ingestion job %s failed with %s; a retry was scheduled.",
                job["id"],
                code,
            )
        else:
            logger.error(
                "Ingestion job %s failed permanently with %s.",
                job["id"],
                code,
            )


def extract_pdf_from_stream(pdf_file: BinaryIO) -> ExtractedDocument:
    temporary_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            suffix=".pdf",
            delete=False,
        ) as temporary_file:
            temporary_path = Path(temporary_file.name)
            while chunk := pdf_file.read(1024 * 1024):
                temporary_file.write(chunk)
        if temporary_path is None:
            raise RuntimeError("Failed to create a temporary PDF file.")
        return extract_pdf(temporary_path)
    except IngestionError as error:
        exception: BaseException | None = error
        while exception is not None:
            exception.__traceback__ = None
            exception = exception.__cause__ or exception.__context__
        # PyMuPDF can retain failed native file handles through traceback frames.
        gc.collect()
        raise error.with_traceback(None) from None
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)


def run_worker(
    *,
    once: bool = False,
    poll_interval_seconds: float = 2,
    worker_factory: Callable[[], IngestionWorker] | None = None,
) -> None:
    if poll_interval_seconds <= 0:
        raise ValueError("Poll interval must be greater than zero.")

    if worker_factory is None:
        worker_factory = create_worker

    worker = worker_factory()
    try:
        while True:
            processed = worker.run_once()
            if once:
                return
            if not processed:
                time.sleep(poll_interval_seconds)
    finally:
        worker.close()


def create_worker() -> IngestionWorker:
    connection = psycopg.connect(
        get_database_url(),
        autocommit=True,
        row_factory=dict_row,
    )
    repository = IngestionRepository(connection)
    worker = IngestionWorker(
        repository=repository,
        storage=LocalFileStorage(default_storage_root()),
        connection=connection,
    )
    return worker


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description="Run the PDF ingestion worker.")
    parser.add_argument(
        "--once",
        action="store_true",
        help="Process at most one available job, then exit.",
    )
    parser.add_argument(
        "--poll-interval-seconds",
        type=float,
        default=2,
        help="Seconds to wait when no jobs are available.",
    )
    args = parser.parse_args()
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    run_worker(
        once=args.once,
        poll_interval_seconds=args.poll_interval_seconds,
    )


if __name__ == "__main__":
    main()
