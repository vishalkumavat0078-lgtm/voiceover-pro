const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

// Crash Protection — Server Kabhi Crash Nahi Hoga
process.on('uncaughtException', (err) => {
  console.error('🛡️ [Auto-Recovery] Uncaught Exception caught & neutralized:', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('🛡️ [Auto-Recovery] Unhandled Rejection caught & neutralized:', reason);
});

// Data folder check
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

const authRoutes = require('./routes/auth');
const sessionRoutes = require('./routes/session');
const adminRoutes = require('./routes/admin');

const app = express();

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE'], allowedHeaders: ['Content-Type', 'Authorization'] }));
app.use(express.json({ limit: '10mb' }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 2000 }));

// ===== DAILY MAINTENANCE WINDOW (9:00 AM – 10:00 AM IST) =====
function isMaintenanceTime() {
  const now = new Date();
  // Convert to Indian Standard Time (UTC + 5:30)
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istTime = new Date(now.getTime() + istOffset);
  const hour = istTime.getUTCHours();
  // 9:00 AM to 9:59 AM IST
  return hour === 9;
}

// Maintenance Middleware for Client Portal
app.use((req, res, next) => {
  // Admin portal, static assets, and health check bypass maintenance
  if (req.path.startsWith('/admin') || req.path.startsWith('/download-extension') || req.path === '/health') {
    return next();
  }

  if (isMaintenanceTime()) {
    // If it's an API request, return JSON
    if (req.path.startsWith('/api/')) {
      return res.status(503).json({
        maintenance: true,
        message: '🛠️ Scheduled Daily Maintenance (9:00 AM - 10:00 AM IST). Service resumes at 10:00 AM.'
      });
    }
    // If browser visits / or /portal, show beautiful maintenance screen
    return res.status(503).sendFile(path.join(__dirname, 'public/maintenance.html'));
  }

  next();
});

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Client Portal (FlowByPak clone dashboard)
app.get(['/', '/portal'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public/portal.html'));
});

// Admin Management Portal
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

// Health check endpoint (for uptime monitors like UptimeRobot)
app.get('/health', (req, res) => {
  res.json({
    status: 'online',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    maintenanceActive: isMaintenanceTime()
  });
});

// Direct Extension ZIP Downloader
app.get('/download-extension', (req, res) => {
  const zipFile = path.join(__dirname, 'public/voiceover-extension.zip');
  if (fs.existsSync(zipFile)) {
    res.download(zipFile, 'voiceover-extension.zip');
  } else {
    res.status(404).send('Extension ZIP file not found.');
  }
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/session', sessionRoutes);
app.use('/api/admin', adminRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('');
  console.log('  🎙️  VoiceOver Pro — 24/7 Multi-User SaaS Platform');
  console.log('  ───────────────────────────────────────────────');
  console.log(`  🌐 Client Portal: http://localhost:${PORT}/portal`);
  console.log(`  👑 Admin Portal:  http://localhost:${PORT}/admin`);
  console.log('  🛠️ Maintenance:  Daily 9:00 AM – 10:00 AM IST (Auto-handled)');
  console.log('  🛡️ Crash Guard:  Active (Zero-Crash Protection)');
  console.log('  📁 Database:      data/db.json (local file)');
  console.log('');
  console.log('  Admin Login:');
  console.log(`  👤 Username: ${process.env.ADMIN_USERNAME || 'admin'}`);
  console.log(`  🔑 Password: ${process.env.ADMIN_PASSWORD || 'Admin@123'}`);
  console.log('');
});
