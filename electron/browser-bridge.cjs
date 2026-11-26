const http = require('http');
const net = require('net');
const crypto = require('crypto');

const CDP_PORT = 9222;

function fetchCdpJson(pathSuffix) {
  return new Promise((resolve, reject) => {
    const req = http.get(
      `http://127.0.0.1:${CDP_PORT}${pathSuffix}`,
      { timeout: 1500 },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          if (res.statusCode >= 400) return reject(new Error(`CDP HTTP ${res.statusCode}`));
          try {
            resolve(JSON.parse(raw));
          } catch {
            reject(new Error('Invalid CDP JSON'));
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('CDP timeout'));
    });
  });
}

// Zero-dependency minimal RFC 6455 WebSocket client for single-request CDP commands
function sendCdpCommand(wsUrl, method, params = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(wsUrl);
    } catch {
      return reject(new Error('Invalid CDP WebSocket URL'));
    }
    const key = crypto.randomBytes(16).toString('base64');
    const socket = net.createConnection(Number(u.port || 9222), u.hostname || '127.0.0.1');
    let settled = false;
    let handshaken = false;
    let buffer = Buffer.alloc(0);

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        socket.destroy();
        reject(new Error('CDP command timed out'));
      }
    }, 6000);

    function finish(err, val) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.end();
      } catch {}
      if (err) reject(err);
      else resolve(val);
    }

    socket.on('connect', () => {
      socket.write(
        `GET ${u.pathname}${u.search} HTTP/1.1\r\n` +
          `Host: ${u.host}\r\n` +
          `Upgrade: websocket\r\n` +
          `Connection: Upgrade\r\n` +
          `Sec-WebSocket-Key: ${key}\r\n` +
          `Sec-WebSocket-Version: 13\r\n\r\n`
      );
    });

    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (!handshaken) {
        const hdrEnd = buffer.indexOf('\r\n\r\n');
        if (hdrEnd === -1) return;
        const headerText = buffer.slice(0, hdrEnd).toString('utf8');
        if (!headerText.includes('101')) {
          return finish(new Error('CDP WebSocket handshake rejected'));
        }
        handshaken = true;
        buffer = buffer.slice(hdrEnd + 4);

        const payload = Buffer.from(JSON.stringify({ id: 1, method, params }), 'utf8');
        const mask = crypto.randomBytes(4);
        const len = payload.length;
        let frameHeader;
        if (len < 126) {
          frameHeader = Buffer.alloc(6);
          frameHeader[0] = 0x81;
          frameHeader[1] = 0x80 | len;
          mask.copy(frameHeader, 2);
        } else {
          frameHeader = Buffer.alloc(8);
          frameHeader[0] = 0x81;
          frameHeader[1] = 0x80 | 126;
          frameHeader.writeUInt16BE(len, 2);
          mask.copy(frameHeader, 4);
        }
        const masked = Buffer.alloc(len);
        for (let i = 0; i < len; i++) masked[i] = payload[i] ^ mask[i % 4];
        socket.write(Buffer.concat([frameHeader, masked]));
      }

      // Decode server text frames
      while (buffer.length >= 2) {
        const opcode = buffer[0] & 0x0f;
        let payLen = buffer[1] & 0x7f;
        let offset = 2;
        if (payLen === 126) {
          if (buffer.length < 4) break;
          payLen = buffer.readUInt16BE(2);
          offset = 4;
        } else if (payLen === 127) {
          if (buffer.length < 10) break;
          payLen = Number(buffer.readBigUInt64BE(2));
          offset = 10;
        }
        if (buffer.length < offset + payLen) break;
        const msgBuf = buffer.slice(offset, offset + payLen);
        buffer = buffer.slice(offset + payLen);

        if (opcode === 0x08) {
          return finish(new Error('CDP socket closed'));
        }
        if (opcode === 0x01) {
          try {
            const parsed = JSON.parse(msgBuf.toString('utf8'));
            if (parsed.id === 1) {
              if (parsed.error) return finish(new Error(parsed.error.message || 'CDP error'));
              return finish(null, parsed.result);
            }
          } catch {}
        }
      }
    });

    socket.on('error', (err) => finish(err));
  });
}

