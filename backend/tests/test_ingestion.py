from io import BytesIO
from pathlib import Path
from typing import Any
from uuid import uuid4

import pymupdf
import pytest

from app.worker.extraction import IngestionError, extract_pdf
from app.worker.runner import IngestionWorker


def create_pdf(*, with_text: bool) -> bytes:
    document = pymupdf.open()
    page = document.new_page(width=612, height=792)
    if with_text:
        page.insert_text((72, 100), "Synthetic structural schedule")
    content = document.tobytes()
    document.close()
    return content


def write_pdf(path: Path, content: bytes) -> Path:
    path.write_bytes(content)
    return path


def test_extracts_page_text_and_dimensions(tmp_path: Path) -> None:
    content = create_pdf(with_text=True)
    result = extract_pdf(write_pdf(tmp_path / "selectable.pdf", content))

    assert len(result.pages) == 1
    assert result.pages[0].page_number == 1
    assert result.pages[0].page_width == 612
    assert result.pages[0].page_height == 792
    assert "Synthetic structural schedule" in result.pages[0].text_content
    assert result.diagnostics["content_status"] == "selectable_text"
    assert result.needs_review is False


def test_scanned_pdf_is_completed_with_actionable_warning(tmp_path: Path) -> None:
    content = create_pdf(with_text=False)
    result = extract_pdf(write_pdf(tmp_path / "scanned.pdf", content))

    assert result.pages[0].text_content == ""
    assert result.diagnostics["content_status"] == "no_selectable_text"
    assert result.diagnostics["warnings"][0]["code"] == "NO_SELECTABLE_TEXT"
    assert result.needs_review is True


@pytest.mark.parametrize(
    ("content", "error_code"),
    [
        (b"not a pdf", "INVALID_PDF"),
        (create_pdf(with_text=True)[:12], "INVALID_PDF"),
    ],
)
def test_rejects_corrupt_pdf(
    tmp_path: Path,
    content: bytes,
    error_code: str,
) -> None:
    with pytest.raises(IngestionError) as error:
        extract_pdf(write_pdf(tmp_path / "corrupt.pdf", content))

    assert error.value.code == error_code
    assert error.value.retryable is False


def test_rejects_password_protected_pdf(tmp_path: Path) -> None:
    document = pymupdf.open()
    document.new_page()
    content = document.tobytes(
        encryption=pymupdf.PDF_ENCRYPT_AES_256,
        owner_pw="owner",
        user_pw="user",
    )
    document.close()
    with pytest.raises(IngestionError) as error:
        extract_pdf(write_pdf(tmp_path / "encrypted.pdf", content))

    assert error.value.code == "ENCRYPTED_PDF"


class MemoryIngestionRepository:
    def __init__(self) -> None:
        self.job: dict[str, Any] | None = {
            "id": uuid4(),
            "document_id": uuid4(),
            "extraction_run_id": uuid4(),
            "attempts": 1,
            "max_attempts": 3,
            "storage_key": "test.pdf",
        }
        self.completed_result = None
        self.failures: list[dict[str, Any]] = []
        self.retry_result = True

    def claim_next(self) -> dict[str, Any] | None:
        job, self.job = self.job, None
        return job

    def complete(self, **fields: Any) -> None:
        self.completed_result = fields["result"]

    def fail(self, **fields: Any) -> bool:
        self.failures.append(fields)
        return self.retry_result


class MemoryFileStorage:
    def __init__(self, content: bytes) -> None:
        self.content = content

    def open(self, storage_key: str) -> BytesIO:
        return BytesIO(self.content)


class UnavailableFileStorage:
    def open(self, storage_key: str) -> BytesIO:
        raise OSError("Temporary storage read failure.")


def test_worker_claims_and_completes_ingestion_job() -> None:
    repository = MemoryIngestionRepository()
    worker = IngestionWorker(
        repository=repository,
        storage=MemoryFileStorage(create_pdf(with_text=True)),
    )

    assert worker.run_once() is True
    assert repository.completed_result is not None
    assert (
        repository.completed_result.diagnostics["content_status"]
        == "selectable_text"
    )
    assert worker.run_once() is False
    assert repository.failures == []


def test_worker_marks_scanned_pdf_for_review() -> None:
    repository = MemoryIngestionRepository()
    worker = IngestionWorker(
        repository=repository,
        storage=MemoryFileStorage(create_pdf(with_text=False)),
    )

    assert worker.run_once() is True
    assert repository.completed_result is not None
    assert repository.completed_result.needs_review is True
    assert (
        repository.completed_result.diagnostics["content_status"]
        == "no_selectable_text"
    )


def test_worker_records_nonretryable_pdf_failure() -> None:
    repository = MemoryIngestionRepository()
    worker = IngestionWorker(
        repository=repository,
        storage=MemoryFileStorage(b"invalid"),
    )

    assert worker.run_once() is True
    assert repository.failures[0]["error_code"] == "INVALID_PDF"
    assert repository.failures[0]["retryable"] is False


def test_worker_schedules_retry_for_transient_storage_error() -> None:
    repository = MemoryIngestionRepository()
    worker = IngestionWorker(
        repository=repository,
        storage=UnavailableFileStorage(),
    )

    assert worker.run_once() is True
    assert repository.failures[0]["error_code"] == "STORAGE_READ_ERROR"
    assert repository.failures[0]["retryable"] is True
