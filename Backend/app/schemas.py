from datetime import datetime
from typing import Any, List, Optional
from pydantic import BaseModel, Field, ConfigDict
from app.models import JobStatus, CandidateStatus, DecisionStatus


# Job Schemas
class JobCreate(BaseModel):
    title: str = Field(..., json_schema_extra={"example": "Senior Python Engineer"})
    raw_description: str = Field(..., json_schema_extra={"example": "We are looking for a Senior Python Engineer experienced in FastAPI, PostgreSQL, and AI integrations..."})
    required_skills: Optional[List[str]] = Field(default=None, json_schema_extra={"example": ["Python", "FastAPI", "PostgreSQL", "OpenAI"]})
    required_experience_years: Optional[int] = Field(default=None, json_schema_extra={"example": 5})
    required_education: Optional[str] = Field(default=None, json_schema_extra={"example": "Bachelor's in Computer Science or related"})
    created_by: Optional[int] = None


class JobResponse(BaseModel):
    id: int
    title: str
    raw_description: str
    required_skills: List[str]
    required_experience_years: Optional[int]
    required_education: Optional[str]
    profile_text: Optional[str]
    status: JobStatus
    created_at: datetime
    created_by: Optional[int]

    model_config = ConfigDict(from_attributes=True)


# Candidate Extraction & Sanitization Schemas
class WorkExperienceItem(BaseModel):
    company: str
    role: str
    duration: str
    responsibilities: List[str]


class EducationItem(BaseModel):
    degree: str
    field: str
    institution: str


class ProjectItem(BaseModel):
    name: str
    description: str


class CandidateProfile(BaseModel):
    """Full extracted candidate profile containing PII (retained for recruiter view only)."""
    full_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    gender: Optional[str] = None
    age_or_dob: Optional[str] = None
    marital_status: Optional[str] = None
    religion: Optional[str] = None
    address: Optional[str] = None
    skills: List[str] = Field(default_factory=list)
    work_experience: List[WorkExperienceItem] = Field(default_factory=list)
    education: List[EducationItem] = Field(default_factory=list)
    certifications: List[str] = Field(default_factory=list)
    projects: List[ProjectItem] = Field(default_factory=list)


class SanitizedProfile(BaseModel):
    """Redacted candidate profile strictly stripped of PII. Safe for AI embedding & scoring."""
    skills: List[str] = Field(default_factory=list)
    work_experience: List[WorkExperienceItem] = Field(default_factory=list)
    education: List[EducationItem] = Field(default_factory=list)
    certifications: List[str] = Field(default_factory=list)
    projects: List[ProjectItem] = Field(default_factory=list)


class CandidateResponse(BaseModel):
    id: int
    job_id: int
    original_filename: str
    status: CandidateStatus
    status_detail: Optional[str]
    sanitized_profile: Optional[SanitizedProfile]
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class CandidateDetailResponse(CandidateResponse):
    structured_profile: Optional[CandidateProfile]
    parsed_markdown: Optional[str]


# Scoring & Ranking Schemas
class ScoreResponse(BaseModel):
    id: int
    job_id: int
    candidate_id: int
    vector_similarity_score: Optional[float]
    fit_percentage: Optional[int]
    matched_skills: List[str]
    missing_skills: List[str]
    rationale: Optional[str]
    scored_at: datetime

    model_config = ConfigDict(from_attributes=True)


class RankedCandidateResponse(BaseModel):
    candidate_id: int
    original_filename: str
    status: CandidateStatus
    fit_percentage: int
    vector_similarity_score: Optional[float]
    matched_skills: List[str]
    missing_skills: List[str]
    rationale: Optional[str]


# Interview Questions Schemas
class InterviewQuestionResponse(BaseModel):
    id: int
    candidate_id: int
    job_id: int
    question_text: str
    target_skill_gap: Optional[str]
    generated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class InterviewQuestionGenerateRequest(BaseModel):
    num_questions: int = Field(default=5, ge=1, le=10)


# Feedback Schemas
class FeedbackCreate(BaseModel):
    recruiter_notes: Optional[str] = None
    decision: DecisionStatus
    recorded_by: Optional[int] = None


class FeedbackResponse(BaseModel):
    id: int
    candidate_id: int
    job_id: int
    recruiter_notes: Optional[str]
    decision: DecisionStatus
    recorded_at: datetime
    recorded_by: Optional[int]

    model_config = ConfigDict(from_attributes=True)
