# API design

Base path: `/api/v1`. JSON uses `snake_case`; timestamps are ISO 8601 UTC. All endpoints require authentication in hosted environments. Project authorization is checked server-side on every operation.

## 1. MVP endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/projects` | Create a project |
| `GET` | `/projects` | List projects visible to the caller |
| `GET` | `/projects/{project_id}` | Get project metadata |
| `POST` | `/projects/{project_id}/documents` | Register a document and request upload authorization |
| `POST` | `/documents/{document_id}/complete-upload` | Verify upload and enqueue ingestion |
| `GET` | `/projects/{project_id}/documents` | List project documents and processing status |
| `GET` | `/documents/{document_id}` | Get document metadata and latest extraction status |
| `GET` | `/documents/{document_id}/extraction-runs/{run_id}/beam-rows` | List extracted rows and provenance |
| `PATCH` | `/beam-rows/{row_id}` | Correct/accept/reject an extracted row with an audit event |
| `POST` | `/projects/{project_id}/comparisons` | Start comparison using selected extraction runs |
| `GET` | `/comparisons/{comparison_id}` | Read run status and summary |
| `GET` | `/comparisons/{comparison_id}/issues` | List findings with filters and evidence |
| `POST` | `/issues/{issue_id}/review-events` | Append a comment or disposition |
| `GET` | `/documents/{document_id}/download-url` | Issue short-lived, authorized PDF access |

Support pagination on collections (`limit`, `cursor`), filtering by status/severity, and a stable ordering. Cap page size. Use `202 Accepted` when ingestion/comparison has been queued and return a resource ID; do not hold HTTP requests open for document processing.

## 2. Example payloads

Create project:

```http
POST /api/v1/projects
Content-Type: application/json
```

```json
{
  "name": "North Plant Steel Package",
  "project_number": "NP-042",
  "description": "Phase 1 steel shop drawing review"
}
```

```json
{
  "id": "c1b65ee6-83d9-4bab-9ea1-a36ef7e1e2c6",
  "name": "North Plant Steel Package",
  "project_number": "NP-042",
  "created_at": "2026-01-15T10:00:00Z"
}
```

Register a PDF:

```http
POST /api/v1/projects/{project_id}/documents
```

```json
{
  "file_name": "S-501-revB.pdf",
  "role": "engineer",
  "document_type": "schedule",
  "revision": "B",
  "media_type": "application/pdf",
  "file_size_bytes": 1834021
}
```

```json
{
  "document_id": "f24a98a2-2698-4c84-80cb-d825c77c644a",
  "upload": {
    "method": "PUT",
    "url": "https://private-storage.example/signed-url",
    "expires_at": "2026-01-15T10:15:00Z",
    "headers": { "Content-Type": "application/pdf" }
  }
}
```

The example URL is illustrative. Hosted storage credentials and signed URLs are generated server-side; never persist a signed URL as the document location.

Start a comparison:

```json
{
  "engineer_extraction_run_id": "uuid",
  "shop_extraction_run_id": "uuid",
  "include_unreviewed_rows": false
}
```

The server verifies both runs belong to documents in the same authorized project and have completed successfully. Default to accepted rows only; allowing unreviewed rows must be an explicit, clearly labeled choice.

## 3. Response and error conventions

- `400`: malformed request or invalid state transition.
- `401` / `403`: unauthenticated / unauthorized.
- `404`: resource does not exist or is not visible to caller (avoid leaking cross-project existence).
- `409`: duplicate/conflicting state, such as comparison with incompatible runs.
- `413`: file exceeds configured upload limit.
- `415`: unsupported media type.
- `422`: valid JSON but invalid field values.
- `429`: rate limit.
- `500`: unexpected server failure; include a request ID, never internal stack traces.

Standard error body:

```json
{
  "error": {
    "code": "DOCUMENT_NOT_READY",
    "message": "The selected document has no completed extraction run.",
    "request_id": "req_..."
  }
}
```

Long-running resources expose statuses (`queued`, `processing`, `completed`, `failed`) and a stable error code/message. A failed extraction must not be represented as an empty successful extraction.

## 4. Upload approach

For hosted environments, prefer a two-step upload to private object storage: register metadata and enforce limits, upload with short-lived signed authorization, then call `complete-upload`. Verify object size/type and compute the checksum before queueing ingestion. For local development, a multipart API implementation may use the same registration and lifecycle contracts.

## 5. API implementation notes

- Use Pydantic request/response models and explicit enums; return response models, not ORM objects.
- Keep storage and identity providers behind adapters.
- Use idempotency keys for upload completion and comparison creation where clients may retry.
- Scope child queries through the authorized project, not by accepting an unverified object ID.
- Keep PDF page/download access short-lived and access-logged.
- Generate OpenAPI from FastAPI and check it into CI as a contract artifact only if the team elects to maintain a checked-in snapshot.

## 6. Later endpoints

Defer markup export, OCR correction, additional schedules, organization administration, and AI regeneration until their policies and user flows are defined. These additions should not change the meaning of an existing completed comparison; create a new run instead.
