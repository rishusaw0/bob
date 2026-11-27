import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import * as luIcons from 'react-icons/lu';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readRel(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

// 1. Node syntax check on all Electron CJS modules
console.log('[1/6] Checking Electron desktop JS/CJS syntax...');
const jsTargets = [
  ...fs.readdirSync(path.join(ROOT, 'electron'))
    .filter((f) => f.endsWith('.cjs'))
    .map((f) => path.join('electron', f)),
];
for (const rel of jsTargets) {
  execFileSync(process.execPath, ['-c', path.join(ROOT, rel)], { stdio: 'pipe' });
}

// 2. Cross-wiring static audit (icons, tools, IPCs, actions, permissions)
console.log('[2/6] Running full cross-wiring audit...');
function checkIcons(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) checkIcons(full);
    else if (/\.(js|jsx)$/.test(ent.name)) {
      const code = fs.readFileSync(full, 'utf8');
      for (const hit of code.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]react-icons\/lu['"]/g)) {
        for (const raw of hit[1].split(',')) {
          const name = raw.trim().split(/\s+as\s+/)[0].trim();
          if (name) assert.ok(luIcons[name], `Missing react-icons/lu export "${name}" in ${full}`);
        }
      }
    }
  }
}
checkIcons(path.join(ROOT, 'src'));

const toolsSrc = readRel('src/services/tools.js');
const permSrc = readRel('src/services/permissions.js');
const guardSrc = readRel('electron/permission-guard.cjs');
const actionsSrc = readRel('electron/pc-actions.cjs');
const mainSrc = readRel('electron/main.cjs');
const preloadSrc = readRel('electron/preload.cjs');

const toolsArrayBlock = toolsSrc.slice(toolsSrc.indexOf('export const TOOLS'), toolsSrc.indexOf('function guessDocumentMime'));
const declaredTools = [...toolsArrayBlock.matchAll(/name:\s*'([a-z_]+)'/g)].map((m) => m[1]);
const execBlock = toolsSrc.slice(toolsSrc.indexOf('export async function executeFunctionCall'));
const handledCases = new Set([...execBlock.matchAll(/case\s*'([a-z_]+)'/g)].map((m) => m[1]));
if (execBlock.includes("name === 'generate_image_tool'")) handledCases.add('generate_image_tool');

const permCases = new Set(
  [...permSrc.slice(permSrc.indexOf('getToolCategory'), permSrc.indexOf('getToolRiskLevel')).matchAll(/case\s*'([a-z_]+)'/g)].map((m) => m[1])
);

for (const t of declaredTools) {
  assert.ok(handledCases.has(t), `Tool "${t}" missing in executeFunctionCall`);
  assert.ok(permCases.has(t), `Tool "${t}" missing in permissions.js getToolCategory`);
}

