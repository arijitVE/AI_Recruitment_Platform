# AI Recruitment Platform Backend

Bias-aware AI-assisted recruitment platform built with FastAPI, PostgreSQL (SQLAlchemy Async), OpenAI Structured Outputs, Docling, and Pinecone.

## Features
- **Bias-Aware Redaction Boundary**: Strictly sanitizes candidate profiles to strip all personally identifiable information (PII) before vector embedding and AI scoring.
- **Async State Machine**: Granular candidate processing pipeline (`uploaded` -> `parsing` -> `extracting` -> `sanitizing` -> `embedding` -> `ready_for_matching`).
- **Two-Stage Hybrid Matching**: Stage 1 fast vector similarity retrieval via Pinecone job namespaces + Stage 2 precision LLM rubric comparison (`fit_percentage`, `matched_skills`, `missing_skills`, `rationale`).
- **Targeted Interview Questions**: Automatically generates skill-gap focused questions for shortlisted candidates.
- **Audit Logging**: Tracks critical operations (redaction, scoring, raw resume recruiter viewing).

## Setup & Running Locally

1. Create a virtual environment and install dependencies:
```bash
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

2. Copy environment variables template:
```bash
copy .env.example .env
```

3. Run the development server:
```bash
uvicorn app.main:app --reload --port 8000
```

4. Access API Interactive Documentation (Swagger UI):
Navigate to `http://127.0.0.1:8000/docs`

## Running Tests
```bash
pytest tests/ -v
```
