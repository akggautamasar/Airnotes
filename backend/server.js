require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT;

let bot = null;

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

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json());
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 200 }));

function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const decoded = jwt.verify(auth.slice(7), process.env.JWT_SECRET || 'dev_secret');
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

const DEMO_FILES = [
  { id: 'demo_1', message_id: 1001, file_id: 'demo_file_1', name: 'The Art of War - Sun Tzu.pdf', size: 2457600, date: Date.now()/1000 - 86400*7, mime_type: 'application/pdf', caption: 'Classic military strategy' },
  { id: 'demo_2', message_id: 1002, file_id: 'demo_file_2', name: 'Atomic Habits - James Clear.pdf', size: 8912896, date: Date.now()/1000 - 86400*3, mime_type: 'application/pdf', caption: 'Build good habits' },
  { id: 'demo_3', message_id: 1003, file_id: 'demo_file_3', name: 'Deep Work - Cal Newport.pdf', size: 5242880, date: Date.now()/1000 - 86400*1, mime_type: 'application/pdf', caption: 'Rules for focused success' },
  { id: 'demo_4', message_id: 1004, file_id: 'demo_file_4', name: 'Thinking Fast and Slow.pdf', size: 12582912, date: Date.now()/1000 - 86400*14, mime_type: 'application/pdf', caption: 'Dual process theory' },
  { id: 'demo_5', message_id: 1005, file_id: 'demo_file_5', name: 'Zero to One - Peter Thiel.pdf', size: 4194304, date: Date.now()/1000 - 86400*21, mime_type: 'application/pdf', caption: 'Notes on startups' },
  { id: 'demo_6', message_id: 1006, file_id: 'demo_file_6', name: 'The Pragmatic Programmer.pdf', size: 9437184, date: Date.now()/1000 - 86400*5, mime_type: 'application/pdf', caption: 'Your journey to mastery' },
];

async function fetchChannelMessages(channelId) {
  if (!bot) return DEMO_FILES;
  try {
    const updates = await bot.getUpdates({ limit: 100, allowed_updates: ['channel_post'] });
    const files = [];
    for (const update of updates) {
      const msg = update.channel_post;
      if (!msg || msg.chat.id.toString() !== channelId.toString()) continue;
      if (!msg.document || msg.document.mime_type !== 'application/pdf') continue;
      const doc = msg.document;
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
    return 'https://www.w3.org/WAI/WCAG21/Techniques/pdf/PDF1.pdf';
  }
  try {
    const file = await bot.getFile(fileId);
    const token = process.env.TELEGRAM_BOT_TOKEN;
    return `https://api.telegram.org/file/bot${token}/${file.file_path}`;
  } catch (e) {
    throw new Error('Failed to get file URL');
  }
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok', telegram: bot ? 'connected' : 'demo_mode', version: '1.0.0' });
});

app.post('/api/auth/login', (req, res) => {
  const { password } = req.body;
  if (password !== (process.env.APP_PASSWORD || 'Airflix@2003')) {
    return res.status(401).json({ error: 'Invalid password' });
  }
  const token = jwt.sign(
    { authenticated: true, loginAt: Date.now() },
    process.env.JWT_SECRET || 'dev_secret',
    { expiresIn: '7d' }
  );
  res.json({ token, message: 'Login successful', demo_mode: !bot });
});

app.get('/api/auth/verify', requireAuth, (req, res) => {
  res.json({ valid: true, demo_mode: !bot });
});

app.get('/api/files', requireAuth, async (req, res) => {
  try {
    const channelId = process.env.TELEGRAM_CHANNEL_ID || 'demo';
    const files = await fetchChannelMessages(channelId);
    res.json({ files, total: files.length, demo_mode: !bot });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/files/:fileId/url', requireAuth, async (req, res) => {
  try {
    const url = await getFileDownloadUrl(req.params.fileId);
    res.json({ url, expires_in: 3600 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/files/:fileId/stream', requireAuth, async (req, res) => {
  try {
    const url = await getFileDownloadUrl(req.params.fileId);
    const range = req.headers.range;
    const headers = { 'User-Agent': 'AirNotes/1.0' };
    if (range) headers['Range'] = range;
    const response = await axios({
      method: 'GET', url, responseType: 'stream',
      headers, validateStatus: (s) => s < 500,
    });
    res.status(response.status);
    res.setHeader('Content-Type', response.headers['content-type'] || 'application/pdf');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (response.headers['content-length']) res.setHeader('Content-Length', response.headers['content-length']);
    if (response.headers['content-range']) res.setHeader('Content-Range', response.headers['content-range']);
    response.data.pipe(res);
  } catch (e) {
    res.status(500).json({ error: 'Failed to stream file' });
  }
});

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

app.get('/api/telegram/info', requireAuth, async (req, res) => {
  if (!bot) return res.json({ connected: false, mode: 'demo' });
  try {
    const me = await bot.getMe();
    res.json({ connected: true, bot: me });
  } catch (e) {
    res.json({ connected: false, error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n🚀 AirNotes Backend running on http://localhost:${PORT}`);
  console.log(`📡 Telegram: ${bot ? 'Connected' : 'Demo Mode'}\n`);
});
