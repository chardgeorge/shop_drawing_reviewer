# Source: Detail 6 – Typical Roof Platform Column to Brace Connection

| Field | Value |
|---|---|
| File | `detail.pdf` (1 page, letter, vector) |
| Origin | Engineer-issued structural detail, exported from Bluebeam Revu 21 |
| Detail reference | Detail 6; references 13/S07.02 for the beam-to-HSS column connection |
| Scale | 3/4" = 1'-0" |
| Permission | Cleared for use as a test fixture by Aaron (2026-10-27) |
| Answer key | `expected.md`, verified by Aaron against this PDF |

## Notes for extraction

- Linework is vector; render at 200–300 dpi for image-based extraction.
- The PDF text layer is **incomplete**. It contains only the Arial notes: bolt callouts, "See Plan" member labels, the brace label and the detail title.
- Weld sizes, plate callouts (PL 1/2", PL 1", PL 1 1/2"), dimensions, "TYP. AT STIFFENER" and "CAP PL" are drawn as linework, not text.
- Stacked fractions are garbled in the text layer: `1 1/8"Ø` extracts as `1 18 "Ø` and `1 8"Ø`; `6x6x1/2` extracts as `6x6x1 2`; the double-angle symbol is missing.
- Use this fixture to test that text-only extraction is flagged as incomplete, and that image-based extraction recovers every row of `expected.md`.

## Answer key conventions

- Values are recorded as drawn. Values calculated from the drawing are labeled "(derived)" and are not expected from the extractor.
- Members marked "See plan" are not sized in this detail and need cross-referencing to the framing plan.
