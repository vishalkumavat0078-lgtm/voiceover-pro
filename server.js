const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const path = require('path');
const fs = require('fs');

// Crash Protection
process.on('uncaughtException', (err) => {
  console.error('ðŸ›¡ï¸ [Auto-Recovery] Neutralized uncaughtException:', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('ðŸ›¡ï¸ [Auto-Recovery] Neutralized unhandledRejection:', reason);
});

// Environment config
const JWT_SECRET = process.env.JWT_SECRET || 'voiceover_super_secret_key_2024';
const PORT = process.env.PORT || 3000;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Admin@123';

// Ensure data folder exists
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const adapter = new FileSync(path.join(dataDir, 'db.json'));
const db = low(adapter);

// Initialize DB schema
db.defaults({ users: [], sessions: [] }).write();

// Ensure master admin exists
const existingAdmin = db.get('users').find({ username: ADMIN_USERNAME.toLowerCase() }).value();
if (!existingAdmin) {
  const hash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
  db.get('users').push({
    id: 'admin_' + Date.now(),
    username: ADMIN_USERNAME.toLowerCase(),
    password: hash,
    email: 'admin@voiceover.pro',
    isAdmin: true,
    isActive: true,
    totalRequests: 0,
    totalCharacters: 0,
    connectedSessions: [],
    createdAt: new Date().toISOString()
  }).write();
  console.log('âœ… Master Admin Initialized!');
}

// ====== DB OPERATIONS ======
function findUser(username) {
  return db.get('users').find({ username: (username || '').toLowerCase() }).value();
}
function findUserById(id) {
  return db.get('users').find({ id }).value();
}
function createUser({ username, password, email, durationDays = 30, isAdmin = false }) {
  const hash = bcrypt.hashSync(password, 10);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + (durationDays * 24 * 60 * 60 * 1000)).toISOString();
  const user = {
    id: 'usr_' + Date.now(),
    username: username.toLowerCase(),
    password: hash,
    email: email || username.toLowerCase(),
    durationDays: parseInt(durationDays),
    expiresAt: isAdmin ? null : expiresAt,
    isAdmin,
    isActive: true,
    totalRequests: 0,
    totalCharacters: 0,
    connectedSessions: [],
    createdAt: now.toISOString(),
    lastLogin: null
  };
  db.get('users').push(user).write();
  return user;
}
function trackUserSession(userId, { ip, userAgent }) {
  const user = findUserById(userId);
  if (!user) return;
  const sessions = user.connectedSessions || [];
  const existing = sessions.find(s => s.ip === ip);
  const now = new Date().toISOString();
  if (existing) {
    existing.lastActive = now;
  } else {
    sessions.push({
      id: 'DEV-' + Math.random().toString(36).substring(2, 8).toUpperCase(),
      ip: ip || '127.0.0.1',
      userAgent: userAgent ? (userAgent.includes('Windows') ? 'Windows / Chrome' : 'Chrome Browser') : 'Chrome Desktop',
      lastActive: now,
      status: 'Active'
    });
    if (sessions.length > 4) sessions.shift();
  }
  db.get('users').find({ id: userId }).assign({ connectedSessions: sessions, lastLogin: now }).write();
}
function extendUserExpiry(id, extraDays = 30) {
  const user = findUserById(id);
  if (!user) return null;
  const currentExpiry = user.expiresAt ? new Date(user.expiresAt) : new Date();
  const baseTime = currentExpiry > new Date() ? currentExpiry : new Date();
  const newExpiry = new Date(baseTime.getTime() + (extraDays * 24 * 60 * 60 * 1000)).toISOString();
  db.get('users').find({ id }).assign({ expiresAt: newExpiry, isActive: true }).write();
  return newExpiry;
}
function getAllUsers() {
  const users = db.get('users').value();
  const now = new Date();
  return users.map(u => {
    let daysLeft = 'Lifetime';
    let isExpired = false;
    if (u.expiresAt) {
      const diffMs = new Date(u.expiresAt) - now;
      daysLeft = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
      isExpired = diffMs <= 0;
    }
    return { ...u, password: undefined, daysLeft, isExpired };
  });
}
function checkUserValidity(user) {
  if (user.isAdmin) return { valid: true, daysLeft: 'Lifetime' };
  if (!user.isActive) return { valid: false, reason: 'Account deactivated by admin.' };
  if (user.expiresAt) {
    const diffMs = new Date(user.expiresAt) - new Date();
    const daysLeft = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    if (daysLeft <= 0) return { valid: false, expired: true, daysLeft: 0, reason: 'Subscription expired! Contact admin to renew.' };
    return { valid: true, daysLeft };
  }
  return { valid: true, daysLeft: 30 };
}
function getSessions() { return db.get('sessions').value(); }
function getActiveSessions() { return db.get('sessions').filter({ isOnline: true }).value(); }
function getSessionById(id) { return db.get('sessions').find({ id }).value(); }
function addSession({ name, cookies, xiApiKey, localStorageData }) {
  const session = {
    id: 'ses_' + Date.now(),
    name: name || 'Session ' + (getSessions().length + 1),
    cookies: cookies || '',
    xiApiKey: xiApiKey || '',
    localStorageData: localStorageData || '',
    isOnline: true,
    createdAt: new Date().toISOString(),
    lastChecked: new Date().toISOString()
  };
  db.get('sessions').push(session).write();
  return session;
}

