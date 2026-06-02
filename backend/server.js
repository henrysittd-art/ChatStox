'use strict';

const path = require('path');
const fs = require('fs');

// Load environment variables from current directory or parent directory fallback
const localEnvPath = path.resolve(process.cwd(), '.env');
const rootEnvPath = path.resolve(__dirname, '../.env');

if (fs.existsSync(localEnvPath)) {
  require('dotenv').config({ path: localEnvPath, override: true });
} else if (fs.existsSync(rootEnvPath)) {
  require('dotenv').config({ path: rootEnvPath, override: true });
} else {
  require('dotenv').config({ override: true });
}

const express = require('express');
const cors    = require('cors');

const app  = express();
const PORT = process.env.PORT || 8080;

const POLYGON_KEY  = process.env.POLYGON_API_KEY || 'YsPT9O6G9E5p52c3QRj7ddHTZjgBSFUM';
const POLYGON_BASE = 'https://api.polygon.io';

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { GoogleGenAI } = require('@google/genai');

const GEMINI_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_KEY) console.error('[server] GEMINI_API_KEY env var is not set — /api/chat will return 500');
const genAI = GEMINI_KEY ? new GoogleGenerativeAI(GEMINI_KEY) : null;

// Modern Google Gen AI SDK in Vertex mode — uses Cloud Run service-account IAM
// credentials (no API key, no AI Studio free-tier quota limit).
const VERTEX_PROJECT = process.env.GOOGLE_CLOUD_PROJECT || 'chat-stox';
const VERTEX_LOCATION = process.env.GOOGLE_CLOUD_LOCATION || 'us-central1';
let vertexAIClient = null;
try {
  vertexAIClient = new GoogleGenAI({
    vertexai: true,
    project: VERTEX_PROJECT,
    location: VERTEX_LOCATION,
  });
  console.log(`[Vertex AI] Initialized @google/genai (vertex) for ${VERTEX_PROJECT}/${VERTEX_LOCATION}.`);
} catch (vErr) {
  console.warn('[Vertex AI] Could not initialize @google/genai client (will fallback to AI Studio):', vErr.message);
}

// Modern AI Studio client (API-key based) for fallback when Vertex is unavailable.
let studioGenAI = null;
try {
  if (GEMINI_KEY) {
    studioGenAI = new GoogleGenAI({ apiKey: GEMINI_KEY });
    console.log('[AI Studio] Initialized @google/genai (api-key) fallback client.');
  }
} catch (sErr) {
  console.warn('[AI Studio] Could not initialize @google/genai api-key client:', sErr.message);
}

// ── Redis Client ─────────────────────────────────────────────────────────────
const { createClient } = require('redis');
const REDIS_URL = process.env.REDIS_URL || null;
let redisClient = null;

if (REDIS_URL) {
  redisClient = createClient({ url: REDIS_URL });
  redisClient.on('error', err => console.error('[Redis Client Error]', err));
  redisClient.connect()
    .then(() => console.log(`[Redis] Connected successfully to ${REDIS_URL}`))
    .catch(err => console.error('[Redis] Connection failed:', err.message));
} else {
  console.log('[Redis] REDIS_URL environment variable is not set — caching is disabled');
}

// ── Cache Helper ─────────────────────────────────────────────────────────────
const memCache = new Map();
const MAX_MEM_CACHE_SIZE = 500;

function getMemCache(key) {
  const item = memCache.get(key);
  if (item && item.expires > Date.now()) return item.data;
  if (item) memCache.delete(key); // clear expired entry
  return null;
}

function setMemCache(key, data, ttlSeconds) {
  const now = Date.now();
  // Prune expired entries to free space first
  for (const [k, v] of memCache.entries()) {
    if (v.expires <= now) memCache.delete(k);
  }
  
  // If size is still too large, delete oldest entry (Map maintains insertion order)
  if (memCache.size >= MAX_MEM_CACHE_SIZE) {
    const oldestKey = memCache.keys().next().value;
    if (oldestKey) memCache.delete(oldestKey);
  }
  
  memCache.set(key, { data, expires: now + ttlSeconds * 1000 });
}

async function withCache(key, ttlSeconds, fetchFn) {
  if (!redisClient) {
    const memCached = getMemCache(key);
    if (memCached) {
      console.log(`[Mem Cache HIT] Key: ${key}`);
      return memCached;
    }
    const data = await fetchFn();
    if (data !== null && data !== undefined) {
      setMemCache(key, data, ttlSeconds);
      console.log(`[Mem Cache MISS -> SET] Key: ${key} | TTL: ${ttlSeconds}s`);
    } else {
      console.log(`[Mem Cache MISS -> SKIP SET] Key: ${key} (falsy data, skipping cache)`);
    }
    return data;
  }
  try {
    const cached = await redisClient.get(key);
    if (cached) {
      console.log(`[Redis Cache HIT] Key: ${key}`);
      return JSON.parse(cached);
    }
  } catch (err) {
    console.warn(`[Redis Cache Read Error] Key: ${key}:`, err.message);
  }

  const data = await fetchFn();

  if (data !== null && data !== undefined) {
    try {
      await redisClient.set(key, JSON.stringify(data), { EX: ttlSeconds });
      console.log(`[Redis Cache MISS -> SET] Key: ${key} | TTL: ${ttlSeconds}s`);
    } catch (err) {
      console.warn(`[Redis Cache Write Error] Key: ${key}:`, err.message);
    }
  } else {
    console.log(`[Redis Cache MISS -> SKIP SET] Key: ${key} (falsy data, skipping cache)`);
  }

  return data;
}

