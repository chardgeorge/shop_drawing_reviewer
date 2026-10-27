"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ChangeEvent,
  Dispatch,
  DragEvent,
  ReactNode,
  SetStateAction,
} from "react";
import VisualComparison from "@/components/visual-comparison";

type DrawingSide = "engineering" | "shop";
type DrawingFile = {
  id: string;
  file: File;
};

type ExtractedDocument = {
  id: string;
  role: "engineer" | "shop";
  file_name: string;
  status: "uploaded" | "queued" | "processing" | "ready" | "needs_review" | "failed";
  extraction: {
    id: string;
    status: string;
    page_count: number | null;
    diagnostics: {
      warnings?: { code: string; message: string }[];
      schedule_row_count?: number;
    };
    error_code: string | null;
    error_message: string | null;
  } | null;
};

type BeamRow = {
  id: string;
  member_mark_raw: string | null;
  section_raw: string | null;
  member_mark: string | null;
  section: string | null;
  page_number: number;
  source_bbox: { x0: number; y0: number; x1: number; y1: number } | null;
  confidence: number | null;
  review_state: "needs_review" | "accepted" | "rejected";
};

function createDemoRows(): BeamRow[] {
  return [
    {
      id: "demo-row-1",
      member_mark_raw: "B1",
      section_raw: "W12x26",
      member_mark: "B1",
      section: "W12x26",
      page_number: 1,
      source_bbox: { x0: 72, y0: 118, x1: 290, y1: 134 },
      confidence: 0.96,
      review_state: "needs_review",
    },
    {
      id: "demo-row-2",
      member_mark_raw: "B2",
      section_raw: "W14x30",
      member_mark: "B2",
      section: "W14x30",
      page_number: 1,
      source_bbox: { x0: 72, y0: 148, x1: 290, y1: 164 },
      confidence: 0.91,
      review_state: "needs_review",
    },
    {
      id: "demo-row-3",
      member_mark_raw: "B3",
      section_raw: "W16x36",
      member_mark: "B3",
      section: "W16x36",
      page_number: 1,
      source_bbox: { x0: 72, y0: 178, x1: 290, y1: 194 },
      confidence: 0.84,
      review_state: "needs_review",
    },
  ];
}

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
const DEMO_PROJECT_ID = "demo-project";

function createDemoDocuments(): ExtractedDocument[] {
  return [
    {
      id: "demo-engineer-document",
      role: "engineer",
      file_name: "engineer-beam-schedule.pdf",
      status: "ready",
      extraction: {
        id: "demo-engineer-extraction",
        status: "completed",
        page_count: 2,
        diagnostics: { schedule_row_count: 3 },
        error_code: null,
        error_message: null,
      },
    },
    {
      id: "demo-shop-document",
      role: "shop",
      file_name: "shop-drawing-schedule.pdf",
      status: "needs_review",
      extraction: {
        id: "demo-shop-extraction",
        status: "completed",
        page_count: 1,
        diagnostics: {
          schedule_row_count: 3,
          warnings: [
            {
              code: "DEMO_REVIEW",
              message: "Demo data only: review the extracted values before comparison.",
            },
          ],
        },
        error_code: null,
        error_message: null,
      },
    },
  ];
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, init);
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | { detail?: string }
      | null;
    throw new Error(body?.detail ?? `Request failed (${response.status}).`);
  }
  return (await response.json()) as T;
}

