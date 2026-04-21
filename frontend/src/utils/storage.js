import { openDB } from 'idb';

const DB_NAME = 'airnotes_db';
const DB_VERSION = 1;
let dbPromise = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('highlights')) {
          const hs = db.createObjectStore('highlights', { keyPath: 'id', autoIncrement: true });
          hs.createIndex('fileId', 'fileId'); hs.createIndex('page', 'page');
        }
        if (!db.objectStoreNames.contains('bookmarks')) {
          const bs = db.createObjectStore('bookmarks', { keyPath: 'id', autoIncrement: true });
          bs.createIndex('fileId', 'fileId');
        }
        if (!db.objectStoreNames.contains('progress')) db.createObjectStore('progress', { keyPath: 'fileId' });
        if (!db.objectStoreNames.contains('folders')) {
          const fs = db.createObjectStore('folders', { keyPath: 'id' });
          fs.createIndex('parentId', 'parentId');
        }
        if (!db.objectStoreNames.contains('fileAssignments')) {
          const fa = db.createObjectStore('fileAssignments', { keyPath: 'fileId' });
          fa.createIndex('folderId', 'folderId');
        }
        if (!db.objectStoreNames.contains('recent')) db.createObjectStore('recent', { keyPath: 'fileId' });
        if (!db.objectStoreNames.contains('tags')) {
          const ts = db.createObjectStore('tags', { keyPath: 'id', autoIncrement: true });
          ts.createIndex('fileId', 'fileId');
        }
      }
    });
  }
  return dbPromise;
}

export const highlightStore = {
  async add(fileId, page, text, color = 'yellow', note = '') {
    const db = await getDB();
    return db.add('highlights', { fileId, page, text, color, note, createdAt: Date.now() });
  },
  async getByFile(fileId) { const db = await getDB(); return db.getAllFromIndex('highlights', 'fileId', fileId); },
  async delete(id) { const db = await getDB(); return db.delete('highlights', id); },
  async update(id, updates) { const db = await getDB(); const e = await db.get('highlights', id); return db.put('highlights', { ...e, ...updates }); }
};

export const bookmarkStore = {
  async add(fileId, page, label = '') {
    const db = await getDB();
    const existing = await db.getAllFromIndex('bookmarks', 'fileId', fileId);
    if (existing.some(b => b.page === page)) return null;
    return db.add('bookmarks', { fileId, page, label, createdAt: Date.now() });
  },
  async remove(fileId, page) {
    const db = await getDB();
    const all = await db.getAllFromIndex('bookmarks', 'fileId', fileId);
    const bm = all.find(b => b.page === page);
    if (bm) await db.delete('bookmarks', bm.id);
  },
  async getByFile(fileId) { const db = await getDB(); return db.getAllFromIndex('bookmarks', 'fileId', fileId); },
  async isBookmarked(fileId, page) { const bms = await this.getByFile(fileId); return bms.some(b => b.page === page); }
};

export const progressStore = {
  async save(fileId, currentPage, totalPages) {
    const db = await getDB();
    return db.put('progress', { fileId, currentPage, totalPages, percent: Math.round((currentPage/totalPages)*100), updatedAt: Date.now() });
  },
  async get(fileId) { const db = await getDB(); return db.get('progress', fileId); },
  async getAll() { const db = await getDB(); return db.getAll('progress'); }
};

export const folderStore = {
  async create(name, parentId = null) {
    const db = await getDB();
    const id = `folder_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    await db.put('folders', { id, name, parentId, createdAt: Date.now() });
    return id;
  },
  async getAll() { const db = await getDB(); return db.getAll('folders'); },
  async rename(id, name) { const db = await getDB(); const f = await db.get('folders', id); return db.put('folders', { ...f, name }); },
  async delete(id) {
    const db = await getDB();
    await db.delete('folders', id);
    const assignments = await db.getAllFromIndex('fileAssignments', 'folderId', id);
    for (const a of assignments) await db.delete('fileAssignments', a.fileId);
  },
  async assignFile(fileId, folderId) { const db = await getDB(); return db.put('fileAssignments', { fileId, folderId, assignedAt: Date.now() }); },
  async unassignFile(fileId) { const db = await getDB(); return db.delete('fileAssignments', fileId); },
  async getFilesInFolder(folderId) { const db = await getDB(); return db.getAllFromIndex('fileAssignments', 'folderId', folderId); }
};

export const recentStore = {
  async touch(fileId, fileName) { const db = await getDB(); return db.put('recent', { fileId, fileName, openedAt: Date.now() }); },
  async getAll(limit = 10) {
    const db = await getDB();
    const all = await db.getAll('recent');
    return all.sort((a, b) => b.openedAt - a.openedAt).slice(0, limit);
  }
};
