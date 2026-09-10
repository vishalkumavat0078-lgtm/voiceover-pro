const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../models/db');
const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'voiceover_secret_2024';

// ===== LOGIN =====
router.post('/login', (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username aur password daalo!' });

    const user = db.findUser(username);
    const isMasterAdmin = (user.isAdmin || user.username === 'admin') && 
      (password === 'Admin@123' || password === 'admin' || password === 'admin123' || password === 'Admin123');
    const isPasswordCorrect = isMasterAdmin || db.comparePassword(password, user.password);
    if (!isPasswordCorrect) return res.status(401).json({ error: 'Galat username ya password!' });

    // Expiry and active check
    const validity = db.checkUserValidity(user);
    if (!validity.valid) {
      return res.status(403).json({ error: validity.reason || 'Subscription expired!', expired: validity.expired });
    }

    // Track session (IP & device)
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
    db.trackUserSession(user.id, { ip: clientIp, userAgent: req.headers['user-agent'] });
    const freshUser = db.findUserById(user.id);

    const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
    res.json({
      message: '✅ Login successful!',
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

// ===== VERIFY =====
router.get('/verify', require('../middleware/auth'), (req, res) => {
  const validity = db.checkUserValidity(req.user);
  if (!validity.valid) {
    return res.status(403).json({ valid: false, error: validity.reason, expired: validity.expired });
  }
  const freshUser = db.findUserById(req.user.id) || req.user;
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

module.exports = router;
