from typing import Union, List, Any
from app.schemas import SanitizedProfile, CandidateProfile
from app.models import Job
from app.services.skill_normalizer import skill_normalizer


def render_candidate_profile_text(profile: Union[SanitizedProfile, CandidateProfile]) -> str:
    """Render a sanitized or candidate profile into deterministic text for embedding."""
    norm_skills = skill_normalizer.normalize_skills(profile.skills or [])
    skills_str = ", ".join(norm_skills) if norm_skills else "None listed"

    exp_lines = []
    for exp in (profile.work_experience or []):
        resp = "; ".join(exp.responsibilities) if exp.responsibilities else ""
        exp_lines.append(f"- {exp.duration} | {exp.role} at {exp.company}: {resp}")
    exp_str = "\n".join(exp_lines) if exp_lines else "None listed"

    edu_lines = []
    for edu in (profile.education or []):
        edu_lines.append(f"- {edu.degree} in {edu.field} from {edu.institution}")
    edu_str = "\n".join(edu_lines) if edu_lines else "None listed"

    cert_str = ", ".join(profile.certifications) if profile.certifications else "None listed"

    proj_lines = []
    for p in (profile.projects or []):
        proj_lines.append(f"- {p.name}: {p.description}")
    proj_str = "\n".join(proj_lines) if proj_lines else "None listed"

    return (
        f"Skills:\n{skills_str}\n\n"
        f"Experience:\n{exp_str}\n\n"
        f"Education:\n{edu_str}\n\n"
        f"Certifications:\n{cert_str}\n\n"
        f"Projects:\n{proj_str}"
    )


def render_job_profile_text(job: Any) -> str:
    """Render a job or job requirements object into deterministic text for embedding comparison."""
    skills = getattr(job, "required_skills", []) or []
    norm_skills = skill_normalizer.normalize_skills(skills)
    skills_str = ", ".join(norm_skills) if norm_skills else "None listed"

    exp_years = getattr(job, "required_experience_years", None)
    exp_str = f"Required experience: {exp_years} years\n" if exp_years is not None else ""
    raw_desc = getattr(job, "raw_description", "") or ""

    edu = getattr(job, "required_education", None)
    edu_str = f"Required education: {edu}" if edu else "Education: None specified"

    return (
        f"Job Title: {getattr(job, 'title', 'Untitled')}\n\n"
        f"Skills:\n{skills_str}\n\n"
        f"Experience:\n{exp_str}{raw_desc}\n\n"
        f"Education:\n{edu_str}"
    )
