/**
 * Member-by-member comparison of an engineer-issued plan and a shop drawing,
 * using the grid alignment from grid-registration.ts.
 *
 * For every member size label on the engineer sheet (PDF text):
 *   1. locate it by grid ("C–D / 2–3");
 *   2. cut the matching strip from the shop sheet, oriented along the member;
 *   3. read the shop's size label there with local OCR (tesseract.js);
 *   4. if OCR can't settle it and the reviewer opted in, ask a vision model via
 *      /api/read-member (only that small crop is sent);
 *   5. compare normalized designations: match / different / not found / unreadable.
 *
 * Findings are review prompts with both crops as evidence, not engineering
 * conclusions. Sizes are compared as designations; no equivalence is inferred.
 */
import type { PDFPageProxy } from "pdfjs-dist";
import {
  createOcrWorkers,
  renderGray,
  type EngineerGridLine,
  type GridProgress,
  type GridRegistration,
} from "@/lib/grid-registration";

export type MemberStatus = "match" | "different" | "not_found" | "unreadable";

export type MemberFinding = {
  id: number;
  engineerLabel: string;
  engineerDesignation: string;
  shopDesignation: string | null;
  shopRaw: string | null;
  status: MemberStatus;
  readBy: "ocr" | "vision" | "none";
  confidence: "high" | "medium" | "low";
  gridLocation: string;
  /** Engineer page points. */
  x: number;
  y: number;
  engineerCrop: string;
  shopCrop: string;
  note?: string;
};

export type MemberComparison = {
  findings: MemberFinding[];
  visionUsed: boolean;
  visionCalls: number;
  visionError?: string;
};

type Image = { gray: Uint8Array; width: number; height: number; zoom: number };

const ENGINEER_LABEL =
  /^(W\d{2,4}\s*[xX]\s*\d{2,3}(?:\.\d+)?|HSS\s*\d{2,3}(?:\.\d+)?\s*[xX]\s*\d{2,3}(?:\.\d+)?\s*[xX]\s*\d+(?:\.\d+)?|C\d{2,3}\s*[xX]\s*\d{1,3}(?:\.\d+)?|MC\d{2,3}\s*[xX]\s*\d{1,3}(?:\.\d+)?|L\d{2,3}\s*[xX]\s*\d{2,3}\s*[xX]\s*\d+(?:\.\d+)?|\d{2,4}\s*(?:MM\s*)?DEEP\s*OWSJ|\d{2,4}\s*OWSJ)$/i;
// Strip half-sizes in engineer page points: along the member, and across it.
const STRIP_ALONG = 150;
const STRIP_ACROSS = 24;
// Vision crops get more context across the member and are enlarged (the model reads
// very small images less reliably).
const VISION_ACROSS = 40;
const VISION_UPSCALE = 2;
const SHOP_DPI = 200;
const ENGINEER_DPI = 150;
const MAX_RENDER_PIXELS = 8000;
const VISION_CONCURRENCY = 4;

// ---------------------------------------------------------------- designations

/** Canonical member designation; keeps the size, drops fabricator suffixes (*, +). */
export function canonicalDesignation(raw: string): string {
  const text = raw.trim().toUpperCase().replace(/\s+/g, " ");
  const joist = /^(\d{2,4})\s*(?:MM\s*)?(?:DEEP\s*)?OWSJ/.exec(text);
  if (joist) return `${joist[1]} OWSJ`;
  return text
    .replace(/\s+/g, "")
    .replace(/[*+%|.,;:]+$/, "")
    .replace(/X/g, "x")
    .replace(/^HSS/, "HSS")
    .replace(/^W/, "W");
}

const LOOKALIKE: Record<string, string> = {
  G: "6", A: "4", S: "5", O: "0", B: "8", I: "1", L: "1", "|": "1", Z: "2", T: "7", Q: "0", D: "0",
};
const DIGITISH = "[0-9GASOBILZTQD|]";
const fixDigits = (value: string) => [...value].map((char) => LOOKALIKE[char] ?? char).join("");

