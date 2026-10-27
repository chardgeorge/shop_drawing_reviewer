/**
 * Grid-based registration of a shop drawing to an engineer-issued drawing.
 *
 * Independently drafted sheets (EOR framing plan vs. fabricator erection drawing)
 * share almost no identical pixels, but they share the named grid system exactly.
 * This module:
 *   1. finds grid bubbles on each sheet, from the PDF text layer when the labels are
 *      real text, otherwise by detecting circles and reading them with OCR;
 *   2. measures each grid line's direction on the "line" sheet by ray sampling;
 *   3. fits a similarity transform (scale, rotation, translation) that puts every
 *      bubble of the other sheet ON the same-named grid line (point-to-line), using
 *      RANSAC so OCR misreads and inset plans are rejected as outliers.
 *
 * Coordinates are PDF page points in the rotated viewport (scale 1, y down).
 * Everything runs in the browser; drawings are never uploaded.
 */
import type { CV } from "@techstark/opencv-js";
import type { PDFPageProxy } from "pdfjs-dist";

export type GridBubble = {
  labels: string[];
  x: number;
  y: number;
  radius: number;
};

type GridLine = GridBubble & { directionDegrees: number; directionScore: number };

export type GridRegistration = {
  /** Maps shop page points to engineer page points: [a, -b, tx, b, a, ty]. */
  matrix: [number, number, number, number, number, number];
  scale: number;
  rotationDegrees: number;
  matchedBubbles: number;
  gridLabels: string[];
  lineDirections: number;
  medianResidualPt: number;
  engineerBubbleSource: "text" | "ocr";
  shopBubbleSource: "text" | "ocr";
  engineerBubbles: number;
  shopBubbles: number;
};

export type GridProgress = (message: string) => void;

const GRID_LABEL = /^(?:[A-Z]{1,3}[0-9]{0,2}[a-z]?|[0-9]{1,2}[a-z]?)$/;
const OCR_WHITELIST =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const MIN_TEXT_BUBBLES = 8;
const MIN_MATCHED_LABELS = 8;
const MIN_LINE_DIRECTIONS = 2;
const MIN_DIRECTION_SCORE = 0.5;
const MAX_DETECTION_PIXELS = 6000;
const MAX_DETECTION_DPI = 200;
const RANSAC_ITERATIONS = 30000;
// Same tolerance as feature alignment: allows reduced-size prints (e.g. a 1:100 sheet printed at 75%).
const MAX_SCALE_DEVIATION = 1.35;

type Matrix6 = [number, number, number, number, number, number];

function multiply(m1: number[], m2: number[]): Matrix6 {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

function normalizeLabel(raw: string) {
  const text = raw.replace(/\s+/g, "");
  const match = /^([A-Za-z]{0,3})([0-9]{0,2})([a-z]?)$/.exec(text);
  if (!match || !text) return "";
  const label = match[1].toUpperCase() + match[2] + match[3];
  return GRID_LABEL.test(label) ? label : "";
}

// ---------------------------------------------------------------- text layer

/** Grid bubbles whose labels are real PDF text (the dominant large label size). */
export async function textGridBubbles(page: PDFPageProxy): Promise<GridBubble[]> {
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const candidates: Array<GridBubble & { size: number }> = [];

  for (const item of content.items) {
    if (!("str" in item)) continue;
    const label = item.str.trim();
    if (!GRID_LABEL.test(label)) continue;
    const m = multiply(viewport.transform, item.transform);
    const size = Math.hypot(m[2], m[3]);
    if (!(size > 0)) continue;
    const advance = Math.hypot(m[0], m[1]) || 1;
    const ux = m[0] / advance;
    const uy = m[1] / advance;
    const vx = m[2] / size;
    const vy = m[3] / size;
    candidates.push({
      labels: [label],
      x: m[4] + (ux * item.width) / 2 + vx * size * 0.35,
      y: m[5] + (uy * item.width) / 2 + vy * size * 0.35,
      radius: size * 1.26,
      size: Math.round(size * 10) / 10,
    });
  }

  const counts = new Map<number, number>();
  for (const candidate of candidates) {
    counts.set(candidate.size, (counts.get(candidate.size) ?? 0) + 1);
  }
  const frequent = [...counts.entries()].filter(([, count]) => count >= 6);
  if (frequent.length === 0) return [];
  const bubbleSize = Math.max(...frequent.map(([size]) => size));
  return candidates
    .filter((candidate) => candidate.size === bubbleSize)
    .map(({ labels, x, y, radius }) => ({ labels, x, y, radius }));
}

// ---------------------------------------------------------------- rendering

async function renderGray(page: PDFPageProxy, zoom: number) {
  const viewport = page.getViewport({ scale: zoom });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("This browser could not create a canvas for grid detection.");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: context, viewport }).promise;
  const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const gray = new Uint8Array(canvas.width * canvas.height);
  for (let index = 0; index < gray.length; index += 1) {
    const pixel = index * 4;
    gray[index] =
      0.299 * rgba[pixel] + 0.587 * rgba[pixel + 1] + 0.114 * rgba[pixel + 2];
  }
  return { canvas, gray, width: canvas.width, height: canvas.height, zoom };
}

