import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import cvModule from "@techstark/opencv-js";
import type { CV } from "@techstark/opencv-js";

export type DifferenceRegion = {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  changedPixels: number;
};

export type RegistrationSummary = {
  inliers: number;
  matchedFeatures: number;
  inlierPercent: number;
  scale: number;
  rotationDegrees: number;
  reprojectionError: number;
};

export type PdfComparison = {
  engineerPreview: string;
  shopPreview: string;
  width: number;
  height: number;
  registration: RegistrationSummary;
  engineerPageCount: number;
  shopPageCount: number;
  engineerPageNumber: number;
  shopPageNumber: number;
  regions: DifferenceRegion[];
  markedPdf: Uint8Array;
};

type RenderedPage = {
  canvas: HTMLCanvasElement;
  pageWidth: number;
  pageHeight: number;
  pageCount: number;
};

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const MAX_RENDER_DIMENSION = 1800;
const TILE_SIZE = 16;
const PIXEL_LEVEL_TOLERANCE = 28;
const MIN_TILE_DIFFERENCES = 6;
const MIN_REGION_DIFFERENCES = 40;
const MIN_REGISTRATION_INLIERS = 20;
const MIN_REGISTRATION_INLIER_PERCENT = 0.35;
const MIN_MATCH_COVERAGE = 0.005;
const MIN_MATCH_GRID_CELLS = 4;

async function loadPdf(file: File) {
  if (file.size > MAX_FILE_SIZE) {
    throw new Error(`${file.name} exceeds the 50 MB local comparison limit.`);
  }
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();

  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
  });
  return loadingTask;
}

export async function getPdfPageCount(file: File) {
  const loadingTask = await loadPdf(file);
  try {
    const document = await loadingTask.promise;
    return document.numPages;
  } finally {
    await loadingTask.destroy();
  }
}

async function renderPage(file: File, pageNumber: number): Promise<RenderedPage> {
  const loadingTask = await loadPdf(file);
  try {
    const document = await loadingTask.promise;
    if (
      !Number.isInteger(pageNumber) ||
      pageNumber < 1 ||
      pageNumber > document.numPages
    ) {
      throw new Error(`Page ${pageNumber} does not exist in ${file.name}.`);
    }
    const page = await document.getPage(pageNumber);
    const baseViewport = page.getViewport({ scale: 1 });
    const scale =
      MAX_RENDER_DIMENSION / Math.max(baseViewport.width, baseViewport.height);
    const viewport = page.getViewport({ scale });
    const canvas = window.document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext("2d", { willReadFrequently: true });

    if (!context) {
      throw new Error("This browser could not create a canvas for PDF comparison.");
    }

    await page.render({ canvas, canvasContext: context, viewport }).promise;
    return {
      canvas,
      pageWidth: baseViewport.width,
      pageHeight: baseViewport.height,
      pageCount: document.numPages,
    };
  } finally {
    await loadingTask.destroy();
  }
}

async function loadOpenCv() {
  const module = cvModule as unknown as {
    default?: unknown;
    "module.exports"?: unknown;
  };
  const candidates = [module.default, module["module.exports"], module, cvModule];

  for (const candidate of candidates) {
    let runtime: unknown = candidate;
    if (runtime instanceof Promise) {
      runtime = await runtime;
    }
    if (
      typeof runtime === "object" &&
      runtime !== null &&
      "Mat" in runtime &&
      "imread" in runtime
    ) {
      return runtime as CV;
    }
  }

  throw new Error("The browser could not initialize the PDF alignment engine.");
}

function pointCoverage(
  points: Array<{ x: number; y: number }>,
  width: number,
  height: number,
) {
  if (points.length === 0) return 0;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const spanX = Math.max(...xs) - Math.min(...xs);
  const spanY = Math.max(...ys) - Math.min(...ys);
  return (spanX * spanY) / (width * height);
}

function occupiedGridCells(
  points: Array<{ x: number; y: number }>,
  width: number,
  height: number,
) {
  const gridSize = 4;
  const occupiedCells = new Set<number>();
  for (const point of points) {
    const column = Math.min(
      gridSize - 1,
      Math.floor((point.x / width) * gridSize),
    );
    const row = Math.min(
      gridSize - 1,
      Math.floor((point.y / height) * gridSize),
    );
    occupiedCells.add(row * gridSize + column);
  }
  return occupiedCells.size;
}

