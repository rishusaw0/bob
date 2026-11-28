# Privacy Notice

_Last reviewed: 28 November 2026_

JEEVA AI consists of a public download website and a Windows desktop application. They have different data flows.

## Public website

The hosted website is a static product landing page with a health check and a download redirect. It does not provide an AI workspace, user accounts, mobile pairing, a PC relay, or a server-side Gemini proxy. The website does not ask visitors to submit or store Gemini API keys.

When you visit the website or download the installer, the hosting provider, GitHub, and their infrastructure may process ordinary connection and download data (such as IP address, request time, browser details, and requested resource) as part of operating and securing those services. Review the respective providers' privacy notices for their processing and retention practices.

## Windows desktop application

JEEVA stores application settings, chat history, memories, schedules, permissions, and other profile data locally in the current Windows user's application-data area. The Gemini API key is stored using Electron safeStorage when the operating system supports secure encryption. Protect your Windows account and device.

When you enable Gemini-powered features, the relevant prompt or content is sent directly from the desktop app to Google using the API key you provide. Voice transcription may also use Gemini when cloud transcription is enabled and Strict Offline Mode is off. Local/offline features are intended to run on the device. Review Google's Gemini API terms and privacy information before enabling cloud features.

JEEVA's public website does not receive your desktop API key or PC-control commands. PC automation runs locally in the Windows desktop application.

## Data retention and deletion

Local application data remains on your device until you delete it through the app's supported controls or remove the JEEVA profile during uninstall. The installer/uninstaller may offer to preserve the profile for a later reinstall. Removing the application does not automatically delete data that you choose to keep.

## Children

JEEVA AI is a general-purpose desktop application and is not designed to collect information from children through the public website.

## Changes and contact

This notice may be updated as the product changes. For privacy questions, please open a GitHub issue without including secrets or sensitive personal information.
