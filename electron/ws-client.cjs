// Zero-Dependency RFC-6455 WebSocket Client (CJS for Electron main / cloud-relay.cjs)
const http = require('http');
const https = require('https');
const crypto = require('crypto');

function encodeClientFrame(opcode, payloadBuf = Buffer.alloc(0)) {
  const buf = Buffer.isBuffer(payloadBuf) ? payloadBuf : Buffer.from(String(payloadBuf), 'utf8');
  const len = buf.length;
  const mask = crypto.randomBytes(4);
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  const masked = Buffer.alloc(len);
  for (let i = 0; i < len; i++) masked[i] = buf[i] ^ mask[i % 4];
  return Buffer.concat([header, mask, masked]);
}

function createServerFrameReader(onFrame) {
  let buf = Buffer.alloc(0);
  return (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 2) {
      const b0 = buf[0];
      const b1 = buf[1];
      const opcode = b0 & 0x0f;
      const masked = Boolean(b1 & 0x80);
      let len = b1 & 0x7f;
      let offset = 2;

      if (len === 126) {
        if (buf.length < 4) return;
        len = buf.readUInt16BE(2);
        offset = 4;
      } else if (len === 127) {
        if (buf.length < 10) return;
        len = Number(buf.readBigUInt64BE(2));
        offset = 10;
      }
      const maskLen = masked ? 4 : 0;
      if (buf.length < offset + maskLen + len) return;

      let payload = buf.subarray(offset + maskLen, offset + maskLen + len);
      if (masked) {
        const mask = buf.subarray(offset, offset + 4);
        const out = Buffer.alloc(len);
        for (let i = 0; i < len; i++) out[i] = payload[i] ^ mask[i % 4];
        payload = out;
      }
      buf = buf.subarray(offset + maskLen + len);
      onFrame(opcode, payload);
    }
  };
}

function connectRelayWebSocket({ urlStr, headers = {}, onOpen, onMessage, onAuthError, onClose, onError }) {
  const u = new URL(urlStr);
  const isLoopback = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if (!['https:', 'wss:'].includes(u.protocol) && !(u.protocol === 'http:' && isLoopback) && !(u.protocol === 'ws:' && isLoopback)) {
    throw new Error('Relay WebSocket must use HTTPS/WSS; plaintext is permitted only on localhost.');
  }
  const lib = u.protocol === 'https:' || u.protocol === 'wss:' ? https : http;
  const wsKey = crypto.randomBytes(16).toString('base64');
  let socket = null;
  let closed = false;

  const req = lib.request(u, {
    method: 'GET',
    headers: {
      ...headers,
      Connection: 'Upgrade',
      Upgrade: 'websocket',
      'Sec-WebSocket-Version': '13',
      'Sec-WebSocket-Key': wsKey,
    },
  });

  req.on('upgrade', (res, sock, head) => {
    socket = sock;
    if (res.statusCode !== 101) {
      sock.destroy();
      onClose?.(res.statusCode);
      return;
    }

    const readFrames = createServerFrameReader((opcode, payload) => {
      if (opcode === 0x8) {
        closed = true;
        try { sock.end(encodeClientFrame(0x8)); } catch {}
        onClose?.(1000);
      } else if (opcode === 0x9) {
        try { sock.write(encodeClientFrame(0xa, payload)); } catch {}
      } else if (opcode === 0x1 || opcode === 0x2) {
        onMessage?.(payload.toString('utf8'));
      }
    });

    if (head && head.length) readFrames(head);
    sock.on('data', readFrames);
    sock.on('close', () => {
      if (!closed) {
        closed = true;
        onClose?.(1006);
      }
    });
    sock.on('error', (err) => onError?.(err));
    onOpen?.();
  });

  req.on('response', (res) => {
    res.resume();
    if (res.statusCode === 401 || res.statusCode === 403) {
      closed = true;
      onAuthError?.(res.statusCode);
    } else {
      onClose?.(res.statusCode);
    }
  });

  req.on('error', (err) => {
    if (!closed) onError?.(err);
  });

  req.end();

  return {
    sendJson: (obj) => {
      if (closed || !socket || socket.destroyed) return false;
      try {
        socket.write(encodeClientFrame(0x1, Buffer.from(JSON.stringify(obj), 'utf8')));
        return true;
      } catch {
        return false;
      }
    },
    close: () => {
      closed = true;
      try { req.destroy(); } catch {}
      if (socket && !socket.destroyed) {
        try { socket.end(encodeClientFrame(0x8)); } catch {}
        try { socket.destroy(); } catch {}
      }
    },
  };
}

module.exports = { connectRelayWebSocket, encodeClientFrame, createServerFrameReader };
