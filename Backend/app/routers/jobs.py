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

    # Automatically create embeddings and save in vector DB
    try:
        from app.services.vector_store import generate_embedding, vector_store
        import logging
        vector = await generate_embedding(job.profile_text or job.raw_description)
        vector_id = f"job_{job.id}"
        await vector_store.upsert_vector(
            namespace=str(job.id),
            vector_id=vector_id,
            vector=vector,
            metadata={"job_id": job.id, "type": "job", "title": job.title}
        )
        await vector_store.upsert_vector(
            namespace="jobs",
            vector_id=vector_id,
            vector=vector,
            metadata={"job_id": job.id, "type": "job", "title": job.title}
        )
        job.pinecone_vector_id = vector_id
        await db.commit()
        await db.refresh(job)
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning("Failed to generate/save job embedding for job_id=%d: %s", job.id, str(e))
        job.status = JobStatus.DRAFT
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


from pydantic import BaseModel
class JobStatusUpdateRequest(BaseModel):
    status: str

@router.patch("/{job_id}/status")
async def update_job_status(job_id: int, req: JobStatusUpdateRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Job).where(Job.id == job_id))
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    upper_status = req.status.strip().upper()
    try:
        enum_val = JobStatus[upper_status]
    except KeyError:
        raise HTTPException(status_code=400, detail=f"Invalid status '{upper_status}'. Must be OPEN, DRAFT, or CLOSED.")
    
    job.status = enum_val
    await db.commit()
    await db.refresh(job)
    return {"success": True, "id": str(job.id), "status": upper_status}