/** Pull designations out of noisy OCR text, undoing common CAD-font misreads. */
export function designationsFromOcr(text: string): string[] {
  const upper = text.toUpperCase();
  const found: string[] = [];
  const patterns: Array<[RegExp, (m: RegExpExecArray) => string | null]> = [
    [
      new RegExp(`W+\\s?(${DIGITISH}{2,4})\\s?[XK*%]\\s?(${DIGITISH}{2,3})`, "g"),
      (m) => {
        const depth = fixDigits(m[1]);
        const mass = fixDigits(m[2]);
        return /^\d+$/.test(depth) && /^\d+$/.test(mass) ? `W${depth}x${mass}` : null;
      },
    ],
    [
      new RegExp(`HSS\\s?(${DIGITISH}{2,3})[XK*](${DIGITISH}{2,3})[XK*]([0-9GASOBILZTQD|.]{1,4})`, "g"),
      (m) => `HSS${fixDigits(m[1])}x${fixDigits(m[2])}x${fixDigits(m[3])}`,
    ],
    [
      new RegExp(`\\b(${DIGITISH}{3})\\s?(?:DE+P|DEFP|OWS|ONS|0WS)`, "g"),
      (m) => {
        const depth = fixDigits(m[1]);
        return /^\d+$/.test(depth) ? `${depth} OWSJ` : null;
      },
    ],
    [
      new RegExp(`\\bC\\s?(${DIGITISH}{3})\\s?[XK*]\\s?([0-9GASOBILZTQD.]{2,4})`, "g"),
      (m) => `C${fixDigits(m[1])}x${fixDigits(m[2])}`,
    ],
  ];
  for (const [pattern, build] of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(upper))) {
      const value = build(match);
      if (value) found.push(canonicalDesignation(value));
    }
  }
  return found;
}

function editDistance(a: string, b: string) {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
}

// ---------------------------------------------------------------- engineer labels

type EngineerLabel = { text: string; x: number; y: number; angle: number; size: number };

function multiply(m1: number[], m2: number[]) {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

export async function engineerMemberLabels(page: PDFPageProxy): Promise<EngineerLabel[]> {
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const labels: EngineerLabel[] = [];
  for (const item of content.items) {
    if (!("str" in item)) continue;
    const text = item.str.trim();
    if (!ENGINEER_LABEL.test(text)) continue;
    const m = multiply(viewport.transform, item.transform);
    const size = Math.hypot(m[2], m[3]);
    const advance = Math.hypot(m[0], m[1]) || 1;
    const ux = m[0] / advance;
    const uy = m[1] / advance;
    labels.push({
      text,
      x: m[4] + (ux * item.width) / 2 + (m[2] / size) * size * 0.35,
      y: m[5] + (uy * item.width) / 2 + (m[3] / size) * size * 0.35,
      angle: (Math.atan2(uy, ux) * 180) / Math.PI,
      size,
    });
  }
  return labels;
}

// ---------------------------------------------------------------- grid location

/** Describe a point by the grid lines that bracket it, e.g. "C–D / 2–3". */
export function gridLocation(x: number, y: number, lines: EngineerGridLine[]): string {
  const unique = new Map<string, EngineerGridLine>();
  for (const line of lines) if (!unique.has(line.label)) unique.set(line.label, line);
  const families: Array<{ angle: number; lines: EngineerGridLine[] }> = [];
  for (const line of unique.values()) {
    const angle = ((line.directionDegrees % 180) + 180) % 180;
    const family = families.find((candidate) => {
      const difference = Math.abs(candidate.angle - angle);
      return Math.min(difference, 180 - difference) < 8;
    });
    if (family) family.lines.push(line);
    else families.push({ angle, lines: [line] });
  }

  const brackets: Array<{ text: string; gap: number; angle: number }> = [];
  for (const family of families) {
    if (family.lines.length < 2) continue;
    const theta = (family.angle * Math.PI) / 180;
    const nx = -Math.sin(theta);
    const ny = Math.cos(theta);
    const point = nx * x + ny * y;
    const offsets = family.lines
      .map((line) => ({ label: line.label, offset: nx * line.x + ny * line.y }))
      .sort((a, b) => a.offset - b.offset);
    const on = offsets.find((entry) => Math.abs(entry.offset - point) < 4);
    if (on) {
      brackets.push({ text: `on ${on.label}`, gap: 0, angle: family.angle });
      continue;
    }
    const below = [...offsets].reverse().find((entry) => entry.offset < point);
    const above = offsets.find((entry) => entry.offset > point);
    if (!below || !above) continue;
    const [first, second] = [below.label, above.label].sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true }),
    );
    brackets.push({
      text: `${first}–${second}`,
      gap: above.offset - below.offset,
      angle: family.angle,
    });
  }
  if (brackets.length === 0) return "outside grid";
  // Grid lines are treated as infinite, so a rotated wing's grid also "brackets" points in the
  // main grid. Report a perpendicular pair of grid families (e.g. letters with numbers, or the
  // X with the Y grid) with the tightest combined spacing: that is the bay the point is in.
  let best: [typeof brackets[number], typeof brackets[number]] | null = null;
  for (let i = 0; i < brackets.length; i += 1) {
    for (let j = i + 1; j < brackets.length; j += 1) {
      const difference = Math.abs(brackets[i].angle - brackets[j].angle) % 180;
      if (Math.abs(difference - 90) > 12) continue;
      if (!best || brackets[i].gap + brackets[j].gap < best[0].gap + best[1].gap) {
        best = [brackets[i], brackets[j]];
      }
    }
  }
  if (best) return best.map((entry) => entry.text).join(" / ");
  brackets.sort((a, b) => a.gap - b.gap);
  return brackets.slice(0, 2).map((entry) => entry.text).join(" / ");
}