function detectionZoom(page: PDFPageProxy) {
  const viewport = page.getViewport({ scale: 1 });
  const longSide = Math.max(viewport.width, viewport.height);
  return Math.min(MAX_DETECTION_DPI / 72, MAX_DETECTION_PIXELS / longSide);
}

// ---------------------------------------------------------------- line directions

/** Direction of the grid line leaving each bubble, found by sampling rays. */
function measureDirections(
  bubbles: GridBubble[],
  image: { gray: Uint8Array; width: number; height: number; zoom: number },
): GridLine[] {
  const { gray, width, height, zoom } = image;
  const dark = new Uint8Array(gray.length);
  for (let index = 0; index < gray.length; index += 1) dark[index] = gray[index] < 200 ? 1 : 0;
  const isDark = (px: number, py: number) => {
    for (let dy = -1; dy <= 1; dy += 1) {
      const y = py + dy;
      if (y < 0 || y >= height) continue;
      for (let dx = -1; dx <= 1; dx += 1) {
        const x = px + dx;
        if (x >= 0 && x < width && dark[y * width + x]) return 1;
      }
    }
    return 0;
  };

  return bubbles.map((bubble) => {
    let bestScore = 0;
    let bestDegrees = 0;
    const step = Math.max(0.5, 1 / zoom);
    for (let degrees = 0; degrees < 360; degrees += 0.5) {
      const theta = (degrees * Math.PI) / 180;
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);
      let hits = 0;
      let samples = 0;
      for (let distance = bubble.radius * 1.6; distance < bubble.radius * 12; distance += step) {
        const x = Math.round((bubble.x + distance * cos) * zoom);
        const y = Math.round((bubble.y + distance * sin) * zoom);
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        samples += 1;
        hits += isDark(x, y);
      }
      if (samples > 0 && hits / samples > bestScore) {
        bestScore = hits / samples;
        bestDegrees = degrees;
      }
    }
    return { ...bubble, directionDegrees: bestDegrees, directionScore: bestScore };
  });
}

// ---------------------------------------------------------------- OCR bubbles

type OcrWorker = {
  setParameters(params: Record<string, string>): Promise<unknown>;
  recognize(image: HTMLCanvasElement): Promise<{ data: { text: string } }>;
  terminate(): Promise<unknown>;
};

async function createOcrWorkers(count: number) {
  const tesseract = await import("tesseract.js");
  const options = {
    workerPath: "/ocr/worker.min.js",
    corePath: "/ocr",
    langPath: "/ocr",
    gzip: true,
    cacheMethod: "none",
  };
  const workers: OcrWorker[] = [];
  for (let index = 0; index < count; index += 1) {
    workers.push(
      (await tesseract.createWorker("eng", 1, options)) as unknown as OcrWorker,
    );
  }
  return workers;
}

