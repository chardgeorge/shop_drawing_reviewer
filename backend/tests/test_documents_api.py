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
            (
                document
                for document in self.documents
                if document["id"] == document_id
            ),
            None,
        )


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
    assert client.get(
        f"/api/v1/documents/{first_document['id']}"
    ).json()["id"] == first_document["id"]
    assert first_document["file_name"] == "schedule.pdf"
    assert first_document["revision"] == "A"
    assert first_document["status"] == "uploaded"
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
