const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');

const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

let JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  if (IS_PROD) {
    console.error('חובה להגדיר JWT_SECRET');
    process.exit(1);
  }
  JWT_SECRET = crypto.randomBytes(32).toString('hex');
  console.warn('אזהרה: JWT_SECRET לא הוגדר, נוצר מפתח זמני.');
}

const db = new Database(process.env.DB_PATH || path.join(__dirname, 'data.db'));
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`);
const findUser = db.prepare('SELECT * FROM users WHERE username = ?');
const findUserById = db.prepare('SELECT id, username FROM users WHERE id = ?');
const insertUser = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)');

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '10kb' }));
app.use(cookieParser());

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'יותר מדי ניסיונות, נסה שוב בעוד כמה דקות' },
});

function setSession(res, user) {
  const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '30d' });
  res.cookie('token', token, {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}

function requireAuth(req, res, next) {
  try {
    const { id } = jwt.verify(req.cookies.token, JWT_SECRET);
    const user = findUserById.get(id);
    if (!user) throw new Error('no user');
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: 'לא מחובר' });
  }
}

function validate(username, password) {
  if (typeof username !== 'string' || typeof password !== 'string') return 'נתונים לא תקינים';
  if (!/^[A-Za-z0-9_\u0590-\u05FF]{3,30}$/.test(username))
    return 'שם משתמש: 3 עד 30 תווים (אותיות, מספרים וקו תחתון)';
  if (password.length < 8 || password.length > 100) return 'סיסמה: לפחות 8 תווים';
  return null;
}

app.post('/api/register', authLimiter, async (req, res) => {
  const { username, password } = req.body || {};
  const err = validate(username, password);
  if (err) return res.status(400).json({ error: err });
  if (findUser.get(username)) return res.status(409).json({ error: 'שם המשתמש תפוס' });

  const hash = await bcrypt.hash(password, 12);
  const info = insertUser.run(username, hash);
  setSession(res, { id: info.lastInsertRowid });
  res.status(201).json({ username });
});

app.post('/api/login', authLimiter, async (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string')
    return res.status(400).json({ error: 'נתונים לא תקינים' });

  const user = findUser.get(username);
  const ok = user && (await bcrypt.compare(password, user.password_hash));
  if (!ok) return res.status(401).json({ error: 'שם משתמש או סיסמה שגויים' });

  setSession(res, user);
  res.json({ username: user.username });
});

app.post('/api/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ username: req.user.username });
});

app.use(express.static(path.join(__dirname, 'public')));

const http = require('http');
const server = http.createServer(app);
require('./signaling')(server, (token) => {
  try {
    const { id } = jwt.verify(token, JWT_SECRET);
    return findUserById.get(id) || null;
  } catch {
    return null;
  }
});
server.listen(PORT, () => console.log(`השרת רץ על פורט ${PORT}`));
