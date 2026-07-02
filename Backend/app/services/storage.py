import re
import uuid
import logging
from pathlib import Path

from fastapi import UploadFile

from app.config import settings

logger = logging.getLogger(__name__)

_ALLOWED_SUFFIXES = {".pdf", ".docx"}
_SAFE_FILENAME = re.compile(r"[^A-Za-z0-9_. -]+")
_CHUNK_SIZE = 1024 * 1024


def sanitize_original_filename(filename: str | None) -> str:
    """Return a display-safe basename; storage never uses this as its path."""
    # Normalize Windows separators before applying Path.name on POSIX.
    basename = Path((filename or "resume").replace("\\", "/")).name
    cleaned = _SAFE_FILENAME.sub("_", basename).strip(" ._")
    if not cleaned:
        cleaned = "resume"
    suffix = Path(cleaned).suffix.lower()
    if suffix not in _ALLOWED_SUFFIXES:
        raise ValueError("Only PDF and DOCX resumes are supported")
    stem = Path(cleaned).stem[:180].rstrip(" ._") or "resume"
    return f"{stem}{suffix}"


def _signature_matches(suffix: str, header: bytes) -> bool:
    if suffix == ".pdf":
        return header.startswith(b"%PDF-")
    # DOCX is an OpenXML ZIP container.
    return suffix == ".docx" and header.startswith(b"PK")


async def save_uploaded_file(file: UploadFile, job_id: int) -> tuple[str, str]:
    """Validate and save an upload to Supabase storage (if configured) or local disk."""
    original_filename = sanitize_original_filename(file.filename)
    suffix = Path(original_filename).suffix.lower()

    # Read all bytes into memory for validation and upload
    file_bytes = await file.read()
    await file.close()

    total = len(file_bytes)
    if total == 0:
        raise ValueError("Uploaded resume is empty")
    if total > settings.MAX_UPLOAD_BYTES:
        raise ValueError(
            f"Resume exceeds the {settings.MAX_UPLOAD_BYTES // (1024 * 1024)} MB upload limit"
        )

    header = file_bytes[:8]
    if not _signature_matches(suffix, header):
        raise ValueError(f"Uploaded content is not a valid {suffix[1:].upper()} file")

    # Try Supabase storage first if configured
    try:
        from app.services.supabase_storage import is_supabase_configured, upload_to_supabase
        if is_supabase_configured():
            content_type = "application/pdf" if suffix == ".pdf" else "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            supabase_url = upload_to_supabase(file_bytes, original_filename, content_type=content_type)
            if supabase_url:
                return supabase_url, original_filename
    except Exception as e:
        logger.warning(f"Supabase upload failed or not configured, falling back to local disk storage: {e}")

    # Fallback to local disk storage
    job_dir = (Path(settings.STORAGE_PATH) / f"job_{job_id}").resolve()
    job_dir.mkdir(parents=True, exist_ok=True)

    file_path = (job_dir / f"{uuid.uuid4().hex}{suffix}").resolve()
    if job_dir not in file_path.parents:
        raise ValueError("Invalid upload path")

    try:
        with file_path.open("xb") as buffer:
            buffer.write(file_bytes)
    except Exception:
        file_path.unlink(missing_ok=True)
        raise

    return str(file_path), original_filename
