# Development roadmap and 12-week plan

## 1. MVP implementation plan

### Product increments

1. **Project and document foundation:** project create/list/detail; engineer/shop roles; immutable PDF uploads; visible processing states.
2. **Extraction and provenance:** validate PDFs, extract text, identify beam schedule rows, preserve page/bounding-box evidence, and expose parse warnings.
3. **Engineer correction loop:** review and correct extracted marks/sections before comparison; retain original values and an audit history.
4. **Deterministic comparison:** pair accepted beam rows by normalized member mark; flag ambiguity; compare conservative canonical section identifiers; create repeatable findings.
5. **Issue review UI:** list/filter findings, view source PDF pages, accept/reject/comment, and show rule evidence and run version.
6. **Hardening and pilot:** golden test corpus, access controls, upload limits, error handling, observability, backups, user acceptance, and deployment runbook.

### MVP acceptance criteria

- A user can create a project, upload both engineer and shop PDFs, and see independently tracked processing status.
- A text-based PDF beam schedule yields rows containing raw/canonical values and page/source provenance.
- Every comparison is repeatable with a recorded rule-set version and input extraction run IDs.
- Equal sections produce no mismatch; distinct sections for an unambiguous mark produce one warning with both values and source links.
- Duplicate/ambiguous marks do not produce guessed pairings.
- Failed/unsupported/scanned documents show an explicit actionable state and never appear as an empty successful parse.
- A reviewer can correct an extracted row and later identify the original extraction and the correction.
- Findings can be accepted/rejected/commented without erasing the machine-generated result.
- No production PDF or credential is stored in the repository or included in test fixtures.

## 2. 12-week development plan

Assumes a small cross-functional team: product/engineering lead, one frontend-capable developer, one backend-capable developer, and structural reviewers available weekly. The plan is a sequence of deliverables, not a promise of production readiness; adjust based on PDF corpus performance and security review.

| Week | Focus | Deliverable / exit gate |
|---|---|---|
| 1 | Product decisions and repository setup | Agree user roles, supported PDF limits, first schedule format, deployment region, retention, auth, and pilot success metrics. Create frontend/backend/test scaffolds, formatting/linting, CI, and local Postgres setup. |
| 2 | Data model and project API | Apply initial migrations; project CRUD; typed API contract; project authorization seam; API integration tests. |
| 3 | Document registration and storage | Local filesystem adapter and hosted-storage interface; upload lifecycle; immutable revisions; size/type validation; access control tests. |
| 4 | Ingestion pipeline | Worker/job lifecycle and retries; PDF validation/page metadata; PyMuPDF text extraction; observable failure states and diagnostics. |
| 5 | Beam schedule parsing | Parse the first agreed schedule layout; capture raw rows, mark, section, page and bounding box; begin golden synthetic/approved fixture set. |
| 6 | Extraction review UI | Document status screen, PDF.js page viewer, extracted-row table, corrections and provenance; structural engineer review of extraction errors. |
| 7 | Rule engine and comparison | Stable canonicalizer; mark matching; duplicate/ambiguous handling; `BEAM_SECTION_MISMATCH`; deterministic rule tests. |
| 8 | Comparison API and issue review | Comparison run snapshots; issue list/filter; evidence navigation; review event workflow; API and UI integration tests. |
| 9 | Quality and failure behavior | Expand fixture diversity; measure extraction and match metrics; test corrupt, encrypted, scanned, empty, and oversized PDFs; fix high-impact false positives. |
| 10 | Security and deployment readiness | Hosted authentication integration, authorization tests, secret management, private storage, resource limits, backups, structured logs, and threat review. |
| 11 | Pilot/UAT | Run representative non-confidential or approved projects with checking engineers; triage false positives and UX issues; document known limits and support workflow. |
| 12 | Release decision | Close critical pilot gaps; verify restore/retention process; publish versioned rules and user guide; decide go/no-go using pre-agreed acceptance thresholds. |

## 3. Roadmap beyond MVP

**Near term:** robust extraction for multiple schedule layouts, OCR behind an explicit low-confidence path, section catalog validation, CSV/XLSX evidence export, revision comparison, and drawing markup only after viewer/evidence behavior is trusted.

**Later:** column and connection schedule extraction, general arrangement references, notes and revision checks, more configurable organization rules, cloud collaboration, and validated support for additional LLM providers.

Each feature requires a labeled test corpus, measured false-positive/false-negative behavior, a human disposition flow, and a migration/versioning plan before enabling it for project work.

## 4. Team working agreements

- Structural engineers own rule meaning and acceptance thresholds; software developers own reliable implementation and observability.
- Every rule change includes positive, negative, boundary, and ambiguous-input tests plus a version/change note.
- Use synthetic fixtures or approved/licensed drawings. Real project PDFs stay in approved access-controlled storage, not git, issues, or unapproved AI services.
- Keep pull requests small, reviewable, and documented. Run formatters, static checks, unit tests, and relevant integration tests in CI.
- Do not silently drop parser warnings or use an AI answer as a substitute for missing source evidence.

## 5. Decisions to resolve before production

1. Identity provider, user/organization model, and tenant-isolation requirements.
2. Hosting region, data residency, encryption/key ownership, retention and deletion policy, backup/restore targets.
3. Whether any document text may be sent to OpenAI, under which service terms and data-retention settings; default is no AI transmission until approved.
4. Supported PDF size/page limits and first target beam schedule layouts.
5. Pilot corpus access/permissions, ground-truth labeling, and acceptance thresholds for extraction and comparison.
6. Review status semantics, audit retention, and whether accepted/rejected decisions need formal sign-off.
7. Frontend/backend deployment platform and operational ownership.
