import hashlib
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID, uuid4

import psycopg
import pytest
from fastapi.testclient import TestClient

from app.database import get_document_repository
from app.documents.router import get_document_storage
from app.documents.storage import LocalFileStorage
from app.main import app

PDF_BYTES = b"%PDF-1.7\nsynthetic test document\n%%EOF\n"


class MemoryDocumentRepository:
    def __init__(self) -> None:
        self.projects = {uuid4()}
        self.documents: list[dict[str, object]] = []
        self.fail_create = False

    def project_exists(self, project_id: UUID) -> bool:
        return project_id in self.projects

    def create(self, **fields: object) -> dict[str, object]:
        if self.fail_create:
            raise psycopg.OperationalError("Simulated database insert failure.")
        document = {
            **fields,
            "id": fields["document_id"],
            "media_type": "application/pdf",
            "status": "uploaded",
            "uploaded_by": "local-user",
            "uploaded_at": datetime.now(UTC),
        }
        self.documents.append(document)
        return document

    def create_with_ingestion(self, **fields: object) -> dict[str, object]:
        document = self.create(**fields)
        document["status"] = "queued"
        document["extraction"] = {
            "id": uuid4(),
            "status": "queued",
            "page_count": None,
            "diagnostics": {},
            "error_code": None,
            "error_message": None,
        }
        return document

    def list_for_project(
        self,
        project_id: UUID,
        limit: int,
    ) -> list[dict[str, object]]:
        return [
            document
            for document in self.documents
            if document["project_id"] == project_id
        ][:limit]

    def get(self, document_id: UUID) -> dict[str, object] | None:
        return next(
            (document for document in self.documents if document["id"] == document_id),
            None,
        )

    def get_storage_key(self, document_id: UUID) -> str | None:
        document = self.get(document_id)
        return str(document["storage_key"]) if document is not None else None

    def list_schedule_rows(
        self,
        document_id: UUID,
        extraction_run_id: UUID,
    ) -> list[dict[str, object]] | None:
        document = self.get(document_id)
        if document is None or document["extraction"]["id"] != extraction_run_id:
            return None
        return [
            row
            for row in getattr(self, "schedule_rows", [])
            if row["extraction_run_id"] == extraction_run_id
        ]

    def update_schedule_row(
        self,
        row_id: UUID,
        *,
        review_state: str | None,
        member_mark: str | None,
        section: str | None,
    ) -> dict[str, object] | None:
        row = next(
            (
                item
                for item in getattr(self, "schedule_rows", [])
                if item["id"] == row_id
            ),
            None,
        )
        if row is None:
            return None
        if review_state is not None:
            row["review_state"] = review_state
        if member_mark is not None:
            row["member_mark"] = member_mark
        if section is not None:
            row["section"] = section
        return row


@pytest.fixture
def document_setup(
    tmp_path: Path,
) -> Iterator[tuple[TestClient, MemoryDocumentRepository, Path]]:
    repository = MemoryDocumentRepository()
    storage_root = tmp_path / "pdf-storage"
    app.dependency_overrides[get_document_repository] = lambda: repository
    app.dependency_overrides[get_document_storage] = lambda: LocalFileStorage(
        storage_root
    )
    with TestClient(app, raise_server_exceptions=False) as client:
        yield client, repository, storage_root
    app.dependency_overrides.clear()


def test_upload_stores_immutable_pdf_and_lists_metadata(
    document_setup: tuple[TestClient, MemoryDocumentRepository, Path],
) -> None:
    client, repository, storage_root = document_setup
    project_id = next(iter(repository.projects))

    first = client.post(
        f"/api/v1/projects/{project_id}/documents",
        data={"role": "engineer", "document_type": "schedule", "revision": "A"},
        files={"file": ("schedule.pdf", PDF_BYTES, "application/pdf")},
    )
    second = client.post(
        f"/api/v1/projects/{project_id}/documents",
        data={"role": "engineer"},
        files={"file": ("schedule.pdf", PDF_BYTES, "application/pdf")},
    )

    assert first.status_code == 201
    assert second.status_code == 201
    first_document = first.json()
    second_document = second.json()
    assert first_document["id"] != second_document["id"]
    assert (
        client.get(f"/api/v1/documents/{first_document['id']}").json()["id"]
        == first_document["id"]
    )
    assert first_document["file_name"] == "schedule.pdf"
    assert first_document["revision"] == "A"
    assert first_document["status"] == "queued"
    assert first_document["extraction"]["status"] == "queued"
    assert first_document["file_size_bytes"] == len(PDF_BYTES)
    assert first_document["sha256"] == hashlib.sha256(PDF_BYTES).hexdigest()

    storage_key = repository.documents[0]["storage_key"]
    stored_path = storage_root / str(storage_key)
    assert stored_path.read_bytes() == PDF_BYTES

    listing = client.get(f"/api/v1/projects/{project_id}/documents")
    assert listing.status_code == 200
    assert len(listing.json()["items"]) == 2
    assert "storage_key" not in listing.json()["items"][0]


