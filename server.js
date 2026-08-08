/**
 * RailHop — Production Backend Server
 * Proxies IRCTC APIs with session management, caching, and rate limiting.
 *
 * All files (server.js, index.html, style.css, app.js, algorithm.js)
 * must be in the SAME folder.
 *
 * Local:  npm install  →  node server.js  →  http://localhost:3001
 * Deploy: Push to GitHub, connect to Render/Railway, set start command to: node server.js
 */

'use strict';

const express   = require('express');
const axios     = require('axios');
const cors      = require('cors');
const rateLimit = require('express-rate-limit');
const path      = require('path');

const app  = express();
const PORT = process.env.PORT || 3001;

/* ── Middleware ──────────────────────────────────────────────────── */
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));          // Serve all files from same folder

/* Rate limit: 60 API requests per IP per minute */
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a minute and try again.' },
});
app.use('/api/', limiter);

/* ── In-memory cache ─────────────────────────────────────────────── */
const cache = new Map();

function getCached(key) {
  const item = cache.get(key);
  if (!item) return null;
  if (Date.now() > item.expires) { cache.delete(key); return null; }
  return item.data;
}

function setCached(key, data, ttlMs) {
  // Keep cache size manageable
  if (cache.size > 500) {
    const firstKey = cache.keys().next().value;
    cache.delete(firstKey);
  }
  cache.set(key, { data, expires: Date.now() + ttlMs });
}

