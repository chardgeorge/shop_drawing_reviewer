# Source: Detail 13 – Beam to HSS Column Connection

| Field | Value |
|---|---|
| File | `detail.pdf` (1 page, letter, vector) |
| Origin | Engineer-issued structural detail, exported from Bluebeam Revu 21 |
| Detail reference | Detail 13, sheet blank ("13/-"). Detail 6 calls it out as 13/S07.02. References 2/- for additional details and dimensions. |
| Scale | N.T.S. |
| Views | Section; Plan (a) at 4-sided connection; Plan (b) at 2- or 3-sided connections |
| Permission | Cleared for use as a test fixture by Aaron (2026-10-27) |
| Answer key | `expected.md`, drafted by Claude from this PDF and verified by Aaron (2026-10-27) |

## Notes for extraction

- Linework is vector; render at 200–300 dpi for image-based extraction.
- The text layer is more complete than detail 6: notes, titles, weld callout labels ("TYP.", "C.P. AT COLUMN SPLICE") and view labels are real text.
- Stacked fractions split apart in the text layer: `5/16` extracts as `5` and `16` on separate lines, `1/4` as `1` / `4`, `1/2"` as `1` / `2"`.
- The plate symbol is linework, so it drops out of the text: "KNIFE PL AT SKEWED BEAM" extracts as `KNIFE AT SKEWED BEAM`, and "COPE PL" as `COPE AT`. "PL 1/2" at the cap is not in the text layer.
- Weld information depends on symbol geometry, not text:
  - fillet on both sides vs. arrow side only;
  - all-around circle;
  - field-weld flag on the skewed beam CP weld;
  - bevel groove symbol for CP welds.
- Several values are intentionally not specified here (member sizes, knife plate thickness, bolts). The extractor should report them as "not called out", not guess.

## Cross-check findings

- **Cap plate weld differs between details.** This detail shows a 1/4" fillet all around the PL 1/2" cap. Detail 6 (roof platform column) shows 5/16" fillet all around for its PL 1/2" cap. This may be intentional, but it is a discrepancy a reviewer should confirm.
- **Sheet number.** This detail's title is "13/-"; detail 6 references it as 13/S07.02.

## Answer key conventions

- Values are recorded as drawn. Items drawn but not called out are listed separately and are not expected from the extractor.
