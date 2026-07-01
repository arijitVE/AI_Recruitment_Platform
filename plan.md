# plan.md — AI Recruitment Platform Implementation Plan

This file is the implementation guide for the coding agent building this project.
It describes **what to build and why**, not literal code. Follow the phases in
order — later phases depend on data structures and decisions made in earlier ones.

---

## 1. Project overview

An AI-assisted recruitment platform for HR teams. Recruiters post jobs; candidates
upload resumes; the system extracts structured data from both, matches and ranks
candidates against jobs, and generates targeted interview questions for shortlisted
candidates. A core design constraint is **bias-aware evaluation**: no AI matching or
scoring step may see candidate-identifying information that is not job-relevant.

Core workflow (must all function end-to-end for MVP acceptance):
1. Recruiter creates a job posting → structured requirements extracted.
2. Candidate uploads a resume → structured profile extracted.
3. A sanitized version of the candidate profile is derived for AI use.
4. Sanitized profile and job requirements are embedded and matched via vector search.
5. Shortlisted candidates get a second-pass LLM scoring for fit %, gap analysis.
6. Recruiter views ranked list with fit %, matched skills, missing skills.
7. Recruiter requests interview questions for shortlisted candidates (auto-generated
   from that candidate's specific skill gaps).
8. Recruiter records interview feedback and a hiring decision, tied to the candidate
   and job.

---

## 2. Tech stack (decided)

- **Backend**: Python, FastAPI
- **Database**: PostgreSQL (source of truth — full unredacted candidate records,
  jobs, scores, feedback)
- **Vector store**: Pinecone (free tier) — sanitized embeddings only, never raw text
- **Embeddings**: OpenAI embeddings API
- **LLM (extraction, scoring, question generation)**: OpenAI API (single
  provider for both embeddings and completions — simplifies key management,
  billing, and rate-limit handling to one vendor)
- **Document parsing**: Docling (PDF/DOCX → Markdown)
- **Background processing**: async task queue (e.g. Celery+Redis) — see
  Section 4
- **Frontend**: not yet specified — build backend + API first, treat frontend as a
  separate phase once endpoints are stable

Environment variables needed (define in `.env`, never commit):
`DATABASE_URL`, `OPENAI_API_KEY`, `PINECONE_API_KEY`,
`PINECONE_ENVIRONMENT`, `PINECONE_INDEX_NAME`, `REDIS_URL` (if using Celery/Arq).

**Note on model choice and structured output**: extraction and scoring both
require the LLM to return valid, schema-conforming JSON every time — this
pipeline cannot tolerate occasional malformed output. Use OpenAI's structured
outputs mode (`response_format: {"type": "json_schema", "json_schema": {...,
"strict": true}}`) for the extraction and scoring calls so the response is
guaranteed to match the expected schema. The coding agent should:
1. Confirm at implementation time which current OpenAI models support strict
   structured outputs (this changes over time, don't hardcode from memory —
   check OpenAI's docs).
2. Use a cheaper/faster model for structured extraction and question
   generation, and reserve a stronger model for the scoring pass if cost
   matters, since scoring quality directly affects ranking fairness.
3. Build a retry-with-validation wrapper around every LLM JSON call regardless
   of strict mode (parse, validate against the expected schema, retry once on
   failure) as a safety net.

---

## 3. The bias-aware redaction boundary — critical, read carefully

This is the feature that differentiates this platform and must be implemented
exactly as specified, not approximated.

**Rule**: The *only* representations of a candidate that may reach an embedding
model or a scoring/ranking LLM call are ones that have passed through the
redaction step below. The raw parsed resume and the full structured JSON
(which includes name) are stored in Postgres for recruiter viewing only, and
must never be passed to an embedding or scoring call.

**Fields to strip before embedding or scoring**:
- Full name
- Photo / headshot (if present in parsed content, discard — never pass image data
  to embedding or scoring calls)
- Gender / gender-indicating pronouns
- Age or date of birth
- Marital status
- Religion
- Full home address (city/region-level location may be retained if the job has a
  location requirement — flag this as a config decision, default to stripping
  street-level detail only)

**Fields to retain (job-relevant, keep for match quality)**:
- Skills
- Work experience (company name, role, duration, responsibilities)
- Education (degree, field, institution)
- Certifications
- Projects

**Implementation pattern**:
1. `extract_structured_profile(resume_markdown) -> CandidateProfile` — full
   extraction, includes name. Store as-is in Postgres.
2. `sanitize_profile(profile: CandidateProfile) -> SanitizedProfile` — pure
   function, strips the fields listed above, returns a new object. No LLM
   call needed for this step — it's field-level filtering on already-structured
   JSON, not text redaction. Deterministic and testable.
3. `build_profile_text(sanitized: SanitizedProfile) -> str` — renders the
   sanitized profile into a clean text block (see Section 6) for embedding.
4. `generate_embedding(text: str) -> vector` — called only on the output of
   step 3, never on raw resume text or on step 1's output.
5. Any LLM scoring/comparison call (Section 7) receives `SanitizedProfile` and
   `JobRequirements` only — never the raw resume, never the full profile with name.

**Enforcement note for the agent**: implement `sanitize_profile` as the *only*
path into embedding generation and scoring. Do not create a second code path
that passes the full profile to these functions "for convenience" — this is
the exact failure mode that defeats the whole feature. Add a unit test that
asserts the sanitized object has no `name`/`gender`/`dob`/`marital_status`/
`religion`/`address` keys before it's allowed to reach `generate_embedding`
or the scoring prompt.

---

## 4. Async processing and the candidate state machine

Resume processing (parse → extract → sanitize → embed → upsert to Pinecone) can
take 10–30 seconds. The upload endpoint must not block on this. Pattern:

1. `POST /jobs/{id}/candidates` saves the uploaded file, creates a `candidates`
   row with `status = uploaded`, and returns immediately (202-style response
   with the candidate id).
2. A background worker picks up the job and moves the candidate through the
   pipeline, updating `status` at each transition.
3. Recruiters poll `GET /jobs/{id}/candidates` (or a per-candidate status
   endpoint) to see current status — no long-lived connections required for
   the MVP.

**Status values** (store as an enum or constrained text column on `candidates`):
- `uploaded` — file stored, not yet processed
- `parsing` — Docling running
- `extracting` — LLM structured extraction running
- `sanitizing` — redaction step running (fast, but still a discrete state for
  observability)
- `embedding` — sanitized profile being embedded and upserted to Pinecone
- `ready_for_matching` — candidate fully processed, eligible for stage-1/2
  matching
- `matching` — currently being scored against a job (transient, during Section 7)
- `completed` — has a score and is visible in rankings
- `parsing_failed` / `extraction_failed` / `embedding_failed` — terminal failure
  states, each distinct so failures are diagnosable at a glance rather than a
  single generic "failed" bucket
- `needs_manual_review` — parsing succeeded but confidence is low (e.g. key
  sections empty) or the file type isn't supported (scanned image without OCR)

Each state transition should be a single, small, retryable unit of work — if
`embedding` fails, you should be able to retry just that step using the
already-stored `sanitized_profile`, not re-run parsing and extraction from
scratch.

**Do not re-invoke the LLM to regenerate profile text or embeddings.**
`build_profile_text` (Section 6) runs once against the stored
`sanitized_profile` (a pure function, no LLM call), and `generate_embedding`
runs once against that output. If an embedding needs to be regenerated later
(e.g. after a bug fix to the normalization dictionary), regenerate the profile
text and re-embed — never re-run structured extraction again for that purpose.

---

## 5. Data model (PostgreSQL)

Describe tables at the field level; the agent should translate this into actual
migrations (e.g. Alembic) during implementation.

**`jobs`**
- id (PK)
- title
- raw_description (text, as entered by recruiter)
- required_skills (JSON array of strings, normalized — see Section 8)
- required_experience_years (int, nullable)
- required_education (text, nullable — degree/field)
- created_at, created_by (recruiter id, if auth is in scope for MVP)
- status (open / closed / draft)

**`job_requirements_text`** (optional — or a column on `jobs`)
- job_id (FK)
- profile_text (the rendered text used to generate the job embedding — store it
  for auditability, so you can see exactly what was embedded)

**`candidates`**
- id (PK)
- job_id (FK) — resumes are submitted against a specific job posting
- original_filename
- raw_file_storage_path (secure storage location for the original PDF/DOCX)
- parsed_markdown (Docling output, stored for debugging/reprocessing)
- structured_profile (JSON — full extraction, includes name; recruiter-facing only)
- sanitized_profile (JSON — output of `sanitize_profile`; used to build embedding
  text; store this too, for audit trail of exactly what reached the AI)
- profile_text (the exact rendered text that was embedded — store for audit)
- pinecone_vector_id (reference to the vector in Pinecone, not the vector itself)
- created_at
- status — see Section 4, the processing state machine, for the full set of
  values and transition rules
- status_detail (nullable text — error message or reason, populated on failure)

**`scores`**
- id (PK)
- job_id (FK)
- candidate_id (FK)
- vector_similarity_score (float, from Pinecone stage-1 retrieval)
- fit_percentage (int, from stage-2 LLM scoring pass)
- matched_skills (JSON array)
- missing_skills (JSON array)
- rationale (text, short LLM-generated explanation)
- scored_at

**`interview_questions`**
- id (PK)
- candidate_id (FK)
- job_id (FK)
- question_text
- target_skill_gap (nullable — which missing skill this question probes, if any)
- generated_at

**`feedback`**
- id (PK)
- candidate_id (FK)
- job_id (FK)
- recruiter_notes (text)
- decision (hired / rejected / on_hold)
- recorded_at
- recorded_by

**`audit_log`** (recommended, for the bias-compliance story)
- id (PK)
- candidate_id (FK)
- event (e.g. "embedding_generated", "score_computed", "recruiter_viewed_raw_resume")
- payload_snapshot (JSON — what data was actually used at that step)
- timestamp

---

## 6. Pinecone design

- One index for the MVP (free tier constraint — confirm current index/vector
  limits on the Pinecone dashboard before assuming capacity).
- Use **namespaces per job** (`namespace = job_id`) so candidate vectors for
  different jobs don't pollute each other's similarity search, and so an index
  reset for one job doesn't affect others.
- Store minimal metadata alongside each vector: `candidate_id`, `job_id`. Do not
  store any of the redacted fields in Pinecone metadata — metadata is still
  "reachable" by the matching system and defeats the redaction if misused.
- Job requirement vectors can either live in the same index in a `jobs`
  namespace, or just be held in memory/Postgres and queried against directly —
  since there's usually one active vector per job, Pinecone isn't strictly
  necessary for the job side. Simplest: store job vector in Postgres as a
  float array column or a small separate table; only candidate vectors need
  Pinecone's approximate search at scale.

---

## 7. Profile text construction (for embeddings)

Build a deterministic renderer, not an LLM call, so output is stable and
reviewable. Given a `SanitizedProfile` or `JobRequirements` object, render:

```
Skills:
<comma or newline separated skill list, normalized>

Experience:
<for each role: duration, title, company, key responsibilities>

Education:
<degree, field, institution>

Certifications:
<list>

Projects:
<list with 1-line descriptions>
```

Keep this renderer as one well-tested function per entity type (candidate vs
job), since embedding quality is sensitive to formatting consistency between
the two sides being compared.

---

## 8. Matching and scoring pipeline

**Stage 1 — vector retrieval (cheap, coarse)**
- Query Pinecone with the job's embedding, namespace = job_id.
- Retrieve top-N candidates by cosine similarity (N configurable, start with 20–30
  for a typical job posting volume).
- This produces `vector_similarity_score` per candidate — store it, but do not
  present it to recruiters as the final ranking; it's an input to stage 2.

**Stage 2 — LLM comparison pass (precise, explainable)**
- For each of the top-N candidates from stage 1, send the LLM:
  - `JobRequirements` (structured)
  - `SanitizedProfile` (structured — never the raw profile)
- Prompt the LLM to return structured output (JSON) containing:
  - `fit_percentage` (0-100)
  - `matched_skills` (list)
  - `missing_skills` (list — required skills not found in candidate profile)
  - `rationale` (2-3 sentence explanation, grounded only in the fields provided)
- Constrain the prompt explicitly: score only on skills, experience duration,
  and education relevance to the stated job requirements. Do not ask the model
  "is this a good candidate" in open-ended form — give it the rubric.
- Store all of this in the `scores` table.

**Ranking**: sort candidates by `fit_percentage` (from stage 2), using
`vector_similarity_score` only as a tiebreaker or as the initial shortlist
filter, not as the primary displayed ranking signal — stage 2's score is more
interpretable and auditable for recruiters.

---

## 9. Skill normalization

Before storing `required_skills` (job side) and `skills` (candidate side), and
before rendering profile text, normalize common synonyms so semantic matches
aren't missed and gap analysis isn't polluted by false negatives (e.g. "JS" vs
"JavaScript", "K8s" vs "Kubernetes", "Postgres" vs "PostgreSQL").

Implementation approach: maintain a small synonym dictionary (JSON file,
`skill_synonyms.json`) mapping variants to a canonical form. Apply it as a
lookup during structured extraction, not as a separate LLM call — keep it fast
and deterministic. Expand the dictionary over time; don't try to solve this
with an LLM call per skill for the MVP, it's unnecessary latency and cost.

---

## 10. Interview question generation

- Runs only for candidates a recruiter has explicitly shortlisted (don't
  auto-generate for every candidate — costs and is premature).
- Input to the LLM call: `JobRequirements`, `SanitizedProfile`, and that
  candidate's `missing_skills` from the `scores` table.
- Ask for a mix of:
  - Questions probing the top 2-3 missing skills (to assess how big the gap
    really is in practice, not just on paper)
  - Questions confirming depth on the candidate's strongest matched skills
  - One or two role-general behavioral questions
- Store each generated question with `target_skill_gap` populated where
  applicable, so recruiters can see *why* a question was asked.

---

## 11. API contract (draft — refine during implementation)

- `POST /jobs` — create job, triggers requirement extraction + embedding
- `GET /jobs/{id}` — job detail
- `POST /jobs/{id}/candidates` — upload resume for a job, triggers the full
  candidate pipeline (parse → extract → sanitize → embed → store)
- `GET /jobs/{id}/candidates` — list candidates with parsing status
- `POST /jobs/{id}/match` — run stage-1 + stage-2 matching for all candidates
  on this job (or trigger automatically after each new resume upload —
  decide based on expected resume volume per job)
- `GET /jobs/{id}/rankings` — ranked candidate list with fit %, matched/missing
  skills
- `POST /candidates/{id}/interview-questions` — generate questions for a
  shortlisted candidate
- `POST /candidates/{id}/feedback` — record recruiter notes + decision
- `GET /candidates/{id}/resume` — recruiter-only endpoint to view the original
  unredacted resume (log this access in `audit_log`)

---

## 12. Failure modes and edge cases to handle explicitly

- **Parsing failure** (corrupted file, scanned image with no OCR support in
  MVP scope): mark `parsing_status = needs_manual_review`, surface it in the
  dashboard rather than silently dropping the candidate or guessing at fields.
- **Missing required fields** (e.g. no education section found): store what
  was extracted, mark missing fields as `null`, don't fabricate values.
- **Candidate with no matched skills at all**: still store a score record with
  `fit_percentage` near 0 and `missing_skills` = all required skills, so they
  still appear in the dashboard (excluded candidates should be visible and
  explainable, not silently disappeared).
- **Job with no candidates yet**: matching endpoint should return an empty
  result gracefully, not error.
- **Recruiter views raw resume before scores are generated**: allowed, but
  logged — this is a bias-awareness consideration (the recruiter's own read
  is not tainted by the AI's, but the platform should be able to show the
  order of operations if ever questioned).

---

## 13. Build phases (recommended order)

**Phase 1 — foundation**
- Postgres schema + migrations for all tables in Section 4
- FastAPI project skeleton, config/env loading
- Job CRUD endpoints (no AI yet)

**Phase 2 — candidate ingestion**
- File upload + storage
- Docling integration (PDF/DOCX → Markdown)
- LLM structured extraction (`extract_structured_profile`)
- `sanitize_profile` with unit tests enforcing field removal (Section 3)
- Store both structured and sanitized profiles in Postgres

**Phase 3 — embeddings and matching**
- Skill normalization dictionary + application during extraction
- `build_profile_text` for both jobs and candidates
- OpenAI embedding generation
- Pinecone index setup, namespace-per-job upsert/query
- Stage-1 vector retrieval endpoint

**Phase 4 — scoring**
- Stage-2 LLM scoring pass with structured JSON output
- `scores` table population
- Ranking endpoint

**Phase 5 — interview questions and feedback**
- Interview question generation endpoint
- Feedback recording endpoint
- Audit log writes on key events (embedding generated, score computed, raw
  resume viewed)

**Phase 6 — dashboard/API polish**
- Endpoints needed specifically for a frontend to consume (pagination,
  filtering by status, etc.) — build once frontend requirements are clearer

Each phase should be independently testable before moving to the next —
particularly Phase 2's redaction logic, since every later phase depends on it
being correct.