type MatchedFeature = {
  source: { x: number; y: number };
  destination: { x: number; y: number };
};

type AffineTransform = {
  a: number;
  b: number;
  c: number;
  d: number;
  tx: number;
  ty: number;
};

function mapPoint(transform: AffineTransform, point: { x: number; y: number }) {
  return {
    x: transform.a * point.x + transform.c * point.y + transform.tx,
    y: transform.b * point.x + transform.d * point.y + transform.ty,
  };
}

function solveLinearSystem(matrix: number[][], values: number[]) {
  const size = values.length;
  const augmented = matrix.map((row, index) => [...row, values[index]]);

  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) {
        pivot = row;
      }
    }
    if (Math.abs(augmented[pivot][column]) < 1e-8) return null;
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];

    const divisor = augmented[column][column];
    for (let index = column; index <= size; index += 1) {
      augmented[column][index] /= divisor;
    }
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      for (let index = column; index <= size; index += 1) {
        augmented[row][index] -= factor * augmented[column][index];
      }
    }
  }

  return augmented.map((row) => row[size]);
}

function fitAffineTransform(points: MatchedFeature[]): AffineTransform | null {
  if (points.length < 3) return null;
  const normalMatrix = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const xValues = [0, 0, 0];
  const yValues = [0, 0, 0];
  for (const point of points) {
    const basis = [point.source.x, point.source.y, 1];
    for (let row = 0; row < 3; row += 1) {
      xValues[row] += basis[row] * point.destination.x;
      yValues[row] += basis[row] * point.destination.y;
      for (let column = 0; column < 3; column += 1) {
        normalMatrix[row][column] += basis[row] * basis[column];
      }
    }
  }
  const xCoefficients = solveLinearSystem(normalMatrix, xValues);
  const yCoefficients = solveLinearSystem(normalMatrix, yValues);
  if (!xCoefficients || !yCoefficients) return null;
  return {
    a: xCoefficients[0],
    c: xCoefficients[1],
    tx: xCoefficients[2],
    b: yCoefficients[0],
    d: yCoefficients[1],
    ty: yCoefficients[2],
  };
}

function estimateAffineTransform(points: MatchedFeature[]) {
  let bestInliers: number[] = [];
  let bestSquaredError = Number.POSITIVE_INFINITY;
  let randomState = 0x6d2b79f5;
  const nextIndex = (maximum: number) => {
    randomState = Math.imul(randomState ^ (randomState >>> 15), randomState | 1);
    randomState ^= randomState + Math.imul(randomState ^ (randomState >>> 7), randomState | 61);
    return ((randomState ^ (randomState >>> 14)) >>> 0) % maximum;
  };

  for (let iteration = 0; iteration < 1400; iteration += 1) {
    const first = nextIndex(points.length);
    let second = nextIndex(points.length);
    while (second === first) second = nextIndex(points.length);
    let third = nextIndex(points.length);
    while (third === first || third === second) third = nextIndex(points.length);
    const sample = [points[first], points[second], points[third]];
    const [pointA, pointB, pointC] = sample.map((point) => point.source);
    const triangleArea = Math.abs(
      (pointB.x - pointA.x) * (pointC.y - pointA.y) -
        (pointB.y - pointA.y) * (pointC.x - pointA.x),
    );
    if (triangleArea < 400) continue;

    const transform = fitAffineTransform(sample);
    if (!transform) continue;
    const inliers: number[] = [];
    let squaredError = 0;

    for (let index = 0; index < points.length; index += 1) {
      const mapped = mapPoint(transform, points[index].source);
      const dx = mapped.x - points[index].destination.x;
      const dy = mapped.y - points[index].destination.y;
      const error = dx * dx + dy * dy;
      if (error <= 16) {
        inliers.push(index);
        squaredError += error;
      }
    }

    if (
      inliers.length > bestInliers.length ||
      (inliers.length === bestInliers.length && squaredError < bestSquaredError)
    ) {
      bestInliers = inliers;
      bestSquaredError = squaredError;
    }
  }

  let refinedInliers = bestInliers;
  let refinedTransform: AffineTransform | null = null;
  for (let refinement = 0; refinement < 5; refinement += 1) {
    refinedTransform = fitAffineTransform(
      refinedInliers.map((index) => points[index]),
    );
    if (!refinedTransform) return null;
    const nextInliers: number[] = [];
    for (let index = 0; index < points.length; index += 1) {
      const mapped = mapPoint(refinedTransform, points[index].source);
      const dx = mapped.x - points[index].destination.x;
      const dy = mapped.y - points[index].destination.y;
      if (dx * dx + dy * dy <= 16) nextInliers.push(index);
    }
    if (nextInliers.length < 2) return null;
    if (
      nextInliers.length === refinedInliers.length &&
      nextInliers.every((index, position) => index === refinedInliers[position])
    ) {
      break;
    }
    refinedInliers = nextInliers;
  }

  refinedTransform = fitAffineTransform(
    refinedInliers.map((index) => points[index]),
  );
  if (!refinedTransform) return null;
  let squaredError = 0;
  for (const index of refinedInliers) {
    const mapped = mapPoint(refinedTransform, points[index].source);
    const dx = mapped.x - points[index].destination.x;
    const dy = mapped.y - points[index].destination.y;
    squaredError += dx * dx + dy * dy;
  }

  return {
    transform: refinedTransform,
    inlierIndices: refinedInliers,
    reprojectionError: Math.sqrt(
      squaredError / Math.max(1, refinedInliers.length),
    ),
  };
}

