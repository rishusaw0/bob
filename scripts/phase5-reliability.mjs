import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const { getModelResourceProfile, getSafeThreadCount, isLoopbackEndpoint, createLocalBrainManager } =
  require(path.join(ROOT, 'electron/local-brain.cjs'));
const { normalizeAsrLanguage, cleanWhisperOutput, detectLocalAsrEngines } =
  require(path.join(ROOT, 'electron/offline-voice.cjs'));
const { extractCommandEntities, resolveContextualFollowUp, isAmbiguousCommand } =
  await import(pathToFileURL(path.join(ROOT, 'src/services/commandUnderstanding.js')).href);
const { classifyIntentDetailed, normalizeHinglishQuery } =
  await import(pathToFileURL(path.join(ROOT, 'src/services/semanticIntent.js')).href);

let checks = 0;
function check(condition, message) { assert.ok(condition, message); checks++; }
function equal(actual, expected, message) { assert.equal(actual, expected, message); checks++; }

// Hindi, Hinglish, Roman Hindi and English command corpus (deterministic/offline).
const intentCases = [
  ['Chrome खोलो', 'open'],
  ['chrome kholo', 'open'],
  ['notepad chalao', 'open'],
  ['volume 50 kar do', 'volume'],
  ['आवाज़ बढ़ाओ', 'volume'],
  ['screen ki brightness badhao', 'brightness'],
  ['battery kitni bachi hai', 'battery_check'],
  ['wifi ka status dikhao', 'wifi_status'],
  ['temp files saaf kar do', 'clean_temp'],
  ['dark mode on karo', 'dark_mode'],
  ['downloads folder arrange kar do', 'organize_downloads'],
  ['set a reminder after 10 minutes', 'set_reminder'],
];
for (const [query, expected] of intentCases) {
  const result = classifyIntentDetailed(query);
  if (expected === 'open') {
    check(normalizeHinglishQuery(query).includes('open'), 'open command normalization: ' + query);
  } else {
    equal(result.match?.id, expected, 'intent corpus: ' + query);
  }
}

// Entity extraction: app, Windows paths, percentages, dates, timer units and relative dates.
const fixedNow = new Date(2026, 10, 28, 12, 0, 0);
const entity = extractCommandEntities(
  'Chrome kholo; volume 65 percent; 10 minutes timer; 2026-12-04; C:\\Users\\Demo\\notes.pdf',
  fixedNow
);
equal(entity.appName, 'Chrome', 'app entity');
equal(entity.percentage, 65, 'percentage entity');
equal(entity.timerSeconds, 600, 'timer entity');
equal(entity.date, '2026-12-04', 'ISO date entity');
check(entity.filePath?.endsWith('notes.pdf'), 'Windows file path entity');
equal(extractCommandEntities('5 सेकंड ka timer', fixedNow).timerSeconds, 5, 'Hindi seconds');
equal(extractCommandEntities('2 घंटे baad', fixedNow).timerSeconds, 7200, 'Hindi hours');
equal(extractCommandEntities('kal reminder', fixedNow).date, '2026-11-29', 'relative Hindi date');
equal(extractCommandEntities('2026-02-31', fixedNow).date, null, 'invalid date rejected');

equal(resolveContextualFollowUp('ab ise band kar do', { lastApp: 'Chrome' }).appName, 'Chrome', 'context close target');
equal(resolveContextualFollowUp('ab ise band kar do', {}).kind, 'clarify', 'missing context asks clarification');
equal(resolveContextualFollowUp('isko dobara kholo', { lastApp: 'Notepad' }).kind, 'open_app', 'context reopen');
equal(isAmbiguousCommand('open the app'), true, 'ambiguous app request');
equal(isAmbiguousCommand('open chrome'), false, 'specific app request');

// Hardware profiles for representative 4/8/16 GB machines; ensure bounded CPU and context.
const p4 = getModelResourceProfile('qwen2.5:0.5b', 4);
const p8 = getModelResourceProfile('qwen2.5:1.5b', 8);
const p16 = getModelResourceProfile('qwen2.5:3b', 16);
equal(p4.numCtx, 1024, '4GB context budget');
equal(p8.numCtx, 1536, '8GB context budget');
equal(p16.numCtx, 2048, '16GB context budget');
check(getSafeThreadCount(2, 4) <= 1, '4GB / dual-core thread cap');
check(getSafeThreadCount(4, 8) <= 2, '8GB / quad-core thread cap');
check(getSafeThreadCount(8, 16) <= 3, '16GB thread cap');
equal(isLoopbackEndpoint('http://127.0.0.1:11434'), true, 'loopback endpoint allowed');
equal(isLoopbackEndpoint('https://example.com'), false, 'remote endpoint denied');
equal(isLoopbackEndpoint('http://192.168.1.10:11434'), false, 'LAN endpoint denied');

// Offline ASR contract: multilingual model selection, explicit language normalization,
// and transcript cleaning. Vosk must not be reported as available without implementation.
equal(normalizeAsrLanguage('hi-IN'), 'hi', 'Hindi locale');
equal(normalizeAsrLanguage('en-IN'), 'en', 'English locale');
equal(normalizeAsrLanguage('fr-FR'), 'auto', 'unknown locale');
equal(cleanWhisperOutput('[00:00:01.000] नमस्ते JEEVA\\nwhisper_init: diagnostic'), 'नमस्ते JEEVA', 'Whisper output cleanup');
const asr = detectLocalAsrEngines(path.join(os.tmpdir(), 'jeeva-phase5-no-model'));
equal(asr.voskReady, false, 'Vosk not falsely advertised');
equal(asr.engineType, 'windows-sapi-fallback', 'fallback identified');

// Offline runtime failure/restart contract: no installed local model must fail closed,
// without silently routing to a remote endpoint. A fresh user-data directory has no models.
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'jeeva-phase5-'));
try {
  const brain = createLocalBrainManager({ userDataDir: temp });
  const status = brain.getStatus();
  check(status && typeof status === 'object', 'local brain status available');
  const response = await brain.chat({ messages: [{ role: 'user', content: 'hello' }] });
  equal(response.ok, false, 'missing local runtime returns safe failure');
  equal(response.noLocalModel, true, 'missing local model identified');
  brain.stopSidecar();
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

// Build/installer contract checks are paired with the Windows CI workflow.
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
check(pkg.scripts['build:desktop'].includes('electron-builder --win nsis'), 'Windows NSIS build script');
check(pkg.build?.nsis?.deleteAppDataOnUninstall === false, 'uninstall preserves user data');
const workflow = fs.readFileSync(path.join(ROOT, '.github/workflows/ci-release.yml'), 'utf8');
check(workflow.includes('runs-on: windows-latest'), 'Windows CI runner');
check(workflow.includes('npm run build'), 'production bundle CI step');
check(workflow.includes('electron-builder --win nsis'), 'Windows installer CI step');
check(workflow.includes('if-no-files-found: error'), 'installer artifact required');

console.log('PHASE5_RELIABILITY_PASSED', checks, 'checks');
