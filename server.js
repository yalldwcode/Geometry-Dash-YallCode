require('dotenv').config();
const express = require('express');
const bcrypt  = require('bcrypt');
const jwt     = require('jsonwebtoken');
const cors    = require('cors');
const db      = require('./database');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─────────────────────────────────────────────────
// MIDDLEWARE
// ─────────────────────────────────────────────────
app.use(cors({
  origin: [
    'https://yalldwcode.github.io',
    'http://localhost:5500',   // for local testing
    'http://127.0.0.1:5500'
  ],
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true })); // GD client sends form-encoded data

// ─────────────────────────────────────────────────
// AUTH MIDDLEWARE
// ─────────────────────────────────────────────────
function requireAuth(req, res, next) {
  const header = req.headers['authorization'];
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'No token provided.' });
  }
  const token = header.slice(7);
  try {
    req.admin = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ message: 'Invalid or expired token.' });
  }
}

// ─────────────────────────────────────────────────
// ROOT — health check (Railway pings this)
// ─────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: 'YallDash is live 🔴', version: '1.0.0' });
});

// ─────────────────────────────────────────────────
// PUBLIC API — Stats (used by index.html)
// ─────────────────────────────────────────────────
app.get('/api/stats', async (req, res) => {
  try {
    const [[userRow]]     = await db.query('SELECT COUNT(*) AS c FROM users');
    const [[levelRow]]    = await db.query('SELECT COUNT(*) AS c FROM levels');
    const [[dlRow]]       = await db.query('SELECT SUM(downloads) AS c FROM levels');
    const [[announceRow]] = await db.query('SELECT message FROM broadcast LIMIT 1');

    res.json({
      users:        userRow.c      || 0,
      levels:       levelRow.c     || 0,
      downloads:    dlRow.c        || 0,
      online:       0,              // extend later with socket tracking
      announcement: announceRow?.message || null
    });
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ error: 'DB error' });
  }
});

// ─────────────────────────────────────────────────
// PUBLIC API — Recent levels (used by index.html)
// ─────────────────────────────────────────────────
app.get('/api/levels/recent', async (req, res) => {
  try {
    const count = Math.min(parseInt(req.query.count) || 6, 20);
    const [rows] = await db.query(
      `SELECT l.id, l.name, u.username AS creator,
              l.downloads, l.likes, l.difficulty
       FROM levels l
       LEFT JOIN users u ON l.user_id = u.id
       ORDER BY l.id DESC LIMIT ?`,
      [count]
    );
    res.json(rows);
  } catch (err) {
    console.error('Levels error:', err);
    res.status(500).json([]);
  }
});

// ─────────────────────────────────────────────────
// ADMIN — Login
// ─────────────────────────────────────────────────
app.post('/api/admin/login', async (req, res) => {
  const { username, password } = req.body;

  // Check username matches the owner account
  if (!username || username.toLowerCase() !== 'yallcode') {
    return res.status(401).json({ message: 'Invalid credentials.' });
  }

  // The hashed password lives ONLY in your Railway env variable
  const storedHash = process.env.ADMIN_PASS_HASH;
  if (!storedHash) {
    return res.status(500).json({ message: 'Server misconfigured. Set ADMIN_PASS_HASH.' });
  }

  const valid = await bcrypt.compare(password, storedHash);
  if (!valid) {
    return res.status(401).json({ message: 'Invalid credentials.' });
  }

  const token = jwt.sign(
    { username: 'YallCode', role: 'owner' },
    process.env.JWT_SECRET,
    { expiresIn: '12h' }
  );

  res.json({ token, username: 'YallCode' });
});

// ADMIN — Verify existing token
app.get('/api/admin/me', requireAuth, (req, res) => {
  res.json({ username: req.admin.username, role: req.admin.role });
});

// ADMIN — Logout (client-side drop is enough, but we log it)
app.post('/api/admin/logout', requireAuth, (req, res) => {
  console.log(`[LOGOUT] ${req.admin.username}`);
  res.json({ ok: true });
});

