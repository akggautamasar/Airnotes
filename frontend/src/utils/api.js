const BASE_URL = import.meta.env.VITE_API_URL || '/api';

function getToken() { return localStorage.getItem('airnotes_token'); }

async function request(path, options = {}) {
  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };
  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });
  if (res.status === 401) { localStorage.removeItem('airnotes_token'); window.location.reload(); return; }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export const api = {
  login: (password) => request('/auth/login', { method: 'POST', body: JSON.stringify({ password }) }),
  verify: () => request('/auth/verify'),
  getFiles: () => request('/files'),
  getFileUrl: (fileId) => request(`/files/${fileId}/url`),
  getStreamUrl: (fileId) => `${BASE_URL}/files/${encodeURIComponent(fileId)}/stream`,
  search: (q) => request(`/search?q=${encodeURIComponent(q)}`),
  telegramInfo: () => request('/telegram/info'),
};
