from io import BytesIO

import pytest
from fastapi import UploadFile

from app.services.storage import sanitize_original_filename, save_uploaded_file


def test_sanitize_filename_removes_path_components():
    assert sanitize_original_filename("../../../etc/resume.pdf") == "resume.pdf"
    assert sanitize_original_filename(r"..\..\Candidate Resume.docx") == "Candidate Resume.docx"


def test_sanitize_filename_rejects_unsupported_extension():
    with pytest.raises(ValueError, match="Only PDF and DOCX"):
        sanitize_original_filename("payload.exe")


@pytest.mark.asyncio
async def test_upload_rejects_extension_content_mismatch(tmp_path, monkeypatch):
    monkeypatch.setattr("app.services.storage.settings.STORAGE_PATH", str(tmp_path))
    upload = UploadFile(filename="resume.pdf", file=BytesIO(b"not a pdf"))

    with pytest.raises(ValueError, match="not a valid PDF"):
        await save_uploaded_file(upload, 1)

    assert not list(tmp_path.rglob("*.pdf"))
