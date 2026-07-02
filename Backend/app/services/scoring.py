import logging
from datetime import datetime, timezone
from typing import List
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.models import Job, Candidate, Score, CandidateStatus, utc_now
from app.schemas import SanitizedProfile
from app.services.llm import evaluate_candidate_fit_llm, StrictScoringResult, get_client
from app.services.worker import record_audit_log
from app.config import settings

logger = logging.getLogger(__name__)

# Backward-compat alias (some import `client` from scoring)
client = get_client()


async def evaluate_candidate_fit(job: Job, sanitized: SanitizedProfile) -> StrictScoringResult:
    """Stage-2 LLM scoring. Falls back to deterministic skill-match if OpenAI unavailable."""
    c = get_client()
    if not c:
        if not settings.ALLOW_DEVELOPMENT_FALLBACKS:
            raise RuntimeError("OpenAI is not configured for candidate scoring")
        logger.warning("[Scoring] client=None — deterministic skill-match fallback for job_id=%s.", job.id)
        return _skill_match_fallback(job, sanitized, reason="no OpenAI client")

    try:
        result = await evaluate_candidate_fit_llm(job, sanitized)
        return result
    except Exception as e:
        if not settings.ALLOW_DEVELOPMENT_FALLBACKS:
            raise
        logger.error("[Scoring] OpenAI scoring failed (job_id=%s): %s — using fallback.", job.id, str(e))
        return _skill_match_fallback(job, sanitized, reason=str(e))


def _skill_match_fallback(job: Job, sanitized: SanitizedProfile, reason: str = "") -> StrictScoringResult:
    job_skills = set(job.required_skills or [])
    cand_skills = set(sanitized.skills or [])
    matched = list(job_skills.intersection(cand_skills))
    missing = list(job_skills.difference(cand_skills))
    fit = int((len(matched) / max(1, len(job_skills))) * 100) if job_skills else 50
    note = f" [fallback: {reason}]" if reason else ""
    return StrictScoringResult(
        fit_percentage=fit,
        matched_skills=matched,
        missing_skills=missing,
        rationale=(
            f"Candidate matches {len(matched)} of {len(job_skills)} required skills "
            f"({', '.join(matched) or 'none'}). "
            f"Gaps: {', '.join(missing) or 'none'}.{note}"
        )
    )


async def run_stage2_scoring(db: AsyncSession, job: Job, candidate: Candidate, sim_score: float) -> Score:
    """Run Stage 2 evaluation and upsert score record."""
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

    res = await db.execute(select(Score).where(Score.job_id == job.id, Score.candidate_id == candidate.id))
    score_record = res.scalar_one_or_none()
    if not score_record:
        score_record = Score(job_id=job.id, candidate_id=candidate.id)
        db.add(score_record)

    score_record.vector_similarity_score = sim_score
    score_record.fit_percentage = eval_result.fit_percentage
    score_record.matched_skills = eval_result.matched_skills
    score_record.missing_skills = eval_result.missing_skills
    score_record.rationale = eval_result.rationale
    score_record.scored_at = utc_now()

    candidate.status = CandidateStatus.COMPLETED
    await db.commit()
    await db.refresh(score_record)
    await record_audit_log(db, candidate.id, job.id, "score_computed", {
        "fit_percentage": eval_result.fit_percentage,
        "sim_score": sim_score
    })
    return score_record
