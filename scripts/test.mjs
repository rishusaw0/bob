import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import * as luIcons from 'react-icons/lu';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, '..');

function readRel(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}


// Installer/release contract: the generated NSIS asset name must exactly match
// both the landing-page direct-download URL and the Render server fallback.
const appPackage = JSON.parse(readRel('package.json'));
const appLock = JSON.parse(readRel('package-lock.json'));
const expectedInstaller = `JEEVA.AI.Setup.${appPackage.version}.exe`;
assert.equal(appLock.version, appPackage.version, 'package-lock root version must match package.json');
assert.equal(appLock.packages?.['']?.version, appPackage.version, 'lockfile root package version must match package.json');
assert.equal(appPackage.build?.nsis?.artifactName, 'JEEVA.AI.Setup.${version}.${ext}', 'NSIS artifact filename must match the published installer URL');
assert.ok(readRel('src/components/LandingPage.jsx').includes(`releases/download/v${appPackage.version}/${expectedInstaller}`), 'Landing page pinned release URL must match NSIS artifact filename and app version');
assert.ok(readRel('server/index.js').includes(`releases/latest/download/${expectedInstaller}`), 'Render fallback installer URL must match NSIS artifact filename');

// 1. Node syntax check on server & all Electron CJS modules
console.log('[1/6] Checking JS/CJS syntax...');
const jsTargets = [
  'server/index.js',
  ...fs.readdirSync(path.join(ROOT, 'electron'))
    .filter((f) => f.endsWith('.cjs'))
    .map((f) => path.join('electron', f)),
];
for (const rel of jsTargets) {
  execFileSync(process.execPath, ['-c', path.join(ROOT, rel)], { stdio: 'pipe' });
}

