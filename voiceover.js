const express = require('express');
const axios = require('axios');
const multer = require('multer');
const FormData = require('form-data');
const authMiddleware = require('../middleware/auth');
const User = require('../models/User');
const router = express.Router();

// ============================================================
// ElevenLabs Web Session Config
// API key ki zaroorat NAHI - sirf browser session chahiye
// ============================================================
const EL_BASE = 'https://api.elevenlabs.io/v1';

// ElevenLabs session headers (browser jaisi request banate hain)
function getElHeaders(extraHeaders = {}) {
  const session = process.env.EL_SESSION_TOKEN; // Browser se copy kiya session
  const cookie = process.env.EL_COOKIE;         // Browser cookies

  return {
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Content-Type': 'application/json',
    'Origin': 'https://elevenlabs.io',
    'Referer': 'https://elevenlabs.io/',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    ...(session ? { 'xi-api-key': session } : {}),
    ...(cookie ? { 'Cookie': cookie } : {}),
    ...extraHeaders
  };
}

// ElevenLabs API call helper
async function elCall(method, path, data = null, extraHeaders = {}, responseType = 'json') {
  const config = {
    method,
    url: `${EL_BASE}${path}`,
    headers: getElHeaders(extraHeaders),
    responseType
  };
  if (data) config.data = data;
  return axios(config);
}

// Multer setup
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('audio/') || file.originalname.match(/\.(mp3|wav|ogg|m4a|flac|webm|aac)$/i)) {
      cb(null, true);
    } else {
      cb(null, false);
    }
  }
});

// ============================================================
// 1. CHECK SESSION - Session valid hai ya nahi
// GET /api/voiceover/check-session
// ============================================================
router.get('/check-session', authMiddleware, async (req, res) => {
  try {
    const response = await elCall('GET', '/user');
    const user = response.data;
    res.json({
      valid: true,
      el_username: user.first_name || user.username || 'ElevenLabs User',
      tier: user.subscription?.tier || 'free',
      character_count: user.subscription?.character_count || 0,
      character_limit: user.subscription?.character_limit || 10000,
      remaining: (user.subscription?.character_limit || 10000) - (user.subscription?.character_count || 0)
    });
  } catch (err) {
    res.status(401).json({
      valid: false,
      error: 'ElevenLabs session expire ho gayi! Admin ko update karna hoga.'
    });
  }
});

// ============================================================
// 2. GET ALL VOICES - Sabhi voices (account ki bhi)
// GET /api/voiceover/voices
// ============================================================
router.get('/voices', authMiddleware, async (req, res) => {
  try {
    const response = await elCall('GET', '/voices?show_legacy=true');
    const voices = response.data.voices.map(v => ({
      voice_id: v.voice_id,
      name: v.name,
      category: v.category,
      description: v.description,
      preview_url: v.preview_url,
      labels: v.labels || {},
      samples: v.samples?.length || 0,
      sharing: v.sharing,
      fine_tuning: v.fine_tuning
    }));

    const order = { cloned: 0, generated: 1, professional: 2, premade: 3 };
    voices.sort((a, b) => (order[a.category] ?? 9) - (order[b.category] ?? 9));

    res.json({ voices, total: voices.length });
  } catch (err) {
    console.error('Voices error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Voices load nahi ho saki. Session check karo.' });
  }
});

// ============================================================
// 3. TEXT TO SPEECH - TRULY UNLIMITED
//    Session use karta hai - koi API billing nahi
// POST /api/voiceover/generate
// ============================================================
router.post('/generate', authMiddleware, async (req, res) => {
  try {
    const { text, voice_id, stability, similarity_boost, style, model_id, speed } = req.body;

    if (!text || !voice_id) {
      return res.status(400).json({ error: 'Text aur Voice ID required hai!' });
    }

    const MAX_CHUNK = 4999;

    const generateChunk = async (chunk) => {
      const response = await elCall(
        'POST',
        `/text-to-speech/${voice_id}`,
        {
          text: chunk,
          model_id: model_id || 'eleven_multilingual_v2',
          voice_settings: {
            stability: stability ?? 0.5,
            similarity_boost: similarity_boost ?? 0.75,
            style: style ?? 0,
            use_speaker_boost: true,
            speed: speed ?? 1.0
          }
        },
        { 'Accept': 'audio/mpeg' },
        'arraybuffer'
      );
      return Buffer.from(response.data);
    };

    let combined;
    let chunksCount = 1;

    if (text.length <= MAX_CHUNK) {
      // Direct - no chunking needed
      combined = await generateChunk(text);
    } else {
      // Auto-chunk for unlimited text
      const chunks = [];
      let start = 0;
      while (start < text.length) {
        let end = start + MAX_CHUNK;
        if (end < text.length) {
          const lastPunct = Math.max(
            text.lastIndexOf('.', end),
            text.lastIndexOf('!', end),
            text.lastIndexOf('?', end),
            text.lastIndexOf('\n', end)
          );
          if (lastPunct > start + 100) end = lastPunct + 1;
        }
        chunks.push(text.slice(start, Math.min(end, text.length)));
        start = end;
      }
      chunksCount = chunks.length;

      // Sequential chunks (to avoid rate limiting)
      const buffers = [];
      for (const chunk of chunks) {
        const buf = await generateChunk(chunk);
        buffers.push(buf);
      }
      combined = Buffer.concat(buffers);
    }

    // Track usage
    await User.findByIdAndUpdate(req.user._id, {
      $inc: { totalRequests: 1, totalCharacters: text.length }
    });

    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Disposition': 'attachment; filename="voiceover.mp3"',
      'X-Characters-Used': text.length,
      'X-Chunks-Used': chunksCount,
      'Access-Control-Expose-Headers': 'X-Characters-Used, X-Chunks-Used'
    });

    res.send(combined);

  } catch (err) {
    console.error('Generate error:', err.response?.data || err.message);
    if (err.response?.status === 401) {
      return res.status(401).json({ error: 'ElevenLabs session expire! Admin se contact karo.' });
    }
    if (err.response?.status === 422) {
      const detail = err.response?.data?.detail;
      return res.status(422).json({ error: typeof detail === 'string' ? detail : JSON.stringify(detail) });
    }
    res.status(500).json({ error: 'Voiceover generate nahi ho saka. Dobara try karo.' });
  }
});