// ---------------------------------------------------------------- crops

/** Cut a strip centred on (cx, cy) page points, turned so `angle` runs left to right. */
function cropStrip(
  image: Image,
  cx: number,
  cy: number,
  angle: number,
  halfAlong: number,
  halfAcross: number,
) {
  const { gray, width, height, zoom } = image;
  const theta = (angle * Math.PI) / 180;
  const ux = Math.cos(theta);
  const uy = Math.sin(theta);
  const outWidth = Math.max(8, Math.round(2 * halfAlong * zoom));
  const outHeight = Math.max(8, Math.round(2 * halfAcross * zoom));
  const canvas = document.createElement("canvas");
  canvas.width = outWidth;
  canvas.height = outHeight;
  const context = canvas.getContext("2d");
  if (!context) return { canvas, inside: false };
  const output = context.createImageData(outWidth, outHeight);
  let inside = false;
  for (let row = 0; row < outHeight; row += 1) {
    const v = (row / zoom) - halfAcross;
    for (let column = 0; column < outWidth; column += 1) {
      const u = (column / zoom) - halfAlong;
      const px = Math.round((cx + u * ux - v * uy) * zoom);
      const py = Math.round((cy + u * uy + v * ux) * zoom);
      let level = 255;
      if (px >= 0 && py >= 0 && px < width && py < height) {
        level = gray[py * width + px];
        inside = true;
      }
      const pixel = (row * outWidth + column) * 4;
      output.data[pixel] = level;
      output.data[pixel + 1] = level;
      output.data[pixel + 2] = level;
      output.data[pixel + 3] = 255;
    }
  }
  context.putImageData(output, 0, 0);
  return { canvas, inside };
}

function padded(canvas: HTMLCanvasElement, pad = 20) {
  const out = document.createElement("canvas");
  out.width = canvas.width + pad * 2;
  out.height = canvas.height + pad * 2;
  const context = out.getContext("2d");
  if (context) {
    context.fillStyle = "#fff";
    context.fillRect(0, 0, out.width, out.height);
    context.drawImage(canvas, pad, pad);
  }
  return out;
}

function zoomFor(page: PDFPageProxy, dpi: number) {
  const viewport = page.getViewport({ scale: 1 });
  return Math.min(dpi / 72, MAX_RENDER_PIXELS / Math.max(viewport.width, viewport.height));
}

// ---------------------------------------------------------------- vision

export async function visionAvailable(): Promise<boolean> {
  try {
    const response = await fetch("/api/read-member", { method: "GET" });
    if (!response.ok) return false;
    const body = (await response.json()) as { configured?: boolean };
    return Boolean(body.configured);
  } catch {
    return false;
  }
}

type VisionReading = {
  designation: string | null;
  confidence: "high" | "medium" | "low";
};

async function readWithVision(image: string): Promise<VisionReading> {
  const response = await fetch("/api/read-member", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image }),
  });
  const body = (await response.json().catch(() => ({}))) as {
    designation?: string | null;
    confidence?: string;
    error?: string;
  };
  if (!response.ok) throw new Error(body.error ?? `Vision request failed (${response.status}).`);
  const confidence =
    body.confidence === "high" || body.confidence === "medium" ? body.confidence : "low";
  return {
    designation: body.designation ? canonicalDesignation(body.designation) : null,
    confidence,
  };
}

