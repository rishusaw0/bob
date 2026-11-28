# JEEVA AI

JEEVA AI is a **Windows desktop AI assistant** built with Electron, React, PowerShell automation and Gemini AI.

The hosted website is intentionally limited to a public product landing page and a Windows installer download link. It does **not** provide a browser AI workspace, PWA, mobile pairing, PC relay, server-managed Gemini proxy, or remote PC-control API. All assistant and PC-control functionality runs in the installed Windows desktop application.

## Windows desktop capabilities

- Voice/chat assistant with Hindi, Hinglish and English support.
- Direct Gemini API connection from the Windows desktop app. The API key is stored using the Windows encrypted vault.
- PC automation for apps, Windows settings, files, screenshots, keyboard/mouse, browser tabs, software management and diagnostics.
- Deterministic local memory, reminders, scheduled tasks, workflows and basic Windows PC utilities; no local AI model is installed.
- Desktop voice modes, Camera Notch overlay, Windows tray and auto-start.
- Local permission controls and audit log.
- Windows desktop auto-updates from GitHub Releases.

## Website and downloads

- Public website: static landing page only.
- Download button: redirects to the official latest Windows installer asset on GitHub Releases.
- Render server: serves static files, a health-check endpoint and the installer redirect only. No user credentials or AI API keys are stored on the website server.

## Requirements

- Windows 10 or Windows 11 (x64).
- Node.js 22 for development/build.
- Internet access and a Gemini API key for AI answers and voice. Enter the key in the app's setup wizard or Settings; do not commit it to source control.
- Gemini 3.5 Flash-Lite is the only conversational/transcription model. Spoken replies use Google's dedicated Gemini TTS service.

## Development

    npm ci
    npm run dev

## Tests

    npm test
    npm run test:phase5
    npm run test:security

## Build the public landing page

    npm run build

This builds the static download-only site into dist/. The Render blueprint uses this build.

## Build the Windows installer

    npm run build:desktop

This uses the separate Electron desktop entry point and writes the NSIS installer to release/. The public website bundle is never packaged into the Windows installer.

## AI and voice architecture

- **Gemini 3.5 Flash-Lite only** handles conversational answers, tool planning and audio transcription. JEEVA does not silently switch to a different chat model.
- **Gemini TTS** generates spoken replies through Google's dedicated speech-generation endpoint. This is a specialized Gemini speech service, not a local TTS engine.
- No Ollama, llama.cpp, Qwen, Gemma, Whisper.cpp, Windows SAPI dictation or browser SpeechRecognition model/runtime is installed or used by JEEVA.
- Microphone audio is sent to Gemini for transcription; voice input and spoken output require internet and a configured API key.
- When offline, supported deterministic PC controls, saved memory, reminders, timers, file operations and Windows OCR can still work. AI answers and Gemini voice are unavailable until internet returns.
- On upgrade, JEEVA removes its own legacy `%APPDATA%\\jeeva-ai\\local-brain` and `voice-models` caches. It does **not** uninstall a system-wide Ollama installation or touch other applications' data.

## Release and update flow

Publish versioned Windows installers to GitHub Releases. The in-app updater reads the latest release metadata and requires HTTPS plus a SHA-256 digest before allowing an installer to run.

## Uninstall and saved data

The interactive Windows uninstaller always removes JEEVA's own login-start registry entries and Startup-folder shortcut. It then asks whether to also remove JEEVA's saved profile. **No is the default** and keeps the Gemini key, chats, preferences, PC permission policies/audit data, memories and routines for a later reinstall. Choosing **Yes** deletes only JEEVA-specific directories under the current Windows user's AppData; it does not delete personal files, other applications, or change Windows-wide privacy permissions. Silent uninstall and installer-driven updates keep the profile without showing a prompt.

## Security

The Electron renderer runs with context isolation enabled, Node integration disabled, and Chromium sandboxing enabled. IPC handlers accept requests only from the trusted main application window and local development origins. Privileged PC actions pass through the host permission guard; workflow steps and scheduled shell commands are also permission-gated.

On Windows desktop, Gemini API keys are stored with Electron safeStorage in the OS-backed encrypted vault and are not duplicated in renderer localStorage. The public website does not collect or store API keys.
