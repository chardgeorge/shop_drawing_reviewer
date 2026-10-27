# Solution architecture

## 1. Goals and boundaries

Version 1 is a document-ingestion and beam-schedule comparison product, not an autonomous drawing checker. It should produce a small set of explainable, reviewable findings and show where each input came from.

### In scope

- Projects and document uploads, separated into engineer-issued and fabricator/shop document sets.
- PDF text extraction, beam schedule row extraction, and review of extraction results.
- Beam identification by member mark and deterministic section comparison.
- An issue list with finding evidence, statuses, and reviewer decisions/comments.
- Export of findings as structured data. Production-quality marked-up PDF export is a later release; the local frontend prototype can produce a rasterized first-page candidate markup.

### Explicitly out of scope for MVP

- General arrangement geometry interpretation, computer vision, or inferred member connectivity.
- Connection design checks or engineering capacity verification.
- Automatic acceptance, approval, or issue closure.
- Production PDF markup and cloud collaboration. The prototype's rasterized first-page markup is not an engineering deliverable.

## 2. Recommended architecture

Use a **modular monolith**: one Next.js application, one FastAPI API, one separately runnable worker process using the same backend package, and PostgreSQL. Separate modules by responsibility, not by network service. This keeps local development and deployment understandable for an engineering-led team while preserving clear seams for later scaling.

```text
Engineer browser
  ├─ Next.js UI (projects, documents, extraction review, issue review)
  ├─ PDF.js viewer (page navigation and source highlights)
  └─ HTTPS API calls
        │
        ▼
FastAPI application ───── PostgreSQL
  ├─ project/document API    ├─ project metadata
  ├─ upload authorization    ├─ extraction and row evidence
  ├─ extraction orchestration├─ comparison runs and issues
  └─ review / export API     └─ worker jobs and audit events
        │
        ├──────── private object storage (local adapter in development;
        │          S3 or Azure Blob in hosted environments)
        ▼
Background worker
  ├─ PDF validation and metadata
  ├─ PyMuPDF text extraction (PDFPlumber as a targeted table fallback)
  ├─ beam schedule parser and normalization
  ├─ deterministic rule engine
  └─ optional OpenAI explanation drafting
```

## 3. Responsibilities and boundaries

| Component | Owns | Must not own |
|---|---|---|
| Next.js frontend | Project/document workflows, extraction correction UI, issue disposition, PDF rendering | Engineering comparison logic or secrets |
| FastAPI API | Authentication/authorization boundary, request validation, signed upload/download access, lifecycle orchestration | Long-running PDF processing in request handlers |
| Ingestion module | PDF validation, text/table extraction, source coordinates, parser output | Making engineering acceptance decisions |
| Rule engine | Matching and deterministic comparisons against versioned rules | AI-generated conclusions or silent assumptions |
| AI adapter | Optional, constrained wording of an existing finding | Finding new discrepancies or changing issue status |
| PostgreSQL | Durable metadata, normalized data, run results, evidence, audit trail | Storing PDF binary data |
| Object storage | Original PDFs and generated derivatives | Public access to project documents |

Keep the API, extraction, comparison, and AI code in distinct Python packages under `backend/app/`. The worker should call these modules directly; avoid coupling product logic to a task-queue vendor.

## 4. Document processing flow

1. A user creates a project and registers a document with role `engineer` or `shop`.
2. The API issues a short-lived upload authorization for private object storage (or accepts a bounded local-development upload).
3. The API verifies upload completion, records size, MIME type, checksum, and immutable storage key, then enqueues an ingestion job.
4. The worker validates the PDF, records page count and text-extraction diagnostics, and extracts page text with PyMuPDF.
5. A beam-schedule parser emits candidate rows with raw text, normalized values, page number, and source bounding box. PDFPlumber may be used for a page/table when text layout warrants it; OCR is not required for MVP and scanned pages are flagged for manual handling.
6. The UI shows extracted rows and lets a reviewer correct or mark uncertain rows before comparison. Corrections are stored as reviewer edits with provenance, not written into the original PDF.
7. A comparison run consumes selected engineer/shop document versions and the accepted extracted rows. It snapshots the rule-set version and emits reproducible issues.
8. The issue list shows evidence links that open the corresponding PDF page and, where available, highlight the source bounding box. Users accept, reject, or comment; the original finding remains unchanged.

Every processing step has a durable status, timestamps, and explicit error details. Retries must be idempotent and must not create duplicate issues for the same run.

## 5. PDF and storage decisions