// ── CORS ──────────────────────────────────────────────────────────────────────
app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    const allowedPatterns = [
      /localhost/,
      /127\.0\.0\.1/,
      /chatstox-frontend-.*\.run\.app/,
      /chatstox-backend-.*\.run\.app/,
      /chat-stox.*\.firebaseapp\.com/,
      /chat-stox.*\.web\.app/,
      /chatstox\.com/,
      /skyride\.city/
    ];
    const isAllowed = allowedPatterns.some(pattern => pattern.test(origin));
    if (isAllowed) {
      callback(null, true);
    } else {
      console.warn(`[CORS] Blocked origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST'],
  credentials: true,
}));
app.use(express.json());

app.use((req, res, next) => {
  res.setTimeout(120000);
  next();
});

// ── Fetch helper ──────────────────────────────────────────────────────────────
async function polyFetch(path, retries = 3, delay = 1000) {
  const sep = path.includes('?') ? '&' : '?';
  const url = `${POLYGON_BASE}${path}${sep}apiKey=${POLYGON_KEY}`;
  console.log(`[proxy] → ${url.replace(POLYGON_KEY, '***')}`);

  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        return await res.json();
      }

      const body = await res.text();
      const status = res.status;
      console.warn(`[polyFetch] Attempt ${i + 1} failed with status ${status}: ${body.slice(0, 100)}`);

      // Avoid retrying on deterministic client errors (e.g. 401, 403, 404)
      if (status === 401 || status === 403 || status === 404) {
        throw new Error(`Polygon ${status}: ${body.slice(0, 200)}`);
      }

      if (i === retries - 1) {
        throw new Error(`Polygon ${status} (after ${retries} retries): ${body.slice(0, 200)}`);
      }
    } catch (e) {
      if (i === retries - 1 || e.message.includes('401') || e.message.includes('403') || e.message.includes('404')) {
        throw e;
      }
      console.warn(`[polyFetch] Network/Timeout error on attempt ${i + 1}: ${e.message}`);
    }

    const backoff = delay * Math.pow(2, i);
    await new Promise(resolve => setTimeout(resolve, backoff));
  }
}

// ── GET /api/gainers ──────────────────────────────────────────────────────────
app.get('/api/gainers', async (req, res) => {
  try {
    const data = await withCache('gainers', 120, () =>
      polyFetch('/v2/snapshot/locale/us/markets/stocks/gainers?include_otc=true')
    );
    console.log(`[gainers] ${(data.tickers || []).length} tickers from Polygon`);
    res.json(data);
  } catch (e) {
    console.error('[gainers] error:', e.message);
    res.status(502).json({ error: e.message });
  }
});

// ── GET /api/losers ───────────────────────────────────────────────────────────
app.get('/api/losers', async (req, res) => {
  try {
    const data = await withCache('losers', 120, () =>
      polyFetch('/v2/snapshot/locale/us/markets/stocks/losers?include_otc=true')
    );
    console.log(`[losers] ${(data.tickers || []).length} tickers from Polygon`);
    res.json(data);
  } catch (e) {
    console.error('[losers] error:', e.message);
    res.status(502).json({ error: e.message });
  }
});

// ── GET /api/quote/:ticker ────────────────────────────────────────────────────
// Fetches v2 snapshot (OHLCV, prevDay) + v3 snapshot (AH/PM aware price)
// in parallel. v2 lastTrade is null on Starter plan after market close;
// v3 session.price is the extended-hours-aware current price.
app.get('/api/quote/:ticker', async (req, res) => {
  const { ticker } = req.params;
  try {
    const data = await withCache(`quote:${ticker.toUpperCase()}`, 15, async () => {
      const [v2, v3] = await Promise.all([
        polyFetch(`/v2/snapshot/locale/us/markets/stocks/tickers/${encodeURIComponent(ticker)}`),
        polyFetch(`/v3/snapshot?ticker.any_of=${encodeURIComponent(ticker)}`).catch(() => null),
      ]);

      const snap      = v2.ticker || (v2.tickers && v2.tickers[0]) || {};
      const v3result  = (v3?.results || [])[0] || {};
      const v3session = v3result.session || {};

      // ── AH diagnostic log ───────────────────────────────────────────────────
      console.log(`[quote/${ticker}] v2.lastTrade.p=${snap.lastTrade?.p ?? 'null'}  day.c=${snap.day?.c}` +
        `  v3.session.price=${v3session.price ?? 'null'}` +
        `  v3.late_change=${v3session.late_trading_change ?? 'null'}` +
        `  v3.market_status=${v3result.market_status ?? 'null'}`);

      // Attach v3 session block so mapSnapshot can use AH/PM prices
      snap._v3session = {
        price:          v3session.price          ?? null,
        lateChange:     v3session.late_trading_change        ?? null,
        lateChangePct:  v3session.late_trading_change_percent ?? null,
        earlyChange:    v3session.early_trading_change        ?? null,
        earlyChangePct: v3session.early_trading_change_percent ?? null,
        lastUpdated:    v3session.last_updated   ?? null,
        marketStatus:   v3result.market_status   ?? null,
      };

      return { ticker: snap };
    });

    res.json(data);
  } catch (e) {
    console.error(`[quote/${ticker}] error:`, e.message);
    res.status(502).json({ error: e.message });
  }
});

// ── GET /api/details/:ticker ──────────────────────────────────────────────────
app.get('/api/details/:ticker', async (req, res) => {
  const { ticker } = req.params;
  try {
    const data = await polyFetch(`/v3/reference/tickers/${encodeURIComponent(ticker)}`);
    res.json(data);
  } catch (e) {
    // Polygon 404 = OTC or unknown ticker. Return a safe fallback so the client
    // doesn't crash — fetchTickerDetails already handles missing fields gracefully.
    if (e.message.includes('404') || e.message.includes('Not Found')) {
      console.warn(`[details/${ticker}] Polygon 404 — returning OTC fallback`);
      return res.json({ results: { ticker, name: ticker, description: '', exchange: 'OTC', market: 'otc', type: 'CS', sic_description: 'Unknown', market_cap: 0, weighted_shares_outstanding: 0 } });
    }
    console.error(`[details/${ticker}] error:`, e.message);
    res.status(502).json({ error: e.message });
  }
});

// ── GET /api/news/:ticker ─────────────────────────────────────────────────────
app.get('/api/news/:ticker', async (req, res) => {
  const { ticker } = req.params;
  try {
    const data = await polyFetch(`/v2/reference/news?ticker=${encodeURIComponent(ticker)}&limit=5`);
    res.json(data);
  } catch (e) {
    console.error(`[news/${ticker}] error:`, e.message);
    res.status(502).json({ error: e.message });
  }
});

// ── GET /api/chart/:ticker ────────────────────────────────────────────────────
// Returns intraday 1-min bars for the most recent trading day.
// Falls back to the previous calendar day if today has no data (weekend/holiday/plan limit).
app.get('/api/chart/:ticker', async (req, res) => {
  const { ticker } = req.params;

  function tradingDate(offsetDays = 0) {
    const d = new Date(Date.now() - offsetDays * 86400000);
    return d.toISOString().split('T')[0];
  }

  // Try today, then yesterday, then two days ago (covers Mon after weekend)
  const candidates = [tradingDate(0), tradingDate(1), tradingDate(2), tradingDate(3)];

  for (const date of candidates) {
    try {
      const data = await polyFetch(
        `/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/1/minute/${date}/${date}?adjusted=true&sort=asc&limit=390`
      );
      if ((data.results || []).length > 0) {
        console.log(`[chart/${ticker}] ${data.results.length} bars for ${date}`);
        return res.json(data);
      }
      console.log(`[chart/${ticker}] no bars for ${date}, trying previous day`);
    } catch (e) {
      console.log(`[chart/${ticker}] ${date} failed (${e.message.slice(0, 60)}), trying previous day`);
    }
  }

  // All candidates empty or failed — return empty gracefully
  console.log(`[chart/${ticker}] no intraday data found, returning empty`);
  res.json({ results: [], resultsCount: 0, status: 'OK' });
});

// ── GET /api/batch?tickers=AAPL,MSFT,... ─────────────────────────────────────
// Express auto-decodes req.query.tickers, so commas are literal here.
// Pass them directly to Polygon — no re-encoding needed (and re-encoding
// would produce %2C which Polygon may not split correctly).
app.get('/api/batch', async (req, res) => {
  const { tickers } = req.query;
  if (!tickers) return res.status(400).json({ error: 'tickers query param required' });
  try {
    const tickerList = tickers.split(',').map(t => t.trim()).filter(Boolean);
    const data = await polyFetch(
      `/v2/snapshot/locale/us/markets/stocks/tickers?tickers=${tickerList.join(',')}`
    );
    console.log(`[batch] ${(data.tickers || []).length} of ${tickerList.length} tickers returned`);
    res.json(data);
  } catch (e) {
    console.error('[batch] error:', e.message);
    res.status(502).json({ error: e.message });
  }
});

// ── GET /api/sector-summary ───────────────────────────────────────────────────
app.get('/api/sector-summary', async (req, res) => {
  const SECTOR_TICKERS = 'XLK,XLF,XLE,XLV,XLI';
  try {
    const data = await polyFetch(
      `/v2/snapshot/locale/us/markets/stocks/tickers?tickers=${SECTOR_TICKERS}`
    );
    res.json(data);
  } catch (e) {
    console.error('[sector-summary] error:', e.message);
    res.status(502).json({ error: e.message });
  }
});

// ── GET /api/vix ─────────────────────────────────────────────────────────────
// Polygon Starter plan does not include index data (I:VIX).
// UVXY is a volatility ETF that tracks VIX closely and is available on Starter.
app.get('/api/vix', async (req, res) => {
  try {
    const data  = await polyFetch('/v2/snapshot/locale/us/markets/stocks/tickers/UVXY');
    const snap  = data.ticker || {};
    const price = snap.lastTrade?.p ?? snap.day?.c ?? 0;
    if (price > 0) {
      return res.json({
        ticker:          'UVXY',
        value:           Number(price),
        todaysChangePerc: Number(snap.todaysChangePerc ?? 0),
        todaysChange:    Number(snap.todaysChange     ?? 0),
      });
    }
    res.json({ ticker: 'UVXY', value: 0, todaysChangePerc: 0, todaysChange: 0 });
  } catch (e) {
    console.error('[vix] error:', e.message);
    res.json({ ticker: 'UVXY', value: 0, todaysChangePerc: 0, todaysChange: 0 });
  }
});

// ── GET /api/prevday/:ticker — previous trading day OHLCV ────────────────────
app.get('/api/prevday/:ticker', async (req, res) => {
  const { ticker } = req.params;
  const empty = { open: 0, high: 0, low: 0, close: 0, volume: 0 };
  try {
    const data = await polyFetch(`/v2/aggs/ticker/${encodeURIComponent(ticker)}/prev?adjusted=true`);
    const bar = (data.results || [])[0];
    if (!bar) {
      console.log(`[prevday/${ticker}] no results`);
      return res.json(empty);
    }
    res.json({ open: bar.o, high: bar.h, low: bar.l, close: bar.c, volume: bar.v });
  } catch (e) {
    console.error(`[prevday/${ticker}] error:`, e.message);
    res.json(empty);
  }
});

// ── GET /api/history/:ticker — last 5 trading days of daily OHLCV ────────────
// Uses 10 calendar day window to guarantee ≥5 trading bars across weekends/holidays.
app.get('/api/history/:ticker', async (req, res) => {
  const { ticker } = req.params;
  const today = new Date().toISOString().split('T')[0];
  const from  = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  try {
    const data = await polyFetch(
      `/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/1/day/${from}/${today}?adjusted=true&sort=asc&limit=10`
    );
    const bars = (data.results || []).map(b => ({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }));
    console.log(`[history/${ticker}] ${bars.length} daily bars`);
    res.json(bars);
  } catch (e) {
    console.error(`[history/${ticker}] error:`, e.message);
    res.json([]);
  }
});

// ── GET /api/bars/:ticker — flexible aggs proxy for PriceChart ───────────────
// Query params: multiplier, timespan, from, to, limit
// Used by the multi-period PriceChart component (1D/5D/1M/6M/YTD/1Y)
app.get('/api/bars/:ticker', async (req, res) => {
  const { ticker } = req.params;
  const { multiplier = 1, timespan = 'minute', from, to, limit = 390 } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'from and to query params required' });
  try {
    const data = await polyFetch(
      `/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/${multiplier}/${timespan}/${from}/${to}?adjusted=true&sort=asc&limit=${limit}`
    );
    console.log(`[bars/${ticker}] ${(data.results || []).length} bars (${multiplier}/${timespan} ${from}→${to})`);
    res.json(data);
  } catch (e) {
    console.error(`[bars/${ticker}] error:`, e.message);
    res.status(502).json({ error: e.message });
  }
});

// ── Earnings (last 4 quarters via vX financials) ──────────────────────────────
app.get('/api/earnings/:ticker', async (req, res) => {
  const ticker = req.params.ticker;
  try {
    const data = await polyFetch(
      `/vX/reference/financials?ticker=${encodeURIComponent(ticker)}&timeframe=quarterly&limit=4&sort=period_of_report_date&order=desc`
    );
    const results = (data.results || []).map(r => ({
      period:  r.fiscal_period || '',
      endDate: r.end_date || r.period_of_report_date || '',
      eps:     r.financials?.income_statement?.basic_earnings_per_share?.value ?? null,
      revenue: r.financials?.income_statement?.revenues?.value ?? null,
    }));
    res.json(results);
  } catch (e) {
    console.error('/api/earnings error:', e.message);
    res.json([]);
  }
});

// ── GET /api/historical/:ticker/:date — open-close for a specific date ────────
// date format: YYYY-MM-DD
app.get('/api/historical/:ticker/:date', async (req, res) => {
  const { ticker, date } = req.params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  }
  try {
    const data = await polyFetch(
      `/v1/open-close/${encodeURIComponent(ticker.toUpperCase())}/${date}?adjusted=true`
    );
    res.json({
      date:   data.from   || date,
      open:   data.open   ?? null,
      high:   data.high   ?? null,
      low:    data.low    ?? null,
      close:  data.close  ?? null,
      volume: data.volume ?? null,
    });
  } catch (e) {
    console.error(`/api/historical/${ticker}/${date} error:`, e.message);
    const status = e.message.includes('404') ? 404 : e.message.includes('403') ? 403 : 500;
    res.status(status).json({ error: e.message });
  }
});

// ── Chat ticker detection & real-time data injection ─────────────────────────

const CHAT_STOP_WORDS = new Set([
  // English function words / abbrevs (1-5 chars)
  'A', 'AN', 'THE', 'IS', 'ARE', 'WAS', 'BE', 'DO', 'DID', 'WILL',
  'AND', 'BUT', 'OR', 'NOR', 'FOR', 'SO', 'YET',
  'IN', 'ON', 'AT', 'BY', 'TO', 'OF', 'UP', 'AS',
  'WITH', 'FROM', 'INTO', 'OVER', 'THEN', 'THAN',
  'THAT', 'THIS', 'THESE', 'THOSE', 'WHAT', 'WHEN', 'WHERE', 'WHICH',
  'WHO', 'HOW', 'WHY', 'BOTH', 'EACH', 'SUCH', 'SOME', 'MOST',
  'MORE', 'LESS', 'VERY', 'JUST', 'ONLY', 'ALSO', 'EVEN',
  'HAVE', 'HAS', 'HAD', 'BEEN', 'WERE', 'DOES', 'DONE',
  'THEY', 'THEM', 'THEIR', 'THERE', 'HERE', 'YOUR', 'WOULD', 'COULD', 'SHOULD',
  'GIVE', 'SHOW', 'TELL', 'FIND', 'MAKE', 'TAKE', 'LOOK', 'KNOW',
  'LIKE', 'WANT', 'NEED', 'CALL', 'HOLD', 'SELL', 'STOP', 'WAIT',
  'BACK', 'GOOD', 'WELL', 'DOWN', 'SAME', 'LONG', 'HIGH', 'LAST',
  'NEXT', 'OPEN', 'BEST', 'GIVE', 'RISE', 'FALL', 'BULL', 'BEAR',
  'CASH', 'WEEK', 'YEAR', 'DAYS', 'DATA', 'NEWS', 'LIST', 'TYPE',
  'REAL', 'LIVE', 'FAST', 'SLOW', 'GOES', 'GETS', 'PUTS', 'SETS',
  // Abbreviations that look like tickers but aren't
  'AI', 'ML', 'EV', 'US', 'EU', 'UK', 'UN', 'AM', 'PM',
  'ETF', 'IPO', 'CEO', 'CFO', 'CTO', 'COO', 'EPS',
  'YTD', 'OTC', 'SEC', 'FED', 'GDP', 'CPI', 'PMI', 'RSI',
  'ATH', 'ATL', 'EST', 'EDT', 'ET', 'FX', 'IV', 'OI',
  // Spanish articles / prepositions / pronouns (single and short words)
  'EL', 'LA', 'AL', 'UN', 'SE', 'ME', 'TE', 'LE', 'NO', 'SIN', 'DE', 'EN', 'ES', 'Y', 'O', 'MI', 'TU', 'SU', 'NOS', 'SUS', 'MIS', 'TUS', 'LO', 'OS', 'HA', 'VA', 'HE', 'IR', 'DA', 'DI', 'VE', 'CO', 'CU', 'NI', 'TI', 'EX', 'RE',
  // Spanish function words / verbs (1-5 chars after accent-stripping)
  'QUE', 'CON', 'POR', 'DEL', 'LOS', 'LAS', 'UNA', 'UNO', 'UNOS', 'UNAS',
  'MAS', 'MUY', 'HOY', 'YA', 'SI', 'SU', 'SON', 'SER', 'HAY', 'FUE', 'ERA',
  'ESO', 'ESA', 'ESE', 'ESOS', 'ESAS', 'ESTA', 'ESTE', 'ESTO', 'ESTAS', 'ESTOS',
  'PERO', 'PARA', 'COMO', 'SOBRE', 'TIENE', 'TENER', 'TENGO', 'ESTAR', 'ESTOY', 'PODER',
  'QUIERO', 'MEJOR', 'PEOR', 'CREO', 'PUEDE', 'PUEDO', 'TODOS', 'PORQUE',
  'CADA', 'POCO', 'BIEN', 'SABE', 'SABER', 'HACE', 'TOMA', 'PASA', 'VER',
  'DESDE', 'HACIA', 'ENTRE', 'ANTES', 'NUNCA', 'IGUAL', 'SINO', 'HASTA', 'AUN', 'AUNQUE',
  'TANTO', 'HOLA', 'GRACIAS', 'CLARO', 'BUENO', 'DIME', 'DAME', 'AYER', 'SOLO', 'TIPO', 'VEZ',
  // Spanish words that become false-positive tickers after uppercasing user input
  'ALGO', 'PASO', 'CAYO', 'TODAS', 'ESTAS', 'BAJA', 'SUBE', 'MAL',
  'TODO', 'ELLA', 'PUES', 'HIZO', 'DIJO', 'TUVO', 'ELLAS',
  'NADA', 'SIDO', 'ELLO', 'USAN', 'PIDE', 'GANA', 'MALA', 'MALO',
  'OTRO', 'OTRA', 'OTROS', 'OTRAS', 'AQUEL', 'VENDER', 'INVERTIR', 'COMPRA', 'COMPRAR',
  'OPINA', 'OPINAS', 'RECOMIENDA', 'RECOMIENDAS', 'SUGIERE', 'SUGIERO', 'AHORA', 'MISMO', 'MISMA',
  'SIGUE', 'SIGUES', 'CAYENDO', 'SUBIENDO', 'SOPORTE', 'RESISTENCIA', 'PRECIO', 'NIVEL', 'NIVELES',
  // Spanish preterite verb forms (past tense conjugations)
  'CERRO', 'MOVIO', 'ABRIO', 'SUBIO', 'BAJO',  'ALZO',  'LLEGO',
  'SALIO', 'ENTRO', 'GANO',  'PUSO',  'PUDO',  'VINO',  'SUPO',
  'QUISO', 'TRAJO', 'MIDIO', 'PIDIO', 'MURIO', 'VIVIO',
  // Spanish interrogative words
  'DONDE', 'CUAL', 'QUIEN',
  // Common Spanish phrases that surface as false-positive tickers
  // VALE = "okay/worth" in "vale la pena", PENA = "worth", LENA = misc
  'VALE', 'PENA', 'LENA', 'VALE', 'SERA', 'PARA', 'CARA', 'CARO',
  'DEJA', 'TRAE', 'FIJO', 'VAMOS', 'VENGA', 'MIRA', 'DALE',
  // Extra Spanish / English false-positive splits or words
  'ALG', 'NDE', 'PONGO', 'LOSS', 'ALGUN', 'ALGUNA', 'ALGUNOS', 'ALGUNAS',
]);

function extractTickersFromMessage(text) {
  if (!text) return [];
  // Normalize to uppercase so lowercase ticker mentions ("xela", "nvda") are caught.
  const upper = text.toUpperCase();
  const tickers = [];
  // Match optional $ prefix + 1-5 uppercase letters at word boundaries.
  // Minimum 2 chars for non-$-prefixed words to avoid single-letter false
  // positives like I, A, Y (Spanish "and") being treated as tickers.
  const re = /(?:^|[^A-Z])\$?([A-Z]{1,5})(?=[^A-Z]|$)/g;
  let m;
  while ((m = re.exec(upper)) !== null) {
    const t = m[1];
    const hasDollar = m[0].includes('$');
    const minLen = hasDollar ? 1 : 2; // $C is valid; bare C is too ambiguous
    if (t.length >= minLen && !CHAT_STOP_WORDS.has(t) && !tickers.includes(t)) {
      tickers.push(t);
      if (tickers.length >= 3) break;
    }
  }
  return tickers;
}

function sectorFromRef(r) {
  if (!r) return null;
  const s = (r.sic_description || '').toLowerCase();
  const type = r.type || '';
  if (type === 'ETF' || type === 'ETV') return 'ETF/Fund';
  if (/pharma|biotech|therapeut|genomic|gene|oncol|medic|drug|clinical|trial/.test(s)) return 'Healthcare/Biotech';
  if (/health|hospital|medical device|diagnostic/.test(s)) return 'Healthcare';
  if (/semiconductor|chip|electronic computer|printed circuit/.test(s)) return 'Technology/Semiconductors';
  if (/software|data processing|prepackaged/.test(s)) return 'Technology/Software';
  if (/entertainment|gaming|amusement|casino|game|video game|motion picture/.test(s)) return 'Entertainment/Gaming';
  if (/oil|gas|petroleum|crude|natural gas|coal|uranium/.test(s)) return 'Energy';
  if (/solar|wind|electric services|power/.test(s)) return 'Energy/Utilities';
  if (/gold|silver|mining|metal|copper|lithium/.test(s)) return 'Mining/Metals';
  if (/bank|saving|federal|mortgage|credit union/.test(s)) return 'Finance/Banking';
  if (/insurance/.test(s)) return 'Finance/Insurance';
  if (/investment|security broker|fund/.test(s)) return 'Finance/Investment';
  if (/retail|department store|apparel|grocery|food store/.test(s)) return 'Retail/Consumer';
  if (/restaurant|food preparation|beverage/.test(s)) return 'Consumer/Food';
  if (/cannabis|marijuana|hemp/.test(s)) return 'Cannabis';
  if (/defense|aerospace|guided missile|aircraft|military/.test(s)) return 'Defense/Aerospace';
  if (/real estate|reit|property/.test(s)) return 'Real Estate';
  if (/shipping|freight|transportation|airline|railroad/.test(s)) return 'Transportation';
  if (/construction|building|homebuilding/.test(s)) return 'Construction';
  if (/radio|television|communications|telephone/.test(s)) return 'Telecom';
  return null;
}

async function fetchTickerSnapshot(ticker) {
  try {
    const enc = encodeURIComponent(ticker);
    const safeFetch = (url) => {
      const ctrl = new AbortController();
      const timeoutId = setTimeout(() => ctrl.abort(), 4000);
      return fetch(url, { signal: ctrl.signal })
        .then(r => {
          clearTimeout(timeoutId);
          if (!r.ok) {
            console.warn(`[Polygon safeFetch Fail] URL: ${url.replace(POLYGON_KEY, '***')} | Status: ${r.status} ${r.statusText}`);
            return null;
          }
          return r.json();
        })
        .catch(err => {
          clearTimeout(timeoutId);
          console.warn(`[Polygon safeFetch Error] URL: ${url.replace(POLYGON_KEY, '***')} | Error: ${err.message}`);
          return null;
        });
    };
    const [snapRes, refRes, splitsRes, divsRes, newsRes, v3Res] = await Promise.allSettled([
      safeFetch(`${POLYGON_BASE}/v2/snapshot/locale/us/markets/stocks/tickers/${enc}?apiKey=${POLYGON_KEY}`),
      safeFetch(`${POLYGON_BASE}/v3/reference/tickers/${enc}?apiKey=${POLYGON_KEY}`),
      safeFetch(`${POLYGON_BASE}/v3/reference/splits?ticker=${enc}&limit=5&apiKey=${POLYGON_KEY}`),
      safeFetch(`${POLYGON_BASE}/v3/reference/dividends?ticker=${enc}&limit=5&apiKey=${POLYGON_KEY}`),
      safeFetch(`${POLYGON_BASE}/v2/reference/news?ticker=${enc}&limit=5&apiKey=${POLYGON_KEY}`),
      safeFetch(`${POLYGON_BASE}/v3/snapshot?ticker.any_of=${enc}&apiKey=${POLYGON_KEY}`),
    ]);
    const snap   = (snapRes.status === 'fulfilled' ? snapRes.value : null)?.ticker;
    if (!snap) return null;
    const ref    = (refRes.status    === 'fulfilled' ? refRes.value    : null)?.results;
    const splits = (splitsRes.status === 'fulfilled' ? splitsRes.value : null)?.results ?? [];
    const divs   = (divsRes.status   === 'fulfilled' ? divsRes.value   : null)?.results ?? [];
    const news   = (newsRes.status   === 'fulfilled' ? newsRes.value   : null)?.results ?? [];
    const v3res  = (v3Res.status     === 'fulfilled' ? v3Res.value     : null)?.results?.[0] ?? {};
    const marketStatus = v3res.market_status ?? null;
    const price     = snap.lastTrade?.p ?? snap.day?.c ?? snap.prevDay?.c ?? 0;
    const changePct = snap.todaysChangePerc ?? 0;
    const volume    = snap.day?.v ?? 0;
    const open      = snap.day?.o ?? 0;
    const high      = snap.day?.h ?? 0;
    const low       = snap.day?.l ?? 0;
    const vwap      = snap.day?.vw ?? 0;
    const prevClose = snap.prevDay?.c ?? 0;
    console.log('[TICKER ENRICHMENT]', ticker, JSON.stringify({
      price: Number(price), open: Number(open), high: Number(high), low: Number(low), vwap: Number(vwap),
      splits: splits.map(s => `${s.split_to}-for-${s.split_from}${s.split_to < s.split_from ? ' reverse split' : ''} on ${s.execution_date}`),
      newsCount: news.length,
      description: ref?.description?.substring(0, 50),
    }));
    return {
      ticker,
      price:        Number(price),
      changePct:    Number(changePct),
      volume:       Number(volume),
      open:         Number(open),
      high:         Number(high),
      low:          Number(low),
      vwap:         Number(vwap),
      prevClose:    Number(prevClose),
      marketStatus: marketStatus,
      sector:       sectorFromRef(ref),
      description:  ref?.description ? ref.description.slice(0, 200) : null,
      employees:    ref?.total_employees ?? null,
      listDate:     ref?.list_date ?? null,
      splits:       splits.map(s => `${s.split_to}-for-${s.split_from}${s.split_to < s.split_from ? ' reverse split' : ''} on ${s.execution_date}`),
      divs:         divs.map(d => `$${Number(d.cash_amount).toFixed(4)} ex-date ${d.ex_dividend_date}`),
      news:         news.map(n => `[${(n.published_utc || '').slice(0, 10)}] ${n.title}`),
    };
  } catch {
    return null;
  }
}

function fmtVol(v) {
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return String(v);
}

// ── System rules — owned here so frontend never hits the 36K limit ──────────
function getSystemRules(today, currentYear) {
  return `=== IDENTITY ===
CHATSTOX AI — elite Wall Street trading analyst. Direct, confident, data-driven. Never call yourself an AI.

=== LANGUAGE ===
LANGUAGE DETECTION: Detect the language of the user's current message. If they write in Spanish, respond in Spanish. If they write in English, respond in English. This overrides all other language settings. Spanish indicators: words like "accion", "recomiendas", "hoy", "vale", "mercado", "subir", "comprar", "qué", "cómo", "dame", "háblame", "cuánto", "cuándo", "dónde", "tienes", "está", "están", "eso", "ese".
Respond 100% in the detected language. Zero mixing.

=== KNOWLEDGE ===
TYPE 1 — REAL-TIME (use EXACTLY): price, change%, volume, OHLC, VWAP, today's news, gainers/losers.
TYPE 2 — TRAINING (use confidently): earnings, fundamentals, history, corporate events, analyst ratings, SEC filings.
Never say "no tengo acceso" or "I don't have access" — you DO have TYPE 2 knowledge.

=== EARNINGS ===
Use EARNINGS DATA block as ground truth. Give: report date + quarterly cadence + SEC Edgar link.
State quarters elapsed since ${currentYear} when citing 2024 data. Never refuse — always give something useful.

=== DATES & SPECIFICITY ===
Historical price: "HISTORICAL DATA for [TICKER] on [DATE]:" → use those exact numbers.
"HISTORICAL NOTE: No data available" → explain why (weekend/holiday/not listed), offer Yahoo Finance.
Unspecified year → assume ${currentYear}. Never ask for clarification.
Name specific events with dates and numbers. WHO, WHAT, WHEN. No generic phrases.
Historical questions (crashes, worst days) → answer from training with event + date + % move. Skip live feed.

=== DECIMAL RULE ===
Sub-$1: 4 decimals ($0.0742). $1+: 2 decimals ($1.25, $211.50). All prices in every response.

=== IPO RULE ===
Stock >200% gain + isIPO:true → note % is from IPO price, not prior close. Not normal momentum.

=== STOCK CATEGORIES ===
Large Cap (>$10B): institutional. Mid ($2-10B): moderate risk. Small ($300M-2B): higher volatility.
Micro/Penny (<$300M): high risk/reward. Penny = high % gain + volume spike + catalyst. NOT price alone.
Never recommend AAPL, MSFT, NVDA, AMZN, GOOGL as penny/momentum stocks.

=== TRADING VOCABULARY ===
AH=after-hours 4-8PM ET. PM=pre-market 4-9:30AM ET. RTH=9:30AM-4PM. EOD=4PM close. LOD=day low. HOD=day high.
ATH/ATL=all-time high/low. VWAP=volume-weighted avg price. SL=stop loss. TP=take profit. BO=breakout. BD=breakdown.
R/R=risk-to-reward. RVOL=relative volume (today÷avg). Float=public tradeable shares. SI=short interest. SS=short squeeze.
FOMO=fear of missing out. BTFD=buy the dip. OTM/ITM/ATM=options moneyness. IV=implied vol. OI=open interest. DTE=days to expiration.
Scalp=minutes. Day trade=same session. Swing=2-10 days. Position=weeks-months.
Patterns: C&H=bullish. H&S=bearish reversal. iH&S=bullish reversal. Bull/bear flag=continuation. Double top=bearish. Double bottom=bullish.
RVOL tiers: <0.5x Very Low | 0.5-1.5x Normal | 1.5-3x Above Avg | 3-10x High | >10x Extreme.
AH question → use v3 session data: AH price + delta vs RTH close. Never ask for clarification on any term.

=== CANDLESTICK PATTERNS ===
Use CANDLE ANALYSIS block. State OHLC → name pattern → implication for next price action. Never refuse.

=== S/R FRAMEWORK ===
Use KEY LEVELS block: S1=day low, S2=prev low, R1=day high, VWAP. Never fabricate — use pre-computed values.

=== RESPONSE FORMAT ===

FORMATO OBLIGATORIO — ALL responses: No paragraphs. Short bullets (max 2 lines). Line break between points. End with hook question.

FORMAT 1 — LISTING STOCKS:
TICKER - Company Name | $price | +/-X.XX% | Vol: XM
Sort highest % gain first. Always include ticker AND company name.

FORMAT 2 — INITIAL AUTO-ANALYSIS (first message only, isAutoAnalysis=true or first ticker mention):
NEVER use for follow-up questions.
[TICKER] — [Company Name]
📊 Price: $X.XX | Change: +/-X.XX% | Vol: XM
📈 Open: $X.XX | High: $X.XX | Low: $X.XX | VWAP: $X.XX
💡 Analysis: [2-3 sentences: price action, momentum, trend]
🎯 Key Levels: • Support: $X.XX • Resistance: $X.XX
⚡ Catalyst: [cite [TICKER]-SPECIFIC headline if available; otherwise infer from price/volume/sector]
📌 Opinion: [direct buy/sell/wait with specific reasoning]

FORMAT 3 — TRADE SETUP:
Triggers: "trade setup", "setup completo", "dame el setup", "give me the setup", "setup técnico".
📊 TRADE SETUP — [TICKER]
🟢 Entry: $X.XX | 🛑 Stop: $X.XX (-X%) | 🎯 T1: $X.XX (+X%) | 🎯 T2: $X.XX (+X%)
⚖️ R/R: 1:X.X — Per $1 risked, gain $X.XX
💰 Example: With $1,000 → risk ~$Y at stop, T1 gives ~$Z profit (shares=floor(1000÷entry))
⚠️ BAD R/R: output ONLY if R/R < 1:1.5. Omit if R/R ≥ 1:1.5.
💡 Timeframe: [Intraday / Swing / Position]
📌 Use EXACTLY the numbers from SMART STOP LOSS & TARGETS block. No prose.
Narrow range (high-low <1% of entry): add "⚠️ Very narrow range — consider swing with prior-day levels."

FORMAT 4 — ALL FOLLOW-UPS:
Short bullets only. NO paragraphs. NO repeated price tables. Max 2 lines per bullet.
Answer what was asked. End with one hook question.
Use FORMAT 3 only for FORMAT 3 triggers. Use FORMAT 2 only if user says "análisis completo"/"full analysis."

MESSAGE_TYPE (from data block): AUTO_ANALYSIS or FIRST_MENTION → use FORMAT 2. FOLLOWUP → use FORMAT 4. EXCEPTION: if the user's message explicitly lists multiple numbered questions or asks for a "comprehensive"/"completo" analysis, expand beyond the format template and answer every point fully.

LENGTH RULE: NEVER refuse to write a long analysis. Write as many lines as requested. BANNED phrases: "no puedo proporcionar un análisis tan extenso", "no es posible dar un análisis de X líneas", "I cannot provide such a long analysis", "that would be too long", "es demasiado largo", "un análisis tan detallado excede mis capacidades".

=== PERSONALITY ===
Elite trading desk energy. Direct, confident, zero filler, zero apologies. Real opinions backed by specific numbers. Hook question at end of every response. No repeated disclaimers. Never start with "According to my data" or "Según mis datos."

ENERGY & TONE — match the market action:
• Big move / high RVOL / squeeze forming → excited, punchy, use exclamations: "¡Exacto!", "¡Ese es el nivel clave!", "¡Ahí está el squeeze!", "That's the move!", "¡Míralo!", "Let's go!", "¡Eso es momentum puro!"
• Calm day / consolidation → analytical but still direct, no excitement
• Pullback / risk → serious, precise, no hype
• Setup confirmed → "¡Perfecto!", "That's your entry!", "¡Ahí está!", "Boom — ese es el setup"

CONVERSATIONAL OPENERS (rotate, don't repeat):
ES: "Mira esto...", "Fíjate bien...", "Ojo con esto...", "Escucha...", "Te digo algo...", "Aquí está la clave..."
EN: "Check this out...", "Here's the thing...", "Look at this...", "Pay attention to...", "Real talk..."

TRADER SLANG (weave in naturally, don't force every message):
ES: "el tape", "el float", "el bid", "la oferta", "el spread", "el squeeze", "momentum play", "el nivel clave", "resistencia dura", "soporte fuerte", "volumen explosivo", "a tope de volumen"
EN: "the tape", "float", "the bid", "the spread", "squeeze play", "momentum play", "key level", "hard resistance", "strong support", "explosive volume", "running hot"

Emojis: 🔴 risk, 📊 data, ⚡ catalyst, 🎯 levels, 🧠 opinion. Use sparingly — only in FORMAT 2 headers and for emphasis.

• Never mention "Polygon" or any data provider. Say "live market data" or just state numbers.
• Never recommend OTC/pink sheet stocks (tickers ending in F, W, R, Y; price <$0.05).
• Market closed/weekend: top 5 from gainers (score=volume×changePercent, filter: +5-50%, vol>1M, price>$1). Never refuse.
• Acknowledgment ("gracias", "ok", "got it"): one punchy insight + trader slang + open door. No filler.
• Source links: ONLY when user explicitly asks ("fuentes", "sources"). Never add unsolicited.
• Today is ${today} (${currentYear}). Training through early 2025. Never call 2024 events "recent" or "upcoming."
• Catalyst (⚡): [TICKER]-SPECIFIC news → cite headline. General only → say no specific news found, then infer from price/volume/sector.
• RVOL >3x → always flag. RVOL >10x → "Extreme volume — likely squeeze/pump/news."
• 5-day trend: include when extended data present.
• Risk warnings (auto when conditions met, once per conversation):
  ① Down ≥50% → "⚠️ HIGH RISK: down 50%+ — possible dilution, reverse split, or very negative news."
  ② Volume <50K → "⚠️ Very low volume — wide spread, hard to exit."
  ③ Price <$0.05 → "⚠️ Sub-penny — extreme manipulation risk."
  ④ RVOL >15x → "⚠️ EXTREME volume — possible pump & dump or squeeze."
• Time-to-target: velocity=(price−open)/hoursElapsed. hoursToTarget=(target−price)/velocity. Show arithmetic.
• Options flow: infer from price/volume. End: "unusualwhales.com or marketchameleon.com"
• Ticker detection: user explicitly mentions a different ticker → shift focus immediately.
• Ambiguous question (no ticker) → interpret as CURRENT stock in context. Always name the ticker explicitly in every response, even follow-ups — never say just "it" or "the stock."
• No live data for ticker: state no real-time data, share training knowledge, suggest Yahoo Finance.
• Live market data and gainers/losers ARE injected below. Use them. NEVER say you lack access.
• PRICE FILTER: When a user asks for stocks under a specific price (e.g. "under $10", "below $5", "menos de $10", "baratas", "bajo precio"), ONLY recommend tickers from the gainers list where the price field is actually below that number. Never recommend a stock above the requested price limit, even if it's a top mover. If no gainers meet the price filter, say so and use Google Search to find movers in that price range.
• PRICE TARGET RULE: When asked for a price target, give YOUR OWN technical target based on the nearest resistance level in the data. NEVER say "analyst consensus is unavailable" or "a specific consensus price target isn't available" — that is a cop-out. Use next resistance as T1. If no resistance data, estimate from % above current price based on momentum. Always give a specific dollar figure.
• LANGUAGE SWITCH: If the user's current message is in English → respond in English. If Spanish → respond in Spanish. This overrides conversation history. Short English phrases ("got it", "ok", "thanks", "understood") → detect as English, respond in English.
• BANNED (any language): "no tengo datos en tiempo real para identificar", "no puedo identificar penny stocks", "no cuento con datos específicos", "my current market scan does not identify", "no tengo información actualizada sobre penny stocks", "a specific consensus price target from analysts isn't readily available", "analyst consensus is unavailable", "I don't have a specific analyst price target", "no tengo un precio objetivo específico de analistas", "don't have access to real-time analyst price targets", "specific price target isn't available", "necesito datos de volumen específicos", "no proporciona el volumen exacto". If gainers data is present, USE IT. If not, use Google Search grounding.
• MOVERS FALLBACK: If the TOP GAINERS TODAY section is empty or missing, use Google Search to find today's top gaining stocks. Search for "top stock gainers today" or "penny stocks up today" and provide real tickers with current prices and % gains. Format results as FORMAT 1. NEVER say no data is available — always find real movers via search. IMPORTANT: Only search US stock market (NYSE, NASDAQ, OTC). Never return European, Asian, or international exchange stocks. Always specify "US stocks" in any search query.
• DATA ACCURACY: When listing stocks with prices, ONLY include stocks where you have an exact price from the REAL-TIME DATA block or a verified Google Search result with a specific number. NEVER show '$X.XX' or '+X%' placeholders — if you don't have the exact price, skip that stock and show the next one that has complete data. It's better to show 5 accurate stocks than 10 with missing data.`;
}

// ── Gemini retry helper ───────────────────────────────────────────────────────
const RETRY_DELAYS = [1000, 2000, 3000];

function isRetryable(e) {
  const msg = e?.message || '';
  return msg.includes('503') || msg.includes('overloaded') || msg.includes('Service Unavailable') || e?.status === 503;
}

async function withRetry(fn, label = '') {
  for (let i = 0; i <= RETRY_DELAYS.length; i++) {
    try {
      return await fn();
    } catch (e) {
      if (isRetryable(e) && i < RETRY_DELAYS.length) {
        console.warn(`[/api/chat] ${label} 503, retry ${i + 1}/${RETRY_DELAYS.length} in ${RETRY_DELAYS[i]}ms`);
        await new Promise(r => setTimeout(r, RETRY_DELAYS[i]));
      } else {
        throw e;
      }
    }
  }
}

// ── POST /api/chat — Gemini proxy (keeps API key server-side, fixes CORS) ───────
// Accepts OpenAI-style message arrays from the frontend.
// Extracts the system message as systemInstruction, maps the rest to Gemini format.
// Returns OpenAI-compatible JSON so the frontend needs no changes.
// Supports streaming SSE: relays Gemini chunks as OpenAI-style delta events.
app.post('/api/chat', async (req, res) => {
  if (!vertexAIClient && !genAI) {
    return res.status(500).json({ error: 'Neither Vertex AI nor GEMINI_API_KEY are configured on server' });
  }

  const { queryHistoricalDataFromBigQuery } = require('./gcpServices');

  const { messages, temperature = 0.2, max_tokens = 1800, stream = false, currentTicker, language = 'en', profileContext = '' } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array is required' });
  }

  // Split data-only system message from conversation turns
  const systemMsg  = messages.find(m => m.role === 'system');
  const nonSystem  = messages.filter(m => m.role !== 'system');
  const lastMsg    = nonSystem[nonSystem.length - 1];
  const history    = nonSystem.slice(0, -1).map(m => ({
    role:  m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  // Gemini requires conversation history to start with a 'user' turn
  while (history.length > 0 && history[0].role === 'model') {
    history.shift();
  }

  // Build full system instruction: rules (backend) + lang header + profile + data blocks (frontend)
  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const currentYear = new Date().getFullYear();
  const langName = language === 'es' ? 'Spanish (español)' : 'English';
  const langHeader = `CRITICAL: Respond in ${langName} only. Every response must be in ${langName}.\n\n`;
  const profileLine = profileContext ? `\nUSER PROFILE: ${profileContext}\n` : '';
  const dataBlocks = systemMsg?.content || '';
  const gainersHeader = !currentTicker
    ? '\n\nTOP MOVERS RIGHT NOW (use these for recommendations):\nWhen asked for stock recommendations, day trade picks, or what\'s moving — ALWAYS use these tickers. Never say you don\'t have this data.\n'
    : '';
  const fullSystemInstruction = langHeader + getSystemRules(today, currentYear) + profileLine + gainersHeader + '\n\n' + dataBlocks;

  console.log(`[/api/chat] Gemini | turns=${nonSystem.length} rules=${getSystemRules(today,currentYear).length}chars data=${dataBlocks.length}chars total=${fullSystemInstruction.length}chars stream=${stream}`);

  // Auto-inject real-time Polygon data — always enrich currentTicker first, then any tickers from the message.
  // In general chat (no currentTicker) always include SPY and QQQ as market proxies so the AI knows
  // whether the market is up/down/closed and can answer market-wide questions accurately.
  const msgTickers = extractTickersFromMessage(lastMsg.content);
  console.log(`[/api/chat] User Message: "${lastMsg.content}" | Extracted Tickers: ${JSON.stringify(msgTickers)}`);
  // If user explicitly mentions a ticker different from the loaded stock, enrich it first
  const msgPrimary = msgTickers.length > 0 ? msgTickers[0] : null;
  // In Market Chat (no locked currentTicker) the user frequently refers to a stock
  // discussed earlier in an implicit way ("¿en cuánto está ahora mismo?", "vale la pena?").
  // If the current message has no explicit ticker, resolve the most recently mentioned
  // ticker from conversation history (scanning USER turns only to avoid false-positives
  // from assistant filler words like "Here's the thing" matching ticker 'HERE')
  // so we still enrich live data and don't refuse.
  let contextTicker = null;
  if (!currentTicker && msgTickers.length === 0) {
    for (let i = nonSystem.length - 2; i >= 0; i--) {
      if (nonSystem[i].role !== 'user') continue;
      const found = extractTickersFromMessage(nonSystem[i].content || '');
      const candidate = found.find(t => t !== 'SPY' && t !== 'QQQ');
      if (candidate) { contextTicker = candidate; break; }
    }
    if (contextTicker) console.log(`[/api/chat] Resolved context ticker from history: ${contextTicker}`);
  }
  const mentionedTickers = currentTicker
    ? (msgPrimary && msgPrimary !== currentTicker
        ? [msgPrimary, currentTicker, ...msgTickers.slice(1).filter(t => t !== currentTicker)].slice(0, 3)
        : [currentTicker, ...msgTickers.filter(t => t !== currentTicker)].slice(0, 3))
    : contextTicker
      ? [contextTicker, ...msgTickers.filter(t => t !== 'SPY' && t !== 'QQQ' && t !== contextTicker)].slice(0, 3)
      : ['SPY', 'QQQ', ...msgTickers.filter(t => t !== 'SPY' && t !== 'QQQ')].slice(0, 4);
  console.log(`[/api/chat] Consolidated Tickers for Enrichment: ${JSON.stringify(mentionedTickers)}`);
  let realtimeBlock = '';
  let noDataBlock = '';
  if (mentionedTickers.length > 0) {
    const results = await Promise.allSettled(
      mentionedTickers.map(t => withCache(`enriched_snapshot:${t.toUpperCase()}`, 15, () => fetchTickerSnapshot(t)))
    );
    const lines = [];
    const noDataLines = [];
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const ticker = mentionedTickers[i];
      if (r.status === 'fulfilled' && r.value) {
        const { ticker: t, price, changePct, volume, open, high, low, vwap, prevClose, marketStatus, sector, description, employees, listDate, splits, divs, news } = r.value;
        const sign = changePct >= 0 ? '+' : '';
        const fmt  = (v) => v < 1 ? v.toFixed(4) : v.toFixed(2);
        const block = [];
        block.push(`REAL-TIME DATA for ${t}:`);
        if (marketStatus) block.push(`Market status: ${marketStatus}`);
        let priceLine = `Price: $${fmt(price)}, ${sign}${changePct.toFixed(2)}%, Vol: ${fmtVol(volume)}`;
        if (sector) priceLine += `, Sector: ${sector}`;
        block.push(priceLine);
        // Intraday OHLC
        const ohlcParts = [];
        if (open)      ohlcParts.push(`Open: $${fmt(open)}`);
        if (high)      ohlcParts.push(`High: $${fmt(high)}`);
        if (low)       ohlcParts.push(`Low: $${fmt(low)}`);
        if (vwap)      ohlcParts.push(`VWAP: $${fmt(vwap)}`);
        if (prevClose) ohlcParts.push(`Prev Close: $${fmt(prevClose)}`);
        if (ohlcParts.length) block.push(`OHLC: ${ohlcParts.join(' | ')}`);
        // Pre-computed KEY LEVELS for S/R framework
        if (high && low && vwap) {
          const priceVsVwap = price >= vwap ? 'ABOVE VWAP (bullish bias)' : 'BELOW VWAP (bearish bias)';
          block.push(`KEY LEVELS: S1=$${fmt(low)} S2=${prevClose ? '$' + fmt(prevClose) : 'N/A'} R1=$${fmt(high)} VWAP=$${fmt(vwap)} ${priceVsVwap}`);
        }
        // Pre-computed SMART STOP LOSS & TARGETS for trade setup
        if (price > 0 && low > 0) {
          const entry  = price;
          const stop   = low > entry * 0.95 ? low : entry * 0.95;
          const risk   = entry - stop;
          const t1     = entry + risk * 1.5;
          const t2     = entry + risk * 2.5;
          const rr     = (risk > 0 ? (t1 - entry) / risk : 0).toFixed(1);
          block.push(`SMART STOP LOSS & TARGETS: Entry=$${fmt(entry)} Stop=$${fmt(stop)} T1=$${fmt(t1)} T2=$${fmt(t2)} R/R=1:${rr} DayLow=$${fmt(low)} DayHigh=$${fmt(high)}`);
        }

        // Ingest advanced metrics from BigQuery
        try {
          const bqMetrics = await queryHistoricalDataFromBigQuery(t);
          if (bqMetrics && bqMetrics.avgDailyVolatility != null) {
            block.push(`ADVANCED ANALYTICS (from BigQuery): Avg Volatility: ${bqMetrics.avgDailyVolatility}%, Relative Vol (RVOL): ${bqMetrics.relativeVolumeRatio}x, Option Put/Call Ratio: ${bqMetrics.optionsPutCallRatio}, Sector Momentum Anomaly: ${bqMetrics.sectorMomentumAnomaly} (${bqMetrics.dataSource})`);
          }
        } catch (bqErr) {
          console.warn('[BigQuery Enrichment Error]', bqErr.message);
        }

        if (description) block.push(`Description: ${description}`);
        const meta = [];
        if (employees) meta.push(`Employees: ${Number(employees).toLocaleString()}`);
        if (listDate)  meta.push(`Listed: ${listDate}`);
        if (meta.length) block.push(meta.join(' | '));
        block.push(`Splits: ${splits.length ? splits.join('; ') : 'None on record'}`);
        block.push(`Dividends: ${divs.length ? divs.join('; ') : 'None recent'}`);
        if (news.length) {
          block.push(`News (last ${news.length}):`);
          news.forEach(n => block.push(`- ${n}`));
        }
        lines.push(block.join('\n'));
      } else {
        noDataLines.push(`NOTICE: Live market data feed returned no real-time price snapshot for ${ticker} at this moment. (The stock might be inactive, halted, delisted, or this is a temporary API rate limit fallback).`);
        console.log(`[/api/chat] no-data for ${ticker}`);
      }
    }
    if (lines.length > 0) {
      realtimeBlock = `\n${lines.join('\n\n')}\n`;
      console.log(`[/api/chat] injected context for: ${mentionedTickers.filter((_, i) => results[i].status === 'fulfilled' && results[i].value).join(', ')}`);
    }
    if (noDataLines.length > 0) {
      noDataBlock = `\nNO-DATA NOTICE:\n${noDataLines.join('\n')}\n`;
    }
  }

  // Lock the AI to currentTicker so Google Search grounding cannot override context.
  // Injected last so it overrides any conflicting web results.
  const currentStockLock = currentTicker
    ? `\n\n=== CURRENT STOCK LOCK ===\nCURRENT STOCK: ${currentTicker}\nYou are LOCKED to ${currentTicker} for this entire conversation. Google Search results or web data that mention other tickers MUST be ignored unless the user explicitly types a different ticker symbol in ALL CAPS as a standalone word (e.g. "AAPL" or "$AAPL"). The following phrases ALWAYS refer to ${currentTicker} — never to any other company regardless of what web search returns: "vale la pena", "is it worth it", "should I buy", "what do you think", "cuánto", "y ese", "and that one", "qué tal", "merece la pena", or any ambiguous question with no explicit new ticker. VIOLATION: analyzing any stock other than ${currentTicker} when no explicit ticker switch was made is a critical error.`
    : '';

  // For general chat (no specific stock), add an explicit no-hallucination rule
  // so the AI doesn't invent prices for tickers not in the real-time data block.
  const noPriceRule = !currentTicker
    ? '\n\nCRITICAL PRICE RULE: NEVER invent, estimate, or recall prices for specific stocks from training data. Only state prices that appear verbatim in the REAL-TIME DATA block above. If a stock\'s price is not in the real-time data, say exactly: "I don\'t have live data for that ticker right now — search for it in Stock Chat for a full analysis." Do not guess.'
    : '';

  // When the user asks a follow-up about a stock discussed earlier (resolved from
  // conversation history) and the live feed momentarily returned no snapshot
  // (e.g. a transient API rate limit), allow restating the most recent price ALREADY
  // quoted in THIS conversation instead of a hard refusal — but flag it as the last
  // known quote rather than a fresh tick. This price exists in the chat history, so it
  // is not a hallucination from training data.
  const followUpFallbackRule = (!currentTicker && contextTicker && !realtimeBlock.includes(`REAL-TIME DATA for ${contextTicker}`))
    ? `\n\nFOLLOW-UP CONTEXT: The user is asking about ${contextTicker}, which was already analyzed earlier in this conversation. The live feed did not return a fresh snapshot just now (likely a transient rate limit). DO NOT refuse. Instead, restate the most recent ${contextTicker} price you already provided earlier in this same conversation, and note it is the last known quote which may be slightly delayed. Suggest opening ${contextTicker} in Stock Chat for a live refresh.`
    : '';

  // Merge: rules + profile + frontend data blocks + real-time Polygon enrichment + lock
  const systemInstruction = fullSystemInstruction + realtimeBlock + noDataBlock + noPriceRule + followUpFallbackRule + currentStockLock;

  console.log('[INJECTED CONTEXT]', realtimeBlock?.substring(0, 200));

  const contents = [
    ...history,
    { role: 'user', parts: [{ text: lastMsg.content }] },
  ];

  const MODEL_VERTEX = process.env.VERTEX_MODEL || 'gemini-1.5-flash'; // Vertex AI model (IAM, no quota cap)
  const MODEL_STUDIO = process.env.STUDIO_MODEL || 'gemini-1.5-flash';     // AI Studio fallback model

  // Build a generation config shared across SDK calls.
  const genConfig = {
    maxOutputTokens: Math.max(Number(max_tokens) || 2400, 2400),
    temperature,
    ...(systemInstruction ? { systemInstruction } : {}),
    tools: [{ googleSearch: {} }],
  };

  if (stream) {
    // 1. Try Vertex AI first (native GCP IAM credentials, unlimited quota)
    if (vertexAIClient) {
      try {
        console.log(`[/api/chat] [Vertex AI] Streaming via native GCP ${VERTEX_LOCATION} using ${MODEL_VERTEX}...`);
        const responseStream = await withRetry(() => vertexAIClient.models.generateContentStream({
          model: MODEL_VERTEX,
          contents,
          config: genConfig,
        }), 'vertex-stream');

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        for await (const chunk of responseStream) {
          const token = chunk.text;
          if (token) {
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: token } }] })}\n\n`);
          }
        }
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      } catch (vStreamErr) {
        console.error('[/api/chat] [Vertex AI] Streaming failed, trying AI Studio fallback:', vStreamErr.message);
      }
    }

    // 2. Fallback to Google AI Studio stream
    if (!studioGenAI) {
      return res.status(500).json({ error: 'AI Studio and Vertex AI are both unavailable.' });
    }

    try {
      console.log(`[/api/chat] [AI Studio] Streaming fallback via Google AI Studio using ${MODEL_STUDIO}...`);
      const result = await withRetry(() => studioGenAI.models.generateContentStream({
        model: MODEL_STUDIO,
        contents,
        config: genConfig,
      }), 'studio-stream');

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();

      for await (const chunk of result) {
        const token = chunk.text;
        if (token) {
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: token } }] })}\n\n`);
        }
      }
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    } catch (e) {
      console.error('[/api/chat] [AI Studio] Streaming fallback failed:', e.message);
      if (!res.headersSent) res.status(502).json({ error: e.message });
      res.end();
      return;
    }
  }

  // Non-stream execution
  try {
    let text = '';
    let responseSucceeded = false;

    // 1. Try Vertex AI first
    if (vertexAIClient) {
      try {
        console.log(`[/api/chat] [Vertex AI] Generating content (non-stream) using ${MODEL_VERTEX}...`);
        const vResult = await withRetry(() => vertexAIClient.models.generateContent({
          model: MODEL_VERTEX,
          contents,
          config: genConfig,
        }), 'vertex-non-stream');

        text = (vResult && vResult.text) || '';
        if (text) {
          responseSucceeded = true;
          console.log(`[/api/chat] ✓ Vertex AI generated ${text.length} chars`);
        }
      } catch (vCallErr) {
        console.error('[/api/chat] [Vertex AI] Non-stream failed, trying AI Studio fallback:', vCallErr.message);
      }
    }

    // 2. Fallback to Google AI Studio if Vertex failed or was not initialized
    if (!responseSucceeded) {
      if (!studioGenAI) {
        throw new Error('Both Vertex AI and Google AI Studio are unavailable or failed.');
      }
      console.log(`[/api/chat] [AI Studio] Falling back to Google AI Studio (non-stream) using ${MODEL_STUDIO}...`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 110000);
      const result = await withRetry(() => Promise.race([
        studioGenAI.models.generateContent({ model: MODEL_STUDIO, contents, config: genConfig }),
        new Promise((_, reject) =>
          controller.signal.addEventListener('abort', () => reject(new Error('Gemini timeout after 110s')))
        ),
      ]), 'non-stream');
      clearTimeout(timeoutId);

      text = result.text || '';
      // Retry up to 3x on empty response
      for (let attempt = 1; !text && attempt <= 3; attempt++) {
        const delay = attempt * 1500;
        console.warn(`[/api/chat] Empty response from Gemini, retry ${attempt}/3 in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
        const retryResult = await studioGenAI.models.generateContent({ model: MODEL_STUDIO, contents, config: genConfig }).catch(() => null);
        if (retryResult) text = retryResult.text || '';
      }
      console.log(`[/api/chat] ✓ AI Studio generated ${text.length} chars`);
    }

    res.json({ choices: [{ message: { content: text } }] });
  } catch (e) {
    console.error('[/api/chat] Gemini error:', e.message);
    res.status(502).json({ error: e.message });
  }
});



