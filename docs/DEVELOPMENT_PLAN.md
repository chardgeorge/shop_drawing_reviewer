# Development roadmap and 12-week plan

## 1. MVP implementation plan

### Product increments

1. **Project and document foundation:** project create/list/detail; engineer/shop roles; immutable PDF uploads; visible processing states.
2. **Extraction and provenance:** validate PDFs, extract text, identify beam schedule rows, preserve page/bounding-box evidence, and expose parse warnings.
3. **Engineer correction loop:** review and correct extracted marks/shape designations before comparison; retain original values and an audit history.
4. **Deterministic comparison:** pair accepted beam rows by normalized member mark; flag ambiguity; compare conservative canonical AISC shape designations; create repeatable findings.
5. **Issue review UI:** list/filter findings, view source PDF pages, accept/reject/comment, and show rule evidence and run version.
6. **Hardening and pilot:** golden test corpus, access controls, upload limits, error handling, observability, backups, user acceptance, and deployment runbook.

### MVP acceptance criteria

- A user can create a project, upload both engineer and shop PDFs, and see independently tracked processing status.
- A text-based PDF beam schedule yields rows containing raw/canonical values and page/source provenance.
- Every comparison is repeatable with a recorded rule-set version and input extraction run IDs.
- Identical shape designations produce no mismatch; different shape designations for an unambiguous mark produce one warning with both values and source links.
- Duplicate/ambiguous marks do not produce guessed pairings.
- Failed/unsupported/scanned documents show an explicit actionable state and never appear as an empty successful parse.
- A reviewer can correct an extracted row and later identify the original extraction and the correction.
- Findings can be accepted/rejected/commented without erasing the machine-generated result.
- No production PDF or credential is stored in the repository or included in test fixtures.

## 2. 12-week development plan

Assumes a small cross-functional team: product/engineering lead, one frontend-capable developer, one backend-capable developer, and structural reviewers available weekly. The plan is a sequence of deliverables, not a promise of production readiness; adjust based on PDF corpus performance and security review.

| Week | Focus | Deliverable / exit gate |
|---|---|---|
| 1 | Product decisions and repository setup | Prototype scope agreed. Frontend/backend/test scaffolds, CI, and local Postgres configuration are in place; verify them in a configured local environment. |
| 2 | Data model and project API | Project CRUD, typed API contract, migration runner, PostgreSQL integration tests, and CI database service implemented; PostgreSQL integration verification runs in CI or locally when a database is configured. |
| 3 | Document registration and storage | Local filesystem-backed multipart upload, opaque immutable storage keys, PDF metadata/hash registration, validation, listing, and PostgreSQL integration coverage implemented; hosted-storage adapter remains deferred. |
| 4 | Ingestion pipeline | Durable retryable worker queue, PyMuPDF validation/text extraction, per-page dimensions/text, scanned-PDF warning state, and observable failures implemented; PostgreSQL integration runs in CI or when a local database is configured. |
| 5 | Beam schedule parsing | Implemented a conservative selectable-text parser for one generic two-column header layout; persist raw/canonical values, page/bounding-box provenance, confidence, and warnings. Synthetic parser tests cover normal and duplicate marks. Layout-specific golden-corpus/engineer validation remains open. |
| 6 | Extraction review UI | Implemented project/PDF upload, ingestion-status polling, browser PDF viewing, extracted-row review, correction, accept/reject, and source provenance. The native browser viewer is used instead of PDF.js. Engineer validation and visual bbox overlays remain open. |
| 7 | Rule engine and comparison | Stable canonicalizer; mark matching; duplicate/ambiguous handling; `BEAM_SHAPE_MISMATCH`; deterministic rule tests. |
| 8 | Comparison API and issue review | Comparison run snapshots; issue list/filter; evidence navigation; review event workflow; API and UI integration tests. |
| 9 | Quality and failure behavior | Expand fixture diversity; measure extraction and match metrics; test corrupt, encrypted, scanned, empty, and oversized PDFs; fix high-impact false positives. |
| 10 | Security and deployment readiness | Hosted authentication integration, authorization tests, secret management, private storage, resource limits, backups, structured logs, and threat review. |
| 11 | Pilot/UAT | Run representative non-confidential or approved projects with checking engineers; triage false positives and UX issues; document known limits and support workflow. |
| 12 | Release decision | Close critical pilot gaps; verify restore/retention process; publish versioned rules and user guide; decide go/no-go using pre-agreed acceptance thresholds. |

## 3. Roadmap beyond MVP

**Near term:** robust extraction for multiple schedule layouts, OCR behind an explicit low-confidence path, validation of designations against the AISC Shapes Database, CSV/XLSX evidence export, revision comparison, and drawing markup only after viewer/evidence behavior is trusted.

**Later:** column and connection schedule extraction, framing plan and erection drawing references, notes and revision checks, more configurable organization rules, cloud collaboration, and validated support for additional LLM providers.

Each feature requires a labeled test corpus, measured false-positive/false-negative behavior, a human disposition flow, and a migration/versioning plan before enabling it for project work.

## 4. Team working agreements

- Structural engineers own rule meaning and acceptance thresholds; software developers own reliable implementation and observability.
- Every rule change includes positive, negative, boundary, and ambiguous-input tests plus a version/change note.
- Use synthetic fixtures or approved/licensed drawings. Real project PDFs stay in approved access-controlled storage, not git, issues, or unapproved AI services.
- Keep pull requests small, reviewable, and documented. Run formatters, static checks, unit tests, and relevant integration tests in CI.
- Do not silently drop parser warnings or use an AI answer as a substitute for missing source evidence.

## 5. Agreed local prototype decisions

These decisions scope the local prototype only; they do not establish production requirements.

- **Users and access:** individual engineers running the app locally; no login or credentials.
- **PDF input:** assume selectable-text PDFs. Scanned PDFs and OCR are out of scope for the initial prototype.
- **PDF limits:** no fixed size or page-count limits for the prototype. Add limits if local testing shows they are needed.
- **File storage:** keep working project PDFs on the developer's machine, outside the Git repository. Only synthetic or explicitly approved/licensed fixtures may be committed.
- **AI and document data:** default to no transmission of document content to external AI services. Revisit only with explicit data-handling approval.

## 6. Decisions to resolve before production

1. Identity provider, user/organization model, and tenant-isolation requirements.
2. Hosting region, data residency, encryption/key ownership, retention and deletion policy, backup/restore targets.
3. Whether any document text may be sent to an AI service, under which service terms and data-retention settings; prototype default is no transmission until approved.
4. Supported PDF size/page limits and first target beam schedule layouts beyond selectable-text PDFs.
5. Pilot corpus access/permissions, ground-truth labeling, and acceptance thresholds for extraction and comparison.
6. Review status semantics, audit retention, and whether accepted/rejected decisions need formal sign-off.
7. Frontend/backend deployment platform and operational ownership.
