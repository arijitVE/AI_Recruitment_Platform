from pathlib import Path

import pytest

from app.services.parser import _validate_markdown, parse_resume_file


def test_parser_rejects_binary_pdf_content():
    with pytest.raises(RuntimeError, match="binary content"):
        _validate_markdown("%PDF-1.7\n" + ("binary payload " * 10), "resume.pdf")


def test_parser_rejects_empty_docling_output():
    with pytest.raises(RuntimeError, match="too little text"):
        _validate_markdown("short output", "resume.pdf")


def test_parser_rejects_unsupported_files(tmp_path: Path):
    resume = tmp_path / "resume.txt"
    resume.write_text("Resume text", encoding="utf-8")

    with pytest.raises(ValueError, match="Only PDF and DOCX"):
        parse_resume_file(str(resume))