async function alignShopPage(
  engineerCanvas: HTMLCanvasElement,
  shopCanvas: HTMLCanvasElement,
): Promise<{ canvas: HTMLCanvasElement; registration: RegistrationSummary }> {
  const cv = await loadOpenCv();
  const engineerImage = cv.imread(engineerCanvas);
  const shopImage = cv.imread(shopCanvas);
  const engineerGray = new cv.Mat();
  const shopGray = new cv.Mat();
  const engineerKeypoints = new cv.KeyPointVector();
  const shopKeypoints = new cv.KeyPointVector();
  const engineerDescriptors = new cv.Mat();
  const shopDescriptors = new cv.Mat();
  const matches = new cv.DMatchVectorVector();
  const reverseMatches = new cv.DMatchVectorVector();
  const matcher = new cv.BFMatcher(cv.NORM_HAMMING, false);
  const emptyMask = new cv.Mat();
  let detector: InstanceType<typeof cv.ORB> | undefined;
  let aligned: InstanceType<typeof cv.Mat> | undefined;
  let affine: InstanceType<typeof cv.Mat> | undefined;

  try {
    cv.cvtColor(engineerImage, engineerGray, cv.COLOR_RGBA2GRAY);
    cv.cvtColor(shopImage, shopGray, cv.COLOR_RGBA2GRAY);
    detector = new cv.ORB(8000, 1.2, 8, 31, 0, 2, cv.ORB_HARRIS_SCORE, 31, 7);
    detector.detectAndCompute(
      engineerGray,
      emptyMask,
      engineerKeypoints,
      engineerDescriptors,
    );
    detector.detectAndCompute(
      shopGray,
      emptyMask,
      shopKeypoints,
      shopDescriptors,
    );

    if (engineerDescriptors.empty() || shopDescriptors.empty()) {
      throw new Error(
        "Could not find enough visual features to align these pages. Use drawings with more shared visible detail.",
      );
    }

    matcher.knnMatch(shopDescriptors, engineerDescriptors, matches, 2);
    matcher.knnMatch(engineerDescriptors, shopDescriptors, reverseMatches, 2);
    const reverseBestMatches = new Map<number, number>();
    for (let index = 0; index < reverseMatches.size(); index += 1) {
      const pair = reverseMatches.get(index);
      if (pair.size() < 2) continue;
      const best = pair.get(0);
      const second = pair.get(1);
      if (best.distance < second.distance * 0.75) {
        reverseBestMatches.set(best.queryIdx, best.trainIdx);
      }
    }
    const matchedFeatures: MatchedFeature[] = [];

    for (let index = 0; index < matches.size(); index += 1) {
      const pair = matches.get(index);
      if (pair.size() >= 2) {
        const best = pair.get(0);
        const second = pair.get(1);
        if (
          best.distance < second.distance * 0.75 &&
          reverseBestMatches.get(best.trainIdx) === best.queryIdx
        ) {
          const source = shopKeypoints.get(best.queryIdx).pt;
          const destination = engineerKeypoints.get(best.trainIdx).pt;
          matchedFeatures.push({
            source: { x: source.x, y: source.y },
            destination: { x: destination.x, y: destination.y },
          });
        }
      }
    }

    if (matchedFeatures.length < MIN_REGISTRATION_INLIERS) {
      throw new Error(
        "Could not find enough matching features to align the pages. Make sure both drawings show the same plan area.",
      );
    }

    const estimate = estimateAffineTransform(matchedFeatures);
    if (!estimate) {
      throw new Error(
        "Could not compute a reliable page alignment. Use drawings with more shared visible detail.",
      );
    }

    const inlierFeatures = estimate.inlierIndices.map(
      (index) => matchedFeatures[index],
    );
    const inlierSourcePoints = inlierFeatures.map((point) => point.source);
    const inlierDestinationPoints = inlierFeatures.map(
      (point) => point.destination,
    );
    const inliers = estimate.inlierIndices.length;
    const inlierPercent = inliers / matchedFeatures.length;
    const scaleX = Math.hypot(estimate.transform.a, estimate.transform.b);
    const scaleY = Math.hypot(estimate.transform.c, estimate.transform.d);
    const scale = Math.sqrt(Math.abs(
      estimate.transform.a * estimate.transform.d -
        estimate.transform.b * estimate.transform.c,
    ));
    const rotationDegrees =
      (Math.atan2(estimate.transform.b, estimate.transform.a) * 180) / Math.PI;
    const reprojectionError = estimate.reprojectionError;
    const sourceCoverage = pointCoverage(
      inlierSourcePoints,
      shopCanvas.width,
      shopCanvas.height,
    );
    const destinationCoverage = pointCoverage(
      inlierDestinationPoints,
      engineerCanvas.width,
      engineerCanvas.height,
    );
    const sourceGridCells = occupiedGridCells(
      inlierSourcePoints,
      shopCanvas.width,
      shopCanvas.height,
    );
    const destinationGridCells = occupiedGridCells(
      inlierDestinationPoints,
      engineerCanvas.width,
      engineerCanvas.height,
    );
    const validTransform =
      Number.isFinite(estimate.transform.a) &&
      Number.isFinite(estimate.transform.b) &&
      Number.isFinite(estimate.transform.c) &&
      Number.isFinite(estimate.transform.d) &&
      Number.isFinite(estimate.transform.tx) &&
      Number.isFinite(estimate.transform.ty) &&
      Number.isFinite(scale) &&
      scaleX >= 0.05 &&
      scaleX <= 20 &&
      scaleY >= 0.05 &&
      scaleY <= 20 &&
      Math.max(scaleX, scaleY) / Math.min(scaleX, scaleY) <= 4 &&
      estimate.transform.a * estimate.transform.d -
        estimate.transform.b * estimate.transform.c >
        0;

    if (
      !validTransform ||
      inliers < MIN_REGISTRATION_INLIERS ||
      inlierPercent < MIN_REGISTRATION_INLIER_PERCENT ||
      sourceCoverage < MIN_MATCH_COVERAGE ||
      destinationCoverage < MIN_MATCH_COVERAGE ||
      sourceGridCells < MIN_MATCH_GRID_CELLS ||
      destinationGridCells < MIN_MATCH_GRID_CELLS ||
      reprojectionError > 4
    ) {
      throw new Error(
        `Automatic alignment confidence is too low (${inliers} consistent features, ${Math.round(inlierPercent * 100)}% inliers). Use a clearer pair with more shared drawing content.`,
      );
    }

    affine = cv.matFromArray(2, 3, cv.CV_64FC1, [
      estimate.transform.a,
      estimate.transform.c,
      estimate.transform.tx,
      estimate.transform.b,
      estimate.transform.d,
      estimate.transform.ty,
    ]);
    aligned = new cv.Mat();
    cv.warpAffine(
      shopImage,
      aligned,
      affine,
      new cv.Size(engineerCanvas.width, engineerCanvas.height),
      cv.INTER_LINEAR,
      cv.BORDER_CONSTANT,
      new cv.Scalar(255, 255, 255, 255),
    );
    const canvas = window.document.createElement("canvas");
    canvas.width = engineerCanvas.width;
    canvas.height = engineerCanvas.height;
    cv.imshow(canvas, aligned);
    return {
      canvas,
      registration: {
        inliers,
        matchedFeatures: matchedFeatures.length,
        inlierPercent,
        scale,
        rotationDegrees,
        reprojectionError,
      },
    };
  } finally {
    engineerImage.delete();
    shopImage.delete();
    engineerGray.delete();
    shopGray.delete();
    engineerKeypoints.delete();
    shopKeypoints.delete();
    engineerDescriptors.delete();
    shopDescriptors.delete();
    matches.delete();
    reverseMatches.delete();
    matcher.delete();
    emptyMask.delete();
    detector?.delete();
    aligned?.delete();
    affine?.delete();
  }
}

