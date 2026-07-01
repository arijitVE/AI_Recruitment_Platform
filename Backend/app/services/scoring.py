from datetime import datetime, timezone
from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.models import Job, Candidate, Score, CandidateStatus
from app.schemas import SanitizedProfile
from app.services.llm import client
from app.services.worker import record_audit_log


class ScoringResultSchema(BaseModel):
    fit_percentage: int = Field(..., ge=0, le=100, description="Overall fit percentage 0-100")
    matched_skills: List[str] = Field(..., description="List of required skills matched by the candidate")
    missing_skills: List[str] = Field(..., description="List of required skills missing from candidate profile")
    rationale: str = Field(..., description="2-3 sentence objective explanation grounded strictly in redacted data")


async def evaluate_candidate_fit(job: Job, sanitized: SanitizedProfile) -> ScoringResultSchema:
    """Stage-2 LLM scoring comparing SanitizedProfile against Job requirements."""
    if not client:
        # Mock deterministic scoring fallback for local offline testing
        job_skills = set(job.required_skills or [])
        cand_skills = set(sanitized.skills or [])
        matched = list(job_skills.intersection(cand_skills))
        missing = list(job_skills.difference(cand_skills))
        fit = int((len(matched) / max(1, len(job_skills))) * 100) if job_skills else 50
        return ScoringResultSchema(
            fit_percentage=fit,
            matched_skills=matched,
            missing_skills=missing,
            rationale=f"Candidate matches {len(matched)} required skills ({', '.join(matched) if matched else 'none'}) out of {len(job_skills)}. Gaps identified in: {', '.join(missing) if missing else 'none'}."
        )

    prompt = (
        "Evaluate candidate fit against the following job rubric using STRICTLY the provided sanitized profile.\n\n"
        f"Job Title: {job.title}\n"
        f"Required Skills: {job.required_skills}\n"
        f"Required Experience Years: {job.required_experience_years}\n"
        f"Required Education: {job.required_education}\n"
        f"Job Description: {job.raw_description}\n\n"
        f"Candidate Sanitized Profile (Redacted - No PII):\n"
        f"Skills: {sanitized.skills}\n"
        f"Experience: {[exp.role + ' at ' + exp.company + ' (' + exp.duration + ')' for exp in sanitized.work_experience]}\n"
        f"Education: {[edu.degree + ' in ' + edu.field for edu in sanitized.education]}\n\n"
        "Rubric:\n"
        "1. Compare required skills vs candidate skills.\n"
        "2. Evaluate relevance and duration of work experience against required experience years.\n"
        "3. Evaluate education alignment.\n"
        "4. Output strict JSON with fit_percentage (0-100), matched_skills, missing_skills, and rationale."
    )

    try:
        response = await client.beta.chat.completions.parse(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": "You are an objective, bias-free AI recruitment evaluator."},
                {"role": "user", "content": prompt}
            ],
            response_format=ScoringResultSchema,
            temperature=0.0
        )
        return response.choices[0].message.parsed
    except Exception as e:
        # Fallback if gpt-4o fails or model not accessible
        job_skills = set(job.required_skills or [])
        cand_skills = set(sanitized.skills or [])
        matched = list(job_skills.intersection(cand_skills))
        missing = list(job_skills.difference(cand_skills))
        return ScoringResultSchema(
            fit_percentage=50,
            matched_skills=matched,
            missing_skills=missing,
            rationale=f"Scoring fallback applied due to error: {str(e)}"
        )


async def run_stage2_scoring(db: AsyncSession, job: Job, candidate: Candidate, sim_score: float) -> Score:
    """Run Stage 2 evaluation and store/update score record."""
    sanitized_data = candidate.sanitized_profile
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

    eval_result = await evaluate_candidate_fit(job, sanitized)

    # Check if score record exists
    res = await db.execute(select(Score).where(Score.job_id == job.id, Score.candidate_id == candidate.id))
    score_record = res.scalar_one_or_none()
    if not score_record:
        score_record = Score(
            job_id=job.id,
            candidate_id=candidate.id,
        )
        db.add(score_record)

    score_record.vector_similarity_score = sim_score
    score_record.fit_percentage = eval_result.fit_percentage
    score_record.matched_skills = eval_result.matched_skills
    score_record.missing_skills = eval_result.missing_skills
    score_record.rationale = eval_result.rationale
    score_record.scored_at = datetime.now(timezone.utc)

    candidate.status = CandidateStatus.COMPLETED
    await db.commit()
    await db.refresh(score_record)
    await record_audit_log(db, candidate.id, job.id, "score_computed", {"fit_percentage": eval_result.fit_percentage, "sim_score": sim_score})
    return score_record