function createBrowserBridge({ runPsScript, shell } = {}) {
  async function getPages() {
    try {
      const list = await fetchCdpJson('/json/list');
      return Array.isArray(list) ? list.filter((t) => t.type === 'page') : [];
    } catch {
      return null;
    }
  }

  async function execute(action = 'active_tab_info', value = '') {
    const clean = String(action || 'active_tab_info').toLowerCase();

    if (clean === 'launch_debug') {
      return await runPsScript('win-browser.ps1', ['-Task', 'launch_debug'], 15000);
    }

    if (clean === 'open_url' && value) {
      const pages = await getPages();
      if (pages && pages.length > 0 && pages[0].webSocketDebuggerUrl) {
        await sendCdpCommand(pages[0].webSocketDebuggerUrl, 'Page.navigate', { url: value });
        return { mode: 'cdp', navigatedTo: value };
      }
      await shell.openExternal(value);
      return { mode: 'shell', openedUrl: value };
    }

    // Try CDP rich tab operations when Chrome/Edge debug port 9222 is available
    const pages = await getPages();
    if (pages && pages.length > 0) {
      if (clean === 'list_tabs') {
        return {
          mode: 'cdp',
          tabs: pages.map((p, idx) => ({ index: idx, id: p.id, title: p.title, url: p.url })),
        };
      }
      if (clean === 'switch_tab' && value) {
        const q = String(value).toLowerCase();
        const hit =
          /^\d+$/.test(q) ? pages[Number(q)] : pages.find((p) => (p.title + ' ' + p.url).toLowerCase().includes(q));
        if (!hit) throw new Error(`No browser tab matching "${value}"`);
        await fetchCdpJson(`/json/activate/${hit.id}`);
        return { mode: 'cdp', activated: hit.title, url: hit.url };
      }
      if (clean === 'read_page' && pages[0].webSocketDebuggerUrl) {
        const evalRes = await sendCdpCommand(pages[0].webSocketDebuggerUrl, 'Runtime.evaluate', {
          expression: `JSON.stringify({ title: document.title, url: location.href, text: (document.body?.innerText || '').slice(0, 7500) })`,
          returnByValue: true,
        });
        const val = evalRes?.result?.value;
        return val ? { mode: 'cdp', ...JSON.parse(val) } : { mode: 'cdp', title: pages[0].title, url: pages[0].url };
      }
      if (clean === 'youtube_skip_ad' && pages[0].webSocketDebuggerUrl) {
        const evalRes = await sendCdpCommand(pages[0].webSocketDebuggerUrl, 'Runtime.evaluate', {
          expression: `(() => {
            const btn = document.querySelector('.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern');
            if (btn) { btn.click(); return 'Ad skipped'; }
            const nextBtn = document.querySelector('.ytp-next-button');
            if (nextBtn) { nextBtn.click(); return 'Skipped to next video'; }
            return 'No active skip button found';
          })()`,
          returnByValue: true,
        });
        return { mode: 'cdp', result: evalRes?.result?.value || 'Done' };
      }
    }

    if (clean === 'read_page') {
      const info = await runPsScript('win-browser.ps1', ['-Task', 'active_tab_info'], 12000);
      return {
        mode: 'uia',
        note: 'Full page DOM text needs Chrome/Edge launched with debug mode (browser_control launch_debug). Returning active tab title & URL.',
        tab: JSON.parse(info),
      };
    }

    if (clean === 'list_tabs') {
      const info = await runPsScript('win-browser.ps1', ['-Task', 'active_tab_info'], 12000);
      return {
        mode: 'uia',
        note: 'Single active browser window inspected (launch_debug enables full multi-tab CDP listing).',
        activeTab: JSON.parse(info),
      };
    }

    const psTask = clean === 'youtube_skip_ad' ? 'youtube_next' : clean;
    return await runPsScript('win-browser.ps1', ['-Task', psTask, '-Arg1', String(value || '')], 12000);
  }

  return { execute };
}

module.exports = { createBrowserBridge };
