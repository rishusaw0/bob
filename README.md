# JEEVA AI Desktop

JEEVA AI is a **Windows PC desktop assistant** built with Electron, React, PowerShell automation and Gemini AI. The repository also contains an optional browser/PWA workspace and hosted companion relay/API service; these cloud features are separate from the Windows desktop installer and must be deployed/configured to use them.

## Desktop capabilities

- Voice/chat assistant with Hindi, Hinglish and English support.
- Direct Gemini API connection from the Windows desktop app. The API key is stored using the Windows encrypted vault.
- PC automation for apps, Windows settings, files, screenshots, keyboard/mouse, browser tabs, software management and diagnostics.
- Local model support, memory, reminders, scheduled tasks and workflows.
- Desktop voice modes, Camera Notch overlay, Windows tray and auto-start.
- Local permission controls and audit log.
- Windows desktop auto-updates from GitHub Releases.
- Optional browser workspace/PWA and mobile-to-PC relay when the companion server is deployed.

## Requirements

- Windows 10 or Windows 11 (x64).
- Node.js 22 for development/build.
- A Gemini API key for Gemini-powered features. Enter it in the app's setup wizard or Settings; do not commit it to source control.

## Development

```bash
npm ci
npm run dev
```

## Tests

```bash
npm test
npm run test:phase5
npm run test:security
```

## Offline voice recognition (Whisper.cpp / Windows SAPI)

JEEVA uses this local-first speech-to-text order:

1. **Whisper.cpp** when its executable and a multilingual model are installed.
2. **Windows SAPI DictationGrammar** as a separate local fallback when Whisper is missing or fails. The matching Windows speech recognition language pack must be installed.
3. **Gemini cloud transcription** only when Strict Offline Mode is OFF and local recognition did not produce text.

Strict Offline Mode never reaches Gemini transcription. If both local engines fail, voice capture returns an error rather than sending microphone audio to the cloud.

### Install Whisper.cpp assets

Create a `voice-models` folder inside JEEVA's Electron user-data directory (normally `%APPDATA%\jeeva-ai\voice-models`) and place these files directly inside it:

- `whisper-cli.exe` (recommended) or legacy `main.exe` from a compatible whisper.cpp Windows build.
- One multilingual Whisper.cpp model file named `ggml-*.bin` (for example, a multilingual `ggml-small.bin`). **Do not use an `.en.bin` English-only model** if Hindi/Hinglish is required.

The expected layout is:

```text
%APPDATA%\jeeva-ai\voice-models\
  whisper-cli.exe
  ggml-small.bin
```

JEEVA sends 16 kHz, mono, 16-bit PCM WAV audio to Whisper.cpp. The model and executable are kept in the user's app-data folder and are not bundled into the installer. Vosk is not currently supported or detected as a ready engine; a Vosk model folder alone will not enable transcription.

### Windows SAPI fallback

SAPI uses the installed Windows Speech Recognition pack through `System.Speech`. Hindi dictation requires an installed Hindi recognizer; English uses an installed English recognizer. Hinglish quality depends on the selected installed recognizer and is not equivalent to multilingual Whisper.cpp.

## Build Windows installer

```bash
npm run build:desktop
```

The NSIS installer is written to release/.

## Release/update flow

Publish versioned Windows installers to GitHub Releases. The in-app updater reads the latest release metadata and requires HTTPS plus a SHA-256 digest before allowing an installer to run.

## Uninstall and saved data

The interactive Windows uninstaller always removes JEEVA's own login-start registry entries and Startup-folder shortcut. It then asks whether to also remove JEEVA's saved profile. **No is the default** and keeps the Gemini key, chats, preferences, PC permission policies/audit data, memories, routines and local AI model files for a later reinstall. Choosing **Yes** deletes only JEEVA-specific directories under the current Windows user's AppData; it does not delete personal files, other applications, or change Windows-wide privacy permissions. Silent uninstall and installer-driven updates keep the profile without showing a prompt.

## Security

The Electron renderer runs with context isolation enabled, Node integration disabled, and Chromium sandboxing enabled. IPC handlers accept requests only from the trusted main application window and local development origins. Privileged PC actions pass through the host permission guard; workflow steps and scheduled shell commands are also permission-gated.

On Windows desktop, Gemini API keys are stored with Electron `safeStorage` in the OS-backed encrypted vault and are not duplicated in renderer `localStorage`. Browser/PWA mode uses browser-local storage for a user-provided key; do not use a shared/public browser profile for sensitive credentials.

### Hosted companion server configuration

When deploying the optional Render service:

- `GEMINI_API_KEY` is optional; it enables the server-managed Gemini proxy and Live token endpoint.
- `APP_PIN` must be set to a strong owner access PIN whenever `GEMINI_API_KEY` is configured. If it is missing, server-managed Gemini access fails closed and remains locked.
- `SESSION_SECRET` should be a long random secret. The Render blueprint generates one automatically; keep it stable across restarts and deployments.
- `RELAY_SECRET` is an optional separate secret for owner relay authentication.

Never commit these values to the repository. Configure them as protected environment variables in the hosting dashboard.
