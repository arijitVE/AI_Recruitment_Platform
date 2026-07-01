import logging
from typing import List, Dict, Any

from openai import AsyncOpenAI
from pydantic import BaseModel, Field

from app.config import settings
from app.schemas import CandidateProfile, SanitizedProfile, WorkExperienceItem, EducationItem, ProjectItem
from app.models import Job

logger = logging.getLogger(__name__)

# ── Client singleton ──────────────────────────────────────────────────────────
# Initialized once at module import. The module is first imported during
# application startup (after lifespan sets up the DB), so settings will have
# been fully resolved from .env by this point.
# If the key is missing/test, every function falls through to its mock path.

_cached_client: AsyncOpenAI | None | str = "unset"


def get_client() -> AsyncOpenAI | None:
    """Return dynamic AsyncOpenAI client based on settings.OPENAI_API_KEY."""
    global _cached_client
    key = settings.OPENAI_API_KEY
    if not key or key == "test_key":
        return None
    if _cached_client == "unset" or _cached_client is None or getattr(_cached_client, "api_key", None) != key:
        logger.info("[LLM] Initializing OpenAI client (key prefix: %s...)", key[:12])
        _cached_client = AsyncOpenAI(api_key=key)
    return _cached_client


client = get_client()


# ── OpenAI-strict schemas (no Optional / anyOf — rejected by strict mode) ────

class InterviewQuestionItem(BaseModel):
    question_text: str = Field(..., description="The interview question text")
    target_skill_gap: str = Field(..., description="The skill gap or area being probed")


class InterviewQuestionsResponseSchema(BaseModel):
    questions: List[InterviewQuestionItem] = Field(..., description="List of structured interview questions")


class StrictWorkExperienceItem(BaseModel):
    company: str = ""
    role: str = ""
    duration: str = ""
    responsibilities: List[str] = Field(default_factory=list)


class StrictEducationItem(BaseModel):
    degree: str = ""
    field: str = ""
    institution: str = ""


class StrictProjectItem(BaseModel):
    name: str = ""
    description: str = ""


class StrictCandidateProfile(BaseModel):
    """OpenAI strict-output variant — no Optional/null fields (strict mode rejects anyOf)."""
    full_name: str = ""
    email: str = ""
    phone: str = ""
    gender: str = ""
    age_or_dob: str = ""
    marital_status: str = ""
    religion: str = ""
    address: str = ""
    skills: List[str] = Field(default_factory=list)
    work_experience: List[StrictWorkExperienceItem] = Field(default_factory=list)
    education: List[StrictEducationItem] = Field(default_factory=list)
    certifications: List[str] = Field(default_factory=list)
    projects: List[StrictProjectItem] = Field(default_factory=list)


class StrictScoringResult(BaseModel):
    """OpenAI strict-output variant for scoring — no Optional/null fields."""
    fit_percentage: int = Field(..., ge=0, le=100, description="Overall fit percentage 0-100")
    matched_skills: List[str] = Field(..., description="Required skills the candidate has")
    missing_skills: List[str] = Field(..., description="Required skills the candidate lacks")
    rationale: str = Field(..., description="2-3 sentence objective explanation based solely on redacted profile")


# ── Helpers ───────────────────────────────────────────────────────────────────

_MAX_RESUME_CHARS = 60_000  # ~15k tokens — well within gpt-4o-mini 128k limit


def _truncate(text: str, max_chars: int = _MAX_RESUME_CHARS) -> str:
    if len(text) <= max_chars:
        return text
    logger.warning("[LLM] Resume text truncated from %d to %d chars to fit context window.", len(text), max_chars)
    return text[:max_chars] + "\n\n[...truncated for context length...]"


# ── Service functions ─────────────────────────────────────────────────────────

async def extract_structured_profile(resume_markdown: str) -> CandidateProfile:
    """Extract full structured profile from parsed resume markdown using OpenAI structured outputs."""
    c = get_client()
    if not c:
        if not settings.ALLOW_DEVELOPMENT_FALLBACKS:
            raise RuntimeError("OpenAI is not configured for resume extraction")
        logger.warning("[LLM] extract_structured_profile: client=None, returning mock profile.")
        return CandidateProfile(
            full_name="Alex Rivera (Mock)",
            email="alex@example.com",
            phone="+1-555-0192",
            gender="Non-binary",
            age_or_dob="1992-05-14",
            marital_status="Single",
            religion="None",
            address="123 Tech Avenue, San Francisco, CA",
            skills=["Python", "FastAPI", "PostgreSQL", "Docker", "Git"],
            work_experience=[
                WorkExperienceItem(
                    company="TechCorp",
                    role="Software Engineer",
                    duration="3 years",
                    responsibilities=["Developed backend APIs using FastAPI", "Optimized database queries"]
                )
            ],
            education=[
                EducationItem(degree="Bachelor of Science", field="Computer Science", institution="State University")
            ],
            certifications=["AWS Certified Cloud Practitioner"],
            projects=[
                ProjectItem(name="AI Chatbot", description="Built a chatbot using OpenAI API and Python")
            ]
        )

    safe_markdown = _truncate(resume_markdown)
    prompt = (
        "Extract the candidate's structured profile from the resume below. "
        "Use empty string for missing text fields and empty lists for missing list fields.\n\n"
        f"Resume:\n{safe_markdown}"
    )

    logger.info("[LLM] Calling gpt-4o-mini for structured profile extraction (%d chars).", len(safe_markdown))
    try:
        response = await c.beta.chat.completions.parse(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are an expert HR recruitment parser. Extract strict structured data."},
                {"role": "user", "content": prompt}
            ],
            response_format=StrictCandidateProfile,
            temperature=0.0
        )
        strict = response.choices[0].message.parsed
        logger.info("[LLM] Extraction complete for candidate: %s", strict.full_name)

        # Convert strict schema → CandidateProfile (which allows None for optional PII)
        return CandidateProfile(
            full_name=strict.full_name or None,
            email=strict.email or None,
            phone=strict.phone or None,
            gender=strict.gender or None,
            age_or_dob=strict.age_or_dob or None,
            marital_status=strict.marital_status or None,
            religion=strict.religion or None,
            address=strict.address or None,
            skills=strict.skills,
            work_experience=[
                WorkExperienceItem(
                    company=e.company, role=e.role,
                    duration=e.duration, responsibilities=e.responsibilities
                ) for e in strict.work_experience
            ],
            education=[
                EducationItem(degree=e.degree, field=e.field, institution=e.institution)
                for e in strict.education
            ],
            certifications=strict.certifications,
            projects=[ProjectItem(name=p.name, description=p.description) for p in strict.projects],
        )
    except Exception as e:
        raise RuntimeError(f"OpenAI structured extraction failed: {str(e)}")


