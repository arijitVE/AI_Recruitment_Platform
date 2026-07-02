from pathlib import Path


_MIN_PARSED_CHARS = 80

def _validate_markdown(markdown_text: str, file_path: str) -> str:
    """Reject empty/binary output before it can reach the LLM."""
    text = (markdown_text or "").strip()
    if len(text) < _MIN_PARSED_CHARS:
        raise RuntimeError(
            f"Docling produced too little text ({len(text)} characters) for {Path(file_path).name}"
        )
    if text.startswith("%PDF-") or "\x00" in text:
        raise RuntimeError(f"Docling produced binary content for {Path(file_path).name}")
    return text


import tempfile
import urllib.request
from urllib.parse import urlparse

def parse_resume_file(file_path: str) -> str:
    """Parse PDF or DOCX resume to clean Markdown format using Docling."""
    temp_file = None
    target_path = file_path

    if file_path.startswith("http://") or file_path.startswith("https://"):
        parsed_url = urlparse(file_path)
        suffix = Path(parsed_url.path).suffix.lower() or ".pdf"
        temp_file = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
        target_path = temp_file.name
        try:
            req = urllib.request.Request(file_path, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req) as resp:
                temp_file.write(resp.read())
            temp_file.close()
        except Exception as e:
            if temp_file:
                Path(temp_file.name).unlink(missing_ok=True)
            raise FileNotFoundError(f"Failed to download remote resume from {file_path}: {e}")

    path = Path(target_path)
    if not path.is_file():
        raise FileNotFoundError(f"File not found: {target_path}")

    if path.suffix.lower() not in {".pdf", ".docx"}:
        if temp_file:
            Path(temp_file.name).unlink(missing_ok=True)
        raise ValueError("Only PDF and DOCX resumes are supported")

    try:
        from docling.datamodel.base_models import InputFormat
        from docling.datamodel.pipeline_options import PdfPipelineOptions, RapidOcrOptions
        from docling.document_converter import DocumentConverter, PdfFormatOption

        pdf_options = PdfPipelineOptions()
        # Explicitly use ONNX. Auto-selection currently chooses RapidOCR's torch
        # backend when torch is installed, but PP-OCRv6 is unsupported there.
        pdf_options.ocr_options = RapidOcrOptions(backend="onnxruntime")
        converter = DocumentConverter(
            allowed_formats=[InputFormat.PDF, InputFormat.DOCX],
            format_options={
                InputFormat.PDF: PdfFormatOption(pipeline_options=pdf_options),
            },
        )
        result = converter.convert(target_path)
        markdown_text = result.document.export_to_markdown()
        return _validate_markdown(markdown_text, file_path)
    except Exception as e:
        raise RuntimeError(f"Docling parsing failed for {path.name}: {e}") from e
    finally:
        if temp_file:
            Path(temp_file.name).unlink(missing_ok=True)
