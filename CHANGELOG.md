# Changelog — JEEVA AI

## [1.0.5] — 2026-11-28

### Fixed
- Restored the missing `switchWindowMode` handler that caused a startup `ReferenceError` and recovery screen.
- Synchronized React window mode state with Electron window sizing and tray/wake mode changes.
- Added regression checks to prevent the undefined window mode handler from returning.

## [1.0.4] — 2026-11-28

### Changed
- **Gemini-only AI:** Fixed conversational and transcription model to Gemini 3.5 Flash-Lite. Alternate model fallback and local SLM routing are removed.
- **Gemini voice:** Voice transcription uses Gemini; spoken replies use Google's dedicated Gemini TTS service. Browser speech recognition, Whisper.cpp, Windows SAPI dictation and native OS TTS fallbacks are removed.
- **Lightweight installer:** Excludes local model/ASR runtime files and removes JEEVA-owned legacy `local-brain` and `voice-models` caches on upgrade/startup.
- **Offline behavior:** Supported deterministic Windows controls, saved memory, reminders and timers remain available offline; AI answers and Gemini voice require internet.
- **Daily assistant focus:** System behavior is optimized for everyday questions, reminders, PC operations, Hindi, Hinglish and English; complex coding is not the primary use case.
- **UI and documentation:** Removed Hybrid/Strict Offline AI toggles, Local Brain statistics, Live Call and local voice clone UI. Updated landing page, Control Center, README and model labels.

### Preserved
- Windows app control, file and screen tools, scheduler, permission guard, audit history, personal memory, episodic history, Notch, tray and auto-launch.

## [1.0.3] — 2026-11-28

### Added
- **Wi-Fi adapter controls**: Voice and PC actions can now explicitly enable or disable physical Wi-Fi adapters, with adapter detection that does not depend on an English adapter name.
- **Release/download consistency checks**: The hosted download route, landing-page version label, package metadata, and Windows installer artifact name are kept aligned.

### Fixed
- **Hindi/Hinglish semantic intent matching**: Exact phrases from the offline intent catalog now resolve deterministically, including "screen ki brightness badhao", preventing false low-confidence or ambiguous results.
- **Voice action reliability**: Fast voice actions now report execution failures accurately instead of returning success when the underlying PC action fails.


## [1.0.0] — 2026-11-27

### Added
- **Custom NSIS Installer & Uninstaller Lifecycle (`build/installer.nsh`, `package.json`)**:
  - Automatically terminates running `JEEVA AI.exe` before install, upgrade, and uninstall so old executables never remain locked or active.
  - Cleans up JEEVA startup shortcuts and Windows `Run` registry entries on uninstall.
  - Interactive uninstall choice: **Keep My Data** (default, preserves `%APPDATA%\jeeva-ai` memories, settings, schedules) or **Remove All JEEVA Data** (full cleanup).
- **Strict Offline Mode & Service Classification (`src/services/offlineMode.js`)**:
  - Enforces hard blocking of external Gemini Cloud / TTS requests when Strict Offline Mode is active.
  - Classifies all 14 subsystems (`Fully Offline`, `Offline After Setup`, `Requires Internet`, `Requires API Key`, `Requires Windows Capability`).
- **Offline Diagnostics Dashboard & Emergency Stop (`electron/main.cjs`, `electron/preload.cjs`, `src/components/PcControlCenterModal.jsx`)**:
  - Added `app:emergencyStop` and `app:getDiagnostics` IPC handlers with privacy-safe error redaction.
  - Added **Diagnostics** tab in PC Control Center with RAM/CPU/Offline Voice/Scheduler telemetry, Test Offline Speaker, Check Internet, Strict Offline Mode toggle, Emergency Stop button, and JSON Diagnostic Report export.
- **Automation Profiles (`electron/pc-scheduler.cjs`)**:
  - Added `Work Mode`, `Study Mode`, `Gaming Mode`, and `Focus Mode` alongside `Coding Mode`, `Clean Downloads`, `Meeting Prep`, and `Night Focus`.
- **Own Voice Cloning & Offline 22-Band Owner Voiceprint Guard**:
  - Added 16kHz WAV mic recorder (`src/services/wavRecorder.js`) + Gemini 3.8 Voice Replication (`createReplicatedVoice`).
  - Upgraded `src/services/speakerVerify.js` to 22-band Mel + spectral tilt + F0 + ZCR with 3-sample exemplar matching and hard command blocking in `useVoiceEngine.js`.
- **SEO & Brand Identity (`webbuildix.online`)**:
  - Added canonical tags, Open Graph, Twitter Card, JSON-LD structured data, `public/robots.txt`, `public/sitemap.xml`, modern geometric `public/icon.svg`, and HTTP-to-HTTPS redirect + HSTS in `server/index.js`.

### Fixed
- **Zombie PowerShell Leak (`electron/win-voice.ps1`, `electron/offline-voice.cjs`)**: Fixed infinite `continue` loop when parent closes stdin, added `proc.on('error')` and stream error handlers, `windowsHide: true`, 64KB buffer cap, and 15s `dictateOnce` timeout cleanup.
- **Global Error Resilience (`electron/main.cjs`)**: Added `uncaughtException` and `unhandledRejection` handlers with redacted runtime error ring buffer.
- **Render Landing Page Crash (`src/services/useVoiceEngine.js`, `src/App.jsx`, `src/main.jsx`)**: Fixed `toggleOrb` Temporal Dead Zone `ReferenceError`, made `LandingPage` static import, and added `RootErrorBoundary`.
