import { useState, useEffect } from 'react';
import {
  LuDownload,
  LuArrowRight,
  LuShieldCheck,
  LuGlobe,
  LuAudioLines,
  LuAppWindow,
  LuFileText,
  LuCpu,
  LuCheck,
  LuX,
  LuMic,
  LuClock,
  LuSparkles,
  LuZap,
  LuMonitor,
} from 'react-icons/lu';

const DEMO_SCENARIOS = [
  {
    cmd: '"Hey Jeeva, Notepad mein likho aaj 5 baje meeting hai"',
    badge: 'Local Engine · 0 API · 14ms',
    reply: 'Notepad khol kar text type kar diya hai.',
    state: 'SPEAKING',
  },
  {
    cmd: '"5 December ko shaam 6 baje client call yaad dilana"',
    badge: '90-Day Scheduler · 30m Early Alert',
    reply: 'Saved for 5 Dec 6:00 PM. 30 min pehle bhi alert milega.',
    state: 'SAVED',
  },
  {
    cmd: '"Desktop par notes.pdf hai isko summarize karo aur sunao"',
    badge: 'Offline PDF Brain · Indian Voice',
    reply: '3 key points extracted locally — reading aloud in Indian English.',
    state: 'NARRATING',
  },
  {
    cmd: '"YouTube fullscreen karo aur VS Code terminal kholo"',
    badge: 'Multi-App Voice Control · 0 API',
    reply: 'YouTube fullscreen kiya aur VS Code terminal open kar diya.',
    state: 'EXECUTED',
  },
];

