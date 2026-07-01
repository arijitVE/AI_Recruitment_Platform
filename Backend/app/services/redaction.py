from app.schemas import CandidateProfile, SanitizedProfile


def sanitize_profile(profile: CandidateProfile) -> SanitizedProfile:
    """
    Pure deterministic function that creates a SanitizedProfile by stripping all PII fields
    (name, gender, age/dob, marital status, religion, address, photo/contact info).
    Enforces the bias-aware redaction boundary.
    """
    # We construct a SanitizedProfile copying strictly only job-relevant fields:
    sanitized = SanitizedProfile(
        skills=list(profile.skills or []),
        work_experience=list(profile.work_experience or []),
        education=list(profile.education or []),
        certifications=list(profile.certifications or []),
        projects=list(profile.projects or []),
    )
    return sanitized
