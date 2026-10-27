import logging
import re
from pathlib import PureWindowsPath
from typing import Annotated
from urllib.parse import quote
from uuid import UUID, uuid4

import psycopg
from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    Response,
    UploadFile,
    status,
)
from fastapi.responses import StreamingResponse

from app.database import get_document_repository
from app.documents.models import (
    DocumentListResponse,
    DocumentResponse,
    DocumentRole,
    DocumentType,
    ScheduleRowListResponse,
    ScheduleRowResponse,
    ScheduleRowReviewUpdate,
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
        document = repository.create_with_ingestion(
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


@router.get(
    "/api/v1/documents/{document_id}/extraction-runs/{run_id}/beam-rows",
    response_model=ScheduleRowListResponse,
)
def list_beam_rows(
    document_id: UUID,
    run_id: UUID,
    repository: Annotated[
        DocumentRepository,
        Depends(get_document_repository),
    ],
) -> ScheduleRowListResponse:
    rows = repository.list_schedule_rows(document_id, run_id)
    if rows is None:
        raise HTTPException(
            status_code=404,
            detail="Extraction run not found for this document.",
        )
    return ScheduleRowListResponse(
        items=[ScheduleRowResponse.model_validate(row) for row in rows]
    )


@router.patch(
    "/api/v1/beam-rows/{row_id}",
    response_model=ScheduleRowResponse,
)
def review_beam_row(
    row_id: UUID,
    update: ScheduleRowReviewUpdate,
    repository: Annotated[
        DocumentRepository,
        Depends(get_document_repository),
    ],
) -> ScheduleRowResponse:
    fields = update.model_dump(exclude_unset=True)
    if not fields:
        raise HTTPException(
            status_code=422,
            detail="At least one correction or review state must be provided.",
        )
    if "review_state" in fields and fields["review_state"] is None:
        raise HTTPException(
            status_code=422,
            detail="review_state cannot be null.",
        )

    for field in ("member_mark", "section"):
        value = fields.get(field)
        if field in fields and value is None:
            raise HTTPException(
                status_code=422,
                detail=f"{field} cannot be null.",
            )
        if value is not None:
            normalized = value.strip()
            if not normalized:
                raise HTTPException(
                    status_code=422,
                    detail=f"{field} cannot be blank.",
                )
            fields[field] = normalized

    row = repository.update_schedule_row(
        row_id,
        review_state=(
            fields["review_state"].value
            if fields.get("review_state") is not None
            else None
        ),
        member_mark=fields.get("member_mark"),
        section=fields.get("section"),
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Schedule row not found.")
    return ScheduleRowResponse.model_validate(row)


@router.get("/api/v1/documents/{document_id}/file")
def get_document_file(
    document_id: UUID,
    repository: Annotated[
        DocumentRepository,
        Depends(get_document_repository),
    ],
    storage: Annotated[FileStorage, Depends(get_document_storage)],
) -> Response:
    document = repository.get(document_id)
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found.")
    storage_key = repository.get_storage_key(document_id)
    if storage_key is None:
        raise HTTPException(status_code=404, detail="Document file not found.")

    try:
        pdf_stream = storage.open(storage_key)
    except FileNotFoundError as error:
        raise HTTPException(
            status_code=404,
            detail="The document file is missing from local storage.",
        ) from error

    def stream_file():
        try:
            while chunk := pdf_stream.read(1024 * 1024):
                yield chunk
        finally:
            pdf_stream.close()

    return StreamingResponse(
        stream_file(),
        media_type="application/pdf",
        headers={
            "Content-Disposition": (
                f"inline; filename*=UTF-8''{quote(document['file_name'], safe='')}"
            ),
            "X-Content-Type-Options": "nosniff",
        },
    )