function cropBubble(
  image: { gray: Uint8Array; width: number; height: number },
  cx: number,
  cy: number,
  radius: number,
  keep: number,
  masked: boolean,
) {
  const half = Math.round(radius);
  const target = 220;
  const factor = Math.max(1, target / (2 * half));
  const pad = 24;
  const size = Math.round(2 * half * factor) + pad * 2;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) return canvas;
  const output = context.createImageData(size, size);
  for (let oy = 0; oy < size; oy += 1) {
    for (let ox = 0; ox < size; ox += 1) {
      const sx = (ox - pad) / factor - half;
      const sy = (oy - pad) / factor - half;
      let level = 255;
      const inside = masked
        ? sx * sx + sy * sy <= (radius * keep) ** 2
        : Math.abs(sx) <= radius * keep && Math.abs(sy) <= radius * keep;
      if (inside) {
        const x = Math.round(cx + sx);
        const y = Math.round(cy + sy);
        if (x >= 0 && y >= 0 && x < image.width && y < image.height) {
          level = image.gray[y * image.width + x];
        }
      }
      const pixel = (oy * size + ox) * 4;
      output.data[pixel] = level;
      output.data[pixel + 1] = level;
      output.data[pixel + 2] = level;
      output.data[pixel + 3] = 255;
    }
  }
  context.putImageData(output, 0, 0);
  return canvas;
}

/** Detect bubble circles on a rendered page and read their labels with OCR. */
async function ocrGridBubbles(
  cv: CV,
  page: PDFPageProxy,
  image: { gray: Uint8Array; width: number; height: number; zoom: number },
  progress?: GridProgress,
): Promise<GridBubble[]> {
  const viewport = page.getViewport({ scale: 1 });
  const longSide = Math.max(viewport.width, viewport.height);
  const { zoom } = image;
  const minRadius = Math.max(8, Math.round(longSide * 0.0025 * zoom));
  const maxRadius = Math.max(minRadius + 4, Math.round(longSide * 0.009 * zoom));

  const source = cv.matFromArray(image.height, image.width, cv.CV_8UC1, image.gray);
  const blurred = new cv.Mat();
  const circles = new cv.Mat();
  const found: Array<{ x: number; y: number; r: number }> = [];
  try {
    cv.GaussianBlur(source, blurred, new cv.Size(3, 3), 0);
    cv.HoughCircles(
      blurred,
      circles,
      cv.HOUGH_GRADIENT,
      1,
      minRadius * 1.8,
      120,
      45,
      minRadius,
      maxRadius,
    );
    for (let index = 0; index < circles.cols; index += 1) {
      found.push({
        x: circles.data32F[index * 3],
        y: circles.data32F[index * 3 + 1],
        r: circles.data32F[index * 3 + 2],
      });
    }
  } finally {
    source.delete();
    blurred.delete();
    circles.delete();
  }
  if (found.length === 0) return [];

  const workerCount = Math.max(
    1,
    Math.min(4, (typeof navigator !== "undefined" ? navigator.hardwareConcurrency : 2) - 1),
  );
  progress?.(`Reading ${found.length} possible grid bubbles…`);
  const workers = await createOcrWorkers(workerCount);
  try {
    await Promise.all(
      workers.map((worker) =>
        worker.setParameters({
          tessedit_char_whitelist: OCR_WHITELIST,
          tessedit_pageseg_mode: "7",
        }),
      ),
    );
    const variants: Array<{ keep: number; masked: boolean }> = [
      { keep: 0.72, masked: false },
      { keep: 0.8, masked: true },
    ];
    const results: Array<Set<string>> = found.map(() => new Set<string>());
    const jobs = found.flatMap((circle, circleIndex) =>
      variants.map((variant) => ({ circle, circleIndex, variant })),
    );
    let next = 0;
    let done = 0;
    await Promise.all(
      workers.map(async (worker) => {
        while (next < jobs.length) {
          const job = jobs[next];
          next += 1;
          const crop = cropBubble(
            image,
            job.circle.x,
            job.circle.y,
            job.circle.r,
            job.variant.keep,
            job.variant.masked,
          );
          const { data } = await worker.recognize(crop);
          const label = normalizeLabel(data.text);
          if (label) results[job.circleIndex].add(label);
          done += 1;
          if (done % 40 === 0) progress?.(`Reading grid bubbles… ${Math.round((done / jobs.length) * 100)}%`);
        }
      }),
    );
    return found
      .map((circle, index) => ({
        labels: [...results[index]],
        x: circle.x / zoom,
        y: circle.y / zoom,
        radius: circle.r / zoom,
      }))
      .filter((bubble) => bubble.labels.length > 0);
  } finally {
    await Promise.all(workers.map((worker) => worker.terminate()));
  }
}

