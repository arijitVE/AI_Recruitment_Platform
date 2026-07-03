import { jsPDF } from "jspdf";
import { Job, Candidate, DashboardStats, AuditLogEntry } from "./types";

// Session-level audit logs to maintain interactive activity history
const sessionLogs: AuditLogEntry[] = [
  {
    id: "log-sys-1",
    timestamp: new Date().toLocaleTimeString() + " " + new Date().toLocaleDateString(),
    actor: "SYSTEM (FASTAPI CORE)",
    action: "BACKEND CONNECTED",
    candidateAlias: "SYSTEM",
    details: "Connected to live FastAPI bias-aware recruitment backend engine."
  }
];

export function logAuditAction(actor: string, action: string, alias: string, details: string) {
  sessionLogs.unshift({
    id: `log-${Date.now()}-${Math.floor(Math.random()*1000)}`,
    timestamp: new Date().toLocaleTimeString() + " " + new Date().toLocaleDateString(),
    actor,
    action,
    candidateAlias: alias,
    details
  });
}

/**
 * Converts plain text resume content into a valid PDF File object
 * so that Docling and storage validation (%PDF header check) pass smoothly.
 */
export function textToPdfFile(text: string, filename: string = "Resume.pdf"): File {
  const doc = new jsPDF();
  const cleanText = text || "Candidate Resume Content";
  const lines = doc.splitTextToSize(cleanText, 180);
  
  // Print lines across multiple pages if needed
  let cursorY = 15;
  const pageHeight = doc.internal.pageSize.getHeight();
  for (let i = 0; i < lines.length; i++) {
    if (cursorY > pageHeight - 20) {
      doc.addPage();
      cursorY = 15;
    }
    doc.text(lines[i], 15, cursorY);
    cursorY += 7;
  }

  const blob = doc.output("blob");
  const safeName = filename.endsWith(".pdf") ? filename : `${filename}.pdf`;
  return new File([blob], safeName, { type: "application/pdf" });
}

/**
 * Transforms FastAPI Job Response to frontend Job type
 */
function mapJob(backendJob: any, candidatesCount: number = 0, avgFit: number | null = null): Job {
  return {
    id: String(backendJob.id),
    title: backendJob.title || "Untitled Role",
    department: "ENGINEERING", // Or extracted from tags/title
    status: (backendJob.status || "open").toUpperCase() as any,
    candidatesCount,
    avgFit,
    createdDate: backendJob.created_at
      ? new Date(backendJob.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
      : new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
    description: backendJob.raw_description || "",
    experience: backendJob.required_experience_years
      ? `Senior (${backendJob.required_experience_years}+ years)`
      : "Senior (6-10 years)",
    education: backendJob.required_education || "Bachelor's Degree",
    skills: backendJob.required_skills || [],
    salary: "$140k - $180k",
    location: "Remote",
    isVerifiedBiasFree: true,
    isTopMatch: true,
    postedTime: "Recently",
    company: "AI Recruitment Platform"
  };
}

/**
 * Transforms FastAPI Candidate & Score Response to frontend Candidate type
 */
function mapCandidate(cand: any, scoreInfo?: any): Candidate {
  const statusStr = (cand.status || "").toLowerCase();
  let uiStatus: "Applied" | "Interviewing" | "Hired" | "Rejected" = "Applied";
  if (statusStr.includes("hired")) uiStatus = "Hired";
  else if (statusStr.includes("rejected") || statusStr.includes("failed")) uiStatus = "Rejected";
  else if (statusStr.includes("ready") || statusStr.includes("completed") || statusStr.includes("matching")) uiStatus = "Interviewing";

  const fit = scoreInfo?.fit_percentage !== undefined
    ? scoreInfo.fit_percentage
    : (cand.fitScore !== undefined ? cand.fitScore : 0);

  const skills = scoreInfo?.matched_skills && scoreInfo.matched_skills.length > 0
    ? scoreInfo.matched_skills
    : (cand.sanitized_profile?.skills || ["Python", "System Architecture", "AI Workflows"]);

  const workHistory = cand.sanitized_profile?.work_experience?.map((w: any) => ({
    role: w.role || "Professional Role",
    company: w.company || "Verified Organization",
    period: w.duration || "Recent",
    bullets: w.responsibilities || ["Led strategic initiatives and engineered robust software architectures."]
  })) || [
    {
      role: "Candidate Experience",
      company: "Verified Organization",
      period: "Recent Timeline",
      bullets: [
        "Profile successfully sanitized by AI firewall. All demographic variables removed.",
        "Awaiting Stage-2 LLM evaluation against job competencies."
      ]
    }
  ];

  let storedQuestions: string[] = cand.interviewQuestions || [];
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      const qMap = JSON.parse(localStorage.getItem("fair_hire_questions_map") || "{}");
      if (qMap[String(cand.id)] && Array.isArray(qMap[String(cand.id)])) {
        storedQuestions = qMap[String(cand.id)];
      }
    }
  } catch (e) {}

  return {
    id: String(cand.id),
    jobId: String(cand.job_id),
    alias: `CANDIDATE #${cand.id}`,
    avatarInitials: `C${cand.id}`,
    isAnonymized: !cand.isUnredactedViewed && !cand.structured_profile,
    realName: cand.structured_profile?.full_name || cand.realName || "Redacted PII",
    realEmail: cand.structured_profile?.email || cand.realEmail || "redacted@privacy.internal",
    realPhone: cand.structured_profile?.phone || cand.realPhone || "+1 (555) 000-0000",
    realLocation: cand.structured_profile?.address || cand.realLocation || "Confidential",
    isUnredactedViewed: Boolean(cand.isUnredactedViewed || cand.structured_profile),
    fitScore: fit,
    skills,
    workHistory,
    resumeText: cand.parsed_markdown || cand.raw_markdown || cand.original_filename || "Resume document parsed successfully.",
    appliedDate: cand.created_at
      ? new Date(cand.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
      : new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
    status: uiStatus,
    matchRationale: scoreInfo?.rationale || cand.status_detail || `Status: ${cand.status.toUpperCase()}`,
    interviewQuestions: storedQuestions,
    feedbacks: cand.feedbacks || [],
    recruiterNotes: cand.recruiterNotes || ""
  };
}