function findDifferenceRegions(
  engineer: ImageData,
  shop: ImageData,
): DifferenceRegion[] {
  const columns = Math.ceil(engineer.width / TILE_SIZE);
  const rows = Math.ceil(engineer.height / TILE_SIZE);
  const tileCounts = new Uint32Array(columns * rows);
  const engineerPixels = engineer.data;
  const shopPixels = shop.data;

  for (let y = 0; y < engineer.height; y += 1) {
    for (let x = 0; x < engineer.width; x += 1) {
      const pixel = (y * engineer.width + x) * 4;
      const engineerLevel =
        0.299 * engineerPixels[pixel] +
        0.587 * engineerPixels[pixel + 1] +
        0.114 * engineerPixels[pixel + 2];
      let minimumShopLevel = 255;
      let maximumShopLevel = 0;

      for (let yOffset = -1; yOffset <= 1; yOffset += 1) {
        const neighborY = y + yOffset;
        if (neighborY < 0 || neighborY >= shop.height) continue;
        for (let xOffset = -1; xOffset <= 1; xOffset += 1) {
          const neighborX = x + xOffset;
          if (neighborX < 0 || neighborX >= shop.width) continue;
          const neighbor = (neighborY * shop.width + neighborX) * 4;
          const shopLevel =
            0.299 * shopPixels[neighbor] +
            0.587 * shopPixels[neighbor + 1] +
            0.114 * shopPixels[neighbor + 2];
          minimumShopLevel = Math.min(minimumShopLevel, shopLevel);
          maximumShopLevel = Math.max(maximumShopLevel, shopLevel);
        }
      }

      if (
        engineerLevel < minimumShopLevel - PIXEL_LEVEL_TOLERANCE ||
        engineerLevel > maximumShopLevel + PIXEL_LEVEL_TOLERANCE
      ) {
        const tile = Math.floor(y / TILE_SIZE) * columns + Math.floor(x / TILE_SIZE);
        tileCounts[tile] += 1;
      }
    }
  }

  const visited = new Uint8Array(tileCounts.length);
  const regions: DifferenceRegion[] = [];

  for (let start = 0; start < tileCounts.length; start += 1) {
    if (
      visited[start] ||
      tileCounts[start] < MIN_TILE_DIFFERENCES
    ) {
      continue;
    }

    const queue = [start];
    visited[start] = 1;
    let minColumn = columns;
    let maxColumn = 0;
    let minRow = rows;
    let maxRow = 0;
    let changedPixels = 0;

    while (queue.length > 0) {
      const tile = queue.pop()!;
      const column = tile % columns;
      const row = Math.floor(tile / columns);
      minColumn = Math.min(minColumn, column);
      maxColumn = Math.max(maxColumn, column);
      minRow = Math.min(minRow, row);
      maxRow = Math.max(maxRow, row);
      changedPixels += tileCounts[tile];

      for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
        for (let columnOffset = -1; columnOffset <= 1; columnOffset += 1) {
          if (rowOffset === 0 && columnOffset === 0) continue;
          if (rowOffset !== 0 && columnOffset !== 0) continue;
          const nextColumn = column + columnOffset;
          const nextRow = row + rowOffset;
          if (
            nextColumn < 0 ||
            nextColumn >= columns ||
            nextRow < 0 ||
            nextRow >= rows
          ) {
            continue;
          }
          const next = nextRow * columns + nextColumn;
          if (!visited[next] && tileCounts[next] >= MIN_TILE_DIFFERENCES) {
            visited[next] = 1;
            queue.push(next);
          }
        }
      }
    }

    if (changedPixels < MIN_REGION_DIFFERENCES) continue;
    const x = minColumn * TILE_SIZE;
    const y = minRow * TILE_SIZE;
    const width =
      Math.min(engineer.width, (maxColumn + 1) * TILE_SIZE) - x;
    const height =
      Math.min(engineer.height, (maxRow + 1) * TILE_SIZE) - y;
    const area = width * height;
    if (
      area >= engineer.width * engineer.height * 0.2 &&
      changedPixels / area < 0.02
    ) {
      continue;
    }
    regions.push({
      id: regions.length + 1,
      x,
      y,
      width,
      height,
      changedPixels,
    });
  }

  return regions.sort((a, b) => b.changedPixels - a.changedPixels);
}