def test_rejects_non_pdf_empty_and_missing_project(
    document_setup: tuple[TestClient, MemoryDocumentRepository, Path],
) -> None:
    client, repository, storage_root = document_setup
    project_id = next(iter(repository.projects))

    invalid_header = client.post(
        f"/api/v1/projects/{project_id}/documents",
        data={"role": "shop"},
        files={"file": ("drawing.pdf", b"not a PDF", "application/pdf")},
    )
    assert invalid_header.status_code == 415

    invalid_type = client.post(
        f"/api/v1/projects/{project_id}/documents",
        data={"role": "shop"},
        files={"file": ("drawing.pdf", PDF_BYTES, "text/plain")},
    )
    assert invalid_type.status_code == 415

    empty = client.post(
        f"/api/v1/projects/{project_id}/documents",
        data={"role": "shop"},
        files={"file": ("empty.pdf", b"", "application/pdf")},
    )
    assert empty.status_code == 422

    missing_project = client.post(
        f"/api/v1/projects/{uuid4()}/documents",
        data={"role": "shop"},
        files={"file": ("drawing.pdf", PDF_BYTES, "application/pdf")},
    )
    assert missing_project.status_code == 404
    assert repository.documents == []
    assert list(storage_root.rglob("*.pdf")) == []
    assert list(storage_root.rglob("*.tmp")) == []


def test_failed_registration_removes_saved_file(
    document_setup: tuple[TestClient, MemoryDocumentRepository, Path],
) -> None:
    client, repository, storage_root = document_setup
    repository.fail_create = True
    project_id = next(iter(repository.projects))

    response = client.post(
        f"/api/v1/projects/{project_id}/documents",
        data={"role": "shop"},
        files={"file": ("drawing.pdf", PDF_BYTES, "application/pdf")},
    )

    assert response.status_code == 500
    assert list(storage_root.rglob("*.pdf")) == []


def test_serves_uploaded_pdf_inline(
    document_setup: tuple[TestClient, MemoryDocumentRepository, Path],
) -> None:
    client, repository, _ = document_setup
    project_id = next(iter(repository.projects))
    uploaded = client.post(
        f"/api/v1/projects/{project_id}/documents",
        data={"role": "engineer"},
        files={"file": ("drawing.pdf", PDF_BYTES, "application/pdf")},
    )

    response = client.get(f"/api/v1/documents/{uploaded.json()['id']}/file")

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert response.headers["content-disposition"].startswith("inline;")
    assert response.content == PDF_BYTES


def test_lists_and_reviews_extracted_beam_rows(
    document_setup: tuple[TestClient, MemoryDocumentRepository, Path],
) -> None:
    client, repository, _ = document_setup
    project_id = next(iter(repository.projects))
    uploaded = client.post(
        f"/api/v1/projects/{project_id}/documents",
        data={"role": "engineer"},
        files={"file": ("drawing.pdf", PDF_BYTES, "application/pdf")},
    ).json()
    document_id = UUID(uploaded["id"])
    extraction_run_id = UUID(uploaded["extraction"]["id"])
    row_id = uuid4()
    row = {
        "id": row_id,
        "extraction_run_id": extraction_run_id,
        "row_number": 1,
        "member_mark_raw": "B1",
        "member_mark_normalized": "B1",
        "section_raw": "W12x26",
        "section_normalized": "W12X26",
        "member_mark": "B1",
        "section": "W12x26",
        "page_number": 1,
        "page_width": 612,
        "page_height": 792,
        "source_bbox": {"x0": 70, "y0": 100, "x1": 280, "y1": 120},
        "confidence": 0.9,
        "review_state": "needs_review",
        "correction": {},
        "reviewed_by": None,
        "reviewed_at": None,
    }
    repository.schedule_rows = [row]

    listed = client.get(
        f"/api/v1/documents/{document_id}/extraction-runs/{extraction_run_id}/beam-rows"
    )
    updated = client.patch(
        f"/api/v1/beam-rows/{row_id}",
        json={"member_mark": "B-1", "section": "W14x30", "review_state": "accepted"},
    )

    assert listed.status_code == 200
    assert listed.json()["items"][0]["source_bbox"]["x0"] == 70
    assert updated.status_code == 200
    assert updated.json()["member_mark"] == "B-1"
    assert updated.json()["section"] == "W14x30"
    assert updated.json()["member_mark_raw"] == "B1"
    assert updated.json()["section_raw"] == "W12x26"
    assert updated.json()["review_state"] == "accepted"