// ============================================================
// 4. VOICE CLONING
// POST /api/voiceover/clone
// ============================================================
router.post('/clone', authMiddleware, upload.array('audio_files', 25), async (req, res) => {
  try {
    const { name, description } = req.body;
    const files = req.files;

    if (!name) return res.status(400).json({ error: 'Voice ka naam daalo!' });
    if (!files || files.length === 0) return res.status(400).json({ error: 'Kam se kam ek audio file chahiye!' });

    const formData = new FormData();
    formData.append('name', name);
    if (description) formData.append('description', description);
    files.forEach((file, i) => {
      formData.append('files', file.buffer, {
        filename: file.originalname || `audio_${i}.mp3`,
        contentType: file.mimetype || 'audio/mpeg'
      });
    });

    const response = await axios.post(`${EL_BASE}/voices/add`, formData, {
      headers: {
        ...getElHeaders(),
        ...formData.getHeaders()
      }
    });

    res.json({
      success: true,
      message: `✅ "${name}" clone ho gayi!`,
      voice_id: response.data.voice_id
    });

  } catch (err) {
    console.error('Clone error:', err.response?.data || err.message);
    const msg = err.response?.data?.detail?.message || err.message;
    res.status(500).json({ error: `Clone nahi ho saki: ${msg}` });
  }
});

// ============================================================
// 5. VOICE DESIGN - Description se nayi voice banao
// POST /api/voiceover/design
// ============================================================
router.post('/design', authMiddleware, async (req, res) => {
  try {
    const { gender, age, accent, accent_strength, text } = req.body;
    if (!gender || !age || !accent) {
      return res.status(400).json({ error: 'Gender, Age aur Accent required hain!' });
    }

    const response = await elCall(
      'POST',
      '/voice-generation/generate-voice',
      {
        gender, age, accent,
        accent_strength: accent_strength || 1.0,
        text: text || 'Hello! This is a preview of my new custom voice.'
      },
      { 'Accept': 'audio/mpeg' },
      'arraybuffer'
    );

    const generatedVoiceId = response.headers['generated-voice-id'];

    res.set({
      'Content-Type': 'audio/mpeg',
      'X-Generated-Voice-Id': generatedVoiceId,
      'Access-Control-Expose-Headers': 'X-Generated-Voice-Id'
    });
    res.send(Buffer.from(response.data));

  } catch (err) {
    console.error('Design error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Voice design nahi ho saki.' });
  }
});

// ============================================================
// 6. SAVE DESIGNED VOICE
// POST /api/voiceover/design/save
// ============================================================
router.post('/design/save', authMiddleware, async (req, res) => {
  try {
    const { voice_name, voice_description, generated_voice_id } = req.body;
    if (!voice_name || !generated_voice_id) {
      return res.status(400).json({ error: 'Voice naam aur generated_voice_id required hain!' });
    }

    const response = await elCall('POST', '/voice-generation/create-voice', {
      voice_name,
      voice_description: voice_description || '',
      generated_voice_id,
      labels: {}
    });

    res.json({ success: true, message: `✅ "${voice_name}" save ho gayi!`, voice_id: response.data.voice_id });
  } catch (err) {
    res.status(500).json({ error: 'Voice save nahi ho saki.' });
  }
});

// ============================================================
// 7. DELETE VOICE
// DELETE /api/voiceover/voices/:voice_id
// ============================================================
router.delete('/voices/:voice_id', authMiddleware, async (req, res) => {
  try {
    await elCall('DELETE', `/voices/${req.params.voice_id}`);
    res.json({ success: true, message: 'Voice delete ho gayi!' });
  } catch (err) {
    res.status(500).json({ error: 'Voice delete nahi ho saki.' });
  }
});

// ============================================================
// 8. STATS (with ElevenLabs account info)
// GET /api/voiceover/stats
// ============================================================
router.get('/stats', authMiddleware, async (req, res) => {
  try {
    const elRes = await elCall('GET', '/user');
    const sub = elRes.data.subscription || {};

    res.json({
      username: req.user.username,
      totalRequests: req.user.totalRequests,
      totalCharacters: req.user.totalCharacters,
      elevenlabs: {
        tier: sub.tier,
        character_count: sub.character_count,
        character_limit: sub.character_limit,
        remaining: sub.character_limit - sub.character_count,
        next_reset: sub.next_character_count_reset_unix
      }
    });
  } catch {
    res.json({
      username: req.user.username,
      totalRequests: req.user.totalRequests,
      totalCharacters: req.user.totalCharacters
    });
  }
});

// ============================================================
// 9. GET MODELS
// GET /api/voiceover/models
// ============================================================
router.get('/models', authMiddleware, async (req, res) => {
  try {
    const response = await elCall('GET', '/models');
    res.json({ models: response.data });
  } catch (err) {
    res.status(500).json({ error: 'Models load nahi ho sake.' });
  }
});

module.exports = router;
