'use strict';

const express = require('express');
const cors    = require('cors');

const app  = express();
const PORT = process.env.PORT || 8080;

const POLYGON_KEY  = process.env.POLYGON_API_KEY || 'YsPT9O6G9E5p52c3QRj7ddHTZjgBSFUM';
const POLYGON_BASE = 'https://api.polygon.io';

const { GoogleGenerativeAI } = require('@google/generative-ai');
const GEMINI_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_KEY) console.error('[server] GEMINI_API_KEY env var is not set — /api/chat will return 500');
const genAI = GEMINI_KEY ? new GoogleGenerativeAI(GEMINI_KEY, { apiVersion: 'v1' }) : null;

// ── CORS ──────────────────────────────────────────────────────────────────────
app.use(cors({
  origin: [
    'http://localhost:8081',
    'http://localhost:19006',
    'http://localhost:19000',
    'http://127.0.0.1:8081',
    'http://127.0.0.1:19006',
    'https://chatstox.com',
    'https://www.chatstox.com',
  ],
  methods: ['GET', 'POST'],
  credentials: true,
}));
app.use(express.json());

app.use((req, res, next) => {
  res.setTimeout(120000);
  next();
});

// ── Fetch helper ──────────────────────────────────────────────────────────────
async function polyFetch(path) {
  const sep = path.includes('?') ? '&' : '?';
  const url = `${POLYGON_BASE}${path}${sep}apiKey=${POLYGON_KEY}`;
  console.log(`[proxy] → ${url.replace(POLYGON_KEY, '***')}`);

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Polygon ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

// ── GET /api/gainers ──────────────────────────────────────────────────────────
app.get('/api/gainers', async (req, res) => {
  try {
    const data = await polyFetch('/v2/snapshot/locale/us/markets/stocks/gainers?include_otc=true');
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
    const data = await polyFetch('/v2/snapshot/locale/us/markets/stocks/losers?include_otc=true');
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

    res.json({ ticker: snap });
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
  'THEY', 'THEM', 'THEIR', 'THERE', 'YOUR', 'WOULD', 'COULD', 'SHOULD',
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
  'EL', 'LA', 'AL', 'UN', 'SE', 'ME', 'TE', 'LE', 'NO', 'SIN',
  // Spanish function words / verbs (1-5 chars after accent-stripping)
  'QUE', 'CON', 'POR', 'DEL', 'LOS', 'LAS', 'UNA', 'UNO',
  'MAS', 'MUY', 'HOY', 'YA', 'SI', 'SU', 'SON', 'SER', 'HAY',
  'ESO', 'ESA', 'ESE', 'ESOS', 'ESAS', 'ESTA', 'ESTE', 'ESTO',
  'PERO', 'PARA', 'COMO', 'SOBRE', 'TIENE', 'TENER', 'ESTAR', 'PODER',
  'QUIERO', 'MEJOR', 'CREO', 'PUEDE', 'TODOS', 'PORQUE',
  'CADA', 'POCO', 'BIEN', 'SABE', 'HACE', 'TOMA', 'PASA',
  'DESDE', 'HACIA', 'ENTRE', 'ANTES', 'NUNCA', 'IGUAL',
  'TANTO', 'HOLA', 'GRACIAS', 'CLARO', 'BUENO',
  // Spanish words that become false-positive tickers after uppercasing user input
  'ALGO', 'PASO', 'CAYO', 'TODAS', 'ESTAS', 'BAJA', 'SUBE',
  'TODO', 'ELLA', 'PUES', 'HIZO', 'DIJO', 'TUVO', 'ELLAS',
  'NADA', 'SIDO', 'ELLO', 'USAN', 'PIDE', 'GANA', 'MALA', 'MALO',
  // Spanish preterite verb forms (past tense conjugations)
  'CERRO', 'MOVIO', 'ABRIO', 'SUBIO', 'BAJO',  'ALZO',  'LLEGO',
  'SALIO', 'ENTRO', 'GANO',  'PUSO',  'PUDO',  'VINO',  'SUPO',
  'QUISO', 'TRAJO', 'MIDIO', 'PIDIO', 'MURIO', 'VIVIO',
  // Spanish interrogative words
  'DONDE', 'CUAL', 'QUIEN',
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
      setTimeout(() => ctrl.abort(), 4000);
      return fetch(url, { signal: ctrl.signal })
        .then(r => r.ok ? r.json() : null)
        .catch(() => null);
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
Detect user language. Respond 100% in that language. Zero mixing.
Spanish → all Spanish. English → all English.

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

MESSAGE_TYPE (from data block): AUTO_ANALYSIS or FIRST_MENTION → use FORMAT 2. FOLLOWUP → use FORMAT 4.

LENGTH RULE: NEVER refuse to write a long analysis. Write as many lines as requested. BANNED phrases: "no puedo proporcionar un análisis tan extenso", "no es posible dar un análisis de X líneas", "I cannot provide such a long analysis", "that would be too long", "es demasiado largo", "un análisis tan detallado excede mis capacidades".

=== PERSONALITY ===
Direct. Confident. No filler. No apologies. Real opinions with specific numbers. Hook question at end. No repeated disclaimers. Emojis: 🔴 risk, 📊 data, ⚡ catalyst, 🎯 levels, 🧠 opinion. Never start with "According to my data" or "Según mis datos."

• Never mention "Polygon" or any data provider. Say "live market data" or just state numbers.
• Never recommend OTC/pink sheet stocks (tickers ending in F, W, R, Y; price <$0.05).
• Market closed/weekend: top 5 from gainers (score=volume×changePercent, filter: +5-50%, vol>1M, price>$1). Never refuse.
• Acknowledgment ("gracias", "ok", "got it"): one word + one specific actionable insight + open door.
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
• Ambiguous question (no ticker) → interpret as CURRENT stock in context.
• No live data for ticker: state no real-time data, share training knowledge, suggest Yahoo Finance.
• Live market data and gainers/losers ARE injected below. Use them. Never say you lack access.`;
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
  if (!genAI) {
    return res.status(500).json({ error: 'GEMINI_API_KEY not configured on server' });
  }

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
  // If user explicitly mentions a ticker different from the loaded stock, enrich it first
  const msgPrimary = msgTickers.length > 0 ? msgTickers[0] : null;
  const mentionedTickers = currentTicker
    ? (msgPrimary && msgPrimary !== currentTicker
        ? [msgPrimary, currentTicker, ...msgTickers.slice(1).filter(t => t !== currentTicker)].slice(0, 3)
        : [currentTicker, ...msgTickers.filter(t => t !== currentTicker)].slice(0, 3))
    : ['SPY', 'QQQ', ...msgTickers.filter(t => t !== 'SPY' && t !== 'QQQ')].slice(0, 4);
  let realtimeBlock = '';
  let noDataBlock = '';
  if (mentionedTickers.length > 0) {
    const results = await Promise.allSettled(mentionedTickers.map(fetchTickerSnapshot));
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
        noDataLines.push(`No hay datos de Polygon para ${ticker} en este momento. Indica al usuario que no puedes confirmar precio o datos en tiempo real para ese ticker específico, y sugiere verificar en su plataforma de trading.`);
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

  // For general chat (no specific stock), add an explicit no-hallucination rule
  // so the AI doesn't invent prices for tickers not in the real-time data block.
  const noPriceRule = !currentTicker
    ? '\n\nCRITICAL PRICE RULE: NEVER invent, estimate, or recall prices for specific stocks from training data. Only state prices that appear verbatim in the REAL-TIME DATA block above. If a stock\'s price is not in the real-time data, say exactly: "I don\'t have live data for that ticker right now — search for it in Stock Chat for a full analysis." Do not guess.'
    : '';

  // Merge: rules + profile + frontend data blocks + real-time Polygon enrichment
  const systemInstruction = fullSystemInstruction + realtimeBlock + noDataBlock + noPriceRule;

  console.log('[INJECTED CONTEXT]', realtimeBlock?.substring(0, 200));

  try {
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: { maxOutputTokens: Math.max(Number(max_tokens) || 2400, 2400), temperature },
    });

    const contents = [
      ...history,
      { role: 'user', parts: [{ text: lastMsg.content }] },
    ];

    const callConfig = {
      contents,
      tools: [{ googleSearch: {} }],
      ...(systemInstruction ? { systemInstruction } : {}),
    };

    if (stream) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 110000);

      try {
        // Delay header flush until we have a successful stream — allows retry on 503
        const result = await withRetry(() => model.generateContentStream(callConfig), 'stream');

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        for await (const chunk of result.stream) {
          if (controller.signal.aborted) break;
          const token = chunk.text();
          if (token) {
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: token } }] })}\n\n`);
          }
        }
        res.write('data: [DONE]\n\n');
      } catch (e) {
        console.error('[/api/chat] Gemini stream error:', e.message);
        if (!res.headersSent) res.status(502).json({ error: e.message });
      } finally {
        clearTimeout(timeoutId);
        res.end();
      }
      return;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 110000);
    const result = await withRetry(() => Promise.race([
      model.generateContent(callConfig),
      new Promise((_, reject) =>
        controller.signal.addEventListener('abort', () => reject(new Error('Gemini timeout after 55s')))
      ),
    ]), 'non-stream');
    clearTimeout(timeoutId);
    const text = result.response.text();
    console.log(`[/api/chat] ✓ Gemini ${text.length} chars`);
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

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`CHATSTOX backend running on port ${PORT}`);
});