async function createMarkedPdf(
  alignedShopCanvas: HTMLCanvasElement,
  regions: DifferenceRegion[],
  renderedWidth: number,
  renderedHeight: number,
  pageWidth: number,
  pageHeight: number,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([pageWidth, pageHeight]);
  const drawing = await pdf.embedPng(alignedShopCanvas.toDataURL("image/png"));
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);
  const red = rgb(0.82, 0.12, 0.12);

  page.drawImage(drawing, {
    x: 0,
    y: 0,
    width: pageWidth,
    height: pageHeight,
  });

  regions.forEach((region) => {
    const x = (region.x / renderedWidth) * pageWidth;
    const y = pageHeight - ((region.y + region.height) / renderedHeight) * pageHeight;
    const width = (region.width / renderedWidth) * pageWidth;
    const height = (region.height / renderedHeight) * pageHeight;
    const inset = 2;
    const rectangleX = Math.max(0, x - inset);
    const rectangleY = Math.max(0, y - inset);

    page.drawRectangle({
      x: rectangleX,
      y: rectangleY,
      width: Math.min(pageWidth - rectangleX, x + width + inset - rectangleX),
      height: Math.min(pageHeight - rectangleY, y + height + inset - rectangleY),
      color: red,
      opacity: 0.16,
      borderColor: red,
      borderWidth: 1.5,
    });
    page.drawText(`DIFF ${region.id}`, {
      x: Math.max(0, x),
      y: Math.min(pageHeight - 10, y + height + 3),
      size: 8,
      font,
      color: red,
    });
  });

  if (regions.length === 0) {
    page.drawText("No candidate changes above the visual-difference threshold.", {
      x: 18,
      y: pageHeight - 28,
      size: 9,
      font,
      color: red,
    });
  }

  return pdf.save();
}

