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
    console.log('[TICKER ENRICHMENT]', ticker, JSON.stringify({
      price: Number(price),
      splits: splits.map(s => `${s.split_to}-for-${s.split_from}${s.split_to < s.split_from ? ' reverse split' : ''} on ${s.execution_date}`),
      newsCount: news.length,
      description: ref?.description?.substring(0, 50),
    }));
    return {
      ticker,
      price:        Number(price),
      changePct:    Number(changePct),
      volume:       Number(volume),
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

// ── POST /api/chat — Gemini proxy (keeps API key server-side, fixes CORS) ───────
// Accepts OpenAI-style message arrays from the frontend.
// Extracts the system message as systemInstruction, maps the rest to Gemini format.
// Returns OpenAI-compatible JSON so the frontend needs no changes.
// Supports streaming SSE: relays Gemini chunks as OpenAI-style delta events.
app.post('/api/chat', async (req, res) => {
  if (!genAI) {
    return res.status(500).json({ error: 'GEMINI_API_KEY not configured on server' });
  }

  const { messages, temperature = 0.2, max_tokens = 1800, stream = false, currentTicker } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array is required' });
  }

  // Split system message (systemInstruction) from the conversation turns
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

  const systemLen = systemMsg?.content?.length ?? 0;
  console.log(`[/api/chat] Gemini flash | turns=${nonSystem.length} system=${systemLen}chars stream=${stream}`);

  // Auto-inject real-time Polygon data — always enrich currentTicker first, then any tickers from the message.
  // In general chat (no currentTicker) always include SPY and QQQ as market proxies so the AI knows
  // whether the market is up/down/closed and can answer market-wide questions accurately.
  const msgTickers = extractTickersFromMessage(lastMsg.content);
  const mentionedTickers = currentTicker
    ? [currentTicker, ...msgTickers.filter(t => t !== currentTicker)].slice(0, 3)
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
        const { ticker: t, price, changePct, volume, marketStatus, sector, description, employees, listDate, splits, divs, news } = r.value;
        const sign = changePct >= 0 ? '+' : '';
        const block = [];
        block.push(`REAL-TIME DATA for ${t}:`);
        if (marketStatus) block.push(`Market status: ${marketStatus}`);
        let priceLine = `Price: $${price.toFixed(price < 1 ? 4 : 2)}, ${sign}${changePct.toFixed(2)}%, Vol: ${fmtVol(volume)}`;
        if (sector) priceLine += `, Sector: ${sector}`;
        block.push(priceLine);
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

  const systemInstruction = (realtimeBlock || noDataBlock)
    ? (systemMsg ? systemMsg.content + realtimeBlock + noDataBlock : (realtimeBlock + noDataBlock).trim())
    : systemMsg?.content;

  console.log('[INJECTED CONTEXT]', realtimeBlock?.substring(0, 200));

  try {
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      ...(systemInstruction ? { systemInstruction } : {}),
      generationConfig: { maxOutputTokens: Math.max(Number(max_tokens) || 2400, 2400), temperature },
    });

    const chat = model.startChat({ history });

    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 110000);

      try {
        const result = await chat.sendMessageStream(lastMsg.content);
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
      } finally {
        clearTimeout(timeoutId);
        res.end();
      }
      return;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 110000);
    const result = await Promise.race([
      chat.sendMessage(lastMsg.content),
      new Promise((_, reject) =>
        controller.signal.addEventListener('abort', () => reject(new Error('Gemini timeout after 55s')))
      ),
    ]);
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