// ---------------------------------------------------------------- main

export async function compareMembers(
  engineerPage: PDFPageProxy,
  shopPage: PDFPageProxy,
  registration: GridRegistration,
  options: { useVision: boolean; progress?: GridProgress },
): Promise<MemberComparison> {
  const { progress } = options;
  progress?.("Reading member sizes on the engineer sheet…");
  const labels = await engineerMemberLabels(engineerPage);
  if (labels.length === 0) {
    throw new Error(
      "No member size labels were found as text on the engineer sheet, so there is nothing to compare yet.",
    );
  }

  progress?.("Rendering sheets for member crops…");
  const [shopImage, engineerImage] = await Promise.all([
    renderGray(shopPage, zoomFor(shopPage, SHOP_DPI)),
    renderGray(engineerPage, zoomFor(engineerPage, ENGINEER_DPI)),
  ]);

  // Inverse of the shop -> engineer similarity.
  const [a, , tx, b, , ty] = registration.matrix;
  const scale2 = a * a + b * b;
  const ia = a / scale2;
  const ib = -b / scale2;
  const toShop = (x: number, y: number) => {
    const dx = x - tx;
    const dy = y - ty;
    return { x: ia * dx - ib * dy, y: ib * dx + ia * dy };
  };
  const rotation = registration.rotationDegrees;
  const scale = registration.scale;

  type Work = {
    finding: MemberFinding;
    ocrStrip: HTMLCanvasElement;
    candidates: string[];
    shopX: number;
    shopY: number;
    shopAngle: number;
  };
  const visionCrop = (item: Work) => {
    const { canvas } = cropStrip(
      shopImage,
      item.shopX,
      item.shopY,
      item.shopAngle,
      STRIP_ALONG / scale,
      VISION_ACROSS / scale,
    );
    const out = document.createElement("canvas");
    out.width = canvas.width * VISION_UPSCALE;
    out.height = canvas.height * VISION_UPSCALE;
    const context = out.getContext("2d");
    if (context) {
      context.imageSmoothingQuality = "high";
      context.drawImage(canvas, 0, 0, out.width, out.height);
    }
    return out.toDataURL("image/png");
  };
  const work: Work[] = [];
  labels.forEach((label, index) => {
    const shopPoint = toShop(label.x, label.y);
    const shop = cropStrip(
      shopImage,
      shopPoint.x,
      shopPoint.y,
      label.angle - rotation,
      STRIP_ALONG / scale,
      STRIP_ACROSS / scale,
    );
    if (!shop.inside) return; // label lies outside the shop sheet
    const engineer = cropStrip(engineerImage, label.x, label.y, label.angle, STRIP_ALONG, STRIP_ACROSS);
    work.push({
      ocrStrip: padded(shop.canvas),
      candidates: [],
      shopX: shopPoint.x,
      shopY: shopPoint.y,
      shopAngle: label.angle - rotation,
      finding: {
        id: index + 1,
        engineerLabel: label.text,
        engineerDesignation: canonicalDesignation(label.text),
        shopDesignation: null,
        shopRaw: null,
        status: "unreadable",
        readBy: "none",
        confidence: "low",
        gridLocation: gridLocation(label.x, label.y, registration.engineerGridLines),
        x: label.x,
        y: label.y,
        engineerCrop: engineer.canvas.toDataURL("image/png"),
        shopCrop: shop.canvas.toDataURL("image/png"),
      },
    });
  });

  // ---- local OCR
  const workerCount = Math.max(
    1,
    Math.min(4, (typeof navigator !== "undefined" ? navigator.hardwareConcurrency : 2) - 1),
  );
  const workers = await createOcrWorkers(workerCount);
  try {
    await Promise.all(workers.map((worker) => worker.setParameters({ tessedit_pageseg_mode: "11" })));
    let next = 0;
    let done = 0;
    await Promise.all(
      workers.map(async (worker) => {
        while (next < work.length) {
          const item = work[next];
          next += 1;
          const { data } = await worker.recognize(item.ocrStrip);
          item.candidates = designationsFromOcr(data.text);
          if (item.candidates.length === 0) {
            const flipped = document.createElement("canvas");
            flipped.width = item.ocrStrip.width;
            flipped.height = item.ocrStrip.height;
            const context = flipped.getContext("2d");
            if (context) {
              context.translate(flipped.width, flipped.height);
              context.rotate(Math.PI);
              context.drawImage(item.ocrStrip, 0, 0);
              const second = await worker.recognize(flipped);
              item.candidates = designationsFromOcr(second.data.text);
            }
          }
          done += 1;
          if (done % 10 === 0) {
            progress?.(`Reading shop member labels (OCR)… ${done} of ${work.length}`);
          }
        }
      }),
    );
  } finally {
    await Promise.all(workers.map((worker) => worker.terminate()));
  }

  const needsVision: Work[] = [];
  for (const item of work) {
    const { finding, candidates } = item;
    const want = finding.engineerDesignation;
    if (candidates.includes(want)) {
      Object.assign(finding, {
        status: "match",
        shopDesignation: want,
        shopRaw: want,
        readBy: "ocr",
        confidence: "high",
      });
    } else if (candidates.some((value) => editDistance(value, want) <= 1)) {
      Object.assign(finding, {
        status: "match",
        shopDesignation: want,
        shopRaw: candidates.find((value) => editDistance(value, want) <= 1) ?? null,
        readBy: "ocr",
        confidence: "medium",
        note: "OCR read differs by one character; treated as a match.",
      });
    } else {
      // OCR found nothing, or only other sizes (possibly a neighbouring member's label).
      if (candidates.length > 0) {
        Object.assign(finding, {
          status: "different",
          shopDesignation: candidates[0],
          shopRaw: candidates.join(", "),
          readBy: "ocr",
          confidence: "low",
          note: "OCR read a different size nearby; it may belong to an adjacent member.",
        });
      }
      needsVision.push(item);
    }
  }

  // ---- vision model for what OCR could not settle
  let visionCalls = 0;
  let visionError: string | undefined;
  if (options.useVision && needsVision.length > 0) {
    let next = 0;
    let done = 0;
    progress?.(`Checking ${needsVision.length} unclear labels with the vision model…`);
    await Promise.all(
      Array.from({ length: Math.min(VISION_CONCURRENCY, needsVision.length) }, async () => {
        while (next < needsVision.length && !visionError) {
          const item = needsVision[next];
          next += 1;
          try {
            visionCalls += 1;
            const reading = await readWithVision(visionCrop(item));
            const want = item.finding.engineerDesignation;
            if (!reading.designation) {
              Object.assign(item.finding, {
                status: reading.confidence === "low" ? "unreadable" : "not_found",
                shopDesignation: null,
                shopRaw: null,
                readBy: "vision",
                confidence: reading.confidence,
                note:
                  reading.confidence === "low"
                    ? "The vision model could not read a size label for this member."
                    : "No size label for this member was found on the shop drawing at this location.",
              });
            } else {
              Object.assign(item.finding, {
                status: reading.designation === want ? "match" : "different",
                shopDesignation: reading.designation,
                shopRaw: reading.designation,
                readBy: "vision",
                confidence: reading.confidence,
                note: undefined,
              });
            }
          } catch (error) {
            visionError = error instanceof Error ? error.message : "Vision request failed.";
          }
          done += 1;
          if (done % 5 === 0) progress?.(`Vision model… ${done} of ${needsVision.length}`);
        }
      }),
    );
  }

  // Without a vision reading, OCR-only "different" results are too unreliable to report as
  // discrepancies; show them as unreadable with the OCR text for the reviewer.
  for (const item of needsVision) {
    if (item.finding.readBy === "ocr" && item.finding.status === "different") {
      item.finding.status = "unreadable";
      item.finding.note = `OCR saw ${item.finding.shopRaw}, which may belong to an adjacent member. Check the crop.`;
    }
  }

  const order: Record<MemberStatus, number> = { different: 0, not_found: 1, unreadable: 2, match: 3 };
  const findings = work
    .map((item) => item.finding)
    .sort((x, y) => order[x.status] - order[y.status] || x.gridLocation.localeCompare(y.gridLocation));
  return {
    findings,
    visionUsed: options.useVision && visionCalls > 0,
    visionCalls,
    visionError,
  };
}
