# Shop Drawing Reviewer

A browser-based tool for visually comparing one engineer-issued drawing PDF with one shop drawing PDF. It aligns the selected pages and highlights candidate visual differences.

> This tool supports review; it does not approve drawings, replace engineering judgment, or establish design adequacy.

## Frontend scope

- Select one engineer-issued PDF and one shop PDF.
- Compare selected pages directly in the browser, without uploading the files to a backend.
- Align pages with shared visual geometry and highlight candidate pixel differences.
- Download a rasterized markup of the aligned shop page.

The comparison is experimental and does not approve drawings or replace engineering judgment.

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

The current frontend is a standalone PDF comparison tool. The repository also retains backend project and extraction services, which are not used by this frontend flow.

## Engineering and data handling principles

1. Drawing PDFs are confidential: keep real project files local and outside this Git repository.
2. The frontend compares PDFs in the browser; it does not send their content to external AI services.
3. Visual candidates are not engineering conclusions. Engineers remain responsible for reviewing the original drawings and deciding what to do.

## Development status

The frontend provides browser-only page registration and pixel-difference comparison. Backend project and extraction services remain in the repository but are not part of this comparison workflow.

## Run the frontend preview

Install Node.js LTS, then from the repository root run:

```powershell
cd frontend
npm install
npm run dev
```

Open the local URL printed by Next.js (normally `http://localhost:3000`). Select one engineer-issued PDF and one shop PDF, choose a page and printed scale for each (imperial or metric), and choose **Align selected pages**. The pages are rendered and automatically aligned using shared visual features; the measured alignment scale is checked against the expected ratio from the selected scales. Different page dimensions are fitted to a shared canvas with white space as needed, preserving both pages' full extents. Drag the aligned shop page and adjust its scale or rotation to fine-tune registration. A 10 × 10 grid can be toggled on both pages during alignment and review. Choose **Find discrepancies** to highlight candidate discrepancies on both previews. Separate rasterized marked-page PDFs can be downloaded for each page. Small differences within a one-pixel neighborhood are ignored to reduce line-weight and rasterization noise. Files stay in the browser and are not uploaded to the backend.

This is experimental visual registration and pixel comparison, not engineering review automation. It supports page-size, scale, rotation, translation, and moderate affine skew differences when the pages retain enough shared geometry. Low-confidence matches are rejected. It cannot reliably compare unrelated drawings, substantial redesigns, severe crops, or perspective-distorted scans, and it does not automatically identify corresponding pages across PDFs; select the pages to compare. Text, revisions, and title-block changes may be highlighted, and real differences may be missed. Review the alignment, originals, and every candidate. Downloads contain only the selected page, rendered as a rasterized image with candidate highlights; they do not replace or modify the source PDFs. Use sample PDFs that you have permission to test, stored locally; do not commit project drawings to this repository.

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

The worker polls the PostgreSQL queue and retries transient failures up to three times. For a single-job run, use `python -m app.worker.runner --once`. The API health check is at `http://localhost:8000/health`; interactive API documentation is at `http://localhost:8000/docs`. Project CRUD routes are under `/api/v1/projects`; multipart PDF upload and document listing are under `/api/v1/projects/{project_id}/documents`. Uploaded PDFs default to `%LOCALAPPDATA%\ShopDrawingReviewer\uploads` on Windows or `~/.local/share/shop-drawing-reviewer/uploads` elsewhere; set `SHOP_REVIEWER_STORAGE_DIR` to choose another local folder. The worker extracts per-page text and dimensions and attempts the documented first beam schedule layout. Rows preserve original text, normalized values, page coordinates, confidence, and review state. Unrecognized layouts and scanned/no-text files receive actionable warnings and `needs_review`; corrupt and encrypted PDFs receive explicit failure statuses. No prototype size/page limit is imposed. The database is bound to localhost and uses prototype-only credentials. Stop the API and worker with Ctrl+C and stop PostgreSQL with `docker compose down` from the repository root.

Run backend checks from `backend/` with `ruff check app tests` and `pytest`. PostgreSQL integration tests run when `TEST_DATABASE_URL` is set and migrations have been applied; the CI workflow provisions a test database automatically.
