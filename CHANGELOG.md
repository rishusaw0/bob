# Changelog — JEEVA AI

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
