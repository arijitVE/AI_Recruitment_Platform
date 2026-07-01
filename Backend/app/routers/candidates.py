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
)
from app.services.storage import save_uploaded_file
from app.services.worker import process_candidate_task, record_audit_log
from app.services.vector_store import generate_embedding, vector_store
from app.services.scoring import run_stage2_scoring
from app.services.llm import generate_interview_questions

router = APIRouter(tags=["Candidates & Matching"])


@router.post("/jobs/{job_id}/candidates", response_model=CandidateResponse, status_code=status.HTTP_202_ACCEPTED)
async def upload_candidate(
    job_id: int,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db)
):
    # Verify job exists
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

    # Trigger background pipeline
    background_tasks.add_task(process_candidate_task, candidate.id)

    return candidate


@router.get("/jobs/{job_id}/candidates", response_model=List[CandidateResponse])
async def list_candidates(job_id: int, status_filter: CandidateStatus = None, db: AsyncSession = Depends(get_db)):
    query = select(Candidate).where(Candidate.job_id == job_id)
    if status_filter:
        query = query.where(Candidate.status == status_filter)
    res = await db.execute(query)
    return res.scalars().all()


@router.post("/jobs/{job_id}/match", response_model=List[ScoreResponse])
async def run_matching(job_id: int, db: AsyncSession = Depends(get_db)):
    """Run Stage-1 vector retrieval + Stage-2 LLM scoring for candidates on this job."""
    res = await db.execute(select(Job).where(Job.id == job_id))
    job = res.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    # Generate query vector from job profile text
    job_text = job.profile_text or f"Title: {job.title}\nSkills: {', '.join(job.required_skills or [])}"
    job_vector = await generate_embedding(job_text)

    # Stage 1: Vector Retrieval from Pinecone job namespace
    matches = await vector_store.query_vectors(namespace=str(job_id), query_vector=job_vector, top_k=30)

    # Map matches back to candidates
    scores_list = []
    for match in matches:
        meta = match.get("metadata", {})
        cand_id = meta.get("candidate_id")
        if not cand_id:
            continue
        c_res = await db.execute(select(Candidate).where(Candidate.id == cand_id))
        cand = c_res.scalar_one_or_none()
        if cand and cand.sanitized_profile:
            # Stage 2: LLM scoring pass
            score_rec = await run_stage2_scoring(db, job, cand, match["score"])
            scores_list.append(score_rec)

    # If vector search returned nothing (e.g. offline testing without upserts), fallback to evaluating any READY_FOR_MATCHING candidate
    if not scores_list:
        c_res = await db.execute(select(Candidate).where(Candidate.job_id == job_id, Candidate.sanitized_profile != None))
        cands = c_res.scalars().all()
        for cand in cands:
            score_rec = await run_stage2_scoring(db, job, cand, 0.75)
            scores_list.append(score_rec)

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
    """Recruiter-only endpoint returning full unredacted profile and recording audit log."""
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
    res = await db.execute(select(Candidate).where(Candidate.id == candidate_id))
    cand = res.scalar_one_or_none()
    if not cand:
        raise HTTPException(status_code=404, detail="Candidate not found")

    j_res = await db.execute(select(Job).where(Job.id == cand.job_id))
    job = j_res.scalar_one_or_none()

    s_res = await db.execute(select(Score).where(Score.candidate_id == candidate_id))
    score = s_res.scalar_one_or_none()
    missing = score.missing_skills if score else []

    from app.schemas import SanitizedProfile
    sanitized_data = cand.sanitized_profile
    if isinstance(sanitized_data, SanitizedProfile):
        sanitized = sanitized_data
    elif isinstance(sanitized_data, str):
        import json
        try:
            sanitized = SanitizedProfile.model_validate_json(sanitized_data)
        except Exception:
            sanitized = SanitizedProfile.model_validate(json.loads(sanitized_data))
    elif isinstance(sanitized_data, dict):
        sanitized = SanitizedProfile.model_validate(sanitized_data)
    else:
        sanitized = SanitizedProfile()

    generated_list = await generate_interview_questions(job, sanitized, missing, req.num_questions)

    saved_questions = []
    for item in generated_list:
        q = InterviewQuestion(
            candidate_id=candidate_id,
            job_id=cand.job_id,
            question_text=item["question_text"],
            target_skill_gap=item.get("target_skill_gap")
        )
        db.add(q)
        saved_questions.append(q)

    await db.commit()
    for q in saved_questions:
        await db.refresh(q)
    return saved_questions


@router.post("/candidates/{candidate_id}/feedback", response_model=FeedbackResponse, status_code=status.HTTP_201_CREATED)
async def submit_feedback(candidate_id: int, fb: FeedbackCreate, db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(Candidate).where(Candidate.id == candidate_id))
    cand = res.scalar_one_or_none()
    if not cand:
        raise HTTPException(status_code=404, detail="Candidate not found")

    feedback = Feedback(
        candidate_id=candidate_id,
        job_id=cand.job_id,
        recruiter_notes=fb.recruiter_notes,
        decision=fb.decision,
        recorded_by=fb.recorded_by
    )
    db.add(feedback)
    await db.commit()
    await db.refresh(feedback)
    await record_audit_log(db, candidate_id, cand.job_id, "recruiter_feedback_recorded", {"decision": fb.decision.value})
    return feedback