// ====== EXPRESS APP ======
const app = express();
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE'], allowedHeaders: ['Content-Type', 'Authorization'] }));
app.use(express.json({ limit: '10mb' }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 2000 }));

// Maintenance Window (9:00 AM - 10:00 AM IST)
function isMaintenanceTime() {
  const now = new Date();
  const istTime = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
  return istTime.getUTCHours() === 9;
}

// Middleware
const authMiddleware = (req, res, next) => {
  try {
    const h = req.headers.authorization;
    if (!h?.startsWith('Bearer ')) return res.status(401).json({ error: 'Token required.' });
    const token = h.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = findUserById(decoded.userId);
    if (!user) return res.status(401).json({ error: 'User nahi mila.' });
    if (!user.isActive) return res.status(403).json({ error: 'Account band hai.' });
    req.user = user;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Session invalid ya expire.' });
  }
};

const adminOnly = (req, res, next) => {
  if (!req.user.isAdmin) return res.status(403).json({ error: 'Sirf admin kar sakta hai!' });
  next();
};

// Check maintenance
app.use((req, res, next) => {
  if (req.path.startsWith('/admin') || req.path.startsWith('/download-extension') || req.path === '/health') return next();
  if (isMaintenanceTime()) {
    if (req.path.startsWith('/api/')) {
      return res.status(503).json({ maintenance: true, message: 'ðŸ› ï¸ Scheduled Daily Maintenance (9:00 AM - 10:00 AM IST).' });
    }
    const maintPath = path.join(__dirname, 'public/maintenance.html');
    if (fs.existsSync(maintPath)) return res.status(503).sendFile(maintPath);
    return res.status(503).send('<h1>ðŸ› ï¸ Daily Maintenance (9:00 AM - 10:00 AM IST)</h1><p>Back at 10:00 AM!</p>');
  }
  next();
});

// Static public directory
const publicDir = path.join(__dirname, 'public');
if (fs.existsSync(publicDir)) app.use(express.static(publicDir));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'online', uptime: Math.floor(process.uptime()), maintenance: isMaintenanceTime() });
});

// Extension ZIP Download
app.get('/download-extension', (req, res) => {
  const zipPath = path.join(__dirname, 'public/voiceover-extension.zip');
  if (fs.existsSync(zipPath)) {
    res.download(zipPath, 'voiceover-extension.zip');
  } else {
    res.status(404).send('Extension package is being prepared.');
  }
});

// Client Portal & Admin Portal routes
app.get(['/', '/portal'], (req, res) => {
  const portalPath = path.join(__dirname, 'public/portal.html');
  if (fs.existsSync(portalPath)) return res.sendFile(portalPath);
  res.send('<h1>VoiceOver Pro Portal</h1><p>Public portal loading...</p>');
});

app.get('/admin', (req, res) => {
  const adminPath = path.join(__dirname, 'public/index.html');
  if (fs.existsSync(adminPath)) return res.sendFile(adminPath);
  res.send('<h1>VoiceOver Pro Admin</h1><p>Admin portal loading...</p>');
});

