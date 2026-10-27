"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, DragEvent } from "react";
import VisualComparison from "@/components/visual-comparison";

type DrawingSide = "engineering" | "shop";
type DrawingFile = {
  id: string;
  file: File;
};

const SIDE_COPY: Record<
  DrawingSide,
  { title: string; subtitle: string; shortLabel: string; tone: string }
> = {
  engineering: {
    title: "Engineer-issued PDF",
    subtitle: "Reference drawing",
    shortLabel: "ENGINEER-ISSUED",
    tone: "blue",
  },
  shop: {
    title: "Shop PDF",
    subtitle: "Drawing to compare",
    shortLabel: "FABRICATOR",
    tone: "green",
  },
};

function Icon({
  name,
  size = 20,
}: {
  name: "grid" | "upload" | "file" | "check" | "close" | "shield";
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
    case "grid":
      return (
        <svg {...common}>
          <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
          <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
          <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
          <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
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
  }
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function UploadWorkspace() {
  const [files, setFiles] = useState<Record<DrawingSide, DrawingFile | null>>({
    engineering: null,
    shop: null,
  });
  const [dragging, setDragging] = useState<DrawingSide | null>(null);
  const [notice, setNotice] = useState("");
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const engineeringInput = useRef<HTMLInputElement>(null);
  const shopInput = useRef<HTMLInputElement>(null);

  const previewUrls = useMemo(
    () => ({
      engineering: files.engineering
        ? URL.createObjectURL(files.engineering.file)
        : "",
      shop: files.shop ? URL.createObjectURL(files.shop.file) : "",
    }),
    [files],
  );

  useEffect(() => {
    return () => {
      Object.values(previewUrls).forEach((url) => {
        if (url) URL.revokeObjectURL(url);
      });
    };
  }, [previewUrls]);

  function getInput(side: DrawingSide) {
    return side === "engineering" ? engineeringInput : shopInput;
  }

  function addFile(side: DrawingSide, file?: File) {
    if (!file) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setNotice(`${file.name} is not a PDF and was not selected.`);
      return;
    }

    setFiles((current) => ({
      ...current,
      [side]: {
        id: `${side}-${file.name}-${file.size}-${file.lastModified}`,
        file,
      },
    }));
    setNotice("");
  }

  function handleInput(side: DrawingSide, event: ChangeEvent<HTMLInputElement>) {
    addFile(side, event.target.files?.[0]);
    event.target.value = "";
  }

  function handleDrop(side: DrawingSide, event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(null);
    addFile(side, event.dataTransfer.files[0]);
  }

  function removeFile(side: DrawingSide) {
    setFiles((current) => ({ ...current, [side]: null }));
  }

  function renderPanel(side: DrawingSide) {
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
          {selected && (
            <span className="count-badge">
              <Icon name="check" size={14} />
              1 added
            </span>
          )}
        </div>

        <input
          ref={getInput(side)}
          className="visually-hidden"
          type="file"
          accept="application/pdf,.pdf"
          onChange={(event) => handleInput(side, event)}
          aria-label={`Choose ${copy.title}`}
        />

        <div
          className={`drop-zone ${dragging === side ? "is-dragging" : ""} ${selected ? "has-files" : ""}`}
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
          {selected && previewUrls[side] ? (
            <iframe
              className="upload-preview"
              src={`${previewUrls[side]}#page=1&view=FitH`}
              title={`${copy.title} preview`}
            />
          ) : (
            <div className="upload-empty">
              <div className="upload-symbol">
                <Icon name="upload" size={23} />
              </div>
              <p className="drop-title">Drop one PDF here</p>
              <p className="drop-or">or</p>
              <button
                className="browse-button"
                type="button"
                onClick={() => getInput(side).current?.click()}
              >
                Browse files
              </button>
              <span className="file-hint">PDF only · One file per side</span>
            </div>
          )}
        </div>

        {selected && (
          <div className="file-list" aria-label={`${copy.title} selected file`}>
            <div className="file-list-heading">
              <span>Selected PDF</span>
            </div>
            <div className="file-row">
              <div className={`file-type-icon ${copy.tone}-file-icon`}>
                <Icon name="file" size={18} />
              </div>
              <div className="file-details">
                <span className="file-name" title={selected.file.name}>
                  {selected.file.name}
                </span>
                <span className="file-meta">PDF · {formatBytes(selected.file.size)}</span>
              </div>
              <button
                className="browse-button"
                type="button"
                onClick={() => getInput(side).current?.click()}
              >
                Replace
              </button>
              <button
                type="button"
                className="remove-file"
                aria-label={`Remove ${selected.file.name}`}
                onClick={() => removeFile(side)}
              >
                <Icon name="close" size={16} />
              </button>
            </div>
          </div>
        )}
      </section>
    );
  }

  return (
    <div className="app-shell">
      <aside
        id="comparison-navigation"
        className={`sidebar ${isSidebarOpen ? "" : "sidebar-collapsed"}`}
      >
        <div className="brand">
          <button
            className="sidebar-toggle"
            type="button"
            aria-label="Collapse menu"
            aria-expanded={isSidebarOpen}
            aria-controls="comparison-navigation"
            onClick={() => setIsSidebarOpen(false)}
          >
            <Icon name="grid" size={20} />
          </button>
          <span className="brand-copy">
            <strong>shopChecker</strong>
            <span>DRAWING COMPARISON</span>
          </span>
        </div>
        <div className="workspace-label">WORKSPACE</div>
        <nav className="sidebar-nav" aria-label="Main navigation">
          <a className="nav-item active" href="#comparison">
            <Icon name="grid" />
            <span>Compare PDFs</span>
          </a>
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-help">
            <span className="help-mark">
              <Icon name="shield" size={18} />
            </span>
            <div>
              <strong>Visual review support</strong>
              <p>Your judgment stays in control.</p>
            </div>
          </div>
        </div>
      </aside>

      <main className="main-content" id="comparison">
        {!isSidebarOpen && (
          <button
            className="menu-toggle"
            type="button"
            aria-expanded={isSidebarOpen}
            aria-controls="comparison-navigation"
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
                PDF COMPARISON
              </div>
              <h1>Compare two drawing PDFs</h1>
              <p className="intro-copy">
                Select one engineer-issued PDF and one shop PDF. Their pages are
                compared directly in your browser.
              </p>
            </div>
          </div>

          <div className="upload-grid">
            {renderPanel("engineering")}
            <div className="versus-divider" aria-hidden="true">
              <span>VS</span>
            </div>
            {renderPanel("shop")}
          </div>

          {notice && <p className="notice-message" role="alert">{notice}</p>}

          <VisualComparison
            engineeringFiles={files.engineering ? [files.engineering] : []}
            shopFiles={files.shop ? [files.shop] : []}
          />

          <div className="prototype-note">
            <span className="prototype-indicator" />
            <span>
              PDFs stay in this browser for comparison and are not uploaded to a
              backend.
            </span>
          </div>
        </div>
      </main>
    </div>
  );
}
