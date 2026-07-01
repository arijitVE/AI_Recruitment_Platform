import re
import uuid
from pathlib import Path

from fastapi import UploadFile

from app.config import settings

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
    """Validate and stream an upload to a contained, server-generated path."""
    original_filename = sanitize_original_filename(file.filename)
    suffix = Path(original_filename).suffix.lower()
    job_dir = (Path(settings.STORAGE_PATH) / f"job_{job_id}").resolve()
    job_dir.mkdir(parents=True, exist_ok=True)

    file_path = (job_dir / f"{uuid.uuid4().hex}{suffix}").resolve()
    if job_dir not in file_path.parents:
        raise ValueError("Invalid upload path")

    total = 0
    header = b""
    try:
        with file_path.open("xb") as buffer:
            while chunk := await file.read(_CHUNK_SIZE):
                if not header:
                    header = chunk[:8]
                    if not _signature_matches(suffix, header):
                        raise ValueError(f"Uploaded content is not a valid {suffix[1:].upper()} file")
                total += len(chunk)
                if total > settings.MAX_UPLOAD_BYTES:
                    raise ValueError(
                        f"Resume exceeds the {settings.MAX_UPLOAD_BYTES // (1024 * 1024)} MB upload limit"
                    )
                buffer.write(chunk)
        if total == 0:
            raise ValueError("Uploaded resume is empty")
    except Exception:
        file_path.unlink(missing_ok=True)
        raise
    finally:
        await file.close()

    return str(file_path), original_filename