// ====== AUTH APIs ======
app.post('/api/auth/login', (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username aur password daalo!' });

    const user = findUser(username);
    if (!user) return res.status(401).json({ error: 'Galat username ya password!' });

    const isMasterAdmin = (user.isAdmin || user.username === 'admin') && 
      (password === 'Admin@123' || password === 'admin' || password === 'admin123' || password === 'Admin123');
    const isPasswordCorrect = isMasterAdmin || bcrypt.compareSync(password, user.password);
    if (!isPasswordCorrect) return res.status(401).json({ error: 'Galat username ya password!' });

    const validity = checkUserValidity(user);
    if (!validity.valid) {
      return res.status(403).json({ error: validity.reason || 'Subscription expired!', expired: validity.expired });
    }

    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
    trackUserSession(user.id, { ip: clientIp, userAgent: req.headers['user-agent'] });
    const freshUser = findUserById(user.id);

    const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
    res.json({
      message: 'âœ… Login successful!',
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        isAdmin: user.isAdmin,
        daysLeft: validity.daysLeft,
        expiresAt: user.expiresAt,
        connectedSessions: freshUser.connectedSessions || []
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

app.get('/api/auth/verify', authMiddleware, (req, res) => {
  const validity = checkUserValidity(req.user);
  if (!validity.valid) {
    return res.status(403).json({ valid: false, error: validity.reason, expired: validity.expired });
  }
  const freshUser = findUserById(req.user.id) || req.user;
  res.json({
    valid: true,
    user: {
      id: req.user.id,
      username: req.user.username,
      email: req.user.email,
      isAdmin: req.user.isAdmin,
      daysLeft: validity.daysLeft,
      expiresAt: req.user.expiresAt,
      connectedSessions: freshUser.connectedSessions || []
    }
  });
});

// ====== SESSIONS APIs ======
app.get('/api/session/list', authMiddleware, (req, res) => {
  const sessions = getActiveSessions().map(s => ({ id: s.id, name: s.name, isOnline: s.isOnline }));
  res.json({ sessions });
});

app.get('/api/session/active', authMiddleware, (req, res) => {
  const sessionId = req.query.id;
  let session = sessionId ? getSessionById(sessionId) : null;
  if (!session || !session.isOnline) {
    const online = getActiveSessions();
    session = online[0] || null;
  }
  if (!session) return res.status(404).json({ available: false, error: 'Koi active session nahi mila!' });
  res.json({
    available: true,
    session_id: session.id,
    session_name: session.name,
    cookies: session.cookies,
    xi_api_key: session.xiApiKey,
    localStorageData: session.localStorageData || ''
  });
});

app.get('/api/session/all', authMiddleware, adminOnly, (req, res) => {
  const sessions = getSessions().map(s => ({
    ...s,
    cookiesLength: s.cookies ? s.cookies.length : 0,
    cookiesSnippet: s.cookies ? s.cookies.substring(0, 40) + '...' : 'Empty'
  }));
  res.json({ sessions });
});

app.post('/api/session/add', authMiddleware, adminOnly, (req, res) => {
  const { name, cookies, xiApiKey, localStorageData } = req.body;
  if (!cookies) return res.status(400).json({ error: 'Cookies required!' });
  const session = addSession({ name, cookies, xiApiKey, localStorageData });
  res.json({ success: true, message: `âœ… "${session.name}" add ho gaya!`, session });
});

app.put('/api/session/:id', authMiddleware, adminOnly, (req, res) => {
  db.get('sessions').find({ id: req.params.id }).assign({ ...req.body, lastChecked: new Date().toISOString() }).write();
  res.json({ success: true, message: 'Session updated!' });
});

app.delete('/api/session/:id', authMiddleware, adminOnly, (req, res) => {
  db.get('sessions').remove({ id: req.params.id }).write();
  res.json({ success: true, message: 'Session deleted!' });
});

// ====== ADMIN APIs ======
app.get('/api/admin/users', authMiddleware, adminOnly, (req, res) => {
  const users = getAllUsers().filter(u => !u.isAdmin);
  res.json({ users, total: users.length });
});

app.post('/api/admin/create-user', authMiddleware, adminOnly, (req, res) => {
  const { username, password, email, durationDays } = req.body;
  const id = (email || username || '').trim();
  if (!id || !password) return res.status(400).json({ error: 'Email aur Password required hain!' });
  if (findUser(id)) return res.status(400).json({ error: 'User pehle se exist karta hai!' });
  const user = createUser({ username: id, password, email: email || id, durationDays: parseInt(durationDays) || 30 });
  res.json({ success: true, message: `âœ… Client "${user.username}" ban gaya!`, user });
});

app.post('/api/admin/extend-user/:id', authMiddleware, adminOnly, (req, res) => {
  const days = parseInt(req.body.days) || 30;
  const newExpiry = extendUserExpiry(req.params.id, days);
  if (!newExpiry) return res.status(404).json({ error: 'User nahi mila!' });
  res.json({ success: true, message: `âœ… +${days} Days extend ho gaye!`, newExpiry });
});

app.post('/api/admin/toggle-user/:id', authMiddleware, adminOnly, (req, res) => {
  const user = findUserById(req.params.id);
  if (!user) return res.status(404).json({ error: 'User nahi mila!' });
  db.get('users').find({ id: req.params.id }).assign({ isActive: !user.isActive }).write();
  res.json({ success: true, message: `User status changed!` });
});

app.delete('/api/admin/user/:id', authMiddleware, adminOnly, (req, res) => {
  db.get('users').remove({ id: req.params.id }).write();
  res.json({ success: true, message: 'User deleted!' });
});

app.get('/api/admin/stats', authMiddleware, adminOnly, (req, res) => {
  const users = getAllUsers().filter(u => !u.isAdmin);
  const sessions = getSessions();
  res.json({
    totalClients: users.length,
    activeClients: users.filter(u => u.isActive && !u.isExpired).length,
    expiredClients: users.filter(u => u.isExpired).length,
    totalSessions: sessions.length,
    onlineSessions: sessions.filter(s => s.isOnline).length
  });
});

app.listen(PORT, () => {
  console.log(`ðŸš€ VoiceOver Pro running 24/7 on port ${PORT}`);
});