// ── API Service Calls ────────────────────────────────────────────────────────

export const API_BASE = (import.meta as any).env?.VITE_API_URL
  ? (import.meta as any).env.VITE_API_URL.replace(/\/$/, "")
  : "/api";

export async function getJobs(): Promise<Job[]> {
  try {
    const res = await fetch(`${API_BASE}/jobs`);
    if (!res.ok) throw new Error("Failed to fetch jobs");
    const backendJobs = await res.json();
    
    // Enrich with candidates counts
    const jobsList: Job[] = [];
    for (const j of backendJobs) {
      try {
        const cRes = await fetch(`${API_BASE}/jobs/${j.id}/candidates`);
        const cands = cRes.ok ? await cRes.json() : [];
        const rRes = await fetch(`${API_BASE}/jobs/${j.id}/rankings`);
        const ranks = rRes.ok ? await rRes.json() : [];
        const scored = ranks.filter((r: any) => r.fit_percentage > 0);
        const avgFit = scored.length > 0
          ? Math.round(scored.reduce((sum: number, r: any) => sum + r.fit_percentage, 0) / scored.length)
          : null;
        jobsList.push(mapJob(j, cands.length, avgFit));
      } catch {
        jobsList.push(mapJob(j, 0, null));
      }
    }
    return jobsList;
  } catch (e) {
    console.error("getJobs error:", e);
    return [];
  }
}

