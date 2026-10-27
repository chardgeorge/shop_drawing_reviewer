# Sample drawings

Use synthetic PDFs or drawings with explicit permission for automated test use. Never commit confidential customer, project, or personally identifying information. Keep fixtures small and document their origin, expected extraction rows, and expected comparison results alongside the relevant tests.

## Synthetic framing-plan pair

`engineer-issued-sample.pdf` and `shop-drawing-sample.pdf` are fictional, one-page vector structural framing-plan drawings for local visual-comparison testing. The shop sheet is rotated 90 degrees and scaled to 92% of the engineer sheet to exercise automatic page registration. After alignment, the intended geometry difference is the location of beam B-102:

| Drawing | Grid 2 to B-102 offset |
|---|---|
| Engineer-issued (S-201) | 6'-0" |
| Fabricator shop drawing (SD-201) | 5'-0" |

The beam is visibly shifted by one foot on the shop drawing. Both sheets label the difference and are marked as synthetic and not for construction. The local frontend can compare the selected pages and exports a rasterized candidate markup; it does not make engineering determinations.
