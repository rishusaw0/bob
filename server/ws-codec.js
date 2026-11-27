// Zero-Dependency RFC-6455 WebSocket Frame Encoder / Decoder (ESM for Render server)
import crypto from 'node:crypto';

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export function computeWebSocketAccept(key) {
  return crypto.createHash('sha1').update(String(key).trim() + WS_GUID).digest('base64');
}

export function encodeServerFrame(opcode, payloadBuf = Buffer.alloc(0)) {
  const buf = Buffer.isBuffer(payloadBuf) ? payloadBuf : Buffer.from(String(payloadBuf), 'utf8');
  const len = buf.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x80 | opcode;
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, buf]);
}

export function createFrameReader(onFrame) {
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
        const bigLen = buf.readBigUInt64BE(2);
        if (bigLen > 32n * 1024n * 1024n) {
          buf = Buffer.alloc(0);
          return;
        }
        len = Number(bigLen);
        offset = 10;
      }

      const maskLen = masked ? 4 : 0;
      if (buf.length < offset + maskLen + len) return;

      let payload = buf.subarray(offset + maskLen, offset + maskLen + len);
      if (masked) {
        const mask = buf.subarray(offset, offset + 4);
        const unmasked = Buffer.alloc(len);
        for (let i = 0; i < len; i++) unmasked[i] = payload[i] ^ mask[i % 4];
        payload = unmasked;
      }

      buf = buf.subarray(offset + maskLen + len);
      onFrame(opcode, payload);
    }
  };
}
