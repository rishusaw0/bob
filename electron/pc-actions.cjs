const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { exec, execFile } = require('child_process');
const { mapCoordsToPhysical } = require('./coord-mapper.cjs');
const { createBrowserBridge } = require('./browser-bridge.cjs');
const { checkPathSafety, checkCommandSafety, checkProcessKillSafety } = require('./security-guardrails.cjs');
const { extractDocumentContent } = require('./doc-reader.cjs');

let prevCpuTotals = null;
function sampleCpuUsagePct() {
  try {
    const cpus = os.cpus();
    if (!cpus || cpus.length === 0) return null;
    let idle = 0;
    let total = 0;
    for (const cpu of cpus) {
      const t = cpu.times;
      idle += t.idle;
      total += t.user + t.nice + t.sys + t.idle + t.irq;
    }
    if (!prevCpuTotals) {
      prevCpuTotals = { idle, total };
      return null;
    }
    const diffIdle = idle - prevCpuTotals.idle;
    const diffTotal = total - prevCpuTotals.total;
    prevCpuTotals = { idle, total };
    if (diffTotal <= 0) return 0;
    return Math.max(0, Math.min(100, Math.round(((diffTotal - diffIdle) / diffTotal) * 100)));
  } catch {
    return null;
  }
}
sampleCpuUsagePct();

function readPrimaryDiskStats() {
  try {
    if (typeof fs.statfsSync !== 'function') return {};
    const rootDrive = process.env.SystemDrive ? `${process.env.SystemDrive}\\` : 'C:\\';
    const st = fs.statfsSync(rootDrive);
    const totalBytes = st.blocks * st.bsize;
    const freeBytes = st.bavail * st.bsize;
    if (!totalBytes) return {};
    return {
      diskDrive: rootDrive.replace(/\\$/, ''),
      diskTotalGb: (totalBytes / 1073741824).toFixed(0),
      diskFreeGb: (freeBytes / 1073741824).toFixed(1),
      diskUsedPct: Math.round(((totalBytes - freeBytes) / totalBytes) * 100),
    };
  } catch {
    return {};
  }
}

