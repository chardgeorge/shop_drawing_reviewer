"use client";

import { useEffect, useState } from "react";
import {
  comparePdfMembers,
  comparePdfPages,
  getPdfPageCount,
} from "@/lib/pdf-compare";
import type { PdfComparison } from "@/lib/pdf-compare";
import { visionAvailable } from "@/lib/member-compare";
import type { MemberComparison, MemberStatus } from "@/lib/member-compare";

const STATUS_LABEL: Record<MemberStatus, string> = {
  different: "Different size",
  not_found: "Not found on shop drawing",
  unreadable: "Couldn't read",
  match: "Match",
};

type CompareDrawing = {
  id: string;
  file: File;
};

type ComparisonDisplay = Omit<PdfComparison, "markedPdf"> & {
  markedPdfUrl: string;
};

const IMPERIAL_SCALES = [
  { denominator: 12, label: '1" = 1\'-0"' },
  { denominator: 24, label: '1/2" = 1\'-0"' },
  { denominator: 48, label: '1/4" = 1\'-0"' },
  { denominator: 64, label: '3/16" = 1\'-0"' },
  { denominator: 96, label: '1/8" = 1\'-0"' },
  { denominator: 128, label: '3/32" = 1\'-0"' },
  { denominator: 192, label: '1/16" = 1\'-0"' },
  { denominator: 384, label: '1/32" = 1\'-0"' },
];

const METRIC_SCALES = [10, 20, 25, 50, 75, 100, 150, 200, 250, 500, 1000];

