// Auto setup - Admin account + test user banata hai
require('dotenv').config();
const path = require('path');
const fs = require('fs');

// Data folder
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

const db = require('./models/db');

console.log('');
console.log('🚀 VoiceOver Pro - Setup Running...');
console.log('');

// Admin banao
const adminUsername = process.env.ADMIN_USERNAME || 'admin';
const adminPassword = process.env.ADMIN_PASSWORD || 'Admin@123';

const existing = db.findUser(adminUsername);
if (existing) {
  console.log('✅ Admin already exists:', adminUsername);
} else {
  db.createUser({ username: adminUsername, password: adminPassword, isAdmin: true });
  console.log('✅ Admin account bana!');
  console.log('   Username:', adminUsername);
  console.log('   Password:', adminPassword);
}

console.log('');
console.log('📋 Setup complete!');
console.log('');
console.log('Ab yeh karo:');
console.log('  1. node server.js  (server start karo)');
console.log('  2. ElevenLabs cookies copy karo');
console.log('  3. Admin login karke session add karo');
console.log('');
