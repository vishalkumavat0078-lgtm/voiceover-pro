// ElevenLabs Session Add karne ka easy script
// Usage: node add-session.js
// Phir cookies paste karo

const readline = require('readline');
const http = require('http');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

console.log('');
console.log('🎙️  ElevenLabs Session Add Karo');
console.log('════════════════════════════════');
console.log('');
console.log('📋 Pehle yeh karo:');
console.log('   1. elevenlabs.io pe login karo');
console.log('   2. F12 dabao → Network tab');
console.log('   3. Koi bhi text generate karo ElevenLabs pe');
console.log('   4. Network mein koi bhi request pe click karo');
console.log('   5. "Request Headers" mein "cookie:" header ki poori value copy karo');
console.log('');

// Pehle admin login karo
function adminLogin() {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ username: 'admin', password: 'Admin@123' });
    const req = http.request({
      hostname: 'localhost', port: 3000, path: '/api/auth/login',
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': data.length }
    }, res => {
      let b = '';
      res.on('data', d => b += d);
      res.on('end', () => {
        const parsed = JSON.parse(b);
        if (parsed.token) resolve(parsed.token);
        else reject(new Error('Login fail: ' + b));
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function addSession(token, name, cookies) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ name, cookies });
    const req = http.request({
      hostname: 'localhost', port: 3000, path: '/api/session/add',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), 'Authorization': 'Bearer ' + token }
    }, res => {
      let b = '';
      res.on('data', d => b += d);
      res.on('end', () => resolve(JSON.parse(b)));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  try {
    console.log('🔑 Admin login ho raha hai...');
    const token = await adminLogin();
    console.log('✅ Admin logged in!\n');

    rl.question('Session ka naam daalo (jaise "Session 1"): ', async (name) => {
      console.log('');
      console.log('Ab cookies paste karo (Ctrl+V) aur Enter dabao:');
      console.log('(Lambi line hogi - yeh normal hai)');
      console.log('');

      rl.question('Cookies: ', async (cookies) => {
        try {
          console.log('\n⏳ Session add ho raha hai...');
          const result = await addSession(token, name || 'Session 1', cookies.trim());

          if (result.success) {
            console.log('');
            console.log('🎉 SESSION ADD HO GAYI!');
            console.log('✅', result.message);
            console.log('');
            console.log('Ab extension mein login karo aur "Open ElevenLabs" dabao!');
          } else {
            console.log('❌ Error:', result.error);
          }
        } catch (err) {
          console.log('❌ Error:', err.message);
        }
        rl.close();
      });
    });
  } catch (err) {
    console.log('❌ Server connect nahi ho saka!');
    console.log('   Pehle "node server.js" run karo');
    rl.close();
  }
}

main();
