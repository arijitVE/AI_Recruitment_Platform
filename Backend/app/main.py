import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_cors_origins
from app.database import engine, Base, async_session_maker
from app.models import Candidate, CandidateStatus
from app.routers import jobs, candidates
from app.services.worker import process_candidate_task


from sqlalchemy import inspect, select, text


def _candidate_columns(sync_conn) -> set[str]:
    return {column["name"] for column in inspect(sync_conn).get_columns("candidates")}

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create tables on startup if they don't exist
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        columns = await conn.run_sync(_candidate_columns)
        if "raw_markdown" not in columns:
            await conn.execute(text("ALTER TABLE candidates ADD COLUMN raw_markdown TEXT"))
        await conn.execute(text(
            "UPDATE candidates "
            "SET raw_markdown = parsed_markdown "
            "WHERE raw_markdown IS NULL AND parsed_markdown IS NOT NULL"
        ))
        job_columns = await conn.run_sync(
            lambda sync_conn: {column["name"] for column in inspect(sync_conn).get_columns("jobs")}
        )
        if "pinecone_vector_id" not in job_columns:
            await conn.execute(text("ALTER TABLE jobs ADD COLUMN pinecone_vector_id VARCHAR(255)"))
        await conn.execute(text(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_score_job_candidate "
            "ON scores (job_id, candidate_id)"
        ))

    # Recover work left in an active state by a previous process shutdown.
    recoverable = (
        CandidateStatus.UPLOADED,
        CandidateStatus.PARSING,
        CandidateStatus.EXTRACTING,
        CandidateStatus.SANITIZING,
        CandidateStatus.EMBEDDING,
        CandidateStatus.READY_FOR_MATCHING,
        CandidateStatus.MATCHING,
    )
    async with async_session_maker() as db:
        result = await db.execute(select(Candidate.id).where(Candidate.status.in_(recoverable)))
        for candidate_id in result.scalars().all():
            asyncio.create_task(process_candidate_task(candidate_id))
    yield


app = FastAPI(
    title="AI Recruitment Platform API",
    description="Bias-aware AI-assisted recruitment platform backend.",
    version="1.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_cors_origins(),
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(jobs.router)
app.include_router(candidates.router)


@app.get("/health", tags=["Health"])
async def health_check():
    return {"status": "ok", "version": "1.0.0"}