function createPcActions({
  shell,
  clipboard,
  desktopCapturer,
  screen,
  resolveUnpackedPath,
  getScheduler,
  getMemoryStore,
  emitRendererEvent,
  showClickReticle,
} = {}) {
  const MAX_CLIPBOARD_HISTORY = 20;
  const clipboardRing = [];
  let lastObservedClip = '';
  let clipboardTimer = null;
  let lastScreenshotMeta = null;

  function pushClipboardItem(rawText) {
    const clean = typeof rawText === 'string' ? rawText : '';
    if (!clean.trim()) return false;
    if (clipboardRing[0] && clipboardRing[0].text === clean) return false;
    const truncated = clean.slice(0, 8000);
    const existingIdx = clipboardRing.findIndex((item) => item.text === truncated);
    if (existingIdx !== -1) clipboardRing.splice(existingIdx, 1);
    clipboardRing.unshift({
      id: crypto.randomBytes(4).toString('hex'),
      text: truncated,
      preview: truncated.replace(/\s+/g, ' ').trim().slice(0, 96),
      length: clean.length,
      timestamp: Date.now(),
    });
    if (clipboardRing.length > MAX_CLIPBOARD_HISTORY) {
      clipboardRing.length = MAX_CLIPBOARD_HISTORY;
    }
    emitRendererEvent?.('clipboard:updated', clipboardRing);
    return true;
  }

  function startClipboardWatcher() {
    if (clipboardTimer) return;
    try {
      lastObservedClip = clipboard.readText() || '';
      if (lastObservedClip.trim()) pushClipboardItem(lastObservedClip);
    } catch {}
    clipboardTimer = setInterval(() => {
      try {
        const current = clipboard.readText() || '';
        if (current && current !== lastObservedClip) {
          lastObservedClip = current;
          pushClipboardItem(current);
        }
      } catch {}
    }, 1000);
    if (typeof clipboardTimer.unref === 'function') clipboardTimer.unref();
  }

  function stopClipboardWatcher() {
    if (clipboardTimer) {
      clearInterval(clipboardTimer);
      clipboardTimer = null;
    }
  }

  function runPsScript(scriptName, args = [], timeoutMs = 20000) {
    const scriptPath = resolveUnpackedPath(scriptName);
    return new Promise((resolve, reject) => {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...args],
        { timeout: timeoutMs },
        (error, stdout, stderr) => {
          if (error) reject(stderr?.trim() || error.message);
          else resolve((stdout || '').trim() || 'Done');
        }
      );
    });
  }

  function runAdb(args) {
    return new Promise((resolve, reject) => {
      execFile('adb', args, { timeout: 10000 }, (error, stdout, stderr) => {
        if (error) {
          reject(stderr?.trim() || 'ADB not installed or no phone connected via USB/Wireless Debugging.');
        } else {
          resolve(stdout?.trim() || 'ADB command sent');
        }
      });
    });
  }

  const browserBridge = createBrowserBridge({ runPsScript, shell });

  const actions = {
    async openApp(appName, appArgs = '') {
      const psArgs = ['-Task', 'open-app', '-Arg1', String(appName || '')];
      if (appArgs) psArgs.push('-Arg2', String(appArgs));
      return await runPsScript('win-control.ps1', psArgs);
    },

    async openURL(url) {
      await shell.openExternal(url);
      return `Opened ${url}`;
    },

    async openSetting(settingName) {
      const map = {
        main: 'ms-settings:',
        wifi: 'ms-settings:network-wifi',
        network: 'ms-settings:network-status',
        hotspot: 'ms-settings:network-mobilehotspot',
        airplane: 'ms-settings:network-airplanemode',
        vpn: 'ms-settings:network-vpn',
        bluetooth: 'ms-settings:bluetooth',
        devices: 'ms-settings:connecteddevices',
        display: 'ms-settings:display',
        sound: 'ms-settings:sound',
        notifications: 'ms-settings:notifications',
        battery: 'ms-settings:batterysaver',
        power: 'ms-settings:powersleep',
        storage: 'ms-settings:storagesense',
        personalization: 'ms-settings:personalization',
        theme: 'ms-settings:themes',
        apps: 'ms-settings:appsfeatures',
        accounts: 'ms-settings:yourinfo',
        time: 'ms-settings:dateandtime',
        privacy: 'ms-settings:privacy',
        windowsupdate: 'ms-settings:windowsupdate',
        keyboard: 'ms-settings:easeofaccess-keyboard',
        mouse: 'ms-settings:mousetouchpad',
        about: 'ms-settings:about',
        camera: 'ms-settings:privacy-webcam',
        mic: 'ms-settings:privacy-microphone',
      };
      const key = String(settingName || 'main').toLowerCase().replace(/[\s_-]/g, '');
      const uri = map[key] || (key.startsWith('ms-settings:') ? key : 'ms-settings:');
      await shell.openExternal(uri);
      return `Opened Windows Settings (${key})`;
    },

    async theme(mode = 'toggle') {
      const safeMode = ['dark', 'light', 'toggle'].includes(mode) ? mode : 'toggle';
      return await runPsScript('win-control.ps1', ['-Task', 'theme', '-Arg1', safeMode]);
    },

    async battery() {
      return await runPsScript('win-control.ps1', ['-Task', 'battery']);
    },

    async wifi(mode = 'status') {
      const safeMode = ['status', 'off', 'disconnect'].includes(mode) ? mode : 'status';
      return await runPsScript('win-control.ps1', ['-Task', 'wifi', '-Arg1', safeMode]);
    },

    async runCommand(command) {
      const check = checkCommandSafety(command);
      if (!check.allowed) throw new Error(check.reason);
      return new Promise((resolve, reject) => {
        exec(command, { timeout: 30000 }, (error, stdout, stderr) => {
          if (error) reject(stderr || error.message);
          else resolve(stdout || stderr || 'Command executed');
        });
      });
    },

    async readFile(filePath) {
      const check = checkPathSafety(filePath, 'read');
      if (!check.allowed) throw new Error(check.reason);
      try {
        getMemoryStore?.()?.remember?.({
          content: `Accessed file ${filePath}`,
          category: 'folder',
          tags: [path.dirname(filePath), path.basename(filePath)],
        });
      } catch {}
      return fs.readFileSync(filePath, 'utf-8');
    },

    async readBinaryFile(filePath) {
      const check = checkPathSafety(filePath, 'read');
      if (!check.allowed) throw new Error(check.reason);
      const stats = fs.statSync(filePath);
      if (stats.size > 15 * 1024 * 1024) {
        throw new Error('File 15 MB se badi hai. Chhoti PDF try karein.');
      }
      const buffer = fs.readFileSync(filePath);
      return {
        base64: buffer.toString('base64'),
        size: stats.size,
        name: path.basename(filePath),
      };
    },

    async extractDocText(payload) {
      return extractDocumentContent(payload || {});
    },

    async writeFile(filePath, content) {
      const check = checkPathSafety(filePath, 'write');
      if (!check.allowed) throw new Error(check.reason);
      fs.writeFileSync(filePath, content, 'utf-8');
      return `File saved: ${filePath}`;
    },

    async listFiles(dirPath) {
      const dir = dirPath || os.homedir();
      const items = fs.readdirSync(dir, { withFileTypes: true });
      return items.map((item) => ({
        name: item.name,
        isDirectory: item.isDirectory(),
        path: path.join(dir, item.name),
      }));
    },

    async searchFiles(query, dirPath) {
      const dir = dirPath || os.homedir();
      const results = [];
      function searchDir(currentDir, depth = 0) {
        if (depth > 3) return;
        try {
          const items = fs.readdirSync(currentDir, { withFileTypes: true });
          for (const item of items) {
            if (item.name.toLowerCase().includes(query.toLowerCase())) {
              results.push({
                name: item.name,
                path: path.join(currentDir, item.name),
                isDirectory: item.isDirectory(),
              });
            }
            if (item.isDirectory() && !item.name.startsWith('.') && results.length < 50) {
              searchDir(path.join(currentDir, item.name), depth + 1);
            }
          }
        } catch {}
      }
      searchDir(dir);
      return results.slice(0, 50);
    },

    async deleteFile(filePath) {
      const check = checkPathSafety(filePath, 'delete');
      if (!check.allowed) throw new Error(check.reason);
      await shell.trashItem(filePath);
      return `Moved to trash: ${filePath}`;
    },

    async clipboard(action, text) {
      if (action === 'read') return clipboard.readText();
      const str = text || '';
      clipboard.writeText(str);
      pushClipboardItem(str);
      lastObservedClip = str;
      return 'Copied to clipboard';
    },

    async systemInfo() {
      return {
        platform: os.platform(),
        hostname: os.hostname(),
        username: os.userInfo().username,
        cpus: os.cpus().length,
        totalMemory: (os.totalmem() / 1073741824).toFixed(1) + ' GB',
        freeMemory: (os.freemem() / 1073741824).toFixed(1) + ' GB',
        uptime: Math.floor(os.uptime() / 3600) + ' hours',
        homeDir: os.homedir(),
      };
    },

    async screenshot(opts = {}) {
      const mode = opts?.mode || 'fast'; // 'fast' (1280px JPEG), 'active_window', or 'full' (1920px PNG)
      const primary = screen.getPrimaryDisplay();
      const scaleFactor = Number(primary?.scaleFactor || 1);
      const physW = Math.round((primary?.size?.width || 1920) * scaleFactor);
      const physH = Math.round((primary?.size?.height || 1080) * scaleFactor);
      const maxWidth = mode === 'full' ? 1920 : 1280;
      const capW = Math.min(physW, maxWidth);
      const capH = Math.round((capW / Math.max(1, physW)) * physH);

      let chosenThumb = null;
      if (mode === 'active_window') {
        try {
          const dispRaw = await runPsScript('win-power.ps1', ['-Task', 'display-info'], 5000).catch(() => '');
          const disp = dispRaw ? JSON.parse(dispRaw) : null;
          const fg = String(disp?.foregroundWindow || '').trim().toLowerCase();
          if (fg) {
            const winSources = await desktopCapturer.getSources({
              types: ['window'],
              thumbnailSize: { width: capW, height: capH },
            });
            const match = winSources.find((w) => w.name && fg.includes(w.name.toLowerCase().slice(0, 12)));
            if (match) chosenThumb = match.thumbnail;
          }
        } catch {}
      }

      if (!chosenThumb) {
        const sources = await desktopCapturer.getSources({
          types: ['screen'],
          thumbnailSize: { width: capW, height: capH },
        });
        if (sources.length > 0) chosenThumb = sources[0].thumbnail;
      }

      if (chosenThumb) {
        const size = chosenThumb.getSize();
        const useJpeg = mode !== 'full';
        const imgBuf = useJpeg ? chosenThumb.toJPEG(78) : chosenThumb.toPNG();
        const ext = useJpeg ? 'jpg' : 'png';
        const filePath = path.join(os.tmpdir(), `jeeva-screenshot-${Date.now()}.${ext}`);
        fs.writeFileSync(filePath, imgBuf);

        lastScreenshotMeta = {
          imageWidth: size.width,
          imageHeight: size.height,
          logicalWidth: primary?.size?.width || size.width,
          logicalHeight: primary?.size?.height || size.height,
          physicalWidth: physW,
          physicalHeight: physH,
          scaleFactor,
          compressed: useJpeg,
          capturedAt: Date.now(),
        };

        return {
          path: filePath,
          base64: `data:image/${useJpeg ? 'jpeg' : 'png'};base64,${imgBuf.toString('base64')}`,
          meta: lastScreenshotMeta,
        };
      }
      throw new Error('No screen source found');
    },

    async volume(action, level = -1) {
      const allowed = new Set(['get', 'up', 'down', 'set', 'mute', 'unmute']);
      if (!allowed.has(action)) throw new Error(`Invalid volume action: ${action}`);
      const safeLevel = Number.isFinite(Number(level)) ? Math.round(Number(level)) : -1;
      return await runPsScript('win-audio.ps1', ['-Action', action, '-Level', String(safeLevel)]);
    },

    async media(action) {
      const keys = { play_pause: 0xB3, next: 0xB0, previous: 0xB1, stop: 0xB2 };
      const vk = keys[action] || 0xB3;
      const ps = `Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public class K { [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, int dwExtraInfo); }'; [K]::keybd_event(${vk}, 0, 0, 0); [K]::keybd_event(${vk}, 0, 2, 0)`;
      return new Promise((resolve, reject) => {
        execFile('powershell.exe', ['-NoProfile', '-Command', ps], (error) => {
          if (error) reject(error.message);
          else resolve(`Media ${action} executed`);
        });
      });
    },

    async brightness(actionOrLevel, maybeLevel = -1) {
      let action = 'set';
      let level = -1;
      if (typeof actionOrLevel === 'number') {
        action = 'set';
        level = actionOrLevel;
      } else if (['get', 'set', 'up', 'down'].includes(actionOrLevel)) {
        action = actionOrLevel;
        level = Number.isFinite(Number(maybeLevel)) ? Math.round(Number(maybeLevel)) : -1;
      } else if (!Number.isNaN(Number(actionOrLevel))) {
        action = 'set';
        level = Math.round(Number(actionOrLevel));
      } else {
        throw new Error(`Invalid brightness action: ${actionOrLevel}`);
      }
      return await runPsScript('win-control.ps1', ['-Task', `brightness-${action}`, '-Num1', String(level)]);
    },

    async power(action) {
      const commands = {
        lock: 'rundll32.exe user32.dll,LockWorkStation',
        sleep: 'rundll32.exe powrprof.dll,SetSuspendState 0,1,0',
        restart: 'shutdown /r /t 5',
        shutdown: 'shutdown /s /t 5',
      };
      const cmd = commands[action];
      if (!cmd) throw new Error('Unknown power action');
      return new Promise((resolve, reject) => {
        exec(cmd, (error) => {
          if (error) reject(error.message);
          else resolve(`System ${action} initiated`);
        });
      });
    },

    async runningApps() {
      return new Promise((resolve, reject) => {
        execFile(
          'powershell.exe',
          [
            '-NoProfile',
            '-Command',
            'ConvertTo-Json -InputObject @(Get-Process | Where-Object {$_.MainWindowTitle -ne ""} | Select-Object Id, ProcessName, MainWindowTitle) -Compress',
          ],
          { timeout: 15000 },
          (error, stdout, stderr) => {
            if (error) reject(stderr?.trim() || error.message);
            else resolve((stdout || '[]').trim() || '[]');
          }
        );
      });
    },

    async closeApp(appName) {
      const cleanName = String(appName || '').replace(/[^a-zA-Z0-9._-]/g, '');
      if (!cleanName) throw new Error('Application name is required');
      const exe = cleanName.endsWith('.exe') ? cleanName : `${cleanName}.exe`;
      return new Promise((resolve, reject) => {
        execFile('taskkill.exe', ['/IM', exe, '/F'], { timeout: 10000 }, (error, stdout, stderr) => {
          if (error) reject(stderr?.trim() || error.message);
          else resolve((stdout || '').trim() || `${exe} closed`);
        });
      });
    },

    async typeText(text) {
      return await runPsScript('win-control.ps1', ['-Task', 'keyboard', '-Arg1', String(text || '')]);
    },

    async minimizeAll() {
      return await runPsScript('win-control.ps1', ['-Task', 'minimize-all']);
    },

    async saveDesktopFile(filename, content) {
      const safeName = path.basename(filename);
      const desktopPath = path.join(os.homedir(), 'Desktop', safeName);
      fs.writeFileSync(desktopPath, content, 'utf-8');
      return `Saved to Desktop: ${desktopPath}`;
    },

    async saveImage(dataUrl, filename) {
      const safeName = path.basename(filename || `jeeva-${Date.now()}.png`);
      const base64 = dataUrl.split(',')[1];
      const desktopPath = path.join(os.homedir(), 'Desktop', safeName);
      fs.writeFileSync(desktopPath, Buffer.from(base64, 'base64'));
      shell.showItemInFolder(desktopPath);
      return desktopPath;
    },

    async liveStats() {
      const total = os.totalmem();
      const free = os.freemem();
      const usedPct = Math.round(((total - free) / total) * 100);
      const cpuUsedPct = sampleCpuUsagePct();
      const disk = readPrimaryDiskStats();
      const sched = getScheduler?.();
      const scheduledCount = sched ? sched.listTasks().length : 0;
      const primary = screen.getPrimaryDisplay();
      return {
        cpuUsedPct,
        ramUsedPct: usedPct,
        ramFreeGb: (free / 1073741824).toFixed(1),
        ramTotalGb: (total / 1073741824).toFixed(0),
        ...disk,
        clipboardCount: clipboardRing.length,
        scheduledCount,
        displayScale: primary?.scaleFactor || 1,
        displaySize: primary?.size ? `${primary.size.width}x${primary.size.height}` : '',
        hostname: os.hostname(),
        username: os.userInfo().username,
      };
    },

    async adbControl(action, arg = '') {
      const clean = String(action || '').toLowerCase();
      switch (clean) {
        case 'devices': return await runAdb(['devices']);
        case 'home': return await runAdb(['shell', 'input', 'keyevent', '3']);
        case 'back': return await runAdb(['shell', 'input', 'keyevent', '4']);
        case 'volume_up': return await runAdb(['shell', 'input', 'keyevent', '24']);
        case 'volume_down': return await runAdb(['shell', 'input', 'keyevent', '25']);
        case 'media_play_pause': return await runAdb(['shell', 'input', 'keyevent', '85']);
        case 'open_url': return await runAdb(['shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', String(arg)]);
        case 'open_app': return await runAdb(['shell', 'monkey', '-p', String(arg), '-c', 'android.intent.category.LAUNCHER', '1']);
        case 'brightness': {
          const val = Math.max(0, Math.min(255, Math.round((Number(arg) / 100) * 255)));
          return await runAdb(['shell', 'settings', 'put', 'system', 'screen_brightness', String(val)]);
        }
        case 'lock': return await runAdb(['shell', 'input', 'keyevent', '26']);
        default: throw new Error(`Unknown ADB action: ${action}`);
      }
    },

    async listInstalledApps(filter = '') {
      return await runPsScript('win-apps.ps1', ['-Task', 'list-installed', '-Arg1', String(filter || '')], 30000);
    },

    async manageSoftware(action, pkg = '') {
      const map = {
        search: 'winget-search',
        install: 'winget-install',
        uninstall: 'winget-uninstall',
        update: 'winget-update',
      };
      const task = map[String(action || '').toLowerCase()];
      if (!task) throw new Error(`Unknown software action: ${action}`);
      return await runPsScript('win-apps.ps1', ['-Task', task, '-Arg1', String(pkg || '')], 150000);
    },

    async windowControl(action, targetApp = '') {
      return await runPsScript('win-apps.ps1', [
        '-Task', 'window-control',
        '-Arg1', String(action || 'focus'),
        '-Arg2', String(targetApp || ''),
      ]);
    },

    async uiAutomate(action, appName = '', element = '', value = '') {
      const map = { inspect: 'ui-inspect', click: 'ui-click', set_text: 'ui-set-text' };
      const task = map[String(action || '').toLowerCase()];
      if (!task) throw new Error(`Unknown UI automation action: ${action}`);
      return await runPsScript(
        'win-apps.ps1',
        ['-Task', task, '-Arg1', String(appName || ''), '-Arg2', String(element || ''), '-Arg3', String(value || '')],
        25000
      );
    },

    async screenRead(mode = 'read', targetText = '') {
      const cleanMode = ['read', 'ocr', 'click_text'].includes(String(mode || '').toLowerCase())
        ? String(mode).toLowerCase()
        : 'read';
      const raw = await runPsScript(
        'win-apps.ps1',
        ['-Task', 'screen-read', '-Arg1', cleanMode, '-Arg2', String(targetText || '')],
        25000
      );
      if (cleanMode === 'click_text') return raw;
      try {
        return JSON.parse(raw);
      } catch {
        return { windowTitle: '', visibleText: [String(raw || '')], ocrText: [], interactiveElements: [] };
      }
    },

    async mouseAction(sub = 'click', x = 0, y = 0, x2 = 0, y2 = 0, delta = -3, coordSpace = 'pixels') {
      const clean = String(sub || 'click').toLowerCase();
      const primary = screen.getPrimaryDisplay();
      const mapped1 = mapCoordsToPhysical({
        x,
        y,
        coordSpace,
        screenshotMeta: lastScreenshotMeta,
        primaryDisplay: primary,
      });

      if (clean === 'scroll') {
        return await runPsScript('win-power.ps1', [
          '-Task', 'mouse-action',
          '-Arg1', 'scroll',
          '-Num1', String(Math.round(Number(delta) || -3)),
          '-Num2', String(mapped1.x),
          '-Num3', String(mapped1.y),
        ], 12000);
      }

      const mapped2 =
        clean === 'drag'
          ? mapCoordsToPhysical({
              x: x2,
              y: y2,
              coordSpace,
              screenshotMeta: lastScreenshotMeta,
              primaryDisplay: primary,
            })
          : { x: 0, y: 0 };

      if (['click', 'double_click', 'right_click'].includes(clean)) {
        await showClickReticle?.(mapped1.x, mapped1.y, primary?.scaleFactor || 1);
      }

      return await runPsScript('win-power.ps1', [
        '-Task', 'mouse-action',
        '-Arg1', clean,
        '-Num1', String(mapped1.x),
        '-Num2', String(mapped1.y),
        '-Num3', String(mapped2.x),
        '-Num4', String(mapped2.y),
      ], 12000);
    },

    async sendHotkey(combo = '') {
      return await runPsScript('win-power.ps1', ['-Task', 'hotkey-combo', '-Arg1', String(combo || '')], 10000);
    },

    async typeClipboard(text = '') {
      const raw = String(text || '');
      pushClipboardItem(raw);
      lastObservedClip = raw;
      const b64 = Buffer.from(raw, 'utf8').toString('base64');
      return await runPsScript('win-power.ps1', ['-Task', 'clipboard-paste-text', '-Arg1', b64, '-Arg2', 'base64'], 12000);
    },

    async diagnostics(sub = 'overview', extra = '') {
      const taskMap = {
        overview: 'cpu-telemetry',
        top_processes: 'top-processes',
        disks: 'disk-space',
        ports: 'network-ports',
        display_info: 'display-info',
      };
      const psTask = taskMap[String(sub || 'overview').toLowerCase()] || 'cpu-telemetry';
      const args = ['-Task', psTask];
      if (psTask === 'top-processes') {
        args.push('-Num1', String(Number(extra) > 0 ? Math.round(Number(extra)) : 15));
        if (extra === 'cpu') args.push('-Arg1', 'cpu');
      }
      return await runPsScript('win-power.ps1', args, 15000);
    },

    async manageProcess(sub = 'top_processes', target = '') {
      const clean = String(sub || 'top_processes').toLowerCase();
      if (clean === 'kill_process') {
        const check = checkProcessKillSafety(target);
        if (!check.allowed) throw new Error(check.reason);
        return await runPsScript('win-power.ps1', ['-Task', 'kill-process', '-Arg1', String(target || '')], 12000);
      }
      return await runPsScript('win-power.ps1', ['-Task', 'top-processes', '-Num1', '15'], 12000);
    },

    async filePro(sub = 'organize_folder', source = '', dest = '') {
      const actionSub = String(sub || '').toLowerCase();
      if (actionSub === 'clean_temp') {
        // Safely purge temporary JEEVA capture files & aged OS user temp files (> 24h)
        const tmpDir = os.tmpdir();
        let cleaned = 0;
        const cutoff = Date.now() - 24 * 3600 * 1000;
        try {
          for (const ent of fs.readdirSync(tmpDir, { withFileTypes: true })) {
            if (!ent.isFile()) continue;
            const full = path.join(tmpDir, ent.name);
            try {
              const st = fs.statSync(full);
              if (ent.name.startsWith('jeeva-screenshot-') || st.mtimeMs < cutoff) {
                fs.unlinkSync(full);
                cleaned++;
              }
            } catch {}
          }
        } catch {}
        return JSON.stringify({ success: true, cleanedFiles: cleaned, tempDir: tmpDir });
      }
      const mode = ['move', 'rename', 'organize_folder'].includes(actionSub) ? 'delete' : 'write';
      const check1 = checkPathSafety(source, mode);
      if (!check1.allowed) throw new Error(check1.reason);
      const check2 = checkPathSafety(dest, 'write');
      if (!check2.allowed) throw new Error(check2.reason);
      return await runPsScript('win-power.ps1', [
        '-Task', 'file-pro',
        '-Arg1', String(sub || ''),
        '-Arg2', String(source || ''),
        '-Arg3', String(dest || ''),
      ], 30000);
    },

    async powerProfile(plan = 'get') {
      return await runPsScript('win-power.ps1', ['-Task', 'power-plan', '-Arg1', String(plan || 'get')], 10000);
    },

    async emptyRecycleBin() {
      return await runPsScript('win-power.ps1', ['-Task', 'empty-recycle-bin'], 15000);
    },

    async clipboardHistory(sub = 'list', index = 0) {
      const clean = String(sub || 'list').toLowerCase();
      if (clean === 'clear') {
        clipboardRing.length = 0;
        emitRendererEvent?.('clipboard:updated', clipboardRing);
        return { success: true, cleared: true, items: [] };
      }
      if (clean === 'paste_index') {
        const idx = Math.max(0, Math.min(clipboardRing.length - 1, Number(index) || 0));
        const item = clipboardRing[idx];
        if (!item) return { error: `No clipboard history item at index ${index}` };
        await actions.typeClipboard(item.text);
        return { success: true, pastedIndex: idx, preview: item.preview };
      }
      return {
        items: clipboardRing.map((item, idx) => ({
          index: idx,
          id: item.id,
          preview: item.preview,
          length: item.length,
          timestamp: item.timestamp,
          text: item.text,
        })),
      };
    },

    async scheduler(sub = 'list', arg1 = '', arg2 = '', arg3 = '') {
      const sched = getScheduler();
      const clean = String(sub || 'list').toLowerCase();
      if (clean === 'remind') {
        return { success: true, task: sched.scheduleReminder({ delayMinutes: arg1, message: arg2 }) };
      }
      if (clean === 'remind_date') {
        const opts = arg1 && typeof arg1 === 'object' ? arg1 : { triggerAt: arg1, message: arg2 };
        return { success: true, task: sched.scheduleDateReminder(opts) };
      }
      if (clean === 'agenda') {
        return sched.getAgendaSummary();
      }
      if (clean === 'ack') {
        return sched.acknowledgeAgenda(String(arg1 || 'all'));
      }
      if (clean === 'delayed_command') {
        return {
          success: true,
          task: sched.scheduleDelayedCommand({ delayMinutes: arg1, command: arg2, description: arg3 }),
        };
      }
      if (clean === 'cancel') {
        return sched.cancelTask(String(arg1 || 'all'));
      }
      return { tasks: sched.listTasks(), macros: sched.macros };
    },

    async browserControl(sub = 'active_tab_info', value = '') {
      return await browserBridge.execute(sub, value);
    },

    async memoryRag(sub = 'recall', contentOrQuery = '', category = 'fact') {
      const store = getMemoryStore?.();
      if (!store) return { items: [], error: 'Memory store unavailable' };
      const clean = String(sub || 'recall').toLowerCase();
      if (clean === 'remember') {
        return { success: true, item: store.remember({ content: contentOrQuery, category }) };
      }
      if (clean === 'forget') {
        return { success: true, ...store.forget(contentOrQuery || 'all') };
      }
      if (clean === 'list') {
        return { items: store.list(60) };
      }
      return { items: store.recall(contentOrQuery, { topK: 6, category: category || '' }) };
    },
  };

  return {
    actions,
    runPsScript,
    startClipboardWatcher,
    stopClipboardWatcher,
    getClipboardCount: () => clipboardRing.length,
  };
}

module.exports = {
  createPcActions,
  sampleCpuUsagePct,
  readPrimaryDiskStats,
};
