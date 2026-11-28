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
assert.ok(server.includes('if (!APP_PIN) return false;'), 'server authorization fails closed without APP_PIN');
assert.ok(!server.includes('if (!APP_PIN) return true;'), 'server has no open-by-default auth bypass');
assert.ok(server.includes('Server-managed access is locked'), 'unlock endpoint refuses an unset PIN');

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

console.log('Security/reliability contracts passed: 19 checks.');
