/**
 * AirNotes Backend Server
 * Telegram-powered PDF library backend
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3001;

// ─── Telegram Bot Setup ───────────────────────────────────────────────────────
let bot = null;
let botInfo = null;

function initBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || token === 'your_bot_token_here') {
    console.warn('⚠️  TELEGRAM_BOT_TOKEN not set. Using demo mode.');
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

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json());

// Rate limiting
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200 });
app.use(limiter);

// ─── Auth Middleware ──────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const decoded = jwt.verify(auth.slice(7), process.env.JWT_SECRET || 'dev_secret');
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ─── Demo Data (when Telegram not configured) ─────────────────────────────────
const DEMO_FILES = [
  {
    id: 'demo_1', message_id: 1001, file_id: 'demo_file_1',
    name: 'The Art of War - Sun Tzu.pdf', size: 2457600,
    date: Date.now() / 1000 - 86400 * 7, mime_type: 'application/pdf',
    caption: 'Classic military strategy text'
  },
  {
    id: 'demo_2', message_id: 1002, file_id: 'demo_file_2',
    name: 'Atomic Habits - James Clear.pdf', size: 8912896,
    date: Date.now() / 1000 - 86400 * 3, mime_type: 'application/pdf',
    caption: 'Build good habits, break bad ones'
  },
  {
    id: 'demo_3', message_id: 1003, file_id: 'demo_file_3',
    name: 'Deep Work - Cal Newport.pdf', size: 5242880,
    date: Date.now() / 1000 - 86400 * 1, mime_type: 'application/pdf',
    caption: 'Rules for focused success in a distracted world'
  },
  {
    id: 'demo_4', message_id: 1004, file_id: 'demo_file_4',
    name: 'Thinking Fast and Slow - Kahneman.pdf', size: 12582912,
    date: Date.now() / 1000 - 86400 * 14, mime_type: 'application/pdf',
    caption: 'Dual process theory of thinking'
  },
  {
    id: 'demo_5', message_id: 1005, file_id: 'demo_file_5',
    name: 'Zero to One - Peter Thiel.pdf', size: 4194304,
    date: Date.now() / 1000 - 86400 * 21, mime_type: 'application/pdf',
    caption: 'Notes on startups, or how to build the future'
  },
  {
    id: 'demo_6', message_id: 1006, file_id: 'demo_file_6',
    name: 'The Pragmatic Programmer.pdf', size: 9437184,
    date: Date.now() / 1000 - 86400 * 5, mime_type: 'application/pdf',
    caption: 'Your journey to mastery'
  },
];

// ─── Telegram Helpers ─────────────────────────────────────────────────────────
async function fetchChannelMessages(channelId, limit = 100) {
  if (!bot) return DEMO_FILES;

  try {
    // Use Bot API to get recent messages with documents
    const updates = await bot.getUpdates({ limit: 100, allowed_updates: ['channel_post'] });
    const files = [];

    for (const update of updates) {
      const msg = update.channel_post;
      if (!msg || msg.chat.id.toString() !== channelId.toString()) continue;
      if (!msg.document) continue;

      const doc = msg.document;
      if (doc.mime_type !== 'application/pdf') continue;

      files.push({
        id: `msg_${msg.message_id}`,
        message_id: msg.message_id,
        file_id: doc.file_id,
        name: doc.file_name || `Document_${msg.message_id}.pdf`,
        size: doc.file_size || 0,
        date: msg.date,
        mime_type: doc.mime_type,
        caption: msg.caption || '',
      });
    }

    return files.length > 0 ? files : DEMO_FILES;
  } catch (e) {
    console.error('Telegram fetch error:', e.message);
    return DEMO_FILES;
  }
}

async function getFileDownloadUrl(fileId) {
  if (!bot || fileId.startsWith('demo_')) {
    // Return a sample PDF for demo mode
    return 'https://www.w3.org/WAI/WCAG21/Techniques/pdf/PDF1.pdf';
  }

  try {
    const file = await bot.getFile(fileId);
    const token = process.env.TELEGRAM_BOT_TOKEN;
    return `https://api.telegram.org/file/bot${token}/${file.file_path}`;
  } catch (e) {
    console.error('Get file error:', e.message);
    throw new Error('Failed to get file URL');
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    telegram: bot ? 'connected' : 'demo_mode',
    version: '1.0.0'
  });
});

// Login
app.post('/api/auth/login', (req, res) => {
  const { password } = req.body;
  const correctPassword = process.env.APP_PASSWORD || 'Airflix@2003';

  if (password !== correctPassword) {
    return res.status(401).json({ error: 'Invalid password' });
  }

  const token = jwt.sign(
    { authenticated: true, loginAt: Date.now() },
    process.env.JWT_SECRET || 'dev_secret',
    { expiresIn: '7d' }
  );

  res.json({
    token,
    message: 'Login successful',
    demo_mode: !bot
  });
});

// Verify token
app.get('/api/auth/verify', requireAuth, (req, res) => {
  res.json({ valid: true, demo_mode: !bot });
});

// List all PDFs from Telegram channel
app.get('/api/files', requireAuth, async (req, res) => {
  try {
    const channelId = process.env.TELEGRAM_CHANNEL_ID || 'demo';
    const files = await fetchChannelMessages(channelId);
    res.json({ files, total: files.length, demo_mode: !bot });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get file info + download URL
app.get('/api/files/:fileId/url', requireAuth, async (req, res) => {
  try {
    const url = await getFileDownloadUrl(req.params.fileId);
    res.json({ url, expires_in: 3600 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Stream/proxy PDF (handles range requests for streaming)
app.get('/api/files/:fileId/stream', requireAuth, async (req, res) => {
  try {
    const url = await getFileDownloadUrl(req.params.fileId);
    const range = req.headers.range;

    const headers = { 'User-Agent': 'AirNotes/1.0' };
    if (range) headers['Range'] = range;

    const response = await axios({
      method: 'GET',
      url,
      responseType: 'stream',
      headers,
      validateStatus: (s) => s < 500,
    });

    // Forward headers
    res.status(response.status);
    const contentType = response.headers['content-type'] || 'application/pdf';
    const contentLength = response.headers['content-length'];
    const contentRange = response.headers['content-range'];

    res.setHeader('Content-Type', contentType);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (contentLength) res.setHeader('Content-Length', contentLength);
    if (contentRange) res.setHeader('Content-Range', contentRange);

    response.data.pipe(res);
  } catch (e) {
    console.error('Stream error:', e.message);
    res.status(500).json({ error: 'Failed to stream file' });
  }
});

// Search files
app.get('/api/search', requireAuth, async (req, res) => {
  const { q } = req.query;
  if (!q) return res.json({ files: [] });

  try {
    const channelId = process.env.TELEGRAM_CHANNEL_ID || 'demo';
    const allFiles = await fetchChannelMessages(channelId);
    const query = q.toLowerCase();

    const results = allFiles.filter(f =>
      f.name.toLowerCase().includes(query) ||
      (f.caption && f.caption.toLowerCase().includes(query))
    );

    res.json({ files: results, query: q });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Bot info / connection test
app.get('/api/telegram/info', requireAuth, async (req, res) => {
  if (!bot) {
    return res.json({ connected: false, mode: 'demo', message: 'Running in demo mode. Set TELEGRAM_BOT_TOKEN to connect.' });
  }

  try {
    const me = await bot.getMe();
    res.json({ connected: true, bot: me });
  } catch (e) {
    res.json({ connected: false, error: e.message });
  }
});

// ─── Start Server ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 AirNotes Backend running on http://localhost:${PORT}`);
  console.log(`📡 Telegram: ${bot ? 'Connected' : 'Demo Mode (no token)'}`);
  console.log(`📁 Channel: ${process.env.TELEGRAM_CHANNEL_ID || 'not set'}\n`);
});