function ReviewWorkspace({
  projectId,
  documents,
  sourceFiles,
  onDocumentsChange,
  onBack,
  demoMode = false,
}: {
  projectId: string;
  documents: ExtractedDocument[];
  sourceFiles: Record<DrawingSide, DrawingFile[]>;
  onDocumentsChange: Dispatch<SetStateAction<ExtractedDocument[]>>;
  onBack: () => void;
  demoMode?: boolean;
}) {
  const [selectedDocumentId, setSelectedDocumentId] = useState(documents[0]?.id ?? "");
  const [rows, setRows] = useState<BeamRow[]>(() => (demoMode ? createDemoRows() : []));
  const [drafts, setDrafts] = useState<Record<string, { member_mark: string; section: string }>>({});
  const [selectedPage, setSelectedPage] = useState(1);
  const [error, setError] = useState("");
  const [savingRowId, setSavingRowId] = useState("");
  const [engineerRows, setEngineerRows] = useState<BeamRow[]>([]);
  const [shopRows, setShopRows] = useState<BeamRow[]>([]);

  const selectedDocument = documents.find((document) => document.id === selectedDocumentId);
  const extractionId = selectedDocument?.extraction?.id;
  const engineerDocument = documents.find((document) => document.role === "engineer");
  const shopDocument = documents.find((document) => document.role === "shop");

  const previewUrls = useMemo(() => {
    if (!demoMode) return {};
    return {
      engineer: sourceFiles.engineering[0]
        ? URL.createObjectURL(sourceFiles.engineering[0].file)
        : "",
      shop: sourceFiles.shop[0]
        ? URL.createObjectURL(sourceFiles.shop[0].file)
        : "",
    };
  }, [demoMode, sourceFiles]);

  useEffect(() => {
    return () => {
      Object.values(previewUrls).forEach((url) => {
        if (url) URL.revokeObjectURL(url);
      });
    };
  }, [previewUrls]);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const latest = await Promise.all(
          documents.map((document) =>
            requestJson<ExtractedDocument>(`/api/v1/documents/${document.id}`),
          ),
        );
        if (active) onDocumentsChange(latest);
      } catch (requestError) {
        if (active) setError((requestError as Error).message);
      }
    };
    const pending = !demoMode && documents.some(
      (document) => document.status === "queued" || document.status === "processing",
    );
    if (!pending) return;
    const timer = window.setInterval(refresh, 2000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [documents, onDocumentsChange]);

  useEffect(() => {
    let active = true;
    if (demoMode) {
      setRows(createDemoRows());
      return;
    }
    setRows([]);
    if (!selectedDocument || !extractionId || selectedDocument.extraction?.status !== "completed") {
      return;
    }

    requestJson<{ items: BeamRow[] }>(
      `/api/v1/documents/${selectedDocument.id}/extraction-runs/${extractionId}/beam-rows`,
    )
      .then((response) => {
        if (active) {
          setRows(response.items);
          setSelectedPage(response.items[0]?.page_number ?? 1);
        }
      })
      .catch((requestError: Error) => {
        if (active) setError(requestError.message);
      });

    return () => {
      active = false;
    };
  }, [selectedDocument, extractionId]);

  useEffect(() => {
    let active = true;
    if (demoMode) {
      const demoRows = createDemoRows();
      setEngineerRows(demoRows);
      setShopRows(
        demoRows.map((row, index) =>
          index === 1
            ? { ...row, id: "demo-shop-row-2", section: "W16x36", section_raw: "W16x36" }
            : { ...row, id: `demo-shop-${index + 1}` },
        ),
      );
      return;
    }

    const loadRows = async (
      document: ExtractedDocument | undefined,
      setDocumentRows: (rows: BeamRow[]) => void,
    ) => {
      if (!document?.extraction?.id || document.extraction.status !== "completed") {
        setDocumentRows([]);
        return;
      }
      const response = await requestJson<{ items: BeamRow[] }>(
        `/api/v1/documents/${document.id}/extraction-runs/${document.extraction.id}/beam-rows`,
      );
      if (active) setDocumentRows(response.items);
    };

    Promise.all([
      loadRows(engineerDocument, setEngineerRows),
      loadRows(shopDocument, setShopRows),
    ]).catch((requestError: Error) => {
      if (active) setError(requestError.message);
    });

    return () => {
      active = false;
    };
  }, [demoMode, engineerDocument, shopDocument]);

  async function updateRow(
    row: BeamRow,
    update: { review_state?: BeamRow["review_state"]; member_mark?: string; section?: string },
  ) {
    setSavingRowId(row.id);
    setError("");
    try {
      if (demoMode) {
        const applyUpdate = (items: BeamRow[]) =>
          items.map((item) =>
            item.id === row.id
              ? {
                  ...item,
                  ...update,
                  member_mark: update.member_mark ?? item.member_mark,
                  section: update.section ?? item.section,
                }
              : item,
          );
        setRows(applyUpdate);
        setShopRows(applyUpdate);
        return;
      }
      const updated = await requestJson<BeamRow>(`/api/v1/beam-rows/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(update),
      });
      setRows((current) => current.map((item) => (item.id === row.id ? updated : item)));
      setShopRows((current) =>
        current.map((item) => (item.id === row.id ? updated : item)),
      );
      const latestDocument = await requestJson<ExtractedDocument>(
        `/api/v1/documents/${selectedDocumentId}`,
      );
      onDocumentsChange((current) =>
        current.map((item) =>
          item.id === latestDocument.id ? latestDocument : item,
        ),
      );
      setDrafts((current) => {
        const next = { ...current };
        delete next[row.id];
        return next;
      });
    } catch (requestError) {
      setError((requestError as Error).message);
    } finally {
      setSavingRowId("");
    }
  }

  const viewerPage = selectedPage || rows[0]?.page_number || 1;
  const viewerUrl = selectedDocument
    ? `${API_BASE_URL}/api/v1/documents/${selectedDocument.id}/file#page=${viewerPage}`
    : "";

  return (
    <section className="review-workspace" aria-labelledby="review-heading">
      <div className="review-heading-row">
        <div>
          <div className="section-kicker"><span className="kicker-line" />EXTRACTION REVIEW</div>
          <h1 id="review-heading">Review extracted beam schedules</h1>
          <p className="intro-copy">Check each extracted value against its source PDF before using it.</p>
        </div>
        <div className="review-heading-actions">
          {demoMode && <span className="demo-badge">DEMO DATA</span>}
          <button className="browse-button" type="button" onClick={onBack}>Back to documents</button>
        </div>
      </div>
      <div className="review-document-tabs" aria-label="Uploaded documents">
        {documents.map((document) => (
          <button
            className={`review-document-tab ${selectedDocumentId === document.id ? "is-selected" : ""}`}
            key={document.id}
            type="button"
            onClick={() => setSelectedDocumentId(document.id)}
          >
            <span>{document.role === "engineer" ? "Engineer" : "Shop"} · {document.file_name}</span>
            <small>{document.status.replace("_", " ")}</small>
          </button>
        ))}
      </div>
      <VisualComparison
        engineeringFiles={sourceFiles.engineering}
        shopFiles={sourceFiles.shop}
      />
      {error && <p className="notice-message" role="alert">{error}</p>}
      {selectedDocument?.status === "queued" || selectedDocument?.status === "processing" ? (
        <div className="review-empty" role="status">PDF extraction is in progress. This view refreshes automatically.</div>
      ) : selectedDocument?.status === "failed" ? (
        <div className="notice-message" role="alert">
          Extraction failed{selectedDocument.extraction?.error_code ? ` (${selectedDocument.extraction.error_code})` : ""}: {selectedDocument.extraction?.error_message ?? "See backend logs for details."}
        </div>
      ) : selectedDocument ? (
        <>
          {selectedDocument.extraction?.diagnostics.warnings?.map((warning, index) => (
            <div className="notice-message" key={`${warning.code}-${index}`}>{warning.message}</div>
          ))}
          <div className="comparison-pdf-grid">
            {(["engineer", "shop"] as const).map((role) => {
              const document = role === "engineer" ? engineerDocument : shopDocument;
              const fileUrl = previewUrls[role];
              const backendUrl = document
                ? `${API_BASE_URL}/api/v1/documents/${document.id}/file#page=${viewerPage}`
                : "";
              const isShop = role === "shop";
              return (
                <div className={`comparison-pdf-panel ${isShop && shopRows.length > 0 ? "has-discrepancies" : ""}`} key={role}>
                  <div className="review-panel-heading">
                    <strong>{isShop ? "Shop drawing PDF" : "Engineer PDF"}</strong>
                    <span>{document?.file_name ?? "No document"}</span>
                  </div>
                  {demoMode && fileUrl ? (
                    <iframe title={`${role} PDF preview`} src={`${fileUrl}#page=${viewerPage}`} />
                  ) : demoMode ? (
                    <div className="demo-pdf">
                      <div className="demo-pdf-page">
                        <strong>{isShop ? "Shop drawing schedule" : "Engineer beam schedule"}</strong>
                        <span>Page {viewerPage}</span>
                        <div className="demo-pdf-lines" aria-hidden="true">
                          <span />
                          <span />
                          <span />
                          <span />
                        </div>
                        <p>{isShop ? "Discrepancies are highlighted below." : "Reference design values."}</p>
                      </div>
                    </div>
                  ) : (
                    <iframe title={`${role} PDF: ${document?.file_name ?? role}`} src={backendUrl} />
                  )}
                  {isShop && shopRows.length > 0 && (
                    <div className="pdf-discrepancy-ribbon">Discrepancies highlighted below</div>
                  )}
                </div>
              );
            })}
          </div>
          <section className="discrepancy-panel" aria-labelledby="discrepancy-heading">
            <div className="review-panel-heading">
              <strong id="discrepancy-heading">Review discrepancies</strong>
              <span>{shopRows.filter((shopRow) => {
                const engineerRow = engineerRows.find((row) => row.member_mark === shopRow.member_mark);
                return engineerRow && engineerRow.section !== shopRow.section;
              }).length} found</span>
            </div>
            <div className="discrepancy-list">
              {shopRows.map((shopRow) => {
                const engineerRow = engineerRows.find((row) => row.member_mark === shopRow.member_mark);
                const mismatch = engineerRow && engineerRow.section !== shopRow.section;
                if (!mismatch) return null;
                return (
                  <article className="discrepancy-card" key={shopRow.id}>
                    <div className="discrepancy-card-heading">
                      <strong>{shopRow.member_mark}</strong>
                      <span>Page {shopRow.page_number} · Shop drawing highlighted</span>
                    </div>
                    <div className="discrepancy-values">
                      <span><small>Engineer</small>{engineerRow.section}</span>
                      <span><small>Shop drawing</small><mark>{shopRow.section}</mark></span>
                    </div>
                    <p>Section size differs from the engineer-issued reference. Confirm the shop drawing before accepting.</p>
                    <div className="schedule-row-actions">
                      <button type="button" onClick={() => setSelectedPage(shopRow.page_number)}>View source</button>
                      <button type="button" onClick={() => updateRow(shopRow, { review_state: "accepted" })}>Accept discrepancy</button>
                    </div>
                  </article>
                );
              })}
              {shopRows.length > 0 && !shopRows.some((shopRow) => {
                const engineerRow = engineerRows.find((row) => row.member_mark === shopRow.member_mark);
                return engineerRow && engineerRow.section !== shopRow.section;
              }) && <div className="review-empty">No section discrepancies were found.</div>}
            </div>
          </section>
        </>
      ) : (
        <div className="review-empty">No document selected for project {projectId}.</div>
      )}
    </section>
  );
}

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
  const [projectName, setProjectName] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [reviewProjectId, setReviewProjectId] = useState("");
  const [uploadedDocuments, setUploadedDocuments] = useState<ExtractedDocument[]>([]);
  const [demoMode, setDemoMode] = useState(false);
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

  function openDemoReview() {
    setDemoMode(true);
    setReviewProjectId(DEMO_PROJECT_ID);
    setUploadedDocuments(createDemoDocuments());
    setNotice("");
  }

  async function beginReview() {
    setIsUploading(true);
    setNotice("");
    try {
      const project = await requestJson<{ id: string }>("/api/v1/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: projectName.trim() || `Local drawing review ${new Date().toLocaleDateString()}`,
        }),
      });

      const uploaded: ExtractedDocument[] = [];
      for (const [side, role] of [
        ["engineering", "engineer"],
        ["shop", "shop"],
      ] as const) {
        for (const item of files[side]) {
          const form = new FormData();
          form.append("role", role);
          form.append("file", item.file);
          form.append(
            "document_type",
            role === "engineer" ? "general_arrangement" : "shop_drawing",
          );
          uploaded.push(
            await requestJson<ExtractedDocument>(
              `/api/v1/projects/${project.id}/documents`,
              { method: "POST", body: form },
            ),
          );
        }
      }

      setReviewProjectId(project.id);
      setUploadedDocuments(uploaded);
    } catch (requestError) {
      const message = (requestError as Error).message;
      if (message.includes("Failed to fetch")) {
        openDemoReview();
        setNotice(
          "Backend is not running, so the prototype opened a clearly labeled demo review with sample extracted rows.",
        );
      } else {
        setNotice(message);
      }
    } finally {
      setIsUploading(false);
    }
  }

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

  if (reviewProjectId) {
    return (
      <div className="app-shell">
        <aside className="sidebar">
          <a className="brand" href="#" aria-label="Shop Drawing Reviewer home">
            <span className="brand-mark"><Icon name="logo" size={22} /></span>
            <span className="brand-copy"><strong>shopcheck</strong><span>STRUCTURAL REVIEW</span></span>
          </a>
          <div className="workspace-label">WORKSPACE</div>
          <nav className="sidebar-nav" aria-label="Main navigation">
            <a className="nav-item active" href="#review"><Icon name="grid" /><span>New review</span></a>
          </nav>
          <div className="sidebar-bottom">
            <div className="sidebar-help"><span className="help-mark"><Icon name="shield" size={18} /></span><div><strong>Built for engineering review</strong><p>Your judgment stays in control.</p></div></div>
            <button className="profile-button" type="button" aria-label="Account settings"><span className="avatar">GE</span><span className="profile-copy"><strong>Guest engineer</strong><span>Local preview</span></span><Icon name="settings" size={18} /></button>
          </div>
        </aside>
        <main className="main-content" id="review">
          <header className="topbar"><div className="breadcrumb"><span>Workspace</span><span className="breadcrumb-divider">/</span><strong>Extraction review</strong></div><div className="topbar-status"><span className="status-dot" />Local review</div></header>
          <div className="content-wrap">
            <ReviewWorkspace
              projectId={reviewProjectId}
              documents={uploadedDocuments}
              sourceFiles={files}
              onDocumentsChange={setUploadedDocuments}
              onBack={() => setReviewProjectId("")}
              demoMode={demoMode}
            />
            <div className="prototype-note"><span className="prototype-indicator" /><span>PDFs are stored on this machine and are not sent to external AI services.</span></div>
          </div>
        </main>
      </div>
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
                value={projectName}
                onChange={(event) => setProjectName(event.target.value)}
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

          <VisualComparison
            engineeringFiles={files.engineering}
            shopFiles={files.shop}
          />

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
                  : "PDFs upload only to the local backend."}
              </span>
            </div>
            <button
              className="continue-button"
              type="button"
              disabled={!isReady || isUploading}
              onClick={beginReview}
            >
              {isUploading ? "Uploading…" : "Continue"}
              <Icon name="arrow" size={18} />
            </button>
            <button className="demo-button" type="button" onClick={openDemoReview}>
              Open demo data
            </button>
          </div>

          <div className="prototype-note">
            <span className="prototype-indicator" />
            <span>
              Local prototype — PDFs upload to the local backend and stay outside Git.
            </span>
          </div>
        </div>
      </main>
    </div>
  );
}