// ── Auth OTP endpoints ────────────────────────────────────────────────────────
// In dev mode, codes are logged to console. In production, use email provider.
const otpStore = new Map(); // email → { code, expires }

app.post('/api/auth/send-otp', (req, res) => {
  const { email } = req.body || {};
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Valid email required' });
  }
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expires = Date.now() + 10 * 60 * 1000; // 10 min
  otpStore.set(email.toLowerCase(), { code, expires });

  // DEV: log code to console
  console.log(`\n[AUTH] OTP for ${email}: ${code} (expires in 10 min)\n`);

  res.json({ success: true, message: 'Code sent' });
});

app.post('/api/auth/verify-otp', (req, res) => {
  const { email, code } = req.body || {};
  if (!email || !code) return res.status(400).json({ error: 'email and code required' });

  const record = otpStore.get(email.toLowerCase());
  if (!record) return res.status(400).json({ error: 'No code found for this email' });
  if (Date.now() > record.expires) {
    otpStore.delete(email.toLowerCase());
    return res.status(400).json({ error: 'Code expired' });
  }
  if (record.code !== String(code)) {
    return res.status(400).json({ error: 'Invalid code' });
  }

  otpStore.delete(email.toLowerCase());
  res.json({ success: true, verified: true });
});

// ── POST /api/agent/chat — Google Managed Agents API Gateway ──────────────────
const { AGENT_CONFIG } = require('./agentConfig');

