# Shop Drawing Reviewer

An engineering-led application for comparing fabricator steel shop drawings with engineer-issued documents. The MVP extracts beam schedules from PDFs, compares member sizes deterministically, and presents traceable findings for engineer review.

> This tool supports review; it does not approve drawings, replace engineering judgment, or establish design adequacy.

## MVP scope

- Create projects and upload engineer-issued and shop-drawing PDFs.
- Extract PDF text and beam schedule rows, preserving page and source evidence.
- Match members by mark and compare section sizes using deterministic rules.
- Present issues with their source references and allow engineers to review the results.
- Keep AI optional and limited to drafting explanations from verified findings.

Out of scope for the first release: general-purpose drawing vision, connection geometry checks, automatic drawing approval, production-grade PDF markup, and cloud collaboration. The local frontend includes an experimental, rasterized first-page markup preview.

## Repository layout

```text
frontend/
  src/app/                 Next.js routes and page composition
  src/features/            Project, document, extraction, and issue workflows
  src/components/          Shared UI and PDF.js viewer components
  src/lib/                  Typed API client and frontend utilities
backend/
  app/api/                  FastAPI routers and request/response schemas
  app/projects/             Project use cases and persistence
  app/documents/             Upload lifecycle and metadata
  app/extraction/            PDF extraction and schedule parsers
  app/comparison/            Run orchestration and issue creation
  app/rules/                 Deterministic rule engine
  app/ai/                    Optional provider adapters
  app/storage/               Local and cloud storage adapters
  app/worker/                Background job runner
  migrations/                Versioned PostgreSQL schema changes
docs/                        Architecture, data model, API, and delivery plan
engineering-rules/           Versioned deterministic comparison rules
sample-drawings/              Synthetic or explicitly licensed test PDFs only
tests/
  unit/                       Parser, normalization, and rule tests
  integration/                API, database, and storage tests
  e2e/                        Critical user workflow tests
```

See [Solution architecture](docs/SOLUTION_ARCHITECTURE.md), [Data model](docs/DATA_MODEL.md), [API design](docs/API_DESIGN.md), and [Development plan](docs/DEVELOPMENT_PLAN.md).

## Suggested local prerequisites

- Node.js LTS and npm
- Python 3.12+ and `uv` (or a Python virtual environment with pip)
- PostgreSQL 16+
- Docker Desktop (optional, for local PostgreSQL)

The frontend currently provides a runnable local UI preview with an experimental, browser-only comparison of the first page in each PDF. It highlights pixel-difference candidates and can export a marked-up copy of the shop drawing. Backend services, authentication, and production data-retention policy remain to be implemented and agreed.

## Engineering and data handling principles

1. A finding must be reproducible from stored extracted values and a versioned rule.
2. Preserve original values and page-level evidence; never silently normalize away discrepancies.
3. Ambiguous or missing evidence must be reported as such, not guessed.
4. Review decisions are attributable and do not alter the original documents or generated finding.
5. Uploaded project drawings are confidential: never put real project files in source control or external AI prompts without an approved data-handling decision.
6. Engineers remain responsible for review and disposition.

## Development status

Architecture and implementation plan are documented. The frontend includes an experimental browser-only first-page registration and pixel-difference prototype. Backend services, authentication, deployment configuration, and production data-retention policy remain to be implemented and agreed.

## Run the frontend preview

Install Node.js LTS, then from the repository root run:

```powershell
cd frontend
npm install
npm run dev
```

Open the local URL printed by Next.js (normally `http://localhost:3000`). Select the engineer-issued and shop PDFs, then choose **Compare first pages**. The first PDF in each panel is rendered in the browser, aligned using shared visual features, and compared. A rasterized, aligned view of the shop drawing with candidate differences can be downloaded. Files stay in the browser and are not uploaded.

This is experimental visual registration and pixel comparison, not engineering review automation. It can compensate for page size, scale, rotation, and translation differences when the pages contain enough shared visual features. Low-confidence matches are rejected. It does not analyze later pages, correct perspective distortion, or reliably handle unrelated drawings, substantial redesigns, or different crops that share too little content. It may flag text/revision differences or miss real discrepancies, so review the alignment, originals, and every highlighted candidate. The exported PDF contains only the aligned first page and is rasterized. The `sample-drawings` folder contains a synthetic pair with an intentionally shifted beam for trying the workflow.

Run `npm run typecheck` to check the frontend TypeScript types.