export default function VisualComparison({
  engineeringFiles,
  shopFiles,
  onCompareStart,
}: {
  engineeringFiles: CompareDrawing[];
  shopFiles: CompareDrawing[];
  onCompareStart?: () => void;
}) {
  const [engineerId, setEngineerId] = useState("");
  const [shopId, setShopId] = useState("");
  const [engineerPage, setEngineerPage] = useState(1);
  const [shopPage, setShopPage] = useState(1);
  const [engineerScale, setEngineerScale] = useState("");
  const [shopScale, setShopScale] = useState("");
  const [engineerPageCount, setEngineerPageCount] = useState(0);
  const [shopPageCount, setShopPageCount] = useState(0);
  const [isComparing, setIsComparing] = useState(false);
  const [notice, setNotice] = useState("");
  const [comparison, setComparison] = useState<ComparisonDisplay | null>(null);
  const [progress, setProgress] = useState("");
  const [gridView, setGridView] = useState<"overlay" | "engineer" | "shop">("overlay");
  const [members, setMembers] = useState<MemberComparison | null>(null);
  const [isComparingMembers, setIsComparingMembers] = useState(false);
  const [memberProgress, setMemberProgress] = useState("");
  const [memberNotice, setMemberNotice] = useState("");
  const [useVision, setUseVision] = useState(false);
  const [visionReady, setVisionReady] = useState(false);
  const [memberFilter, setMemberFilter] = useState<MemberStatus | "issues" | "all">("issues");

  useEffect(() => {
    let active = true;
    visionAvailable().then((ready) => {
      if (active) setVisionReady(ready);
    });
    return () => {
      active = false;
    };
  }, []);

  const engineerFile = engineeringFiles.find((item) => item.id === engineerId)?.file;
  const shopFile = shopFiles.find((item) => item.id === shopId)?.file;

  useEffect(() => {
    if (!engineeringFiles.some((item) => item.id === engineerId)) {
      setEngineerId(engineeringFiles[0]?.id ?? "");
    }
  }, [engineerId, engineeringFiles]);

  useEffect(() => {
    if (!shopFiles.some((item) => item.id === shopId)) {
      setShopId(shopFiles[0]?.id ?? "");
    }
  }, [shopId, shopFiles]);

  useEffect(() => {
    let active = true;
    setEngineerPageCount(0);
    setEngineerPage(1);
    if (!engineerFile) return;
    getPdfPageCount(engineerFile)
      .then((count) => {
        if (active) setEngineerPageCount(count);
      })
      .catch((error: Error) => {
        if (active) setNotice(error.message);
      });
    return () => {
      active = false;
    };
  }, [engineerFile]);

  useEffect(() => {
    let active = true;
    setShopPageCount(0);
    setShopPage(1);
    if (!shopFile) return;
    getPdfPageCount(shopFile)
      .then((count) => {
        if (active) setShopPageCount(count);
      })
      .catch((error: Error) => {
        if (active) setNotice(error.message);
      });
    return () => {
      active = false;
    };
  }, [shopFile]);

  useEffect(() => {
    if (!comparison) return;
    return () => URL.revokeObjectURL(comparison.markedPdfUrl);
  }, [comparison]);

  if (engineeringFiles.length === 0 || shopFiles.length === 0) return null;

  async function runComparison() {
    if (!engineerFile || !shopFile || !engineerScale || !shopScale) return;
    onCompareStart?.();
    setIsComparing(true);
    setNotice("");
    setComparison(null);
    setMembers(null);
    setMemberNotice("");
    setProgress("Rendering pages…");
    setGridView("overlay");
    try {
      const result = await comparePdfPages(
        engineerFile,
        shopFile,
        engineerPage,
        shopPage,
        Number(engineerScale),
        Number(shopScale),
        setProgress,
      );
      const pdfBuffer = new ArrayBuffer(result.markedPdf.byteLength);
      new Uint8Array(pdfBuffer).set(result.markedPdf);
      setComparison({
        ...result,
        markedPdfUrl: URL.createObjectURL(
          new Blob([pdfBuffer], { type: "application/pdf" }),
        ),
      });
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "The PDF comparison failed unexpectedly.",
      );
    } finally {
      setIsComparing(false);
      setProgress("");
    }
  }

  async function runMemberComparison() {
    const grid = comparison?.registration.grid;
    if (!engineerFile || !shopFile || !grid) return;
    setIsComparingMembers(true);
    setMemberNotice("");
    setMembers(null);
    setMemberFilter("issues");
    try {
      const result = await comparePdfMembers(
        engineerFile,
        shopFile,
        comparison.engineerPageNumber,
        comparison.shopPageNumber,
        grid,
        { useVision: useVision && visionReady, progress: setMemberProgress },
      );
      setMembers(result);
      if (result.visionError) {
        setMemberNotice(`Vision reading stopped early: ${result.visionError}`);
      }
    } catch (error) {
      setMemberNotice(error instanceof Error ? error.message : "Member comparison failed.");
    } finally {
      setIsComparingMembers(false);
      setMemberProgress("");
    }
  }

  const memberCounts = members
    ? members.findings.reduce(
        (counts, finding) => ({ ...counts, [finding.status]: counts[finding.status] + 1 }),
        { match: 0, different: 0, not_found: 0, unreadable: 0 } as Record<MemberStatus, number>,
      )
    : null;
  const visibleFindings = members
    ? members.findings.filter((finding) =>
        memberFilter === "all"
          ? true
          : memberFilter === "issues"
            ? finding.status !== "match"
            : finding.status === memberFilter,
      )
    : [];

  const canCompare =
    Boolean(engineerFile && shopFile) &&
    engineerScale !== "" &&
    shopScale !== "" &&
    engineerPage <= engineerPageCount &&
    shopPage <= shopPageCount &&
    !isComparing;

  return (
    <section className="visual-comparison-tool" aria-labelledby="visual-comparison-heading">
      <div className="comparison-result-heading">
        <div>
          <div className="section-kicker">
            <span className="kicker-line" />
            OPTIONAL VISUAL CHECK
          </div>
          <h2 id="visual-comparison-heading">Compare drawing pages</h2>
          <p>
            Choose one PDF from each set and the pages to compare. This visual
            check is separate from project upload and schedule extraction. Select
            the drawing scale shown on each page so alignment can verify the
            expected scale relationship.
          </p>
        </div>
      </div>

      <div className="visual-comparison-controls">
        <label>
          Engineer-issued PDF
          <select
            value={engineerId}
            onChange={(event) => {
              setEngineerId(event.target.value);
              setEngineerScale("");
              setComparison(null);
              setNotice("");
            }}
          >
            {engineeringFiles.map(({ id, file }) => (
              <option key={id} value={id}>{file.name}</option>
            ))}
          </select>
        </label>
        <label>
          Engineer page
          <select
            value={engineerPage}
            onChange={(event) => {
              setEngineerPage(Number(event.target.value));
              setEngineerScale("");
              setComparison(null);
            }}
            disabled={!engineerPageCount}
          >
            {Array.from({ length: engineerPageCount }, (_, index) => index + 1).map((page) => (
              <option key={page} value={page}>{page}</option>
            ))}
          </select>
        </label>
        <label>
          Engineer page scale *
          <select
            value={engineerScale}
            onChange={(event) => {
              setEngineerScale(event.target.value);
              setComparison(null);
            }}
            required
          >
            <option value="">Select scale</option>
            <optgroup label="Imperial">
              {IMPERIAL_SCALES.map(({ denominator, label }) => (
                <option key={denominator} value={denominator}>{label}</option>
              ))}
            </optgroup>
            <optgroup label="Metric">
              {METRIC_SCALES.map((denominator) => (
                <option key={denominator} value={denominator}>1:{denominator}</option>
              ))}
            </optgroup>
          </select>
        </label>
        <label>
          Shop PDF
          <select
            value={shopId}
            onChange={(event) => {
              setShopId(event.target.value);
              setShopScale("");
              setComparison(null);
              setNotice("");
            }}
          >
            {shopFiles.map(({ id, file }) => (
              <option key={id} value={id}>{file.name}</option>
            ))}
          </select>
        </label>
        <label>
          Shop page
          <select
            value={shopPage}
            onChange={(event) => {
              setShopPage(Number(event.target.value));
              setShopScale("");
              setComparison(null);
            }}
            disabled={!shopPageCount}
          >
            {Array.from({ length: shopPageCount }, (_, index) => index + 1).map((page) => (
              <option key={page} value={page}>{page}</option>
            ))}
          </select>
        </label>
        <label>
          Shop page scale *
          <select
            value={shopScale}
            onChange={(event) => {
              setShopScale(event.target.value);
              setComparison(null);
            }}
            required
          >
            <option value="">Select scale</option>
            <optgroup label="Imperial">
              {IMPERIAL_SCALES.map(({ denominator, label }) => (
                <option key={denominator} value={denominator}>{label}</option>
              ))}
            </optgroup>
            <optgroup label="Metric">
              {METRIC_SCALES.map((denominator) => (
                <option key={denominator} value={denominator}>1:{denominator}</option>
              ))}
            </optgroup>
          </select>
        </label>
        <button
          className="continue-button"
          type="button"
          disabled={!canCompare}
          onClick={runComparison}
        >
          {isComparing ? "Comparing pages..." : "Compare selected pages"}
        </button>
      </div>

      {isComparing && progress && (
        <p className="registration-summary" role="status">{progress}</p>
      )}
      {notice && <p className="notice-message" role="alert">{notice}</p>}

      {comparison?.registration.method === "grid" && comparison.registration.grid && (
        <div className="comparison-result">
          <div className="comparison-result-heading">
            <div>
              <h3>
                Aligned on {comparison.registration.grid.gridLabels.length} grid lines
              </h3>
              <p>
                Red = engineer-issued only · Blue = shop only · Black = on both
                sheets. Review where colors separate; this is not an engineering
                conclusion.
              </p>
            </div>
            <a
              className="marked-pdf-link"
              href={comparison.markedPdfUrl}
              download={`${shopFile?.name.replace(/\.pdf$/i, "") ?? "shop-drawing"}-page-${shopPage}-grid-overlay.pdf`}
            >
              Download overlay PDF
            </a>
          </div>
          <p className="registration-summary">
            Matched {comparison.registration.grid.matchedBubbles} grid bubbles
            across {comparison.registration.grid.lineDirections} line
            direction{comparison.registration.grid.lineDirections === 1 ? "" : "s"};
            scale {comparison.registration.scale.toFixed(3)}× (expected{" "}
            {comparison.registration.expectedScale.toFixed(3)}× from the selected
            sheet scales), rotation {comparison.registration.rotationDegrees.toFixed(1)}°,
            median offset {comparison.registration.grid.medianResidualPt.toFixed(1)} pt.
            Engineer bubbles read from{" "}
            {comparison.registration.grid.engineerBubbleSource === "text" ? "PDF text" : "OCR"};
            shop bubbles read from{" "}
            {comparison.registration.grid.shopBubbleSource === "text" ? "PDF text" : "OCR"}.
          </p>
          <p className="comparison-caveat">
            Grids used: {comparison.registration.grid.gridLabels.join(", ")}
          </p>
          <div className="grid-view-toggle" role="group" aria-label="Choose view">
            {(["overlay", "engineer", "shop"] as const).map((view) => (
              <button
                key={view}
                type="button"
                className={gridView === view ? "is-selected" : ""}
                aria-pressed={gridView === view}
                onClick={() => setGridView(view)}
              >
                {view === "overlay" ? "Overlay" : view === "engineer" ? "Engineer-issued" : "Shop (aligned)"}
              </button>
            ))}
          </div>
          <section className="member-compare" aria-labelledby="member-compare-heading">
            <div className="member-compare-heading">
              <div>
                <h3 id="member-compare-heading">Compare members by grid location</h3>
                <p>
                  Reads each member size on the engineer sheet, finds the same spot on the
                  shop drawing, and reads the shop&apos;s label there.
                </p>
              </div>
              <button
                className="continue-button"
                type="button"
                onClick={runMemberComparison}
                disabled={isComparingMembers}
              >
                {isComparingMembers ? "Comparing members..." : "Compare members"}
              </button>
            </div>
            <label className={`vision-option ${visionReady ? "" : "is-disabled"}`}>
              <input
                type="checkbox"
                checked={useVision && visionReady}
                disabled={!visionReady || isComparingMembers}
                onChange={(event) => setUseVision(event.target.checked)}
              />
              <span>
                Read unclear labels with Claude. Sends only small crops of the shop drawing
                that local OCR could not read.
                {!visionReady && " (Not configured: add ANTHROPIC_API_KEY to frontend/.env.local.)"}
              </span>
            </label>
            {isComparingMembers && memberProgress && (
              <p className="registration-summary" role="status">{memberProgress}</p>
            )}
            {memberNotice && <p className="notice-message" role="alert">{memberNotice}</p>}
            {members && memberCounts && (
              <>
                <div className="member-summary" role="group" aria-label="Filter members">
                  {(
                    [
                      ["issues", `Needs review ${members.findings.length - memberCounts.match}`],
                      ["different", `Different ${memberCounts.different}`],
                      ["not_found", `Not found ${memberCounts.not_found}`],
                      ["unreadable", `Couldn't read ${memberCounts.unreadable}`],
                      ["match", `Match ${memberCounts.match}`],
                      ["all", `All ${members.findings.length}`],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      className={`member-chip member-chip-${key} ${memberFilter === key ? "is-selected" : ""}`}
                      aria-pressed={memberFilter === key}
                      onClick={() => setMemberFilter(key)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p className="comparison-caveat">
                  {members.visionUsed
                    ? `${members.visionCalls} unclear labels were read by the vision model. `
                    : "Read with local OCR only. "}
                  Findings are prompts for review, not engineering conclusions. Sizes are
                  compared as written; fabricator suffixes such as * are ignored.
                </p>
                <ul className="member-list">
                  {visibleFindings.map((finding) => (
                    <li key={finding.id} className={`member-card member-${finding.status}`}>
                      <div className="member-card-head">
                        <strong>{finding.gridLocation}</strong>
                        <span className={`member-status member-status-${finding.status}`}>
                          {STATUS_LABEL[finding.status]}
                        </span>
                      </div>
                      <div className="member-values">
                        <div>
                          <span>ENGINEER</span>
                          <b>{finding.engineerLabel}</b>
                        </div>
                        <div>
                          <span>
                            SHOP{finding.readBy !== "none" ? ` · read by ${finding.readBy === "ocr" ? "OCR" : "Claude"}` : ""}
                          </span>
                          <b>{finding.shopDesignation ?? "—"}</b>
                        </div>
                      </div>
                      {finding.note && <p className="member-note">{finding.note}</p>}
                      <div className="member-crops">
                        <figure>
                          <figcaption>Engineer</figcaption>
                          <img src={finding.engineerCrop} alt={`Engineer label ${finding.engineerLabel}`} />
                        </figure>
                        <figure>
                          <figcaption>Shop (same location)</figcaption>
                          <img src={finding.shopCrop} alt="Shop drawing at the same grid location" />
                        </figure>
                      </div>
                    </li>
                  ))}
                  {visibleFindings.length === 0 && (
                    <li className="member-empty">No members in this group.</li>
                  )}
                </ul>
              </>
            )}
          </section>

          <figure className="comparison-preview grid-overlay-preview">
            <img
              src={
                gridView === "overlay"
                  ? comparison.overlayPreview
                  : gridView === "engineer"
                    ? comparison.engineerPreview
                    : comparison.shopPreview
              }
              alt={
                gridView === "overlay"
                  ? "Overlay of engineer-issued and shop drawings aligned on grid lines"
                  : gridView === "engineer"
                    ? "Engineer-issued drawing page"
                    : "Shop drawing page aligned to the engineer-issued page"
              }
            />
          </figure>
        </div>
      )}

      {comparison && comparison.registration.method !== "grid" && (
        <div className="comparison-result">
          <div className="comparison-result-heading">
            <div>
              <h3>
                {comparison.regions.length === 0
                  ? "No candidate changes detected"
                  : `${comparison.regions.length} visual change region${comparison.regions.length === 1 ? "" : "s"} found`}
              </h3>
              <p>
                Highlighted areas are visual candidates, not engineering conclusions.
              </p>
            </div>
            <a
              className="marked-pdf-link"
              href={comparison.markedPdfUrl}
              download={`${shopFile?.name.replace(/\.pdf$/i, "") ?? "shop-drawing"}-page-${shopPage}-marked-up.pdf`}
            >
              Download marked-up page
            </a>
          </div>
          <p className="registration-summary">
            Aligned with {comparison.registration.inliers} reciprocal feature
            matches ({Math.round(comparison.registration.inlierPercent * 100)}%
            inliers), average scale {comparison.registration.scale.toFixed(3)}×,
            expected scale from the selected sheet scales{" "}
            {comparison.registration.expectedScale.toFixed(3)}×,
            rotation {comparison.registration.rotationDegrees.toFixed(1)}°,
            residual {comparison.registration.reprojectionError.toFixed(2)} px.
          </p>
          {comparison.registration.gridFallbackReason && (
            <p className="comparison-caveat">
              Grid alignment was not used: {comparison.registration.gridFallbackReason}
            </p>
          )}
          <p className="comparison-caveat">
            Automatic alignment handles scale, rotation, translation, moderate
            skew, and differing page sizes when the sheets share enough geometry.
            Low-confidence or unrelated pages are rejected. Compare originals
            before acting; this output is rasterized and is not an approval.
          </p>
          <div className="comparison-previews">
            <figure className="comparison-preview">
              <figcaption>
                Engineer-issued · page {comparison.engineerPageNumber}
              </figcaption>
              <img src={comparison.engineerPreview} alt="Engineer-issued drawing page" />
            </figure>
            <figure className="comparison-preview">
              <figcaption>Aligned shop page · visual candidates</figcaption>
              <div className="comparison-image-wrap">
                <img src={comparison.shopPreview} alt="Aligned shop drawing page" />
                <svg
                  className="difference-overlay"
                  viewBox={`0 0 ${comparison.width} ${comparison.height}`}
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  {comparison.regions.map((region) => (
                    <g key={region.id}>
                      <rect
                        x={region.x}
                        y={region.y}
                        width={region.width}
                        height={region.height}
                        fill="rgba(220, 48, 48, 0.16)"
                        stroke="#cf3030"
                        strokeWidth={2}
                      />
                      <text
                        x={region.x + 3}
                        y={Math.max(14, region.y - 3)}
                        fill="#a71f1f"
                        fontSize={13}
                        fontWeight="bold"
                      >
                        {region.id}
                      </text>
                    </g>
                  ))}
                </svg>
              </div>
            </figure>
          </div>
        </div>
      )}
    </section>
  );
}
