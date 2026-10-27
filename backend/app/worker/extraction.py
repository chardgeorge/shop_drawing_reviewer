from dataclasses import dataclass
from pathlib import Path

import pymupdf

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
            total_text_char_count = 0
            for page_number, page in enumerate(document, start=1):
                text = page.get_text("text")
                total_text_char_count += len(text.strip())
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

    has_selectable_text = total_text_char_count > 0
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
            "warnings": warnings,
        },
        needs_review=not has_selectable_text,
    )
