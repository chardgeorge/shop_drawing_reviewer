from collections import Counter
from dataclasses import dataclass, replace
from pathlib import Path

import pymupdf

from app.worker.schedule_parser import ParsedScheduleRow, parse_beam_schedule_page

PDF_EXTRACTOR_VERSION = f"pymupdf-{pymupdf.VersionBind}"


class IngestionError(Exception):
    def __init__(
        self,
        code: str,
        message: str,
        *,
        retryable: bool = False,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.retryable = retryable


@dataclass(frozen=True)
class ExtractedPage:
    page_number: int
    page_width: float
    page_height: float
    text_content: str


@dataclass(frozen=True)
class ExtractedDocument:
    pages: list[ExtractedPage]
    schedule_rows: list[ParsedScheduleRow]
    diagnostics: dict[str, object]
    needs_review: bool


def extract_pdf(path: Path) -> ExtractedDocument:
    try:
        document = pymupdf.open(path)
    except (pymupdf.FileDataError, pymupdf.EmptyFileError) as error:
        raise IngestionError(
            "INVALID_PDF",
            "The file could not be opened as a valid PDF.",
        ) from error
    except OSError as error:
        raise IngestionError(
            "PDF_READ_ERROR",
            "The stored PDF could not be read.",
            retryable=True,
        ) from error
    except RuntimeError as error:
        raise IngestionError(
            "PDF_PARSE_ERROR",
            "The PDF parser could not read this file.",
        ) from error

    with document:
        if document.needs_pass:
            raise IngestionError(
                "ENCRYPTED_PDF",
                "This PDF is password-protected and cannot be processed.",
            )
        if document.page_count == 0:
            raise IngestionError(
                "EMPTY_PDF",
                "The PDF contains no pages.",
            )

        try:
            pages: list[ExtractedPage] = []
            schedule_rows: list[ParsedScheduleRow] = []
            schedule_warnings: list[dict[str, str]] = []
            total_text_char_count = 0
            for page_number, page in enumerate(document, start=1):
                text = page.get_text("text")
                total_text_char_count += len(text.strip())
                page_parse = parse_beam_schedule_page(
                    words=page.get_text("words"),
                    page_number=page_number,
                    page_width=page.rect.width,
                    page_height=page.rect.height,
                    extractor=PDF_EXTRACTOR_VERSION,
                )
                schedule_rows.extend(page_parse.rows)
                schedule_warnings.extend(page_parse.warnings)
                pages.append(
                    ExtractedPage(
                        page_number=page_number,
                        page_width=page.rect.width,
                        page_height=page.rect.height,
                        text_content=text,
                    )
                )
        except RuntimeError as error:
            raise IngestionError(
                "PDF_PARSE_ERROR",
                "The PDF parser could not extract page content.",
            ) from error

    duplicate_marks = {
        mark
        for mark, count in Counter(
            row.member_mark_normalized for row in schedule_rows
        ).items()
        if count > 1
    }
    if duplicate_marks:
        schedule_rows = [
            replace(row, confidence=min(row.confidence, 0.5))
            if row.member_mark_normalized in duplicate_marks
            else row
            for row in schedule_rows
        ]
        if not any(
            warning["code"] == "DUPLICATE_MEMBER_MARK" for warning in schedule_warnings
        ):
            schedule_warnings.append(
                {
                    "code": "DUPLICATE_MEMBER_MARK",
                    "message": "Duplicate member marks require reviewer confirmation.",
                }
            )

    has_selectable_text = total_text_char_count > 0
    has_beam_schedule = bool(schedule_rows)
    if not has_beam_schedule and has_selectable_text:
        schedule_warnings.append(
            {
                "code": "NO_BEAM_SCHEDULE_HEADER",
                "message": (
                    "No supported beam mark and section/size header was found. "
                    "Review the document or provide a supported schedule layout."
                ),
            }
        )
    warnings = (
        []
        if has_selectable_text
        else [
            {
                "code": "NO_SELECTABLE_TEXT",
                "message": (
                    "No selectable text was found. This may be a scanned PDF; "
                    "OCR is not enabled in this prototype."
                ),
            }
        ]
    )
    return ExtractedDocument(
        pages=pages,
        diagnostics={
            "extractor": PDF_EXTRACTOR_VERSION,
            "page_count": len(pages),
            "total_text_char_count": total_text_char_count,
            "content_status": (
                "selectable_text" if has_selectable_text else "no_selectable_text"
            ),
            "warnings": warnings + schedule_warnings,
            "schedule_row_count": len(schedule_rows),
            "schedule_parser": "beam-mark-section-v1",
        },
        schedule_rows=schedule_rows,
        needs_review=(
            not has_selectable_text
            or not has_beam_schedule
            or bool(schedule_rows)
            or bool(schedule_warnings)
        ),
    )
