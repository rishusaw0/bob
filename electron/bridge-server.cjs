const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');

function getLanIPs() {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        ips.push(net.address);
      }
    }
  }
  return ips;
}

function startBridgeServer({ pin, actions, getPermissionGuard, distDir }) {
  const tlsKeyPath = String(process.env.JEEVA_BRIDGE_TLS_KEY || '').trim();
  const tlsCertPath = String(process.env.JEEVA_BRIDGE_TLS_CERT || '').trim();
  let tlsOptions = null;
  if (tlsKeyPath || tlsCertPath) {
    if (!tlsKeyPath || !tlsCertPath) throw new Error('Both JEEVA_BRIDGE_TLS_KEY and JEEVA_BRIDGE_TLS_CERT are required.');
    tlsOptions = {
      key: fs.readFileSync(path.resolve(tlsKeyPath)),
      cert: fs.readFileSync(path.resolve(tlsCertPath)),
    };
  }
  const lanEnabled = Boolean(tlsOptions);
  const bindHost = lanEnabled ? '0.0.0.0' : '127.0.0.1';
  const resolvedDist = path.resolve(distDir);
  const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.json': 'application/json',
  };

  const requestHandler = (req, res) => {
    const reqPath = (req.url || '/').split('?')[0];

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-jeeva-pin');
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    if (req.method === 'GET' && reqPath === '/api/pc/info') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ online: true, hostname: os.hostname(), protocol: lanEnabled ? 'https' : 'http', lanEnabled, lanIPs: lanEnabled ? getLanIPs() : [] }));
      return;
    }

    if (req.method === 'GET' && !reqPath.startsWith('/api/')) {
      const safeRel = path.normalize(reqPath === '/' ? 'index.html' : reqPath.replace(/^\/+/, ''));
      const fullPath = path.resolve(resolvedDist, safeRel);
      if (
        fullPath.startsWith(resolvedDist + path.sep) &&
        fs.existsSync(fullPath) &&
        fs.statSync(fullPath).isFile()
      ) {
        const ext = path.extname(fullPath).toLowerCase();
        res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
        fs.createReadStream(fullPath).pipe(res);
        return;
      }
      const fallbackIndex = path.join(resolvedDist, 'index.html');
      if (fs.existsSync(fallbackIndex)) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        fs.createReadStream(fallbackIndex).pipe(res);
        return;
      }
    }

    res.setHeader('Content-Type', 'application/json');

    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }

    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 2 * 1024 * 1024) req.destroy();
    });

    req.on('end', async () => {
      let parsed = {};
      try {
        parsed = body ? JSON.parse(body) : {};
      } catch {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
        return;
      }

      if (reqPath === '/api/pc/pair') {
        const now = Date.now();
        if (now < lockUntil) {
          const secs = Math.ceil((lockUntil - now) / 1000);
          res.statusCode = 429;
          res.end(JSON.stringify({ error: `Too many wrong PIN tries. Wait ${secs}s.` }));
          return;
        }
        if (String(parsed.pin || '').trim() === pin) {
          failedAttempts = 0;
          res.end(JSON.stringify({ ok: true, hostname: os.hostname() }));
        } else {
          failedAttempts++;
          if (failedAttempts >= 5) {
            lockUntil = now + 30000;
            failedAttempts = 0;
          }
          res.statusCode = 403;
          res.end(JSON.stringify({ error: 'Invalid PIN' }));
        }
        return;
      }

      if (reqPath === '/api/pc/action') {
        const headerPin = String(req.headers['x-jeeva-pin'] || '').trim();
        if (headerPin !== pin) {
          res.statusCode = 401;
          res.end(
            JSON.stringify({ error: 'Phone not paired with PC. Enter the 4-digit PIN shown on your PC app.' })
          );
          return;
        }
        const fn = actions[parsed.action];
        if (!fn) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: `Unknown PC action: ${parsed.action}` }));
          return;
        }
        try {
          const actionArgs = Array.isArray(parsed.args) ? parsed.args : [];
          const guard = getPermissionGuard?.();
          if (guard) {
            await guard.authorizeRemoteAction({
              action: parsed.action,
              args: actionArgs,
              sourceLabel: 'Wi-Fi / Tunnel Bridge',
            });
          }
          const result = await fn(...actionArgs);
          res.end(JSON.stringify({ ok: true, result }));
        } catch (err) {
          res.statusCode = /permission|blocked|denied/i.test(String(err?.message || err)) ? 403 : 500;
          res.end(JSON.stringify({ error: err?.message || String(err) }));
        }
        return;
      }

      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'Not found' }));
    });
  };
  const server = lanEnabled ? https.createServer(tlsOptions, requestHandler) : http.createServer(requestHandler);

  server.listen(5174, bindHost, () => {
    console.log(`JEEVA Phone-to-PC Bridge active on ${lanEnabled ? 'HTTPS/LAN' : 'localhost only'} at ${bindHost}:5174`);
  });
  server.on('error', (err) => {
    console.log('Bridge server note:', err.message);
  });

  return server;
}

module.exports = {
  getLanIPs,
  startBridgeServer,
};
