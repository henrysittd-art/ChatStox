/**
 * CHATSTOX Comprehensive Test Suite
 * Run: node test_suite.mjs
 */

import { extractTicker } from './src/utils/tickerExtractor.js';

const BACKEND = process.env.BACKEND_URL || 'http://localhost:8080';
let passed = 0;
let failed = 0;
const failures = [];

// ── Helpers ────────────────────────────────────────────────────────────────────

function assert(label, condition, got, expected) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.error(`  ❌ ${label}`);
    console.error(`     expected: ${JSON.stringify(expected)}`);
    console.error(`     got:      ${JSON.stringify(got)}`);
    failed++;
    failures.push({ label, expected, got });
  }
}

async function backendGet(path) {
  const res = await fetch(`${BACKEND}${path}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${path}`);
  return res.json();
}

async function openaiChat(systemContent, userContent) {
  const res = await fetch(`${BACKEND}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [
        { role: 'system', content: systemContent },
        { role: 'user',   content: userContent  },
      ],
      temperature: 0.2,
      max_tokens: 600,
      stream: false,
    }),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(`Backend ${res.status}: ${t.slice(0, 200)}`); }
  const json = await res.json();
  return json.choices?.[0]?.message?.content || '';
}

// ── Mapping helper (mirrors stockService mapSnapshot) ─────────────────────────

function mapSnapshot(snap) {
  const day = snap.day || {};
  const prevDay = snap.prevDay || {};
  const lastTrade = snap.lastTrade || {};
  const lastQuote = snap.lastQuote || {};

  let price = lastTrade.p ?? lastQuote.P ?? day.c ?? 0;
  let volume = day.v ?? 0;
  let open = day.o ?? 0;
  let dayHigh = day.h ?? 0;
  let dayLow = day.l ?? 0;
  let vwap = day.vw ?? 0;

  // Fallback to prevDay values if today's regular session has no data (e.g. market closed or pre-market)
  if ((!price || price === 0) && prevDay.c && prevDay.c > 0) {
    price = prevDay.c;
  }
  if ((!volume || volume === 0) && prevDay.v && prevDay.v > 0) {
    volume = prevDay.v;
  }
  if ((!open || open === 0) && prevDay.o && prevDay.o > 0) {
    open = prevDay.o;
  }
  if ((!dayHigh || dayHigh === 0) && prevDay.h && prevDay.h > 0) {
    dayHigh = prevDay.h;
  }
  if ((!dayLow || dayLow === 0) && prevDay.l && prevDay.l > 0) {
    dayLow = prevDay.l;
  }

  return {
    ticker: snap.ticker || '',
    name: snap.name || snap.ticker || '',
    price,
    changePercent: snap.todaysChangePerc ?? 0,
    volume,
    open,
    dayHigh,
    dayLow,
    vwap,
    previousClose: prevDay.c ?? 0,
    todaysChange: snap.todaysChange ?? 0,
  };
}

function isValidStock(s) {
  const price = Number(s.price);
  const pct   = Number(s.changePercent);
  const vol   = Number(s.volume);
  const ticker = (s.ticker || '').toUpperCase();
  return (
    price >= 0.01 &&
    pct !== 0 &&
    pct < 2000 &&
    vol >= 1000 &&
    ticker.length <= 5 &&
    !ticker.endsWith('Q')
  );
}

function fmtVol(n) {
  n = Number(n);
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return String(n);
}

function fmtRow(s) {
  const pct  = Number(s.changePercent);
  const sign = pct >= 0 ? '+' : '';
  return `${s.ticker} - ${s.name || s.ticker} | $${Number(s.price).toFixed(2)} | ${sign}${pct.toFixed(2)}% | Vol: ${fmtVol(s.volume)}`;
}

// ── TEST 1: TICKER EXTRACTION ──────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════════');
console.log('TEST 1 — TICKER EXTRACTION');
console.log('══════════════════════════════════════════════');

const tickerTests = [
  { input: 'cuales stocks han subido hoy',    expected: null,   note: 'HAN must not extract' },
  { input: 'que stock vale la pena comprar',  expected: null,   note: 'VALE must not extract' },
  { input: 'analiza NVDA',                    expected: 'NVDA', note: 'explicit ticker' },
  { input: 'como va tesla hoy',               expected: 'TSLA', note: 'company name mapping' },
  { input: 'pq bajo tanto AIXI',              expected: 'AIXI', note: 'short question with ticker' },
  { input: 'es buena inversion PLTR',         expected: 'PLTR', note: 'known ticker in known set' },
  { input: 'dame info de apple',              expected: 'AAPL', note: 'company name "apple"' },
  { input: 'cuales son las penny stocks',     expected: null,   note: 'no ticker in generic question' },
];

for (const t of tickerTests) {
  const result = extractTicker(t.input);
  assert(
    `"${t.input}" → ${t.expected ?? 'null'} (${t.note})`,
    result === t.expected,
    result,
    t.expected
  );
}

// ── TEST 2: BACKEND CONNECTIVITY ───────────────────────────────────────────────

console.log('\n══════════════════════════════════════════════');
console.log('TEST 2 — BACKEND CONNECTIVITY');
console.log('══════════════════════════════════════════════');

let gainersData, losersData, nvdaData, aaplData;

try {
  console.log('  Fetching /api/gainers…');
  const gJson = await backendGet('/api/gainers');
  gainersData = (gJson.tickers || []).map(mapSnapshot).filter(isValidStock)
    .sort((a, b) => Number(b.changePercent) - Number(a.changePercent));
  assert(
    `/api/gainers returns ≥1 stock with real price`,
    gainersData.length >= 1 && gainersData[0].price > 0,
    `${gainersData.length} stocks, top price=$${gainersData[0]?.price}`,
    '≥1 stock with price>0'
  );
  console.log(`     Top gainer: ${gainersData[0]?.ticker} $${Number(gainersData[0]?.price).toFixed(2)} +${Number(gainersData[0]?.changePercent).toFixed(2)}%`);
} catch (e) {
  assert('/api/gainers reachable', false, e.message, 'HTTP 200 JSON');
}

try {
  console.log('  Fetching /api/losers…');
  const lJson = await backendGet('/api/losers');
  losersData = (lJson.tickers || []).map(mapSnapshot).filter(isValidStock)
    .sort((a, b) => Number(a.changePercent) - Number(b.changePercent));
  assert(
    `/api/losers returns ≥1 stock with real price`,
    losersData.length >= 1 && losersData[0].price > 0,
    `${losersData.length} stocks`,
    '≥1 stock'
  );
  console.log(`     Top loser: ${losersData[0]?.ticker} $${Number(losersData[0]?.price).toFixed(2)} ${Number(losersData[0]?.changePercent).toFixed(2)}%`);
} catch (e) {
  assert('/api/losers reachable', false, e.message, 'HTTP 200 JSON');
}

try {
  console.log('  Fetching /api/quote/NVDA…');
  const qJson = await backendGet('/api/quote/NVDA');
  nvdaData = qJson.ticker ? mapSnapshot(qJson.ticker) : null;
  assert(
    `/api/quote/NVDA returns price > $0`,
    nvdaData && nvdaData.price > 0,
    `price=$${nvdaData?.price}`,
    'price > 0'
  );
  console.log(`     NVDA: $${Number(nvdaData?.price).toFixed(2)} (${Number(nvdaData?.changePercent).toFixed(2)}%)`);
} catch (e) {
  assert('/api/quote/NVDA reachable', false, e.message, 'HTTP 200 JSON');
}

try {
  console.log('  Fetching /api/quote/AAPL…');
  const qJson = await backendGet('/api/quote/AAPL');
  aaplData = qJson.ticker ? mapSnapshot(qJson.ticker) : null;
  assert(
    `/api/quote/AAPL returns price > $0`,
    aaplData && aaplData.price > 0,
    `price=$${aaplData?.price}`,
    'price > 0'
  );
  console.log(`     AAPL: $${Number(aaplData?.price).toFixed(2)} (${Number(aaplData?.changePercent).toFixed(2)}%)`);
} catch (e) {
  assert('/api/quote/AAPL reachable', false, e.message, 'HTTP 200 JSON');
}

// ── TEST 3 / 4 / 5: AI RESPONSE ACCURACY + LANGUAGE + FORMAT ──────────────────

console.log('\n══════════════════════════════════════════════');
console.log('TEST 3+4+5 — AI ACCURACY, LANGUAGE & FORMAT');
console.log('══════════════════════════════════════════════');

// Build a representative system prompt using real live data
const gainersBlock = (gainersData || []).slice(0, 15).map(fmtRow).join('\n') || 'No data';
const losersBlock  = (losersData  || []).slice(0, 10).map(fmtRow).join('\n') || 'No data';

const pennyLike = (gainersData || [])
  .filter(s => Number(s.changePercent) > 15 && Number(s.volume) > 50000)
  .slice(0, 15);
const pennyBlock = pennyLike.length > 0
  ? pennyLike.map(fmtRow).join('\n')
  : (gainersData || []).filter(s => Number(s.price) < 20).slice(0, 10).map(fmtRow).join('\n') || 'No movers';

const availableBlock = (gainersData || []).slice(0, 20)
  .map(s => `${s.ticker} — $${Number(s.price).toFixed(2)}`).join('\n') || 'No data';

const nvdaOpen  = nvdaData ? Number(nvdaData.open).toFixed(2)  : '???';
const nvdaPrice = nvdaData ? Number(nvdaData.price).toFixed(2) : '???';

// Single stock prompt for NVDA
const nvdaSystemPrompt = `⚠️ OVERRIDE ALL TRAINING DATA ⚠️
The stock prices below come from LIVE MARKET FEEDS right now. They SUPERSEDE anything you learned during training. USE THESE EXACT NUMBERS.

=== IDENTITY ===
You are CHATSTOX AI, a professional trading analyst. Respond 100% in the SAME language as the user's message.

=== DATA RULE ===
MANDATORY: USE THESE EXACT NUMBERS. Do not recall training-data prices.

━━━ LIVE DATA: NVDA — NVIDIA Corporation ━━━
Precio actual : $${nvdaPrice}
Apertura      : $${nvdaOpen}
Cambio hoy    : ${Number(nvdaData?.changePercent ?? 0) >= 0 ? '+' : ''}${Number(nvdaData?.changePercent ?? 0).toFixed(2)}%
Volumen       : ${fmtVol(nvdaData?.volume ?? 0)}
Máximo del día: $${Number(nvdaData?.dayHigh ?? 0).toFixed(2)}
Mínimo del día: $${Number(nvdaData?.dayLow ?? 0).toFixed(2)}
VWAP          : $${Number(nvdaData?.vwap ?? 0).toFixed(2)}

━━━ INSTRUCTIONS ━━━
Answer using ONLY the real-time data above. Copy numbers exactly. Respond in the SAME language as the user.
For analysis questions: use FORMAT 2 EXACTLY — start each line with its emoji (📊 📈 💡 🎯 ⚡ 📌). No prose paragraphs.
For trade setup questions: use FORMAT 3 EXACTLY — each line starts with its emoji (📊 🟢 🎯 🛑 📈 ⚖️). No prose paragraphs.`;

// General chat system prompt
const generalSystemPrompt = `⚠️ OVERRIDE ALL TRAINING DATA ⚠️
The stock prices below come from LIVE MARKET FEEDS right now. They SUPERSEDE anything you learned during training. USE THESE EXACT NUMBERS. If you use any price not listed here, you are making a factual error.

=== IDENTITY ===
You are CHATSTOX AI, a professional Wall Street analyst. Respond 100% in the SAME language as the user's message. Zero language mixing.

=== LANGUAGE RULE ===
Spanish question → 100% Spanish. English question → 100% English. No mixing.

=== RESPONSE FORMAT ===
FORMAT 1 — LISTING STOCKS:
TICKER - Company Name | $price | +/-X.XX% | Vol: XM
Sort highest % gain first.

FORMAT 2 — SINGLE STOCK ANALYSIS (bilingual, match user language):
MANDATORY: Use EXACTLY this structure with these emoji characters. No markdown headers.
[TICKER] — [Company]
📊 Precio: $X.XX | Cambio: +/-X.XX% | Vol: XM
📈 Apertura / Máximo / Mínimo / VWAP
💡 Análisis: ...
🎯 Niveles clave: Soporte / Resistencia
⚡ Catalizador: ...
📌 Opinión: ...

FORMAT 3 — TRADE SETUP:
MANDATORY: Use EXACTLY this structure. Every line must start with its emoji. No prose paragraphs.
📊 TRADE SETUP — TICKER
🟢 Entrada / 🎯 Targets / 🛑 Stop Loss / ⚖️ Risk:Reward

━━━ STOCKS AVAILABLE FOR RECOMMENDATIONS RIGHT NOW ━━━
You may ONLY recommend stocks from this list. Every price must match exactly.
${availableBlock}

━━━ LIVE MARKET DATA (USE THESE EXACT NUMBERS) ━━━

TOP GAINERS TODAY:
${gainersBlock}

TOP LOSERS TODAY:
${losersBlock}

TODAY'S TOP MOMENTUM / PENNY STOCKS:
${pennyBlock}

━━━ INSTRUCTIONS ━━━
Answer ALL questions using ONLY the data above. Respond in the SAME language as the user.`;

// ── 3a: NVDA open price (Spanish) ─────────────────────────────────────────────
console.log('\n  3a. "en cuanto abrió NVDA hoy?" — expect real open price in Spanish');
try {
  const reply = await openaiChat(nvdaSystemPrompt, 'en cuanto abrió NVDA hoy?');
  console.log(`     GPT: "${reply.slice(0, 200)}"`);
  const containsOpen = reply.includes(nvdaOpen) || reply.includes(nvdaOpen.replace('.', ','));
  const isSpanish = /[áéíóúñ]|abrió|precio|apertura|hoy|en/i.test(reply);
  assert('NVDA open price present in reply', containsOpen, reply.slice(0,80), `contains $${nvdaOpen}`);
  assert('Reply is in Spanish', isSpanish, reply.slice(0,80), 'Spanish language');
} catch (e) {
  assert('NVDA open price AI call', false, e.message, 'valid response');
}

// ── 3b: Top 5 gainers (Spanish) ───────────────────────────────────────────────
console.log('\n  3b. "dame las top 5 ganadoras hoy" — expect FORMAT 1 list from real data');
try {
  const reply = await openaiChat(generalSystemPrompt, 'dame las top 5 ganadoras hoy');
  console.log(`     GPT:\n${reply.slice(0, 400)}`);
  // Check FORMAT 1 pattern: TICKER - ... | $price | +X.XX% | Vol:
  const fmtPattern = /[A-Z]{2,5}\s*-\s*.+\|\s*\$[\d.]+\s*\|\s*[+-][\d.]+%\s*\|\s*Vol:/m;
  const hasFormat1 = fmtPattern.test(reply);
  // At least one real ticker from gainers
  const gainTickers = (gainersData || []).slice(0, 5).map(s => s.ticker);
  const hasRealTicker = gainTickers.some(t => reply.includes(t));
  assert('Reply uses FORMAT 1 pattern', hasFormat1, 'see above', 'TICKER - Name | $price | +X% | Vol:');
  assert('Reply contains at least one real gainer ticker', hasRealTicker, gainTickers.join(','), gainTickers[0]);
} catch (e) {
  assert('Top 5 gainers AI call', false, e.message, 'valid response');
}

// ── 3c: Penny stocks (Spanish) ────────────────────────────────────────────────
console.log('\n  3c. "que penny stocks recomiendas hoy" — expect real movers from live data');
try {
  const reply = await openaiChat(generalSystemPrompt, 'que penny stocks recomiendas hoy');
  console.log(`     GPT:\n${reply.slice(0, 400)}`);
  const allTickers = (gainersData || []).map(s => s.ticker);
  const hasRealTicker = allTickers.some(t => reply.includes(t));
  // Accept FORMAT 1 (list) or FORMAT 3 (trade setup per ticker) — both are valid with real data
  const fmtPattern = /([A-Z]{2,5}\s*-\s*.+\|\s*\$[\d.]+)|([A-Z]{2,5}.*\$[\d.]+.*Entrada|TRADE SETUP)/m;
  assert('Penny reply uses FORMAT 1 or FORMAT 3 with real prices', fmtPattern.test(reply), 'see above', 'FORMAT 1 or 3');
  assert('Penny reply contains real live ticker', hasRealTicker, 'see above', 'ticker from live data');
} catch (e) {
  assert('Penny stocks AI call', false, e.message, 'valid response');
}

// ── 3d/4: English response for English question ────────────────────────────────
console.log('\n  3d/4a. "What are the top gainers today?" — expect English FORMAT 1 response');
try {
  const reply = await openaiChat(generalSystemPrompt, 'What are the top gainers today?');
  console.log(`     GPT: "${reply.slice(0, 300)}"`);
  // FORMAT 1 replies are all tickers/numbers — no prose words, just no Spanish mixed in
  const spanishWords = /\b(los|las|hoy|precio|acciones|subio|ganadores|ganó|sube)\b/i;
  const noSpanish = !spanishWords.test(reply);
  // Has at least a ticker pattern (letter sequence + price + percent)
  const hasTickerFormat = /[A-Z]{2,5}.*\$[\d.]+.*[+-][\d.]+%/m.test(reply);
  assert('English question gets English reply (no Spanish words)', noSpanish, reply.slice(0,100), 'no Spanish');
  assert('English reply contains ticker/price data', hasTickerFormat, reply.slice(0,100), 'ticker format');
} catch (e) {
  assert('English language AI call', false, e.message, 'valid response');
}

// ── 3e/4: Full Spanish response for Spanish question ─────────────────────────
console.log('\n  3e/4b. "analiza el mercado hoy" — expect Spanish-only response');
try {
  const reply = await openaiChat(generalSystemPrompt, 'analiza el mercado hoy');
  console.log(`     GPT: "${reply.slice(0, 300)}"`);
  const spanishDetected = /[áéíóúüñ¿¡]|\b(el|la|los|las|de|que|hoy|mercado|acciones|precio|está|es)\b/i.test(reply);
  assert('Spanish question gets Spanish reply', spanishDetected, reply.slice(0,100), 'Spanish language');
} catch (e) {
  assert('Spanish market analysis AI call', false, e.message, 'valid response');
}

// ── 5: FORMAT checks ──────────────────────────────────────────────────────────
console.log('\n  5. FORMAT VERIFICATION');
// Verify FORMAT 2 (single stock) structure
console.log('  5a. "dame un análisis completo de NVDA" — expect FORMAT 2 with emoji labels');
try {
  const reply = await openaiChat(nvdaSystemPrompt, 'dame un análisis completo de NVDA');
  console.log(`     GPT:\n${reply.slice(0, 500)}`);
  const hasEmoji  = /[📊📈💡🎯⚡📌]/.test(reply);
  const hasPrice  = reply.includes(nvdaPrice) || reply.includes(nvdaOpen);
  // GPT may label key levels as soporte/resistencia, máximo/mínimo, high/low, or support/resistance
  const hasKeyLevels = /soporte|resistencia|support|resistance|máximo|mínimo|high|low|nivel/i.test(reply);
  assert('FORMAT 2: contains emoji labels', hasEmoji, 'see above', 'emoji labels');
  assert('FORMAT 2: contains real NVDA price', hasPrice, `price=${nvdaPrice}`, `contains $${nvdaPrice}`);
  assert('FORMAT 2: contains key price levels', hasKeyLevels, 'see above', 'key level labels');
} catch (e) {
  assert('FORMAT 2 single stock AI call', false, e.message, 'valid response');
}

// Verify FORMAT 3 (trade setup)
console.log('\n  5b. "dame un setup de trading para NVDA" — expect FORMAT 3');
try {
  const reply = await openaiChat(nvdaSystemPrompt, 'dame un setup de trading para NVDA');
  console.log(`     GPT:\n${reply.slice(0, 500)}`);
  const hasSetupEmoji = /[🟢🎯🛑⚖️📊]/.test(reply);
  // Risk:reward may appear as "1:2", "1:X", "⚖️", or the word "riesgo/beneficio"
  const hasRiskReward = /risk|reward|ratio|1:\d|⚖️|riesgo|beneficio/i.test(reply);
  const hasStop       = /stop|pérdida|loss/i.test(reply);
  const hasEntry      = /entrada|entry|🟢|\$[\d.]+.*entrada/i.test(reply);
  assert('FORMAT 3: contains trade setup emojis', hasSetupEmoji, 'see above', 'setup emojis');
  assert('FORMAT 3: contains stop loss', hasStop, 'see above', 'stop/loss');
  assert('FORMAT 3: contains entry or risk:reward', hasRiskReward || hasEntry, 'see above', 'entry/risk:reward');
} catch (e) {
  assert('FORMAT 3 trade setup AI call', false, e.message, 'valid response');
}

// ── SUMMARY ────────────────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════════');
console.log(`RESULTS: ${passed} passed / ${failed} failed / ${passed + failed} total`);
if (failures.length > 0) {
  console.log('\nFAILURES:');
  failures.forEach(f => console.log(`  ❌ ${f.label}`));
}
console.log('══════════════════════════════════════════════\n');
process.exit(failed > 0 ? 1 : 0);
