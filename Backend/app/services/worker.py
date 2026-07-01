from datetime import datetime, timezone
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.database import async_session_maker
from app.models import Candidate, CandidateStatus, AuditLog, Job
from app.services.parser import parse_resume_file
from app.services.llm import extract_structured_profile
from app.services.redaction import sanitize_profile
from app.services.profile_renderer import render_candidate_profile_text
from app.services.vector_store import generate_embedding, vector_store


async def record_audit_log(db: AsyncSession, candidate_id: int, job_id: int, event: str, snapshot: dict = None):
    log = AuditLog(
        candidate_id=candidate_id,
        job_id=job_id,
        event=event,
        payload_snapshot=snapshot or {},
        timestamp=datetime.now(timezone.utc)
    )
    db.add(log)
    await db.commit()


async def process_candidate_task(candidate_id: int):
    """Background task executing the candidate state machine pipeline."""
    async with async_session_maker() as db:
        result = await db.execute(select(Candidate).where(Candidate.id == candidate_id))
        candidate = result.scalar_one_or_none()
        if not candidate:
            return

        job_id = candidate.job_id
        file_path = candidate.raw_file_storage_path

        # Step 1: Parsing
        try:
            candidate.status = CandidateStatus.PARSING
            await db.commit()

            markdown_text = parse_resume_file(file_path)
            candidate.parsed_markdown = markdown_text
            await db.commit()
        except Exception as e:
            candidate.status = CandidateStatus.PARSING_FAILED
            candidate.status_detail = str(e)
            await db.commit()
            return

        # Step 2: Extracting
        try:
            candidate.status = CandidateStatus.EXTRACTING
            await db.commit()

            structured = await extract_structured_profile(candidate.parsed_markdown)
            candidate.structured_profile = structured.model_dump()
            await db.commit()
        except Exception as e:
            candidate.status = CandidateStatus.EXTRACTION_FAILED
            candidate.status_detail = str(e)
            await db.commit()
            return

        # Step 3: Sanitizing (Bias-Aware Redaction Boundary)
        try:
            candidate.status = CandidateStatus.SANITIZING
            await db.commit()

            sanitized = sanitize_profile(structured)
            candidate.sanitized_profile = sanitized.model_dump()
            await db.commit()
            await record_audit_log(db, candidate.id, job_id, "profile_sanitized", {"sanitized_keys": list(sanitized.model_dump().keys())})
        except Exception as e:
            candidate.status = CandidateStatus.EXTRACTION_FAILED
            candidate.status_detail = f"Sanitization error: {str(e)}"
            await db.commit()
            return

        # Step 4: Embedding & Vector Upsert
        try:
            candidate.status = CandidateStatus.EMBEDDING
            await db.commit()

            rendered_text = render_candidate_profile_text(sanitized)
            candidate.profile_text = rendered_text

            vector = await generate_embedding(rendered_text)
            vector_id = f"cand_{candidate.id}"
            await vector_store.upsert_vector(
                namespace=str(job_id),
                vector_id=vector_id,
                vector=vector,
                metadata={"candidate_id": candidate.id, "job_id": job_id}
            )
            candidate.pinecone_vector_id = vector_id
            candidate.status = CandidateStatus.READY_FOR_MATCHING
            candidate.status_detail = None
            await db.commit()
            await record_audit_log(db, candidate.id, job_id, "embedding_generated", {"vector_id": vector_id, "namespace": str(job_id)})
        except Exception as e:
            candidate.status = CandidateStatus.EMBEDDING_FAILED
            candidate.status_detail = str(e)
            await db.commit()
            return

        # Step 5: Automatic Similarity matching & Stage-2 LLM scoring
        try:
            candidate.status = CandidateStatus.MATCHING
            await db.commit()

            j_res = await db.execute(select(Job).where(Job.id == job_id))
            job = j_res.scalar_one_or_none()
            if not job:
                raise RuntimeError(f"Job id {job_id} not found during matching")

            job_text = job.profile_text or f"Title: {job.title}\nSkills: {', '.join(job.required_skills or [])}"
            job_vector = await generate_embedding(job_text)

            matches = await vector_store.query_vectors(namespace=str(job_id), query_vector=job_vector, top_k=50)
            sim_score = 0.5
            for m in matches:
                meta = m.get("metadata", {})
                if meta.get("candidate_id") == candidate.id or m.get("vector_id") == candidate.pinecone_vector_id:
                    sim_score = m.get("score", 0.5)
                    break

            from app.services.scoring import run_stage2_scoring
            await run_stage2_scoring(db, job, candidate, sim_score)
        except Exception as e:
            candidate.status = CandidateStatus.EXTRACTION_FAILED
            candidate.status_detail = f"Scoring error: {str(e)}"
            await db.commit()
