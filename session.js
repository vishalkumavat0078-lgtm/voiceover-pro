const express = require('express');
const authMiddleware = require('../middleware/auth');
const db = require('../models/db');
const router = express.Router();

const adminOnly = (req, res, next) => {
  if (!req.user.isAdmin) return res.status(403).json({ error: 'Sirf admin kar sakta hai!' });
  next();
};

// GET ALL ONLINE SESSIONS (For Extension Dropdown: Session 1, Session 2, Session 3)
router.get('/list', authMiddleware, (req, res) => {
  const sessions = db.getActiveSessions().map(s => ({
    id: s.id,
    name: s.name,
    isOnline: s.isOnline
  }));
  res.json({ sessions });
});

// GET ACTIVE / SPECIFIC SESSION COOKIES (For Injection)
router.get('/active', authMiddleware, (req, res) => {
  const sessionId = req.query.id;
  let session = sessionId ? db.getSessionById(sessionId) : null;
  if (!session || !session.isOnline) {
    const onlineSessions = db.getActiveSessions();
    session = onlineSessions[0] || null;
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

// GET ALL SESSIONS WITH DETAILS (Admin)
router.get('/all', authMiddleware, adminOnly, (req, res) => {
  const sessions = db.getSessions().map(s => ({
    ...s,
    cookiesLength: s.cookies ? s.cookies.length : 0,
    cookiesSnippet: s.cookies ? s.cookies.substring(0, 40) + '...' : 'Empty'
  }));
  res.json({ sessions });
});

// ADD SESSION (Admin)
router.post('/add', authMiddleware, adminOnly, (req, res) => {
  const { name, cookies, xiApiKey, localStorageData } = req.body;
  if (!cookies) return res.status(400).json({ error: 'Cookies required hain!' });
  const session = db.addSession({ name, cookies, xiApiKey, localStorageData });
  res.json({ success: true, message: `✅ "${session.name}" add ho gaya!`, session });
});

// UPDATE / TOGGLE SESSION STATUS (Admin)
router.put('/:id', authMiddleware, adminOnly, (req, res) => {
  db.updateSession(req.params.id, req.body);
  res.json({ success: true, message: 'Session updated!' });
});

// DELETE SESSION (Admin)
router.delete('/:id', authMiddleware, adminOnly, (req, res) => {
  db.deleteSession(req.params.id);
  res.json({ success: true, message: 'Session deleted!' });
});

module.exports = router;