// ---------------------------------------------------------------- fitting

type Constraint = {
  point: number;
  label: string;
  coefficients: [number, number, number, number];
  value: number;
  direction: number;
};

function solveLeastSquares(rows: Constraint[]) {
  const normal = [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ];
  const rhs = [0, 0, 0, 0];
  for (const row of rows) {
    for (let i = 0; i < 4; i += 1) {
      rhs[i] += row.coefficients[i] * row.value;
      for (let j = 0; j < 4; j += 1) normal[i][j] += row.coefficients[i] * row.coefficients[j];
    }
  }
  const augmented = normal.map((row, index) => [...row, rhs[index]]);
  for (let column = 0; column < 4; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < 4; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    }
    if (Math.abs(augmented[pivot][column]) < 1e-9) return null;
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    const divisor = augmented[column][column];
    for (let k = column; k <= 4; k += 1) augmented[column][k] /= divisor;
    for (let row = 0; row < 4; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      for (let k = column; k <= 4; k += 1) augmented[row][k] -= factor * augmented[column][k];
    }
  }
  return augmented.map((row) => row[4]) as [number, number, number, number];
}

/**
 * Fit p -> (a·x − b·y + tx, b·x + a·y + ty) so each point lies on the same-named line.
 * Returns parameters and the inlier constraints (best one per point).
 */
function fitPointsToLines(
  lines: GridLine[],
  points: GridBubble[],
  tolerance: number,
  expectedScale?: number,
) {
  const rows: Constraint[] = [];
  points.forEach((point, pointIndex) => {
    for (const line of lines) {
      if (line.directionScore < MIN_DIRECTION_SCORE) continue;
      const label = line.labels[0];
      if (!point.labels.includes(label)) continue;
      const theta = (line.directionDegrees * Math.PI) / 180;
      const nx = -Math.sin(theta);
      const ny = Math.cos(theta);
      rows.push({
        point: pointIndex,
        label,
        coefficients: [nx * point.x + ny * point.y, -nx * point.y + ny * point.x, nx, ny],
        value: nx * line.x + ny * line.y,
        direction: Math.round((((line.directionDegrees % 180) + 180) % 180) / 15) % 12,
      });
    }
  });
  if (rows.length < 4) return null;

  const residual = (p: number[], row: Constraint) =>
    Math.abs(
      row.coefficients[0] * p[0] +
        row.coefficients[1] * p[1] +
        row.coefficients[2] * p[2] +
        row.coefficients[3] * p[3] -
        row.value,
    );
  const inliersOf = (p: number[]) => {
    const best = new Map<number, { error: number; row: Constraint }>();
    for (const row of rows) {
      const error = residual(p, row);
      if (error < tolerance) {
        const current = best.get(row.point);
        if (!current || error < current.error) best.set(row.point, { error, row });
      }
    }
    return best;
  };
  const scaleOk = (p: number[]) => {
    const scale = Math.hypot(p[0], p[1]);
    if (!(scale > 0.05 && scale < 20)) return false;
    if (!expectedScale) return true;
    return Math.abs(Math.log(scale / expectedScale)) < Math.log(MAX_SCALE_DEVIATION);
  };

  let seed = 0x9e3779b9;
  const random = (maximum: number) => {
    seed = Math.imul(seed ^ (seed >>> 15), seed | 1);
    seed ^= seed + Math.imul(seed ^ (seed >>> 7), seed | 61);
    return ((seed ^ (seed >>> 14)) >>> 0) % maximum;
  };

  let bestLabels = 0;
  let bestInliers: Map<number, { error: number; row: Constraint }> | null = null;
  for (let iteration = 0; iteration < RANSAC_ITERATIONS; iteration += 1) {
    const sample: Constraint[] = [];
    const usedPoints = new Set<number>();
    const usedLabels = new Set<string>();
    for (let attempt = 0; attempt < 20 && sample.length < 4; attempt += 1) {
      const row = rows[random(rows.length)];
      if (usedPoints.has(row.point) || usedLabels.has(row.label)) continue;
      usedPoints.add(row.point);
      usedLabels.add(row.label);
      sample.push(row);
    }
    if (sample.length < 4) continue;
    const parameters = solveLeastSquares(sample);
    if (!parameters || !scaleOk(parameters)) continue;
    const inliers = inliersOf(parameters);
    const labels = new Set([...inliers.values()].map((entry) => entry.row.label)).size;
    if (labels > bestLabels) {
      bestLabels = labels;
      bestInliers = inliers;
    }
  }
  if (!bestInliers || bestInliers.size < 4) return null;

  let parameters: [number, number, number, number] | null = null;
  let inliers = bestInliers;
  for (let refinement = 0; refinement < 3; refinement += 1) {
    parameters = solveLeastSquares([...inliers.values()].map((entry) => entry.row));
    if (!parameters || !scaleOk(parameters)) return null;
    const next = inliersOf(parameters);
    if (next.size < 4) return null;
    inliers = next;
  }
  if (!parameters) return null;
  const errors = [...inliers.values()].map((entry) => entry.error).sort((a, b) => a - b);
  return {
    parameters,
    inliers: [...inliers.values()].map((entry) => entry.row),
    medianResidual: errors[Math.floor(errors.length / 2)],
  };
}

