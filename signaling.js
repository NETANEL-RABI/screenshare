// שרת איתות: מעביר הודעות הקמה בין המשדר לצופים. הוידאו עצמו לא עובר כאן.
const { WebSocketServer } = require('ws');
const crypto = require('crypto');

const MAX_VIEWERS = 8;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // בלי תווים מבלבלים (0/O, 1/I)

function newCode(rooms) {
  for (;;) {
    let code = '';
    for (let i = 0; i < 6; i++) code += ALPHABET[crypto.randomInt(ALPHABET.length)];
    if (!rooms.has(code)) return code;
  }
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function send(ws, obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}

module.exports = function attachSignaling(server, getUser) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  const rooms = new Map(); // code -> { host, viewers: Map(id -> ws) }

  server.on('upgrade', (req, socket, head) => {
    if (!req.url.startsWith('/ws')) return socket.destroy();

    // הגנה: מקבלים רק חיבורים שהגיעו מהאתר שלנו
    const origin = req.headers.origin;
    if (origin && new URL(origin).host !== req.headers.host) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      return socket.destroy();
    }

    const user = getUser(parseCookies(req.headers.cookie).token);
    if (!user) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      return socket.destroy();
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.user = user;
      wss.emit('connection', ws);
    });
  });

  wss.on('connection', (ws) => {
    ws.id = crypto.randomBytes(4).toString('hex');
    ws.isAlive = true;
    ws.on('pong', () => (ws.isAlive = true));

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }

      // משדר פותח חדר
      if (msg.type === 'create' && !ws.room) {
        const code = newCode(rooms);
        rooms.set(code, { host: ws, viewers: new Map() });
        ws.room = code;
        ws.role = 'host';
        return send(ws, { type: 'created', room: code });
      }

      // צופה מצטרף
      if (msg.type === 'join' && !ws.room) {
        const code = String(msg.room || '').toUpperCase().trim();
        const room = rooms.get(code);
        if (!room) return send(ws, { type: 'error', message: 'החדר לא נמצא' });
        if (room.viewers.size >= MAX_VIEWERS) return send(ws, { type: 'error', message: 'החדר מלא' });
        room.viewers.set(ws.id, ws);
        ws.room = code;
        ws.role = 'viewer';
        send(ws, { type: 'joined' });
        return send(room.host, { type: 'viewer-joined', viewer: ws.id });
      }

      // העברת הודעות WebRTC (הצעה, תשובה, מועמדי ICE)
      if (msg.type === 'signal' && ws.room) {
        const room = rooms.get(ws.room);
        if (!room) return;
        if (ws.role === 'host') {
          send(room.viewers.get(msg.to), { type: 'signal', data: msg.data });
        } else {
          send(room.host, { type: 'signal', from: ws.id, data: msg.data });
        }
      }
    });

    ws.on('close', () => {
      const room = rooms.get(ws.room);
      if (!room) return;
      if (ws.role === 'host') {
        for (const v of room.viewers.values()) send(v, { type: 'ended' });
        rooms.delete(ws.room);
      } else {
        room.viewers.delete(ws.id);
        send(room.host, { type: 'viewer-left', viewer: ws.id });
      }
    });
  });

  // פינג תקופתי: שומר על החיבור חי וסוגר חיבורים מתים
  setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
  }, 30000).unref();
};
