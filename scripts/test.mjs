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
    wifi: async (m) => `Wifi ${m}`,
    screenshot: async () => ({ base64: 'data:image/png;base64,test' }),
    theme: async (m) => `Theme ${m}`,
    closeApp: async (a) => `Closed ${a}`,
  },
};

const vrUrl = pathToFileURL(path.join(ROOT, 'src/services/voiceRouter.js')).href;
const vcUrl = pathToFileURL(path.join(ROOT, 'src/services/voiceCapture.js')).href;
const vpUrl = pathToFileURL(path.join(ROOT, 'src/services/voicePermissionPrompt.js')).href;
const vctxUrl = pathToFileURL(path.join(ROOT, 'src/services/voiceContext.js')).href;
const svUrl = pathToFileURL(path.join(ROOT, 'src/services/speakerVerify.js')).href;

const { tryFastVoiceAction, matchWakePhrase, getWakeOpenMode, setWakeOpenMode } = await import(vrUrl);
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

// Acoustic speaker voiceprint tests
const fpSelf = extractVoiceprint(synthVoice, 16000);
assert.ok(fpSelf?.vector?.length === 13);
assert.ok(compareVoiceprints(fpSelf, fpSelf) >= 0.99);
enrollVoiceprintSamples([synthVoice]);
setVoiceprintGuardEnabled(true);
assert.equal(verifySpeakerVoiceprint(synthVoice).verified, true);
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

assert.equal(setWakeOpenMode('full'), 'full');
assert.equal(getWakeOpenMode(), 'full');
assert.equal(setWakeOpenMode('cortana'), 'cortana');

const topBatao = await tryFastVoiceAction('top processes batao');
assert.equal(topBatao.handled, true);
assert.ok(topBatao.replyText.includes('Code'));

const batBatao = await tryFastVoiceAction('battery batao');
assert.equal(batBatao.handled, true);
assert.ok(batBatao.replyText.includes('85%'));

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

const hw = detectHardwareProfile();
assert.ok(hw.totalGb > 0 && hw.safeThreads >= 2);
assert.ok(LOW_END_MODELS.some((m) => m.id === 'qwen2.5:1.5b'));
assert.ok(compactHistoryForCloud([{ role: 'user', text: 'hi' }, { role: 'assistant', text: 'hello' }, { role: 'user', text: 'a' }, { role: 'assistant', text: 'b' }, { role: 'user', text: 'c' }], 2).includes('CONVERSATION CONTEXT DIGEST'));

// Indian-style TTS accent default & Speech Clarity text normalizer tests
const { cleanTextForSpeech, detectVoiceProfile, getVoiceAccent } = await import(pathToFileURL(path.join(ROOT, 'src/services/speech.js')).href);
assert.equal(getVoiceAccent(), 'indian');
assert.equal(detectVoiceProfile('Open Chrome and set brightness to 60 percent'), 'english');
assert.equal(detectVoiceProfile('Bhai laptop bohot slow ho raha hai'), 'hinglish');
const spokenClean = cleanTextForSpeech('Check **C:\\Users\\Demo\\report.pdf** -> 45% CPU & high_performance');
assert.ok(spokenClean.includes('report.pdf') && spokenClean.includes('45 percent') && spokenClean.includes('high performance') && !spokenClean.includes('C:\\Users'));

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
