# Shop Drawing Reviewer

An engineering-led application for comparing fabricator steel shop drawings with engineer-issued documents. The MVP extracts beam schedules from PDFs, compares member sizes deterministically, and presents traceable findings for engineer review.

> This tool supports review; it does not approve drawings, replace engineering judgment, or establish design adequacy.

## MVP scope

- Create projects and upload engineer-issued and shop-drawing PDFs.
- Extract PDF text and beam schedule rows, preserving page and source evidence.
- Match members by mark and compare section sizes using deterministic rules.
- Present issues with their source references and allow engineers to review the results.
- Keep AI optional and limited to drafting explanations from verified findings.

Out of scope for the first release: general-purpose drawing vision, connection geometry checks, automatic drawing approval, and automatic PDF markup.

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

The frontend currently provides a runnable local UI preview. Backend services, authentication, and production data-retention policy remain to be implemented and agreed.

## Engineering and data handling principles

1. A finding must be reproducible from stored extracted values and a versioned rule.
2. Preserve original values and page-level evidence; never silently normalize away discrepancies.
3. Ambiguous or missing evidence must be reported as such, not guessed.
4. Review decisions are attributable and do not alter the original documents or generated finding.
5. Uploaded project drawings are confidential: never put real project files in source control or external AI prompts without an approved data-handling decision.
6. Engineers remain responsible for review and disposition.

## Development status

Architecture and implementation plan are documented. The initial frontend welcome screen is scaffolded; backend services, authentication, deployment configuration, and production data-retention policy remain to be implemented and agreed.

## Run the frontend preview

Install Node.js LTS, then from the repository root run:

```powershell
cd frontend
npm install
npm run dev
```

Open the local URL printed by Next.js (normally `http://localhost:3000`). The welcome screen supports selecting or dragging multiple PDFs into the engineer-issued and shop-drawing panels. This is a UI scaffold only: files remain in the browser and are not uploaded or processed until the backend is implemented.

Run `npm run typecheck` to check the frontend TypeScript types.
