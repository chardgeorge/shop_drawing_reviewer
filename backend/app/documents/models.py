from datetime import datetime
from enum import StrEnum
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class DocumentRole(StrEnum):
    ENGINEER = "engineer"
    SHOP = "shop"


class DocumentType(StrEnum):
    GENERAL_ARRANGEMENT = "general_arrangement"
    SHOP_DRAWING = "shop_drawing"
    SCHEDULE = "schedule"
    OTHER = "other"
    UNKNOWN = "unknown"


class DocumentStatus(StrEnum):
    UPLOADED = "uploaded"
    QUEUED = "queued"
    PROCESSING = "processing"
    READY = "ready"
    NEEDS_REVIEW = "needs_review"
    FAILED = "failed"


class DocumentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID
    role: DocumentRole
    document_type: DocumentType
    file_name: str
    revision: str | None
    media_type: str
    file_size_bytes: int
    sha256: str
    status: DocumentStatus
    uploaded_by: str
    uploaded_at: datetime


class DocumentListResponse(BaseModel):
    items: list[DocumentResponse]
