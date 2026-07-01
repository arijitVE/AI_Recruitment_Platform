from app.schemas import SanitizedProfile, WorkExperienceItem, EducationItem
from app.services.profile_renderer import render_candidate_profile_text


def test_render_candidate_profile_text():
    profile = SanitizedProfile(
        skills=["js", "Python"],
        work_experience=[
            WorkExperienceItem(company="CompA", role="Dev", duration="2 yrs", responsibilities=["Coding"])
        ],
        education=[
            EducationItem(degree="BS", field="CS", institution="Uni")
        ],
        certifications=[],
        projects=[]
    )

    rendered = render_candidate_profile_text(profile)
    assert "Skills:" in rendered
    assert "JavaScript, Python" in rendered
    assert "Experience:" in rendered
    assert "- 2 yrs | Dev at CompA: Coding" in rendered
    assert "Education:" in rendered
    assert "- BS in CS from Uni" in rendered
