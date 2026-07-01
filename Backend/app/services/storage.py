import os
import shutil
import uuid
from fastapi import UploadFile
from app.config import settings


async def save_uploaded_file(file: UploadFile, job_id: int) -> str:
    """Save an uploaded file to secure storage and return its absolute path."""
    job_dir = os.path.join(settings.STORAGE_PATH, f"job_{job_id}")
    os.makedirs(job_dir, exist_ok=True)

    unique_filename = f"{uuid.uuid4().hex}_{file.filename}"
    file_path = os.path.abspath(os.path.join(job_dir, unique_filename))

    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    return file_path
