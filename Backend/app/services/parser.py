import os


def parse_resume_file(file_path: str) -> str:
    """Parse PDF or DOCX resume to clean Markdown format using Docling."""
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"File not found: {file_path}")

    try:
        from docling.document_converter import DocumentConverter
        converter = DocumentConverter()
        result = converter.convert(file_path)
        markdown_text = result.document.export_to_markdown()
        return markdown_text
    except Exception as e:
        # Fallback if Docling conversion fails or for simple text files during local test
        try:
            with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()
                if content.strip():
                    return content
        except Exception:
            pass
        raise RuntimeError(f"Docling parsing failed: {str(e)}")
