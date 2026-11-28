import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');

let checks = 0;
function check(condition, message) { assert.ok(condition, message); checks++; }
function equal(actual, expected, message) { assert.equal(actual, expected, message); checks++; }

// Hindi, Hinglish, Roman Hindi and English deterministic PC command corpus.
const { classifyIntentDetailed, normalizeHinglishQuery } =
  await import(pathToFileURL(path.join(ROOT, 'src/services/semanticIntent.js')).href);
const intentCases = [
  ['laptop hang lag slow ho raha hai check karo', 'system_overview'],
  ['volume 50 kar do', 'volume'],
  ['screen ki brightness badhao', 'brightness'],
  ['temp cache junk kachra files clean saaf karo', 'clean_temp'],
  ['downloads folder arrange organize sort saaf karo', 'organize_downloads'],
  ['laptop battery percentage charging status kitni bachi hai', 'battery_check'],
  ['wifi network internet connection kaun sa juda hai', 'wifi_status'],
  ['windows dark mode night theme on lagao', 'dark_mode'],
  ['10 minute baad paani peene ka timer reminder lagao', 'set_reminder'],
];
for (const [query, expected] of intentCases) {
  const result = classifyIntentDetailed(query);
  equal(result.match?.id, expected, 'deterministic intent: ' + query);
}
check(normalizeHinglishQuery('chrome kholo').includes('open'), 'Roman Hindi app-open normalization');

// Contextual follow-up, dates, paths and timer parsing.
const { extractCommandEntities, resolveContextualFollowUp, isAmbiguousCommand } =
  await import(pathToFileURL(path.join(ROOT, 'src/services/commandUnderstanding.js')).href);
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
equal(resolveContextualFollowUp('ab ise band kar do', { lastApp: 'Chrome' }).appName, 'Chrome', 'context close');
equal(resolveContextualFollowUp('ab ise band kar do', {}).kind, 'clarify', 'missing context clarification');
equal(resolveContextualFollowUp('isko dobara kholo', { lastApp: 'Notepad' }).kind, 'open_app', 'context reopen');
equal(isAmbiguousCommand('open the app'), true, 'ambiguous app');
equal(isAmbiguousCommand('open chrome'), false, 'specific app');

// All conversational requests route to Gemini; only deterministic OS actions are handled before this router.
const { assessQueryRouting } =
  await import(pathToFileURL(path.join(ROOT, 'src/services/brainRouter.js')).href);
const onlineRoute = assessQueryRouting('What is a reminder?', null, 'auto', { online: true });
equal(onlineRoute.mode, 'cloud', 'online mode is Gemini');
equal(onlineRoute.forceCloud, true, 'online requests force Gemini');
equal(onlineRoute.forceLocal, false, 'local language model never selected');
equal(onlineRoute.strictNoApi, false, 'old command-only local AI lock disabled');
equal(onlineRoute.shouldTryLocalFirst, false, 'no local AI attempt');
const offlineRoute = assessQueryRouting('Explain this topic', null, 'offline', { online: false });
equal(offlineRoute.mode, 'offline', 'offline state reported');
equal(offlineRoute.forceCloud, false, 'AI cloud call blocked when offline');
equal(offlineRoute.forceLocal, false, 'offline must not use a local LLM');

// Installer/runtime contract: model manager, Whisper and native speech are not shipped or initialized.
const pkg = JSON.parse(read('package.json'));
equal(pkg.version, '1.0.4', 'lightweight installer version');
check(pkg.build.files.includes('!electron/local-brain.cjs'), 'exclude legacy local LLM runtime');
check(pkg.build.files.includes('!electron/offline-voice.cjs'), 'exclude legacy Whisper/SAPI runtime');
check(pkg.build.files.includes('!electron/win-voice.ps1'), 'exclude native local dictation script');

const mainSource = read('electron/main.cjs');
const preloadSource = read('electron/preload.cjs');
const appSource = read('src/App.jsx');
const quickBrain = read('src/services/pcCommandRouter.js');
const voiceCapture = read('src/services/voiceCapture.js');
const speech = read('src/services/speech.js');
const voiceEngine = read('src/services/useVoiceEngine.js');
const settings = read('src/components/SettingsPanel.jsx');
const gemini = read('src/services/gemini.js');

