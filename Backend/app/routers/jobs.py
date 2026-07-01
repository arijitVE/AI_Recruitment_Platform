from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.database import get_db
from app.models import Job, JobStatus
from app.schemas import JobCreate, JobResponse
from app.services.skill_normalizer import skill_normalizer
from app.services.profile_renderer import render_job_profile_text

router = APIRouter(prefix="/jobs", tags=["Jobs"])


@router.post("", response_model=JobResponse, status_code=status.HTTP_201_CREATED)
async def create_job(job_in: JobCreate, db: AsyncSession = Depends(get_db)):
    # Normalize required skills
    norm_skills = skill_normalizer.normalize_skills(job_in.required_skills or [])
    
    # Create job instance
    job = Job(
        title=job_in.title,
        raw_description=job_in.raw_description,
        required_skills=norm_skills,
        required_experience_years=job_in.required_experience_years,
        required_education=job_in.required_education,
        status=JobStatus.OPEN,
        created_by=job_in.created_by,
    )
    
    # Render profile text
    job.profile_text = render_job_profile_text(job)

    db.add(job)
    await db.commit()
    await db.refresh(job)
    return job


@router.get("", response_model=List[JobResponse])
async def list_jobs(status_filter: JobStatus = None, db: AsyncSession = Depends(get_db)):
    query = select(Job)
    if status_filter:
        query = query.where(Job.status == status_filter)
    result = await db.execute(query)
    jobs = result.scalars().all()
    return jobs


@router.get("/{job_id}", response_model=JobResponse)
async def get_job(job_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Job).where(Job.id == job_id))
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job
