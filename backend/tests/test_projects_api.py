from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient

from app.database import get_project_repository
from app.main import app


class MemoryProjectRepository:
    def __init__(self) -> None:
        self.projects: dict[UUID, dict[str, object]] = {}

    def create(
        self,
        *,
        name: str,
        project_number: str | None,
        description: str | None,
    ) -> dict[str, object]:
        now = datetime.now(UTC)
        project = {
            "id": uuid4(),
            "name": name,
            "project_number": project_number,
            "description": description,
            "created_by": "local-user",
            "created_at": now,
            "updated_at": now,
        }
        self.projects[project["id"]] = project
        return project

    def list(
        self,
        *,
        limit: int,
        before: tuple[datetime, UUID] | None,
    ) -> list[dict[str, object]]:
        projects = sorted(
            self.projects.values(),
            key=lambda project: (project["created_at"], project["id"]),
            reverse=True,
        )
        if before is not None:
            projects = [
                project
                for project in projects
                if (project["created_at"], project["id"]) < before
            ]
        return projects[:limit]

    def get(self, project_id: UUID) -> dict[str, object] | None:
        return self.projects.get(project_id)

    def update(
        self,
        project_id: UUID,
        fields: dict[str, object],
    ) -> dict[str, object] | None:
        project = self.projects.get(project_id)
        if project is None:
            return None
        project.update(fields)
        project["updated_at"] = datetime.now(UTC)
        return project

    def delete(self, project_id: UUID) -> bool:
        return self.projects.pop(project_id, None) is not None


@pytest.fixture
def client() -> TestClient:
    repository = MemoryProjectRepository()
    app.dependency_overrides[get_project_repository] = lambda: repository
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def test_project_crud_and_cursor_pagination(client: TestClient) -> None:
    project_ids = []
    for index in range(3):
        response = client.post(
            "/api/v1/projects",
            json={"name": f"  Project {index}  ", "project_number": f"P-{index}"},
        )
        assert response.status_code == 201
        assert response.json()["name"] == f"Project {index}"
        assert response.json()["created_by"] == "local-user"
        project_ids.append(response.json()["id"])

    first_page = client.get("/api/v1/projects?limit=2")
    assert first_page.status_code == 200
    assert len(first_page.json()["items"]) == 2
    assert first_page.json()["next_cursor"] is not None

    second_page = client.get(
        "/api/v1/projects",
        params={"limit": 2, "cursor": first_page.json()["next_cursor"]},
    )
    assert second_page.status_code == 200
    assert len(second_page.json()["items"]) == 1
    assert second_page.json()["next_cursor"] is None

    project_id = project_ids[0]
    assert client.get(f"/api/v1/projects/{project_id}").status_code == 200
    updated = client.patch(
        f"/api/v1/projects/{project_id}",
        json={"description": "Updated description"},
    )
    assert updated.status_code == 200
    assert updated.json()["description"] == "Updated description"
    assert client.delete(f"/api/v1/projects/{project_id}").status_code == 204
    assert client.get(f"/api/v1/projects/{project_id}").status_code == 404


def test_project_validation_and_missing_resources(client: TestClient) -> None:
    assert client.post("/api/v1/projects", json={"name": "  "}).status_code == 422
    assert client.get("/api/v1/projects?cursor=invalid").status_code == 422
    assert client.patch(f"/api/v1/projects/{uuid4()}", json={}).status_code == 422
    assert client.patch(
        f"/api/v1/projects/{uuid4()}",
        json={"name": None},
    ).status_code == 422
    assert client.get(f"/api/v1/projects/{uuid4()}").status_code == 404
