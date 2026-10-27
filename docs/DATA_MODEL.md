# Engineering data model

## 1. Modeling principles

- Keep source text, normalized values, and reviewer corrections separate.
- Attach every extracted value to an immutable document revision and page-level evidence.
- Treat a comparison as a reproducible run over selected extraction versions and a rule-set version.
- Do not infer a section, match, or missing member when evidence is ambiguous.
- Store dimensions and units explicitly when applicable. A section designation is a catalog identifier/string, not a dimension to convert.

## 2. Core entities

| Entity | Purpose | Important fields |
|---|---|---|
| Project | Review workspace and project metadata | `id`, `name`, `project_number`, `created_by`, timestamps |
| Document | Immutable uploaded PDF and its role/revision | `id`, `project_id`, `role`, `revision`, `file_name`, `storage_key`, `sha256`, `status` |
| Extraction run | One versioned attempt to read one document | `id`, `document_id`, `extractor_version`, `status`, `page_count`, diagnostics |
| Schedule row | Beam schedule candidate with provenance | `id`, `extraction_run_id`, `schedule_type`, `member_mark_raw`, `member_mark_normalized`, `section_raw`, `section_normalized`, page/bounding box, confidence |
| Comparison run | Snapshot of selected source runs and rules | `id`, project, engineer/shop extraction IDs, rule-set version, status, timestamps |
| Issue | Deterministic discrepancy or review warning | `id`, comparison run, rule code, severity, status, values, evidence references |
| Review event | Append-only disposition/comment history | `id`, issue, actor, action, comment, timestamp |

Use UUID primary keys and UTC timestamps. Use PostgreSQL `jsonb` only for bounded, versioned diagnostics or evidence payloads; keep commonly queried fields relational.

## 3. Beam data contract

Illustrative extracted schedule row:

```json
{
  "schedule_type": "beam",
  "member_mark_raw": "B21",
  "member_mark_normalized": "B21",
  "section_raw": "UB610x229x140",
  "section_normalized": "UB610x229x140",
  "page_number": 4,
  "source_bbox": { "x0": 72.1, "y0": 103.2, "x1": 280.0, "y1": 122.8 },
  "extractor": "pymupdf",
  "confidence": 0.97,
  "review_state": "needs_review"
}
```

Bounding boxes are in PDF page coordinates and must be paired with the page's width/height and coordinate convention. Confidence is parser confidence, not confidence that the engineering design is correct. The exact raw value remains available even when a normalizer is added.

An accepted row uses a reviewer-approved value while retaining the original extracted value and reviewer/event provenance. Never mutate the extraction output in place.

## 4. Issue data contract

```json
{
  "rule_code": "BEAM_SECTION_MISMATCH",
  "rule_version": "1",
  "severity": "warning",
  "status": "open",
  "member_mark": "B21",
  "engineer_value": { "section_raw": "UB610x229x140" },
  "shop_value": { "section_raw": "UB530x209x101" },
  "message": "Member size differs from the engineer-issued schedule. Verify the intended substitution.",
  "evidence": [
    { "document_id": "uuid", "page_number": 4, "schedule_row_id": "uuid" },
    { "document_id": "uuid", "page_number": 7, "schedule_row_id": "uuid" }
  ]
}
```

Issue severity is a triage aid, not an engineering risk classification. The initial mismatch rule should use a non-blocking `warning`; final severity policy is a product/engineering decision.

## 5. PostgreSQL starter schema

The migration below is a foundation for the MVP. Add new changes as forward-only migrations; do not edit an applied migration. It intentionally stores file metadata, not PDF bytes.

