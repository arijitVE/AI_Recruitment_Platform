import json
import logging
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.database import get_db
from app.models import Job, Candidate, CandidateStatus, Score, InterviewQuestion, Feedback
from app.schemas import (
    CandidateResponse,
    CandidateDetailResponse,
    ScoreResponse,
    RankedCandidateResponse,
    InterviewQuestionResponse,
    InterviewQuestionGenerateRequest,
    FeedbackCreate,
    FeedbackResponse,
    SanitizedProfile,
)
from app.services.storage import save_uploaded_file
from app.services.worker import process_candidate_task, record_audit_log
from app.services.vector_store import generate_embedding, vector_store
from app.services.scoring import run_stage2_scoring
from app.services.llm import generate_interview_questions

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Candidates & Matching"])


# ── Helper ────────────────────────────────────────────────────────────────────

def _resolve_sanitized(raw) -> SanitizedProfile:
    """Deserialise candidate.sanitized_profile from whatever SQLAlchemy gives us."""
    if isinstance(raw, SanitizedProfile):
        return raw
    if isinstance(raw, dict):
        return SanitizedProfile.model_validate(raw)
    if isinstance(raw, str):
        try:
            return SanitizedProfile.model_validate_json(raw)
        except Exception:
            return SanitizedProfile.model_validate(json.loads(raw))
    return SanitizedProfile()


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/jobs/{job_id}/candidates", response_model=CandidateResponse, status_code=status.HTTP_202_ACCEPTED)
async def upload_candidate(
    job_id: int,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db)
):
    """Upload a resume PDF/DOCX and trigger the background processing pipeline."""
    res = await db.execute(select(Job).where(Job.id == job_id))
    job = res.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    file_path = await save_uploaded_file(file, job_id)

    candidate = Candidate(
        job_id=job_id,
        original_filename=file.filename,
        raw_file_storage_path=file_path,
        status=CandidateStatus.UPLOADED
    )
    db.add(candidate)
    await db.commit()
    await db.refresh(candidate)

    logger.info("[Route] Queued background pipeline for candidate_id=%d (job_id=%d)", candidate.id, job_id)
    background_tasks.add_task(process_candidate_task, candidate.id)
    return candidate


@router.post("/candidates/{candidate_id}/retry", response_model=CandidateResponse, status_code=status.HTTP_202_ACCEPTED)
async def retry_candidate_pipeline(
    candidate_id: int,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db)
):
    """Re-trigger the background pipeline for a failed candidate."""
    res = await db.execute(select(Candidate).where(Candidate.id == candidate_id))
    cand = res.scalar_one_or_none()
    if not cand:
        raise HTTPException(status_code=404, detail="Candidate not found")
    if cand.status not in (
        CandidateStatus.PARSING_FAILED,
        CandidateStatus.EXTRACTION_FAILED,
        CandidateStatus.EMBEDDING_FAILED,
        CandidateStatus.UPLOADED,
    ):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot retry candidate in status '{cand.status.value}'. Only failed/uploaded candidates can be retried."
        )

    cand.status = CandidateStatus.UPLOADED
    cand.status_detail = None
    await db.commit()
    await db.refresh(cand)

    logger.info("[Route] Retrying pipeline for candidate_id=%d", candidate_id)
    background_tasks.add_task(process_candidate_task, candidate_id)
    return cand


@router.get("/jobs/{job_id}/candidates", response_model=List[CandidateResponse])
async def list_candidates(job_id: int, status_filter: CandidateStatus = None, db: AsyncSession = Depends(get_db)):
    """List all candidates for a job, optionally filtered by status."""
    query = select(Candidate).where(Candidate.job_id == job_id)
    if status_filter:
        query = query.where(Candidate.status == status_filter)
    res = await db.execute(query)
    return res.scalars().all()


@router.post("/jobs/{job_id}/match", response_model=List[ScoreResponse])
async def run_matching(job_id: int, db: AsyncSession = Depends(get_db)):
    """
    Run Stage-1 vector retrieval + Stage-2 LLM scoring for all ready candidates on this job.
    Returns updated score records.
    """
    res = await db.execute(select(Job).where(Job.id == job_id))
    job = res.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    # Stage 1: embed job text and retrieve nearest candidate vectors
    job_text = job.profile_text or f"Title: {job.title}\nSkills: {', '.join(job.required_skills or [])}"
    job_vector = await generate_embedding(job_text)
    matches = await vector_store.query_vectors(namespace=str(job_id), query_vector=job_vector, top_k=30)
    logger.info("[Route] match job_id=%d — vector store returned %d matches.", job_id, len(matches))

    scores_list: List[Score] = []

    # Process candidates returned by vector search
    seen_ids: set = set()
    for match in matches:
        meta = match.get("metadata", {})
        cand_id = meta.get("candidate_id")
        if not cand_id or cand_id in seen_ids:
            continue
        seen_ids.add(cand_id)
        c_res = await db.execute(select(Candidate).where(Candidate.id == cand_id))
        cand = c_res.scalar_one_or_none()
        if cand and cand.sanitized_profile:
            score_rec = await run_stage2_scoring(db, job, cand, match["score"])
            scores_list.append(score_rec)

    # Fallback: score any candidate with a sanitized_profile that wasn't returned by vector search
    c_res = await db.execute(
        select(Candidate).where(
            Candidate.job_id == job_id,
            Candidate.sanitized_profile.is_not(None)
        )
    )
    for cand in c_res.scalars().all():
        if cand.id not in seen_ids:
            logger.info("[Route] Scoring unseen candidate_id=%d via fallback (sim=0.5).", cand.id)
            score_rec = await run_stage2_scoring(db, job, cand, 0.5)
            scores_list.append(score_rec)

    if not scores_list:
        logger.warning("[Route] No scoreable candidates found for job_id=%d.", job_id)

    return scores_list