// ─────────────────────────────────────────────────
// ADMIN — Stats
// ─────────────────────────────────────────────────
app.get('/api/admin/stats', requireAuth, async (req, res) => {
  try {
    const [[userRow]]  = await db.query('SELECT COUNT(*) AS c FROM users');
    const [[levelRow]] = await db.query('SELECT COUNT(*) AS c FROM levels');
    const [[dlRow]]    = await db.query('SELECT COALESCE(SUM(downloads),0) AS c FROM levels');
    res.json({ users: userRow.c, levels: levelRow.c, downloads: dlRow.c, online: 0 });
  } catch (err) { res.status(500).json({ error: 'DB error' }); }
});

// ─────────────────────────────────────────────────
// ADMIN — Broadcast
// ─────────────────────────────────────────────────
app.post('/api/admin/broadcast', requireAuth, async (req, res) => {
  const { message, type } = req.body;
  if (!message) return res.status(400).json({ message: 'Empty message.' });
  try {
    await db.query('DELETE FROM broadcast');
    await db.query('INSERT INTO broadcast (message, type) VALUES (?, ?)', [message, type || 'info']);
    console.log(`[BROADCAST] ${type}: ${message}`);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'DB error' }); }
});

app.delete('/api/admin/broadcast', requireAuth, async (req, res) => {
  try {
    await db.query('DELETE FROM broadcast');
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'DB error' }); }
});

// ─────────────────────────────────────────────────
// ADMIN — Users
// ─────────────────────────────────────────────────
app.get('/api/admin/users', requireAuth, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const [rows] = await db.query(
      `SELECT id, username, email, created_at AS registered,
              banned,
              (SELECT COUNT(*) FROM levels WHERE user_id = users.id) AS levelCount
       FROM users ORDER BY id DESC LIMIT ?`,
      [limit]
    );
    res.json(rows);
  } catch (err) { res.status(500).json([]); }
});

app.post('/api/admin/users/:id/ban', requireAuth, async (req, res) => {
  try {
    await db.query('UPDATE users SET banned = 1 WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'DB error' }); }
});

app.post('/api/admin/users/:id/unban', requireAuth, async (req, res) => {
  try {
    await db.query('UPDATE users SET banned = 0 WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'DB error' }); }
});

// ─────────────────────────────────────────────────
// ADMIN — Levels
// ─────────────────────────────────────────────────
app.get('/api/admin/levels', requireAuth, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const [rows] = await db.query(
      `SELECT l.id, l.name, u.username AS creator, l.downloads, l.likes
       FROM levels l LEFT JOIN users u ON l.user_id = u.id
       ORDER BY l.id DESC LIMIT ?`,
      [limit]
    );
    res.json(rows);
  } catch { res.status(500).json([]); }
});

app.delete('/api/admin/levels/:id', requireAuth, async (req, res) => {
  try {
    await db.query('DELETE FROM levels WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'DB error' }); }
});

// ─────────────────────────────────────────────────
// ADMIN — Config toggles
// ─────────────────────────────────────────────────
app.post('/api/admin/config/:key', requireAuth, async (req, res) => {
  const allowed = ['registration', 'uploads', 'maintenance'];
  if (!allowed.includes(req.params.key)) {
    return res.status(400).json({ message: 'Unknown config key.' });
  }
  try {
    await db.query(
      'INSERT INTO config (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)',
      [req.params.key, req.body.value ? '1' : '0']
    );
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'DB error' }); }
});

app.post('/api/admin/config/downloads', requireAuth, async (req, res) => {
  const { apk, exe, version } = req.body;
  try {
    for (const [k, v] of [['dl_apk', apk], ['dl_exe', exe], ['dl_version', version]]) {
      await db.query(
        'INSERT INTO config (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)',
        [k, v]
      );
    }
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'DB error' }); }
});

// ─────────────────────────────────────────────────
// ADMIN — Logs
// ─────────────────────────────────────────────────
app.get('/api/admin/logs', requireAuth, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 40, 100);
    const [rows] = await db.query(
      'SELECT time, level, message FROM logs ORDER BY id DESC LIMIT ?',
      [limit]
    );
    res.json(rows);
  } catch { res.status(500).json([]); }
});

// ─────────────────────────────────────────────────
// START
// ─────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ YallDash server running on port ${PORT}`);
});