```sql
-- backend/migrations/001_initial_schema.sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE projects (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
    project_number text,
    description text,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE documents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    role text NOT NULL CHECK (role IN ('engineer', 'shop')),
    document_type text NOT NULL DEFAULT 'unknown'
        CHECK (document_type IN ('general_arrangement', 'shop_drawing', 'schedule', 'other', 'unknown')),
    file_name text NOT NULL,
    revision text,
    storage_key text NOT NULL UNIQUE,
    media_type text NOT NULL CHECK (media_type = 'application/pdf'),
    file_size_bytes bigint NOT NULL CHECK (file_size_bytes > 0),
    sha256 char(64) NOT NULL,
    status text NOT NULL DEFAULT 'uploaded'
        CHECK (status IN ('uploaded', 'queued', 'processing', 'ready', 'needs_review', 'failed')),
    uploaded_by text NOT NULL,
    uploaded_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (project_id, id)
);
CREATE INDEX documents_project_role_idx ON documents(project_id, role, uploaded_at DESC);

CREATE TABLE extraction_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    run_number integer NOT NULL CHECK (run_number > 0),
    extractor_version text NOT NULL,
    status text NOT NULL CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
    page_count integer CHECK (page_count IS NULL OR page_count >= 0),
    diagnostics jsonb NOT NULL DEFAULT '{}'::jsonb,
    error_code text,
    error_message text,
    started_at timestamptz,
    completed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (document_id, run_number),
    CHECK ((status = 'failed') OR error_code IS NULL)
);
CREATE INDEX extraction_runs_document_idx ON extraction_runs(document_id, created_at DESC);

CREATE TABLE schedule_rows (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    extraction_run_id uuid NOT NULL REFERENCES extraction_runs(id) ON DELETE CASCADE,
    schedule_type text NOT NULL CHECK (schedule_type IN ('beam')),
    row_number integer,
    member_mark_raw text,
    member_mark_normalized text,
    section_raw text,
    section_normalized text,
    page_number integer NOT NULL CHECK (page_number > 0),
    page_width numeric,
    page_height numeric,
    source_bbox jsonb,
    extractor text NOT NULL,
    confidence numeric CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
    review_state text NOT NULL DEFAULT 'needs_review'
        CHECK (review_state IN ('needs_review', 'accepted', 'rejected')),
    reviewed_by text,
    reviewed_at timestamptz,
    correction jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (source_bbox IS NULL OR jsonb_typeof(source_bbox) = 'object')
);
CREATE INDEX schedule_rows_run_mark_idx ON schedule_rows(extraction_run_id, member_mark_normalized);

CREATE TABLE comparison_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    engineer_extraction_run_id uuid NOT NULL REFERENCES extraction_runs(id),
    shop_extraction_run_id uuid NOT NULL REFERENCES extraction_runs(id),
    rule_set_version text NOT NULL,
    status text NOT NULL CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
    summary jsonb NOT NULL DEFAULT '{}'::jsonb,
    error_code text,
    error_message text,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    CHECK (engineer_extraction_run_id <> shop_extraction_run_id)
);
CREATE INDEX comparison_runs_project_idx ON comparison_runs(project_id, created_at DESC);

CREATE TABLE issues (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    comparison_run_id uuid NOT NULL REFERENCES comparison_runs(id) ON DELETE CASCADE,
    rule_code text NOT NULL,
    rule_version text NOT NULL,
    severity text NOT NULL CHECK (severity IN ('info', 'warning', 'error')),
    status text NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'accepted', 'rejected', 'resolved')),
    member_mark text,
    title text NOT NULL,
    description text NOT NULL,
    compared_values jsonb NOT NULL DEFAULT '{}'::jsonb,
    evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
    ai_draft text,
    ai_provider text,
    ai_model text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (comparison_run_id, rule_code, member_mark),
    CHECK (jsonb_typeof(compared_values) = 'object'),
    CHECK (jsonb_typeof(evidence) = 'array')
);
CREATE INDEX issues_run_status_idx ON issues(comparison_run_id, status, severity);

CREATE TABLE review_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    issue_id uuid NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    actor_id text NOT NULL,
    action text NOT NULL CHECK (action IN ('commented', 'accepted', 'rejected', 'reopened', 'resolved')),
    comment text,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (action = 'commented' OR comment IS NOT NULL OR action IN ('reopened', 'resolved'))
);
CREATE INDEX review_events_issue_idx ON review_events(issue_id, created_at);
```

Production migrations should add tenant membership and a real identity-provider subject before multi-organization access is enabled. Replace placeholder `created_by`/`actor_id` text IDs with foreign keys to the chosen identity model. Ensure every query is scoped to an authorized project.

## 6. Matching and normalization

1. Normalize member marks conservatively (trim whitespace and apply a documented case convention); retain the original.
2. Group by normalized mark. If either side has zero or multiple accepted beam rows for a mark, emit an ambiguity/completeness warning and do not compare a guessed pair.
3. Compare section strings using a versioned canonicalizer that only removes formatting variations explicitly proven equivalent by tests. Preserve both raw strings.
4. If canonical values differ, emit `BEAM_SECTION_MISMATCH`; never translate one designation to another or conclude structural equivalence.
5. A missing-member rule is enabled only after extraction completeness and document selection are visible to the reviewer. Report “not found in selected schedule,” not “missing from design.”
