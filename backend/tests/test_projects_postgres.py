import os
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.documents.router import get_document_storage
from app.documents.storage import LocalFileStorage
from app.main import app

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(
    TEST_DATABASE_URL is None,
    reason="Set TEST_DATABASE_URL to run PostgreSQL integration tests.",
)


def test_project_crud_and_cursor_pagination(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    assert TEST_DATABASE_URL is not None
    monkeypatch.setenv("DATABASE_URL", TEST_DATABASE_URL)
    created_ids: list[str] = []

    with TestClient(app) as client:
        try:
            for index in range(3):
                response = client.post(
                    "/api/v1/projects",
                    json={
                        "name": f"  Prototype project {uuid4()}  ",
                        "project_number": f"P-{index}",
                    },
                )
                assert response.status_code == 201
                assert response.json()["name"].startswith("Prototype project ")
                assert response.json()["created_by"] == "local-user"
                created_ids.append(response.json()["id"])

            first_page = client.get("/api/v1/projects?limit=2")
            assert first_page.status_code == 200
            first_page_data = first_page.json()
            assert len(first_page_data["items"]) == 2
            assert first_page_data["next_cursor"] is not None

            second_page = client.get(
                "/api/v1/projects",
                params={"limit": 2, "cursor": first_page_data["next_cursor"]},
            )
            assert second_page.status_code == 200
            assert len(second_page.json()["items"]) == 1
            assert second_page.json()["next_cursor"] is None

            project_id = created_ids[0]
            detail = client.get(f"/api/v1/projects/{project_id}")
            assert detail.status_code == 200

            updated = client.patch(
                f"/api/v1/projects/{project_id}",
                json={"description": "Updated project"},
            )
            assert updated.status_code == 200
            assert updated.json()["description"] == "Updated project"

            assert client.delete(f"/api/v1/projects/{project_id}").status_code == 204
            assert client.get(f"/api/v1/projects/{project_id}").status_code == 404

            assert client.post(
                "/api/v1/projects",
                json={"name": "   "},
            ).status_code == 422
            assert client.get(
                "/api/v1/projects",
                params={"cursor": "invalid"},
            ).status_code == 422
        finally:
            for project_id in created_ids:
                client.delete(f"/api/v1/projects/{project_id}")


def test_document_upload_persists_metadata_and_pdf(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    assert TEST_DATABASE_URL is not None
    monkeypatch.setenv("DATABASE_URL", TEST_DATABASE_URL)
    storage = LocalFileStorage(tmp_path / "uploads")
    app.dependency_overrides[get_document_storage] = lambda: storage
    project_id: str | None = None
    storage_key: str | None = None

    with TestClient(app) as client:
        try:
            project = client.post(
                "/api/v1/projects",
                json={"name": f"Document integration {uuid4()}"},
            )
            assert project.status_code == 201
            project_id = project.json()["id"]

            upload = client.post(
                f"/api/v1/projects/{project_id}/documents",
                data={"role": "engineer", "document_type": "schedule"},
                files={
                    "file": (
                        "schedule.pdf",
                        b"%PDF-1.7\nsynthetic integration document\n%%EOF\n",
                        "application/pdf",
                    )
                },
            )
            assert upload.status_code == 201
            assert upload.json()["status"] == "uploaded"
            assert upload.json()["file_name"] == "schedule.pdf"
            detail = client.get(f"/api/v1/documents/{upload.json()['id']}")
            assert detail.status_code == 200
            assert detail.json()["id"] == upload.json()["id"]

            listing = client.get(f"/api/v1/projects/{project_id}/documents")
            assert listing.status_code == 200
            assert len(listing.json()["items"]) == 1
            document_id = listing.json()["items"][0]["id"]
            storage_key = f"{project_id}/{document_id}.pdf"
            assert (storage.root / storage_key).is_file()
        finally:
            if storage_key is not None:
                storage.delete(storage_key)
            if project_id is not None:
                client.delete(f"/api/v1/projects/{project_id}")
            app.dependency_overrides.clear()