export default function LandingPage({
  installerUrl,
  canInstallPWA,
  onInstallPWA,
  onEnterWorkspace,
}) {
  const [showDownloadGuide, setShowDownloadGuide] = useState(false);
  const [demoIdx, setDemoIdx] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setDemoIdx((prev) => (prev + 1) % DEMO_SCENARIOS.length);
    }, 4200);
    return () => clearInterval(id);
  }, []);

  const activeDemo = DEMO_SCENARIOS[demoIdx];

  const handleDownloadExe = () => {
    if (installerUrl) {
      window.open(installerUrl, '_blank', 'noopener,noreferrer');
    } else {
      setShowDownloadGuide(true);
    }
  };

  const features = [
    {
      icon: LuCpu,
      tag: '0 API COST',
      title: 'Own Hybrid Local Brain',
      desc: 'Runs PC commands, typing, reminders, file search, and digital PDFs in <30ms locally — with optional Qwen 2.5 / Gemma 3 on-device SLM.',
      accent: 'text-emerald-400',
    },
    {
      icon: LuMic,
      tag: 'ALWAYS READY',
      title: 'Camera Notch Dynamic Island',
      desc: 'Stays ultralight in standby near your camera bezel. Hover for Mic, inline Quick Chat, Full Chat, or PC Dashboard anytime.',
      accent: 'text-sky-400',
    },
    {
      icon: LuClock,
      tag: '90-DAY MEMORY',
      title: 'Smart Date & Missed Catch-Up',
      desc: 'Schedule months ahead by voice. Alerts you 30 minutes early and catches missed tasks automatically when you turn your PC back on.',
      accent: 'text-amber-400',
    },
    {
      icon: LuAppWindow,
      tag: '39 PC TOOLS',
      title: 'VS Code, GitHub, Chrome & YouTube',
      desc: 'Launch apps, type anywhere, run git status/pull/push, open VS Code terminal, control YouTube playback, or browse Chrome hands-free.',
      accent: 'text-violet-400',
    },
    {
      icon: LuFileText,
      tag: 'OFFLINE DOCS + OCR',
      title: 'Voice PDF & Screen Reader',
      desc: 'Say any file path on Desktop or Downloads to read or summarize PDFs offline, plus read & click visible screen buttons via Windows OCR.',
      accent: 'text-emerald-300',
    },
    {
      icon: LuAudioLines,
      tag: 'INSTANT STREAMING',
      title: 'Indian-Style Zero-Lag Voice',
      desc: 'Begins speaking on the very first sentence (<25ms) in crisp Indian English, Hindi, or Hinglish — with real-time voice barge-in.',
      accent: 'text-sky-300',
    },
  ];

  const steps = [
    {
      num: '01',
      title: '1-Click Setup & Auto-Boot',
      desc: 'Pick your Assistant Name, custom Voice Wake Phrase, and Start with Windows right inside onboarding — no API key required to start.',
    },
    {
      num: '02',
      title: 'Command-First Local Lock',
      desc: 'Everyday PC commands never burn cloud quota. Only visual inspection, live web queries, or heavy coding escalate to Gemini Cloud.',
    },
    {
      num: '03',
      title: 'Control From Anywhere',
      desc: 'Use the Camera Notch on your desktop or pair your phone over Render HTTPS Relay with isolated per-device Pair Keys.',
    },
  ];

  return (
    <div className="min-h-screen bg-[#07080c] text-zinc-100 flex flex-col relative overflow-x-hidden">
      {/* Futuristic Animated Backdrop */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute inset-0 bg-jeeva-grid opacity-55" />
        <div className="absolute -top-32 left-1/4 w-[460px] h-[460px] rounded-full bg-emerald-500/15 blur-[120px] animate-jeeva-float" />
        <div className="absolute top-1/3 -right-24 w-[420px] h-[420px] rounded-full bg-sky-500/15 blur-[120px] animate-jeeva-float-slow" />
        <div className="absolute bottom-0 left-1/3 w-[380px] h-[380px] rounded-full bg-violet-500/10 blur-[130px]" />
      </div>

      {/* Top Navbar */}
      <header className="border-b border-white/10 bg-[#090a0f]/75 backdrop-blur-xl sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-15 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="relative group flex items-center justify-center w-9 h-9 rounded-xl shadow-lg shadow-emerald-500/20">
              <div className="absolute -inset-0.5 rounded-xl bg-gradient-to-br from-emerald-400/50 via-sky-400/40 to-violet-500/50 blur-sm opacity-75 group-hover:opacity-100 transition-opacity" />
              <img
                src="./icon.svg"
                alt="JEEVA AI Logo"
                className="relative w-9 h-9 rounded-xl"
              />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold tracking-tight text-white">JEEVA <span className="text-gradient-futuristic">AI</span></span>
                <span className="hidden sm:inline-flex items-center gap-1 text-[10px] font-mono text-emerald-300 bg-emerald-500/10 border border-emerald-500/25 px-2 py-0.5 rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  HYBRID OS AGENT
                </span>
              </div>
              <p className="text-[10px] font-mono text-zinc-500 hidden sm:block leading-none mt-0.5">
                by WebBuildix · webbuildix.online
              </p>
            </div>
          </div>

          <nav className="hidden md:flex items-center gap-6 text-xs text-zinc-400">
            <a href="#features" className="hover:text-white transition-colors">
              Capabilities
            </a>
            <a href="#how-it-works" className="hover:text-white transition-colors">
              Architecture
            </a>
            <a href="#hosting" className="hover:text-white transition-colors">
              Privacy &amp; Security
            </a>
          </nav>

          <div className="flex items-center gap-2">
            {canInstallPWA && (
              <button
                onClick={onInstallPWA}
                className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs text-zinc-200 transition-colors"
              >
                Install App
              </button>
            )}
            <button
              onClick={onEnterWorkspace}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-gradient-to-r from-emerald-400 to-sky-400 text-zinc-950 text-xs font-semibold hover:brightness-110 transition-all shadow-md shadow-emerald-500/20"
            >
              Open Workspace
              <LuArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 pt-14 pb-16 w-full">
        <div className="max-w-3xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-white/5 border border-emerald-500/30 text-[11px] font-mono text-emerald-300 mb-6 backdrop-blur">
            <LuSparkles className="w-3.5 h-3.5 text-emerald-400" />
            <span>ZERO-API LOCAL COMMANDS · CAMERA NOTCH UI · CLOUD VISION</span>
          </div>

          <h1 className="text-3xl sm:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.08] mb-5 text-gradient-futuristic">
            Your Autonomous Voice &amp; PC Intelligence
          </h1>

          <p className="text-sm sm:text-base text-zinc-400 max-w-2xl mx-auto leading-relaxed mb-8">
            Speak naturally in Hindi, Hinglish, or English. JEEVA runs Windows apps, types anywhere, reads PDFs &amp; your screen offline, remembers tasks for 90 days, and switches to Gemini Cloud only for heavy vision or live web queries.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-3 mb-12">
            <button
              onClick={handleDownloadExe}
              className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-white text-zinc-950 text-sm font-semibold hover:bg-zinc-200 transition-all shadow-lg shadow-white/10"
            >
              <LuDownload className="w-4 h-4" />
              Download Windows (.exe)
            </button>
            <button
              onClick={onEnterWorkspace}
              className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/15 text-sm font-medium text-white backdrop-blur transition-all"
            >
              <LuGlobe className="w-4 h-4 text-sky-400" />
              Launch Web Workspace
            </button>
          </div>
        </div>

        {/* Interactive Futuristic Camera Notch Live Demo */}
        <div className="max-w-2xl mx-auto">
          <div className="rounded-3xl bg-[#0e1017]/90 border border-white/15 p-5 sm:p-6 shadow-2xl shadow-emerald-950/30 backdrop-blur-xl">
            <div className="flex items-center justify-between gap-2 pb-4 mb-4 border-b border-white/10">
              <div className="flex items-center gap-2.5">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse shadow-sm shadow-emerald-400" />
                <span className="text-[11px] font-mono tracking-wider uppercase text-zinc-300">
                  Live Camera Notch Preview
                </span>
              </div>
              <span className="text-[10px] font-mono px-2.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300">
                {activeDemo.badge}
              </span>
            </div>

            <div className="flex items-center gap-4">
              {/* Animated 5-bar waveform */}
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-sky-500/20 border border-emerald-400/35 flex items-center justify-center gap-1 flex-shrink-0">
                {[0, 1, 2, 3, 4].map((b) => (
                  <span
                    key={b}
                    className="w-1 rounded-full bg-emerald-400 animate-jeeva-eq"
                    style={{
                      height: `${b % 2 === 0 ? 18 : 26}px`,
                      animationDelay: `${b * 0.14}s`,
                    }}
                  />
                ))}
              </div>

              <div className="flex-1 min-w-0">
                <p className="text-xs font-mono text-sky-300 mb-1">{activeDemo.state}</p>
                <p className="text-sm font-medium text-white truncate">{activeDemo.cmd}</p>
                <p className="text-xs text-zinc-400 mt-1 truncate">→ {activeDemo.reply}</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 mt-5 pt-4 border-t border-white/10">
              <div className="flex items-center gap-1.5">
                {DEMO_SCENARIOS.map((_, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setDemoIdx(idx)}
                    className={`h-1.5 rounded-full transition-all ${
                      demoIdx === idx ? 'w-7 bg-emerald-400' : 'w-2 bg-zinc-700 hover:bg-zinc-500'
                    }`}
                    aria-label={`Demo scenario ${idx + 1}`}
                  />
                ))}
              </div>
              <div className="flex items-center gap-2 text-[10px] font-mono text-zinc-400">
                <span className="px-2 py-1 rounded-md bg-white/5 border border-white/10">Mic</span>
                <span className="px-2 py-1 rounded-md bg-white/5 border border-white/10">Inline Chat</span>
                <span className="px-2 py-1 rounded-md bg-white/5 border border-white/10">Dashboard</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Capabilities Grid */}
      <section id="features" className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 py-14 border-t border-white/10 w-full">
        <div className="mb-10 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <p className="text-xs font-mono uppercase tracking-wider text-emerald-400 mb-2">
              Next-Gen PC Workstation
            </p>
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
              Engineered for Speed, Privacy &amp; Voice-First Control
            </h2>
          </div>
          <div className="inline-flex items-center gap-2 text-xs font-mono text-zinc-400 bg-white/5 border border-white/10 px-3 py-1.5 rounded-lg">
            <LuZap className="w-3.5 h-3.5 text-amber-400" />
            <span>39 Tools · 85 IPC Handlers</span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {features.map((f, idx) => {
            const Icon = f.icon;
            return (
              <div
                key={idx}
                className="group p-5 rounded-2xl bg-[#0e1017]/80 hover:bg-[#131620] border border-white/10 hover:border-emerald-500/40 transition-all duration-200 backdrop-blur"
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center group-hover:scale-105 transition-transform">
                    <Icon className={`w-5 h-5 ${f.accent}`} />
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-white/5 text-zinc-400 border border-white/10">
                    {f.tag}
                  </span>
                </div>
                <h3 className="text-sm font-semibold text-white mb-2">{f.title}</h3>
                <p className="text-xs text-zinc-400 leading-relaxed">{f.desc}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Architecture / Setup Steps */}
      <section id="how-it-works" className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 py-14 border-t border-white/10 w-full">
        <div className="mb-10">
          <p className="text-xs font-mono uppercase tracking-wider text-sky-400 mb-2">
            Zero-Friction Setup
          </p>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
            Ready in Under 60 Seconds
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {steps.map((st) => (
            <div
              key={st.num}
              className="p-5 rounded-2xl bg-[#0e1017]/75 border border-white/10 space-y-2.5"
            >
              <span className="inline-block text-xs font-mono font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/25 px-2 py-0.5 rounded-md">
                {st.num}
              </span>
              <h3 className="text-sm font-semibold text-white">{st.title}</h3>
              <p className="text-xs text-zinc-400 leading-relaxed">{st.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Privacy & Security */}
      <section id="hosting" className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 py-14 border-t border-white/10 w-full">
        <div className="rounded-3xl bg-gradient-to-br from-[#0e1118] to-[#0a0c12] border border-white/10 p-6 sm:p-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="space-y-3 max-w-2xl">
            <div className="inline-flex items-center gap-2 text-xs font-mono text-emerald-400">
              <LuShieldCheck className="w-4 h-4" />
              PRIVACY-FIRST &amp; LOW-END OPTIMIZED
            </div>
            <h2 className="text-xl sm:text-2xl font-bold text-white">
              Your Data Stays on Your PC. API Keys Stay Encrypted.
            </h2>
            <ul className="space-y-2 text-xs text-zinc-400">
              <li className="flex items-start gap-2">
                <LuCheck className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                <span>
                  API keys stay inside Windows OS SafeStorage Vault or your own browser — never shared with other users.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <LuCheck className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                <span>
                  Background polling adapts to 60s when idle so normal laptops stay fast, cool, and responsive.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <LuCheck className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                <span>
                  High-risk PC actions always require your explicit confirmation before running.
                </span>
              </li>
            </ul>
          </div>

          <button
            onClick={onEnterWorkspace}
            className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-gradient-to-r from-emerald-400 to-sky-400 text-zinc-950 text-sm font-semibold hover:brightness-110 transition-all flex-shrink-0"
          >
            <LuMonitor className="w-4 h-4" />
            Launch JEEVA AI
          </button>
        </div>
      </section>

      <footer className="relative z-10 mt-auto border-t border-white/10 py-6 text-center text-xs text-zinc-500">
        JEEVA AI · <a href="https://webbuildix.online/" className="text-zinc-300 hover:text-emerald-400 transition-colors">webbuildix.online</a> — Hybrid Local + Cloud Windows PC Assistant · Created by Roushan Kumar
      </footer>

      {showDownloadGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-[#11131a] border border-white/15 rounded-2xl max-w-md w-full p-5 space-y-3 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">Windows Installer (.exe)</h3>
              <button
                onClick={() => setShowDownloadGuide(false)}
                className="p-1 text-zinc-400 hover:text-white"
              >
                <LuX className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Build the desktop installer locally or host your latest <code className="text-emerald-300">JEEVA AI Setup 1.0.0.exe</code> and set <code className="text-sky-300">INSTALLER_DOWNLOAD_URL</code> on Render for 1-click download.
            </p>
            <div className="flex justify-end">
              <button
                onClick={() => setShowDownloadGuide(false)}
                className="px-4 py-1.5 rounded-lg bg-white text-zinc-950 text-xs font-semibold"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
