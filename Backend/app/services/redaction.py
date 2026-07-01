import re

from app.schemas import CandidateProfile, SanitizedProfile
from app.services.skill_normalizer import skill_normalizer


_EMAIL = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE)
_PHONE = re.compile(r"(?<!\w)(?:\+?\d[\d ()-]{7,}\d)(?!\w)")
_URL = re.compile(r"\b(?:https?://|www\.)\S+", re.IGNORECASE)


def _redact_free_text(value: str, profile: CandidateProfile) -> str:
    text = value or ""
    for pii in (profile.full_name, profile.email, profile.phone, profile.address):
        if pii and len(pii.strip()) >= 3:
            text = re.sub(re.escape(pii.strip()), "[REDACTED]", text, flags=re.IGNORECASE)
    text = _EMAIL.sub("[REDACTED]", text)
    text = _PHONE.sub("[REDACTED]", text)
    return _URL.sub("[REDACTED]", text)


def sanitize_profile(profile: CandidateProfile) -> SanitizedProfile:
    """
    Pure deterministic function that creates a SanitizedProfile by stripping all PII fields
    (name, gender, age/dob, marital status, religion, address, photo/contact info).
    Enforces the bias-aware redaction boundary.
    """
    # We construct a SanitizedProfile copying strictly only job-relevant fields:
    sanitized = SanitizedProfile(
        skills=skill_normalizer.normalize_skills(profile.skills or []),
        work_experience=[
            item.model_copy(update={
                "responsibilities": [_redact_free_text(text, profile) for text in item.responsibilities]
            })
            for item in (profile.work_experience or [])
        ],
        education=list(profile.education or []),
        certifications=[_redact_free_text(text, profile) for text in (profile.certifications or [])],
        projects=[
            item.model_copy(update={
                "name": _redact_free_text(item.name, profile),
                "description": _redact_free_text(item.description, profile),
            })
            for item in (profile.projects or [])
        ],
    )
    return sanitized
