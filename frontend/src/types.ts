export interface Job {
  id: string;
  title: string;
  department: string;
  status: 'OPEN' | 'DRAFT' | 'CLOSED';
  candidatesCount: number;
  avgFit: number | null;
  createdDate: string;
  description: string;
  experience: string;
  education: string;
  skills: string[];
  salary: string;
  location: string;
  isVerifiedBiasFree?: boolean;
  isTopMatch?: boolean;
  isFeatured?: boolean;
  postedTime: string;
  company: string;
}

export interface WorkHistory {
  role: string;
  company: string;
  period: string;
  bullets: string[];
}

export interface CandidateFeedback {
  interviewer: string;
  score: number;
  notes: string;
  date: string;
}

export interface Candidate {
  id: string;
  jobId: string;
  alias: string;
  avatarInitials: string;
  isAnonymized: boolean;
  realName: string;
  realEmail: string;
  realPhone: string;
  realLocation: string;
  isUnredactedViewed: boolean;
  fitScore: number;
  skills: string[];
  workHistory: WorkHistory[];
  resumeText: string;
  appliedDate: string;
  status: 'Applied' | 'Interviewing' | 'Hired' | 'Rejected';
  matchRationale?: string;
  interviewQuestions?: string[];
  feedbacks?: CandidateFeedback[];
  recruiterNotes?: string;
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  candidateAlias: string;
  details: string;
}

export interface DashboardStats {
  activeJobsCount: number;
  totalApplicantsCount: number;
  avgFitPercent: number;
}
