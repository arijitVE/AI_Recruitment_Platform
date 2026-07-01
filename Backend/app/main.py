from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import engine, Base
from app.routers import jobs, candidates


from sqlalchemy import text

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create tables on startup if they don't exist
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        try:
            await conn.execute(text("ALTER TABLE jobs ADD COLUMN pinecone_vector_id VARCHAR(255)"))
        except Exception:
            pass
    yield


app = FastAPI(
    title="AI Recruitment Platform API",
    description="Bias-aware AI-assisted recruitment platform backend.",
    version="1.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(jobs.router)
app.include_router(candidates.router)


@app.get("/health", tags=["Health"])
async def health_check():
    return {"status": "ok", "version": "1.0.0"}
