from datetime import datetime
from enum import StrEnum
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class ExtractionSummary(BaseModel):
    id: UUID
    status: str
    page_count: int | None
    diagnostics: dict[str, object]
    error_code: str | None
    error_message: str | None


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
    extraction: ExtractionSummary | None = None


class DocumentListResponse(BaseModel):
    items: list[DocumentResponse]


class ScheduleRowReviewState(StrEnum):
    NEEDS_REVIEW = "needs_review"
    ACCEPTED = "accepted"
    REJECTED = "rejected"


class ScheduleRowResponse(BaseModel):
    id: UUID
    extraction_run_id: UUID
    row_number: int | None
    member_mark_raw: str | None
    member_mark_normalized: str | None
    section_raw: str | None
    section_normalized: str | None
    member_mark: str | None
    section: str | None
    page_number: int
    page_width: float | None
    page_height: float | None
    source_bbox: dict[str, float] | None
    confidence: float | None
    review_state: ScheduleRowReviewState
    correction: dict[str, str]
    reviewed_by: str | None
    reviewed_at: datetime | None


class ScheduleRowListResponse(BaseModel):
    items: list[ScheduleRowResponse]


class ScheduleRowReviewUpdate(BaseModel):
    review_state: ScheduleRowReviewState | None = None
    member_mark: str | None = None
    section: str | None = None
