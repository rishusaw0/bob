const http = require('http');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');

function compareSemver(a, b) {
  const pa = String(a || '0.0.0').replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '0.0.0').replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const va = pa[i] || 0;
    const vb = pb[i] || 0;
    if (va > vb) return 1;
    if (va < vb) return -1;
  }
  return 0;
}

function fetchJson(targetUrl, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 4) return reject(new Error('Too many redirects'));
    let u;
    try {
      u = new URL(targetUrl);
    } catch {
      return reject(new Error('Invalid update URL'));
    }
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.get(
      u,
      {
        headers: {
          'User-Agent': 'JEEVA-AI-Updater/1.0',
          Accept: 'application/json',
        },
        timeout: 12000,
      },
      (res) => {
        if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume();
          return resolve(fetchJson(res.headers.location, redirects + 1));
        }
        let raw = '';
        res.on('data', (c) => {
          raw += c;
          if (raw.length > 1024 * 1024) req.destroy();
        });
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            return reject(new Error(`Update server HTTP ${res.statusCode}`));
          }
          try {
            resolve(JSON.parse(raw));
          } catch {
            reject(new Error('Invalid JSON response from update endpoint'));
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Update check timed out'));
    });
  });
}

function downloadFileWithProgress(targetUrl, destPath, onProgress, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Too many download redirects'));
    const u = new URL(targetUrl);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') {
      return reject(new Error('Unsupported update download protocol'));
    }
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.get(
      u,
      { headers: { 'User-Agent': 'JEEVA-AI-Updater/1.0' }, timeout: 60000 },
      (res) => {
        if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume();
          return resolve(downloadFileWithProgress(res.headers.location, destPath, onProgress, redirects + 1));
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          res.resume();
          return reject(new Error(`Installer download failed (HTTP ${res.statusCode})`));
        }
        const total = Number(res.headers['content-length']) || 0;
        let received = 0;
        const out = fs.createWriteStream(destPath);
        res.on('data', (chunk) => {
          received += chunk.length;
          if (total > 0 && onProgress) {
            onProgress(Math.min(100, Math.round((received / total) * 100)));
          }
        });
        res.pipe(out);
        out.on('finish', () => out.close(() => resolve({ path: destPath, bytes: received })));
        out.on('error', (err) => {
          fs.unlink(destPath, () => {});
          reject(err);
        });
      }
    );
    req.on('error', reject);
  });
}

function createUpdater({ currentVersion = '1.0.0', shell, onStatus } = {}) {
  let state = {
    checking: false,
    downloading: false,
    progress: 0,
    updateAvailable: false,
    latestVersion: currentVersion,
    downloadUrl: '',
    releaseNotes: '',
    lastError: '',
  };

  function emit(patch) {
    state = { ...state, ...patch };
    onStatus?.({ ...state });
    return { ...state };
  }

  async function checkForUpdates({ githubRepo = '', feedUrl = '' } = {}) {
    emit({ checking: true, lastError: '' });
    try {
      const cleanFeed = String(feedUrl || '').trim();
      const cleanRepo = String(githubRepo || '').trim();
      let endpoint = '';
      if (cleanFeed) {
        endpoint = cleanFeed;
      } else if (/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(cleanRepo)) {
        endpoint = `https://api.github.com/repos/${cleanRepo}/releases/latest`;
      } else {
        return emit({
          checking: false,
          updateAvailable: false,
          lastError: 'Set a GitHub repo (owner/repo) or Render /api/config feed URL first.',
        });
      }

      const data = await fetchJson(endpoint);
      // Support both GitHub Releases payload and JEEVA /api/config JSON
      const remoteVersion = String(
        data.tag_name || data.latestVersion || data.version || currentVersion
      ).replace(/^v/i, '');

      let dlUrl = String(data.installerUrl || data.downloadUrl || '').trim();
      if (!dlUrl && Array.isArray(data.assets)) {
        const exeAsset = data.assets.find((a) => /\.exe$/i.test(a.name || '') && a.browser_download_url);
        if (exeAsset) dlUrl = exeAsset.browser_download_url;
      }

      const newer = compareSemver(remoteVersion, currentVersion) > 0;
      return emit({
        checking: false,
        updateAvailable: newer && Boolean(dlUrl),
        latestVersion: remoteVersion || currentVersion,
        downloadUrl: dlUrl,
        releaseNotes: String(data.body || data.releaseNotes || '').slice(0, 600),
      });
    } catch (err) {
      return emit({
        checking: false,
        lastError: err?.message || 'Failed to check updates',
      });
    }
  }

  async function downloadAndInstall(customUrl = '') {
    const targetUrl = String(customUrl || state.downloadUrl || '').trim();
    if (!targetUrl) {
      return emit({ lastError: 'No installer download URL available.' });
    }
    const dest = path.join(os.tmpdir(), `JEEVA-AI-Update-${Date.now()}.exe`);
    emit({ downloading: true, progress: 0, lastError: '' });
    try {
      const res = await downloadFileWithProgress(targetUrl, dest, (pct) => {
        emit({ progress: pct });
      });
      if (res.bytes < 1024 * 1024) {
        throw new Error('Downloaded installer appears invalid/incomplete.');
      }
      emit({ downloading: false, progress: 100 });
      if (shell?.openPath) {
        await shell.openPath(dest);
      }
      return { ok: true, path: dest, bytes: res.bytes };
    } catch (err) {
      return emit({ downloading: false, lastError: err?.message || 'Download failed' });
    }
  }

  return {
    getState: () => ({ ...state }),
    checkForUpdates,
    downloadAndInstall,
  };
}

module.exports = {
  createUpdater,
  compareSemver,
};
