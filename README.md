# JEEVA AI Desktop

JEEVA AI is a **Windows PC desktop assistant** built with Electron, React, PowerShell automation and Gemini AI.

This repository builds a Windows .exe installer. It does not include a mobile app, phone-to-PC pairing, a browser workspace, a PWA, or a hosted relay/server.

## Desktop capabilities

- Voice/chat assistant with Hindi, Hinglish and English support.
- Direct Gemini API connection from the Windows desktop app. The API key is stored using the Windows encrypted vault.
- PC automation for apps, Windows settings, files, screenshots, keyboard/mouse, browser tabs, software management and diagnostics.
- Local model support, memory, reminders, scheduled tasks and workflows.
- Desktop voice modes, Camera Notch overlay, Windows tray and auto-start.
- Local permission controls and audit log.
- Windows desktop auto-updates from GitHub Releases.

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
```

## Build Windows installer

```bash
npm run build:desktop
```

The NSIS installer is written to release/.

## Release/update flow

Publish versioned Windows installers to GitHub Releases. The in-app updater reads the latest release metadata and requires HTTPS plus a SHA-256 digest before allowing an installer to run.

## Security

The Electron renderer runs with context isolation, sandboxing, and Node integration disabled. Privileged operations are exposed only through the trusted local IPC bridge and permission guard. The development renderer is bound to loopback.

No web server, mobile endpoints, remote PC relay, or browser/PWA entry points are included.
