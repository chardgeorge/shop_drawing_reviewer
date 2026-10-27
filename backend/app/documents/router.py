import logging
import re
from pathlib import PureWindowsPath
from typing import Annotated
from uuid import UUID, uuid4

import psycopg
from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    UploadFile,
    status,
)

from app.database import get_document_repository
from app.documents.models import (
    DocumentListResponse,
    DocumentResponse,
    DocumentRole,
    DocumentType,
)
from app.documents.repository import DocumentRepository
from app.documents.storage import (
    EmptyUploadError,
    FileStorage,
    InvalidPdfError,
    LocalFileStorage,
    StoredFile,
    default_storage_root,
)

logger = logging.getLogger(__name__)
router = APIRouter(tags=["documents"])
PDF_MEDIA_TYPE = "application/pdf"
SAFE_FILENAME = re.compile(r"^[^\\/:*?\"<>|\x00-\x1f]+$")


def get_document_storage() -> FileStorage:
    return LocalFileStorage(default_storage_root())


def normalize_file_name(file_name: str | None) -> str:
    if file_name is None:
        raise HTTPException(status_code=422, detail="A PDF file name is required.")

    normalized_name = PureWindowsPath(file_name.replace("/", "\\")).name
    if (
        not normalized_name
        or not SAFE_FILENAME.fullmatch(normalized_name)
        or not normalized_name.lower().endswith(".pdf")
    ):
        raise HTTPException(
            status_code=422,
            detail="The uploaded file must have a valid .pdf file name.",
        )
    return normalized_name


@router.post(
    "/api/v1/projects/{project_id}/documents",
    response_model=DocumentResponse,
    status_code=status.HTTP_201_CREATED,
)
def upload_document(
    project_id: UUID,
    repository: Annotated[
        DocumentRepository,
        Depends(get_document_repository),
    ],
    storage: Annotated[FileStorage, Depends(get_document_storage)],
    role: Annotated[DocumentRole, Form()],
    file: Annotated[UploadFile, File()],
    document_type: Annotated[DocumentType, Form()] = DocumentType.UNKNOWN,
    revision: Annotated[str | None, Form(max_length=100)] = None,
) -> DocumentResponse:
    file_name = normalize_file_name(file.filename)
    if file.content_type != PDF_MEDIA_TYPE:
        raise HTTPException(
            status_code=415,
            detail="The uploaded file must use the application/pdf media type.",
        )
    if not repository.project_exists(project_id):
        raise HTTPException(status_code=404, detail="Project not found.")

    document_id = uuid4()
    try:
        stored_file: StoredFile = storage.store(
            file.file,
            project_id=project_id,
            document_id=document_id,
        )
    except EmptyUploadError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except InvalidPdfError as error:
        raise HTTPException(status_code=415, detail=str(error)) from error
    finally:
        file.file.close()

    try:
        document = repository.create(
            document_id=document_id,
            project_id=project_id,
            role=role.value,
            document_type=document_type.value,
            file_name=file_name,
            revision=revision,
            storage_key=stored_file.storage_key,
            file_size_bytes=stored_file.file_size_bytes,
            sha256=stored_file.sha256,
        )
    except psycopg.Error:
        try:
            storage.delete(stored_file.storage_key)
        except OSError:
            logger.exception(
                "Failed to clean up PDF after document registration failed."
            )
        raise

    return DocumentResponse.model_validate(document)


@router.get(
    "/api/v1/projects/{project_id}/documents",
    response_model=DocumentListResponse,
)
def list_project_documents(
    project_id: UUID,
    repository: Annotated[
        DocumentRepository,
        Depends(get_document_repository),
    ],
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> DocumentListResponse:
    if not repository.project_exists(project_id):
        raise HTTPException(status_code=404, detail="Project not found.")
    documents = repository.list_for_project(project_id, limit)
    return DocumentListResponse(
        items=[DocumentResponse.model_validate(item) for item in documents]
    )


@router.get(
    "/api/v1/documents/{document_id}",
    response_model=DocumentResponse,
)
def get_document(
    document_id: UUID,
    repository: Annotated[
        DocumentRepository,
        Depends(get_document_repository),
    ],
) -> DocumentResponse:
    document = repository.get(document_id)
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found.")
    return DocumentResponse.model_validate(document)