const preloadInvokes = [...preloadSrc.matchAll(/ipcRenderer\.invoke\(['"]([^'"]+)['"]/g)].map((m) => m[1]);
assert.ok(mainSrc.includes('function registerSecureIpcHandler'), 'IPC handlers must be registered through the trusted-renderer guard');
const mainHandles = new Set([...mainSrc.matchAll(/registerSecureIpcHandler\(['"]([^'"]+)['"]/g)].map((m) => m[1]));
for (const ch of preloadInvokes) {
  assert.ok(mainHandles.has(ch), `IPC channel "${ch}" exposed in preload.cjs but missing in main.cjs`);
}

const actionsBlock = actionsSrc.slice(actionsSrc.indexOf('const actions = {'), actionsSrc.indexOf('return {\n    actions'));
const actionKeys = [...actionsBlock.matchAll(/^\s{4}(?:async\s+)?([a-zA-Z0-9_]+)\s*\(/gm)].map((m) => m[1]);
const guardCases = new Set(
  [...guardSrc.slice(guardSrc.indexOf('getActionCategory'), guardSrc.indexOf('isActionHighRisk')).matchAll(/case\s*'([a-zA-Z0-9_]+)'/g)].map((m) => m[1])
);
for (const act of actionKeys) {
  assert.ok(guardCases.has(act), `Action "${act}" missing in permission-guard.cjs`);
}
console.log(`   Verified ${declaredTools.length} tools, ${preloadInvokes.length} IPC handlers, ${actionKeys.length} actions.`);

// 3. Unit tests: DPI mapper, updater, scheduler, permission guard, security guardrails and memory
console.log('[3/6] Testing coord-mapper, updater, scheduler, guardrails, memory RAG & auto-launch...');
const { mapCoordsToPhysical } = require(path.join(ROOT, 'electron/coord-mapper.cjs'));
const { compareSemver } = require(path.join(ROOT, 'electron/updater.cjs'));
const { createScheduler } = require(path.join(ROOT, 'electron/pc-scheduler.cjs'));
const { getActionCategory, isActionHighRisk } = require(path.join(ROOT, 'electron/permission-guard.cjs'));
const { createAutoLaunchManager } = require(path.join(ROOT, 'electron/auto-launch.cjs'));
const { checkPathSafety, checkCommandSafety, checkProcessKillSafety } = require(path.join(ROOT, 'electron/security-guardrails.cjs'));
const { createMemoryStore } = require(path.join(ROOT, 'electron/memory-store.cjs'));

const mapped150 = mapCoordsToPhysical({
  x: 960,
  y: 600,
  coordSpace: 'pixels',
  screenshotMeta: { imageWidth: 1920, imageHeight: 1200, physicalWidth: 2880, physicalHeight: 1800, scaleFactor: 1.5 },
  primaryDisplay: { scaleFactor: 1.5, size: { width: 1920, height: 1200 }, bounds: { x: 0, y: 0 } },
});
assert.equal(mapped150.x, 1440);
assert.equal(mapped150.y, 900);

const mappedNorm = mapCoordsToPhysical({
  x: 500,
  y: 500,
  coordSpace: 'normalized_1000',
  primaryDisplay: { scaleFactor: 1, size: { width: 1920, height: 1080 }, bounds: { x: 0, y: 0 } },
});
assert.equal(mappedNorm.x, 960);
assert.equal(mappedNorm.y, 540);

assert.equal(compareSemver('1.0.2', '1.0.0'), 1);
assert.equal(compareSemver('1.0.0', '1.0.0'), 0);
assert.equal(compareSemver('0.9.9', '1.0.0'), -1);

assert.equal(getActionCategory('browserControl', ['youtube_skip_ad']), 'screen_input');
assert.equal(getActionCategory('browserControl', ['list_tabs']), 'apps_window');
assert.equal(isActionHighRisk('manageProcess', ['kill_process', '123']), true);
assert.equal(isActionHighRisk('emptyRecycleBin', []), true);

const tmpSchedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jeeva-test-sched-'));
let fired = false;
const sched = createScheduler({ userDataDir: tmpSchedDir, onFire: () => { fired = true; } });
sched.scheduleReminder({ delayMinutes: 0.003, message: 'Test' });
const cmd = sched.scheduleDelayedCommand({ delayMinutes: 5, command: 'echo no' });
assert.equal(sched.cancelTask(cmd.id).cancelled, 1);
await new Promise((r) => setTimeout(r, 320));
assert.equal(fired, true);
sched.saveMacro({
  name: 'Unit Macro',
  condition: 'battery_low',
  steps: [{ type: 'power_plan', plan: 'power_saver' }],
});
const dry = sched.dryRunMacro('custom_' + sched.getAllMacros().find((m) => m.name === 'Unit Macro').id.replace('custom_', ''), { batteryPct: 18 });
assert.equal(dry.conditionMet, true);

// 90-day calendar date/time reminder + 30-min earlyWarnAt + missed/today catch-up
const futureAt = Date.now() + 2 * 3600 * 1000;
const dTask = sched.scheduleDateReminder({
  triggerAt: futureAt,
  hasExplicitTime: true,
  timeLabel: '6:00 PM',
  message: 'Meeting with client',
  earlyWarnMinutes: 30,
});
assert.ok(dTask.earlyWarnAt && Math.abs(futureAt - dTask.earlyWarnAt - 30 * 60 * 1000) < 1000);
assert.equal(sched.getAgendaSummary().todayItems.length + sched.getAgendaSummary().upcomingItems.length >= 1, true);
sched.dispose();
fs.rmSync(tmpSchedDir, { recursive: true, force: true });

// Security guardrails & Local Memory RAG tests
assert.equal(checkPathSafety('C:\\Windows\\System32\\cmd.exe', 'delete').allowed, false);
assert.equal(checkPathSafety('C:\\Users\\Test\\.env', 'read').allowed, false);
assert.equal(checkPathSafety('C:\\Users\\Test\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\Login Data', 'read').allowed, false);
assert.equal(checkPathSafety('C:\\Users\\Test\\Downloads\\report.pdf', 'read').allowed, true);
assert.equal(checkCommandSafety('reg delete HKLM\\SYSTEM\\CurrentControlSet').allowed, false);
assert.equal(checkCommandSafety('echo safe').allowed, true);
assert.equal(checkProcessKillSafety('lsass.exe').allowed, false);

const tmpMemDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jeeva-test-mem-'));
const ragMemStore = createMemoryStore({ userDataDir: tmpMemDir });
ragMemStore.remember({ content: 'My main Python project lives in D:\\Projects\\JarvisBot', category: 'project', tags: ['python'] });
const hits = ragMemStore.recall('Where is my python project folder?');
assert.ok(hits.length >= 1 && hits[0].content.includes('JarvisBot'));
fs.rmSync(tmpMemDir, { recursive: true, force: true });

// Auto-launch registry + Windows Startup shortcut fallback tests
const tmpAutoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jeeva-test-auto-'));
let storedEntry = null;
const mockRegApp = {
  setLoginItemSettings: (s) => {
    storedEntry = s?.openAtLogin ? { path: s.path, args: s.args || [] } : null;
  },
  getLoginItemSettings: (opts) => {
    const match =
      storedEntry &&
      opts?.path === storedEntry.path &&
      JSON.stringify(opts?.args || []) === JSON.stringify(storedEntry.args || []);
    return { openAtLogin: Boolean(match), executableWillLaunchAtLogin: Boolean(storedEntry) };
  },
};
const regMgr = createAutoLaunchManager({
  app: mockRegApp,
  shell: { writeShortcutLink: () => false },
  platform: 'win32',
  appDataPath: tmpAutoDir,
  isPackaged: true,
  execPath: 'C:\\Users\\Test User\\JEEVA AI.exe',
});
assert.equal(regMgr.setEnabled(true).enabled, true);
assert.equal(regMgr.isEnabled(), true);
assert.equal(regMgr.setEnabled(false).enabled, false);
assert.equal(regMgr.isEnabled(), false);

// Simulate Registry locked/denied -> Startup .lnk fallback must kick in cleanly
const fallbackMgr = createAutoLaunchManager({
  app: { setLoginItemSettings: () => {}, getLoginItemSettings: () => ({ openAtLogin: false, executableWillLaunchAtLogin: false }) },
  shell: {
    writeShortcutLink: (lnkPath) => {
      fs.writeFileSync(lnkPath, 'LNK');
      return true;
    },
  },
  platform: 'win32',
  appDataPath: tmpAutoDir,
  isPackaged: true,
  execPath: 'C:\\Users\\Test User\\JEEVA AI.exe',
});
const fbOn = fallbackMgr.setEnabled(true);
assert.equal(fbOn.enabled, true);
assert.equal(fbOn.method, 'startup_shortcut');
assert.equal(fallbackMgr.isEnabled(), true);
assert.equal(fallbackMgr.setEnabled(false).enabled, false);
assert.equal(fallbackMgr.isEnabled(), false);
fs.rmSync(tmpAutoDir, { recursive: true, force: true });


// Secret paths and empty paths are rejected by the local filesystem guard.
assert.equal(checkPathSafety('', 'read').allowed, false);
assert.equal(checkPathSafety(path.win32.join('C:\\\\', 'Users', 'Test', 'AppData', 'Roaming', 'Jeeva-AI', 'api-key.vault'), 'read').allowed, false);

// 4. Voice router verification (including "batao" status exception + battery + browser)
console.log('[4/6] Testing fast Voice Router rules...');
const memStore = new Map();
globalThis.localStorage = {
  getItem: (k) => (memStore.has(k) ? memStore.get(k) : null),
  setItem: (k, v) => memStore.set(k, String(v)),
  removeItem: (k) => memStore.delete(k),
};
globalThis.localStorage.setItem(
  'jeeva_permission_rules',
  JSON.stringify({ hardware_settings: 'always', apps_window: 'always', files_storage: 'always', screen_input: 'always' })
);
globalThis.window = {
  electronAPI: {
    battery: async () => 'Battery: 85% (Charging)',
    diagnostics: async () => JSON.stringify([{ name: 'Code', ramMb: 520 }]),
    browserControl: async (act) => `Ran ${act}`,
    clipboardHistory: async () => ({ items: [{ preview: 'hello' }] }),
    volume: async (a) => `Vol ${a}`,
    brightness: async (a) => `Bright ${a}`,
    powerProfile: async (p) => `Plan ${p}`,
    openApp: async (a) => `Opened ${a}`,
    openURL: async (u) => `Opened URL ${u}`,
    wifi: async (m) => `Wifi ${m}`,
    screenshot: async () => ({ base64: 'data:image/png;base64,test' }),
    theme: async (m) => `Theme ${m}`,
    closeApp: async (a) => `Closed ${a}`,
    typeClipboard: async (t) => `Typed ${t}`,
    sendHotkey: async (c) => `Sent ${c}`,
    mouseAction: async (s, _x, _y, _x2, _y2, d) => `Mouse ${s} ${d}`,
    scheduler: async (sub, delay, msg) => `Scheduled ${sub}: ${msg} in ${delay}m`,
    filePro: async (sub, src) => `Organized ${sub} ${src}`,
    openSetting: async (s) => `Opened setting ${s}`,
    listInstalledApps: async (f) => `Installed apps (${f || 'all'})`,
    windowControl: async (act, app) => `Window ${act} ${app}`,
    extractDocText: async ({ filePath }) => ({
      ok: true,
      name: String(filePath || 'notes.pdf').split(/[\\/]/).pop(),
      ext: '.pdf',
      pageCount: 2,
      isScannedPdf: false,
      text: 'This PDF explains how solar energy works cleanly. Solar panels convert sunlight into electricity for homes and offices. Battery storage keeps power available at night.',
      chars: 168,
    }),
  },
};

const vrUrl = pathToFileURL(path.join(ROOT, 'src/services/voiceRouter.js')).href;
const vcUrl = pathToFileURL(path.join(ROOT, 'src/services/voiceCapture.js')).href;
const upUrl = pathToFileURL(path.join(ROOT, 'src/services/userPrefs.js')).href;
const vpUrl = pathToFileURL(path.join(ROOT, 'src/services/voicePermissionPrompt.js')).href;
const vctxUrl = pathToFileURL(path.join(ROOT, 'src/services/voiceContext.js')).href;
const svUrl = pathToFileURL(path.join(ROOT, 'src/services/speakerVerify.js')).href;

const {
  tryFastVoiceAction,
  matchWakePhrase,
  getWakeOpenMode,
  setWakeOpenMode,
  getWakeTriggerPhrase,
  setWakeTriggerPhrase,
} = await import(vrUrl);
const {
  getDocSummaryPref,
  setDocSummaryPref,
  getReplyStyle,
  setReplyStyle,
} = await import(upUrl);
const {
  downsampleFloat32,
  encodeWavBase64,
  cleanSttTranscript,
  computeVocalVadMetrics,
  computeAdaptiveSilenceMs,
  pcmFloat32ToInt16Base64,
} = await import(vcUrl);
const { detectCommandLanguage, buildLocalizedPermissionQuestion, parseVoiceConfirmation } = await import(vpUrl);
const { isDeicticVoiceCommand } = await import(vctxUrl);
const { extractVoiceprint, compareVoiceprints, enrollVoiceprintSamples, setVoiceprintGuardEnabled, verifySpeakerVoiceprint } = await import(svUrl);

// Vocal-band spectral VAD & dynamic silence tests
const synthVoice = new Float32Array(2048);
for (let i = 0; i < synthVoice.length; i++) {
  synthVoice[i] = 0.25 * Math.sin((2 * Math.PI * 680 * i) / 16000) + 0.15 * Math.sin((2 * Math.PI * 1400 * i) / 16000);
}
const vocalMetrics = computeVocalVadMetrics(synthVoice, 3.6, 16000);
assert.equal(vocalMetrics.isVocalFrame, true);
assert.equal(vocalMetrics.bands.length, 5);
assert.ok(computeAdaptiveSilenceMs(500) < computeAdaptiveSilenceMs(3000));
assert.ok(pcmFloat32ToInt16Base64(synthVoice.subarray(0, 160)).length > 20);

// Acoustic speaker voiceprint tests (22-dim Mel + spectral slope + pitch F0 + ZCR)
const fpSelf = extractVoiceprint(synthVoice, 16000);
assert.ok(fpSelf?.vector?.length === 22);
assert.ok(compareVoiceprints(fpSelf, fpSelf) >= 0.99);
enrollVoiceprintSamples([synthVoice]);
setVoiceprintGuardEnabled(true);
assert.equal(verifySpeakerVoiceprint(synthVoice).verified, true);
const synthStranger = new Float32Array(2048);
for (let i = 0; i < synthStranger.length; i++) {
  synthStranger[i] = 0.25 * Math.sin((2 * Math.PI * 240 * i) / 16000) + 0.18 * Math.sin((2 * Math.PI * 3100 * i) / 16000);
}
assert.equal(verifySpeakerVoiceprint(synthStranger).verified, false);
setVoiceprintGuardEnabled(false);

// Deictic context matcher tests
assert.equal(isDeicticVoiceCommand('is error ko explain karo'), true);
assert.equal(isDeicticVoiceCommand('isko close karo'), true);
assert.equal(isDeicticVoiceCommand('open chrome'), false);

// Chained Tier-1 voice command test ("Coding mode on karo, Spotify chalao, aur brightness 60% kar do")
const chainRes = await tryFastVoiceAction('Coding mode on karo, Spotify chalao, aur brigtness 60% kar do', async () => 'once');
assert.equal(chainRes.handled, true);
assert.equal(chainRes.chained, true);
assert.equal(chainRes.tools.length, 4);

const mixedChain = await tryFastVoiceAction('Coding mode on karo, aur Python ka kya use hai batao', async () => 'once');
assert.equal(mixedChain.handled, false);

assert.equal(detectCommandLanguage('hamko chrome uninstall krna hai'), 'hinglish');
assert.equal(detectCommandLanguage('Please uninstall Chrome from PC'), 'english');
assert.equal(detectCommandLanguage('मुझे क्रोम अनइंस्टॉल करना है'), 'hindi');
const qEn = buildLocalizedPermissionQuestion({ name: 'manage_software', args: { action: 'uninstall', package: 'Chrome' } }, 'english');
const qHg = buildLocalizedPermissionQuestion({ name: 'manage_software', args: { action: 'uninstall', package: 'Chrome' } }, 'hinglish');
assert.ok(/uninstall Chrome/i.test(qEn));
assert.ok(/Chrome ko uninstall karna chahte hain/i.test(qHg));
assert.equal(parseVoiceConfirmation('haan kar do'), 'yes');
assert.equal(parseVoiceConfirmation('Yes please confirm'), 'yes');
assert.equal(parseVoiceConfirmation('nahi cancel karo'), 'no');
assert.equal(parseVoiceConfirmation('No stop'), 'no');
assert.equal(parseVoiceConfirmation('maybe later'), 'unclear');

const pcm48 = new Float32Array(480).fill(0.25);
const pcm16 = downsampleFloat32(pcm48, 48000, 16000);
assert.equal(pcm16.length, 160);
const wavB64 = encodeWavBase64(pcm16, 16000);
const wavBuf = Buffer.from(wavB64, 'base64');
assert.equal(wavBuf.subarray(0, 4).toString('ascii'), 'RIFF');
assert.equal(wavBuf.subarray(8, 12).toString('ascii'), 'WAVE');
assert.equal(cleanSttTranscript('[inaudible]'), '');
assert.equal(cleanSttTranscript('"Hey Jeeva chrome kholo"'), 'Hey Jeeva chrome kholo');

const aliasWake = matchWakePhrase('Hey Jeean chrome kholo', 'Jeeva');
assert.equal(aliasWake.matched, true);
assert.equal(aliasWake.command, 'chrome kholo');

const exactWake = matchWakePhrase('Hey Jeeva', 'Jeeva');
assert.equal(exactWake.matched, true);
assert.equal(exactWake.command, '');

assert.equal(setWakeOpenMode('notch'), 'notch');
assert.equal(getWakeOpenMode(), 'notch');
assert.equal(setWakeOpenMode('full'), 'full');
assert.equal(getWakeOpenMode(), 'full');
assert.equal(setWakeOpenMode('cortana'), 'cortana');

const topBatao = await tryFastVoiceAction('top processes batao');
assert.equal(topBatao.handled, true);
assert.ok(topBatao.replyText.includes('Code'));

const batBatao = await tryFastVoiceAction('battery batao');
assert.equal(batBatao.handled, true);
assert.ok(batBatao.replyText.includes('85%'));

// Custom wake trigger phrase + userPrefs tests
assert.equal(setWakeTriggerPhrase('Sun Bhai'), 'Sun Bhai');
assert.equal(getWakeTriggerPhrase(), 'Sun Bhai');
const customWake = matchWakePhrase('Sun Bhai youtube kholo', 'Jeeva', 'Sun Bhai');
assert.equal(customWake.matched, true);
assert.equal(customWake.command, 'youtube kholo');

assert.equal(setDocSummaryPref('summarize'), 'summarize');
assert.equal(getDocSummaryPref(), 'summarize');
assert.equal(setDocSummaryPref('read_full'), 'read_full');
assert.equal(getDocSummaryPref(), 'read_full');
assert.equal(setReplyStyle('detailed'), 'detailed');
assert.equal(getReplyStyle(), 'detailed');
assert.equal(setReplyStyle('concise'), 'concise');

// Universal app typing, named video playback & shortcut fast commands
const typedInApp = await tryFastVoiceAction('notepad mein hello world type karo');
assert.equal(typedInApp.handled, true);
assert.equal(typedInApp.tools.length, 2);
assert.equal(typedInApp.tools[0].name, 'open_application');
assert.equal(typedInApp.tools[1].name, 'type_text');

const namedPlay = await tryFastVoiceAction('youtube par kesariya play karo');
assert.equal(namedPlay.handled, true);
assert.equal(namedPlay.tools[0].name, 'open_url');
assert.ok(namedPlay.tools[0].args.url.includes('youtube.com/results?search_query=kesariya'));

const copyCmd = await tryFastVoiceAction('copy karo');
assert.equal(copyCmd.handled, true);
assert.equal(copyCmd.tools[0].args.shortcut, 'ctrl+c');

// Regression tests for diagnosed voice bugs (chala do, app mein likho <text>, chained type/play)
const songChalaDo = await tryFastVoiceAction('kesariya chala do');
assert.equal(songChalaDo.handled, true);
assert.equal(songChalaDo.tools[0].name, 'open_url');
assert.ok(songChalaDo.tools[0].args.url.includes('youtube.com/results?search_query=kesariya'));

const appLikho = await tryFastVoiceAction('notepad mein likho hello world');
assert.equal(appLikho.handled, true);
assert.equal(appLikho.tools[0].name, 'open_application');
assert.equal(appLikho.tools[1].name, 'type_text');
assert.equal(appLikho.tools[1].args.text, 'hello world');

const chainedOpenAndType = await tryFastVoiceAction('Notepad kholo aur hello world type karo');
assert.equal(chainedOpenAndType.handled, true);
assert.equal(chainedOpenAndType.chained, true);
assert.equal(chainedOpenAndType.tools[0].name, 'open_application');
assert.equal(chainedOpenAndType.tools[1].name, 'type_text');

const chainedOpenAndPlay = await tryFastVoiceAction('Chrome kholo aur YouTube par Kesariya play karo');
assert.equal(chainedOpenAndPlay.handled, true);
assert.equal(chainedOpenAndPlay.chained, true);
assert.equal(chainedOpenAndPlay.tools[0].name, 'open_application');
assert.equal(chainedOpenAndPlay.tools[1].name, 'open_url');

// Streaming TTS & fast speech exports check
const spUrl = pathToFileURL(path.join(ROOT, 'src/services/speech.js')).href;
const { createStreamingSpeaker, splitIntoChunks } = await import(spUrl);
assert.equal(typeof createStreamingSpeaker, 'function');
const spChunks = splitIntoChunks('First short answer sentence. Second longer explanation sentence right after it.', 220, 100);
assert.ok(spChunks.length >= 1 && spChunks[0].length <= 100);

// Speech decimal splitting regression test
const decChunks = splitIntoChunks('Your laptop has 3.8 GB free RAM and 85.5% battery. Everything looks healthy!', 220, 100);
assert.ok(decChunks[0].includes('3.8 GB') && decChunks[0].includes('85.5 percent'));

// Layer-1 slot action verification (0 Gemini API calls)
const { runLocalQuickBrain } = await import(pathToFileURL(path.join(ROOT, 'src/services/localQuickBrain.js')).href);

const remHit = await runLocalQuickBrain('10 minute baad meeting reminder lagao');
assert.equal(remHit.handled, true);
assert.equal(remHit.tools[0].name, 'schedule_pc_task');

const orgHit = await runLocalQuickBrain('downloads organize karo');
assert.equal(orgHit.handled, true);
assert.equal(orgHit.tools[0].name, 'file_manager_pro');

const btHit = await runLocalQuickBrain('bluetooth settings kholo');
assert.equal(btHit.handled, true);
assert.equal(btHit.tools[0].name, 'open_windows_setting');
assert.equal(btHit.tools[0].args.setting, 'bluetooth');

// Intelligence upgrades: natural memory intro/recall + pronoun follow-up resolution
const nameSave = await runLocalQuickBrain('Mera naam Roushan hai');
assert.equal(nameSave.handled, true);
assert.equal(nameSave.tools[0].name, 'memory_rag');
const nameRecall = await runLocalQuickBrain('Mera naam kya hai?');
assert.equal(nameRecall.handled, true);
assert.ok(nameRecall.replyText.includes('Roushan'));

const followUpClose = await runLocalQuickBrain('isko band karo', {
  historyMessages: [
    { role: 'user', text: 'Notepad kholo' },
    { role: 'assistant', text: 'Maine notepad khol diya hai.', tools: [{ name: 'open_application', args: { app_name: 'notepad' } }] },
  ],
});
assert.equal(followUpClose.handled, true);
assert.equal(followUpClose.tools[0].name, 'close_application');
assert.equal(followUpClose.tools[0].args.app_name, 'notepad');

// Voice file-location PDF reading & summarizing test (0 Gemini API calls)
const docLocRead = await runLocalQuickBrain('Desktop par notes.pdf hai isko summarize karo aur sunao');
assert.equal(docLocRead.handled, true);
assert.equal(docLocRead.tools[0].name, 'read_document_file');
assert.equal(docLocRead.autoSpeak, true);
assert.ok(docLocRead.replyText.toLowerCase().includes('solar'));

// Date/Time Reminder + VS Code / GitHub / Chrome / YouTube local control tests
const decRem = await runLocalQuickBrain('5 December ko shaam 6 baje yaad dilana meeting hai');
assert.equal(decRem.handled, true);
assert.equal(decRem.tools[0].name, 'schedule_pc_task');
assert.equal(decRem.tools[0].args.action, 'remind_date');
assert.equal(decRem.tools[0].args.early_warn_minutes, 30);

const ytFs = await runLocalQuickBrain('youtube fullscreen karo');
assert.equal(ytFs.handled, true);
assert.equal(ytFs.tools[0].name, 'browser_control');
assert.equal(ytFs.tools[0].args.action, 'youtube_fullscreen');

const incog = await runLocalQuickBrain('incognito kholo');
assert.equal(incog.handled, true);
assert.equal(incog.tools[0].args.action, 'new_incognito');

const vscTerm = await runLocalQuickBrain('vs code terminal kholo');
assert.equal(vscTerm.handled, true);
assert.equal(vscTerm.tools[0].name, 'press_shortcut');

const ghPulls = await runLocalQuickBrain('github pulls kholo');
assert.equal(ghPulls.handled, true);
assert.equal(ghPulls.tools[0].args.url, 'https://github.com/pulls');

const volAur = await tryFastVoiceAction('volume thoda aur badhao');
assert.equal(volAur.handled, true);
assert.equal(volAur.tools[0].args.action, 'up');

const shotAct = await tryFastVoiceAction('ek screenshot le lo');
assert.equal(shotAct.handled, true);
assert.equal(shotAct.tools[0].name, 'take_screenshot');

const darkAct = await tryFastVoiceAction('dark mode on karo');
assert.equal(darkAct.handled, true);
assert.equal(darkAct.tools[0].args.mode, 'dark');

const skipAct = await tryFastVoiceAction('youtube ad skip karo');
assert.equal(skipAct.handled, true);
assert.equal(skipAct.tools[0].args.action, 'youtube_skip_ad');

const tabAct = await tryFastVoiceAction('new tab');
assert.equal(tabAct.handled, true);
assert.equal(tabAct.tools[0].args.action, 'new_tab');

const openEnded = await tryFastVoiceAction('python ke baare mein batao');
assert.equal(openEnded.handled, false);

// 5. Desktop-only architecture checks
console.log('[5/6] Verifying Windows desktop-only build surface...');
for (const removedPath of [
  'server',
  'render.yaml',
  'src/components/LandingPage.jsx',
  'src/components/MobileConnectModal.jsx',
  'public/manifest.json',
  'public/service-worker.js',
  'public/robots.txt',
  'public/sitemap.xml',
  'public/icon-192.png',
  'public/icon-512.png',
  'electron/bridge-server.cjs',
  'electron/cloud-relay.cjs',
  'electron/ws-client.cjs',
]) {
  assert.equal(fs.existsSync(path.join(ROOT, removedPath)), false, `Removed mobile/web module still exists: ${removedPath}`);
}
const appSource = readRel('src/App.jsx');
assert.ok(!/MobileConnectModal|LandingPage|serverConfig|appToken|cloudApiUrl|showMobileModal|PWA|Render/.test(appSource),
  'App must not contain browser workspace, phone, PWA or hosted workspace references');
const desktopBridge = readRel('src/services/bridge.js');
assert.ok(desktopBridge.includes('window.electronAPI'), 'PC renderer must use local Electron IPC');
assert.ok(!desktopBridge.includes('fetch(') && !desktopBridge.includes('/api/'), 'PC bridge must not expose HTTP routes');

// Hybrid Local AI Brain tests (Semantic Intent, Top-4 Tool Pruning, Escalation Gatekeeper & Hardware Profile)
const { classifyIntent, pickTopToolsForQuery } = await import(pathToFileURL(path.join(ROOT, 'src/services/semanticIntent.js')).href);
const { assessQueryRouting, compactHistoryForCloud } = await import(pathToFileURL(path.join(ROOT, 'src/services/brainRouter.js')).href);
const { detectHardwareProfile, LOW_END_MODELS } = require(path.join(ROOT, 'electron/local-brain.cjs'));

const lagIntent = classifyIntent('yaar laptop bohot lag kr raha hai check kro');
assert.equal(lagIntent?.tool, 'system_diagnostics');
assert.ok(lagIntent?.confidence >= 0.4);
assert.equal(classifyIntent('chrome delete kr do'), null); // Destructive phrases never auto-route blindly

const top4 = pickTopToolsForQuery('wifi network status check karo', 4);
assert.equal(top4.length, 4);
assert.ok(top4.includes('get_wifi_status'));

const routeCloud = assessQueryRouting('@cloud write a react compiler architecture', null, 'auto');
assert.equal(routeCloud.forceCloud, true);
assert.equal(routeCloud.shouldTryLocalFirst, false);

const routeLocal = assessQueryRouting('18% of 2500 kitna hoga', null, 'auto');
assert.equal(routeLocal.shouldTryLocalFirst, true);

const cmdRouteCloudMode = assessQueryRouting('notepad me hello world type karo', null, 'cloud', { online: true, strictLocalCommands: true });
assert.equal(cmdRouteCloudMode.queryKind, 'pc_command');
assert.equal(cmdRouteCloudMode.strictNoApi, true);
assert.equal(cmdRouteCloudMode.forceCloud, false);

const weatherRoute = assessQueryRouting('aaj Delhi ka weather kya hai', null, 'auto', { online: true });
assert.equal(weatherRoute.queryKind, 'cloud_web_heavy');
assert.equal(weatherRoute.heavyReason, 'live_web_knowledge');
assert.equal(weatherRoute.strictNoApi, false);

const explicitCloudCmd = assessQueryRouting('@gemini chrome kholo', null, 'auto', { online: true });
assert.equal(explicitCloudCmd.forceCloud, true);
assert.equal(explicitCloudCmd.strictNoApi, false);

const hw = detectHardwareProfile();
assert.ok(hw.totalGb > 0 && hw.safeThreads >= 2);
assert.ok(LOW_END_MODELS.some((m) => m.id === 'qwen2.5:1.5b'));
assert.ok(compactHistoryForCloud([{ role: 'user', text: 'hi' }, { role: 'assistant', text: 'hello' }, { role: 'user', text: 'a' }, { role: 'assistant', text: 'b' }, { role: 'user', text: 'c' }], 2).includes('CONVERSATION CONTEXT DIGEST'));

// Professional TTS quality and sentence playback regressions
const { getTtsModelPriority, VOICE_STYLE_HINTS } = await import(pathToFileURL(path.join(ROOT, 'src/services/gemini.js')).href);
assert.equal(getTtsModelPriority()[0], 'gemini-3.8-flash-tts', 'Full-quality TTS must be preferred over Flash Lite');
assert.ok(VOICE_STYLE_HINTS.hinglish.includes('Latin letters') && VOICE_STYLE_HINTS.hinglish.includes('short natural pauses'),
  'Hinglish TTS must guide native Hindi pronunciation and concise sentence pauses');
const speechSource = readRel('src/services/speech.js');
assert.ok(speechSource.includes('Reuse one AudioContext across sentence chunks'),
  'Sentence playback must reuse the audio context to avoid per-sentence startup gaps');

// Indian-style TTS accent default, Human Personas, Custom Cloned Voice & Speech Clarity tests
const {
  cleanTextForSpeech,
  detectVoiceProfile,
  getVoiceAccent,
  getSpeechSpeedMode,
  VOICE_PERSONAS,
  getVoicePersona,
  getActiveCustomVoiceId,
  saveCustomClonedVoice,
  removeCustomClonedVoice,
} = await import(pathToFileURL(path.join(ROOT, 'src/services/speech.js')).href);
assert.equal(getVoiceAccent(), 'indian');
assert.equal(getSpeechSpeedMode(), 'hybrid_fast');
assert.equal(getVoicePersona(), 'natural_warm');
assert.ok(VOICE_PERSONAS.calm_pro && VOICE_PERSONAS.crisp_studio);
saveCustomClonedVoice({ id: 'voice_test_123', displayName: 'Test Voice' });
assert.equal(getActiveCustomVoiceId(), 'voice_test_123');
removeCustomClonedVoice('voice_test_123');
assert.equal(getActiveCustomVoiceId(), '');
// Desktop application icon asset check
assert.ok(fs.readFileSync(path.join(ROOT, 'public/icon.svg'), 'utf8').includes('viewBox="0 0 128 128"'));
assert.ok(computeAdaptiveSilenceMs(500, 740) <= 540);
assert.equal(detectVoiceProfile('Open Chrome and set brightness to 60 percent'), 'english');
assert.equal(detectVoiceProfile('Bhai laptop bohot slow ho raha hai'), 'hinglish');
const spokenClean = cleanTextForSpeech('Check **C:\\Users\\Demo\\report.pdf** -> 45% CPU & high_performance');
assert.ok(spokenClean.includes('report.pdf') && spokenClean.includes('45 percent') && spokenClean.includes('high performance') && !spokenClean.includes('C:\\Users'));
const tableClean = cleanTextForSpeech('| App | RAM |\n|---|---|\n| Chrome | 500 MB |\nPrice Rs. 500');
assert.ok(!tableClean.includes('---') && tableClean.includes('500 rupees'));

// Auto-Switch Offline Policy & Date-Indexed Episodic Memory tests
const offlineRoute = assessQueryRouting('Chrome ke baare me explain karo', null, 'auto', { online: false });
assert.equal(offlineRoute.mode, 'offline');
assert.equal(offlineRoute.forceCloud, false);

const { isEpisodicHistoryQuery, parseEpisodicDateQuery, toDateKey } = await import(pathToFileURL(path.join(ROOT, 'src/services/dateQueryParser.js')).href);
const { createEpisodicMemory } = require(path.join(ROOT, 'electron/episodic-memory.cjs'));
assert.equal(isEpisodicHistoryQuery('Kal maine Chrome ke baare me kya pucha tha?'), true);
const fixedNow = new Date(2026, 10, 26, 14, 0, 0); // 2026-11-26 (Thursday)
const kalParsed = parseEpisodicDateQuery('Kal shaam maine Chrome ke baare me kya pucha tha?', fixedNow);
assert.equal(kalParsed.dateKey, '2026-11-25');
assert.equal(kalParsed.timeOfDay, 'evening');
assert.ok(kalParsed.topic.includes('chrome'));
const monParsed = parseEpisodicDateQuery('Last Monday kya baat hui thi?', fixedNow);
assert.equal(monParsed.dateKey, '2026-11-23');

const tmpEpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jeeva-test-ep-'));
const epStore = createEpisodicMemory({ userDataDir: tmpEpDir });
const yestTs = new Date(2026, 10, 25, 18, 30, 0).getTime();
epStore.logTurn({
  timestamp: yestTs,
  source: 'voice',
  brainTier: 'fast',
  userPrompt: 'Open Chrome and set AIzaSyTestFakeKey123456789012345',
  assistantReply: 'Opened Chrome cleanly',
  toolsUsed: ['open_application'],
});
epStore.logTurn({
  timestamp: new Date(2026, 10, 26, 10, 15, 0).getTime(),
  source: 'chat',
  brainTier: 'cloud',
  userPrompt: 'Explain React hooks',
  assistantReply: 'Hooks let you use state...',
});
const epRes = epStore.queryTimeline({ dateKey: toDateKey(new Date(2026, 10, 25)), timeOfDay: 'evening', topic: 'chrome' });
assert.equal(epRes.length, 1);
assert.ok(epRes[0].userPrompt.includes('[REDACTED_API_KEY]') && !epRes[0].userPrompt.includes('AIzaSyTestFakeKey'));
const voiceOnlyEp = epStore.queryTimeline({ source: 'voice' });
assert.equal(voiceOnlyEp.length, 1);
assert.equal(voiceOnlyEp[0].source, 'voice');
assert.equal(epStore.forgetDay('2026-11-25').removed, 1);
epStore.close();
fs.rmSync(tmpEpDir, { recursive: true, force: true });

// Offline PDF & Text Reader tests (zlib FlateDecode PDF + Extractive Local Summarizer + Router stays Local)
const zlib = require('node:zlib');
const { extractPdfTextFromBuffer } = require(path.join(ROOT, 'electron/doc-reader.cjs'));
const { isTextOrDocAttachment, summarizeTextLocally } = await import(pathToFileURL(path.join(ROOT, 'src/services/docExtractor.js')).href);
const compressedPdfStream = zlib.deflateSync(Buffer.from('BT (Hello JEEVA Offline PDF Reader) Tj ET', 'latin1'));
const fakePdfBuf = Buffer.concat([
  Buffer.from('%PDF-1.4\n1 0 obj << /Type /Page >> endobj\n2 0 obj << /Filter /FlateDecode >>\nstream\n', 'latin1'),
  compressedPdfStream,
  Buffer.from('\nendstream endobj\n%%EOF', 'latin1'),
]);
const pdfExtracted = extractPdfTextFromBuffer(fakePdfBuf);
assert.equal(pdfExtracted.isScannedPdf, false);
assert.ok(pdfExtracted.text.includes('Hello JEEVA Offline PDF Reader'));
assert.equal(isTextOrDocAttachment({ name: 'notes.pdf', mimeType: 'application/pdf', isImage: false }), true);
assert.equal(isTextOrDocAttachment({ name: 'notes.txt', mimeType: 'text/plain', isImage: false }), true);
assert.equal(isTextOrDocAttachment({ name: 'photo.png', mimeType: 'image/png', isImage: true }), false);
assert.equal(assessQueryRouting('Summarize this PDF', { name: 'notes.pdf', mimeType: 'application/pdf' }, 'auto').shouldTryLocalFirst, true);
assert.ok(summarizeTextLocally('First clear sentence about JEEVA offline AI. Second sentence about CPU efficiency. Third sentence about RAM safety.', 2).length > 20);

// Screen Reader routing & tool-picker checks
assert.equal(assessQueryRouting('Screen par kya likha hai padh kar sunao', null, 'auto').shouldTryLocalFirst, true);
assert.ok(pickTopToolsForQuery('read active screen and click submit button', 4).includes('screen_reader'));

// Advanced Voice Detection DSP, AGC Normalization, Phonetic Repair & VAD Sensitivity checks
const { applyHighPassRumbleFilter, normalizePcmForStt, getVadSensitivity } = await import(pathToFileURL(path.join(ROOT, 'src/services/voiceCapture.js')).href);
const { repairVoiceTranscript } = await import(pathToFileURL(path.join(ROOT, 'src/services/voiceRouter.js')).href);
assert.equal(getVadSensitivity(), 'balanced');
const dcRumble = new Float32Array(320).fill(0.4);
const hpOut = applyHighPassRumbleFilter(dcRumble);
assert.ok(Math.abs(hpOut[hpOut.length - 1]) < 0.02); // High-pass cancels steady DC/hum
const quietSpeech = new Float32Array(640);
for (let i = 160; i < 480; i++) quietSpeech[i] = Math.sin(i * 0.25) * 0.08;
const normOut = normalizePcmForStt(quietSpeech, 16000);
assert.ok(Math.max(...Array.from(normOut, Math.abs)) >= 0.55); // Boosted toward crisp 0.70 target
const repaired = repairVoiceTranscript('Hey Jeeva wollum 50 karo aur crome kholo');
assert.ok(repaired.toLowerCase().includes('volume 50') && repaired.toLowerCase().includes('chrome'));


// NSIS uninstall safety: real uninstall prompts, silent/update paths preserve user data.
const uninstallNsis = readRel('build/uninstaller.nsh');
assert.ok(uninstallNsis.includes('!macro customUnInstall'), 'NSIS custom uninstall hook must be present');
assert.ok(uninstallNsis.includes('${ifNot} ${isUpdated}'), 'Uninstall cleanup must not run during installer-driven updates');
assert.ok(uninstallNsis.includes('IfSilent jeeva_keep_app_data') && uninstallNsis.includes('/SD IDNO'),
  'Silent uninstall must preserve app data without a prompt');
assert.ok(uninstallNsis.includes('MB_YESNO|MB_DEFBUTTON2') && uninstallNsis.includes('/SD IDNO') && uninstallNsis.includes('IDYES jeeva_delete_app_data'),
  'Interactive uninstall must ask for explicit consent, defaulting to keep data');
assert.ok(uninstallNsis.includes('${APP_FILENAME}') && uninstallNsis.includes('${APP_PRODUCT_FILENAME}') && uninstallNsis.includes('${APP_PACKAGE_NAME}'),
  'Data cleanup must cover JEEVA app-data names used by electron-builder');
assert.ok(uninstallNsis.includes('com.roushan.jeeva-ai') && uninstallNsis.includes('JEEVA AI.lnk'),
  'Uninstall must remove only JEEVA startup entries');
const desktopPackage = JSON.parse(readRel('package.json'));
assert.equal(desktopPackage.version, '1.0.1');
assert.equal(desktopPackage.build.nsis.include, 'build/uninstaller.nsh');

// 6. PowerShell AST validation on ALL .ps1 scripts
console.log('[6/6] Checking PowerShell AST across all electron/*.ps1...');
const psFiles = fs.readdirSync(path.join(ROOT, 'electron')).filter((f) => f.endsWith('.ps1'));
const astScript = psFiles
  .map((f) => {
    const full = path.join(ROOT, 'electron', f).replace(/'/g, "''");
    return `$e=$null;[void][System.Management.Automation.Language.Parser]::ParseFile('${full}',[ref]$null,[ref]$e);if($e){throw "AST error in ${f}: $($e[0].Message)"};`;
  })
  .join('');
execFileSync('powershell.exe', ['-NoProfile', '-Command', astScript], { stdio: 'pipe' });

console.log(`ALL_TESTS_PASSED (${psFiles.length} PowerShell scripts, ${declaredTools.length} PC tools, desktop-only modules, DPI mapper, voice router)`);
