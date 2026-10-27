---
name: "steel-erection-drawing-review"
description: "Compare a fabricator's steel erection drawing PDF against the structural framing plan PDF and return a clouded, commented review PDF of discrepancies."
---

# Steel Erection Drawing Review

Review fabricator ERECTION drawings against the engineer-of-record (EOR) structural FRAMING PLAN and flag what the fabricator has wrong. Output is a marked-up copy of the fabricator PDF with revision clouds, numbered tags, pop-up comments, and a discrepancy list page.

Scope of checks:
1. Member sizes and grids: every beam, girder, column, brace; grid location; missing or extra members.
2. Elevations and camber: top of steel (TOS) elevations or offsets, slopes, camber values and which members are cambered.
3. Connections and reactions: moment vs shear connections, end reactions / design loads, shear studs, bearing/embed conditions shown on plan.

This is an aid for the EOR's review, not a replacement. Every finding must be verifiable by a person looking at the cited location.

## Step 0: Gather inputs and ASK when unclear

The user prefers questions over guesses. Before reviewing, confirm (AskUserQuestion):
- Which PDF is the design framing plan and which is the fabricator erection drawing, and which sheets/levels to compare if there are several.
- Any project conventions not obvious from the sheets: TOS reference (absolute elevation vs offset from floor), camber notation, how reactions are given (plan values, schedule, or "see notes"), typical connection unless noted.
- Whether supplemental design sheets (general notes, typical details, beam schedules) should be included.

During the review, if a value on either drawing is illegible or the intent is ambiguous, record it as a `verify` finding rather than guessing. If many items are ambiguous for the same reason, stop and ask the user.

## Step 1: Prepare sheets

Write the two helper scripts below to a scratch folder (install with `pip install pymupdf` if needed; add `--break-system-packages` on managed Linux). Then run prep on each PDF:

```
python prep_sheets.py design.pdf work/design --dpi 150 --grid 3x2
python prep_sheets.py fab.pdf    work/fab    --dpi 150 --grid 3x2
```

- `p{N}_full.png` is a low-res overview: view it first to locate grids, plan area, title block, notes.
- `p{N}_r{row}c{col}.png` tiles overlap ~8% so labels on tile edges are not lost. View every tile that contains framing. Increase `--grid` (e.g. 4x3) or `--dpi` (200) for dense sheets.
- `p{N}_words.json` is exact vector text with PDF-point bounding boxes. Prefer this over reading pixels for sizes, elevations, reactions, and marks. If prep reports NO VECTOR TEXT, the sheet is scanned: rely on images and mark low-confidence reads as `verify`.
- `manifest.json` maps each tile to its PDF-point rectangle (`clip_pts`), so a feature seen at pixel (px,py) in a tile is at `x = clip_x0 + px*72/dpi`, `y = clip_y0 + py*72/dpi`.

## Step 2: Extract both drawings into the same schema

Build `design_members.json` and `fab_members.json`. One record per member:

```json
{"key": "B|C|2-3", "type": "beam|girder|column|brace",
 "grid_line": "C", "span": "2-3", "offset": "4'-0\" N of C (if off-grid)",
 "size": "W18X35", "camber": "3/4", "tos": "-2\"" , "slope": null,
 "conn_left": "shear|moment|other", "conn_right": "shear|moment|other",
 "reaction_left": "25k", "reaction_right": "25k", "studs": "(22)",
 "piece_mark": "(fab only) B123", "page": 1, "bbox": [x0,y0,x1,y1],
 "confidence": "high|low"}
```

