import React, { useState, useEffect } from "react";
import { 
  Briefcase, 
  ChevronRight, 
  UploadCloud, 
  Sparkles, 
  ShieldCheck, 
  CheckCircle2, 
  HelpCircle, 
  Cpu, 
  Lock, 
  RefreshCw, 
  MapPin, 
  DollarSign, 
  UserCheck 
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { Job, Candidate } from "../types";
import { getJobs, getCandidates, uploadCandidateResume } from "../api";

interface CandidateDashboardProps {
  onSwitchToRecruiter: () => void;
  selectedJobId: string | null;
  setSelectedJobId: (id: string | null) => void;
}

export default function CandidateDashboard({
  onSwitchToRecruiter,
  selectedJobId,
  setSelectedJobId
}: CandidateDashboardProps) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  
  // App State
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [applicantName, setApplicantName] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  
  // Sanitizer Animation Pipeline States
  const [pipelineStage, setPipelineStage] = useState<"idle" | "submitting" | "scanning" | "done">("idle");
  const [scanningProgress, setScanningProgress] = useState(0);
  const [sanitizedPreview, setSanitizedPreview] = useState<any>(null);
  const [recentApplications, setRecentApplications] = useState<any[]>([]);

  useEffect(() => {
    // Fire both in parallel — getCandidates uses the batch endpoint (single request)
    Promise.all([fetchJobs(), loadRecentApplications()]);
  }, []);


  const fetchJobs = async () => {
    try {
      const data = await getJobs();
      const openJobs = data.filter((j: Job) => j.status?.toUpperCase() === "OPEN");
      setJobs(openJobs);
      if (openJobs.length > 0) {
        const target = selectedJobId ? openJobs.find((j: Job) => j.id === selectedJobId) : null;
        const jobToSelect = target || openJobs[0];
        setSelectedJob(jobToSelect);
        setSelectedJobId(jobToSelect.id);
      } else {
        setSelectedJob(null);
      }
    } catch (e) {
      console.error("Error fetching jobs:", e);
    } finally {
      setLoading(false);
    }
  };

  const loadRecentApplications = async () => {
    try {
      const data = await getCandidates();
      setRecentApplications(data);
    } catch (e) {
      console.error("Error loading candidate applications:", e);
    }
  };

  const handleSelectJob = (job: Job) => {
    setSelectedJob(job);
    setSelectedJobId(job.id);
  };

  const handleSubmitApplication = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile || !selectedJob) return;

    setPipelineStage("scanning");
    setScanningProgress(0);

    // Simulate real scanning laser animation progress
    const interval = setInterval(() => {
      setScanningProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval);
          return 100;
        }
        return prev + 15;
      });
    }, 250);

    try {
      const parsedCandidate = await uploadCandidateResume(selectedJob.id, {
        file: selectedFile || undefined,
        applicantName
      });

      if (parsedCandidate) {
        setSelectedJobId(selectedJob.id);
        setSanitizedPreview(parsedCandidate);
        
        // Wait for scanning simulation to finish
        setTimeout(() => {
          setPipelineStage("done");
          loadRecentApplications();
        }, 2000);
      } else {
        setPipelineStage("idle");
      }
    } catch (e) {
      console.error("Error submitting application:", e);
      setPipelineStage("idle");
    }
  };

  const handleApplyAnother = () => {
    setPipelineStage("idle");
    setSelectedFile(null);
    setApplicantName("");
    setSanitizedPreview(null);
  };

  return (
    <div className="flex-1 overflow-y-auto px-6 py-8 bg-background max-w-7xl mx-auto w-full space-y-8" id="candidate-dashboard-container">
      {/* Header card with Bold Typography styling */}
      <div className="bg-surface border border-outline rounded-none p-8 flex flex-col md:flex-row md:items-center justify-between gap-8 relative overflow-hidden">
        {/* Subtle decorative grid lines representing a blueprint */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#e2e8f0_1px,transparent_1px),linear-gradient(to_bottom,#e2e8f0_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] pointer-events-none opacity-40"></div>

        <div className="space-y-4 relative z-10 max-w-2xl">
          <div className="nav-meta text-[10px] text-primary tracking-widest flex items-center gap-2">
            <span className="w-2 h-2 bg-primary inline-block rounded-none animate-pulse"></span>
            SYSTEM PROTOCOL // ZERO_BIAS_PIPELINE
          </div>
          <h1 className="massive-text text-4xl sm:text-5xl md:text-6xl text-slate-900 tracking-tighter leading-none">
            EQUITABLE<br/><span className="text-primary">EVALUATION</span>
          </h1>
          <span className="item-label mt-1 block">Data Redaction // Powered by Gemini AI</span>
          <p className="text-sm text-slate-600 leading-relaxed font-medium">
            We actively strip away demographic variables, specific university names, and brand names from your profile using Gemini. Focus is placed strictly on your skills and actual achievements.
          </p>
        </div>

        <button 
          id="recruiter-switch-btn"
          onClick={onSwitchToRecruiter}
          className="bg-primary text-white hover:bg-blue-600 px-6 py-3 border border-primary/20 rounded-none font-bold text-xs uppercase tracking-wider transition-all shrink-0 active:scale-95 cursor-pointer self-start md:self-center relative z-10"
        >
          Access Recruiter Dashboard
        </button>
      </div>

      {/* Main Body Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left column - Job Selector */}
        <div className="lg:col-span-5 space-y-4">
          <h2 className="nav-meta text-xs uppercase tracking-widest text-slate-500 px-1 font-mono">AVAILABLE RECRUITMENTS</h2>
          {loading ? (
            <div className="p-8 text-center text-slate-500 font-mono text-xs border border-outline bg-surface">Loading listings...</div>
          ) : jobs.length === 0 ? (
            <div className="p-8 bg-surface border border-outline rounded-none text-center text-slate-500 text-xs font-mono">
              NO ACTIVE LISTINGS AVAILABLE AT THIS MOMENT.
            </div>
          ) : (
            <div className="space-y-4">
              {jobs.map((job) => (
                <div 
                  key={job.id}
                  onClick={() => handleSelectJob(job)}
                  className={`border p-6 cursor-pointer transition-all rounded-none ${
                    selectedJob?.id === job.id 
                      ? "bg-surface border-primary ring-1 ring-primary/20" 
                      : "bg-surface border-outline hover:border-slate-400"
                  }`}
                >
                  <div className="flex justify-between items-start gap-4">
                    <div>
                      <h3 className="font-extrabold text-base text-slate-900 tracking-tight uppercase">{job.title}</h3>
                      <p className="text-[10px] font-mono text-slate-500 uppercase tracking-widest mt-1">
                        DEPT: {job.department} • {job.company}
                      </p>
                    </div>
                    <span className="bg-primary/10 border border-primary/20 text-primary text-[10px] font-bold px-2.5 py-1 rounded-none tracking-widest font-mono">
                      {job.salary}
                    </span>
                  </div>

                  <div className="flex gap-4 mt-4 text-xs text-slate-600 font-mono">
                    <span className="flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-primary" />
                      {job.location}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Briefcase className="w-3.5 h-3.5 text-primary" />
                      {job.experience}
                    </span>
                  </div>

                  {/* Badges */}
                  <div className="flex gap-1.5 mt-4 flex-wrap">
                    {job.skills.slice(0, 3).map(s => (
                      <span key={s} className="px-2 py-0.5 bg-slate-100 border border-slate-200 rounded-none text-[9px] font-mono uppercase text-slate-600 tracking-wider">
                        {s}
                      </span>
                    ))}
                    {job.skills.length > 3 && (
                      <span className="px-2 py-0.5 bg-slate-100 border border-slate-200 rounded-none text-[9px] font-mono text-slate-600">
                        +{job.skills.length - 3} MORE
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right column - Application flow */}
        <div className="lg:col-span-7">
          <AnimatePresence mode="wait">
            {pipelineStage === "idle" && !selectedJob && (
              <motion.div 
                key="no-job-selected"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                className="bg-surface border border-outline rounded-none p-10 text-center space-y-4 shadow-none"
              >
                <div className="w-12 h-12 bg-slate-100 border border-slate-200 mx-auto flex items-center justify-center">
                  <Lock className="w-6 h-6 text-slate-400" />
                </div>
                <h3 className="font-extrabold text-base text-slate-900 uppercase tracking-tight">No Active Listing Selected</h3>
                <p className="text-xs text-slate-500 max-w-md mx-auto leading-relaxed font-mono">
                  Please choose an active job opening from the list on the left. Positions in DRAFT or CLOSED status do not accept candidate applications.
                </p>
              </motion.div>
            )}

            {pipelineStage === "idle" && selectedJob && (
              <motion.div 
                key="application-form"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                className="bg-surface border border-outline rounded-none p-6 space-y-6 shadow-none"
              >
                <div>
                  <h2 className="text-xl font-extrabold text-slate-900 uppercase tracking-tight">Apply for: {selectedJob.title}</h2>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                    Complete the details below. Once submitted, our real-time AI Sanitization engine will scrub all demographic pointers, pedigree markers, and specific brands.
                  </p>
                </div>

                <form onSubmit={handleSubmitApplication} className="space-y-5">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest font-mono">Your Full Name</label>
                    <input 
                      id="applicant-name-input"
                      required
                      placeholder="e.g. Johnathan Mercer"
                      value={applicantName}
                      onChange={(e) => setApplicantName(e.target.value)}
                      className="w-full bg-white border border-slate-200 rounded-none py-3 px-4 text-xs text-slate-800 focus:outline-none focus:border-primary font-sans focus:ring-1 focus:ring-primary/20"
                      type="text" 
                    />
                  </div>

                  {/* Active File Upload Card */}
                  <label className="border border-slate-200 border-dashed rounded-none p-5 text-center bg-slate-50 space-y-1 block cursor-pointer hover:bg-slate-100 transition-colors">
                    <input 
                      type="file" 
                      required
                      accept=".pdf,.docx" 
                      onChange={(e) => setSelectedFile(e.target.files?.[0] || null)} 
                      className="hidden" 
                    />
                    <UploadCloud className="w-6 h-6 text-primary mx-auto" />
                    <p className="text-xs font-bold text-slate-800 uppercase tracking-wider font-mono">
                      {selectedFile ? `Selected File: ${selectedFile.name}` : "Upload Resume (.PDF or .DOCX)"}
                    </p>
                    <p className="text-[10px] text-slate-400 font-mono">
                      {selectedFile ? `${Math.round(selectedFile.size / 1024)} KB ready for upload.` : "Select your formatted CV document in PDF or Word format."}
                    </p>
                  </label>

                  <div className="flex justify-end pt-2">
                    <button 
                      id="submit-cand-app-btn"
                      type="submit"
                      className="bg-primary text-white px-6 py-3.5 rounded-none font-bold text-xs uppercase tracking-wider hover:bg-blue-600 transition-all flex items-center gap-2 cursor-pointer border border-primary/20"
                    >
                      <Sparkles className="w-4 h-4" />
                      SUBMIT APPLICATION
                    </button>
                  </div>
                </form>
              </motion.div>
            )}

            {pipelineStage === "scanning" && (
              <motion.div 
                key="scanning-state"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                className="bg-surface border border-outline rounded-none p-8 text-center flex flex-col items-center justify-center space-y-6 shadow-none min-h-[400px] overflow-hidden relative"
              >
                {/* Simulated Scanning Laser effect */}
                <div className="absolute top-0 left-0 right-0 h-1 bg-primary/80 shadow-[0_0_15px_#2563eb] animate-bounce"></div>

                <div className="w-16 h-16 bg-slate-50 border border-slate-200 rounded-none flex items-center justify-center text-primary relative">
                  <Cpu className="w-8 h-8 text-primary animate-spin" />
                </div>

                <div className="space-y-2">
                  <h3 className="text-lg font-extrabold text-slate-900 uppercase tracking-wider font-mono">AI ANONYMIZER ACTIVE</h3>
                  <p className="text-xs text-slate-500 max-w-sm mx-auto leading-relaxed font-mono">
                    Scrubbing names, contact variables, university names, and brands to construct a fully compliance-safe dossier...
                  </p>
                </div>

                {/* Progress bar */}
                <div className="w-full max-w-xs space-y-2">
                  <div className="w-full h-1 bg-slate-100 rounded-none overflow-hidden border border-slate-200">
                    <div 
                      className="h-full bg-primary transition-all duration-300" 
                      style={{ width: `${scanningProgress}%` }}
                    ></div>
                  </div>
                  <span className="font-mono text-[10px] text-slate-400 tracking-widest uppercase">{scanningProgress}% COMPLETED</span>
                </div>
              </motion.div>
            )}

            {pipelineStage === "done" && sanitizedPreview && (
              <motion.div 
                key="done-state"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                className="bg-surface border border-outline rounded-none p-6 space-y-6 shadow-none"
              >
                <div className="flex items-center gap-4 border-b border-outline pb-4">
                  <div className="w-12 h-12 bg-green-50 border border-green-200 text-green-600 flex items-center justify-center rounded-none shrink-0">
                    <ShieldCheck className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="text-lg font-extrabold text-slate-900 uppercase tracking-tight">Application Anonymized Successfully</h2>
                    <p className="text-xs text-slate-500 font-mono">IDENTITY LOCKED. PROFILE TRANSMITTED COMPLIANTLY.</p>
                  </div>
                </div>

                <div className="space-y-4">
                  {/* Alias details */}
                  <div className="flex items-center justify-between p-4 bg-slate-50 border border-slate-200 rounded-none">
                    <div className="flex items-center gap-2">
                      <Lock className="w-4 h-4 text-primary shrink-0" />
                      <span className="text-xs font-bold text-slate-500 uppercase tracking-widest font-mono">Compliance Alias Assigned:</span>
                    </div>
                    <span className="font-mono text-xs font-bold text-primary bg-primary/10 border border-primary/20 px-3 py-1 rounded-none uppercase tracking-widest">
                      {sanitizedPreview.alias}
                    </span>
                  </div>

                  <div className="space-y-3">
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest font-mono">Sanitized Employment Records</p>
                    {sanitizedPreview.workHistory?.map((work: any, idx: number) => (
                      <div key={idx} className="p-4 border border-slate-200 bg-slate-50/50 rounded-none space-y-2">
                        <div className="flex justify-between text-xs font-extrabold text-slate-900 uppercase">
                          <h4>{work.role}</h4>
                          <span className="text-slate-500 font-normal font-mono text-[10px]">{work.period}</span>
                        </div>
                        {/* Redacted Brand Tag */}
                        <div className="flex items-center gap-1.5 text-[10px] text-green-600 font-bold uppercase tracking-widest font-mono">
                          <CheckCircle2 className="w-3.5 h-3.5 animate-pulse" />
                          <span>Redacted Brand: {work.company}</span>
                        </div>
                        <ul className="list-disc list-outside ml-4 text-xs text-slate-600 space-y-1.5 leading-relaxed font-sans">
                          {work.bullets?.map((b: string, bidx: number) => (
                            <li key={bidx}>{b}</li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>

                  <div className="space-y-2">
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest font-mono">Scrubbed Technical Skillsets</p>
                    <div className="flex flex-wrap gap-1.5">
                      {sanitizedPreview.skills?.map((s: string, sidx: number) => (
                        <span key={sidx} className="px-2.5 py-1 bg-slate-100 border border-slate-200 rounded-none font-mono text-xs text-slate-700">
                          {s}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="flex justify-between items-center pt-4 border-t border-outline">
                  <div className="flex items-center gap-2 text-[10px] font-mono text-slate-500 uppercase tracking-widest">
                    <UserCheck className="w-4 h-4 text-green-600" />
                    <span>Compliance Certified</span>
                  </div>
                  <button 
                    onClick={handleApplyAnother}
                    className="bg-primary text-white px-5 py-2.5 rounded-none font-bold text-xs uppercase tracking-wider hover:bg-blue-600 transition-all flex items-center gap-2 cursor-pointer border border-primary/20"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    APPLY ANOTHER
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Interactive FAQ / Compliance standards footer */}
      <div className="border border-outline rounded-none p-8 bg-surface grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="space-y-2">
          <h4 className="font-extrabold text-sm text-slate-950 flex items-center gap-2 uppercase tracking-wide">
            <ShieldCheck className="w-4 h-4 text-primary" />
            100% Anonymized Pipeline
          </h4>
          <p className="text-xs text-slate-600 leading-relaxed font-sans">
            Your name, contact credentials, physical coordinates, and corporate associations are strictly isolated until final recruiter-unredaction authorization.
          </p>
        </div>
        <div className="space-y-2">
          <h4 className="font-extrabold text-sm text-slate-950 flex items-center gap-2 uppercase tracking-wide">
            <Cpu className="w-4 h-4 text-primary" />
            Gemini Verification
          </h4>
          <p className="text-xs text-slate-600 leading-relaxed font-sans">
            Leveraging native Gemini logic, candidate resumes are cross-referenced purely against functional merit vectors.
          </p>
        </div>
        <div className="space-y-2">
          <h4 className="font-extrabold text-sm text-slate-950 flex items-center gap-2 uppercase tracking-wide">
            <Lock className="w-4 h-4 text-primary" />
            Immutable Audits
          </h4>
          <p className="text-xs text-slate-600 leading-relaxed font-sans">
            Recruiter unredactions are instantly and permanently recorded into our tamper-proof compliance logs, maintaining absolute accountability.
          </p>
        </div>
      </div>
    </div>
  );
}