- Keep originals immutable. Re-uploading a revision creates a new document record; do not overwrite a prior object.
- Store only opaque object keys in PostgreSQL. Use private buckets/containers, encryption at rest, TLS, narrowly scoped short-lived signed URLs, and project-level authorization.
- Compute a cryptographic checksum at upload completion for integrity and duplicate detection, not as a substitute for authorization.
- Enforce upload size, page count, supported media type, and processing-time limits. Treat files as untrusted input.
- In local development, provide a filesystem-backed storage adapter with the same interface as the hosted object-storage adapter.
- Make retention, residency, backup, deletion, and AI-provider data handling explicit deployment decisions before production use.

## 6. Reliability, security, and observability

- Require authenticated access in hosted environments; authorize every project/document/issue access on the server. Do not rely on obscurity of UUIDs.
- Use an organization/tenant boundary before onboarding multiple customer organizations. The initial local MVP may use a single development workspace, but its service interfaces must not bypass authorization checks.
- Keep API tokens and provider credentials in server-side secret storage. Never expose them to the browser or store them in frontend local storage.
- Record structured logs with request/job/run IDs; exclude PDF contents, credentials, and unnecessary personal data.
- Track ingestion duration, extraction failure rate, parser review rate, comparison counts, and AI draft failures.
- Use database transactions for publishing a completed extraction/comparison result. Expose a failed state and actionable error; do not report success with partial output.
- Pin and review PDF parsing dependencies, and isolate processing with resource limits in hosted deployments.

## 7. AI integration architecture

AI is an optional presentation layer invoked only after a deterministic rule has created a finding. Implement a small provider interface in the backend (for example, `ExplanationProvider.generate(finding, evidence)`) with an OpenAI adapter first and a Claude adapter only when separately approved. The rule engine must not depend on an AI provider.

### Input and output contract

- Send only the minimum fields needed to explain the finding: rule code/version, compared values, relevant source labels/pages, and the deterministic rule message. Do not send an entire PDF by default.
- Extracted drawing text is untrusted input. Treat it as quoted evidence, not instructions; it cannot change the comparison, system behavior, severity, or disposition.
- Request a constrained structured response such as `{ "draft_comment": "...", "limitations": ["..."] }`. Validate against a schema, enforce length limits, and reject malformed or unsupported output.
- The generated comment may clarify the already-established discrepancy, but it may not invent design intent, assert code compliance, recommend acceptance, change status, or omit the mismatch.
- Label the result “AI-generated draft”; allow engineer editing and preserve the deterministic finding separately.
- Store provider/model and generation timestamp for traceability. Do not retain prompts or responses beyond product needs and the approved retention policy.

### Failure and governance behavior

- AI is off by default until the organization approves document-data transmission, provider terms, region, retention settings, and user notice.
- On timeout, quota failure, invalid response, or unavailable provider, retain and display the rule-generated issue and its standard wording; report the draft as unavailable rather than fabricating a fallback AI response.
- Apply server-side timeouts, bounded retries for transient errors, rate limits, and cost monitoring. Never expose provider credentials in the browser.
- Keep provider selection behind configuration and dependency injection. Add another provider only after equivalent privacy, schema-validation, evaluation, and audit checks.
- Maintain a small evaluated set of findings and expected safe explanations. Review outputs for factual support, omission of evidence, and unsupported engineering conclusions before enabling the feature.

## 8. Engineering trust and quality gates

- All findings show: rule identifier/version, compared raw and normalized values, source document/revision, page and location, and the comparison-run ID.
- A missing counterpart is a finding only when the relevant schedules are known to be sufficiently complete. Otherwise show an extraction/completeness warning.
- Duplicate marks, unreadable values, and uncertain parses are surfaced for resolution; they are not arbitrarily paired.
- Section normalization is conservative and retains the exact source string. Do not equate different designations through guessed aliases.
- AI output is labeled as a draft, generated only from a rule finding and its evidence, schema-validated, and editable. If generation fails, the deterministic finding still works.
- Build a golden test set of synthetic or appropriately licensed PDFs. Track parser precision/recall, correct match rate, and false-positive rate; engineers approve the acceptance thresholds before release.
- Do not describe the system as performing code compliance or structural adequacy checks.

## 9. Evolution path

When operational evidence justifies it, the modular boundaries can support a queue service, OCR provider, additional schedules, or another LLM provider. Add each as an adapter behind stable internal interfaces. Do not split into microservices or add vector search until measured scale or a concrete workflow requires them.
