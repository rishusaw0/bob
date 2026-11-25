import { useState } from 'react';
import {
  LuDownload,
  LuArrowRight,
  LuShieldCheck,
  LuGlobe,
  LuAudioLines,
  LuAppWindow,
  LuKey,
  LuFileText,
  LuCpu,
  LuCheck,
  LuX,
} from 'react-icons/lu';

export default function LandingPage({
  installerUrl,
  canInstallPWA,
  onInstallPWA,
  onEnterWorkspace,
}) {
  const [showDownloadGuide, setShowDownloadGuide] = useState(false);

  const handleDownloadExe = () => {
    if (installerUrl) {
      window.open(installerUrl, '_blank', 'noopener,noreferrer');
    } else {
      setShowDownloadGuide(true);
    }
  };

  const features = [
    {
      icon: LuAppWindow,
      title: 'Any App & Software Control',
      desc: 'Launch, focus, snap, close apps, search & install Windows software via winget, or click UI controls inside running programs.',
    },
    {
      icon: LuShieldCheck,
      title: 'Two-Layer Permission Shield',
      desc: 'Granular 7-category access policies plus a live 45-second PC confirmation popup and complete execution activity log.',
    },
    {
      icon: LuGlobe,
      title: 'Private Zero-Tunnel Cloud Relay',
      desc: 'Pair your Windows PC cleanly using your own isolated Pair Key. Access from anywhere over Render HTTPS — no ngrok needed.',
    },
    {
      icon: LuAudioLines,
      title: 'Cortana Voice Overlay + 3 Voices',
      desc: 'Summon with Alt+Space on Windows. Understands and speaks natural English, Hindi, and Hinglish with auto-detection.',
    },
    {
      icon: LuFileText,
      title: 'PDF Narration & Multimodal Chat',
      desc: 'Drop PDFs, Word/Excel files, images, or screenshots. JEEVA reads documents aloud, summarizes, and generates images.',
    },
    {
      icon: LuKey,
      title: 'Bring Your Own Key Privacy',
      desc: 'Your free Gemini API key stays encrypted in your PC OS Vault or local browser — zero key sharing between users.',
    },
  ];

  const steps = [
    {
      num: '01',
      title: 'Install on Windows PC',
      desc: 'Download and run JEEVA AI Setup (.exe) on Windows 10/11. Setup Wizard walks you through startup and tray access.',
    },
    {
      num: '02',
      title: 'Grant PC Permissions',
      desc: 'Choose which categories JEEVA can access (Hardware, Apps, Winget Install, Files, Terminal). Sensitive commands ask first.',
    },
    {
      num: '03',
      title: 'Pair & Run Anywhere',
      desc: 'Use your private Pair Key or 1-click jeeva:// link to control your PC remotely from this web app or Mobile PWA.',
    },
  ];

  return (
    <div className="min-h-screen bg-obsidian-bg text-obsidian-text flex flex-col">
      {/* Top Navbar */}
      <header className="border-b border-obsidian-border bg-obsidian-surface/80 backdrop-blur sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-zinc-100 text-zinc-950 flex items-center justify-center font-mono text-xs font-bold">
              JV
            </div>
            <div>
              <span className="text-sm font-semibold tracking-tight">JEEVA AI</span>
              <span className="hidden sm:inline text-[11px] font-mono text-obsidian-muted ml-2">
                v1.0
              </span>
            </div>
          </div>

          <nav className="hidden md:flex items-center gap-6 text-xs text-obsidian-secondary">
            <a href="#features" className="hover:text-obsidian-text transition-colors">
              Features
            </a>
            <a href="#how-it-works" className="hover:text-obsidian-text transition-colors">
              Setup &amp; Permissions
            </a>
            <a href="#hosting" className="hover:text-obsidian-text transition-colors">
              Privacy &amp; Uptime
            </a>
          </nav>

          <div className="flex items-center gap-2">
            <button
              onClick={onEnterWorkspace}
              className="px-3 py-1.5 rounded-lg bg-obsidian-elevated hover:bg-obsidian-hover border border-obsidian-border text-xs font-medium text-obsidian-text transition-colors"
            >
              Open Workspace
            </button>
            <button
              onClick={handleDownloadExe}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-100 text-zinc-950 hover:bg-white text-xs font-semibold transition-colors"
            >
              <LuDownload className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Download .exe</span>
              <span className="sm:hidden">Install</span>
            </button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <main className="flex-1">
        <section className="max-w-5xl mx-auto px-4 sm:px-6 pt-14 pb-16 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-obsidian-surface border border-obsidian-border text-[11px] font-mono text-obsidian-secondary mb-6">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            WINDOWS 10/11 DESKTOP AGENT + MULTI-USER WEB PWA
          </div>

          <h1 className="text-3xl sm:text-5xl font-bold tracking-tight text-obsidian-text max-w-3xl mx-auto leading-[1.15] mb-5">
            Your Personal AI That Controls Apps, Installs Software &amp; Runs Safely Anywhere.
          </h1>

          <p className="text-sm sm:text-base text-obsidian-secondary max-w-2xl mx-auto leading-relaxed mb-8">
            Speak in Hindi, English, or Hinglish. Launch software, install programs with winget, inspect app buttons,
            narrate PDFs, and securely control your Windows PC from your phone with strict per-action permissions.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              onClick={handleDownloadExe}
              className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-zinc-100 text-zinc-950 hover:bg-white text-sm font-semibold transition-colors shadow-lg"
            >
              <LuDownload className="w-4 h-4" />
              Download Windows Installer (.exe)
            </button>

            <button
              onClick={onEnterWorkspace}
              className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-obsidian-surface hover:bg-obsidian-elevated border border-obsidian-border text-sm font-medium text-obsidian-text transition-colors"
            >
              Launch Web Console
              <LuArrowRight className="w-4 h-4" />
            </button>

            {canInstallPWA && (
              <button
                onClick={onInstallPWA}
                className="inline-flex items-center gap-2 px-4 py-3 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/35 text-sm font-medium text-emerald-300 transition-colors"
              >
                Install Phone / Browser App
              </button>
            )}
          </div>

          <p className="text-[11px] font-mono text-obsidian-muted mt-4">
            Free &amp; BYOK Ready · Protected by Per-User Pair Keys · Runs on Windows 10/11 x64
          </p>
        </section>

        {/* Features Grid */}
        <section id="features" className="max-w-6xl mx-auto px-4 sm:px-6 py-12 border-t border-obsidian-border">
          <div className="mb-8">
            <p className="text-[11px] font-mono uppercase tracking-wider text-emerald-400 mb-1">
              Capabilities
            </p>
            <h2 className="text-xl sm:text-2xl font-semibold text-obsidian-text">
              Built Like a Complete Workstation Agent
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {features.map((f, idx) => {
              const Icon = f.icon;
              return (
                <div
                  key={idx}
                  className="bg-obsidian-surface border border-obsidian-border rounded-xl p-5 hover:border-zinc-700 transition-colors"
                >
                  <div className="w-9 h-9 rounded-lg bg-obsidian-bg border border-obsidian-border flex items-center justify-center text-emerald-400 mb-3.5">
                    <Icon className="w-4 h-4" />
                  </div>
                  <h3 className="text-sm font-semibold text-obsidian-text mb-1.5">{f.title}</h3>
                  <p className="text-xs text-obsidian-secondary leading-relaxed">{f.desc}</p>
                </div>
              );
            })}
          </div>
        </section>

        {/* How It Works / Permission Flow */}
        <section id="how-it-works" className="max-w-6xl mx-auto px-4 sm:px-6 py-12 border-t border-obsidian-border">
          <div className="mb-8">
            <p className="text-[11px] font-mono uppercase tracking-wider text-emerald-400 mb-1">
              Quick Onboarding
            </p>
            <h2 className="text-xl sm:text-2xl font-semibold text-obsidian-text">
              How Friends &amp; Users Get Started in 2 Minutes
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {steps.map((s) => (
              <div
                key={s.num}
                className="bg-obsidian-surface border border-obsidian-border rounded-xl p-5"
              >
                <span className="inline-block font-mono text-xs font-bold text-emerald-400 px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 mb-3">
                  STEP {s.num}
                </span>
                <h3 className="text-sm font-semibold text-obsidian-text mb-1.5">{s.title}</h3>
                <p className="text-xs text-obsidian-secondary leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Privacy & 24/7 Keep-Alive Info */}
        <section id="hosting" className="max-w-6xl mx-auto px-4 sm:px-6 py-12 border-t border-obsidian-border">
          <div className="bg-obsidian-surface border border-obsidian-border rounded-2xl p-6 grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
            <div>
              <div className="inline-flex items-center gap-1.5 text-[11px] font-mono text-emerald-400 mb-2">
                <LuCpu className="w-3.5 h-3.5" />
                MULTI-USER ISOLATION &amp; 24/7 UPTIME READY
              </div>
              <h3 className="text-lg font-semibold text-obsidian-text mb-2">
                Safe for Public Sharing with Friends
              </h3>
              <p className="text-xs text-obsidian-secondary leading-relaxed">
                Every user enters their own free Gemini key from Google AI Studio and pairs their own PC with an isolated private Pair Key (`JVA-...`). Users can never see or access another user&apos;s PC.
              </p>
            </div>
            <div className="bg-obsidian-bg border border-obsidian-border rounded-xl p-4 space-y-2 text-xs">
              <div className="flex items-center gap-2 text-obsidian-text font-medium">
                <LuCheck className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                Health Check Endpoint Ready: <code className="font-mono text-emerald-400">/api/health</code>
              </div>
              <p className="text-[11px] text-obsidian-muted leading-relaxed">
                Render free-tier spin-down rokne ke liye UptimeRobot / Cron-Job monitor par har 5 minute mein{' '}
                <code className="text-obsidian-secondary">/api/health</code> (GET ya HEAD) ping set karein.
              </p>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-obsidian-border py-5 px-4 text-center text-xs text-obsidian-muted">
        JEEVA AI — Built by Roushan Kumar · Open Web Workspace at{' '}
        <button onClick={onEnterWorkspace} className="text-obsidian-secondary underline hover:text-obsidian-text">
          /app
        </button>
      </footer>

      {/* Download Fallback Modal (shown when INSTALLER_DOWNLOAD_URL env is not yet configured on Render) */}
      {showDownloadGuide && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-[2px] p-4"
          onClick={() => setShowDownloadGuide(false)}
        >
          <div
            className="bg-obsidian-surface border border-obsidian-border rounded-xl max-w-md w-full p-5 shadow-2xl space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-obsidian-text">Windows Installer Setup</h3>
              <button
                onClick={() => setShowDownloadGuide(false)}
                className="p-1 rounded text-obsidian-muted hover:text-obsidian-text"
              >
                <LuX className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-obsidian-secondary leading-relaxed">
              Is server par <code className="text-emerald-400">INSTALLER_DOWNLOAD_URL</code> abhi configure nahi hua hai. Direct 1-click `.exe` download enable karne ke liye:
            </p>
            <ol className="list-decimal list-inside text-xs text-obsidian-secondary space-y-1.5">
              <li>
                PC build se bana <code className="text-obsidian-text">JEEVA AI Setup 1.0.0.exe</code> apni GitHub Release par upload karein.
              </li>
              <li>
                Render Dashboard -&gt; Environment Variables mein <code className="text-emerald-400">INSTALLER_DOWNLOAD_URL</code> = release `.exe` URL set karein.
              </li>
            </ol>
            <p className="text-[11px] text-obsidian-muted">
              Tab tak aap seedha browser Web Workspace bhi use kar sakte hain:
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => setShowDownloadGuide(false)}
                className="px-3 py-1.5 rounded-lg text-xs text-obsidian-secondary hover:text-obsidian-text"
              >
                Close
              </button>
              <button
                onClick={() => {
                  setShowDownloadGuide(false);
                  onEnterWorkspace();
                }}
                className="px-4 py-1.5 rounded-lg bg-zinc-100 text-zinc-950 text-xs font-semibold hover:bg-white"
              >
                Open Web Console
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
