const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const PINNED_GITHUB_REPO = 'rishusaw0/bob';

function isAllowedUpdateHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  return (
    host === 'github.com' ||
    host.endsWith('.github.com') ||
    host === 'githubusercontent.com' ||
    host.endsWith('.githubusercontent.com')
  );
}

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
    if (!isAllowedUpdateHost(u.hostname)) {
      return reject(new Error(`Blocked untrusted update host: ${u.hostname}`));
    }
    let settled = false;
    const done = (err, val) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve(val);
    };
    const req = https.get(
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
          let nextUrl;
          try {
            nextUrl = new URL(res.headers.location, u).toString();
          } catch {
            return done(new Error('Invalid redirect URL from update server'));
          }
          return fetchJson(nextUrl, redirects + 1).then((v) => done(null, v), (e) => done(e));
        }
        let raw = '';
        res.on('data', (c) => {
          raw += c;
          if (raw.length > 1024 * 1024) {
            req.destroy(new Error('Update metadata response exceeded size limit'));
          }
        });
        res.on('error', (err) => done(err));
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            return done(new Error(`Update server HTTP ${res.statusCode}`));
          }
          try {
            done(null, JSON.parse(raw));
          } catch {
            done(new Error('Invalid JSON response from update endpoint'));
          }
        });
      }
    );
    req.on('error', (err) => done(err));
    req.on('timeout', () => {
      req.destroy();
      done(new Error('Update check timed out'));
    });
  });
}

function downloadFileWithProgress(targetUrl, destPath, onProgress, expectedSha256, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Too many download redirects'));
    let u;
    try { u = new URL(targetUrl); } catch { return reject(new Error('Invalid installer URL.')); }
    if (u.protocol !== 'https:') return reject(new Error('Installer downloads and redirects must use HTTPS.'));
    if (!isAllowedUpdateHost(u.hostname)) {
      return reject(new Error(`Blocked untrusted download host: ${u.hostname}`));
    }
    let settled = false;
    let out = null;
    const cleanupAndReject = (err) => {
      if (settled) return;
      settled = true;
      if (out) {
        try { out.destroy(); } catch {}
      }
      fs.unlink(destPath, () => {});
      reject(err);
    };
    const req = https.get(
      u,
      { headers: { 'User-Agent': 'JEEVA-AI-Updater/1.0' }, timeout: 60000 },
      (res) => {
        if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume();
          let nextUrl;
          try {
            nextUrl = new URL(res.headers.location, u).toString();
          } catch {
            return cleanupAndReject(new Error('Invalid installer redirect URL.'));
          }
          return downloadFileWithProgress(nextUrl, destPath, onProgress, expectedSha256, redirects + 1)
            .then((val) => {
              if (!settled) {
                settled = true;
                resolve(val);
              }
            })
            .catch((err) => {
              if (!settled) {
                settled = true;
                reject(err);
              }
            });
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          res.resume();
          return cleanupAndReject(new Error(`Installer download failed (HTTP ${res.statusCode})`));
        }
        const total = Number(res.headers['content-length']) || 0;
        let received = 0;
        const hash = crypto.createHash('sha256');
        out = fs.createWriteStream(destPath);
        res.on('data', (chunk) => {
          received += chunk.length;
          if (received > 500 * 1024 * 1024) {
            const sizeErr = new Error('Installer exceeds the 500 MB safety limit.');
            req.destroy(sizeErr);
            cleanupAndReject(sizeErr);
            return;
          }
          hash.update(chunk);
          if (total > 0 && onProgress) {
            onProgress(Math.min(100, Math.round((received / total) * 100)));
          }
        });
        res.on('error', (err) => {
          req.destroy();
          cleanupAndReject(err);
        });
        res.pipe(out);
        out.on('finish', () => out.close(() => {
          if (settled) return;
          const actual = hash.digest('hex');
          if (actual.toLowerCase() !== String(expectedSha256 || '').toLowerCase()) {
            cleanupAndReject(new Error('Installer SHA-256 verification failed. The downloaded file was deleted.'));
            return;
          }
          settled = true;
          resolve({ path: destPath, bytes: received, sha256: actual });
        }));
        out.on('error', (err) => {
          req.destroy();
          cleanupAndReject(err);
        });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      cleanupAndReject(new Error('Installer download timed out.'));
    });
    req.on('error', (err) => cleanupAndReject(err));
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

  async function checkForUpdates() {
    emit({ checking: true, lastError: '' });
    try {
      const endpoint = `https://api.github.com/repos/${PINNED_GITHUB_REPO}/releases/latest`;
      const data = await fetchJson(endpoint);
      const remoteVersion = String(data.tag_name || currentVersion).replace(/^v/i, '');

      let dlUrl = '';
      let digest = '';
      if (Array.isArray(data.assets)) {
        const exeAsset = data.assets.find((asset) => /\.exe$/i.test(asset.name || '') && asset.browser_download_url);
        if (exeAsset) {
          dlUrl = String(exeAsset.browser_download_url || '').trim();
          digest = String(exeAsset.digest || '').replace(/^sha256:/i, '');
        }
      }
      const validDigest = /^[a-f0-9]{64}$/i.test(digest);
      const secureUrl = (() => {
        try {
          const parsed = new URL(dlUrl);
          return parsed.protocol === 'https:' && isAllowedUpdateHost(parsed.hostname);
        } catch {
          return false;
        }
      })();
      const newer = compareSemver(remoteVersion, currentVersion) > 0;
      if (newer && dlUrl && (!validDigest || !secureUrl)) {
        return emit({
          checking: false, updateAvailable: false, latestVersion: remoteVersion || currentVersion,
          downloadUrl: '', downloadSha256: '',
          lastError: !secureUrl ? 'Update installer URL must use HTTPS on a trusted GitHub host.' : 'Release metadata must include a SHA-256 digest (GitHub asset digest or installerSha256).',
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