- Key members by grid location (grid line + span between grids, plus offset for infill beams). Fabricators renumber with piece marks, so never match by mark.
- For infill beams between grids, use their order and spacing between girders (e.g. "C-D, 2-3, beam 2 of 3 from grid 2").
- `bbox` comes from `p{N}_words.json` (the member's size label). For the fabricator drawing this bbox is where the cloud will go.
- Apply typical-unless-noted values from general notes (e.g. typical connection, typical TOS) explicitly to each member so comparisons are apples to apples. Note when a value is inherited from a typical note.

Normalize before comparing: `W16x26` = `W16X26` = `W16 x 26`; camber `c=3/4`, `3/4" C`, `C=3/4"` all mean 3/4 in; convert TOS to the same reference (offset vs absolute) using the floor elevation; reactions in kips.

## Step 3: Compare

For each design member find its fabricator counterpart and record differences:

| Category | Flag when | Default severity |
|---|---|---|
| Member size | Shop size differs from design | high |
| Missing member | On design, not on shop | high |
| Extra member | On shop, not on design (could be fabricator-added erection aid) | verify |
| Grid/location | Member on wrong grid, span, or spacing | high |
| TOS / slope | Elevation or slope differs | high |
| Camber | Value differs, missing, or added where design has none | medium |
| Connection type | Moment shown as shear or vice versa | high |
| Reaction | Shop design load lower than design (higher is conservative: low) | medium |
| Studs | Count differs or missing | medium |
| Unreadable / ambiguous | Can't confirm either side | verify |

Also check columns (size, splice levels if shown) and braces (size, configuration) the same way.

## Step 4: Verify before reporting

False positives waste the EOR's time. For every high or medium finding, re-check both sides at higher resolution before including it:

```python
import pymupdf
d = pymupdf.open("fab.pdf"); x0,y0,x1,y1 = BBOX
d[PAGE-1].get_pixmap(dpi=300, clip=(x0-150,y0-150,x1+150,y1+150)).save("check.png")
```

View the crop for both drawings. Drop findings that don't hold up; downgrade uncertain ones to `verify`.

## Step 5: Mark up and deliver

Write `findings.json` (list of objects: `id, page, bbox, category, location, design, shop, severity, note`) using fabricator-sheet page and bbox. For a missing member, use the bbox of the area where it should be (between the grid bubbles' coordinates). Then:

```
python markup_pdf.py fab.pdf findings.json "<fab name>_EOR_REVIEW.pdf"
```

Save the review PDF next to the user's source files (or deliver it in chat). In the reply give: counts by severity, the high-severity items in a short list, and the `verify` items the user should look at. Remind them this is a first-pass aid and the EOR stamp/review remains theirs.

## Helper script: prep_sheets.py

```python
"""Render PDF sheets to overlapping image tiles and extract vector text with coordinates.
Usage: python prep_sheets.py <input.pdf> <out_dir> [--dpi 150] [--grid 3x2]"""
import argparse, json, os
import pymupdf

ap = argparse.ArgumentParser()
ap.add_argument("pdf"); ap.add_argument("out")
ap.add_argument("--dpi", type=int, default=150)
ap.add_argument("--grid", default="3x2", help="cols x rows of tiles per sheet")
ap.add_argument("--overlap", type=float, default=0.08, help="tile overlap fraction")
a = ap.parse_args()
os.makedirs(a.out, exist_ok=True)
cols, rows = map(int, a.grid.lower().split("x"))
doc = pymupdf.open(a.pdf)
manifest = {"pdf": os.path.abspath(a.pdf), "pages": []}

for pno, page in enumerate(doc, start=1):
    r = page.rect
    page.get_pixmap(dpi=40).save(f"{a.out}/p{pno}_full.png")
    words = [{"text": w[4], "bbox": [round(v, 1) for v in w[:4]]} for w in page.get_text("words")]
    json.dump(words, open(f"{a.out}/p{pno}_words.json", "w"))
    tiles = []
    tw, th = r.width / cols, r.height / rows
    ox, oy = tw * a.overlap, th * a.overlap
    for ri in range(rows):
        for ci in range(cols):
            clip = pymupdf.Rect(max(r.x0, r.x0 + ci * tw - ox), max(r.y0, r.y0 + ri * th - oy),
                                min(r.x1, r.x0 + (ci + 1) * tw + ox), min(r.y1, r.y0 + (ri + 1) * th + oy))
            name = f"p{pno}_r{ri+1}c{ci+1}.png"
            page.get_pixmap(dpi=a.dpi, clip=clip).save(f"{a.out}/{name}")
            tiles.append({"file": name, "clip_pts": [round(v, 1) for v in clip]})
    manifest["pages"].append({"page": pno, "size_pts": [r.width, r.height],
                              "word_count": len(words), "tiles": tiles})
    print(f"page {pno}: {r.width:.0f}x{r.height:.0f} pts, {len(words)} text words, {len(tiles)} tiles"
          + ("  (NO VECTOR TEXT: likely scanned, rely on images)" if len(words) < 20 else ""))

json.dump(manifest, open(f"{a.out}/manifest.json", "w"), indent=1)
```

## Helper script: markup_pdf.py

```python
"""Cloud discrepancies on the fabricator PDF and add review comments.
Usage: python markup_pdf.py <fabricator.pdf> <findings.json> <output.pdf>"""
import json, math, sys
import pymupdf

src, fjson, out = sys.argv[1:4]
doc = pymupdf.open(src)
findings = json.load(open(fjson))
COLORS = {"high": (0.85, 0, 0), "medium": (0.95, 0.45, 0), "low": (0.1, 0.3, 0.85), "verify": (0.55, 0, 0.7)}

def cloud_points(rect, arc=10.0):
    pts, corners = [], [rect.tl, rect.tr, rect.br, rect.bl, rect.tl]
    for a, b in zip(corners, corners[1:]):
        L = math.dist(a, b); n = max(2, int(L // arc))
        dx, dy = (b.x - a.x) / n, (b.y - a.y) / n
        nx, ny = dy / max(L / n, 1e-6), -dx / max(L / n, 1e-6)
        for i in range(n):
            for t in (0.0, 0.25, 0.5, 0.75):
                bulge = math.sin(math.pi * t) * arc * 0.35
                pts.append(pymupdf.Point(a.x + dx * (i + t) - nx * bulge, a.y + dy * (i + t) - ny * bulge))
    pts.append(pts[0])
    return pts

for f in findings:
    page = doc[f["page"] - 1]
    rect = pymupdf.Rect(f["bbox"]) + (-6, -6, 6, 6)
    col = COLORS.get(f.get("severity", "medium"), COLORS["medium"])
    cloud = page.add_polygon_annot(cloud_points(rect))
    cloud.set_colors(stroke=col); cloud.set_border(width=1.5)
    msg = (f"#{f['id']} [{f.get('severity','').upper()}] {f.get('category','')}\n"
           f"Location: {f.get('location','')}\nDesign: {f.get('design','')}\n"
           f"Shop: {f.get('shop','')}\n{f.get('note','')}")
    cloud.set_info(title="Structural Review", content=msg); cloud.update()
    tag = pymupdf.Rect(rect.x1 + 2, rect.y0 - 16, rect.x1 + 30, rect.y0 - 2)
    lbl = page.add_freetext_annot(tag, f"#{f['id']}", fontsize=9, text_color=col, fill_color=(1, 1, 1))
    lbl.update()

w, h = doc[0].rect.width, doc[0].rect.height
pg = doc.new_page(width=w, height=h)
lines = ["STRUCTURAL REVIEW OF FABRICATOR ERECTION DRAWINGS: DISCREPANCY LIST", ""]
for f in findings:
    lines.append(f"#{f['id']}  [{f.get('severity','').upper()}]  p{f['page']}  {f.get('location','')}  |  "
                 f"{f.get('category','')}  |  Design: {f.get('design','')}  |  Shop: {f.get('shop','')}  |  {f.get('note','')}")
pg.insert_textbox(pymupdf.Rect(36, 36, w - 36, h - 36), "\n".join(lines), fontsize=9, fontname="helv")
doc.save(out, garbage=3, deflate=True)
print(f"Wrote {out} with {len(findings)} findings")
```