// Verify every relative CommonJS dependency required by Electron main resolves in source.
console.log('[1b/6] Checking Electron relative module dependencies...');
const electronDir = path.join(ROOT, 'electron');
for (const file of fs.readdirSync(electronDir).filter((f) => f.endsWith('.cjs'))) {
  const source = fs.readFileSync(path.join(electronDir, file), 'utf8');
  for (const hit of source.matchAll(/require\s*\(\s*['"](\.\/?[^'"]+)['"]\s*\)/g)) {
    const target = path.resolve(electronDir, hit[1]);
    const candidates = [target, target + '.cjs', target + '.js', path.join(target, 'index.cjs'), path.join(target, 'index.js')];
    assert.ok(candidates.some((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()),
      `Missing relative Electron dependency ${hit[1]} required by ${file}`);
  }
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
const bridgeSrc = readRel('src/services/bridge.js');

const toolsArrayBlock = toolsSrc.slice(toolsSrc.indexOf('export const TOOLS'), toolsSrc.indexOf('function guessDocumentMime'));
const declaredTools = [...toolsArrayBlock.matchAll(/name:\s*'([a-z_]+)'/g)].map((m) => m[1]);
const execBlock = toolsSrc.slice(toolsSrc.indexOf('export async function executeFunctionCall'));
const handledCases = new Set([...execBlock.matchAll(/case\s*'([a-z_]+)'/g)].map((m) => m[1]));
if (execBlock.includes("name === 'generate_image_tool'")) handledCases.add('generate_image_tool');
if (execBlock.includes("name === 'mobile_browser_action'")) handledCases.add('mobile_browser_action');

const permCases = new Set(
  [...permSrc.slice(permSrc.indexOf('getToolCategory'), permSrc.indexOf('getToolRiskLevel')).matchAll(/case\s*'([a-z_]+)'/g)].map((m) => m[1])
);

for (const t of declaredTools) {
  assert.ok(handledCases.has(t), `Tool "${t}" missing in executeFunctionCall`);
  assert.ok(permCases.has(t), `Tool "${t}" missing in permissions.js getToolCategory`);
}

const preloadInvokes = [...preloadSrc.matchAll(/ipcRenderer\.invoke\(['"]([^'"]+)['"]/g)].map((m) => m[1]);
const mainHandles = new Set([...mainSrc.matchAll(/ipcMain\.handle\(['"]([^'"]+)['"]/g)].map((m) => m[1]));
for (const ch of preloadInvokes) {
  assert.ok(mainHandles.has(ch), `IPC channel "${ch}" exposed in preload.cjs but missing in main.cjs`);
}

const actionsBlock = actionsSrc.slice(actionsSrc.indexOf('const actions = {'), actionsSrc.indexOf('return {\n    actions'));
const actionKeys = [...actionsBlock.matchAll(/^\s{4}(?:async\s+)?([a-zA-Z0-9_]+)\s*\(/gm)].map((m) => m[1]);
const guardCases = new Set(
  [...guardSrc.slice(guardSrc.indexOf('getActionCategory'), guardSrc.indexOf('isActionHighRisk')).matchAll(/case\s*'([a-zA-Z0-9_]+)'/g)].map((m) => m[1])
);
const remoteActions = new Set([...bridgeSrc.matchAll(/callRemoteAction\(['"]([a-zA-Z0-9_]+)['"]/g)].map((m) => m[1]));

for (const act of actionKeys) {
  assert.ok(guardCases.has(act), `Action "${act}" missing in permission-guard.cjs`);
  if (!['liveStats', 'saveImage'].includes(act)) {
    assert.ok(remoteActions.has(act), `Action "${act}" missing in bridge.js remote actions`);
  }
}
console.log(`   Verified ${declaredTools.length} tools, ${preloadInvokes.length} IPC handlers, ${actionKeys.length} actions.`);

// 3. Unit tests: coord-mapper DPI math, updater semver, pc-scheduler, permission-guard, security guardrails, memory RAG, server store & WS codec
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

// 3b. Offline semantic intent confidence, multilingual normalization & safe rejection
console.log('[3b/6] Testing offline semantic intent classifier...');
const commandUnderstandingUrl = pathToFileURL(path.join(ROOT, 'src/services/commandUnderstanding.js')).href;
const { extractCommandEntities, resolveContextualFollowUp, isAmbiguousCommand } = await import(commandUnderstandingUrl);
const entities = extractCommandEntities('Chrome kholo, volume 65 percent, 10 minutes, date 2026-12-04', new Date(2026, 10, 28));
assert.equal(entities.appName, 'Chrome');
assert.equal(entities.percentage, 65);
assert.equal(entities.timerSeconds, 600);
assert.equal(entities.date, '2026-12-04');
assert.deepEqual(resolveContextualFollowUp('ab ise band kar do', { lastApp: 'Chrome' }), { kind: 'close_app', appName: 'Chrome' });
assert.equal(resolveContextualFollowUp('ab ise band kar do', {}).kind, 'clarify');
assert.equal(isAmbiguousCommand('open the app'), true);
assert.equal(isAmbiguousCommand('open chrome'), false);

const semanticUrl = pathToFileURL(path.join(ROOT, 'src/services/semanticIntent.js')).href;
const {
  classifyIntent,
  classifyIntentDetailed,
  normalizeHinglishQuery,
  validateIntentCatalog,
} = await import(semanticUrl);

assert.equal(normalizeHinglishQuery('जीवा आवाज़ बढ़ाओ'), 'जीवा volume badhao');
assert.equal(normalizeHinglishQuery('Chrome खोलो'), 'chrome open');
assert.equal(normalizeHinglishQuery('स्क्रीन की रोशनी बढ़ाओ'), 'screen की brightness badhao');

const semanticCases = [
  ['temp cache saaf kar do', 'clean_temp'],
  ['temporary files clean karo', 'clean_temp'],
  ['laptop ki battery kitni bachi hai', 'battery_check'],
  ['battery status batao', 'battery_check'],
  ['wifi ka status dikhao', 'wifi_status'],
  ['dark mode on kar do', 'dark_mode'],
  ['downloads folder arrange kar do', 'organize_downloads'],
  ['ram kaun kha raha hai', 'heavy_processes'],
];
for (const [query, expectedId] of semanticCases) {
  const result = classifyIntentDetailed(query);
  assert.equal(result.match?.id, expectedId, `Intent mismatch for "${query}": ${JSON.stringify(result)}`);
  assert.ok(result.match.confidence >= 0.43, `Confidence below threshold for "${query}"`);
}
assert.equal(classifyIntent('random sentence about my weekend'), null);
assert.equal(classifyIntentDetailed('').reason, 'empty');
for (const unsafe of [
  'delete my files',
  'chrome uninstall kar do',
  'shutdown my pc',
  'format drive',
  'files hata do',
  'फाइलें मिटाओ',
]) {
  assert.equal(classifyIntent(unsafe), null, `Unsafe intent must not auto-match: "${unsafe}"`);
  assert.equal(classifyIntentDetailed(unsafe).reason, 'unsafe');
}
const ambiguous = classifyIntentDetailed('battery status', { threshold: 0, margin: 1 });
assert.equal(ambiguous.reason, 'ambiguous');
assert.equal(ambiguous.match, null);
const catalog = validateIntentCatalog();
assert.equal(catalog.ok, true, `Duplicate intent catalog entries: ${catalog.issues.join(', ')}`);
assert.equal(classifyIntent('battery status batao')?.id, 'battery_check');

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

// 5. Render Server timed & scoped share tokens verification
console.log('[5/6] Testing Render server expiring/scoped share links...');
const serverUrl = pathToFileURL(path.join(ROOT, 'server/index.js')).href;
const {
  createTimedShareToken,
  getRelayAuthContext,
  isActionAllowedForReadOnly,
  hashPairToken,
  UPDATE_LATEST_VERSION,
} = await import(serverUrl);

assert.ok(UPDATE_LATEST_VERSION);
const ownerPair = 'JVA-TEST-OWNR-1234';
const ownerKey = `pair:${hashPairToken(ownerPair)}`;

const tmpFull = createTimedShareToken({ ownerKey, ttlMinutes: 60, scope: 'full' });
assert.ok(tmpFull.shareToken.startsWith('JVA-TMP-'));
assert.equal(tmpFull.scope, 'full');

const fullCtx = getRelayAuthContext({ headers: { 'x-pair-token': tmpFull.shareToken } });
assert.equal(fullCtx.ownerKey, ownerKey);
assert.equal(fullCtx.scope, 'full');
assert.equal(fullCtx.expired, false);

const tmpRo = createTimedShareToken({ ownerKey, ttlMinutes: 30, scope: 'read_only' });
const roCtx = getRelayAuthContext({ headers: { 'x-pair-token': tmpRo.shareToken } });
assert.equal(roCtx.ownerKey, ownerKey);
assert.equal(roCtx.scope, 'read_only');
assert.equal(isActionAllowedForReadOnly('runCommand', ['echo hack']), false);
assert.equal(isActionAllowedForReadOnly('liveStats', []), true);
assert.equal(isActionAllowedForReadOnly('diagnostics', ['kill_process', '123']), false);
assert.equal(isActionAllowedForReadOnly('diagnostics', ['overview']), true);

const fakeTmpCtx = getRelayAuthContext({ headers: { 'x-pair-token': 'JVA-TMP-DOESNOTEXIST' } });
assert.equal(fakeTmpCtx.ownerKey, null);
assert.equal(fakeTmpCtx.expired, true);

// WebSocket codec & Server Store persistence tests
const wsUrl = pathToFileURL(path.join(ROOT, 'server/ws-codec.js')).href;
const storeUrl = pathToFileURL(path.join(ROOT, 'server/store.js')).href;
const { computeWebSocketAccept, encodeServerFrame, createFrameReader } = await import(wsUrl);
const { createServerStore } = await import(storeUrl);
assert.equal(computeWebSocketAccept('dGhlIHNhbXBsZSBub25jZQ=='), 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
let decodedWs = '';
const reader = createFrameReader((op, pay) => {
  if (op === 1) decodedWs = pay.toString('utf8');
});
reader(encodeServerFrame(1, Buffer.from('hello-ws', 'utf8')));
assert.equal(decodedWs, 'hello-ws');

const tmpStoreDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jeeva-test-store-'));
const st1 = await createServerStore(tmpStoreDir);
st1.setShareToken('hash123', { ownerKey: 'owner:test', scope: 'read_only', expiresAt: Date.now() + 60000, createdAt: Date.now() });
st1.close();
const st2 = await createServerStore(tmpStoreDir);
assert.equal(st2.getShareToken('hash123')?.scope, 'read_only');
st2.close();
fs.rmSync(tmpStoreDir, { recursive: true, force: true });

// Hybrid Local AI Brain tests (Semantic Intent, Top-4 Tool Pruning, Escalation Gatekeeper & Hardware Profile)
const { pickTopToolsForQuery } = await import(pathToFileURL(path.join(ROOT, 'src/services/semanticIntent.js')).href);
const { assessQueryRouting, compactHistoryForCloud } = await import(pathToFileURL(path.join(ROOT, 'src/services/brainRouter.js')).href);
const { detectHardwareProfile, LOW_END_MODELS, getSafeThreadCount, getModelResourceProfile, isLoopbackEndpoint } = require(path.join(ROOT, 'electron/local-brain.cjs'));
const { validateLocalToolCall } = await import(pathToFileURL(path.join(ROOT, 'src/services/localLlm.js')).href);

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
assert.ok(hw.totalGb > 0 && hw.safeThreads >= 1 && hw.safeThreads <= 3);
assert.equal(getSafeThreadCount(2, 4), 1);
assert.equal(getSafeThreadCount(4, 8), 1);
assert.equal(getSafeThreadCount(8, 8), 2);
assert.equal(getSafeThreadCount(16, 16), 3);
const ultraProfile = getModelResourceProfile('qwen2.5:0.5b', 4);
assert.equal(ultraProfile.numCtx, 1024);
assert.equal(ultraProfile.maxTokens, 192);
assert.ok(ultraProfile.minFreeRamGb > 1.2);
assert.equal(isLoopbackEndpoint('http://127.0.0.1:11434'), true);
assert.equal(isLoopbackEndpoint('https://example.com/v1'), false);
assert.ok(LOW_END_MODELS.some((m) => m.id === 'qwen2.5:1.5b'));
const localBrainSource = readRel('electron/local-brain.cjs');
const electronMainSource = readRel('electron/main.cjs');
assert.ok(localBrainSource.includes("action === 'auto_setup'"), 'Local Brain must expose automatic first-launch setup');
assert.ok(localBrainSource.includes("action === 'retry_auto_setup'"), 'Local Brain must allow explicit retry after failed setup');
assert.ok(electronMainSource.includes('if (app.isPackaged)') && electronMainSource.includes("setup('auto_setup')"), 'Packaged app must trigger non-blocking first-launch model setup');

const allowedLocalTool = validateLocalToolCall('open_application', { app_name: 'chrome' }, ['open_application']);
assert.equal(validateLocalToolCall('run_system_command', { command: 'whoami' }, ['run_system_command']).ok, false);
assert.equal(allowedLocalTool.ok, true);
assert.equal(validateLocalToolCall('run_system_command', { command: 'whoami' }, ['open_application']).ok, false);
assert.equal(validateLocalToolCall('open_application', { app_name: 42 }, ['open_application']).ok, false);
assert.equal(validateLocalToolCall('open_application', { app_name: 'chrome', extra: true }, ['open_application']).ok, false);
assert.equal(validateLocalToolCall('control_volume', { action: 'delete' }, ['control_volume']).ok, false);
assert.ok(compactHistoryForCloud([{ role: 'user', text: 'hi' }, { role: 'assistant', text: 'hello' }, { role: 'user', text: 'a' }, { role: 'assistant', text: 'b' }, { role: 'user', text: 'c' }], 2).includes('CONVERSATION CONTEXT DIGEST'));

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
// Desktop brand icon & packaging checks
assert.ok(fs.existsSync(path.join(ROOT, 'public/icon.png')));
assert.ok(fs.readFileSync(path.join(ROOT, 'public/icon.svg'), 'utf8').includes('viewBox="0 0 128 128"'));

// Regression tests: Strict Offline Mode, NSIS installer hooks & offline-voice resilience
const {
  isStrictOfflineMode,
  setStrictOfflineMode,
  assertCloudAllowed,
  SERVICE_CLASSIFICATION,
} = await import(pathToFileURL(path.join(ROOT, 'src/services/offlineMode.js')).href);
assert.equal(isStrictOfflineMode(), false);
assert.ok(SERVICE_CLASSIFICATION.length >= 10);
setStrictOfflineMode(true);
assert.equal(isStrictOfflineMode(), true);
assert.throws(() => assertCloudAllowed('Gemini Cloud Chat'), /Strict Offline Mode/);
setStrictOfflineMode(false);
assert.ok(fs.existsSync(path.join(ROOT, 'build/installer.nsh')));
const installerNsh = fs.readFileSync(path.join(ROOT, 'build/installer.nsh'), 'utf8');
assert.ok(installerNsh.includes('${ifNot} ${isUpdated}'), 'Uninstall cleanup must not run during updates');
assert.ok(installerNsh.includes('taskkill /IM "JEEVA AI.exe"') && installerNsh.includes('taskkill /F /IM "JEEVA AI.exe" /T'), 'Installer must try graceful shutdown before force-kill fallback');
assert.ok(installerNsh.includes('IfSilent jeeva_keep_app_data') && installerNsh.includes('/SD IDNO'), 'Silent/default uninstall must preserve user data');
const pkgJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
assert.equal(pkgJson.build?.nsis?.include, 'build/installer.nsh');
const { createOfflineVoice } = require(path.join(ROOT, 'electron/offline-voice.cjs'));
const ov = createOfflineVoice({ resolveUnpackedPath: () => '' });
const emptyDict = await ov.dictateOnce(3);
assert.equal(emptyDict.text, '');
assert.equal(typeof ov.getStatus().supportsFullHindiHinglish, 'boolean');
const noWhisper = await ov.transcribeAudioBase64('UklGRg==', { language: 'hi' });
assert.equal(noWhisper.ok, false);

// Offline ASR engine integration, language selection, and fallback policy tests
console.log('[ASR] Testing Whisper.cpp, Vosk capability reporting, SAPI fallback, and language paths...');
const {
  createOfflineVoice: createAsrVoice,
  detectLocalAsrEngines,
  normalizeAsrLanguage,
  decodePcmWavBase64,
  cleanWhisperOutput,
} = require(path.join(ROOT, 'electron/offline-voice.cjs'));
const asrRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jeeva-asr-test-'));
const modelsDir = path.join(asrRoot, 'voice-models');
fs.mkdirSync(modelsDir, { recursive: true });
fs.mkdirSync(path.join(modelsDir, 'vosk-model-small-hi'), { recursive: true });
const voskOnly = detectLocalAsrEngines(asrRoot);
assert.equal(voskOnly.voskReady, false, 'Vosk must not be advertised without a wired runtime');
assert.equal(voskOnly.voskSupported, false);
assert.equal(voskOnly.whisperReady, false);
fs.writeFileSync(path.join(modelsDir, 'whisper-cli.exe'), '');
fs.writeFileSync(path.join(modelsDir, 'ggml-small.bin'), '');
const whisperDetected = detectLocalAsrEngines(asrRoot);
assert.equal(whisperDetected.whisperReady, true);
assert.equal(whisperDetected.engineType, 'whisper.cpp');
assert.equal(whisperDetected.supportsFullHindiHinglish, true);
assert.equal(normalizeAsrLanguage('hi-IN'), 'hi');
assert.equal(normalizeAsrLanguage('en-IN'), 'en');
assert.equal(normalizeAsrLanguage('Hinglish'), 'auto');
assert.equal(cleanWhisperOutput('whisper_init_from_file: model loaded\n[00:00:01.000 --> 00:00:02.000] नमस्ते Jeeva'), 'नमस्ते Jeeva');
const makeWavB64 = () => {
  const wav = Buffer.alloc(46);
  wav.write('RIFF', 0); wav.writeUInt32LE(38, 4); wav.write('WAVE', 8);
  wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16000, 24);
  wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(2, 40);
  wav.writeInt16LE(0, 44);
  return wav.toString('base64');
};
const validWav = makeWavB64();
assert.equal(decodePcmWavBase64(validWav).ok, true);
assert.equal(decodePcmWavBase64('UklGRg==').ok, false);
const { EventEmitter } = require('node:events');
const spawnCalls = [];
const fakeSpawn = (exe, args) => {
  spawnCalls.push({ exe, args });
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { end() {} };
  child.kill = () => {};
  queueMicrotask(() => {
    child.stdout.emit('data', Buffer.from('नमस्ते Jeeva'));
    child.emit('close', 0);
  });
  return child;
};
const asrVoice = createAsrVoice({ userDataDir: asrRoot, resolveUnpackedPath: () => '', spawnProcess: fakeSpawn });
const hindiTranscript = await asrVoice.transcribeAudioBase64(validWav, { language: 'hi' });
assert.equal(hindiTranscript.ok, true);
assert.equal(hindiTranscript.text, 'नमस्ते Jeeva');
assert.equal(hindiTranscript.engine, 'whisper.cpp');
assert.ok(spawnCalls[0].args.includes('hi'));
assert.ok(!spawnCalls[0].args.includes('--no-prints'), 'Do not suppress Whisper transcript output');
for (const lang of ['en', 'auto']) {
  const result = await asrVoice.transcribeAudioBase64(validWav, { language: lang });
  assert.equal(result.ok, true);
  const call = spawnCalls[spawnCalls.length - 1];
  assert.equal(call.args[call.args.indexOf('-l') + 1], lang, `Whisper must receive requested language: ${lang}`);
}
const emptyVoice = createAsrVoice({ userDataDir: asrRoot, resolveUnpackedPath: () => '' });
const invalidWav = await emptyVoice.transcribeAudioBase64('UklGRg==');
assert.equal(invalidWav.ok, false);
const sapiVoice = createAsrVoice({
  userDataDir: asrRoot,
  resolveUnpackedPath: (name) => name,
  spawnProcess: (exe, args) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    child.stdin = { end() {} }; child.kill = () => {};
    assert.ok(args.includes('hi'), 'SAPI dictation must receive requested language');
    queueMicrotask(() => {
      child.stdout.emit('data', Buffer.from(JSON.stringify({ type: 'dictation', text: 'नमस्ते', culture: 'hi-IN' }) + '\n'));
      child.emit('close', 0);
    });
    return child;
  },
});
const sapiResult = await sapiVoice.dictateOnce(3, { language: 'hi' });
assert.equal(sapiResult.text, 'नमस्ते');
assert.equal(sapiResult.engine, 'windows-sapi');
assert.equal(sapiResult.fallback, true);
fs.rmSync(asrRoot, { recursive: true, force: true });

// Language regression phrases used for manual microphone QA; text cases do not claim acoustic accuracy.
const asrLanguageCases = [
  { language: 'hi', phrase: 'नमस्ते जीवा, आवाज़ बढ़ाओ' },
  { language: 'en', phrase: 'Hey Jeeva, increase the volume to fifty percent' },
  { language: 'auto', phrase: 'Jeeva volume 50 kar do aur Chrome kholo' },
];
assert.deepEqual(asrLanguageCases.map((x) => x.language), ['hi', 'en', 'auto']);
const voiceCaptureSource = fs.readFileSync(path.join(ROOT, 'src/services/voiceCapture.js'), 'utf8');
assert.ok(voiceCaptureSource.includes('api.offlineVoiceDictate(7, { language })'));
assert.ok(voiceCaptureSource.indexOf('if (isStrictOfflineMode())') < voiceCaptureSource.indexOf("return await transcribeAudio(wavBase64, 'audio/wav', opts)"), 'Strict Offline check must occur before cloud transcription');
const preloadSource = fs.readFileSync(path.join(ROOT, 'electron/preload.cjs'), 'utf8');
assert.ok(preloadSource.includes("offlineVoiceDictate: (timeoutSec, opts)"));
const mainSource = fs.readFileSync(path.join(ROOT, 'electron/main.cjs'), 'utf8');
assert.ok(mainSource.includes("userDataDir: app.getPath('userData')"));
const sapiScript = fs.readFileSync(path.join(ROOT, 'electron/win-voice.ps1'), 'utf8');
assert.ok(sapiScript.includes('[string]$Culture = "auto"') && sapiScript.includes('No installed Windows SAPI recognizer matches requested culture'));
assert.ok(sapiScript.includes('System.Speech.Recognition.DictationGrammar'));

// Local Document RAG Search + Hardware GPU/RAM AI Model Selection + Strict Offline Cloud Block tests
const { indexDocumentChunks, searchLocalDocuments } = await import(pathToFileURL(path.join(ROOT, 'src/services/docExtractor.js')).href);
const docChunks = indexDocumentChunks('sales_2026.xlsx', 'Q1 Total Sales: 145000 INR.\n\nQ2 Total Sales: 210000 INR.', 60);
const docHits = searchLocalDocuments('total sales Q2', [{ name: 'sales_2026.xlsx', chunks: docChunks }], 2);
assert.ok(docHits.length >= 1 && docHits[0].source === 'sales_2026.xlsx' && docHits[0].section.startsWith('Section '));

const hwProf = detectHardwareProfile();
assert.ok(hwProf.totalGb > 0 && hwProf.recommendedModel && 'gpuVramGb' in hwProf);

const { startLiveVoiceCall } = await import(pathToFileURL(path.join(ROOT, 'src/services/liveAudio.js')).href);
const {
  sendMessage: sendCloudMsg,
  transcribeAudio: transcribeCloudAudio,
  textToSpeech: cloudTts,
  createReplicatedVoice: cloudVoiceClone,
  generateImage: cloudImageGen,
} = await import(pathToFileURL(path.join(ROOT, 'src/services/gemini.js')).href);
setStrictOfflineMode(true);
await assert.rejects(() => startLiveVoiceCall(), /Strict Offline Mode/);
await assert.rejects(() => sendCloudMsg('hello'), /Strict Offline Mode/);
await assert.rejects(() => transcribeCloudAudio('UklGRg=='), /Strict Offline Mode/);
await assert.rejects(() => cloudTts('hello'), /Strict Offline Mode/);
await assert.rejects(() => cloudVoiceClone({ sourceWavBase64: 'a', consentWavBase64: 'b' }), /Strict Offline Mode/);
await assert.rejects(() => cloudImageGen('cat'), /Strict Offline Mode/);
setStrictOfflineMode(false);

// Electron Permission Policy security tests (Default Deny)
const { evaluateElectronPermission } = require(path.join(ROOT, 'electron/permission-policy.cjs'));
assert.equal(evaluateElectronPermission({ permission: 'audioCapture', origin: 'file:///app/index.html' }), true);
assert.equal(evaluateElectronPermission({ permission: 'audioCapture', origin: 'https://evil.example.com' }), false);
assert.equal(evaluateElectronPermission({ permission: 'media', origin: 'http://127.0.0.1:5173', mediaTypes: ['audio'] }), true);
assert.equal(evaluateElectronPermission({ permission: 'media', origin: 'file:///app/index.html', mediaTypes: ['video'] }), false);
assert.equal(evaluateElectronPermission({ permission: 'geolocation', origin: 'file:///app/index.html' }), false);
assert.equal(evaluateElectronPermission({ permission: 'notifications', origin: 'file:///app/index.html' }), false);
assert.equal(evaluateElectronPermission({ permission: 'unknown-perm', origin: 'file:///app/index.html' }), false);

// Regression tests for Bugs A-F (Notch hide persistence, Startup separation, Voice crash recovery, Duplicate Settings, Hide label)
const settingsSrc = fs.readFileSync(path.join(ROOT, 'src/components/SettingsPanel.jsx'), 'utf8');
assert.equal((settingsSrc.match(/Custom Voice Activation Phrase/g) || []).length, 1, 'Duplicate Custom Voice Activation Phrase must be removed');
const notchHtml = fs.readFileSync(path.join(ROOT, 'electron/notch-overlay.html'), 'utf8');
assert.ok(!notchHtml.includes('Minimize to Standby Notch') && notchHtml.includes('Hide Camera Notch'));
const wmSrc = fs.readFileSync(path.join(ROOT, 'electron/window-manager.cjs'), 'utf8');
assert.ok(wmSrc.includes('notchUserHidden') && wmSrc.includes('did-finish-load') && wmSrc.includes('isStartupLaunch'));
const voiceHookSrc = fs.readFileSync(path.join(ROOT, 'src/services/useVoiceEngine.js'), 'utf8');
assert.ok(voiceHookSrc.includes('if (notchHiddenRef.current)'), 'Idle timer must not re-show hidden notch');
assert.ok(fs.readFileSync(path.join(ROOT, 'electron/win-voice.ps1'), 'utf8').includes("In.Peek() -eq -1) {\r\n        break") || fs.readFileSync(path.join(ROOT, 'electron/win-voice.ps1'), 'utf8').includes("In.Peek() -eq -1) {\n        break"));
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
const { applyHighPassRumbleFilter, normalizePcmForStt, getVadSensitivity, transcribeCapturedAudio } = await import(pathToFileURL(path.join(ROOT, 'src/services/voiceCapture.js')).href);
const { repairVoiceTranscript } = await import(pathToFileURL(path.join(ROOT, 'src/services/voiceRouter.js')).href);
assert.equal(getVadSensitivity(), 'balanced');
// Strict Offline must try local Whisper then SAPI, and must never call Gemini after both fail.
const previousWindow = globalThis.window;
let cloudFallbackAttempted = false;
globalThis.window = {
  electronAPI: {
    offlineVoiceTranscribe: async () => ({ ok: false, text: '', reason: 'test Whisper unavailable' }),
    offlineVoiceDictate: async () => ({ type: 'dictation', text: '', reason: 'test SAPI unavailable' }),
  },
};
setStrictOfflineMode(true);
await assert.rejects(
  () => transcribeCapturedAudio('UklGRg==', { language: 'auto' }),
  /Strict Offline Mode: cloud transcription blocked/
);
assert.equal(cloudFallbackAttempted, false);
globalThis.window = {
  electronAPI: {
    offlineVoiceTranscribe: async () => ({ ok: false, text: '' }),
    offlineVoiceDictate: async (_timeout, opts) => ({ type: 'dictation', text: 'स्थानीय पहचान', culture: opts.language === 'hi' ? 'hi-IN' : 'en-IN' }),
  },
};
assert.equal(await transcribeCapturedAudio('UklGRg==', { language: 'hi' }), 'स्थानीय पहचान');
setStrictOfflineMode(false);
if (previousWindow === undefined) delete globalThis.window;
else globalThis.window = previousWindow;
const dcRumble = new Float32Array(320).fill(0.4);
const hpOut = applyHighPassRumbleFilter(dcRumble);
assert.ok(Math.abs(hpOut[hpOut.length - 1]) < 0.02); // High-pass cancels steady DC/hum
const quietSpeech = new Float32Array(640);
for (let i = 160; i < 480; i++) quietSpeech[i] = Math.sin(i * 0.25) * 0.08;
const normOut = normalizePcmForStt(quietSpeech, 16000);
assert.ok(Math.max(...Array.from(normOut, Math.abs)) >= 0.55); // Boosted toward crisp 0.70 target
const repaired = repairVoiceTranscript('Hey Jeeva wollum 50 karo aur crome kholo');
assert.ok(repaired.toLowerCase().includes('volume 50') && repaired.toLowerCase().includes('chrome'));

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

console.log(`ALL_TESTS_PASSED (${psFiles.length} PS scripts, ${declaredTools.length} AI tools, server share-tokens, DPI mapper, voice router)`);
