"use client";

import { useMemo, useRef, useState } from "react";
import type { ChangeEvent, DragEvent, ReactNode } from "react";

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
    setFiles((current) => ({
      ...current,
      [side]: current[side].filter((item) => item.id !== id),
    }));
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
      <aside className="sidebar">
        <a className="brand" href="#" aria-label="Shop Drawing Reviewer home">
          <span className="brand-mark">
            <Icon name="logo" size={22} />
          </span>
          <span className="brand-copy">
            <strong>shopcheck</strong>
            <span>STRUCTURAL REVIEW</span>
          </span>
        </a>

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
        <header className="topbar">
          <div className="breadcrumb">
            <span>Workspace</span>
            <span className="breadcrumb-divider">/</span>
            <strong>New review</strong>
          </div>
          <div className="topbar-status">
            <span className="status-dot" />
            MVP preview
          </div>
        </header>

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
              disabled={!isReady}
              onClick={() =>
                setNotice(
                  "Both drawing sets are selected. Server upload and comparison will be available when the backend is connected.",
                )
              }
            >
              Continue
              <Icon name="arrow" size={18} />
            </button>
          </div>

          <div className="prototype-note">
            <span className="prototype-indicator" />
            <span>
              Preview mode — selected PDFs stay in your browser and are not uploaded.
            </span>
          </div>
        </div>
      </main>
    </div>
  );
}