check(!mainSource.includes('createLocalBrainManager'), 'Electron main does not start a local LLM manager');
check(!mainSource.includes('createOfflineVoice'), 'Electron main does not start local Whisper/SAPI');
check(!preloadSource.includes('localBrainChat') && !preloadSource.includes('offlineVoiceDictate'), 'preload exposes no local-model IPC');
check(mainSource.includes("for (const legacyDir of ['local-brain', 'voice-models'])"), 'old JEEVA model cache is cleaned');
check(appSource.includes('runPcCommand') && appSource.includes('pcCommandRouter'), 'deterministic PC command adapter remains enabled');
check(!appSource.includes('runLocalSlmTurn') && !appSource.includes('runLocalDocumentTurn'), 'chat has no local LLM/document answer path');
check(quickBrain.includes('tryFastVoiceAction') && quickBrain.includes('tryLocalSlotAction'), 'basic deterministic Windows actions remain');
check(voiceCapture.includes("return await transcribeAudio(wavBase64, 'audio/wav', opts)"), 'voice transcription goes to Gemini');
check(!voiceCapture.includes('offlineVoiceDictate') && !voiceCapture.includes('offlineVoiceTranscribe'), 'voice has no local ASR fallback');
check(!speech.includes('speechSynthesis') && !speech.includes('speakChunkNative'), 'voice output has no Windows/browser TTS fallback');
check(speech.includes('textToSpeech('), 'voice output uses Gemini TTS');
check(!voiceEngine.includes('startLiveVoiceCall') && !voiceEngine.includes('toggleLiveCall'), 'alternate Live model not activated');
check(settings.includes('Gemini 3.5 Flash-Lite · Fixed'), 'Settings show fixed Gemini model');
check(settings.includes('No Ollama, llama.cpp, Qwen, Gemma'), 'Settings disclose no local LLM');

check(gemini.includes("const GEMINI_MODEL_ID = 'gemini-3.5-flash-lite'"), 'single fixed chat/transcription model');
check(gemini.includes("const GEMINI_TTS_MODEL_ID = 'gemini-3.8-flash-lite-tts'"), 'dedicated Gemini voice output endpoint');
check(gemini.includes('const cfg = { ...config, model: GEMINI_MODEL_ID }'), 'chat retries cannot switch model');
check(gemini.includes("model: GEMINI_TTS_MODEL_ID") && gemini.includes("responseModalities: ['AUDIO']"), 'voice output uses the dedicated Gemini TTS API');
check(gemini.includes('client.models.generateContent') && gemini.includes('inlineData: { mimeType, data: base64Data }'), 'voice transcription is sent to Gemini through the supported multimodal API');
check(!gemini.includes('generateImage') && !read('src/services/tools.js').includes('generate_image_tool'), 'no secondary image model is shipped');
check(!gemini.includes('gemini-4-') && !gemini.includes('gemini-2.5-') && !gemini.includes('gemini-nano-banana'), 'no alternate chat/image models');

const { isStrictOfflineMode, setStrictOfflineMode } =
  await import(pathToFileURL(path.join(ROOT, 'src/services/offlineMode.js')).href);
equal(isStrictOfflineMode(), false, 'legacy strict offline flag ignored');
equal(setStrictOfflineMode(true), false, 'legacy flag cannot re-enable local AI');
equal(isStrictOfflineMode(), false, 'legacy flag stays disabled');

const workflow = read('.github/workflows/ci-release.yml');
check(workflow.includes('npm test'), 'main CI runs full test suite');
check(workflow.includes('npm run test:phase5'), 'CI runs phase 5 architecture/reliability checks');
check(workflow.includes('npm run test:security'), 'CI runs security regression tests');
check(workflow.includes('npm run build:desktop'), 'CI builds Windows NSIS installer');
console.log(`PHASE5_GEMINI_ONLY_PASSED (${checks} checks)`);
