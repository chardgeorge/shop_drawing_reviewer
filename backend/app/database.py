import os
from collections.abc import Iterator
from typing import Annotated, Any

import psycopg
from fastapi import Depends, HTTPException
from psycopg import Connection
from psycopg.rows import dict_row

from app.documents.repository import DocumentRepository
from app.projects.repository import ProjectRepository

DEFAULT_DATABASE_URL = (
    "postgresql://shop_reviewer:local_prototype_only"
    "@localhost:5432/shop_drawing_reviewer"
)


def get_database_url() -> str:
    return os.environ.get("DATABASE_URL", DEFAULT_DATABASE_URL)


def get_connection() -> Iterator[Connection[Any]]:
    try:
        connection = psycopg.connect(
            get_database_url(),
            autocommit=True,
            row_factory=dict_row,
        )
    except psycopg.OperationalError as error:
        raise HTTPException(
            status_code=503,
            detail=(
                "The local PostgreSQL database is unavailable. Start it with "
                "`docker compose up -d db` and apply migrations with "
                "`python -m app.migrate`."
            ),
        ) from error

    try:
        yield connection
    finally:
        connection.close()


def get_project_repository(
    connection: Annotated[Connection[Any], Depends(get_connection)],
) -> ProjectRepository:
    return ProjectRepository(connection)


def get_document_repository(
    connection: Annotated[Connection[Any], Depends(get_connection)],
) -> DocumentRepository:
    return DocumentRepository(connection)
