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

The prototype is intended for individual engineers running it locally, without login. The frontend remains a UI scaffold; the backend supports project CRUD and local PDF registration/storage. PDF extraction, comparison, and issue review are not implemented yet.

## Engineering and data handling principles

1. A finding must be reproducible from stored extracted values and a versioned rule.
2. Preserve original values and page-level evidence; never silently normalize away discrepancies.
3. Ambiguous or missing evidence must be reported as such, not guessed.
4. Review decisions are attributable and do not alter the original documents or generated finding.
5. Uploaded project drawings are confidential: keep working PDFs on the developer's machine outside this Git repository. Only synthetic or explicitly approved/licensed test fixtures may be committed. Do not send document content to external AI services unless explicitly approved.
6. Engineers remain responsible for review and disposition.

## Development status

The local frontend and backend foundations are in place. Project CRUD and PDF registration now persist to PostgreSQL, with uploaded PDFs stored outside the repository. A separate worker validates uploaded PDFs, records page metadata and selectable text, and reports explicit processing states; beam schedule parsing, comparisons, and issue review remain to be implemented. Hosted authentication and production data-retention/deployment decisions are out of scope for this prototype.

## Run the frontend preview

Install Node.js LTS, then from the repository root run:

```powershell
cd frontend
npm install
npm run dev
```

Open the local URL printed by Next.js (normally `http://localhost:3000`). The welcome screen supports selecting or dragging multiple PDFs into the engineer-issued and shop-drawing panels. This is a UI scaffold only: files remain in the browser and are not uploaded or processed.

Run `npm run typecheck` to check the frontend TypeScript types.

## Run the local backend and database

Install Python 3.12 or later and Docker Desktop. From the repository root, start PostgreSQL:

```powershell
docker compose up -d db
```

In another terminal, install the backend and its development tools, then start the API:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -e ".[dev]"
```

Apply the initial schema and start the API:

```powershell
python -m app.migrate
uvicorn app.main:app --reload
```

Start the worker in a third terminal, using the same backend virtual environment:

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
python -m app.worker.runner
```

The worker polls the PostgreSQL queue and retries transient failures up to three times. For a single-job run, use `python -m app.worker.runner --once`. The API health check is at `http://localhost:8000/health`; interactive API documentation is at `http://localhost:8000/docs`. Project create/list/detail/update/delete routes are available under `/api/v1/projects`; multipart PDF upload and document listing are available under `/api/v1/projects/{project_id}/documents`. Uploaded PDFs default to `%LOCALAPPDATA%\ShopDrawingReviewer\uploads` on Windows or `~/.local/share/shop-drawing-reviewer/uploads` elsewhere; set `SHOP_REVIEWER_STORAGE_DIR` to choose another local folder. Uploads are checked for a PDF header, then the worker validates and extracts page dimensions and selectable text. Scanned/no-text files are marked `needs_review` with an OCR-not-enabled warning; corrupt and encrypted PDFs receive explicit failure statuses. No prototype size/page limit is imposed. The database is bound to localhost and uses prototype-only credentials. Stop the API and worker with Ctrl+C and stop PostgreSQL with `docker compose down` from the repository root.

Run backend checks from `backend/` with `ruff check app tests` and `pytest`. PostgreSQL integration tests run when `TEST_DATABASE_URL` is set and migrations have been applied; the CI workflow provisions a test database automatically.