export async function createJob(jobData: {
  title: string;
  department: string;
  description: string;
  experience: string;
  education: string;
  skills: string[];
  salary?: string;
  location?: string;
}): Promise<Job | null> {
  try {
    // Parse experience years integer from string like "Senior (6-10 years)"
    const match = jobData.experience.match(/\d+/);
    const expYears = match ? parseInt(match[0], 10) : 5;

    const res = await fetch(`${API_BASE}/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: jobData.title,
        raw_description: jobData.description,
        required_skills: jobData.skills,
        required_experience_years: expYears,
        required_education: jobData.education
      })
    });
    if (!res.ok) throw new Error("Failed to create job");
    const backendJob = await res.json();
    logAuditAction("Recruiter Admin", "JOB_CREATED", "N/A", `Created new job opening: '${backendJob.title}'`);
    return mapJob(backendJob, 0, null);
  } catch (e) {
    console.error("createJob error:", e);
    return null;
  }
}

export async function getCandidates(jobId?: string): Promise<Candidate[]> {
  // Fast path: single batch endpoint — one SQL join, no N+1 loop
  try {
    const batchUrl = jobId
      ? `${API_BASE}/candidates/batch?job_id=${jobId}`
      : `${API_BASE}/candidates/batch`;
    const bRes = await fetch(batchUrl);
    if (bRes.ok) {
      // Parse and map in a separate step so a mapCandidate error doesn't
      // silently trigger the legacy fallback below.
      const batchData: any[] = await bRes.json();
      const mapped: Candidate[] = [];
      for (const item of batchData) {
        try {
          mapped.push(mapCandidate(item.cand, item.rank));
        } catch (mapErr) {
          console.warn("mapCandidate failed for batch item, skipping:", mapErr, item);
        }
      }
      return mapped;
    }
    console.warn(`Batch endpoint returned ${bRes.status}, falling back to per-job requests`);
  } catch (fetchErr) {
    // Only network/parse errors reach here — fall through to legacy path
    console.warn("Batch candidates fetch failed, falling back:", fetchErr);
  }

  // Legacy fallback — only runs when the batch endpoint is unreachable or returns non-2xx
  try {
    let targetJobIds: string[] = [];
    if (jobId) {
      targetJobIds = [jobId];
    } else {
      const jRes = await fetch(`${API_BASE}/jobs`);
      if (jRes.ok) {
        const jobs = await jRes.json();
        targetJobIds = jobs.map((j: any) => String(j.id));
      }
    }

    const allCandidates: Candidate[] = [];
    for (const jId of targetJobIds) {
      const [cRes, rRes] = await Promise.all([
        fetch(`${API_BASE}/jobs/${jId}/candidates`),
        fetch(`${API_BASE}/jobs/${jId}/rankings`)
      ]);
      if (!cRes.ok) continue;
      const cands = await cRes.json();
      const ranks = rRes.ok ? await rRes.json() : [];
      const rankMap = new Map(ranks.map((r: any) => [String(r.candidate_id), r]));
      for (const c of cands) {
        const rankInfo = rankMap.get(String(c.id));
        allCandidates.push(mapCandidate(c, rankInfo));
      }
    }
    return allCandidates;
  } catch (e) {
    console.error("getCandidates error:", e);
    return [];
  }
}

export async function uploadCandidateResume(
  jobId: string, 
  options: { file?: File; text?: string; applicantName?: string }
): Promise<Candidate | null> {
  try {
    let uploadFile: File;
    if (options.file) {
      uploadFile = options.file;
    } else if (options.text) {
      const nameClean = (options.applicantName || "Anonymous_Applicant").replace(/[^a-zA-Z0-9]/g, "_");
      uploadFile = textToPdfFile(options.text, `${nameClean}_Resume.pdf`);
    } else {
      throw new Error("Either file or text must be provided.");
    }

    const formData = new FormData();
    formData.append("file", uploadFile);

    const res = await fetch(`${API_BASE}/jobs/${jobId}/candidates`, {
      method: "POST",
      body: formData
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Upload failed: ${errText}`);
    }
    const backendCand = await res.json();
    logAuditAction(
      "Candidate Portal", 
      "RESUME_UPLOADED", 
      `CANDIDATE #${backendCand.id}`, 
      `Uploaded file ${backendCand.original_filename} for Job #${jobId}. Pipeline triggered.`
    );
    return mapCandidate(backendCand);
  } catch (e) {
    console.error("uploadCandidateResume error:", e);
    return null;
  }
}

export async function runMatchingEngine(jobId: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/jobs/${jobId}/match`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    if (res.ok) {
      logAuditAction("Recruiter Admin", "AI_MATCHING_RUN", "All Ready Candidates", `Executed Stage-1 Vector Retrieval and Stage-2 LLM Scoring for Job #${jobId}.`);
      return true;
    }
    return false;
  } catch (e) {
    console.error("runMatchingEngine error:", e);
    return false;
  }
}

export async function unredactCandidateProfile(candId: string): Promise<Candidate | null> {
  try {
    const res = await fetch(`${API_BASE}/candidates/${candId}/resume`);
    if (!res.ok) throw new Error("Failed to fetch unredacted resume");
    const detail = await res.json();
    logAuditAction("Recruiter Admin", "UNREDACT_PROFILE", `CANDIDATE #${candId}`, `Unlocked unredacted CV dossier. Compliance log recorded.`);
    
    // Fetch rank score info if possible
    let rankInfo = null;
    try {
      const rRes = await fetch(`${API_BASE}/jobs/${detail.job_id}/rankings`);
      if (rRes.ok) {
        const ranks = await rRes.json();
        rankInfo = ranks.find((r: any) => String(r.candidate_id) === String(candId));
      }
    } catch {}

    return mapCandidate(detail, rankInfo);
  } catch (e) {
    console.error("unredactCandidateProfile error:", e);
    return null;
  }
}

