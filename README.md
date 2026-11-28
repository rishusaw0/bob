# JEEVA AI

JEEVA AI is a **Windows desktop AI assistant** built with Electron, React, PowerShell automation and Gemini AI.

The hosted website is intentionally limited to a public product landing page and a Windows installer download link. It does **not** provide a browser AI workspace, PWA, mobile pairing, PC relay, server-managed Gemini proxy, or remote PC-control API. All assistant and PC-control functionality runs in the installed Windows desktop application.

## Windows desktop capabilities

- Voice/chat assistant with Hindi, Hinglish and English support.
- Direct Gemini API connection from the Windows desktop app. The API key is stored using the Windows encrypted vault.
- PC automation for apps, Windows settings, files, screenshots, keyboard/mouse, browser tabs, software management and diagnostics.
- Local model support, memory, reminders, scheduled tasks and workflows.
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
- A Gemini API key for Gemini-powered features. Enter it in the app's setup wizard or Settings; do not commit it to source control.

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

## Offline voice recognition (Whisper.cpp / Windows SAPI)

JEEVA uses this local-first speech-to-text order:

1. **Whisper.cpp** when its executable and a multilingual model are installed.
2. **Windows SAPI DictationGrammar** as a separate local fallback when Whisper is missing or fails. The matching Windows speech recognition language pack must be installed.
3. **Gemini cloud transcription** only when Strict Offline Mode is OFF and local recognition did not produce text.

Strict Offline Mode never reaches Gemini transcription. If both local engines fail, voice capture returns an error rather than sending microphone audio to the cloud.

### Install Whisper.cpp assets

Create a voice-models folder inside JEEVA's Electron user-data directory (normally %APPDATA%\\jeeva-ai\\voice-models) and place these files directly inside it:

- whisper-cli.exe (recommended) or legacy main.exe from a compatible whisper.cpp Windows build.
- One multilingual Whisper.cpp model file named ggml-*.bin (for example, a multilingual ggml-small.bin). Do not use an .en.bin English-only model if Hindi/Hinglish is required.

Expected layout:

    %APPDATA%\\jeeva-ai\\voice-models\\
      whisper-cli.exe
      ggml-small.bin

JEEVA sends 16 kHz, mono, 16-bit PCM WAV audio to Whisper.cpp. The model and executable are kept in the user's app-data folder and are not bundled into the installer. Vosk is not currently supported or detected as a ready engine; a Vosk model folder alone will not enable transcription.

### Windows SAPI fallback

SAPI uses the installed Windows Speech Recognition pack through System.Speech. Hindi dictation requires an installed Hindi recognizer; English uses an installed English recognizer. Hinglish quality depends on the selected installed recognizer and is not equivalent to multilingual Whisper.cpp.

## Release and update flow

Publish versioned Windows installers to GitHub Releases. The in-app updater reads the latest release metadata and requires HTTPS plus a SHA-256 digest before allowing an installer to run.

## Uninstall and saved data

The interactive Windows uninstaller always removes JEEVA's own login-start registry entries and Startup-folder shortcut. It then asks whether to also remove JEEVA's saved profile. **No is the default** and keeps the Gemini key, chats, preferences, PC permission policies/audit data, memories, routines and local AI model files for a later reinstall. Choosing **Yes** deletes only JEEVA-specific directories under the current Windows user's AppData; it does not delete personal files, other applications, or change Windows-wide privacy permissions. Silent uninstall and installer-driven updates keep the profile without showing a prompt.

## Security

The Electron renderer runs with context isolation enabled, Node integration disabled, and Chromium sandboxing enabled. IPC handlers accept requests only from the trusted main application window and local development origins. Privileged PC actions pass through the host permission guard; workflow steps and scheduled shell commands are also permission-gated.

On Windows desktop, Gemini API keys are stored with Electron safeStorage in the OS-backed encrypted vault and are not duplicated in renderer localStorage. The public website does not collect or store API keys.