// ---------------------------------------------------------------- public entry

async function collectBubbles(
  cv: CV,
  page: PDFPageProxy,
  needsLines: boolean,
  progress?: GridProgress,
) {
  const text = await textGridBubbles(page);
  const useText = text.length >= MIN_TEXT_BUBBLES;
  if (useText && !needsLines) return { bubbles: text, source: "text" as const, image: null };
  const image = await renderGray(page, detectionZoom(page));
  const bubbles = useText ? text : await ocrGridBubbles(cv, page, image, progress);
  return { bubbles, source: useText ? ("text" as const) : ("ocr" as const), image };
}

/**
 * Register the shop page to the engineer page using the shared grid system.
 * Throws an Error with a reviewer-facing reason when the grid is not usable.
 */
export async function registerByGrid(
  cv: CV,
  engineerPage: PDFPageProxy,
  shopPage: PDFPageProxy,
  expectedScale: number | undefined,
  progress?: GridProgress,
): Promise<GridRegistration> {
  progress?.("Finding grid bubbles…");
  const engineerHasText = (await textGridBubbles(engineerPage)).length >= MIN_TEXT_BUBBLES;
  const shopHasText = (await textGridBubbles(shopPage)).length >= MIN_TEXT_BUBBLES;
  // Grid-line directions come from a sheet with text-layer bubbles when possible.
  const linesFromEngineer = engineerHasText || !shopHasText;

  const engineer = await collectBubbles(cv, engineerPage, linesFromEngineer, progress);
  const shop = await collectBubbles(cv, shopPage, !linesFromEngineer, progress);
  if (engineer.bubbles.length < 4 || shop.bubbles.length < 4) {
    throw new Error(
      `Not enough grid bubbles were found (engineer: ${engineer.bubbles.length}, shop: ${shop.bubbles.length}).`,
    );
  }

  progress?.("Tracing grid lines…");
  const lineSide = linesFromEngineer ? engineer : shop;
  const pointSide = linesFromEngineer ? shop : engineer;
  if (!lineSide.image) throw new Error("Grid line tracing needs a rendered page.");
  const lines = measureDirections(lineSide.bubbles, lineSide.image);
  const lineRadius =
    lines.map((line) => line.radius).sort((a, b) => a - b)[Math.floor(lines.length / 2)] ?? 10;

  progress?.("Fitting grid alignment…");
  // Expected scale is shop→engineer; flip it when the engineer sheet supplies the points.
  const scaleForFit = expectedScale
    ? linesFromEngineer
      ? expectedScale
      : 1 / expectedScale
    : undefined;
  const fit = fitPointsToLines(lines, pointSide.bubbles, lineRadius * 0.5, scaleForFit);
  if (!fit) {
    throw new Error(
      "The grid bubbles on the two sheets could not be matched to a consistent alignment.",
    );
  }

  const labels = [...new Set(fit.inliers.map((row) => row.label))].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true }),
  );
  const directions = new Set(fit.inliers.map((row) => row.direction)).size;
  if (
    labels.length < MIN_MATCHED_LABELS ||
    directions < MIN_LINE_DIRECTIONS ||
    fit.medianResidual > lineRadius * 0.2
  ) {
    throw new Error(
      `Grid alignment confidence is too low (${labels.length} grid lines matched in ${directions} direction${directions === 1 ? "" : "s"}).`,
    );
  }

  let [a, b, tx, ty] = fit.parameters;
  if (!linesFromEngineer) {
    // The fit mapped engineer -> shop; invert the similarity to get shop -> engineer.
    const s2 = a * a + b * b;
    const ia = a / s2;
    const ib = -b / s2;
    const itx = -(ia * tx - ib * ty);
    const ity = -(ib * tx + ia * ty);
    [a, b, tx, ty] = [ia, ib, itx, ity];
  }
  return {
    matrix: [a, -b, tx, b, a, ty],
    scale: Math.hypot(a, b),
    rotationDegrees: (Math.atan2(b, a) * 180) / Math.PI,
    matchedBubbles: fit.inliers.length,
    gridLabels: labels,
    lineDirections: directions,
    medianResidualPt: fit.medianResidual,
    engineerBubbleSource: engineer.source,
    shopBubbleSource: shop.source,
    engineerBubbles: engineer.bubbles.length,
    shopBubbles: shop.bubbles.length,
  };
}

