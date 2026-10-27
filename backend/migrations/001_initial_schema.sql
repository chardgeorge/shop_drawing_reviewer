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