async def evaluate_candidate_fit_llm(job: Job, sanitized: SanitizedProfile) -> StrictScoringResult:
    """Stage-2 LLM scoring. Raises RuntimeError on failure — caller handles fallback."""
    c = get_client()
    if not c:
        raise RuntimeError("No OpenAI client available")

    prompt = (
        "Evaluate candidate fit against the job using ONLY the sanitized profile below.\n\n"
        f"Job Title: {job.title}\n"
        f"Required Skills: {job.required_skills}\n"
        f"Required Experience Years: {job.required_experience_years}\n"
        f"Required Education: {job.required_education}\n"
        f"Job Description: {_truncate(job.raw_description, 4000)}\n\n"
        "Candidate Sanitized Profile (No PII):\n"
        f"Skills: {sanitized.skills}\n"
        f"Experience: {[exp.role + ' at ' + exp.company + ' (' + exp.duration + ')' for exp in sanitized.work_experience]}\n"
        f"Education: {[edu.degree + ' in ' + edu.field for edu in sanitized.education]}\n\n"
        "Instructions:\n"
        "1. Match required skills vs candidate skills.\n"
        "2. Assess experience duration and relevance.\n"
        "3. Assess education alignment.\n"
        "4. Produce a fit_percentage (0-100), matched_skills, missing_skills, and a 2-3 sentence rationale."
    )

    logger.info("[LLM] Calling gpt-4o for candidate scoring (job_id=%s).", job.id)
    response = await c.beta.chat.completions.parse(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": "You are an objective, bias-free AI recruitment evaluator."},
            {"role": "user", "content": prompt}
        ],
        response_format=StrictScoringResult,
        temperature=0.0
    )
    result = response.choices[0].message.parsed
    logger.info("[LLM] Scoring complete: fit=%d%%, matched=%s", result.fit_percentage, result.matched_skills)
    return result


async def generate_interview_questions(
    job: Job,
    sanitized_profile: SanitizedProfile,
    missing_skills: List[str],
    num_questions: int = 5
) -> List[Dict[str, str]]:
    """Generate targeted interview questions based on job requirements and candidate skill gaps."""
    c = get_client()
    if not c:
        if not settings.ALLOW_DEVELOPMENT_FALLBACKS:
            raise RuntimeError("OpenAI is not configured for interview question generation")
        logger.warning("[LLM] generate_interview_questions: client=None, returning mock questions.")
        questions = []
        for gap in missing_skills[:3]:
            questions.append({
                "question_text": f"Can you describe your experience with {gap} and how you have applied it in past projects?",
                "target_skill_gap": gap
            })
        while len(questions) < num_questions:
            questions.append({
                "question_text": "Describe a challenging technical problem you solved and walk us through your approach.",
                "target_skill_gap": "General Problem Solving"
            })
        return questions[:num_questions]

    prompt = (
        f"Generate exactly {num_questions} targeted interview questions for a candidate applying to '{job.title}'.\n\n"
        f"Job Requirements:\n{_truncate(job.raw_description, 3000)}\n\n"
        f"Required Skills: {job.required_skills}\n"
        f"Candidate Skill Gaps: {missing_skills}\n"
        f"Candidate Skills: {sanitized_profile.skills}\n"
        f"Candidate Experience: {[exp.role + ' at ' + exp.company for exp in sanitized_profile.work_experience]}\n\n"
        "Rules:\n"
        "1. Probe the top skill gaps with practical scenario questions.\n"
        "2. Verify depth in matched skills.\n"
        "3. Include at least one behavioral question.\n"
        f"4. Return exactly {num_questions} questions."
    )

    logger.info("[LLM] Calling gpt-4o-mini for interview question generation (job_id=%s, n=%d).", job.id, num_questions)
    try:
        response = await c.beta.chat.completions.parse(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are an expert technical interviewer generating tailored questions."},
                {"role": "user", "content": prompt}
            ],
            response_format=InterviewQuestionsResponseSchema,
            temperature=0.3
        )
        parsed = response.choices[0].message.parsed
        logger.info("[LLM] Generated %d interview questions.", len(parsed.questions))
        return [q.model_dump() for q in parsed.questions[:num_questions]]
    except Exception as e:
        raise RuntimeError(f"OpenAI question generation failed: {str(e)}")
