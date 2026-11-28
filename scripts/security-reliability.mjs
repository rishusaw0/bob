import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const { classifyIntentDetailed } = await import(pathToFileURL(path.join(root, 'src/services/semanticIntent.js')).href);

const brightness = classifyIntentDetailed('screen ki brightness badhao');
assert.equal(brightness.match?.id, 'brightness', 'Hinglish brightness increase is recognized');
assert.deepEqual(brightness.match?.args, { action: 'up' }, 'brightness increase maps to up');
const setBrightness = classifyIntentDetailed('brightness 65 set karo');
assert.equal(setBrightness.match?.id, 'brightness', 'brightness percentage is recognized');
assert.deepEqual(setBrightness.match?.args, { action: 'set', level: 65 }, 'brightness percentage maps to set');
const lowerBrightness = classifyIntentDetailed('screen brightness kam karo');
assert.deepEqual(lowerBrightness.match?.args, { action: 'down' }, 'brightness decrease maps to down');

const server = read('server/index.js');
assert.ok(server.includes("url.pathname === '/download'"), 'public server only exposes a download route');
assert.ok(!server.includes('/api/relay/'), 'hosted PC relay is not part of the public server');
assert.ok(!server.includes('/api/gemini'), 'hosted Gemini proxy is not part of the public server');
assert.ok(!server.includes('WebSocket'), 'hosted WebSocket relay is removed');

const main = read('electron/main.cjs');
assert.ok(main.includes('event.sender !== mainWindow.webContents'), 'IPC rejects untrusted senders');
assert.ok(main.includes('authorizeRemoteAction'), 'privileged IPC actions are permission-gated');
assert.ok(main.includes('JEEVA Scheduler'), 'scheduled shell commands are permission-gated');
assert.ok(main.includes('JEEVA Workflow'), 'workflow steps are permission-gated');
const windowManager = read('electron/window-manager.cjs');
assert.ok(windowManager.includes('sandbox: true'), 'renderer sandbox is enabled');

const app = read('src/App.jsx');
assert.ok(app.includes('window.electronAPI.vaultSaveKey(apiKey)'), 'desktop API keys use OS vault');
assert.ok(app.includes("vaultSaveKey?.('')"), 'clearing API key clears OS vault');
assert.ok(app.includes("window.electronAPI ? '' : (localStorage.getItem('jeeva_api_key')"), 'desktop startup never reads key from localStorage');

const permissionGuard = read('electron/permission-guard.cjs');
assert.ok(permissionGuard.includes("if (!highRisk && (policy === 'always'"), 'high-risk actions cannot inherit persistent allow rules');
assert.ok(permissionGuard.includes("action === 'manageProcess' || action === 'diagnostics'"), 'process-kill diagnostics are treated as high risk');
assert.ok(permissionGuard.includes("choice === 'session15' && !highRisk"), 'high-risk actions cannot receive session-wide grants');

const viteConfig = read('vite.config.js');
assert.ok(viteConfig.includes('codeSplitting:'), 'Vite 8 uses supported Rolldown code-splitting groups');
assert.ok(!viteConfig.includes('manualChunks:'), 'Vite config avoids the removed object-form manualChunks option');

const tailwindConfig = read('tailwind.config.js');
assert.ok(tailwindConfig.includes("'./src/**/*.jsx'"), 'Tailwind scans actual JSX UI components');
assert.ok(!tailwindConfig.includes("'./src/**/*.{js,jsx}'"), 'Tailwind does not parse service regex source as class candidates');

assert.ok(read('render.yaml').includes('healthCheckPath: /healthz'), 'Render health check targets static server');
assert.ok(!read('render.yaml').includes('APP_PIN'), 'Render has no app PIN requirement');
assert.ok(read('vite.config.js').includes("mode === 'public' ? 'landing.html' : 'index.html'"), 'public and desktop builds use separate entry points');
assert.ok(read('package.json').includes('vite build --mode desktop'), 'Windows packaging uses the desktop-only entry point');
assert.ok(!read('src/services/bridge.js').includes('/api/relay/'), 'renderer bridge has no hosted relay transport');
console.log('Security/reliability contracts passed: 29 checks.');
