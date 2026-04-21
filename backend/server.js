require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

const app = express();

// ✅ Safe PORT handling (works locally + Render)
const PORT = process.env.PORT || 10000;

let bot = null;

/* =========================
   TELEGRAM INIT
========================= */
function initBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;

  if (!token || token === 'your_bot_token_here') {
    console.warn('⚠️ TELEGRAM_BOT_TOKEN not set. Using demo mode.');
    return null;
  }

  try {
    const b = new TelegramBot(token, { polling: false });
    console.log('✅ Telegram bot initialized');
    return b;
  } catch (e) {
    console.error('❌ Failed to init bot:', e.message);
    return null;
  }
}

bot = initBot();

/* =========================
   MIDDLEWARE
========================= */
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true,
}));

app.use(express.json());

app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
}));

/* =========================
   AUTH MIDDLEWARE
========================= */
function requireAuth(req, res, next) {
  const auth = req.headers.authorization;

  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const decoded = jwt.verify(
      auth.slice(7),
      process.env.JWT_SECRET || 'dev_secret'
    );
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/* =========================
   DEMO DATA
========================= */
const DEMO_FILES = [
  {
    id: 'demo_1',
    file_id: 'demo',
    name: 'Demo PDF.pdf',
    size: 1000000,
    date: Date.now() / 1000,
    mime_type: 'application/pdf',
    caption: 'Demo file',
  }
];

/* =========================
   FETCH TELEGRAM FILES
========================= */
async function fetchChannelMessages(channelId) {
  if (!bot) return DEMO_FILES;

  try {
    const updates = await bot.getUpdates({
      limit: 100,
      allowed_updates: ['channel_post']
    });

    const files = [];

    for (const update of updates) {
      const msg = update.channel_post;

      if (!msg) continue;
      if (msg.chat.id.toString() !== channelId.toString()) continue;
      if (!msg.document) continue;

      files.push({
        id: `msg_${msg.message_id}`,
        message_id: msg.message_id,
        file_id: msg.document.file_id,
        name: msg.document.file_name || `File_${msg.message_id}.pdf`,
        size: msg.document.file_size || 0,
        date: msg.date,
        mime_type: msg.document.mime_type,
        caption: msg.caption || '',
      });
    }

    return files.length ? files : DEMO_FILES;

  } catch (e) {
    console.error('❌ Telegram fetch error:', e.message);
    return DEMO_FILES;
  }
}

/* =========================
   GET FILE URL
========================= */
async function getFileDownloadUrl(fileId) {
  if (!bot || fileId.startsWith('demo')) {
    return 'https://www.w3.org/WAI/WCAG21/Techniques/pdf/PDF1.pdf';
  }

  try {
    const file = await bot.getFile(fileId);
    const token = process.env.TELEGRAM_BOT_TOKEN;

    return `https://api.telegram.org/file/bot${token}/${file.file_path}`;
  } catch (e) {
    console.error('❌ File URL error:', e.message);
    throw new Error('Failed to get file URL');
  }
}

/* =========================
   ROUTES
========================= */

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    telegram: bot ? 'connected' : 'demo_mode'
  });
});

/* LOGIN */
app.post('/api/auth/login', (req, res) => {
  const { password } = req.body;

  if (password !== (process.env.APP_PASSWORD || 'Airflix@2003')) {
    return res.status(401).json({ error: 'Invalid password' });
  }

  const token = jwt.sign(
    { authenticated: true },
    process.env.JWT_SECRET || 'dev_secret',
    { expiresIn: '7d' }
  );

  res.json({
    token,
    demo_mode: !bot
  });
});

/* VERIFY */
app.get('/api/auth/verify', requireAuth, (req, res) => {
  res.json({ valid: true });
});

/* FILE LIST */
app.get('/api/files', requireAuth, async (req, res) => {
  try {
    const channelId = process.env.TELEGRAM_CHANNEL_ID || 'demo';
    const files = await fetchChannelMessages(channelId);

    res.json({ files });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* STREAM PDF */
app.get('/api/files/:fileId/stream', requireAuth, async (req, res) => {
  try {
    const url = await getFileDownloadUrl(req.params.fileId);

    const response = await axios({
      method: 'GET',
      url,
      responseType: 'stream'
    });

    res.setHeader('Content-Type', 'application/pdf');
    response.data.pipe(res);

  } catch (e) {
    console.error('❌ Stream error:', e.message);
    res.status(500).json({ error: 'Stream failed' });
  }
});

/* SEARCH */
app.get('/api/search', requireAuth, async (req, res) => {
  const { q } = req.query;

  if (!q) return res.json({ files: [] });

  try {
    const channelId = process.env.TELEGRAM_CHANNEL_ID || 'demo';
    const files = await fetchChannelMessages(channelId);

    const results = files.filter(f =>
      f.name.toLowerCase().includes(q.toLowerCase())
    );

    res.json({ files: results });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* TELEGRAM INFO */
app.get('/api/telegram/info', requireAuth, async (req, res) => {
  if (!bot) return res.json({ connected: false });

  try {
    const me = await bot.getMe();
    res.json({ connected: true, bot: me });
  } catch (e) {
    res.json({ connected: false });
  }
});

/* =========================
   START SERVER
========================= */
app.listen(PORT, () => {
  console.log(`\n🚀 Server running on port ${PORT}`);
  console.log(`📡 Telegram: ${bot ? 'Connected' : 'Demo Mode'}\n`);
});