/**
 * Red/blue overlay of the two sheets in engineer-page space:
 * red = engineer only, blue = shop only, black = both.
 */
export async function renderGridOverlay(
  cv: CV,
  engineerPage: PDFPageProxy,
  shopPage: PDFPageProxy,
  registration: GridRegistration,
  maxDimension = 4000,
) {
  const engineerViewport = engineerPage.getViewport({ scale: 1 });
  const zoom = maxDimension / Math.max(engineerViewport.width, engineerViewport.height);
  const shopZoom = Math.min(zoom / registration.scale, MAX_DETECTION_PIXELS /
    Math.max(shopPage.getViewport({ scale: 1 }).width, shopPage.getViewport({ scale: 1 }).height));
  const [engineerImage, shopImage] = await Promise.all([
    renderGray(engineerPage, zoom),
    renderGray(shopPage, shopZoom),
  ]);
  const [a, nb, tx, b, , ty] = registration.matrix;
  // shop pixels -> shop points (/shopZoom) -> engineer points -> engineer pixels (*zoom)
  const k = zoom / shopZoom;
  const source = cv.matFromArray(shopImage.height, shopImage.width, cv.CV_8UC1, shopImage.gray);
  const warped = new cv.Mat();
  const affine = cv.matFromArray(2, 3, cv.CV_64FC1, [
    a * k,
    nb * k,
    tx * zoom,
    b * k,
    a * k,
    ty * zoom,
  ]);
  try {
    cv.warpAffine(
      source,
      warped,
      affine,
      new cv.Size(engineerImage.width, engineerImage.height),
      cv.INTER_AREA,
      cv.BORDER_CONSTANT,
      new cv.Scalar(255),
    );
    const canvas = document.createElement("canvas");
    canvas.width = engineerImage.width;
    canvas.height = engineerImage.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser could not create the overlay canvas.");
    const output = context.createImageData(canvas.width, canvas.height);
    const shopGray = warped.data;
    for (let index = 0; index < engineerImage.gray.length; index += 1) {
      const engineerInk = engineerImage.gray[index] < 160;
      const shopInk = shopGray[index] < 160;
      const pixel = index * 4;
      const [r, g, bl] = engineerInk && shopInk
        ? [30, 30, 30]
        : engineerInk
          ? [220, 40, 40]
          : shopInk
            ? [20, 120, 220]
            : [255, 255, 255];
      output.data[pixel] = r;
      output.data[pixel + 1] = g;
      output.data[pixel + 2] = bl;
      output.data[pixel + 3] = 255;
    }
    context.putImageData(output, 0, 0);
    return canvas;
  } finally {
    source.delete();
    warped.delete();
    affine.delete();
  }
}
