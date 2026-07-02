# AI Recruitment Platform Backend

A state-of-the-art, **Bias-Aware AI-Assisted Recruitment Platform** built with **FastAPI**, **PostgreSQL** (SQLAlchemy Async), **OpenAI Structured Outputs**, **Docling Document Parsing**, and **Pinecone Vector Database**.

---

## Table of Contents
1. [Core Architectural Highlights](#1-core-architectural-highlights)
2. [Complete API Route Reference](#2-complete-api-route-reference)
   - [Health Check](#21-health-check)
   - [Job Management Endpoints](#22-job-management-endpoints)
   - [Candidate Upload & Pipeline Endpoints](#23-candidate-upload--pipeline-endpoints)
   - [Matching & Ranking Endpoints](#24-matching--ranking-endpoints)
   - [Recruiter Review & Interview Tools](#25-recruiter-review--interview-tools)
3. [Detailed Data Input & Output Schemas](#3-detailed-data-input--output-schemas)
4. [Domain Model Enums & Status Lifecycle](#4-domain-model-enums--status-lifecycle)
5. [Service Modules Directory Architecture](#5-service-modules-directory-architecture)
6. [Local Setup, Configuration & Utilities](#6-local-setup-configuration--utilities)

---

## 1. Core Architectural Highlights

### Strict Bias-Aware Redaction Boundary
To enforce fair and unbiased recruitment practices, the platform implements a strict **redaction firewall**.
- **Rule**: *No AI matching, embedding generation, or rubric scoring step ever sees personally identifiable information (PII).*
- **Stripped Fields**: Full Name, Email, Phone Number, Headshot/Photo, Gender & Pronouns, Age/Date of Birth, Marital Status, Religion, and Street-Level Address.
- **Retained Job-Relevant Fields**: Technical & Soft Skills, Work Experience (Company, Role, Duration, Responsibilities), Education History (Degree, Field, Institution), Certifications, and Technical Projects.
- **Audit Compliance**: The raw resume and unredacted profile (`structured_profile`) are stored securely in PostgreSQL for recruiter inspection only. Any recruiter access to unredacted data automatically logs an immutable compliance event to the database (`audit_log` table).

### Asynchronous Candidate State Machine
Candidate resumes (PDF/DOCX) are uploaded via API and processed asynchronously in the background (`app.services.worker`) to prevent HTTP request timeouts:
`uploaded` ➔ `parsing` (Docling markdown conversion) ➔ `extracting` (OpenAI structured extraction) ➔ `sanitizing` (PII removal) ➔ `embedding` (Pinecone vector upsert) ➔ `ready_for_matching`.

### Two-Stage Hybrid Matching Pipeline
1. **Stage 1 (High-Speed Vector Retrieval)**: Encodes job requirements using OpenAI embeddings (`text-embedding-3-small`) and retrieves the top 30 nearest candidate vectors from Pinecone job namespaces (`str(job_id)`).
2. **Stage 2 (High-Precision LLM Rubric Evaluation)**: Evaluates the PII-redacted `sanitized_profile` of candidate matches against job requirements using OpenAI Structured Outputs (`run_stage2_scoring`), producing an exact `fit_percentage` (0–100), verified `matched_skills`, identified `missing_skills`, and comprehensive `rationale`.

---

## 2. Complete API Route Reference

### 2.1 Health Check

#### `GET /health`
Checks the operational readiness and version of the API service.

- **Tags**: `Health`
- **Request Parameters / Body**: None
- **Response Status**: `200 OK`
- **Response Schema**:
  ```json
  {
    "status": "ok",
    "version": "1.0.0"
  }
  ```

---

### 2.2 Job Management Endpoints

#### `POST /jobs`
Creates a new job requisition/posting. Automatically normalizes explicit required skills against `skill_synonyms.json` (e.g., standardizing `"js"` ➔ `"JavaScript"`, `"k8s"` ➔ `"Kubernetes"`), renders standard job profile text, stores the record in PostgreSQL, and generates an OpenAI vector embedding stored in Pinecone under namespaces `<job_id>` and `"jobs"`.

- **Tags**: `Jobs`
- **Request Headers**: `Content-Type: application/json`
- **Input Schema (`JobCreate`)**:
  | Field | Type | Required | Default | Description & Constraints |
  | :--- | :--- | :---: | :---: | :--- |
  | `title` | `string` | **Yes** | — | Title of the role (e.g., `"Senior Python Engineer"`). |
  | `raw_description` | `string` | **Yes** | — | Full textual job description and requirements. |
  | `required_skills` | `string[]` | No | `null` | Array of skill keywords (e.g., `["Python", "FastAPI", "PostgreSQL", "OpenAI"]`). |
  | `required_experience_years` | `integer` | No | `null` | Minimum required years of professional experience. |
  | `required_education` | `string` | No | `null` | Education requirement (e.g., `"Bachelor's in Computer Science"`). |
  | `created_by` | `integer` | No | `null` | Recruiter or internal user ID creating the requisition. |

- **Example Request Payload**:
  ```json
  {
    "title": "Senior AI Systems Engineer",
    "raw_description": "Seeking an experienced engineer proficient in async FastAPI services, PostgreSQL, and LLM integrations.",
    "required_skills": ["Python", "FastAPI", "Postgres", "AI"],
    "required_experience_years": 5,
    "required_education": "B.S. in Computer Science or equivalent"
  }
  ```

- **Response Status**: `201 Created`
- **Response Schema (`JobResponse`)**:
  ```json
  {
    "id": 1,
    "title": "Senior AI Systems Engineer",
    "raw_description": "Seeking an experienced engineer proficient in async FastAPI services, PostgreSQL, and LLM integrations.",
    "required_skills": ["Python", "FastAPI", "PostgreSQL", "Artificial Intelligence"],
    "required_experience_years": 5,
    "required_education": "B.S. in Computer Science or equivalent",
    "profile_text": "Job Title: Senior AI Systems Engineer\nRequired Skills: Python, FastAPI, PostgreSQL, Artificial Intelligence...",
    "pinecone_vector_id": "job_1",
    "status": "open",
    "created_at": "2026-07-02T11:00:00Z",
    "created_by": null
  }
  ```

---

#### `GET /jobs`
Retrieves a list of all job postings in the system. Can optionally filter by operational lifecycle status.

- **Tags**: `Jobs`
- **Query Parameters**:
  - `status_filter` (`string`, optional): Filter results by `JobStatus` enum (`"open"`, `"closed"`, or `"draft"`).
- **Response Status**: `200 OK`
- **Response Schema**: `JobResponse[]` (List of `JobResponse` objects).

---

#### `GET /jobs/{job_id}`
Retrieves complete details for a single job requisition by ID.

- **Tags**: `Jobs`
- **Path Parameters**:
  - `job_id` (`integer`, required): Unique ID of the job.
- **Response Status**:
  - `200 OK`: Returns the `JobResponse` object.
  - `404 Not Found`: If `job_id` does not exist in the database.

---

### 2.3 Candidate Upload & Pipeline Endpoints

#### `POST /jobs/{job_id}/candidates`
Uploads a candidate resume document (`.pdf` or `.docx`) and dispatches the asynchronous processing pipeline in the background. Saves the raw file to local storage (`data/resumes/job_<job_id>/<uuid>_<filename>`) and creates a database record in `uploaded` status.

- **Tags**: `Candidates & Matching`
- **Path Parameters**:
  - `job_id` (`integer`, required): Target job ID to attach the candidate application to.
- **Request Headers**: `Content-Type: multipart/form-data`
- **Form Data Parameters**:
  - `file` (`UploadFile` binary, required): The resume document (`.pdf` or `.docx`).
- **Response Status**: `202 Accepted`
- **Response Schema (`CandidateResponse`)**:
  ```json
  {
    "id": 101,
    "job_id": 1,
    "original_filename": "jane_doe_resume.pdf",
    "status": "uploaded",
    "status_detail": null,
    "sanitized_profile": null,
    "created_at": "2026-07-02T11:05:00Z"
  }
  ```

---

#### `POST /candidates/{candidate_id}/retry`
Re-triggers the asynchronous processing pipeline for a candidate whose previous processing step failed or stalled.

- **Tags**: `Candidates & Matching`
- **Path Parameters**:
  - `candidate_id` (`integer`, required): Unique ID of the candidate.
- **Precondition / Constraints**: Candidate must currently be in one of the following statuses: `parsing_failed`, `extraction_failed`, `sanitization_failed`, `embedding_failed`, `matching_failed`, or `uploaded`.
- **Response Status**:
  - `202 Accepted`: Pipeline re-queued successfully; returns updated `CandidateResponse`.
  - `400 Bad Request`: If candidate is in an un-retryable status (e.g., `ready_for_matching` or `parsing`).
  - `404 Not Found`: If candidate does not exist.

---

#### `GET /jobs/{job_id}/candidates`
Lists all candidates submitted for a specific job requisition.

- **Tags**: `Candidates & Matching`
- **Path Parameters**:
  - `job_id` (`integer`, required): Job ID.
- **Query Parameters**:
  - `status_filter` (`string`, optional): Filter candidates by `CandidateStatus` enum (e.g., `"ready_for_matching"`, `"uploaded"`, `"parsing_failed"`).
- **Response Status**: `200 OK`
- **Response Schema**: `CandidateResponse[]` (Array of candidate records).

---

### 2.4 Matching & Ranking Endpoints

#### `POST /jobs/{job_id}/match`
Executes the **Two-Stage Hybrid Evaluation Pipeline** across all candidates in `ready_for_matching` status for the specified job:
1. Performs Pinecone vector cosine similarity search against namespace `<job_id>` (Stage 1).
2. Executes OpenAI rubric evaluation (`run_stage2_scoring`) comparing the PII-redacted `sanitized_profile` against job requirements to calculate exact fit metrics (Stage 2). Also applies fallback scoring to any sanitized candidate not returned in top vector results.

- **Tags**: `Candidates & Matching`
- **Path Parameters**:
  - `job_id` (`integer`, required): Job ID to execute matching for.
- **Response Status**:
  - `200 OK`: Returns list of updated or newly generated score records.
  - `404 Not Found`: If job ID does not exist.
- **Response Schema (`ScoreResponse[]`)**:
  ```json
  [
    {
      "id": 501,
      "job_id": 1,
      "candidate_id": 101,
      "vector_similarity_score": 0.8842,
      "fit_percentage": 85,
      "matched_skills": ["Python", "FastAPI", "PostgreSQL"],
      "missing_skills": ["Artificial Intelligence"],
      "rationale": "Candidate possesses extensive experience in Python and FastAPI backend development with robust database design skills. Lacks explicit demonstration of AI/LLM deployment workflows.",
      "scored_at": "2026-07-02T11:10:00Z"
    }
  ]
  ```

---

#### `GET /jobs/{job_id}/rankings`
Retrieves the recruiter leaderboard of candidates applied to a job, ordered descending by Stage 2 `fit_percentage` followed by Stage 1 `vector_similarity_score`.

- **Tags**: `Candidates & Matching`
- **Path Parameters**:
  - `job_id` (`integer`, required): Job ID.
- **Response Status**: `200 OK`
- **Response Schema (`RankedCandidateResponse[]`)**:
  ```json
  [
    {
      "candidate_id": 101,
      "original_filename": "jane_doe_resume.pdf",
      "status": "ready_for_matching",
      "fit_percentage": 85,
      "vector_similarity_score": 0.8842,
      "matched_skills": ["Python", "FastAPI", "PostgreSQL"],
      "missing_skills": ["Artificial Intelligence"],
      "rationale": "Candidate possesses extensive experience in Python and FastAPI backend development..."
    }
  ]
  ```

---

### 2.5 Recruiter Review & Interview Tools

#### `GET /candidates/{candidate_id}`
Retrieves standard metadata and the PII-redacted `sanitized_profile` for a candidate.

- **Tags**: `Candidates & Matching`
- **Path Parameters**:
  - `candidate_id` (`integer`, required): Candidate ID.
- **Response Status**: `200 OK` (or `404 Not Found`).
- **Response Schema**: `CandidateResponse` object containing `sanitized_profile`.

---

#### `GET /candidates/{candidate_id}/resume`
**Recruiter-Only Protected Endpoint**: Retrieves the full unredacted candidate profile (`structured_profile` containing full name, email, phone, and address), cleaned parsed markdown (`parsed_markdown`), and exact raw Docling extraction output (`raw_markdown`).
> [!IMPORTANT]
> Accessing this endpoint triggers an automatic compliance audit record (`recruiter_viewed_raw_resume`) logged into PostgreSQL (`audit_log` table) along with recruiter access metadata.

- **Tags**: `Candidates & Matching`
- **Path Parameters**:
  - `candidate_id` (`integer`, required): Candidate ID.
- **Response Status**: `200 OK` (or `404 Not Found`).
- **Response Schema (`CandidateDetailResponse`)**:
  ```json
  {
    "id": 101,
    "job_id": 1,
    "original_filename": "jane_doe_resume.pdf",
    "status": "ready_for_matching",
    "status_detail": null,
    "created_at": "2026-07-02T11:05:00Z",
    "sanitized_profile": {
      "skills": ["Python", "FastAPI", "PostgreSQL"],
      "work_experience": [{ "company": "Acme Corp", "role": "Backend Engineer", "duration": "2021-2024", "responsibilities": ["Built async microservices."] }],
      "education": [{ "degree": "B.S.", "field": "Computer Science", "institution": "State University" }],
      "certifications": [],
      "projects": []
    },
    "structured_profile": {
      "full_name": "Jane Doe",
      "email": "jane.doe@example.com",
      "phone": "+1-555-0199",
      "address": "San Francisco, CA",
      "skills": ["Python", "FastAPI", "PostgreSQL"],
      "work_experience": [{ "company": "Acme Corp", "role": "Backend Engineer", "duration": "2021-2024", "responsibilities": ["Built async microservices."] }],
      "education": [{ "degree": "B.S.", "field": "Computer Science", "institution": "State University" }]
    },
    "parsed_markdown": "# Jane Doe\nBackend Engineer...\n## Work Experience...",
    "raw_markdown": "# Jane Doe\n..."
  }
  ```

---

#### `POST /candidates/{candidate_id}/interview-questions`
Automatically generates customized, skill-gap-focused interview questions using OpenAI LLM (`generate_interview_questions`). The LLM cross-references the candidate's `missing_skills` and sanitized profile against job requirements to craft targeted probing questions.

- **Tags**: `Candidates & Matching`
- **Path Parameters**:
  - `candidate_id` (`integer`, required): Candidate ID.
- **Preconditions**: Candidate must have completed PII redaction (`sanitized_profile` is not null).
- **Request Headers**: `Content-Type: application/json`
- **Input Schema (`InterviewQuestionGenerateRequest`)**:
  | Field | Type | Required | Default | Constraints | Description |
  | :--- | :--- | :---: | :---: | :---: | :--- |
  | `num_questions` | `integer` | No | `5` | `1 <= num <= 10` | Number of tailored questions to generate. |

- **Example Request Payload**:
  ```json
  {
    "num_questions": 3
  }
  ```

- **Response Status**:
  - `200 OK`: Questions generated and persisted to database.
  - `422 Unprocessable Entity`: If candidate sanitization has not completed yet.
- **Response Schema (`InterviewQuestionResponse[]`)**:
  ```json
  [
    {
      "id": 1,
      "candidate_id": 101,
      "job_id": 1,
      "question_text": "In your past Python projects at Acme Corp, how would you architect a high-throughput async data ingestion service that interfaces with OpenAI structured output models?",
      "target_skill_gap": "Artificial Intelligence",
      "generated_at": "2026-07-02T11:15:00Z"
    }
  ]
  ```

---

#### `POST /candidates/{candidate_id}/feedback`
Records recruiter interview notes and final hiring decisions (`hired`, `rejected`, `on_hold`). Automatically creates an immutable database audit log record (`recruiter_feedback_recorded`).

- **Tags**: `Candidates & Matching`
- **Path Parameters**:
  - `candidate_id` (`integer`, required): Candidate ID.
- **Request Headers**: `Content-Type: application/json`
- **Input Schema (`FeedbackCreate`)**:
  | Field | Type | Required | Default | Description |
  | :--- | :--- | :---: | :---: | :--- |
  | `recruiter_notes` | `string` | No | `null` | Qualitative notes or interview rubric feedback. |
  | `decision` | `string` | **Yes** | — | Enum `DecisionStatus`: `"hired"`, `"rejected"`, or `"on_hold"`. |
  | `recorded_by` | `integer` | No | `null` | ID of the recruiter recording the feedback. |

- **Example Request Payload**:
  ```json
  {
    "recruiter_notes": "Candidate excelled in backend system architecture discussions. Demonstrated strong aptitude to pick up AI workflows.",
    "decision": "hired",
    "recorded_by": 42
  }
  ```

- **Response Status**: `201 Created`
- **Response Schema (`FeedbackResponse`)**:
  ```json
  {
    "id": 10,
    "candidate_id": 101,
    "job_id": 1,
    "recruiter_notes": "Candidate excelled in backend system architecture discussions. Demonstrated strong aptitude to pick up AI workflows.",
    "decision": "hired",
    "recorded_at": "2026-07-02T11:20:00Z",
    "recorded_by": 42
  }
  ```

---

## 3. Detailed Data Input & Output Schemas

### `SanitizedProfile` (Safe for AI / Vector Search)
Stripped of all demographic details and identifying contact data.
```json
{
  "skills": ["string"],
  "work_experience": [
    {
      "company": "string",
      "role": "string",
      "duration": "string",
      "responsibilities": ["string"]
    }
  ],
  "education": [
    {
      "degree": "string",
      "field": "string",
      "institution": "string"
    }
  ],
  "certifications": ["string"],
  "projects": [
    {
      "name": "string",
      "description": "string"
    }
  ]
}
```

### `CandidateProfile` (Unredacted Recruiter View)
Contains full PII alongside job competencies.
```json
{
  "full_name": "string | null",
  "email": "string | null",
  "phone": "string | null",
  "gender": "string | null",
  "age_or_dob": "string | null",
  "marital_status": "string | null",
  "religion": "string | null",
  "address": "string | null",
  "skills": ["string"],
  "work_experience": ["WorkExperienceItem"],
  "education": ["EducationItem"],
  "certifications": ["string"],
  "projects": ["ProjectItem"]
}
```

---

## 4. Domain Model Enums & Status Lifecycle

| Enum Type | Allowed Values | Usage & Description |
| :--- | :--- | :--- |
| **`JobStatus`** | `"open"`, `"closed"`, `"draft"` | Governs whether a job posting accepts candidate uploads and matching. |
| **`CandidateStatus`** | `"uploaded"`, `"parsing"`, `"extracting"`, `"sanitizing"`, `"embedding"`, `"ready_for_matching"`, `"matching"`, `"completed"` | Normal async pipeline progress markers from resume file upload to ready status. |
| **`CandidateStatus` (Failures)** | `"parsing_failed"`, `"extraction_failed"`, `"sanitization_failed"`, `"embedding_failed"`, `"matching_failed"`, `"needs_manual_review"` | Failure markers indicating where document parsing or AI extraction stopped. Eligible for `/retry`. |
| **`DecisionStatus`** | `"hired"`, `"rejected"`, `"on_hold"` | Recruiter hiring verdicts recorded via `/feedback`. |

---

## 5. Service Modules Directory Architecture

The internal backend logic is modularized under `app/services/`:
- **`llm.py`**: Handles all OpenAI API integrations using strict structured output JSON schemas (`response_format: {"type": "json_schema", ...}`). Implements automatic retry-with-validation logic for resume extraction, PII redaction, rubric scoring, and interview question generation.
- **`parser.py`**: Integrates **Docling** to parse unstructured binary PDF and DOCX documents into clean, hierarchical Markdown.
- **`redaction.py`**: Executes the **Bias-Aware Redaction Firewall**, validating and ensuring candidate profiles contain zero demographic or personally identifying attributes before storage in `sanitized_profile`.
- **`scoring.py`**: Orchestrates Stage-2 LLM evaluation against job requirements to generate comprehensive candidate scorecards.
- **`skill_normalizer.py`**: Loads `app/data/skill_synonyms.json` to map industry acronyms and colloquial terms to canonical skills (e.g., `"py"` ➔ `"Python"`, `"ml"` ➔ `"Machine Learning"`).
- **`storage.py`**: Manages filesystem storage and directory structures for original resume uploads under `data/resumes/job_<id>/`.
- **`vector_store.py`**: Manages Pinecone vector database operations and OpenAI `text-embedding-3-small` vector generation across per-job namespaces (`str(job_id)`) and global namespaces (`"jobs"`).
- **`worker.py`**: Asynchronous background task consumer executing candidate pipeline transitions (`process_candidate_task`) and recording audit logs (`record_audit_log`).

---

## 6. Local Setup, Configuration & Utilities

### Environment Variables (`.env`)
Copy `.env.example` to `.env` inside `Backend/` and configure:
```ini
DATABASE_URL=sqlite+aiosqlite:///./recruitment_platform.db
# Or PostgreSQL: postgresql+asyncpg://user:password@localhost:5432/recruitment_db

OPENAI_API_KEY=sk-...
PINECONE_API_KEY=pcsk_...
PINECONE_INDEX_NAME=recruitment-index
```

### Running the API Server Locally
From within the `Backend/` directory:
```bash
# 1. Activate Python virtual environment
venv\Scripts\activate

# 2. Run Uvicorn dev server with hot reload
uvicorn app.main:app --reload --port 8000
```
Interactive API documentation (Swagger UI) is available at: `http://127.0.0.1:8000/docs`

### Running Automated Tests
```bash
pytest tests/ -v
```

### Database Wipe & Reset Utility
To completely purge all application tables (`audit_log`, `feedback`, `interview_questions`, `scores`, `candidates`, `jobs`) and vacuum database storage during testing or development:
```bash
python Backend/clear_db.py
# Or inside Backend/: python clear_db.py
```

