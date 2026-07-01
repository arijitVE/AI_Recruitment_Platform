from app.schemas import CandidateProfile, WorkExperienceItem, EducationItem, ProjectItem
from app.services.redaction import sanitize_profile


def test_sanitize_profile_strips_all_pii():
    raw_profile = CandidateProfile(
        full_name="Jane Doe",
        email="jane.doe@example.com",
        phone="+1-555-0199",
        gender="Female",
        age_or_dob="1990-01-01",
        marital_status="Married",
        religion="Prefer not to say",
        address="101 Main Street, New York, NY",
        skills=["Python", "FastAPI"],
        work_experience=[
            WorkExperienceItem(
                company="Acme Corp",
                role="Senior Engineer",
                duration="4 years",
                responsibilities=["Led backend architecture"]
            )
        ],
        education=[
            EducationItem(
                degree="B.S.",
                field="Computer Science",
                institution="MIT"
            )
        ],
        certifications=["CKA"],
        projects=[
            ProjectItem(name="API Gateway", description="Built high-speed gateway")
        ]
    )

    sanitized = sanitize_profile(raw_profile)
    data_dict = sanitized.model_dump()

    # Assert PII keys do not exist on sanitized object output
    forbidden_keys = [
        "full_name", "email", "phone", "gender",
        "age_or_dob", "marital_status", "religion", "address"
    ]
    for key in forbidden_keys:
        assert key not in data_dict

    # Assert job-relevant keys are preserved exactly
    assert data_dict["skills"] == ["Python", "FastAPI"]
    assert len(data_dict["work_experience"]) == 1
    assert data_dict["work_experience"][0]["company"] == "Acme Corp"
    assert len(data_dict["education"]) == 1
    assert data_dict["certifications"] == ["CKA"]
    assert len(data_dict["projects"]) == 1
