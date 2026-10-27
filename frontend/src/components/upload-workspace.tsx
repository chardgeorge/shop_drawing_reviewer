"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, DragEvent, ReactNode } from "react";
import { comparePdfFirstPages } from "@/lib/pdf-compare";
import type { PdfComparison } from "@/lib/pdf-compare";

type DrawingSide = "engineering" | "shop";
type DrawingFile = {
  id: string;
  file: File;
};

type ComparisonDisplay = Omit<PdfComparison, "markedPdf"> & {
  markedPdfUrl: string;
};

const SIDE_COPY: Record<
  DrawingSide,
  { title: string; subtitle: string; shortLabel: string; tone: string }
> = {
  engineering: {
    title: "Engineering drawings",
    subtitle: "The design intent to review against",
    shortLabel: "ENGINEER-ISSUED",
    tone: "blue",
  },
  shop: {
    title: "Shop drawings",
    subtitle: "The fabricator's drawings for checking",
    shortLabel: "FABRICATOR",
    tone: "green",
  },
};

function Icon({
  name,
  size = 20,
}: {
  name: "logo" | "grid" | "folder" | "clock" | "settings" | "upload" | "file" | "check" | "arrow" | "close" | "shield" | "plus";
  size?: number;
}) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
  };

  switch (name) {
    case "logo":
      return (
        <svg {...common}>
          <path d="M4 19V5l8 7 8-7v14" />
          <path d="M8 19v-5l4-3 4 3v5" />
        </svg>
      );
    case "grid":
      return (
        <svg {...common}>
          <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
          <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
          <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
          <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
        </svg>
      );
    case "folder":
      return (
        <svg {...common}>
          <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h5l2 2h8A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" />
          <path d="M3.5 10h17" />
        </svg>
      );
    case "clock":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 7v5l3 2" />
        </svg>
      );
    case "settings":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="m19.4 15 .1.1 1.1.9-1 1.8-1.4-.5a7.8 7.8 0 0 1-1.7 1l-.2 1.5h-2.1l-.4-1.4a7.8 7.8 0 0 1-2-.1l-.9 1.1-1.8-1 .5-1.4a7.8 7.8 0 0 1-1-1.7l-1.5-.2v-2.1l1.4-.4a7.8 7.8 0 0 1 .1-2l-1.1-.9 1-1.8 1.4.5a7.8 7.8 0 0 1 1.7-1l.2-1.5h2.1l.4 1.4a7.8 7.8 0 0 1 2 .1l.9-1.1 1.8 1-.5 1.4a7.8 7.8 0 0 1 1 1.7l1.5.2v2.1l-1.4.4a7.8 7.8 0 0 1-.2 1.9Z" />
        </svg>
      );
    case "upload":
      return (
        <svg {...common}>
          <path d="M12 15V4m0 0L8 8m4-4 4 4" />
          <path d="M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" />
        </svg>
      );
    case "file":
      return (
        <svg {...common}>
          <path d="M13.5 3.5H6A2 2 0 0 0 4 5.5v13A2 2 0 0 0 6 20.5h12a2 2 0 0 0 2-2V10z" />
          <path d="M13 3.5V10h7M8 14h8m-8 3h6" />
        </svg>
      );
    case "check":
      return (
        <svg {...common}>
          <path d="m5 12 4 4L19 6" />
        </svg>
      );
    case "arrow":
      return (
        <svg {...common}>
          <path d="M5 12h14m-6-6 6 6-6 6" />
        </svg>
      );
    case "close":
      return (
        <svg {...common}>
          <path d="m6 6 12 12M18 6 6 18" />
        </svg>
      );
    case "shield":
      return (
        <svg {...common}>
          <path d="M12 21s8-4 8-11V5l-8-3-8 3v5c0 7 8 11 8 11Z" />
          <path d="m9 12 2 2 4-4" />
        </svg>
      );
    case "plus":
      return (
        <svg {...common}>
          <path d="M12 5v14M5 12h14" />
        </svg>
      );
  }
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function UploadWorkspace() {
  const [files, setFiles] = useState<Record<DrawingSide, DrawingFile[]>>({
    engineering: [],
    shop: [],
  });
  const [dragging, setDragging] = useState<DrawingSide | null>(null);
  const [notice, setNotice] = useState("");
  const [comparison, setComparison] = useState<ComparisonDisplay | null>(null);
  const [isComparing, setIsComparing] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [previewUrls, setPreviewUrls] = useState<Record<DrawingSide, string | null>>({
    engineering: null,
    shop: null,
  });
  const engineeringInput = useRef<HTMLInputElement>(null);
  const shopInput = useRef<HTMLInputElement>(null);

  const totalFiles = files.engineering.length + files.shop.length;
  const isReady = files.engineering.length > 0 && files.shop.length > 0;
  const totalSize = useMemo(
    () =>
      [...files.engineering, ...files.shop].reduce(
        (total, item) => total + item.file.size,
        0,
      ),
    [files],
  );

  useEffect(() => {
    if (!comparison) return;
    return () => URL.revokeObjectURL(comparison.markedPdfUrl);
  }, [comparison]);

  useEffect(() => {
    const nextUrls: Record<DrawingSide, string | null> = {
      engineering: files.engineering[0]
        ? URL.createObjectURL(files.engineering[0].file)
        : null,
      shop: files.shop[0] ? URL.createObjectURL(files.shop[0].file) : null,
    };

    setPreviewUrls(nextUrls);
    return () => {
      Object.values(nextUrls).forEach((url) => {
        if (url) URL.revokeObjectURL(url);
      });
    };
  }, [files]);

  function addFiles(side: DrawingSide, selected: FileList | File[]) {
    const accepted: DrawingFile[] = [];
    const rejected: string[] = [];

    Array.from(selected).forEach((file) => {
      if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
        rejected.push(file.name);
        return;
      }

      accepted.push({
        id: `${file.name}-${file.size}-${file.lastModified}`,
        file,
      });
    });

    if (rejected.length > 0) {
      setNotice(
        `${rejected.length === 1 ? "This file is" : "These files are"} not a PDF and ${rejected.length === 1 ? "was" : "were"} not added: ${rejected.join(", ")}`,
      );
    } else if (accepted.length > 0) {
      setNotice("");
    }

    if (accepted.length > 0) {
      setComparison(null);
      setFiles((current) => ({
        ...current,
        [side]: [
          ...current[side],
          ...accepted.filter(
            (item) => !current[side].some((existing) => existing.id === item.id),
          ),
        ],
      }));
    }
  }

  function handleInput(side: DrawingSide, event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files) addFiles(side, event.target.files);
    event.target.value = "";
  }

  function handleDrop(side: DrawingSide, event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(null);
    addFiles(side, event.dataTransfer.files);
  }

  function removeFile(side: DrawingSide, id: string) {
    setComparison(null);
    setFiles((current) => ({
      ...current,
      [side]: current[side].filter((item) => item.id !== id),
    }));
  }

  async function compareDrawings() {
    const engineerFile = files.engineering[0]?.file;
    const shopFile = files.shop[0]?.file;
    if (!engineerFile || !shopFile) return;

    setIsComparing(true);
    setIsSidebarOpen(false);
    setNotice("");
    setComparison(null);
    try {
      const result = await comparePdfFirstPages(engineerFile, shopFile);
      const pdfBuffer = new ArrayBuffer(result.markedPdf.byteLength);
      new Uint8Array(pdfBuffer).set(result.markedPdf);
      const markedPdfUrl = URL.createObjectURL(
        new Blob([pdfBuffer], { type: "application/pdf" }),
      );
      setComparison({
        ...result,
        markedPdfUrl,
      });
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "The PDF comparison failed unexpectedly.",
      );
    } finally {
      setIsComparing(false);
    }
  }

  function getInput(side: DrawingSide) {
    return side === "engineering" ? engineeringInput : shopInput;
  }

  function renderPanel(side: DrawingSide): ReactNode {
    const copy = SIDE_COPY[side];
    const selected = files[side];

    return (
      <section
        className={`upload-card ${copy.tone}-card`}
        aria-labelledby={`${side}-heading`}
      >
        <div className="card-heading">
          <div className={`document-icon ${copy.tone}-icon`}>
            <Icon name="file" size={21} />
          </div>
          <div>
            <span className={`eyebrow ${copy.tone}-eyebrow`}>{copy.shortLabel}</span>
            <h2 id={`${side}-heading`}>{copy.title}</h2>
            <p>{copy.subtitle}</p>
          </div>
          {selected.length > 0 && (
            <span className="count-badge">
              <Icon name="check" size={14} />
              {selected.length} added
            </span>
          )}
        </div>

        <input
          ref={getInput(side)}
          className="visually-hidden"
          type="file"
          accept="application/pdf,.pdf"
          multiple
          onChange={(event) => handleInput(side, event)}
          aria-label={`Choose ${copy.title.toLowerCase()} PDF files`}
        />

        <div
          className={`drop-zone ${dragging === side ? "is-dragging" : ""} ${selected.length > 0 ? "has-files" : ""}`}
          onDragEnter={(event) => {
            event.preventDefault();
            setDragging(side);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              setDragging(null);
            }
          }}
          onDrop={(event) => handleDrop(side, event)}
        >
          {selected.length > 0 && previewUrls[side] ? (
            <>
              <iframe
                className="upload-preview"
                src={`${previewUrls[side]}#page=1&view=FitH`}
                title={`${copy.title} first-page preview`}
              />
              <button
                className="browse-button preview-browse-button"
                type="button"
                onClick={() => getInput(side).current?.click()}
              >
                Add more files
              </button>
            </>
          ) : (
            <>
              <div className="upload-symbol">
                <Icon name="upload" size={23} />
              </div>
              <p className="drop-title">Drop PDF files here</p>
              <p className="drop-or">or</p>
              <button
                className="browse-button"
                type="button"
                onClick={() => getInput(side).current?.click()}
              >
                Browse files
              </button>
              <span className="file-hint">PDF only · Multiple files supported</span>
            </>
          )}
        </div>

        {selected.length > 0 && (
          <div className="file-list" aria-label={`${copy.title} selected files`}>
            <div className="file-list-heading">
              <span>Selected documents</span>
              <span>{selected.length}</span>
            </div>
            {selected.map(({ id, file }) => (
              <div className="file-row" key={id}>
                <div className={`file-type-icon ${copy.tone}-file-icon`}>
                  <Icon name="file" size={18} />
                </div>
                <div className="file-details">
                  <span className="file-name" title={file.name}>
                    {file.name}
                  </span>
                  <span className="file-meta">PDF · {formatBytes(file.size)}</span>
                </div>
                <span className="file-ready" title="Selected in this browser">
                  <Icon name="check" size={15} />
                </span>
                <button
                  type="button"
                  className="remove-file"
                  aria-label={`Remove ${file.name}`}
                  onClick={() => removeFile(side, id)}
                >
                  <Icon name="close" size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    );
  }

  return (
    <div className="app-shell">
      <aside
        id="review-navigation"
        className={`sidebar ${isSidebarOpen ? "" : "sidebar-collapsed"}`}
      >
        <a className="brand" href="#" aria-label="Shop Drawing Reviewer home">
          <span className="brand-mark">
            <Icon name="logo" size={22} />
          </span>
          <span className="brand-copy">
            <strong>shopChecker</strong>
            <span>STRUCTURAL REVIEW</span>
          </span>
        </a>
        <button
          className="sidebar-toggle"
          type="button"
          aria-expanded={isSidebarOpen}
          aria-controls="review-navigation"
          onClick={() => setIsSidebarOpen(false)}
        >
          <Icon name="grid" size={16} />
          <span>Collapse menu</span>
        </button>

        <div className="workspace-label">WORKSPACE</div>
        <nav className="sidebar-nav" aria-label="Main navigation">
          <a className="nav-item active" href="#upload">
            <Icon name="grid" />
            <span>New review</span>
          </a>
          <a
            className="nav-item disabled-nav"
            href="#recent"
            aria-disabled="true"
            onClick={(event) => event.preventDefault()}
          >
            <Icon name="folder" />
            <span>Projects</span>
            <span className="nav-soon">SOON</span>
          </a>
          <a
            className="nav-item disabled-nav"
            href="#activity"
            aria-disabled="true"
            onClick={(event) => event.preventDefault()}
          >
            <Icon name="clock" />
            <span>Recent activity</span>
          </a>
        </nav>

        <div className="sidebar-bottom">
          <div className="sidebar-help">
            <span className="help-mark">
              <Icon name="shield" size={18} />
            </span>
            <div>
              <strong>Built for engineering review</strong>
              <p>Your judgment stays in control.</p>
            </div>
          </div>
          <button className="profile-button" type="button" aria-label="Account settings">
            <span className="avatar">GE</span>
            <span className="profile-copy">
              <strong>Guest engineer</strong>
              <span>Local preview</span>
            </span>
            <Icon name="settings" size={18} />
          </button>
        </div>
      </aside>

      <main className="main-content" id="upload">
        {!isSidebarOpen && (
          <button
            className="menu-toggle"
            type="button"
            aria-expanded={isSidebarOpen}
            aria-controls="review-navigation"
            onClick={() => setIsSidebarOpen(true)}
          >
            <Icon name="grid" size={17} />
            <span>Show menu</span>
          </button>
        )}
        <div className="content-wrap">
          <div className="page-intro">
            <div>
              <div className="section-kicker">
                <span className="kicker-line" />
                DRAWING REVIEW
              </div>
              <h1>Start a new review</h1>
              <p className="intro-copy">
                Bring both sets of drawings together. We&apos;ll help you spot what
                needs a closer look.
              </p>
            </div>
            <div className="step-pill">
              <span className="step-number">01</span>
              <span>DOCUMENTS</span>
              <span className="step-line" />
              <span className="step-muted">02 REVIEW</span>
            </div>
          </div>

          <section className="project-field" aria-labelledby="project-label">
            <label id="project-label" htmlFor="project-name">
              PROJECT NAME <span className="optional-label">OPTIONAL</span>
            </label>
            <div className="project-input-wrap">
              <Icon name="folder" size={19} />
              <input
                id="project-name"
                type="text"
                placeholder="e.g. North Plant — Structural Steel"
                maxLength={120}
              />
              <span className="project-input-hint">A name helps you find this review later</span>
            </div>
          </section>

          <div className="upload-grid">
            {renderPanel("engineering")}
            <div className="versus-divider" aria-hidden="true">
              <span>VS</span>
            </div>
            {renderPanel("shop")}
          </div>

          {notice && (
            <p className="notice-message" role="alert">
              {notice}
            </p>
          )}

          <div className="bottom-row">
            <div className="privacy-note">
              <span className="privacy-icon">
                <Icon name="shield" size={17} />
              </span>
              <span>
                {totalFiles > 0
                  ? `${totalFiles} PDF${totalFiles === 1 ? "" : "s"} selected · ${formatBytes(totalSize)} total`
                  : "Files stay in this browser in preview mode."}
              </span>
            </div>
            <button
              className="continue-button"
              type="button"
              disabled={!isReady || isComparing}
              onClick={compareDrawings}
            >
              {isComparing ? "Comparing PDFs..." : "Compare first pages"}
              {!isComparing && <Icon name="arrow" size={18} />}
            </button>
          </div>

          {comparison && (
            <section className="comparison-result" aria-labelledby="comparison-heading">
              <div className="comparison-result-heading">
                <div>
                  <span className="section-kicker">
                    <span className="kicker-line" />
                    VISUAL REVIEW
                  </span>
                  <h2 id="comparison-heading">
                    {comparison.regions.length === 0
                      ? "No candidate changes detected"
                      : `${comparison.regions.length} visual change region${comparison.regions.length === 1 ? "" : "s"} found`}
                  </h2>
                  <p>
                    Pixel-difference candidates are highlighted on the shop drawing.
                    Review each one; they are not engineering conclusions.
                  </p>
                </div>
                <a
                  className="marked-pdf-link"
                  href={comparison.markedPdfUrl}
                  download={`${files.shop[0]?.file.name.replace(/\.pdf$/i, "") ?? "shop-drawing"}-marked-up.pdf`}
                >
                  Download aligned markup · page 1
                  <Icon name="arrow" size={16} />
                </a>
              </div>

              <p className="registration-summary">
                Auto-aligned with {comparison.registration.inliers} matching
                features ({Math.round(comparison.registration.inlierPercent * 100)}%
                of accepted matches), {comparison.registration.scale.toFixed(3)}×
                scale, {comparison.registration.rotationDegrees.toFixed(1)}°
                rotation, {comparison.registration.reprojectionError.toFixed(2)} px
                residual.
              </p>
              {(comparison.engineerPageCount > 1 || comparison.shopPageCount > 1) && (
                <p className="comparison-caveat">
                  Only page 1 was compared. Additional pages are not analyzed or
                  included in the exported PDF.
                </p>
              )}
              <p className="comparison-caveat">
                Automatic alignment estimates scale, rotation, and position from
                shared visual features. Review the overlay: alignment can still be
                wrong, and highlights can include text or revision differences or
                miss real discrepancies. The download is a rasterized aligned view,
                not an engineering approval or a substitute for the originals.
              </p>

              <div className="comparison-previews">
                <figure className="comparison-preview">
                  <figcaption>Engineer-issued · page 1</figcaption>
                  <img
                    src={comparison.engineerPreview}
                    alt="Rendered first page of the engineer-issued drawing"
                  />
                </figure>
                <figure className="comparison-preview">
                  <figcaption>Shop drawing · highlighted candidates</figcaption>
                  <div className="comparison-image-wrap">
                    <img
                      src={comparison.shopPreview}
                      alt="Rendered first page of the shop drawing"
                    />
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
            </section>
          )}

          <div className="prototype-note">
            <span className="prototype-indicator" />
            <span>
              Local comparison mode — selected PDFs stay in your browser and are not uploaded.
            </span>
          </div>
        </div>
      </main>
    </div>
  );
}