app.post('/api/agent/chat', async (req, res) => {
  const { messages, currentTicker, language = 'en' } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array is required' });
  }

  const lastMsg = messages[messages.length - 1];
  console.log(`[Managed Agents API] Delegating query to Google ADK Supervisor: "${lastMsg.content.slice(0, 50)}..."`);

  // Simple, elegant mocking/stub routing for when GOOGLE_CLOUD_PROJECT is not in cloud GKE
  const isCloudGcp = !!process.env.GOOGLE_CLOUD_PROJECT;
  if (!isCloudGcp) {
    console.log('[Managed Agents API] Local sandbox stub: routing directly to default Gemini engine');
    // Fall back seamlessly to local genAI client
    return res.redirect(307, '/api/chat');
  }

  // Under cloud GKE environment, this would call the actual Google Cloud Managed Agents REST API:
  try {
    const url = `https://${AGENT_CONFIG.platform.location}-aiplatform.googleapis.com/v1beta1/projects/${AGENT_CONFIG.platform.projectId}/locations/${AGENT_CONFIG.platform.location}/agents/supervisor:chat`;
    
    // Call the actual Google Cloud Agent endpoint
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GCP_ACCESS_TOKEN || ''}`
      },
      body: JSON.stringify({
        query: lastMsg.content,
        languageCode: language,
        parameters: { currentTicker }
      })
    });

    if (!response.ok) {
      throw new Error(`Google Managed Agent API error: ${response.status}`);
    }

    const result = await response.json();
    return res.json(result);
  } catch (err) {
    console.error('[Managed Agents API] Failed to invoke Google Agent:', err.message);
    res.status(502).json({ error: err.message });
  }
});

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`CHATSTOX backend running on port ${PORT}`);
});
