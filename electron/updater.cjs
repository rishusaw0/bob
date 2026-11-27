const http = require('http');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

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
    try { u = new URL(targetUrl); }
    catch { return reject(new Error('Invalid update URL')); }
    if (u.protocol !== 'https:') return reject(new Error('Update metadata must be fetched over HTTPS.'));
    const lib = https;
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

function downloadFileWithProgress(targetUrl, destPath, onProgress, expectedSha256, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Too many download redirects'));
    let u;
    try { u = new URL(targetUrl); } catch { return reject(new Error('Invalid installer URL.')); }
    if (u.protocol !== 'https:') return reject(new Error('Installer downloads and redirects must use HTTPS.'));
    const lib = https;
    const req = lib.get(
      u,
      { headers: { 'User-Agent': 'JEEVA-AI-Updater/1.0' }, timeout: 60000 },
      (res) => {
        if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume();
          return resolve(downloadFileWithProgress(res.headers.location, destPath, onProgress, expectedSha256, redirects + 1));
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          res.resume();
          return reject(new Error(`Installer download failed (HTTP ${res.statusCode})`));
        }
        const total = Number(res.headers['content-length']) || 0;
        let received = 0;
        const hash = crypto.createHash('sha256');
        const out = fs.createWriteStream(destPath);
        res.on('data', (chunk) => {
          received += chunk.length;
          if (received > 500 * 1024 * 1024) {
            req.destroy(new Error('Installer exceeds the 500 MB safety limit.'));
            out.destroy(new Error('Installer exceeds the 500 MB safety limit.'));
            return;
          }
          hash.update(chunk);
          if (total > 0 && onProgress) {
            onProgress(Math.min(100, Math.round((received / total) * 100)));
          }
        });
        res.pipe(out);
        out.on('finish', () => out.close(() => {
          const actual = hash.digest('hex');
          if (actual.toLowerCase() !== String(expectedSha256 || '').toLowerCase()) {
            fs.unlink(destPath, () => {});
            reject(new Error('Installer SHA-256 verification failed. The downloaded file was deleted.'));
            return;
          }
          resolve({ path: destPath, bytes: received, sha256: actual });
        }));
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
    downloadSha256: '',
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
      let digest = String(data.installerSha256 || data.sha256 || '').trim().replace(/^sha256:/i, '');
      if (Array.isArray(data.assets)) {
        const exeAsset = data.assets.find((a) => /\.exe$/i.test(a.name || '') && a.browser_download_url);
        if (exeAsset) {
          if (!dlUrl) dlUrl = exeAsset.browser_download_url;
          if (!digest && exeAsset.digest) digest = String(exeAsset.digest).replace(/^sha256:/i, '');
        }
      }
      const validDigest = /^[a-f0-9]{64}$/i.test(digest);
      const secureUrl = (() => { try { return new URL(dlUrl).protocol === 'https:'; } catch { return false; } })();
      const newer = compareSemver(remoteVersion, currentVersion) > 0;
      if (newer && dlUrl && (!validDigest || !secureUrl)) {
        return emit({
          checking: false, updateAvailable: false, latestVersion: remoteVersion || currentVersion,
          downloadUrl: '', downloadSha256: '',
          lastError: !secureUrl ? 'Update installer URL must use HTTPS.' : 'Release metadata must include a SHA-256 digest (GitHub asset digest or installerSha256).',
        });
      }
      return emit({
        checking: false, updateAvailable: newer && Boolean(dlUrl) && validDigest && secureUrl,
        latestVersion: remoteVersion || currentVersion, downloadUrl: dlUrl,
        downloadSha256: validDigest ? digest.toLowerCase() : '',
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
    const targetUrl = String(state.downloadUrl || '').trim();
    if (customUrl && String(customUrl).trim() !== targetUrl) return emit({ lastError: 'Custom installer URLs are blocked. Check for a trusted update first.' });
    if (!/^[a-f0-9]{64}$/i.test(state.downloadSha256 || '')) return emit({ lastError: 'Installer has no trusted SHA-256 digest. Refusing to execute it.' });
    if (!targetUrl) {
      return emit({ lastError: 'No installer download URL available.' });
    }
    const dest = path.join(os.tmpdir(), `JEEVA-AI-Update-${Date.now()}.exe`);
    emit({ downloading: true, progress: 0, lastError: '' });
    try {
      const res = await downloadFileWithProgress(targetUrl, dest, (pct) => {
        emit({ progress: pct });
      }, state.downloadSha256);
      if (res.bytes < 1024 * 1024) {
        fs.unlink(dest, () => {});
        throw new Error('Downloaded installer appears invalid/incomplete.');
      }
      emit({ downloading: false, progress: 100 });
      if (shell?.openPath) {
        const openError = await shell.openPath(dest);
        if (openError) throw new Error('Could not open verified installer: ' + openError);
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
  downloadFileWithProgress,
};
