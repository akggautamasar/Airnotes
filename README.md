# 📚 AirNotes — Telegram-Powered Digital Library

A premium PDF reading and management platform that uses **Telegram as the storage backend**. Access your PDFs from any Telegram channel through a beautiful, Kindle-inspired web interface.

---

## ✨ Features

| Feature | Details |
|---|---|
| 🔐 Password auth | Simple, JWT-backed session |
| 📡 Telegram integration | Reads PDFs from any channel your bot has access to |
| 📚 Library view | Grid + list toggle, lazy loading, cover art |
| 📁 Folder system | Create, rename, nest folders; assign PDFs |
| 🔍 Search | Real-time search by filename and caption |
| 📖 PDF Reader | Streaming, zoom, dark/sepia/light modes |
| 🔖 Bookmarks | Per-page bookmarks with visual indicators |
| 🖊️ Highlights | 4 colors, persisted in IndexedDB |
| 📊 Progress | Per-book reading progress with visual ring |
| 🖼️ Thumbnails | Lazily-rendered page thumbnail sidebar |
| ⌨️ Keyboard nav | ← → arrows, Ctrl+K search, Escape |
| 💾 Local storage | All annotations in IndexedDB (never sent to server) |

---

## 🚀 Quick Start

### 1. Clone & Install

```bash
git clone https://github.com/you/airnotes
cd airnotes
npm run install:all
```

### 2. Configure Telegram

#### Step 1: Create a bot
1. Open Telegram and message **@BotFather**
2. Send `/newbot` and follow prompts
3. Copy the **Bot Token** (looks like `1234567890:AAH...`)

#### Step 2: Find your channel ID
- For **public** channels: use `@yourchannel`
- For **private** channels:
  1. Forward any message from the channel to [@userinfobot](https://t.me/userinfobot)
  2. It will show the channel ID (a negative number like `-1001234567890`)

#### Step 3: Add bot to channel
- Go to your channel → Edit → Administrators
- Add your bot as an admin with **read messages** permission

### 3. Set Environment Variables

```bash
cd backend
cp .env.example .env
```

Edit `backend/.env`:
```env
TELEGRAM_BOT_TOKEN=1234567890:AAHxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TELEGRAM_CHANNEL_ID=-1001234567890
JWT_SECRET=some-long-random-string-here
APP_PASSWORD=Airflix@2003
PORT=3001
FRONTEND_URL=http://localhost:5173
```

### 4. Run

```bash
# From project root — starts both backend and frontend
npm run dev
```

- Frontend: http://localhost:5173
- Backend: http://localhost:3001

**Default password:** `Airflix@2003`

---

## 🗂️ Project Structure

```
airnotes/
├── backend/
│   ├── server.js          # Express API + Telegram Bot integration
│   ├── .env.example       # Environment variable template
│   └── package.json
│
├── frontend/
│   ├── src/
│   │   ├── App.jsx                    # Root with auth gate
│   │   ├── main.jsx                   # Entry point
│   │   ├── index.css                  # Global styles + Tailwind
│   │   │
│   │   ├── store/
│   │   │   └── AppContext.jsx         # Global state (useReducer)
│   │   │
│   │   ├── utils/
│   │   │   ├── api.js                 # Backend API client
│   │   │   ├── storage.js             # IndexedDB layer (highlights, bookmarks, etc.)
│   │   │   └── format.js              # Date/size/name helpers
│   │   │
│   │   ├── pages/
│   │   │   ├── LoginPage.jsx          # Password login screen
│   │   │   └── MainApp.jsx            # Main layout + routing
│   │   │
│   │   └── components/
│   │       ├── Sidebar.jsx            # Nav + folder tree
│   │       ├── library/
│   │       │   ├── LibraryView.jsx    # File grid/list with lazy load
│   │       │   └── FileCard.jsx       # Individual file card + context menu
│   │       ├── reader/
│   │       │   ├── PDFReader.jsx      # Full-screen PDF reader
│   │       │   ├── ThumbnailSidebar.jsx  # Page thumbnails with lazy rendering
│   │       │   └── AnnotationSidebar.jsx # Highlights + bookmarks panel
│   │       └── ui/
│   │           ├── TopBar.jsx         # Header bar
│   │           └── SearchModal.jsx    # ⌘K search overlay
│   │
│   ├── index.html
│   ├── vite.config.js
│   ├── tailwind.config.js
│   └── package.json
│
├── package.json           # Root scripts
└── README.md
```

---

## 🔌 API Reference

| Endpoint | Method | Description |
|---|---|---|
| `/health` | GET | Server status + connection mode |
| `/api/auth/login` | POST | Password login → JWT token |
| `/api/auth/verify` | GET | Validate current token |
| `/api/files` | GET | List all PDFs from Telegram channel |
| `/api/files/:id/url` | GET | Get direct download URL |
| `/api/files/:id/stream` | GET | **Streaming proxy** with Range request support |
| `/api/search?q=` | GET | Search files by name/caption |
| `/api/telegram/info` | GET | Bot connection info |

---

## 🏗️ Architecture

```
Telegram Channel (PDFs stored here)
        ↕ Bot API
   Express Backend   ←→   JWT Auth
        ↕ Streaming proxy (range requests)
   React Frontend
        ↕ IndexedDB
   Local annotations (highlights, bookmarks, progress)
```

**Key design decisions:**
- **PDF Streaming**: The backend proxies Telegram's file server with HTTP Range request support, so pdf.js can load pages on demand without downloading the full file
- **Demo Mode**: If no Telegram token is configured, the server returns mock data so the UI is fully testable
- **All annotations local**: Highlights, bookmarks, and reading progress are stored in IndexedDB — never sent to the server. Privacy-first.
- **Folder system is client-side**: Folder assignments live in IndexedDB. Telegram is used purely for file storage.

---

## 🌐 Deployment

### Backend (Railway / Render / Fly.io)
```bash
cd backend
# Set environment variables in your platform dashboard
npm start
```

### Frontend (Vercel / Netlify)
```bash
cd frontend
# Set VITE_API_URL=https://your-backend-url.com in platform dashboard
npm run build
# Deploy the dist/ folder
```

---

## 🔧 Customization

### Change password
Edit `APP_PASSWORD` in `backend/.env`

### Connect multiple channels
Modify `server.js` to accept a `?channel=` query param, then route to different channel IDs.

### Add Google Drive / S3 backend
The streaming proxy in `server.js` can be swapped to any signed URL source — just change `getFileDownloadUrl()`.

---

## 📝 Local Data

All reading data is stored in your browser's IndexedDB under the database `airnotes_db`:

| Store | Contents |
|---|---|
| `highlights` | Text highlights with color + page |
| `bookmarks` | Bookmarked pages |
| `progress` | Reading progress per file |
| `folders` | Folder structure |
| `fileAssignments` | Which PDF is in which folder |
| `recent` | Recently opened files |
| `tags` | File tags |

To export/backup: open DevTools → Application → IndexedDB → `airnotes_db`

---

## ⚠️ Limitations

- Telegram Bot API has a **20MB file size limit** for `getFile`. For larger files, you need the [Telegram Client API (MTProto)](https://core.telegram.org/mtproto) via libraries like `gramjs` or `telethon` — an advanced upgrade path.
- The bot must be an **admin** of the channel to read messages.
- Telegram file URLs expire after ~1 hour; the backend fetches a fresh URL on each stream request.

---

## 📄 License

MIT — built with ❤️ using React, PDF.js, Express, and Telegram Bot API.
