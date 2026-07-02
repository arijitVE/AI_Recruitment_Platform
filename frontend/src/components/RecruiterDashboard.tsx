import React, { useState, useEffect } from "react";
import { 
  Briefcase, 
  Users, 
  BarChart, 
  FileText, 
  Settings, 
  HelpCircle, 
  Search, 
  Plus, 
  ChevronDown, 
  MoreVertical, 
  ChevronLeft, 
  ChevronRight, 
  ShieldCheck, 
  Lock, 
  Unlock,
  AlertCircle, 
  Cpu, 
  BookOpen, 
  CheckCircle, 
  User, 
  Clock, 
  MessageSquare, 
  ThumbsUp, 
  Send,
  UploadCloud,
  ExternalLink,
  X
} from "lucide-react";
import { jsPDF } from "jspdf";
import { motion, AnimatePresence } from "motion/react";
import { Job, Candidate, AuditLogEntry, DashboardStats } from "../types";

interface CandidateRowProps {
  cand: Candidate;
  idx: number;
  handleViewCandidateProfile: (id: string) => void;
}

const CandidateRow: React.FC<CandidateRowProps> = ({ cand, idx, handleViewCandidateProfile }) => {
  return (
    <div 
      onClick={() => handleViewCandidateProfile(cand.id)}
      className="bg-surface border border-outline rounded-none overflow-hidden transition-all cursor-pointer hover:border-primary hover:shadow-sm"
    >
      <div className="p-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          {/* Fit score badge */}
          <div className="w-14 h-14 bg-slate-50 border border-slate-200 rounded-none flex flex-col items-center justify-center text-center shrink-0">
            <span className="text-base font-black text-slate-900 leading-none font-mono">
              {cand.fitScore > 0 ? cand.fitScore : "--"}
            </span>
            <span className="text-[7px] text-slate-500 font-bold uppercase mt-1 tracking-widest font-mono">% Fit</span>
          </div>

          <div>
            <h3 className="font-extrabold text-sm text-slate-900 uppercase tracking-tight flex items-center gap-2">
              {cand.alias}
              <span className="text-[10px] font-mono font-normal text-primary bg-primary/10 px-2 py-0.5 rounded-none">
                CLICK TO VIEW FULL PROFILE
              </span>
            </h3>
            <div className="flex flex-wrap gap-1 mt-1.5">
              {cand.skills.slice(0, 5).map((s, sidx) => (
                <span key={sidx} className="bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-none text-[9px] font-mono text-slate-600 uppercase">
                  {s.split("[")[0].trim()}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-right hidden sm:block font-mono">
            <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Experience</p>
            <p className="text-xs font-bold text-slate-900 mt-0.5 uppercase">{cand.workHistory[0]?.period.split("(")[1]?.replace(")", "") || cand.workHistory[0]?.period || "N/A"}</p>
          </div>
          <ChevronRight className="w-5 h-5 text-primary shrink-0" />
        </div>
      </div>
    </div>
  );
};

interface RecruiterDashboardProps {
  onSwitchToCandidate: () => void;
  selectedJobId: string | null;
  setSelectedJobId: (id: string | null) => void;
}

export default function RecruiterDashboard({
  onSwitchToCandidate,
  selectedJobId,
  setSelectedJobId
}: RecruiterDashboardProps) {
  // Sidebar and active views
  const [activeTab, setActiveTab] = useState<"jobs" | "candidates" | "rankings" | "audit">("jobs");
  
  // Data State
  const [jobs, setJobs] = useState<Job[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [stats, setStats] = useState<DashboardStats>({ activeJobsCount: 0, totalApplicantsCount: 0, avgFitPercent: 0 });
  const [loading, setLoading] = useState(true);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("Status: All");

  // Selected entities
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [statusModalJob, setStatusModalJob] = useState<Job | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  const handleUpdateJobStatus = async (jobId: string, newStatus: "OPEN" | "DRAFT" | "CLOSED") => {
    setUpdatingStatus(true);
    try {
      const api = await import("../api");
      const success = await api.updateJobStatus(jobId, newStatus);
      if (success) {
        setJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: newStatus } : j));
        setStatusModalJob(null);
        await fetchData();
      } else {
        alert("Failed to update job status.");
      }
    } catch (err) {
      console.error("Error updating job status:", err);
    } finally {
      setUpdatingStatus(false);
    }
  };

  // Ensure selectedJobId is initialized when jobs are available
  useEffect(() => {
    if (!selectedJobId && jobs.length > 0) {
      setSelectedJobId(jobs[0].id);
    }
  }, [jobs, selectedJobId, setSelectedJobId]);

  // Sync selected candidate to match the active target job opening
  useEffect(() => {
    if (selectedJobId && candidates.length > 0) {
      const jobCands = candidates.filter(c => c.jobId === selectedJobId);
      if (jobCands.length > 0) {
        const currentBelongs = jobCands.some(c => c.id === selectedCandidateId);
        if (!currentBelongs || !selectedCandidateId) {
          const sorted = [...jobCands].sort((a, b) => b.fitScore - a.fitScore);
          setSelectedCandidateId(sorted[0].id);
        }
      } else {
        const currentBelongsToAny = candidates.some(c => c.id === selectedCandidateId);
        if (!currentBelongsToAny || !selectedCandidateId) {
          setSelectedCandidateId(candidates[0].id);
        }
      }
    } else if (candidates.length > 0 && !selectedCandidateId) {
      setSelectedCandidateId(candidates[0].id);
    }
  }, [selectedJobId, candidates, selectedCandidateId]);

  // Modals
  const [isNewJobModalOpen, setIsNewJobModalOpen] = useState(false);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [pdfModalCandidate, setPdfModalCandidate] = useState<{ cand: Candidate; blobUrl: string } | null>(null);

  // New Job Form
  const [newJobTitle, setNewJobTitle] = useState("");
  const [newJobDept, setNewJobDept] = useState("");
  const [newJobDesc, setNewJobDesc] = useState("");
  const [newJobExp, setNewJobExp] = useState("Senior (6-10 years)");
  const [newJobEdu, setNewJobEdu] = useState("Bachelor's Degree");
  const [newJobSkills, setNewJobSkills] = useState<string[]>(["React", "TypeScript"]);
  const [skillInput, setSkillInput] = useState("");
  const [newJobSalary, setNewJobSalary] = useState("$140k - $180k");
  const [newJobLocation, setNewJobLocation] = useState("Remote");

  // Upload candidate Form
  const [resumeText, setResumeText] = useState("");
  const [selectedUploadFile, setSelectedUploadFile] = useState<File | null>(null);
  const [isParsingResume, setIsParsingResume] = useState(false);

  // Run Matching state
  const [isMatchingRunning, setIsMatchingRunning] = useState(false);

  // Interview Questions Generation state
  const [isGeneratingQuestions, setIsGeneratingQuestions] = useState(false);
  const [numQuestionsToGenerate, setNumQuestionsToGenerate] = useState<number>(5);

  // Feedback Form state
  const [feedbackInterviewer, setFeedbackInterviewer] = useState("");
  const [feedbackScore, setFeedbackScore] = useState(8);
  const [feedbackNotes, setFeedbackNotes] = useState("");
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false);

  // Fetch initial data
  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const api = await import("../api");
      const [jobsRes, candidatesRes, logsRes] = await Promise.all([
        api.getJobs(),
        api.getCandidates(),
        api.getAuditLogs()
      ]);
      const statsRes = await api.getDashboardStats(jobsRes, candidatesRes);

      setStats(statsRes);
      setJobs(jobsRes);
      setCandidates(candidatesRes);
      setAuditLogs(logsRes);

      if (jobsRes.length > 0 && !selectedJobId) {
        setSelectedJobId(jobsRes[0].id);
      }

      if (candidatesRes.length > 0 && !selectedCandidateId) {
        const targetJobId = selectedJobId || (jobsRes.length > 0 ? jobsRes[0].id : null);
        const jobCands = candidatesRes.filter(c => c.jobId === targetJobId);
        if (jobCands.length > 0) {
          const sorted = [...jobCands].sort((a, b) => b.fitScore - a.fitScore);
          setSelectedCandidateId(sorted[0].id);
        } else {
          setSelectedCandidateId(candidatesRes[0].id);
        }
      }
    } catch (e) {
      console.error("Error fetching data:", e);
    } finally {
      setLoading(false);
    }
  };

  // Create Job
  const handleCreateJob = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newJobTitle) return;

    try {
      const api = await import("../api");
      const created = await api.createJob({
        title: newJobTitle,
        department: newJobDept,
        description: newJobDesc,
        experience: newJobExp,
        education: newJobEdu,
        skills: newJobSkills,
        salary: newJobSalary,
        location: newJobLocation
      });

      if (created) {
        setSelectedJobId(created.id);
        setIsNewJobModalOpen(false);
        setNewJobTitle("");
        setNewJobDept("");
        setNewJobDesc("");
        setNewJobSkills(["React", "TypeScript"]);
        fetchData();
      }
    } catch (e) {
      console.error("Error creating job:", e);
    }
  };

  const handleAddSkill = () => {
    if (skillInput.trim() && !newJobSkills.includes(skillInput.trim())) {
      setNewJobSkills([...newJobSkills, skillInput.trim()]);
      setSkillInput("");
    }
  };

  const handleRemoveSkill = (skill: string) => {
    setNewJobSkills(newJobSkills.filter(s => s !== skill));
  };

  // Upload candidate resume
  const handleUploadResume = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!resumeText && !selectedUploadFile) || !selectedJobId) return;

    setIsParsingResume(true);
    try {
      const api = await import("../api");
      const parsedCandidate = await api.uploadCandidateResume(selectedJobId, {
        file: selectedUploadFile || undefined,
        text: !selectedUploadFile ? resumeText : undefined
      });

      if (parsedCandidate) {
        setIsUploadModalOpen(false);
        setResumeText("");
        setSelectedUploadFile(null);
        setSelectedCandidateId(parsedCandidate.id);
        setActiveTab("candidates");
        fetchData();
      }
    } catch (e) {
      console.error("Error parsing resume:", e);
    } finally {
      setIsParsingResume(false);
    }
  };

  // Run Matching
  const handleRunMatching = async () => {
    if (!selectedJobId) return;
    setIsMatchingRunning(true);
    try {
      const api = await import("../api");
      const success = await api.runMatchingEngine(selectedJobId);
      if (success) {
        await fetchData();
      }
    } catch (e) {
      console.error("Error running matching:", e);
    } finally {
      setIsMatchingRunning(false);
    }
  };

  // Unredact Candidate details (compliance log)
  const handleUnredactCandidate = async (candId: string) => {
    try {
      const api = await import("../api");
      const unredacted = await api.unredactCandidateProfile(candId);
      if (unredacted) {
        await fetchData();
      }
    } catch (e) {
      console.error("Error unredacting candidate:", e);
    }
  };

  // Open Raw CV in PDF Modal window
  const handleOpenRawCV = async (cand: Candidate) => {
    try {
      const api = await import("../api");
      const unredacted = await api.unredactCandidateProfile(cand.id);
      const target = unredacted || cand;
      if (unredacted) {
        await fetchData();
      }

      // Check if actual raw PDF uploaded file is available on server
      const rawPdfUrl = `${api.API_BASE}/candidates/${cand.id}/raw-file`;
      try {
        const checkRes = await fetch(rawPdfUrl, { method: "HEAD" });
        if (checkRes.ok) {
          setPdfModalCandidate({ cand: target, blobUrl: rawPdfUrl });
          return;
        }
      } catch (e) {
        console.warn("Raw PDF endpoint check failed or not present, falling back to compiled PDF", e);
      }

      const doc = new jsPDF();
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 20;
      const maxLineWidth = pageWidth - margin * 2;

      // Header / Title
      doc.setFont("helvetica", "bold");
      doc.setFontSize(22);
      doc.setTextColor(15, 23, 42);
      doc.text(target.realName !== "Redacted PII" ? target.realName : (target.alias || "Candidate Resume"), margin, 26);

      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(37, 99, 235);
      doc.text("NEXTHIRE // OFFICIAL UNREDACTED RESUME DOSSIER", margin, 34);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.5);
      doc.setTextColor(71, 85, 105);
      doc.text(`Email: ${target.realEmail || "N/A"}   |   Phone: ${target.realPhone || "N/A"}`, margin, 42);
      doc.text(`Location: ${target.realLocation || "N/A"}   |   Job Reference ID: #${target.jobId}`, margin, 48);
      
      doc.setDrawColor(203, 213, 225);
      doc.setLineWidth(0.5);
      doc.line(margin, 54, pageWidth - margin, 54);

      let cursorY = 64;

      // Professional Experience Section
      if (target.workHistory && target.workHistory.length > 0) {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(12);
        doc.setTextColor(15, 23, 42);
        doc.text("PROFESSIONAL EXPERIENCE & RESPONSIBILITIES", margin, cursorY);
        cursorY += 8;

        target.workHistory.forEach((work) => {
          if (cursorY > pageHeight - 35) {
            doc.addPage();
            cursorY = 25;
          }
          doc.setFont("helvetica", "bold");
          doc.setFontSize(10.5);
          doc.setTextColor(30, 41, 59);
          doc.text(`${work.role.toUpperCase()} — ${work.company}`, margin, cursorY);
          cursorY += 5.5;

          doc.setFont("helvetica", "italic");
          doc.setFontSize(9);
          doc.setTextColor(100, 116, 139);
          doc.text(`${work.period}`, margin, cursorY);
          cursorY += 6;

          doc.setFont("helvetica", "normal");
          doc.setFontSize(9.5);
          doc.setTextColor(51, 65, 85);
          work.bullets.forEach((bullet) => {
            const bLines = doc.splitTextToSize(`• ${bullet}`, maxLineWidth - 4);
            for (let line of bLines) {
              if (cursorY > pageHeight - 20) {
                doc.addPage();
                cursorY = 25;
              }
              doc.text(line, margin + 4, cursorY);
              cursorY += 5;
            }
          });
          cursorY += 6;
        });
      }

      // Verified Technical Skills Section
      if (target.skills && target.skills.length > 0) {
        if (cursorY > pageHeight - 40) {
          doc.addPage();
          cursorY = 25;
        }
        doc.setFont("helvetica", "bold");
        doc.setFontSize(12);
        doc.setTextColor(15, 23, 42);
        doc.text("VERIFIED TECHNICAL SKILLS", margin, cursorY);
        cursorY += 8;

        doc.setFont("helvetica", "normal");
        doc.setFontSize(9.5);
        doc.setTextColor(51, 65, 85);
        const skillsText = target.skills.join("   •   ");
        const skillLines = doc.splitTextToSize(skillsText, maxLineWidth);
        for (let line of skillLines) {
          if (cursorY > pageHeight - 20) {
            doc.addPage();
            cursorY = 25;
          }
          doc.text(line, margin, cursorY);
          cursorY += 5.5;
        }
        cursorY += 8;
      }

      // Raw Transcript Section (if available and distinct from filename)
      const rawText = target.resumeText || "";
      const isJustFilename = rawText === target.alias || rawText.endsWith(".pdf") || rawText.endsWith(".docx") || rawText.length < 30;
      if (!isJustFilename) {
        if (cursorY > pageHeight - 40) {
          doc.addPage();
          cursorY = 25;
        }
        doc.setFont("helvetica", "bold");
        doc.setFontSize(12);
        doc.setTextColor(15, 23, 42);
        doc.text("EXTRACTED RAW DOCUMENT TRANSCRIPT", margin, cursorY);
        cursorY += 8;

        doc.setFont("courier", "normal");
        doc.setFontSize(9);
        doc.setTextColor(30, 41, 59);

        const lines = doc.splitTextToSize(rawText, maxLineWidth);
        for (let i = 0; i < lines.length; i++) {
          if (cursorY > pageHeight - 20) {
            doc.addPage();
            cursorY = 25;
          }
          doc.text(lines[i], margin, cursorY);
          cursorY += 4.8;
        }
      }

      const blob = doc.output("blob");
      const url = URL.createObjectURL(blob);
      setPdfModalCandidate({ cand: target, blobUrl: url });
    } catch (err) {
      console.error("Error generating PDF:", err);
    }
  };

  // Generate Interview Questions via Gemini/Backend
  const handleGenerateQuestions = async (candId: string) => {
    setIsGeneratingQuestions(true);
    try {
      const api = await import("../api");
      const questions = await api.generateCandidateQuestions(candId, numQuestionsToGenerate);
      if (questions && questions.length > 0) {
        setCandidates(prev => prev.map(c => 
          c.id === candId ? { ...c, interviewQuestions: questions } : c
        ));
      }
    } catch (e) {
      console.error("Error generating questions:", e);
    } finally {
      setIsGeneratingQuestions(false);
    }
  };

  // Submit Feedback
  const handleSubmitFeedback = async (e: React.FormEvent, candId: string) => {
    e.preventDefault();
    setIsSubmittingFeedback(true);
    try {
      const api = await import("../api");
      const success = await api.submitCandidateFeedback(candId, {
        interviewer: feedbackInterviewer || "Jane Doe (Technical Evaluator)",
        score: feedbackScore,
        notes: feedbackNotes,
        decision: feedbackScore >= 8 ? "hired" : (feedbackScore <= 5 ? "rejected" : "on_hold")
      });

      if (success) {
        setFeedbackInterviewer("");
        setFeedbackNotes("");
        setFeedbackScore(8);
        fetchData();
      }
    } catch (e) {
      console.error("Error submitting feedback:", e);
    } finally {
      setIsSubmittingFeedback(false);
    }
  };

  // Navigation handlers
  const handleViewJobRankings = (jobId: string) => {
    setSelectedJobId(jobId);
    setActiveTab("rankings");
  };

  const handleViewCandidateProfile = (candId: string) => {
    setSelectedCandidateId(candId);
    setActiveTab("candidates");
  };

  // Filtering candidates and jobs
  const filteredJobs = jobs.filter(job => {
    const matchesSearch = job.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          job.department.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === "Status: All" || 
                          (statusFilter === "Open" && job.status === "OPEN") || 
                          (statusFilter === "Draft" && job.status === "DRAFT") || 
                          (statusFilter === "Closed" && job.status === "CLOSED");
    return matchesSearch && matchesStatus;
  });

  const selectedCandidate = candidates.find(c => c.id === selectedCandidateId);
  const selectedJobObj = jobs.find(j => j.id === selectedJobId);

  return (
    <div className="flex h-full flex-1 overflow-hidden" id="recruiter-portal-container">
      {/* SideNavBar */}
      <aside className="bg-surface border-r border-outline w-[240px] flex flex-col h-full py-6 px-4 space-y-2 shrink-0">
        <div className="mb-6 px-2 pb-6 border-b border-outline">
          <div className="flex items-center gap-2">
            <ShieldCheck className="text-primary w-5 h-5 shrink-0" />
            <div>
              <p className="font-extrabold text-sm uppercase tracking-wider text-slate-900">RECRUITER PORTAL</p>
              <p className="text-[9px] text-slate-500 font-mono uppercase tracking-widest mt-0.5">HR_SESSION // ALPHA</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 space-y-1.5">
          <button 
            id="nav-jobs-btn"
            onClick={() => setActiveTab("jobs")}
            className={`w-full text-left font-mono rounded-none flex items-center gap-3 px-4 py-3 transition-all cursor-pointer ${
              activeTab === "jobs" 
                ? "bg-slate-100 text-primary border-l-2 border-primary" 
                : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
            }`}
          >
            <Briefcase className="w-4 h-4 shrink-0" />
            <span className="text-xs font-bold uppercase tracking-widest">JOBS</span>
          </button>

          <button 
            id="nav-rankings-btn"
            onClick={() => setActiveTab("rankings")}
            className={`w-full text-left font-mono rounded-none flex items-center gap-3 px-4 py-3 transition-all cursor-pointer ${
              activeTab === "rankings" 
                ? "bg-slate-100 text-primary border-l-2 border-primary" 
                : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
            }`}
          >
            <BarChart className="w-4 h-4 shrink-0" />
            <span className="text-xs font-bold uppercase tracking-widest">RANKINGS</span>
          </button>

          <button 
            id="nav-candidates-btn"
            onClick={() => setActiveTab("candidates")}
            className={`w-full text-left font-mono rounded-none flex items-center gap-3 px-4 py-3 transition-all cursor-pointer ${
              activeTab === "candidates" 
                ? "bg-slate-100 text-primary border-l-2 border-primary" 
                : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
            }`}
          >
            <Users className="w-4 h-4 shrink-0" />
            <span className="text-xs font-bold uppercase tracking-widest">CANDIDATES</span>
          </button>

          <button 
            id="nav-audit-btn"
            onClick={() => setActiveTab("audit")}
            className={`w-full text-left font-mono rounded-none flex items-center gap-3 px-4 py-3 transition-all cursor-pointer ${
              activeTab === "audit" 
                ? "bg-slate-100 text-primary border-l-2 border-primary" 
                : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
            }`}
          >
            <FileText className="w-4 h-4 shrink-0" />
            <span className="text-xs font-bold uppercase tracking-widest">AUDIT LOG</span>
          </button>
        </nav>

        <div className="pt-4 border-t border-outline space-y-1.5 font-mono text-[10px]">
          <div className="text-slate-600 flex items-center gap-3 px-4 py-2 bg-slate-100 border border-slate-200 rounded-none mb-1.5 uppercase">
            <User className="w-3.5 h-3.5 text-primary" />
            <span className="tracking-wider font-bold">J. DOE // LEAD</span>
          </div>
          <button className="w-full text-left text-slate-500 hover:bg-slate-50 hover:text-slate-800 flex items-center gap-3 px-4 py-2.5 rounded-none transition-all uppercase tracking-wider">
            <Settings className="w-3.5 h-3.5" />
            <span className="text-[10px] font-bold">Settings</span>
          </button>
          <button className="w-full text-left text-slate-500 hover:bg-slate-50 hover:text-slate-800 flex items-center gap-3 px-4 py-2.5 rounded-none transition-all uppercase tracking-wider">
            <HelpCircle className="w-3.5 h-3.5" />
            <span className="text-[10px] font-bold">Support</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col overflow-hidden bg-surface-container-low">
        {activeTab === "jobs" && (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Content Header */}
            <div className="px-6 py-5 flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-outline bg-surface sticky top-0 z-10">
              <div>
                <h1 className="massive-text text-2xl text-slate-900 tracking-tighter uppercase font-black">JOBS</h1>
                <p className="text-xs text-slate-500">Manage active listings and evaluate candidate pools with unbiased compliance metrics.</p>
              </div>
              <button 
                id="create-new-job-btn"
                onClick={() => setIsNewJobModalOpen(true)}
                className="bg-primary text-white px-5 py-3 rounded-none flex items-center gap-2 font-bold text-xs uppercase tracking-wider hover:bg-blue-600 transition-all border border-primary/20 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                NEW LISTING
              </button>
            </div>

            {/* Filters & Stats Bento Section */}
            <div className="px-6 pt-6 grid grid-cols-1 md:grid-cols-12 gap-6">
              {/* Search & Status Filters */}
              <div className="md:col-span-8 bg-surface border border-outline rounded-none p-4 flex flex-wrap items-center gap-4">
                <div className="flex-1 min-w-[240px] relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                  <input 
                    id="search-input"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-none py-2.5 pl-10 pr-4 text-xs focus:border-primary text-slate-800" 
                    placeholder="Search listings by title or department..." 
                    type="text"
                  />
                </div>
                <div className="relative min-w-[140px]">
                  <select 
                    id="status-select-filter"
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-none py-2.5 pl-3 pr-8 text-xs focus:border-primary text-slate-800 appearance-none cursor-pointer font-mono uppercase"
                  >
                    <option>Status: All</option>
                    <option>Open</option>
                    <option>Draft</option>
                    <option>Closed</option>
                  </select>
                  <ChevronDown className="w-4 h-4 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-500" />
                </div>
                <button className="flex items-center gap-1.5 px-3 py-2 text-slate-600 hover:bg-slate-50 rounded-none transition-colors border border-slate-200 border-dashed text-xs font-mono uppercase">
                  <span>ADVANCED_FILTERS</span>
                </button>
              </div>

              {/* Stats Bento */}
              <div className="md:col-span-4 bg-slate-100 border border-outline rounded-none p-4 flex items-center justify-around font-mono">
                <div className="text-center">
                  <span className="item-label uppercase text-[9px] tracking-widest block text-slate-500 mb-1">Active</span>
                  <p className="item-value text-2xl text-primary">{stats.activeJobsCount}</p>
                </div>
                <div className="w-[1px] h-8 bg-slate-300"></div>
                <div className="text-center">
                  <span className="item-label uppercase text-[9px] tracking-widest block text-slate-500 mb-1">Applicants</span>
                  <p className="item-value text-2xl text-primary">{stats.totalApplicantsCount}</p>
                </div>
                <div className="w-[1px] h-8 bg-slate-300"></div>
                <div className="text-center">
                  <span className="item-label uppercase text-[9px] tracking-widest block text-slate-500 mb-1">Avg. Fit</span>
                  <p className="item-value text-2xl text-primary">{stats.avgFitPercent}%</p>
                </div>
              </div>
            </div>

            {/* Table Container */}
            <div className="flex-1 overflow-auto px-6 py-6">
              <div className="bg-surface border border-outline rounded-none overflow-hidden">
                <table className="w-full text-left border-collapse">
                  <thead className="bg-slate-100 text-slate-600 border-b border-outline font-mono text-[10px] uppercase tracking-wider">
                    <tr>
                      <th className="px-4 py-3.5 font-bold">Listing Title</th>
                      <th className="px-4 py-3.5 font-bold">Status</th>
                      <th className="px-4 py-3.5 font-bold">Candidates</th>
                      <th className="px-4 py-3.5 font-bold">Avg. Fit Score</th>
                      <th className="px-4 py-3 text-xs font-bold uppercase tracking-wider">Created Date</th>
                      <th className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline">
                    {filteredJobs.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-10 text-center text-slate-500 text-xs font-mono">
                          NO JOBS MATCH THE CURRENT FILTER CRITERIA.
                        </td>
                      </tr>
                    ) : (
                      filteredJobs.map((job) => (
                        <tr key={job.id} className="hover:bg-slate-50/50 transition-colors group cursor-pointer border-b border-outline">
                          <td className="px-4 py-4" onClick={() => handleViewJobRankings(job.id)}>
                            <div className="flex flex-col">
                              <span className="text-sm font-extrabold text-slate-900 group-hover:text-primary transition-colors uppercase tracking-tight">{job.title}</span>
                              <span className="text-[10px] text-slate-500 font-mono mt-0.5">DEPT: {job.department}</span>
                            </div>
                          </td>
                          <td className="px-4 py-4" onClick={() => handleViewJobRankings(job.id)}>
                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-none text-[9px] font-mono font-bold uppercase tracking-widest ${
                              job.status === "OPEN" 
                                ? "bg-emerald-50 border border-emerald-200 text-emerald-700" 
                                : job.status === "DRAFT" 
                                ? "bg-amber-50 border border-amber-200 text-amber-700" 
                                : "bg-slate-100 border border-slate-200 text-slate-600"
                            }`}>
                              <span className={`w-1.5 h-1.5 rounded-none ${
                                job.status === "OPEN" 
                                  ? "bg-emerald-500" 
                                  : job.status === "DRAFT" 
                                  ? "bg-amber-500" 
                                  : "bg-slate-400"
                              }`}></span>
                              {job.status}
                            </span>
                          </td>
                          <td className="px-4 py-4">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs font-bold text-slate-900">{job.candidatesCount}</span>
                              {job.candidatesCount > 0 && (
                                <div className="flex -space-x-1 overflow-hidden">
                                  {candidates.filter(c => c.jobId === job.id).slice(0, 3).map((cand, i) => (
                                    <div 
                                      key={cand.id} 
                                      onClick={() => handleViewCandidateProfile(cand.id)}
                                      className={`w-5 h-5 rounded-none border border-slate-200 flex items-center justify-center text-[8px] font-mono font-bold text-slate-800 hover:scale-110 hover:border-primary transition-all ${
                                        i === 0 ? "bg-indigo-50 text-indigo-700" : i === 1 ? "bg-purple-50 text-purple-700" : "bg-teal-50 text-teal-700"
                                      }`}
                                    >
                                      {cand.avatarInitials}
                                    </div>
                                  ))}
                                  {job.candidatesCount > 3 && (
                                    <div className="w-5 h-5 rounded-none border border-slate-200 bg-slate-100 flex items-center justify-center text-[8px] font-mono font-bold text-slate-600">
                                      +{job.candidatesCount - 3}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-4" onClick={() => handleViewJobRankings(job.id)}>
                            <div className="w-32 flex items-center gap-2">
                              <div className="flex-1 h-1 bg-slate-200 border border-slate-300 rounded-none overflow-hidden">
                                <div 
                                  className="h-full bg-primary" 
                                  style={{ width: `${job.avgFit || 0}%` }}
                                ></div>
                              </div>
                              <span className="font-mono text-xs font-semibold text-slate-800">
                                {job.avgFit ? `${job.avgFit}%` : "--"}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-4" onClick={() => handleViewJobRankings(job.id)}>
                            <span className="font-mono text-xs text-slate-500">{job.createdDate}</span>
                          </td>
                          <td className="px-4 py-4 text-right">
                            <div className="flex justify-end gap-1.5">
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setStatusModalJob(job);
                                }}
                                className="px-2.5 py-1 text-[9px] font-mono uppercase tracking-widest bg-slate-100 border border-slate-200 text-slate-700 hover:bg-slate-200 hover:border-slate-300 rounded-none font-bold flex items-center gap-1 cursor-pointer transition-colors"
                              >
                                <Settings className="w-3 h-3 text-primary" />
                                UPDATE STATUS
                              </button>
                              <button className="text-slate-500 hover:text-slate-800 p-1 rounded-none hover:bg-slate-100 transition-all">
                                <MoreVertical className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
                {/* Table Footer */}
                <div className="px-4 py-3 bg-surface-container flex items-center justify-between border-t border-outline-variant">
                  <p className="text-xs text-on-surface-variant">Showing {filteredJobs.length} of {jobs.length} jobs</p>
                  <div className="flex gap-1">
                    <button className="p-1 hover:bg-surface-container-high rounded transition-colors text-on-surface-variant">
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button className="px-2 py-1 bg-primary text-on-primary rounded text-xs font-semibold">1</button>
                    <button className="px-2 py-1 hover:bg-surface-container-high rounded text-xs font-semibold text-on-surface-variant">2</button>
                    <button className="p-1 hover:bg-surface-container-high rounded transition-colors text-on-surface-variant">
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === "candidates" && (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Candidate SubHeader */}
            <div className="px-6 py-4 flex items-center justify-between border-b border-outline bg-surface sticky top-0 z-10">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-none bg-slate-100 border border-slate-200 text-slate-800 flex items-center justify-center font-mono font-bold">
                  {selectedCandidate ? selectedCandidate.avatarInitials : "C"}
                </div>
                <div>
                  <h1 className="text-base font-extrabold text-slate-900 flex items-center gap-2 uppercase tracking-tight">
                    {selectedCandidate ? selectedCandidate.alias : "Select Candidate"}
                    {selectedCandidate && (
                      <span className="text-[10px] text-slate-500 font-mono font-normal normal-case tracking-normal">
                        ({selectedCandidate.isAnonymized ? "ANONYMIZED_PROFILE" : "UNREDACTED"})
                      </span>
                    )}
                  </h1>
                  <p className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">
                    {selectedCandidate 
                      ? `Target Role: ${jobs.find(j => j.id === selectedCandidate.jobId)?.title || "Target Role"} • Filed: ${selectedCandidate.appliedDate}`
                      : "CHOOSE A COMPLIANCE RECORD FROM SELECTOR."}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2.5">
                <div className="relative min-w-[200px]">
                  <select 
                    id="cand-select-switch"
                    value={selectedCandidateId || ""}
                    onChange={(e) => setSelectedCandidateId(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-none py-2 pl-3 pr-8 text-xs text-slate-800 focus:border-primary cursor-pointer font-mono uppercase"
                  >
                    <option value="" disabled>Choose candidate...</option>
                    {candidates.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.alias} - {jobs.find(j => j.id === c.jobId)?.title}
                      </option>
                    ))}
                  </select>
                </div>
                {selectedCandidate && (
                  <button 
                    onClick={() => {
                      if (selectedCandidate) {
                        setSelectedJobId(selectedCandidate.jobId);
                        setActiveTab("rankings");
                      }
                    }}
                    className="px-4 py-2 bg-primary text-white rounded-none text-xs font-bold uppercase tracking-wider hover:bg-blue-600 transition-all border border-primary/20 cursor-pointer"
                  >
                    ADVANCE TO INTERVIEW
                  </button>
                )}
              </div>
            </div>            {/* Split Panel Layout */}
            {selectedCandidate ? (
              <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 overflow-hidden">
                {/* Left Panel: Candidate Full CV Dossier */}
                <div className="lg:col-span-6 p-6 overflow-y-auto border-r border-outline bg-surface space-y-6">
                  <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                    <h2 className="text-sm font-extrabold text-slate-900 flex items-center gap-2 uppercase tracking-wide">
                      <ShieldCheck className="w-4 h-4 text-primary shrink-0" />
                      Candidate CV & Dossier
                    </h2>
                    <span className="bg-primary/10 border border-primary/20 text-primary text-[9px] font-mono font-bold px-2.5 py-1 rounded-none uppercase tracking-widest">
                      {selectedCandidate.isUnredactedViewed ? "UNREDACTED_CV" : "PII_FREE_CV"}
                    </span>
                  </div>

                  {/* Full Candidate CV in Detail (Click to Open Raw CV in Popup Window) */}
                  <div className="space-y-2.5 pt-1">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-bold text-slate-700 uppercase tracking-widest font-mono flex items-center gap-1.5">
                        <FileText className="w-3.5 h-3.5 text-primary" />
                        Full Candidate CV Transcript (Detail)
                      </p>
                      <span className="text-[9px] font-mono text-primary font-bold uppercase tracking-wider bg-blue-50 border border-blue-200 px-2 py-0.5">
                        POPUP WINDOW READY
                      </span>
                    </div>
                    <div 
                      onClick={() => handleOpenRawCV(selectedCandidate)}
                      title="Click to open raw CV document in popup window"
                      className="p-4 bg-slate-50 hover:bg-blue-50/40 border border-slate-200 hover:border-primary transition-all rounded-none cursor-pointer group relative shadow-sm"
                    >
                      <div className="flex items-center justify-between pb-2.5 mb-2.5 border-b border-slate-200 group-hover:border-primary/20">
                        <span className="text-xs font-mono font-extrabold text-slate-900 group-hover:text-primary transition-colors flex items-center gap-2 uppercase">
                          <FileText className="w-4 h-4 text-primary shrink-0" />
                          {selectedCandidate.alias}_RAW_RESUME.pdf
                        </span>
                        <span className="bg-primary text-white text-[9px] font-mono font-bold px-2.5 py-1 uppercase tracking-widest group-hover:bg-blue-600 transition-colors shrink-0 shadow-sm">
                          OPEN PDF DIALOG
                        </span>
                      </div>
                      <pre className="text-xs font-mono leading-relaxed whitespace-pre-wrap text-slate-700 max-h-[360px] overflow-y-auto pointer-events-none">
                        {selectedCandidate.resumeText || "No CV transcript available."}
                      </pre>
                    </div>
                  </div>

                  {/* Skills Section */}
                  <div className="space-y-2">
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest font-mono">Verified Skills Profile</p>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedCandidate.skills.map((skill, idx) => (
                        <span 
                          key={idx}
                          className="px-2.5 py-1 bg-slate-100 border border-slate-200 text-slate-700 rounded-none font-mono text-xs"
                        >
                          {skill}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Timeline section */}
                  <div className="space-y-4">
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest font-mono">Career Milestones</p>
                    <div className="relative border-l border-slate-200 ml-3 pl-5 space-y-6">
                      {selectedCandidate.workHistory.map((work, idx) => (
                        <div key={idx} className="relative">
                          <div className={`absolute -left-[26px] top-1.5 w-3 h-3 rounded-none border border-slate-200 ${
                            idx === 0 ? "bg-primary" : "bg-slate-200"
                          }`}></div>
                          <div>
                            <h3 className="text-sm font-extrabold text-slate-900 uppercase tracking-tight">{work.role}</h3>
                            <p className="text-[11px] text-slate-500 font-mono mt-0.5">
                              {work.company} <span className="mx-1">•</span> {work.period}
                            </p>
                            <ul className="list-disc list-outside ml-4 mt-2 text-xs text-slate-600 space-y-1.5 font-sans leading-relaxed">
                              {work.bullets.map((bullet, bidx) => (
                                <li key={bidx}>{bullet}</li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* AI Alignment Section */}
                  {selectedCandidate.matchRationale && (
                    <div className="p-4 bg-slate-50 border border-slate-200 rounded-none space-y-2">
                      <h4 className="text-xs font-bold text-slate-900 flex items-center gap-1.5 uppercase tracking-widest font-mono">
                        <Cpu className="w-4 h-4 text-primary" />
                        AI Alignment Analysis
                      </h4>
                      <p className="text-xs text-slate-600 leading-relaxed font-sans">
                        {selectedCandidate.matchRationale}
                      </p>
                    </div>
                  )}
                </div>

                {/* Right Panel: Question Generation & Feedback at Bottom */}
                <div className="lg:col-span-6 p-6 overflow-y-auto bg-slate-100/60 flex flex-col justify-between space-y-6">
                  <div className="space-y-6">
                    {/* Interview Questions Panel */}
                    <div className="border border-outline rounded-none p-6 bg-surface space-y-4 shadow-sm">
                      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
                        <div className="flex items-center gap-2">
                          <Cpu className="w-4 h-4 text-primary" />
                          <h3 className="font-extrabold text-xs uppercase tracking-widest font-mono text-slate-900">AI Custom Question Generation</h3>
                        </div>
                        
                        <div className="flex items-center gap-2">
                          <div className="flex items-center gap-1.5 bg-slate-100 border border-slate-200 px-2.5 py-1.5">
                            <label htmlFor="num-questions-select" className="text-[9px] font-bold text-slate-600 uppercase font-mono tracking-wider">
                              QTY:
                            </label>
                            <select
                              id="num-questions-select"
                              value={numQuestionsToGenerate}
                              onChange={(e) => setNumQuestionsToGenerate(Number(e.target.value))}
                              disabled={isGeneratingQuestions}
                              className="bg-transparent font-mono text-xs font-bold text-primary focus:outline-none cursor-pointer"
                            >
                              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => (
                                <option key={num} value={num}>
                                  {num} Qs
                                </option>
                              ))}
                            </select>
                          </div>

                          <button 
                            id="generate-questions-btn"
                            disabled={isGeneratingQuestions}
                            onClick={() => handleGenerateQuestions(selectedCandidate.id)}
                            className="bg-primary text-white hover:bg-blue-600 px-4 py-2 rounded-none text-[10px] font-mono font-bold uppercase tracking-wider flex items-center gap-1.5 cursor-pointer shadow-sm transition-all shrink-0"
                          >
                            {isGeneratingQuestions ? "GENERATING..." : (selectedCandidate.interviewQuestions && selectedCandidate.interviewQuestions.length > 0 ? "REGENERATE QUESTIONS" : "GENERATE QUESTIONS")}
                          </button>
                        </div>
                      </div>

                      {selectedCandidate.interviewQuestions && selectedCandidate.interviewQuestions.length > 0 ? (
                        <div className="space-y-3 pt-2">
                          {selectedCandidate.interviewQuestions.map((q, idx) => (
                            <div key={idx} className="p-3.5 bg-slate-50 border border-slate-200 rounded-none flex gap-3 text-xs text-slate-800 font-sans leading-relaxed">
                              <span className="font-mono font-bold text-primary shrink-0">Q{idx + 1}.</span>
                              <p>{q}</p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-center py-8 px-4 bg-slate-50 border border-slate-200 border-dashed rounded-none space-y-2">
                          <p className="text-xs text-slate-600 font-mono uppercase tracking-wider font-bold">
                            NO INTERVIEW QUESTIONS GENERATED YET
                          </p>
                          <p className="text-[11px] text-slate-400 font-sans max-w-md mx-auto">
                            Click "GENERATE QUESTIONS" above to analyze the candidate's CV against job requirements and produce tailored screening questions.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Feedback Logs & Form at Bottom */}
                  <div className="border border-outline rounded-none p-6 bg-surface space-y-4 shadow-sm mt-auto">
                    <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                      <div className="flex items-center gap-2">
                        <MessageSquare className="w-4 h-4 text-primary" />
                        <h3 className="font-extrabold text-xs uppercase tracking-widest font-mono text-slate-900">Evaluator Feedback Part</h3>
                      </div>
                      <span className="text-[10px] font-mono text-slate-400 uppercase">Screening Scorecard</span>
                    </div>

                    {/* Feedback lists */}
                    {selectedCandidate.feedbacks && selectedCandidate.feedbacks.length > 0 ? (
                      <div className="space-y-3 max-h-[220px] overflow-y-auto pr-1">
                        {selectedCandidate.feedbacks.map((f, idx) => (
                          <div key={idx} className="p-3.5 border border-slate-200 rounded-none bg-slate-50 space-y-1 font-sans">
                            <div className="flex items-center justify-between text-xs font-bold uppercase tracking-tight">
                              <span className="text-slate-950">{f.interviewer}</span>
                              <span className="bg-emerald-50 border border-emerald-200 text-emerald-700 font-mono text-[10px] px-2 py-0.5 rounded-none tracking-widest">
                                SCORE: {f.score}/10
                              </span>
                            </div>
                            <p className="text-xs text-slate-600 leading-relaxed italic pt-1">"{f.notes}"</p>
                            <p className="text-[9px] font-mono text-slate-400 text-right pt-1">{f.date}</p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 p-4 rounded-none font-mono text-center uppercase tracking-wider">
                        NO FEEDBACK ENTRIES LOGGED YET. SUBMIT YOUR EVALUATION BELOW.
                      </p>
                    )}

                    {/* Feedback Form */}
                    <form onSubmit={(e) => handleSubmitFeedback(e, selectedCandidate.id)} className="space-y-3 pt-4 border-t border-slate-200 font-mono text-xs">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div className="md:col-span-2 space-y-1">
                          <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Interviewer Ref</label>
                          <input 
                            id="feedback-interviewer-input"
                            required
                            placeholder="e.g. Jane Doe (Tech Lead)"
                            value={feedbackInterviewer}
                            onChange={(e) => setFeedbackInterviewer(e.target.value)}
                            className="w-full bg-white border border-slate-200 rounded-none px-3 py-2 text-xs focus:border-primary text-slate-800 font-sans"
                            type="text" 
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Score (1-10)</label>
                          <select 
                            id="feedback-score-select"
                            value={feedbackScore}
                            onChange={(e) => setFeedbackScore(Number(e.target.value))}
                            className="w-full bg-white border border-slate-200 rounded-none px-3 py-2 text-xs focus:border-primary text-slate-800"
                          >
                            {[10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map(n => (
                              <option key={n} value={n}>{n}/10</option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Evaluation Notes</label>
                        <textarea 
                          id="feedback-notes-textarea"
                          required
                          rows={3}
                          placeholder="Provide objective, alignment-based feedback notes..."
                          value={feedbackNotes}
                          onChange={(e) => setFeedbackNotes(e.target.value)}
                          className="w-full bg-white border border-slate-200 rounded-none p-2.5 text-xs focus:border-primary text-slate-800 font-sans"
                        />
                      </div>
                      <button 
                        id="submit-feedback-btn"
                        disabled={isSubmittingFeedback}
                        type="submit" 
                        className="w-full bg-primary text-white py-2.5 rounded-none font-bold uppercase tracking-wider hover:bg-blue-600 transition-all border border-primary/20 flex items-center justify-center gap-2 cursor-pointer"
                      >
                        <Send className="w-3.5 h-3.5" />
                        {isSubmittingFeedback ? "SUBMITTING..." : "SUBMIT SCORECARD"}
                      </button>
                    </form>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-slate-500 font-mono text-xs text-center uppercase tracking-widest">
                SELECT A ACTIVE CANDIDATE RECORD TO INITIATE METRIC VERIFICATIONS AND AI EVALUATIONS.
              </div>
            )}
          </div>
        )}

        {activeTab === "rankings" && (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Rankings subheader */}
            <div className="px-6 py-5 border-b border-outline bg-surface sticky top-0 z-10">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <div className="text-[10px] text-primary font-mono font-bold uppercase tracking-widest flex items-center gap-1.5">
                    <Briefcase className="w-3.5 h-3.5" />
                    DEPT // MERIT ENGINE
                  </div>
                  <h1 className="massive-text text-xl text-slate-900 mt-1.5 uppercase font-black tracking-tight">
                    {selectedJobObj ? selectedJobObj.title : "SELECT RECRUITMENT TYPE"}
                  </h1>
                  <p className="text-xs text-slate-500 font-mono uppercase tracking-wider mt-1">
                    {selectedJobObj 
                      ? `${selectedJobObj.location} • Status: ${selectedJobObj.status} • Filed: ${selectedJobObj.createdDate}`
                      : "Choose a target recruitment to run automated rank algorithms."}
                  </p>
                </div>

                <div className="flex items-center gap-2.5">
                  <div className="relative min-w-[200px]">
                    <select 
                      id="rankings-job-selector"
                      value={selectedJobId || ""}
                      onChange={(e) => setSelectedJobId(e.target.value)}
                      className="w-full bg-white border border-slate-200 rounded-none py-2 pl-3 pr-8 text-xs text-slate-800 focus:border-primary cursor-pointer font-mono uppercase"
                    >
                      <option value="" disabled>Choose target job...</option>
                      {jobs.map(j => (
                        <option key={j.id} value={j.id}>{j.title}</option>
                      ))}
                    </select>
                  </div>

                  {selectedJobId && (
                    <button 
                      id="run-matching-btn"
                      onClick={handleRunMatching}
                      disabled={isMatchingRunning}
                      className="bg-primary text-white px-5 py-2.5 rounded-none font-bold text-xs uppercase tracking-wider hover:bg-blue-600 transition-all border border-primary/20 flex items-center gap-1.5 cursor-pointer"
                    >
                      <Cpu className={`w-3.5 h-3.5 ${isMatchingRunning ? "animate-spin" : ""}`} />
                      {isMatchingRunning ? "RUNNING MATCH ENGINE..." : "RUN ALIGNMENT"}
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Candidates Ranked list */}
            <div className="flex-1 overflow-auto p-6 space-y-4">
              {selectedJobId ? (
                <div className="space-y-4 max-w-4xl">
                  <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                    <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest font-mono">
                      RANKED TALENT MATRIX ({candidates.filter(c => c.jobId === selectedJobId).length} CANDIDATES)
                    </h2>
                    <span className="text-[10px] text-slate-500 font-mono uppercase">Sorted by AI Alignment Score</span>
                  </div>

                  {candidates.filter(c => c.jobId === selectedJobId).length === 0 ? (
                    <div className="p-8 bg-surface border border-outline rounded-none text-center text-slate-500 text-xs font-mono">
                      <p>No candidates have applied for this job yet. Candidates apply through the Candidate Portal.</p>
                    </div>
                  ) : (
                    <div className="space-y-3 font-sans">
                      {candidates
                        .filter(c => c.jobId === selectedJobId)
                        .sort((a, b) => b.fitScore - a.fitScore)
                        .map((cand, idx) => (
                          <CandidateRow 
                            key={cand.id} 
                            cand={cand} 
                            idx={idx} 
                            handleViewCandidateProfile={handleViewCandidateProfile} 
                          />
                        ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-8 text-center text-slate-500 font-mono text-xs uppercase tracking-widest">
                  SELECT A WORK RECORD TO ANALYZE REAL-TIME MERIT-BASED CANDIDATE RANKINGS.
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "audit" && (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Audit Log Header */}
            <div className="px-6 py-5 border-b border-outline bg-surface sticky top-0 z-10">
              <h1 className="massive-text text-xl font-black text-slate-900 uppercase tracking-tight">Compliance Audit Trail</h1>
              <p className="text-xs text-slate-500 font-mono uppercase tracking-wider mt-1">
                Every action containing candidate unredaction and identity access is cryptographically logged to this ledger.
              </p>
            </div>

            {/* Logs List */}
            <div className="flex-1 overflow-auto p-6">
              <div className="bg-surface border border-outline rounded-none overflow-hidden max-w-5xl">
                <table className="w-full text-left border-collapse">
                  <thead className="bg-slate-100 text-slate-600 border-b border-outline font-mono">
                    <tr>
                      <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-widest">Timestamp</th>
                      <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-widest">Actor</th>
                      <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-widest">Action</th>
                      <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-widest">Target</th>
                      <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-widest">Details Log</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {auditLogs.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-center text-slate-500 text-xs font-mono uppercase tracking-widest">
                          NO AUDIT EVENTS DEPOSITED YET.
                        </td>
                      </tr>
                    ) : (
                      auditLogs.map((log) => (
                        <tr key={log.id} className="hover:bg-slate-50 transition-colors text-xs font-mono text-slate-700">
                          <td className="px-4 py-3 text-[11px] text-slate-500 font-mono shrink-0">
                            {new Date(log.timestamp).toLocaleString()}
                          </td>
                          <td className="px-4 py-3 font-bold text-slate-900 uppercase">{log.actor}</td>
                          <td className="px-4 py-3">
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-none text-[9px] font-bold uppercase tracking-widest bg-red-50 border border-red-200 text-red-700 font-mono">
                              {log.action}
                            </span>
                          </td>
                          <td className="px-4 py-3 font-bold text-slate-700">{log.candidateAlias}</td>
                          <td className="px-4 py-3 text-slate-600 font-sans max-w-xs truncate" title={log.details}>
                            {log.details}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* MODAL 1: Create New Job Listing */}
      <AnimatePresence>
        {isNewJobModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm" id="new-job-modal">
            <motion.div 
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              className="bg-surface w-full max-w-2xl rounded-none border border-outline mx-4 overflow-hidden"
            >
              <div className="px-6 py-4 border-b border-outline flex justify-between items-center bg-slate-100">
                <h2 className="font-extrabold text-sm text-slate-900 uppercase tracking-wider font-mono">CREATE JOB RECRUITMENT</h2>
                <button 
                  onClick={() => setIsNewJobModalOpen(false)}
                  className="text-slate-500 hover:text-slate-800 font-bold text-lg cursor-pointer"
                >
                  [ X ]
                </button>
              </div>

              <form onSubmit={handleCreateJob}>
                <div className="p-6 space-y-4 overflow-y-auto max-h-[70vh] font-mono text-xs">
                   <div className="space-y-1">
                    <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Job Title</label>
                    <input 
                      id="job-title-input"
                      required
                      placeholder="e.g. Senior Software Engineer"
                      value={newJobTitle}
                      onChange={(e) => setNewJobTitle(e.target.value)}
                      className="w-full bg-white border border-slate-200 rounded-none py-2 px-3 text-xs text-slate-800 focus:border-primary font-sans"
                      type="text"
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Department Code</label>
                      <input 
                        id="job-dept-input"
                        placeholder="e.g. PRODUCT-04"
                        value={newJobDept}
                        onChange={(e) => setNewJobDept(e.target.value)}
                        className="w-full bg-white border border-slate-200 rounded-none py-2 px-3 text-xs text-slate-800 focus:border-primary font-sans"
                        type="text"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Salary Metric</label>
                      <input 
                        id="job-salary-input"
                        placeholder="e.g. $140k - $180k"
                        value={newJobSalary}
                        onChange={(e) => setNewJobSalary(e.target.value)}
                        className="w-full bg-white border border-slate-200 rounded-none py-2 px-3 text-xs text-slate-800 focus:border-primary font-sans"
                        type="text"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Target Role Profile</label>
                    <textarea 
                      id="job-desc-input"
                      required
                      rows={3}
                      placeholder="Describe the role, responsibilities, and key deliverables..."
                      value={newJobDesc}
                      onChange={(e) => setNewJobDesc(e.target.value)}
                      className="w-full bg-white border border-slate-200 rounded-none py-2 px-3 text-xs text-slate-800 focus:border-primary font-sans"
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Seniority Bracket</label>
                      <select 
                        id="job-exp-select"
                        value={newJobExp}
                        onChange={(e) => setNewJobExp(e.target.value)}
                        className="w-full bg-white border border-slate-200 rounded-none py-2 px-3 text-xs text-slate-800 focus:border-primary cursor-pointer uppercase"
                      >
                        <option>Entry Level (0-2 years)</option>
                        <option>Mid-Level (3-5 years)</option>
                        <option>Senior (6-10 years)</option>
                        <option>Lead/Director (10+ years)</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Required Education</label>
                      <select 
                        id="job-edu-select"
                        value={newJobEdu}
                        onChange={(e) => setNewJobEdu(e.target.value)}
                        className="w-full bg-white border border-slate-200 rounded-none py-2 px-3 text-xs text-slate-800 focus:border-primary cursor-pointer uppercase"
                      >
                        <option>No Degree Required</option>
                        <option>Bachelor's Degree</option>
                        <option>Master's Degree</option>
                        <option>PhD / Doctorate</option>
                      </select>
                    </div>
                  </div>

                  {/* Skills input list */}
                  <div className="space-y-1.5">
                    <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Required Skill Matrix</label>
                    <div className="flex flex-wrap gap-1.5 p-2 border border-slate-200 rounded-none bg-slate-50">
                      {newJobSkills.map((skill) => (
                        <span 
                          key={skill}
                          className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-100 border border-slate-200 text-slate-700 rounded-none text-[10px] font-bold uppercase"
                        >
                          {skill}
                          <button 
                            type="button" 
                            onClick={() => handleRemoveSkill(skill)}
                            className="text-primary hover:text-slate-900 font-bold ml-1"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                      <div className="flex-1 min-w-[120px] flex gap-1 font-sans">
                        <input 
                          id="skill-add-input"
                          value={skillInput}
                          onChange={(e) => setSkillInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              handleAddSkill();
                            }
                          }}
                          placeholder="Type and press Enter..."
                          className="bg-transparent border-none focus:outline-none text-xs flex-1 text-slate-800"
                          type="text" 
                        />
                        <button 
                          type="button"
                          onClick={handleAddSkill}
                          className="bg-slate-200 text-slate-800 px-2.5 rounded-none text-[9px] font-bold uppercase tracking-wider"
                        >
                          ADD
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="px-6 py-4 border-t border-outline flex justify-end gap-3 bg-slate-100/50">
                  <button 
                    type="button" 
                    onClick={() => setIsNewJobModalOpen(false)}
                    className="px-4 py-2 text-xs text-slate-500 hover:text-slate-800 rounded-none font-bold uppercase tracking-wider transition-all cursor-pointer"
                  >
                    CANCEL
                  </button>
                  <button 
                    id="submit-create-job"
                    type="submit"
                    className="bg-primary text-white px-5 py-2.5 rounded-none font-bold text-xs uppercase tracking-wider hover:bg-blue-600 transition-all border border-primary/20 cursor-pointer"
                  >
                    CREATE RECRUITMENT
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MODAL 2: Upload Simulated Resume (Direct text upload) */}
      <AnimatePresence>
        {isUploadModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              className="bg-surface w-full max-w-xl rounded-none border border-outline mx-4 overflow-hidden"
            >
              <div className="px-6 py-4 border-b border-outline flex justify-between items-center bg-slate-100">
                <h2 className="font-extrabold text-sm text-slate-900 uppercase tracking-wider font-mono">UPLOAD RESUME TRANSCRIPT</h2>
                <button 
                  onClick={() => setIsUploadModalOpen(false)}
                  className="text-slate-500 hover:text-slate-800 font-bold text-lg cursor-pointer"
                >
                  [ X ]
                </button>
              </div>

              <form onSubmit={handleUploadResume}>
                <div className="p-6 space-y-4">
                  <div className="p-4 bg-blue-50 border border-blue-200 rounded-none flex gap-3 text-xs text-primary leading-relaxed font-mono">
                    <Cpu className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                    <div>
                      <p className="font-extrabold uppercase tracking-wider">AI SANITIZATION PIPELINE ACTIVE</p>
                      <p className="text-[10px] text-slate-600 mt-1 font-sans">
                        Copy-paste resume details. Our Gemini model will sanitize all PII (names, contact info, specific locations, and specific schools/conglomerate names) to guarantee a bias-free recruitment process.
                      </p>
                    </div>
                  </div>

                  <div className="space-y-1 font-mono text-xs">
                    <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Target Recruitment</label>
                    <select
                      id="upload-job-selector"
                      value={selectedJobId || ""}
                      onChange={(e) => setSelectedJobId(e.target.value)}
                      className="w-full bg-white border border-slate-200 rounded-none py-2 px-3 text-xs text-slate-800 focus:border-primary cursor-pointer uppercase"
                    >
                      <option value="" disabled>Choose target job...</option>
                      {jobs.map(j => (
                        <option key={j.id} value={j.id}>{j.title}</option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1 font-mono text-xs">
                    <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Paste Transcript Contents</label>
                    <textarea 
                      id="resume-text-textarea"
                      required={!selectedUploadFile}
                      rows={6}
                      placeholder="e.g. John Doe, software architect from Cupertino... Developed massive cloud systems for Apple. Fluent in React, AWS and Go."
                      value={resumeText}
                      onChange={(e) => setResumeText(e.target.value)}
                      className="w-full bg-white border border-slate-200 rounded-none p-3 text-xs font-mono focus:border-primary text-slate-800"
                    />
                  </div>

                  {/* Active File Upload Card */}
                  <label className="border border-slate-200 border-dashed rounded-none p-4 text-center bg-slate-50 space-y-1 block cursor-pointer hover:bg-slate-100 transition-colors">
                    <input 
                      type="file" 
                      accept=".pdf,.docx" 
                      onChange={(e) => setSelectedUploadFile(e.target.files?.[0] || null)} 
                      className="hidden" 
                    />
                    <UploadCloud className="w-5 h-5 text-primary mx-auto" />
                    <p className="text-[11px] font-bold text-slate-800 uppercase tracking-wider font-mono">
                      {selectedUploadFile ? `Selected File: ${selectedUploadFile.name}` : "Attach Document (.PDF or .DOCX)"}
                    </p>
                    <p className="text-[9px] text-slate-400 font-mono">
                      {selectedUploadFile ? `${Math.round(selectedUploadFile.size / 1024)} KB ready.` : "Optional: Attach binary file instead of pasting text above."}
                    </p>
                  </label>
                </div>

                <div className="px-6 py-4 border-t border-outline flex justify-end gap-3 bg-slate-100/50">
                  <button 
                    type="button" 
                    onClick={() => setIsUploadModalOpen(false)}
                    className="px-4 py-2 text-xs text-slate-500 hover:text-slate-800 rounded-none font-bold uppercase tracking-wider transition-all cursor-pointer font-mono"
                  >
                    CANCEL
                  </button>
                  <button 
                    id="submit-parse-resume"
                    type="submit"
                    disabled={isParsingResume || !selectedJobId}
                    className="bg-primary text-white px-5 py-2.5 rounded-none font-bold text-xs uppercase tracking-wider hover:bg-blue-600 transition-all border border-primary/20 flex items-center gap-1.5 cursor-pointer font-mono"
                  >
                    {isParsingResume && <Cpu className="w-3.5 h-3.5 animate-spin" />}
                    {isParsingResume ? "COMPILING TRANSCRIPT..." : "SANITIZE & UPLOAD"}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}

        {/* PDF Resume Viewer Modal */}
        {pdfModalCandidate && (
          <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-4 lg:p-8">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-xl shadow-2xl w-full max-w-5xl h-[88vh] flex flex-col overflow-hidden border border-slate-200"
            >
              {/* Modal Header */}
              <div className="flex items-center justify-between px-6 py-3.5 border-b border-slate-200 bg-white shrink-0">
                <div className="flex items-center gap-2.5 font-sans font-bold text-slate-800 text-sm">
                  <FileText className="w-5 h-5 text-slate-600 shrink-0" />
                  <span>{pdfModalCandidate.cand.alias}_resume.pdf</span>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => window.open(pdfModalCandidate.blobUrl, "_blank")}
                    className="flex items-center gap-2 bg-slate-950 hover:bg-black text-white px-4 py-2 rounded-lg text-xs font-bold font-sans shadow cursor-pointer transition-all"
                  >
                    <ExternalLink className="w-4 h-4" />
                    Open in New Tab
                  </button>
                  <button
                    onClick={() => setPdfModalCandidate(null)}
                    className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer transition-all"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* PDF Viewer Body */}
              <div className="flex-1 bg-slate-100 p-4 overflow-hidden flex flex-col">
                <iframe
                  src={pdfModalCandidate.blobUrl}
                  className="w-full flex-1 rounded-lg shadow-md border border-slate-300 bg-white"
                  title="Candidate Resume PDF Viewer"
                />
              </div>
            </motion.div>
          </div>
        )}

        {/* Update Job Status Modal */}
        {statusModalJob && (
          <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white border border-slate-200 shadow-2xl rounded-none w-full max-w-md overflow-hidden"
            >
              <div className="px-6 py-4 bg-slate-900 text-white flex justify-between items-center border-b border-slate-800">
                <div className="flex items-center gap-2 font-mono text-xs font-bold tracking-wider uppercase">
                  <Settings className="w-4 h-4 text-primary" />
                  UPDATE STATUS // {statusModalJob.title}
                </div>
                <button onClick={() => setStatusModalJob(null)} className="text-slate-400 hover:text-white cursor-pointer">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-6 space-y-4">
                <p className="text-xs text-slate-600 leading-relaxed">
                  Select the new operational status for this listing. Listings in <strong>DRAFT</strong> or <strong>CLOSED</strong> status will no longer accept candidate applications on the portal.
                </p>

                <div className="space-y-2.5 pt-2">
                  <button
                    type="button"
                    disabled={updatingStatus}
                    onClick={() => handleUpdateJobStatus(statusModalJob.id, "OPEN")}
                    className={`w-full text-left p-3.5 border flex items-center justify-between transition-all cursor-pointer ${
                      statusModalJob.status === "OPEN"
                        ? "bg-emerald-50/80 border-emerald-500 ring-1 ring-emerald-500"
                        : "bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    <div>
                      <div className="flex items-center gap-2 font-mono font-bold text-xs text-slate-900 uppercase">
                        <span className="w-2 h-2 rounded-none bg-emerald-500"></span>
                        OPEN (ACTIVE)
                      </div>
                      <p className="text-[10px] text-slate-500 mt-0.5">Visible on portal. Accepting candidate applications.</p>
                    </div>
                    {statusModalJob.status === "OPEN" && <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />}
                  </button>

                  <button
                    type="button"
                    disabled={updatingStatus}
                    onClick={() => handleUpdateJobStatus(statusModalJob.id, "DRAFT")}
                    className={`w-full text-left p-3.5 border flex items-center justify-between transition-all cursor-pointer ${
                      statusModalJob.status === "DRAFT"
                        ? "bg-amber-50/80 border-amber-500 ring-1 ring-amber-500"
                        : "bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    <div>
                      <div className="flex items-center gap-2 font-mono font-bold text-xs text-slate-900 uppercase">
                        <span className="w-2 h-2 rounded-none bg-amber-500"></span>
                        DRAFT
                      </div>
                      <p className="text-[10px] text-slate-500 mt-0.5">Hidden from portal pipeline. No new submissions.</p>
                    </div>
                    {statusModalJob.status === "DRAFT" && <CheckCircle className="w-4 h-4 text-amber-600 shrink-0" />}
                  </button>

                  <button
                    type="button"
                    disabled={updatingStatus}
                    onClick={() => handleUpdateJobStatus(statusModalJob.id, "CLOSED")}
                    className={`w-full text-left p-3.5 border flex items-center justify-between transition-all cursor-pointer ${
                      statusModalJob.status === "CLOSED"
                        ? "bg-slate-100 border-slate-500 ring-1 ring-slate-500"
                        : "bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    <div>
                      <div className="flex items-center gap-2 font-mono font-bold text-xs text-slate-900 uppercase">
                        <span className="w-2 h-2 rounded-none bg-slate-500"></span>
                        CLOSED
                      </div>
                      <p className="text-[10px] text-slate-500 mt-0.5">Listing closed. Application portal locked.</p>
                    </div>
                    {statusModalJob.status === "CLOSED" && <CheckCircle className="w-4 h-4 text-slate-600 shrink-0" />}
                  </button>
                </div>
              </div>

              <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex justify-end">
                <button
                  type="button"
                  onClick={() => setStatusModalJob(null)}
                  className="px-4 py-2 bg-white border border-slate-200 text-slate-700 font-mono text-xs font-bold uppercase tracking-wider hover:bg-slate-100 cursor-pointer"
                >
                  CLOSE
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
