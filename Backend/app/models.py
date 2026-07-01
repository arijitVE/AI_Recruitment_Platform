from datetime import datetime, timezone
import enum
from typing import Any
from sqlalchemy import (
    Column,
    Integer,
    String,
    Text,
    Float,
    ForeignKey,
    DateTime,
    JSON,
    Enum as SAEnum,
)
from sqlalchemy.orm import relationship
from app.database import Base


class JobStatus(str, enum.Enum):
    OPEN = "open"
    CLOSED = "closed"
    DRAFT = "draft"


class CandidateStatus(str, enum.Enum):
    UPLOADED = "uploaded"
    PARSING = "parsing"
    EXTRACTING = "extracting"
    SANITIZING = "sanitizing"
    EMBEDDING = "embedding"
    READY_FOR_MATCHING = "ready_for_matching"
    MATCHING = "matching"
    COMPLETED = "completed"
    PARSING_FAILED = "parsing_failed"
    EXTRACTION_FAILED = "extraction_failed"
    EMBEDDING_FAILED = "embedding_failed"
    NEEDS_MANUAL_REVIEW = "needs_manual_review"


class DecisionStatus(str, enum.Enum):
    HIRED = "hired"
    REJECTED = "rejected"
    ON_HOLD = "on_hold"


class Job(Base):
    __tablename__ = "jobs"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(255), nullable=False)
    raw_description = Column(Text, nullable=False)
    required_skills = Column(JSON, default=list, nullable=False)
    required_experience_years = Column(Integer, nullable=True)
    required_education = Column(Text, nullable=True)
    profile_text = Column(Text, nullable=True)  # Rendered job requirement text
    pinecone_vector_id = Column(String(255), nullable=True)
    status = Column(SAEnum(JobStatus), default=JobStatus.OPEN, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    created_by = Column(Integer, nullable=True)

    candidates = relationship("Candidate", back_populates="job", cascade="all, delete-orphan")
    scores = relationship("Score", back_populates="job", cascade="all, delete-orphan")
    questions = relationship("InterviewQuestion", back_populates="job", cascade="all, delete-orphan")
    feedback = relationship("Feedback", back_populates="job", cascade="all, delete-orphan")


class Candidate(Base):
    __tablename__ = "candidates"

    id = Column(Integer, primary_key=True, index=True)
    job_id = Column(Integer, ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False, index=True)
    original_filename = Column(String(255), nullable=False)
    raw_file_storage_path = Column(String(512), nullable=False)
    parsed_markdown = Column(Text, nullable=True)
    structured_profile = Column(JSON, nullable=True)  # Unredacted profile with name/PII
    sanitized_profile = Column(JSON, nullable=True)   # Redacted profile without PII
    profile_text = Column(Text, nullable=True)        # Exact rendered text embedded
    pinecone_vector_id = Column(String(255), nullable=True)
    status = Column(SAEnum(CandidateStatus), default=CandidateStatus.UPLOADED, nullable=False, index=True)
    status_detail = Column(Text, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)

    job = relationship("Job", back_populates="candidates")
    scores = relationship("Score", back_populates="candidate", cascade="all, delete-orphan")
    questions = relationship("InterviewQuestion", back_populates="candidate", cascade="all, delete-orphan")
    feedback = relationship("Feedback", back_populates="candidate", cascade="all, delete-orphan")


class Score(Base):
    __tablename__ = "scores"

    id = Column(Integer, primary_key=True, index=True)
    job_id = Column(Integer, ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False, index=True)
    candidate_id = Column(Integer, ForeignKey("candidates.id", ondelete="CASCADE"), nullable=False, index=True)
    vector_similarity_score = Column(Float, nullable=True)
    fit_percentage = Column(Integer, nullable=True)
    matched_skills = Column(JSON, default=list, nullable=False)
    missing_skills = Column(JSON, default=list, nullable=False)
    rationale = Column(Text, nullable=True)
    scored_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)

    job = relationship("Job", back_populates="scores")
    candidate = relationship("Candidate", back_populates="scores")


class InterviewQuestion(Base):
    __tablename__ = "interview_questions"

    id = Column(Integer, primary_key=True, index=True)
    candidate_id = Column(Integer, ForeignKey("candidates.id", ondelete="CASCADE"), nullable=False, index=True)
    job_id = Column(Integer, ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False, index=True)
    question_text = Column(Text, nullable=False)
    target_skill_gap = Column(String(255), nullable=True)
    generated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)

    job = relationship("Job", back_populates="questions")
    candidate = relationship("Candidate", back_populates="questions")


class Feedback(Base):
    __tablename__ = "feedback"

    id = Column(Integer, primary_key=True, index=True)
    candidate_id = Column(Integer, ForeignKey("candidates.id", ondelete="CASCADE"), nullable=False, index=True)
    job_id = Column(Integer, ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False, index=True)
    recruiter_notes = Column(Text, nullable=True)
    decision = Column(SAEnum(DecisionStatus), nullable=False)
    recorded_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    recorded_by = Column(Integer, nullable=True)

    job = relationship("Job", back_populates="feedback")
    candidate = relationship("Candidate", back_populates="feedback")


class AuditLog(Base):
    __tablename__ = "audit_log"

    id = Column(Integer, primary_key=True, index=True)
    candidate_id = Column(Integer, ForeignKey("candidates.id", ondelete="SET NULL"), nullable=True, index=True)
    job_id = Column(Integer, ForeignKey("jobs.id", ondelete="SET NULL"), nullable=True, index=True)
    event = Column(String(255), nullable=False, index=True)
    payload_snapshot = Column(JSON, nullable=True)
    timestamp = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
