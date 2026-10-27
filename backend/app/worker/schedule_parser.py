import re
from dataclasses import dataclass
from typing import Any

MARK_HEADERS = {"MARK", "MEMBER", "BEAM", "REFERENCE"}
SECTION_HEADERS = {"SECTION", "SIZE", "PROFILE", "DESIGNATION"}
HEADER_WORDS = MARK_HEADERS | SECTION_HEADERS | {"NO", "NUMBER"}
LINE_Y_TOLERANCE = 3.0


@dataclass(frozen=True)
class ParsedScheduleRow:
    row_number: int
    member_mark_raw: str
    member_mark_normalized: str
    section_raw: str
    section_normalized: str
    page_number: int
    page_width: float
    page_height: float
    source_bbox: dict[str, float]
    confidence: float
    review_state: str
    extractor: str


@dataclass(frozen=True)
class ScheduleParseResult:
    rows: list[ParsedScheduleRow]
    warnings: list[dict[str, str]]
    candidate_line_count: int


def _normalize_header(value: str) -> str:
    return re.sub(r"[^A-Z]", "", value.upper())


def _group_words(words: list[tuple[Any, ...]]) -> list[list[tuple[Any, ...]]]:
    ordered = sorted(
        words,
        key=lambda word: (
            (float(word[1]) + float(word[3])) / 2,
            float(word[0]),
        ),
    )
    lines: list[list[tuple[Any, ...]]] = []
    for word in ordered:
        word_center_y = (float(word[1]) + float(word[3])) / 2
        if lines:
            line_center_y = sum(
                (float(item[1]) + float(item[3])) / 2 for item in lines[-1]
            ) / len(lines[-1])
        else:
            line_center_y = float("inf")
        if abs(word_center_y - line_center_y) <= LINE_Y_TOLERANCE:
            lines[-1].append(word)
        else:
            lines.append([word])

    return [sorted(line, key=lambda word: float(word[0])) for line in lines]


def _find_header(
    lines: list[list[tuple[Any, ...]]],
) -> tuple[int, float, float] | None:
    for line_index, line in enumerate(lines):
        labels: list[tuple[str, float]] = []
        for word in line:
            label = _normalize_header(str(word[4]))
            if label:
                labels.append((label, (float(word[0]) + float(word[2])) / 2))
        mark_centers = [x for label, x in labels if label in MARK_HEADERS]
        section_centers = [x for label, x in labels if label in SECTION_HEADERS]
        if mark_centers and section_centers:
            mark_center = min(mark_centers)
            section_center = min(section_centers)
            if mark_center != section_center:
                return line_index, mark_center, section_center
    return None


def _cell_words(
    line: list[tuple[Any, ...]],
    *,
    center: float,
    other_center: float,
) -> list[tuple[Any, ...]]:
    midpoint = (center + other_center) / 2
    return [
        word
        for word in line
        if (
            (float(word[0]) + float(word[2])) / 2 < midpoint
            if center < other_center
            else (float(word[0]) + float(word[2])) / 2 > midpoint
        )
    ]


def _cell_text(words: list[tuple[Any, ...]]) -> str:
    return " ".join(str(word[4]) for word in words).strip()


def _looks_like_section(value: str) -> bool:
    compact = re.sub(r"\s+", "", value).upper()
    return any(character.isdigit() for character in compact) and any(
        character.isalpha() for character in compact
    )


def parse_beam_schedule_page(
    *,
    words: list[tuple[Any, ...]],
    page_number: int,
    page_width: float,
    page_height: float,
    extractor: str,
) -> ScheduleParseResult:
    lines = _group_words(words)
    header = _find_header(lines)
    if header is None:
        return ScheduleParseResult(
            rows=[],
            warnings=[],
            candidate_line_count=0,
        )

    header_index, mark_center, section_center = header
    rows: list[ParsedScheduleRow] = []
    candidate_line_count = 0
    for line in lines[header_index + 1 :]:
        mark_words = _cell_words(
            line,
            center=mark_center,
            other_center=section_center,
        )
        section_words = _cell_words(
            line,
            center=section_center,
            other_center=mark_center,
        )
        mark_raw = _cell_text(mark_words)
        section_raw = _cell_text(section_words)
        if not mark_raw and not section_raw:
            continue
        if _normalize_header(mark_raw) in HEADER_WORDS:
            continue
        candidate_line_count += 1
        if not mark_raw or not section_raw or not _looks_like_section(section_raw):
            continue

        source_words = mark_words + section_words
        bbox = {
            "x0": min(float(word[0]) for word in source_words),
            "y0": min(float(word[1]) for word in source_words),
            "x1": max(float(word[2]) for word in source_words),
            "y1": max(float(word[3]) for word in source_words),
        }
        rows.append(
            ParsedScheduleRow(
                row_number=len(rows) + 1,
                member_mark_raw=mark_raw,
                member_mark_normalized=re.sub(r"\s+", "", mark_raw).upper(),
                section_raw=section_raw,
                section_normalized=re.sub(r"\s+", "", section_raw).upper(),
                page_number=page_number,
                page_width=page_width,
                page_height=page_height,
                source_bbox=bbox,
                confidence=0.9,
                review_state="needs_review",
                extractor=extractor,
            )
        )

    duplicate_marks = {
        row.member_mark_normalized
        for row in rows
        if sum(
            candidate.member_mark_normalized == row.member_mark_normalized
            for candidate in rows
        )
        > 1
    }
    if duplicate_marks:
        rows = [
            ParsedScheduleRow(
                **{
                    **row.__dict__,
                    "confidence": 0.5,
                    "review_state": "needs_review",
                }
            )
            if row.member_mark_normalized in duplicate_marks
            else row
            for row in rows
        ]

    warnings = []
    if candidate_line_count > len(rows):
        warnings.append(
            {
                "code": "UNPARSED_SCHEDULE_LINES",
                "message": (
                    f"{candidate_line_count - len(rows)} schedule-like line(s) "
                    "could not be parsed confidently."
                ),
            }
        )
    if duplicate_marks:
        warnings.append(
            {
                "code": "DUPLICATE_MEMBER_MARK",
                "message": "Duplicate member marks require reviewer confirmation.",
            }
        )

    return ScheduleParseResult(
        rows=rows,
        warnings=warnings,
        candidate_line_count=candidate_line_count,
    )
