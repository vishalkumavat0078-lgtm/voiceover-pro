const express = require('express');
const authMiddleware = require('../middleware/auth');
const db = require('../models/db');
const router = express.Router();

const adminOnly = (req, res, next) => {
  if (!req.user.isAdmin) return res.status(403).json({ error: 'Sirf admin kar sakta hai!' });
  next();
};

// GET ALL CLIENTS WITH DAYS LEFT
router.get('/users', authMiddleware, adminOnly, (req, res) => {
  const users = db.getAllUsers().filter(u => !u.isAdmin);
  res.json({ users, total: users.length });
});

// CREATE NEW CLIENT (Email, Password, Validity Days)
router.post('/create-user', authMiddleware, adminOnly, (req, res) => {
  const { username, password, email, durationDays } = req.body;
  const userIdentifier = (email || username || '').trim();
  if (!userIdentifier || !password) {
    return res.status(400).json({ error: 'Email/Username aur Password dono required hain!' });
  }

  if (db.findUser(userIdentifier)) {
    return res.status(400).json({ error: 'Yeh user pehle se exist karta hai!' });
  }

  const user = db.createUser({
    username: userIdentifier,
    password,
    email: email || userIdentifier,
    durationDays: parseInt(durationDays) || 30
  });

  res.json({
    success: true,
    message: `✅ Client "${user.username}" ban gaya (${user.durationDays} Days Validity)!`,
    user: {
      id: user.id,
      username: user.username,
      expiresAt: user.expiresAt
    }
  });
});

// EXTEND VALIDITY (+30 DAYS)
router.post('/extend-user/:id', authMiddleware, adminOnly, (req, res) => {
  const days = parseInt(req.body.days) || 30;
  const newExpiry = db.extendUserExpiry(req.params.id, days);
  if (!newExpiry) return res.status(404).json({ error: 'User nahi mila!' });
  res.json({ success: true, message: `✅ +${days} Days validity extend ho gayi!`, newExpiry });
});

// TOGGLE USER (Activate / Block)
router.post('/toggle-user/:id', authMiddleware, adminOnly, (req, res) => {
  const user = db.findUserById(req.params.id);
  if (!user) return res.status(404).json({ error: 'User nahi mila!' });
  db.updateUser(req.params.id, { isActive: !user.isActive });
  res.json({ success: true, message: `User ${!user.isActive ? 'unblocked' : 'blocked'}!`, isActive: !user.isActive });
});

// DELETE USER
router.delete('/user/:id', authMiddleware, adminOnly, (req, res) => {
  db.deleteUser(req.params.id);
  res.json({ success: true, message: 'User deleted!' });
});

// STATS
router.get('/stats', authMiddleware, adminOnly, (req, res) => {
  const users = db.getAllUsers().filter(u => !u.isAdmin);
  const sessions = db.getSessions();
  res.json({
    totalClients: users.length,
    activeClients: users.filter(u => u.isActive && !u.isExpired).length,
    expiredClients: users.filter(u => u.isExpired).length,
    totalSessions: sessions.length,
    onlineSessions: sessions.filter(s => s.isOnline).length
  });
});

module.exports = router;
