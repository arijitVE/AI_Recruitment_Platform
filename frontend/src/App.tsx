import React, { useState } from "react";
import { motion } from "motion/react";
import { ShieldCheck, User, Cpu } from "lucide-react";

import RecruiterDashboard from "./components/RecruiterDashboard";
import CandidateDashboard from "./components/CandidateDashboard";

export default function App() {
  const [portalMode, setPortalMode] = useState<"recruiter" | "candidate">("candidate");
  const [selectedJobId, setSelectedJobId] = useState<string | null>("job-1");
  // Track whether recruiter portal has ever been activated so we don't mount it at initial load
  // (avoids firing RecruiterDashboard's fetchData before the user visits it)
  const [recruiterMounted, setRecruiterMounted] = useState(false);

  const handleSwitchToRecruiter = () => {
    setRecruiterMounted(true);
    setPortalMode("recruiter");
  };
  const handleSwitchToCandidate = () => {
    setPortalMode("candidate");
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-background text-on-background select-none overflow-hidden font-sans">
      {/* Top Main Navigation Bar */}
      <header className="bg-surface border-b border-outline h-16 shrink-0 flex items-center justify-between px-6 z-30 shadow-none">
        {/* Brand Identity Section */}
        <div className="flex items-center gap-4">
          <div className="w-9 h-9 rounded-none bg-primary flex items-center justify-center border border-primary/20">
            <ShieldCheck className="text-white w-5 h-5" />
          </div>
          <div className="flex items-center gap-3">
            <span className="logo text-xl text-slate-900 tracking-tighter">NextHire</span>
            <div className="hidden sm:flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 text-emerald-700 text-[9px] font-bold px-2.5 py-1 rounded-none uppercase tracking-widest font-mono">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
              CORE // LIVE
            </div>
          </div>
        </div>

        {/* Global Mode Toggle Pill */}
        <div className="bg-slate-100 border border-slate-200 rounded-none p-1 flex items-center relative">
          <button 
            id="switch-to-candidate-mode"
            onClick={handleSwitchToCandidate}
            className={`relative px-4 py-1.5 text-xs font-bold uppercase tracking-wider rounded-none transition-colors cursor-pointer z-10 ${
              portalMode === "candidate" ? "text-white" : "text-slate-600 hover:text-slate-800"
            }`}
          >
            {portalMode === "candidate" && (
              <motion.div 
                layoutId="active-pill" 
                className="absolute inset-0 bg-primary rounded-none -z-10"
                transition={{ type: "spring", stiffness: 380, damping: 30 }}
              />
            )}
            CANDIDATE PORTAL
          </button>
          
          <button 
            id="switch-to-recruiter-mode"
            onClick={handleSwitchToRecruiter}
            className={`relative px-4 py-1.5 text-xs font-bold uppercase tracking-wider rounded-none transition-colors cursor-pointer z-10 ${
              portalMode === "recruiter" ? "text-white" : "text-slate-600 hover:text-slate-800"
            }`}
          >
            {portalMode === "recruiter" && (
              <motion.div 
                layoutId="active-pill" 
                className="absolute inset-0 bg-primary rounded-none -z-10"
                transition={{ type: "spring", stiffness: 380, damping: 30 }}
              />
            )}
            RECRUITER PORTAL
          </button>
        </div>

        {/* Quick Context / Integration Indicator */}
        <div className="flex items-center gap-3">
          <div className="hidden md:flex items-center gap-1.5 bg-blue-50 border border-blue-200 text-primary text-[10px] font-bold px-3 py-1 rounded-none uppercase tracking-widest font-mono">
            <Cpu className="w-3.5 h-3.5 text-primary" />
            SECURE.LOGS // SYSTEM_ALPHA
          </div>
          <div className="w-9 h-9 rounded-none bg-slate-100 border border-slate-200 flex items-center justify-center">
            <User className="text-slate-600 w-4 h-4" />
          </div>
        </div>
      </header>

      {/* Main Container — both portals stay mounted; toggled with CSS display */}
      <div className="flex-1 overflow-hidden flex flex-col relative">
        {/* Candidate Portal — always mounted after first load */}
        <div
          className="flex-1 flex flex-col overflow-hidden"
          style={{ display: portalMode === "candidate" ? "flex" : "none" }}
        >
          <CandidateDashboard 
            onSwitchToRecruiter={handleSwitchToRecruiter} 
            selectedJobId={selectedJobId}
            setSelectedJobId={setSelectedJobId}
          />
        </div>

        {/* Recruiter Portal — lazy-mounted on first visit, then kept alive */}
        {recruiterMounted && (
          <div
            className="flex-1 flex flex-col overflow-hidden"
            style={{ display: portalMode === "recruiter" ? "flex" : "none" }}
          >
            <RecruiterDashboard 
              onSwitchToCandidate={handleSwitchToCandidate} 
              selectedJobId={selectedJobId}
              setSelectedJobId={setSelectedJobId}
            />
          </div>
        )}
      </div>
    </div>
  );
}
