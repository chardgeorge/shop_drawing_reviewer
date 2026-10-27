import base64
import binascii
from datetime import datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status

from app.database import get_project_repository
from app.projects.models import (
    ProjectCreate,
    ProjectListResponse,
    ProjectResponse,
    ProjectUpdate,
)
from app.projects.repository import ProjectRepository

router = APIRouter(prefix="/api/v1/projects", tags=["projects"])


def encode_cursor(created_at: datetime, project_id: UUID) -> str:
    value = f"{created_at.isoformat()}|{project_id}".encode()
    return base64.urlsafe_b64encode(value).decode().rstrip("=")


def decode_cursor(cursor: str | None) -> tuple[datetime, UUID] | None:
    if cursor is None:
        return None

    try:
        padded_cursor = cursor + "=" * (-len(cursor) % 4)
        decoded = base64.b64decode(
            padded_cursor,
            altchars=b"-_",
            validate=True,
        ).decode()
        timestamp, project_id = decoded.rsplit("|", maxsplit=1)
        created_at = datetime.fromisoformat(timestamp)
        if created_at.tzinfo is None:
            raise ValueError("Cursor timestamp must include a timezone.")
        return created_at, UUID(project_id)
    except (binascii.Error, UnicodeDecodeError, ValueError) as error:
        raise HTTPException(
            status_code=422,
            detail="Invalid project cursor.",
        ) from error


@router.post(
    "",
    response_model=ProjectResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_project(
    project: ProjectCreate,
    repository: Annotated[ProjectRepository, Depends(get_project_repository)],
) -> ProjectResponse:
    return ProjectResponse.model_validate(
        repository.create(
            name=project.name,
            project_number=project.project_number,
            description=project.description,
        )
    )


@router.get("", response_model=ProjectListResponse)
def list_projects(
    repository: Annotated[ProjectRepository, Depends(get_project_repository)],
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    cursor: Annotated[str | None, Query(max_length=512)] = None,
) -> ProjectListResponse:
    rows = repository.list(limit=limit + 1, before=decode_cursor(cursor))
    has_more = len(rows) > limit
    items = [ProjectResponse.model_validate(row) for row in rows[:limit]]
    next_cursor = None

    if has_more and items:
        last_project = items[-1]
        next_cursor = encode_cursor(last_project.created_at, last_project.id)

    return ProjectListResponse(items=items, next_cursor=next_cursor)


@router.get("/{project_id}", response_model=ProjectResponse)
def get_project(
    project_id: UUID,
    repository: Annotated[ProjectRepository, Depends(get_project_repository)],
) -> ProjectResponse:
    project = repository.get(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found.")
    return ProjectResponse.model_validate(project)


@router.patch("/{project_id}", response_model=ProjectResponse)
def update_project(
    project_id: UUID,
    update: ProjectUpdate,
    repository: Annotated[ProjectRepository, Depends(get_project_repository)],
) -> ProjectResponse:
    fields = update.model_dump(exclude_unset=True)
    if not fields:
        raise HTTPException(
            status_code=422,
            detail="At least one project field must be provided.",
        )

    project = repository.update(project_id, fields)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found.")
    return ProjectResponse.model_validate(project)


@router.delete(
    "/{project_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
def delete_project(
    project_id: UUID,
    repository: Annotated[ProjectRepository, Depends(get_project_repository)],
) -> Response:
    if not repository.delete(project_id):
        raise HTTPException(status_code=404, detail="Project not found.")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
