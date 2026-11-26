// Strict Path & Command Guardrails for Windows PC Safety
// Prevents destructive actions on OS system files, registry hives, .env secrets, and browser credential stores.
const path = require('path');

const BLOCKED_PATH_PATTERNS = [
  /^[a-z]:\\windows(?:\\|$)/i,
  /^[a-z]:\\program files(?:\s*\(x86\))?\\windowsapps(?:\\|$)/i,
  /^[a-z]:\\system volume information(?:\\|$)/i,
  /^[a-z]:\\\$recycle\.bin(?:\\|$)/i,
  /^[a-z]:\\boot(?:\\|$)/i,
  /\\appdata\\local\\google\\chrome\\user data(?:\\|$)/i,
  /\\appdata\\local\\microsoft\\edge\\user data(?:\\|$)/i,
  /\\appdata\\roaming\\mozilla\\firefox\\profiles(?:\\|$)/i,
  /\\appdata\\roaming\\jeeva-ai\\[^\\/]*\.vault$/i,
  /\\\.ssh(?:\\|$)/i,
  /\\\.aws(?:\\|$)/i,
  /\\\.gnupg(?:\\|$)/i,
  /(?:^|\\|\/)\.env(?:\.[a-z0-9_-]+)?$/i,
];

const DESTRUCTIVE_COMMAND_PATTERNS = [
  /\b(?:format\s+[a-z]:|diskpart|bcdedit|cipher\s+\/w|vssadmin\s+delete\s+shadows)\b/i,
  /\b(?:reg\s+(?:delete|add)\s+["']?(?:hklm|hkey_local_machine|hkcr|hkey_classes_root)\\(?:system|sam|security|software\\microsoft\\windows))\b/i,
  /\b(?:del|erase|rmdir|rd)\s+(?:[^\n]*\s)?\/[sfq]+[^\n]*(?:c:\\windows|c:\\program|c:\\users\\[^\\]+\\appdata\\local\\google)/i,
  /\bremove-item\b[^\n]*(?:-recurse|-force)[^\n]*(?:c:\\windows|system32|\.env|login data)/i,
  /\brm\s+-rf\s+(?:\/|\*|c:\/windows)/i,
  /\b(?:net\s+user|takeown|icacls\s+c:\\windows)\b/i,
];

const PROTECTED_PROCESS_NAMES = new Set([
  'system',
  'smss',
  'csrss',
  'wininit',
  'services',
  'lsass',
  'winlogon',
  'dwm',
  'svchost',
  'explorer',
  'registry',
]);

function normalizeWinPath(targetPath) {
  return path.normalize(String(targetPath || '').trim());
}

/**
 * Checks whether reading/writing/deleting/organizing targetPath hits protected OS/secret locations.
 * `mode`: 'read' | 'write' | 'delete'
 */
function checkPathSafety(targetPath, mode = 'read') {
  const raw = String(targetPath || '').trim();
  if (!raw) return { allowed: true };
  const normalized = normalizeWinPath(raw);

  // Allow non-destructive directory listing outside credential vaults, block sensitive reads/writes/deletes
  if (/\.env(?:\.[a-z0-9_-]+)?$/i.test(normalized) || /\.vault$/i.test(normalized)) {
    return {
      allowed: false,
      reason: `Blocked by Security Guardrails: protected credential/secret file (${path.basename(normalized)})`,
    };
  }

  for (const rx of BLOCKED_PATH_PATTERNS) {
    if (rx.test(normalized)) {
      if (mode === 'read' && /^[a-z]:\\windows(?:\\|$)/i.test(normalized) && !/system32\\config|sam/i.test(normalized)) {
        continue;
      }
      return {
        allowed: false,
        reason: `Blocked by Security Guardrails: protected Windows/credential path (${normalized})`,
      };
    }
  }

  // Block root drive destructive operations (C:\, D:\)
  if (mode !== 'read' && /^[a-z]:\\?$/i.test(normalized)) {
    return {
      allowed: false,
      reason: `Blocked by Security Guardrails: root drive modification is disabled (${normalized})`,
    };
  }

  return { allowed: true };
}

function checkCommandSafety(command) {
  const cmd = String(command || '').trim();
  if (!cmd) return { allowed: true };

  for (const rx of DESTRUCTIVE_COMMAND_PATTERNS) {
    if (rx.test(cmd)) {
      return {
        allowed: false,
        reason: 'Blocked by Security Guardrails: destructive OS/registry/credential command detected.',
      };
    }
  }
  return { allowed: true };
}

function checkProcessKillSafety(target) {
  const clean = String(target || '').trim().toLowerCase().replace(/\.exe$/i, '');
  if (PROTECTED_PROCESS_NAMES.has(clean)) {
    return {
      allowed: false,
      reason: `Blocked by Security Guardrails: cannot terminate critical Windows process "${target}".`,
    };
  }
  return { allowed: true };
}

module.exports = {
  checkPathSafety,
  checkCommandSafety,
  checkProcessKillSafety,
  PROTECTED_PROCESS_NAMES,
};
