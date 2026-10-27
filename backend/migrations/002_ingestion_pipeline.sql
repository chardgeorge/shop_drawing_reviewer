CREATE TABLE extracted_pages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    extraction_run_id uuid NOT NULL REFERENCES extraction_runs(id) ON DELETE CASCADE,
    page_number integer NOT NULL CHECK (page_number > 0),
    page_width numeric NOT NULL CHECK (page_width > 0),
    page_height numeric NOT NULL CHECK (page_height > 0),
    text_content text NOT NULL,
    text_char_count integer NOT NULL CHECK (text_char_count >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (extraction_run_id, page_number)
);

CREATE TABLE ingestion_jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    extraction_run_id uuid NOT NULL REFERENCES extraction_runs(id) ON DELETE CASCADE,
    status text NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
    available_at timestamptz NOT NULL DEFAULT now(),
    locked_at timestamptz,
    started_at timestamptz,
    completed_at timestamptz,
    error_code text,
    error_message text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (extraction_run_id)
);

CREATE INDEX ingestion_jobs_ready_idx
    ON ingestion_jobs(available_at, created_at)
    WHERE status IN ('queued', 'processing');
CREATE INDEX extracted_pages_run_idx
    ON extracted_pages(extraction_run_id, page_number);
