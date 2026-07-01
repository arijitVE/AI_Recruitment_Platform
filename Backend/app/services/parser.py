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


def parse_resume_file(file_path: str) -> str:
    """Parse PDF or DOCX resume to clean Markdown format using Docling."""
    path = Path(file_path)
    if not path.is_file():
        raise FileNotFoundError(f"File not found: {file_path}")

    if path.suffix.lower() not in {".pdf", ".docx"}:
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
        result = converter.convert(file_path)
        markdown_text = result.document.export_to_markdown()
        return _validate_markdown(markdown_text, file_path)
    except Exception as e:
        raise RuntimeError(f"Docling parsing failed for {path.name}: {e}") from e
