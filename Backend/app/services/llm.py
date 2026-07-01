import json
from typing import List, Dict, Any
from openai import AsyncOpenAI
from pydantic import BaseModel, Field

from app.config import settings
from app.schemas import CandidateProfile, SanitizedProfile, WorkExperienceItem, EducationItem, ProjectItem
from app.models import Job

# Initialize OpenAI client if valid key is present
client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY) if settings.OPENAI_API_KEY and settings.OPENAI_API_KEY != "test_key" else None


class InterviewQuestionsResponseSchema(BaseModel):
    questions: List[Dict[str, str]] = Field(
        ...,
        description="List of dicts with 'question_text' and 'target_skill_gap'"
    )


async def extract_structured_profile(resume_markdown: str) -> CandidateProfile:
    """Extract full structured profile from parsed resume markdown using OpenAI structured outputs."""
    if not client:
        # Mock extraction fallback for testing or when test_key is set
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
                EducationItem(
                    degree="Bachelor of Science",
                    field="Computer Science",
                    institution="State University"
                )
            ],
            certifications=["AWS Certified Cloud Practitioner"],
            projects=[
                ProjectItem(
                    name="AI Chatbot",
                    description="Built a chatbot using OpenAI API and Python"
                )
            ]
        )

    prompt = (
        "Extract the candidate's structured profile information from the following resume text. "
        "Extract every section accurately. If any detail is missing, leave it null or empty list.\n\n"
        f"Resume Markdown:\n{resume_markdown}"
    )

    try:
        response = await client.beta.chat.completions.parse(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are an expert HR recruitment parser extracting strict structured data."},
                {"role": "user", "content": prompt}
            ],
            response_format=CandidateProfile,
            temperature=0.0
        )
        profile = response.choices[0].message.parsed
        return profile
    except Exception as e:
        raise RuntimeError(f"OpenAI structured extraction failed: {str(e)}")


async def generate_interview_questions(
    job: Job,
    sanitized_profile: SanitizedProfile,
    missing_skills: List[str],
    num_questions: int = 5
) -> List[Dict[str, str]]:
    """Generate targeted interview questions based on job requirements and candidate skill gaps."""
    if not client:
        # Mock question generation fallback
        questions = []
        for i, gap in enumerate(missing_skills[:3]):
            questions.append({
                "question_text": f"We noticed {gap} is listed as a required skill for this role. Can you describe any practical exposure or relevant concepts you know regarding {gap}?",
                "target_skill_gap": gap
            })
        while len(questions) < num_questions:
            questions.append({
                "question_text": "Could you walk us through one of your most challenging software architecture projects and how you handled system scalability?",
                "target_skill_gap": "General Problem Solving"
            })
        return questions[:num_questions]

    prompt = (
        f"Generate {num_questions} targeted interview questions for a candidate shortlisted for the role of '{job.title}'.\n\n"
        f"Job Description Requirements:\n{job.raw_description}\n\n"
        f"Required Skills: {job.required_skills}\n"
        f"Candidate Missing Skills (Gaps): {missing_skills}\n\n"
        f"Candidate Sanitized Profile Summary:\nSkills: {sanitized_profile.skills}\n"
        f"Experience: {[exp.role + ' at ' + exp.company for exp in sanitized_profile.work_experience]}\n\n"
        "Instructions:\n"
        "1. Include questions probing the top missing skills to assess practical aptitude.\n"
        "2. Include questions verifying depth on strongest matched skills.\n"
        "3. Include role-general behavioral questions.\n"
        "Return strict JSON with 'questions' list containing objects with 'question_text' and 'target_skill_gap'."
    )

    try:
        response = await client.beta.chat.completions.parse(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are an expert technical interviewer generating tailored questions."},
                {"role": "user", "content": prompt}
            ],
            response_format=InterviewQuestionsResponseSchema,
            temperature=0.3
        )
        parsed = response.choices[0].message.parsed
        return parsed.questions[:num_questions]
    except Exception as e:
        raise RuntimeError(f"OpenAI question generation failed: {str(e)}")