export async function comparePdfPages(
  engineerFile: File,
  shopFile: File,
  engineerPageNumber: number,
  shopPageNumber: number,
): Promise<PdfComparison> {
  const [engineer, shop] = await Promise.all([
    renderPage(engineerFile, engineerPageNumber),
    renderPage(shopFile, shopPageNumber),
  ]);

  const { canvas: alignedShopCanvas, registration } = await alignShopPage(
    engineer.canvas,
    shop.canvas,
  );

  const engineerContext = engineer.canvas.getContext("2d", {
    willReadFrequently: true,
  });
  const alignedShopContext = alignedShopCanvas.getContext("2d", {
    willReadFrequently: true,
  });
  if (!engineerContext || !alignedShopContext) {
    throw new Error("This browser could not read the rendered PDF pages.");
  }

  const regions = findDifferenceRegions(
    engineerContext.getImageData(0, 0, engineer.canvas.width, engineer.canvas.height),
    alignedShopContext.getImageData(
      0,
      0,
      alignedShopCanvas.width,
      alignedShopCanvas.height,
    ),
  );
  const markedPdf = await createMarkedPdf(
    alignedShopCanvas,
    regions,
    alignedShopCanvas.width,
    alignedShopCanvas.height,
    engineer.pageWidth,
    engineer.pageHeight,
  );

  return {
    engineerPreview: engineer.canvas.toDataURL("image/png"),
    shopPreview: alignedShopCanvas.toDataURL("image/png"),
    width: alignedShopCanvas.width,
    height: alignedShopCanvas.height,
    registration,
    engineerPageCount: engineer.pageCount,
    shopPageCount: shop.pageCount,
    engineerPageNumber,
    shopPageNumber,
    regions,
    markedPdf,
  };
}

export function comparePdfFirstPages(
  engineerFile: File,
  shopFile: File,
): Promise<PdfComparison> {
  return comparePdfPages(engineerFile, shopFile, 1, 1);
}