/* ── IRCTC browser headers ───────────────────────────────────────── */
const BROWSER_HEADERS = {
  'User-Agent'      : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Accept'          : 'application/json, text/plain, */*',
  'Accept-Language' : 'en-IN,en-US;q=0.9,hi;q=0.8',
  'Accept-Encoding' : 'gzip, deflate, br',
  'Origin'          : 'https://www.irctc.co.in',
  'Referer'         : 'https://www.irctc.co.in/online-charts/',
  'sec-ch-ua'       : '"Google Chrome";v="125", "Chromium";v="125", "Not.A/Brand";v="24"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'Sec-Fetch-Dest'  : 'empty',
  'Sec-Fetch-Mode'  : 'cors',
  'Sec-Fetch-Site'  : 'same-origin',
  'Connection'      : 'keep-alive',
};

/* ── Session cookie management ───────────────────────────────────── */
let cookieJar  = '';
let cookieTime = 0;
const COOKIE_TTL = 12 * 60 * 1000; // 12 minutes

async function refreshCookies() {
  try {
    const res = await axios.get('https://www.irctc.co.in/online-charts/', {
      headers: { ...BROWSER_HEADERS },
      timeout: 12000,
      maxRedirects: 5,
      validateStatus: () => true,
    });
    const raw = res.headers['set-cookie'];
    if (raw?.length) {
      cookieJar  = raw.map(c => c.split(';')[0]).join('; ');
      cookieTime = Date.now();
      console.log('[cookies] Session refreshed');
    }
  } catch (e) {
    console.warn('[cookies] Refresh failed:', e.message);
  }
}

async function getCookies() {
  if (!cookieJar || Date.now() - cookieTime > COOKIE_TTL) {
    await refreshCookies();
  }
  return cookieJar;
}

/* ── IRCTC request helpers ───────────────────────────────────────── */
async function irctcGet(url, extra = {}) {
  const cookies = await getCookies();
  return axios.get(url, {
    headers: {
      ...BROWSER_HEADERS,
      ...(cookies ? { Cookie: cookies } : {}),
      ...extra,
    },
    timeout: 15000,
    validateStatus: () => true,
  });
}

async function irctcPost(url, body) {
  const cookies = await getCookies();
  return axios.post(url, body, {
    headers: {
      ...BROWSER_HEADERS,
      'Content-Type': 'application/json',
      ...(cookies ? { Cookie: cookies } : {}),
    },
    timeout: 15000,
    validateStatus: () => true,
  });
}

/* Parse IRCTC response or throw clear error */
function parseResponse(res, label) {
  if (res.status === 403) {
    // Force cookie refresh on next request
    cookieJar  = '';
    cookieTime = 0;
    throw new Error(`IRCTC blocked the request (403) for ${label}. Try again in 10–15 seconds.`);
  }
  if (res.status === 429) {
    throw new Error('Too many requests to IRCTC (429). Wait 30 seconds and try again.');
  }
  if (res.status >= 500) {
    throw new Error(`IRCTC server error (${res.status}). Their service may be temporarily down.`);
  }
  const ct = (res.headers['content-type'] || '').toLowerCase();
  if (!ct.includes('json')) {
    const preview = typeof res.data === 'string' ? res.data.slice(0, 120) : '';
    throw new Error(`IRCTC returned non-JSON for ${label} (HTTP ${res.status}). ${preview}`);
  }
  return res.data;
}

/* ══════════════════════════════════════════════════════════════════
   API ROUTES
══════════════════════════════════════════════════════════════════ */

/* Health check */
app.get('/api/ping', (_req, res) => {
  res.json({ ok: true, server: 'RailHop', time: new Date().toISOString() });
});

/* ── 1. Train schedule (stations + timings) ─────────────────────── */
app.get('/api/train/:trainNo/schedule', async (req, res) => {
  const { trainNo } = req.params;

  if (!/^\d{4,5}$/.test(trainNo)) {
    return res.status(400).json({ error: 'Invalid train number. Must be 4–5 digits.' });
  }

  // Cache schedule for 60 minutes (rarely changes)
  const cacheKey = `schedule:${trainNo}`;
  const cached   = getCached(cacheKey);
  if (cached) return res.json(cached);

  try {
    const url = `https://www.irctc.co.in/eticketing/protected/mapps1/trnscheduleenquiry/${trainNo}`;
    const raw = await irctcGet(url, {
      bmirak: 'webbm',
      greq  : Date.now().toString(),
    });
    const data = parseResponse(raw, 'schedule');

    if (!data?.stationList?.length) {
      return res.status(404).json({ error: `Train ${trainNo} not found or has no schedule.` });
    }

    setCached(cacheKey, data, 60 * 60 * 1000); // 60 min
    res.json(data);
  } catch (err) {
    console.error('[schedule]', err.message);
    res.status(502).json({ error: err.message });
  }
});

/* ── 2. Chart composition (coach list + chart-ready status) ──────── */
app.post('/api/chart/composition', async (req, res) => {
  const { trainNo, jDate, boardingStation } = req.body || {};

  if (!trainNo || !jDate || !boardingStation) {
    return res.status(400).json({ error: 'Required: trainNo, jDate, boardingStation' });
  }

  // Cache composition for 3 minutes (chart status can change)
  const cacheKey = `comp:${trainNo}:${jDate}:${boardingStation}`;
  const cached   = getCached(cacheKey);
  if (cached) return res.json(cached);

  try {
    const raw  = await irctcPost(
      'https://www.irctc.co.in/online-charts/api/trainComposition',
      { trainNo, jDate, boardingStation }
    );
    const data = parseResponse(raw, 'composition');
    setCached(cacheKey, data, 3 * 60 * 1000); // 3 min
    res.json(data);
  } catch (err) {
    console.error('[composition]', err.message);
    res.status(502).json({ error: err.message });
  }
});

/* ── 3. Vacant berths ────────────────────────────────────────────── */
app.post('/api/chart/vacant', async (req, res) => {
  const {
    trainNo, boardingStation, remoteStation,
    trainSourceStation, jDate, cls,
  } = req.body || {};

  if (!trainNo || !jDate || !cls || !boardingStation) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }

  // Cache vacant berths for 90 seconds (changes frequently with cancellations)
  const cacheKey = `vacant:${trainNo}:${jDate}:${boardingStation}:${cls}`;
  const cached   = getCached(cacheKey);
  if (cached) return res.json(cached);

  try {
    const raw  = await irctcPost(
      'https://www.irctc.co.in/online-charts/api/vacantBerth',
      { trainNo, boardingStation, remoteStation, trainSourceStation, jDate, cls, chartType: 2 }
    );
    const data = parseResponse(raw, 'vacantBerth');
    setCached(cacheKey, data, 90 * 1000); // 90 seconds
    res.json(data);
  } catch (err) {
    console.error('[vacant]', err.message);
    res.status(502).json({ error: err.message });
  }
});

/* ── Serve index.html for all other routes ───────────────────────── */
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

/* ── Start ───────────────────────────────────────────────────────── */
app.listen(PORT, async () => {
  console.log(`\n🚆  RailHop → http://localhost:${PORT}`);
  console.log('📡  Endpoints ready:');
  console.log('    GET  /api/train/:no/schedule');
  console.log('    POST /api/chart/composition');
  console.log('    POST /api/chart/vacant\n');
  await refreshCookies(); // Warm up session on start
});
