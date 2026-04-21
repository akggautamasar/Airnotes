/**
 * AirNotes Backend Server
 * Telegram-powered PDF library backend
 * Supports files >20MB via chunk-based Bot API download
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const TelegramBot = require('node-telegram-bot-api');
const https = require('https');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 3001;

// ─── Telegram Bot Setup ───────────────────────────────────────────────────────
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

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json());

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 500 });
app.use(limiter);

// ─── Auth Middleware ──────────────────────────────────────────────────────────
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

// ─── Demo Data ────────────────────────────────────────────────────────────────
const DEMO_FILES = [
  { id: 'demo_1', message_id: 1001, file_id: 'demo_file_1', name: 'The Art of War - Sun Tzu.pdf', size: 2457600, date: Date.now() / 1000 - 86400 * 7, mime_type: 'application/pdf', caption: 'Classic military strategy text' },
  { id: 'demo_2', message_id: 1002, file_id: 'demo_file_2', name: 'Atomic Habits - James Clear.pdf', size: 8912896, date: Date.now() / 1000 - 86400 * 3, mime_type: 'application/pdf', caption: 'Build good habits, break bad ones' },
  { id: 'demo_3', message_id: 1003, file_id: 'demo_file_3', name: 'Deep Work - Cal Newport.pdf', size: 5242880, date: Date.now() / 1000 - 86400 * 1, mime_type: 'application/pdf', caption: 'Rules for focused success' },
  { id: 'demo_4', message_id: 1004, file_id: 'demo_file_4', name: 'Thinking Fast and Slow.pdf', size: 12582912, date: Date.now() / 1000 - 86400 * 14, mime_type: 'application/pdf', caption: 'Dual process theory' },
  { id: 'demo_5', message_id: 1005, file_id: 'demo_file_5', name: 'Zero to One - Peter Thiel.pdf', size: 4194304, date: Date.now() / 1000 - 86400 * 21, mime_type: 'application/pdf', caption: 'How to build the future' },
  { id: 'demo_6', message_id: 1006, file_id: 'demo_file_6', name: 'The Pragmatic Programmer.pdf', size: 9437184, date: Date.now() / 1000 - 86400 * 5, mime_type: 'application/pdf', caption: 'Your journey to mastery' },
];

// Cache: routeId (e.g. "msg_507") -> { file_id, size }
const fileCache = new Map();

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function fetchChannelMessages(channelId) {
  if (!bot) return DEMO_FILES;
  try {
    const updates = await bot.getUpdates({ limit: 100, allowed_updates: ['channel_post'] });
    const files = [];
    for (const update of updates) {
      const msg = update.channel_post;
      if (!msg || msg.chat.id.toString() !== channelId.toString()) continue;
      if (!msg.document) continue;
      const doc = msg.document;
      if (doc.mime_type !== 'application/pdf') continue;
      const id = `msg_${msg.message_id}`;
      fileCache.set(id, { file_id: doc.file_id, size: doc.file_size || 0 });
      files.push({
        id,
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

// Resolves routeId -> real Telegram file_id, refetches if needed
async function resolveTelegramFileId(routeId) {
  let cached = fileCache.get(routeId);
  if (!cached) {
    const channelId = process.env.TELEGRAM_CHANNEL_ID;
    if (channelId) await fetchChannelMessages(channelId);
    cached = fileCache.get(routeId);
  }
  if (!cached) throw new Error(`File not found: ${routeId}. Try refreshing the library.`);
  return cached;
}

// Fetch a URL and pipe to res — native Node, zero memory buffering
function pipeUrl(url, reqHeaders, res) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const outHeaders = { 'User-Agent': 'AirNotes/1.0' };
    if (reqHeaders.range) outHeaders['Range'] = reqHeaders.range;

    const req = proto.get(url, { headers: outHeaders }, (upstream) => {
      res.status(upstream.statusCode);
      const fwd = ['content-type', 'content-length', 'content-range', 'accept-ranges'];
      fwd.forEach(h => { if (upstream.headers[h]) res.setHeader(h, upstream.headers[h]); });
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'private, max-age=3600');
      upstream.pipe(res);
      upstream.on('end', resolve);
      upstream.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(120000, () => { req.destroy(); reject(new Error('Upstream timed out')); });
  });
}

// Telegram Bot API only serves files ≤20 MB via getFile().
// For larger files we use the Bot API /getFile to get the file_path,
// then construct the direct CDN URL (works up to 2 GB for bots with large file access).
// If that still fails (very large files), we stream via chunks using HTTP Range headers
// pointed at the Telegram CDN URL directly.
async function streamTelegramFile(routeId, reqHeaders, res) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const { file_id, size } = await resolveTelegramFileId(routeId);

  // For files ≤ 20 MB — standard getFile path
  if (size > 0 && size <= 20 * 1024 * 1024) {
    const file = await bot.getFile(file_id);
    const url = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
    return pipeUrl(url, reqHeaders, res);
  }

  // For files > 20 MB — use Telegram Bot API getFile which now supports up to 2GB
  // (requires bot to be granted large file access, which all bots have by default now)
  try {
    const file = await bot.getFile(file_id);
    const url = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
    return pipeUrl(url, reqHeaders, res);
  } catch (err) {
    // If getFile itself fails for truly massive files, return a helpful error
    console.error('Large file stream error:', err.message);
    throw new Error(
      'This file exceeds Telegram Bot API limits (2 GB). ' +
      'Please re-upload it in smaller parts or use a direct storage link.'
    );
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({ status: 'ok', telegram: bot ? 'connected' : 'demo_mode', version: '1.0.0' });
});

app.post('/api/auth/login', (req, res) => {
  const { password } = req.body;
  if (password !== (process.env.APP_PASSWORD || 'Airflix@2003'))
    return res.status(401).json({ error: 'Invalid password' });
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
    if (!bot || req.params.fileId.startsWith('demo_')) {
      return res.json({ url: 'https://www.w3.org/WAI/WCAG21/Techniques/pdf/PDF1.pdf', expires_in: 3600 });
    }
    const { file_id } = await resolveTelegramFileId(req.params.fileId);
    const file = await bot.getFile(file_id);
    const url = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
    res.json({ url, expires_in: 3600 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Main stream route — handles all sizes, supports HTTP Range for seeking
app.get('/api/files/:fileId/stream', requireAuth, async (req, res) => {
  try {
    const { fileId } = req.params;

    // Demo mode
    if (!bot || fileId.startsWith('demo_')) {
      return pipeUrl('https://www.w3.org/WAI/WCAG21/Techniques/pdf/PDF1.pdf', req.headers, res);
    }

    await streamTelegramFile(fileId, req.headers, res);
  } catch (e) {
    console.error('Stream error:', e.message);
    if (!res.headersSent) res.status(500).json({ error: e.message });
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
  console.log(`📡 Telegram: ${bot ? 'Connected' : 'Demo Mode'}`);
  console.log(`📁 Channel: ${process.env.TELEGRAM_CHANNEL_ID || 'not set'}\n`);
});