@router.get("/jobs/{job_id}/rankings", response_model=List[RankedCandidateResponse])
async def get_rankings(job_id: int, db: AsyncSession = Depends(get_db)):
    """Return candidates ranked by fit_percentage descending."""
    query = (
        select(Candidate, Score)
        .join(Score, Candidate.id == Score.candidate_id)
        .where(Candidate.job_id == job_id)
        .order_by(Score.fit_percentage.desc(), Score.vector_similarity_score.desc())
    )
    res = await db.execute(query)
    results = []
    for cand, score in res.all():
        results.append(
            RankedCandidateResponse(
                candidate_id=cand.id,
                original_filename=cand.original_filename,
                status=cand.status,
                fit_percentage=score.fit_percentage or 0,
                vector_similarity_score=score.vector_similarity_score,
                matched_skills=score.matched_skills or [],
                missing_skills=score.missing_skills or [],
                rationale=score.rationale,
            )
        )
    return results


@router.get("/candidates/{candidate_id}", response_model=CandidateResponse)
async def get_candidate(candidate_id: int, db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(Candidate).where(Candidate.id == candidate_id))
    cand = res.scalar_one_or_none()
    if not cand:
        raise HTTPException(status_code=404, detail="Candidate not found")
    return cand


@router.get("/candidates/{candidate_id}/resume", response_model=CandidateDetailResponse)
async def view_unredacted_resume(candidate_id: int, db: AsyncSession = Depends(get_db)):
    """Recruiter-only endpoint returning the full unredacted profile (PII visible)."""
    res = await db.execute(select(Candidate).where(Candidate.id == candidate_id))
    cand = res.scalar_one_or_none()
    if not cand:
        raise HTTPException(status_code=404, detail="Candidate not found")
    await record_audit_log(db, cand.id, cand.job_id, "recruiter_viewed_raw_resume", {"filename": cand.original_filename})
    return cand


@router.post("/candidates/{candidate_id}/interview-questions", response_model=List[InterviewQuestionResponse])
async def create_interview_questions(
    candidate_id: int,
    req: InterviewQuestionGenerateRequest,
    db: AsyncSession = Depends(get_db)
):
    """Generate targeted interview questions for a candidate using LLM."""
    res = await db.execute(select(Candidate).where(Candidate.id == candidate_id))
    cand = res.scalar_one_or_none()
    if not cand:
        raise HTTPException(status_code=404, detail="Candidate not found")

    if not cand.sanitized_profile:
        raise HTTPException(
            status_code=422,
            detail=f"Candidate pipeline has not completed yet (status: {cand.status.value}). "
                   f"Cannot generate questions without a sanitized profile."
        )

    j_res = await db.execute(select(Job).where(Job.id == cand.job_id))
    job = j_res.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    # Get missing skills from score record if available
    s_res = await db.execute(select(Score).where(Score.candidate_id == candidate_id))
    score = s_res.scalar_one_or_none()
    missing = score.missing_skills if score else []

    sanitized = _resolve_sanitized(cand.sanitized_profile)

    try:
        generated_list = await generate_interview_questions(job, sanitized, missing, req.num_questions)
    except Exception as e:
        logger.error("[Route] Interview question generation failed for candidate_id=%d: %s", candidate_id, str(e))
        raise HTTPException(status_code=500, detail=f"Question generation failed: {str(e)}")

    saved_questions = []
    for item in generated_list:
        q = InterviewQuestion(
            candidate_id=candidate_id,
            job_id=cand.job_id,
            question_text=item["question_text"],
            target_skill_gap=item.get("target_skill_gap"),
        )
        db.add(q)
        saved_questions.append(q)

    await db.commit()
    for q in saved_questions:
        await db.refresh(q)

    logger.info("[Route] Saved %d interview questions for candidate_id=%d.", len(saved_questions), candidate_id)
    return saved_questions


@router.post("/candidates/{candidate_id}/feedback", response_model=FeedbackResponse, status_code=status.HTTP_201_CREATED)
async def submit_feedback(candidate_id: int, fb: FeedbackCreate, db: AsyncSession = Depends(get_db)):
    """Record recruiter hiring decision and notes for a candidate."""
    res = await db.execute(select(Candidate).where(Candidate.id == candidate_id))
    cand = res.scalar_one_or_none()
    if not cand:
        raise HTTPException(status_code=404, detail="Candidate not found")

    feedback = Feedback(
        candidate_id=candidate_id,
        job_id=cand.job_id,
        recruiter_notes=fb.recruiter_notes,
        decision=fb.decision,
        recorded_by=fb.recorded_by,
    )
    db.add(feedback)
    await db.commit()
    await db.refresh(feedback)
    await record_audit_log(db, candidate_id, cand.job_id, "recruiter_feedback_recorded", {"decision": fb.decision.value})
    logger.info("[Route] Feedback recorded for candidate_id=%d: decision=%s", candidate_id, fb.decision.value)
    return feedback
