from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.documents.router import router as documents_router
from app.projects.router import router as projects_router

app = FastAPI(
    title="Shop Drawing Reviewer API",
    description="Local API for the Shop Drawing Reviewer prototype.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(projects_router)
app.include_router(documents_router)


@app.get("/health", tags=["local development"])
def health_check() -> dict[str, str]:
    return {"status": "ok"}