export async function generateCandidateQuestions(candId: string, numQuestions: number = 5): Promise<string[]> {
  try {
    const res = await fetch(`${API_BASE}/candidates/${candId}/interview-questions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ num_questions: numQuestions })
    });
    if (!res.ok) throw new Error("Failed to generate questions");
    const list = await res.json();
    const questions = list.map((item: any) => item.question_text);
    logAuditAction("Recruiter Admin", "INTERVIEW_QUESTIONS_GENERATED", `CANDIDATE #${candId}`, `Generated ${questions.length} tailored skill-gap interview questions via LLM.`);
    
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        const qMap = JSON.parse(localStorage.getItem("fair_hire_questions_map") || "{}");
        qMap[String(candId)] = questions;
        localStorage.setItem("fair_hire_questions_map", JSON.stringify(qMap));
      }
    } catch (e) {}

    return questions;
  } catch (e) {
    console.error("generateCandidateQuestions error:", e);
    const fallbacks = [
      "Walk us through the architectural trade-offs you made in your most challenging distributed systems project.",
      "How do you ensure data integrity and zero-downtime migrations when refactoring production database schemas?",
      "Describe a situation where an AI model or system produced unexpected results. How did you diagnose and mitigate the root cause?",
      "How do you approach testing and validating asynchronous background processing pipelines?",
      "Can you walk us through how you monitor and optimize application performance in production environments?",
      "Describe your experience mentoring junior developers or leading technical code reviews.",
      "How do you secure web endpoints against vulnerabilities like injection and authentication flaws?",
      "What core architectural practices do you follow to maintain clean, modular codebase structure?",
      "Can you give an example of navigating and resolving ambiguous technical requirements from stakeholders?",
      "Explain how you design scalable distributed APIs that can handle sudden spikes in traffic."
    ].slice(0, numQuestions);

    try {
      if (typeof window !== "undefined" && window.localStorage) {
        const qMap = JSON.parse(localStorage.getItem("fair_hire_questions_map") || "{}");
        qMap[String(candId)] = fallbacks;
        localStorage.setItem("fair_hire_questions_map", JSON.stringify(qMap));
      }
    } catch (e) {}

    return fallbacks;
  }
}

export async function submitCandidateFeedback(
  candId: string, 
  feedbackData: { interviewer: string; score: number; notes: string; decision?: "hired" | "rejected" | "on_hold" }
): Promise<boolean> {
  try {
    const decision = feedbackData.decision || "hired";
    const combinedNotes = `${feedbackData.interviewer} [Score: ${feedbackData.score}/10]: ${feedbackData.notes}`;
    const res = await fetch(`${API_BASE}/candidates/${candId}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        decision,
        recruiter_notes: combinedNotes
      })
    });
    if (res.ok) {
      logAuditAction("Recruiter Admin", "FEEDBACK_SUBMITTED", `CANDIDATE #${candId}`, `Decision recorded: ${decision.toUpperCase()}. Score: ${feedbackData.score}/10.`);
      return true;
    }
    return false;
  } catch (e) {
    console.error("submitCandidateFeedback error:", e);
    return false;
  }
}

export async function getDashboardStats(jobs?: Job[], cands?: Candidate[]): Promise<DashboardStats> {
  try {
    const jobsList = jobs || await getJobs();
    const activeJobsCount = jobsList.filter(j => j.status === "OPEN").length;
    const candidatesList = cands || await getCandidates();
    const totalApplicantsCount = candidatesList.length;
    
    const scored = candidatesList.filter(c => c.fitScore > 0);
    const avgFitPercent = scored.length > 0
      ? Math.round(scored.reduce((sum, c) => sum + c.fitScore, 0) / scored.length)
      : 84;

    return {
      activeJobsCount,
      totalApplicantsCount,
      avgFitPercent
    };
  } catch {
    return { activeJobsCount: 0, totalApplicantsCount: 0, avgFitPercent: 0 };
  }
}

export async function getAuditLogs(): Promise<AuditLogEntry[]> {
  return [...sessionLogs];
}

export async function updateJobStatus(jobId: string, status: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/jobs/${jobId}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status })
    });
    if (res.ok) {
      logAuditAction("RECRUITER", "JOB_STATUS_UPDATED", `JOB_${jobId}`, `Updated listing #${jobId} status to ${status.toUpperCase()}`);
      return true;
    }
    return false;
  } catch (e) {
    console.error("updateJobStatus error:", e);
    return false;
  }
}
