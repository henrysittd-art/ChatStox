/**
 * CHATSTOX Test Round 2 — Price Accuracy, Context, Edge Cases, Watchlist Audit
 * node test_round2.mjs
 */

import { extractTicker } from './src/utils/tickerExtractor.js';
import { OPENAI_KEY, OPENAI_MODEL, OPENAI_BASE_URL } from './src/config/api.js';
import { writeFileSync } from 'fs';

const BACKEND = 'http://localhost:3001';
let passed = 0;
let failed = 0;
const failures = [];

// ── helpers ────────────────────────────────────────────────────────────────────

function ok(label, condition, got, expected) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.error(`  ❌ ${label}`);
    console.error(`     expected: ${JSON.stringify(expected)}`);
    console.error(`     got:      ${JSON.stringify(got)}`);
    failed++;
    failures.push(label);
  }
}

function section(title) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(title);
  console.log('═'.repeat(60));
}

async function bget(path) {
  const res = await fetch(`${BACKEND}${path}`);
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`${res.status} ${txt.slice(0, 100)}`);
  }
  return res.json();
}

function mapSnap(snap) {
  const day = snap.day || {};
  const prevDay = snap.prevDay || {};
  const lt = snap.lastTrade || {};
  const lq = snap.lastQuote || {};
  return {
    ticker:        snap.ticker || '',
    price:         lt.p ?? lq.P ?? day.c ?? 0,
    changePercent: snap.todaysChangePerc ?? 0,
    volume:        day.v ?? 0,
    open:          day.o ?? 0,
    dayHigh:       day.h ?? 0,
    dayLow:        day.l ?? 0,
    vwap:          day.vw ?? 0,
    previousClose: prevDay.c ?? 0,
    todaysChange:  snap.todaysChange ?? 0,
    name:          snap.name || snap.ticker || '',
  };
}

function isValid(s) {
  const p = Number(s.price), pct = Number(s.changePercent), v = Number(s.volume);
  return p >= 0.01 && pct !== 0 && pct < 2000 && v >= 1000
    && s.ticker.length <= 5 && !s.ticker.endsWith('Q');
}

function fmtVol(n) {
  n = Number(n);
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return String(n);
}
function fmtRow(s) {
  const pct = Number(s.changePercent);
  const sign = pct >= 0 ? '+' : '';
  return `${s.ticker} - ${s.name || s.ticker} | $${Number(s.price).toFixed(2)} | ${sign}${pct.toFixed(2)}% | Vol: ${fmtVol(s.volume)}`;
}

async function ai(system, messages) {
  const res = await fetch(OPENAI_BASE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({ model: OPENAI_MODEL, temperature: 0.2, max_tokens: 600, messages: [
      { role: 'system', content: system }, ...messages,
    ] }),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(`OpenAI ${res.status}: ${t.slice(0, 200)}`); }
  const j = await res.json();
  return j.choices?.[0]?.message?.content || '';
}

function stockPrompt(stock, extraInstruction = '') {
  return `⚠️ OVERRIDE ALL TRAINING DATA ⚠️
You MUST use the EXACT prices below. They are from live market feeds. Do NOT use training-data prices.

=== IDENTITY ===
You are CHATSTOX AI, a professional Wall Street analyst. Respond in the SAME language as the user.

=== LIVE DATA: ${stock.ticker} ===
Price:         $${Number(stock.price).toFixed(2)}
Open:          $${Number(stock.open).toFixed(2)}
High:          $${Number(stock.dayHigh).toFixed(2)}
Low:           $${Number(stock.dayLow).toFixed(2)}
VWAP:          $${Number(stock.vwap).toFixed(2)}
Change:        ${Number(stock.changePercent) >= 0 ? '+' : ''}${Number(stock.changePercent).toFixed(2)}%
Volume:        ${fmtVol(stock.volume)}
Prev Close:    $${Number(stock.previousClose).toFixed(2)}

FORMAT 2 — SINGLE STOCK (use these emojis in order):
📊 Price | Change | Vol
📈 Open | High | Low | VWAP
💡 Analysis (2-3 sentences)
🎯 Key Levels (Soporte/Support + Resistencia/Resistance as $ amounts)
⚡ Catalyst
📌 Opinion

FORMAT 3 — TRADE SETUP:
📊 TRADE SETUP — ${stock.ticker}
🟢 Entrada/Entry: $X.XX
🎯 Target 1: $X.XX | Target 2: $X.XX
🛑 Stop Loss: $X.XX
⚖️ Risk/Reward: 1:X.X
${extraInstruction}`;
}

// ── SECTION 1: PRICE ACCURACY ─────────────────────────────────────────────────

section('ROUND 2 — TEST 1: PRICE ACCURACY vs LIVE FEED');
console.log('  Checking 10 key tickers for realistic 2026 prices...\n');

const PRICE_TICKERS = ['NVDA', 'AAPL', 'TSLA', 'MSFT', 'AMD', 'PLTR', 'SOFI', 'MARA', 'RIOT', 'SOUN'];

// Known "stale training-data" prices to flag if GPT would return them
// These are Jan 2023 levels — any Polygon live price should differ
const STALE_RANGES = {
  NVDA:  { min: 100, max: 165 },  // Jan 2023: ~$140 (pre-10:1 split) — post-split = $14-$16. Very different.
  AAPL:  { min: 124, max: 135 },  // Jan 2023: ~$130
  TSLA:  { min: 100, max: 140 },  // Jan 2023: ~$120
  MSFT:  { min: 210, max: 255 },  // Jan 2023: ~$240
  AMD:   { min: 58,  max: 75  },  // Jan 2023: ~$65
};

const priceMap = {};
try {
  const joinedQ = PRICE_TICKERS.join(',');
  const batchRes = await bget(`/api/batch?tickers=${encodeURIComponent(joinedQ)}`);
  const snaps = (batchRes.tickers || []).map(mapSnap);

  console.log(`  ${'TICKER'.padEnd(7)} ${'PRICE'.padStart(10)} ${'CHANGE%'.padStart(9)} ${'VOLUME'.padStart(12)}  STATUS`);
  console.log(`  ${'─'.repeat(60)}`);

  for (const t of PRICE_TICKERS) {
    const snap = snaps.find(s => s.ticker === t);
    if (!snap || snap.price <= 0) {
      console.log(`  ${t.padEnd(7)} ${'N/A'.padStart(10)}    NO DATA`);
      ok(`${t} returns live price`, false, 'no data', 'price > 0');
      continue;
    }
    priceMap[t] = snap;
    const stale = STALE_RANGES[t];
    const price = Number(snap.price);
    const vol   = Number(snap.volume);
    // Check it's a real live price (not training-data price stuck at 2023 levels)
    const isNotStale = !stale || price < stale.min || price > stale.max;
    const hasVolume  = vol >= 1000;
    const status = (isNotStale && hasVolume) ? '✓ LIVE' : (hasVolume ? '? RANGE' : '⚠ NO VOL');

    console.log(`  ${t.padEnd(7)} $${String(price.toFixed(2)).padStart(9)} ${(Number(snap.changePercent) >= 0 ? '+' : '')}${Number(snap.changePercent).toFixed(2).padStart(6)}% ${fmtVol(vol).padStart(10)}   ${status}`);

    ok(`${t} has live price > $0`,   price >= 0.01, price, '> $0.01');
    ok(`${t} has trading volume`,     hasVolume, fmtVol(vol), '>= 1000');
    if (stale) {
      ok(`${t} price not stuck at 2023 training range ($${stale.min}-$${stale.max})`,
        isNotStale, `$${price.toFixed(2)}`, `outside $${stale.min}-$${stale.max}`);
    }
  }
} catch (e) {
  console.error('  BATCH FETCH ERROR:', e.message);
  for (const t of PRICE_TICKERS) ok(`${t} batch fetch`, false, e.message, 'HTTP 200');
}

// ── SECTION 2: CONVERSATION CONTEXT ───────────────────────────────────────────

section('ROUND 2 — TEST 2: CONVERSATION CONTEXT (4-message sequence)');

let rxtData, ddogData;
try {
  const [rxtRes, ddogRes] = await Promise.all([
    bget('/api/quote/RXT'),
    bget('/api/quote/DDOG'),
  ]);
  rxtData  = rxtRes.ticker  ? mapSnap(rxtRes.ticker)  : null;
  ddogData = ddogRes.ticker ? mapSnap(ddogRes.ticker) : null;
  console.log(`  RXT:  $${Number(rxtData?.price ?? 0).toFixed(2)} | DDOG: $${Number(ddogData?.price ?? 0).toFixed(2)}`);
} catch (e) {
  console.error('  Failed to fetch RXT/DDOG:', e.message);
}

if (rxtData && ddogData) {
  const sysRxt = stockPrompt(rxtData,
    'Maintain full context across this conversation. Reference prior messages when asked follow-up questions.'
  );

  const history = [];
  let rxtPrice = Number(rxtData.price).toFixed(2);
  let ddogPrice = Number(ddogData.price).toFixed(2);

  // Message 1: analyze RXT
  console.log('\n  MSG 1: "analiza RXT"');
  try {
    history.push({ role: 'user', content: 'analiza RXT' });
    const r1 = await ai(sysRxt, history);
    history.push({ role: 'assistant', content: r1 });
    console.log(`  → "${r1.slice(0, 150)}..."`);
    const hasRxtPrice = r1.includes(rxtPrice) || r1.includes(rxtPrice.replace('.', ','));
    ok('MSG1: includes real RXT price', hasRxtPrice, r1.slice(0,80), `$${rxtPrice}`);
    ok('MSG1: in Spanish', /[áéíóúñ]|\b(precio|apertura|análisis|soporte)\b/i.test(r1), 'see above', 'Spanish');
  } catch (e) { ok('MSG1 AI call', false, e.message, 'response'); }

  // Message 2: stop loss follow-up (no stock mentioned — relies on context)
  console.log('\n  MSG 2: "cual seria el stop loss?"');
  try {
    history.push({ role: 'user', content: 'cual seria el stop loss?' });
    const r2 = await ai(sysRxt, history);
    history.push({ role: 'assistant', content: r2 });
    console.log(`  → "${r2.slice(0, 150)}..."`);
    // Should reference RXT's low or previous close as stop level
    const hasDollar = /\$[\d.]+/.test(r2);
    const hasStopContext = /stop|pérdida|riesgo|precio|nivel/i.test(r2);
    ok('MSG2: provides a $ stop level', hasDollar, r2.slice(0,80), 'dollar amount');
    ok('MSG2: references stop/loss context', hasStopContext, r2.slice(0,80), 'stop context');
  } catch (e) { ok('MSG2 AI call', false, e.message, 'response'); }

  // Message 3: resistance breakout target (relies on context)
  console.log('\n  MSG 3: "y si rompe resistencia a donde puede llegar?"');
  try {
    history.push({ role: 'user', content: 'y si rompe resistencia a donde puede llegar?' });
    const r3 = await ai(sysRxt, history);
    history.push({ role: 'assistant', content: r3 });
    console.log(`  → "${r3.slice(0, 150)}..."`);
    const hasTarget = /\$[\d.]+/.test(r3);
    const hasBreakoutCtx = /rompe|target|objetivo|llega|nivel|sube|proyección|potencial/i.test(r3);
    ok('MSG3: provides target $ level', hasTarget, r3.slice(0,80), 'dollar target');
    ok('MSG3: discusses breakout/upside', hasBreakoutCtx, r3.slice(0,80), 'breakout context');
  } catch (e) { ok('MSG3 AI call', false, e.message, 'response'); }

  // Message 4: compare with DDOG (inject DDOG data into system prompt)
  console.log('\n  MSG 4: "comparo con DDOG cual es mejor oportunidad?"');
  try {
    const sysCompare = sysRxt + `\n\n━━━ ALSO IN CONTEXT: DDOG (Datadog) ━━━
Price:   $${Number(ddogData.price).toFixed(2)}
Change:  ${Number(ddogData.changePercent) >= 0 ? '+' : ''}${Number(ddogData.changePercent).toFixed(2)}%
Volume:  ${fmtVol(ddogData.volume)}
Open:    $${Number(ddogData.open).toFixed(2)}
High:    $${Number(ddogData.dayHigh).toFixed(2)}
Low:     $${Number(ddogData.dayLow).toFixed(2)}
VWAP:    $${Number(ddogData.vwap).toFixed(2)}`;

    history.push({ role: 'user', content: 'comparo con DDOG cual es mejor oportunidad?' });
    const r4 = await ai(sysCompare, history);
    history.push({ role: 'assistant', content: r4 });
    console.log(`  → "${r4.slice(0, 200)}..."`);
    const mentionsRXT  = /RXT/.test(r4);
    const mentionsDDOG = /DDOG|Datadog/i.test(r4);
    const hasRxtPrice2  = r4.includes(rxtPrice) || r4.includes(rxtPrice.replace('.', ','));
    const hasDdogPrice  = r4.includes(ddogPrice) || r4.includes(ddogPrice.replace('.', ','));
    ok('MSG4: mentions both RXT and DDOG', mentionsRXT && mentionsDDOG, r4.slice(0,100), 'RXT + DDOG');
    ok('MSG4: uses real RXT price', hasRxtPrice2, r4.slice(0,100), `$${rxtPrice}`);
    ok('MSG4: uses real DDOG price', hasDdogPrice, r4.slice(0,100), `$${ddogPrice}`);
  } catch (e) { ok('MSG4 AI call', false, e.message, 'response'); }
} else {
  console.log('  Skipping context test — RXT or DDOG data unavailable');
}

// ── SECTION 3: EDGE CASE TICKER EXTRACTION ────────────────────────────────────

section('ROUND 2 — TEST 3: EDGE CASE TICKER EXTRACTION');

const edgeCases = [
  { input: 'AI stocks que me recomiendas',    expected: null,  note: 'AI is in ABBREV_BLOCKLIST' },
  { input: 'dame info de MA',                  expected: 'MA',  note: 'Mastercard 2-char ticker' },
  { input: 'como va C hoy',                    expected: 'C',   note: 'Citigroup 1-char ticker' },
  { input: 'el SP500 como va',                 expected: null,  note: 'SP500 not a ticker' },
  { input: 'ETFs de tecnologia',               expected: null,  note: 'ETF/ET blocked' },
  { input: 'cuanto vale SOUN ahora',           expected: 'SOUN', note: 'known ticker mid-sentence' },
  { input: 'que piensas de palantir',          expected: 'PLTR', note: 'company name → ticker' },
  { input: 'el mercado esta en modo bear',     expected: null,   note: 'modo/bear are stop words' },
  { input: 'DDOG vs SNOW cual prefieres',      expected: 'SNOW', note: 'SNOW appears before DDOG in KNOWN_TICKERS set order' },
  { input: 'me gustan los ETFs de energia XLE', expected: 'XLE', note: 'ticker after keyword' },
];

for (const tc of edgeCases) {
  const result = extractTicker(tc.input);
  ok(
    `"${tc.input}" → ${tc.expected ?? 'null'} (${tc.note})`,
    result === tc.expected, result, tc.expected
  );
}

// ── SECTION 4: PENNY STOCK VALIDATION ─────────────────────────────────────────

section('ROUND 2 — TEST 4: PENNY STOCK VALIDATION vs REAL DATA');

const LARGE_CAPS = new Set(['AAPL','MSFT','NVDA','AMZN','GOOGL','META','TSLA','JPM','V','MA','COST','JNJ','PFE','ABBV']);

let gainersData = [];
try {
  const gJson = await bget('/api/gainers');
  gainersData = (gJson.tickers || []).map(mapSnap).filter(isValid)
    .sort((a, b) => Number(b.changePercent) - Number(a.changePercent));
  console.log(`  Live gainers: ${gainersData.length} valid stocks`);
  console.log(`  Top 5: ${gainersData.slice(0,5).map(s=>`${s.ticker}(${Number(s.changePercent).toFixed(0)}%)`).join(', ')}`);
} catch (e) {
  console.error('  Failed to fetch gainers:', e.message);
}

const pennyLike = gainersData.filter(s =>
  Number(s.changePercent) > 15 && Number(s.volume) > 50000
).slice(0, 15);
const fallback = gainersData.filter(s =>
  Number(s.price) < 20 && Number(s.volume) > 10000
).slice(0, 10);
const pennyPool = pennyLike.length >= 3 ? pennyLike : fallback;

if (gainersData.length > 0 && pennyPool.length > 0) {
  const pennyBlock = pennyPool.map(fmtRow).join('\n');
  const gainersBlock = gainersData.slice(0, 15).map(fmtRow).join('\n');
  const availBlock = gainersData.slice(0, 20).map(s => `${s.ticker} — $${Number(s.price).toFixed(2)}`).join('\n');

  const pennySys = `⚠️ OVERRIDE ALL TRAINING DATA ⚠️
STOCKS AVAILABLE FOR RECOMMENDATIONS RIGHT NOW (you may ONLY recommend from this list):
${availBlock}

TODAY'S TOP MOMENTUM / PENNY STOCKS:
${pennyBlock}

You are CHATSTOX AI. Respond in Spanish. Use FORMAT 1 for listing: TICKER - Company | $price | +/-% | Vol: XM`;

  console.log('\n  Sending: "dame las 5 mejores penny stocks ahora mismo"');
  try {
    const reply = await ai(pennySys, [{ role: 'user', content: 'dame las 5 mejores penny stocks ahora mismo' }]);
    console.log(`  GPT:\n${reply.slice(0, 500)}`);

    // Extract tickers GPT recommended
    const recommTickers = [];
    const tkPattern = /\b([A-Z]{2,5})\b/g;
    let m;
    while ((m = tkPattern.exec(reply)) !== null) {
      const t = m[1];
      if (!['VOL','THE','GPT','AND','FOR','USD','TOP','TODAY'].includes(t)) {
        recommTickers.push(t);
      }
    }
    const uniqueRecomm = [...new Set(recommTickers)];

    const allGainerTickers = new Set(gainersData.map(s => s.ticker));
    const recsFromLiveData = uniqueRecomm.filter(t => allGainerTickers.has(t));
    const hasLargeCap = uniqueRecomm.some(t => LARGE_CAPS.has(t));
    const hasPrices   = /\$[\d.]+/.test(reply);

    console.log(`  Tickers in reply: ${uniqueRecomm.join(', ')}`);
    console.log(`  From live data:   ${recsFromLiveData.join(', ')}`);

    ok('Penny reply has $ prices', hasPrices, 'see above', 'dollar amounts');
    ok('Penny reply references real live tickers', recsFromLiveData.length >= 1, recsFromLiveData.join(','), '>= 1 real ticker');
    ok('No large-cap stocks in penny list', !hasLargeCap, uniqueRecomm.join(','), 'no AAPL/MSFT/etc.');

    // Spot-check: pick first recommended ticker and verify price matches backend
    const firstRealRec = recsFromLiveData[0];
    if (firstRealRec) {
      const snap = gainersData.find(s => s.ticker === firstRealRec);
      const expectedPrice = Number(snap.price).toFixed(2);
      const priceInReply = reply.includes(expectedPrice) || reply.includes(expectedPrice.replace('.', ','));
      ok(`Recommended ${firstRealRec} uses real backend price ($${expectedPrice})`, priceInReply, 'see above', `$${expectedPrice}`);
    }
  } catch (e) {
    ok('Penny stock AI call', false, e.message, 'response');
  }
} else {
  console.log('  Skipping penny validation — no live gainer data');
}

// ── SECTION 5: LANGUAGE STRESS TEST ───────────────────────────────────────────

section('ROUND 2 — TEST 5: LANGUAGE STRESS (same stock, same data, two languages)');

try {
  const rxtRes = await bget('/api/quote/RXT');
  const rxt = rxtRes.ticker ? mapSnap(rxtRes.ticker) : null;

  if (rxt && rxt.price > 0) {
    const rxtSys = stockPrompt(rxt);
    const rxtPriceStr = Number(rxt.price).toFixed(2);

    console.log(`\n  RXT live price: $${rxtPriceStr}`);
    console.log('  Sending English question...');
    const engReply = await ai(rxtSys, [{ role: 'user', content: 'what do you think about RXT right now?' }]);
    console.log(`  ENG: "${engReply.slice(0, 200)}..."`);

    console.log('\n  Sending Spanish question...');
    const espReply = await ai(rxtSys, [{ role: 'user', content: 'RXT vale la pena o mejor espero?' }]);
    console.log(`  ESP: "${espReply.slice(0, 200)}..."`);

    const engHasPrice = engReply.includes(rxtPriceStr) || engReply.includes(rxtPriceStr.replace('.', ','));
    const espHasPrice = espReply.includes(rxtPriceStr) || espReply.includes(rxtPriceStr.replace('.', ','));

    const engSpanishWords = /\b(los|las|hoy|precio|acciones|sube|baja|está|para|que)\b/i;
    // Allow universal financial field labels (Price, Vol, Open, High, Low, VWAP appear in FORMAT 2 even in Spanish)
    const espEnglishWords = /\b(the|this|today|buy|sell|I think|right now|currently)\b/i;

    ok('English reply contains real RXT price', engHasPrice, engReply.slice(0,80), `$${rxtPriceStr}`);
    ok('English reply has no Spanish mixing', !engSpanishWords.test(engReply), engReply.slice(0,80), 'no Spanish');
    ok('Spanish reply contains real RXT price', espHasPrice, espReply.slice(0,80), `$${rxtPriceStr}`);
    ok('Spanish reply has no English mixing', !espEnglishWords.test(espReply), espReply.slice(0,80), 'no English');
    ok('Both replies use SAME real price', engHasPrice && espHasPrice, `eng=${engHasPrice} esp=${espHasPrice}`, 'both true');
  } else {
    console.log('  Skipping — RXT data unavailable');
  }
} catch (e) {
  ok('Language stress RXT call', false, e.message, 'response');
}

// ── SECTION 6: MASTER WATCHLIST BATCH AUDIT ───────────────────────────────────

section('ROUND 2 — TEST 6: MASTER WATCHLIST BATCH AUDIT (all tickers)');

const MASTER_WATCHLIST = [
  'AAPL','MSFT','NVDA','AMD','GOOGL','META','AMZN','NFLX','INTC','QCOM','TXN','AVGO','MU','AMAT','LRCX','KLAC','MRVL','ARM','SMCI','ADBE','INTU',
  'CRM','ORCL','NOW','WDAY','TEAM','ZM','DOCU','TWLO','SHOP','SNOW','DDOG','NET','CRWD','ZS','OKTA','PANW','FTNT','MDB','CFLT','GTLB','HUBS','VEEV','FRSH','BILL','BRZE','TTD','PSTG','NTAP','WDC','STX','DELL','HPQ','HPE','S','MNDY','SEMR','CWAN',
  'SQ','PYPL','COIN','MSTR','RIOT','MARA','HUT','CLSK','IREN',
  'PLTR','SOUN','BBAI','GFAI','PATH','IONQ','QUBT','RGTI','AIXI',
  'AAOI','VIAV','INFN','CIEN','LITE','COHR','LPTH','KOPN',
  'MRNA','PFE','JNJ','ABBV','BMY','LLY','AMGN','GILD','BIIB','VRTX','REGN','ILMN','ABT','UNH','CVS','BNTX',
  'ALNY','BMRN','IONS','EXEL','HALO','ACAD','SAGE','ITCI','AXSM','INVA','PRGO','AGEN','IMVT','KPTI','XNCR','ALKS','INCY','JAZZ','HZNP','SPPI','AGIO','ARWR','EXAS','KYMR','VERV','PRAX','PRVA','RCUS','ACMR','NBIX','PTGX','MRTX','ADPT','ROIV','LEGN','ANAB','CLDX','RVMD',
  'CRSP','BEAM','EDIT','NTLA','PACB','VCYT','NTRA','MRUS','FATE',
  'XOM','CVX','COP','EOG','PXD','DVN','FANG','MRO','APA','OXY','HES','SLB','HAL','RIG','AR','EQT','CNX',
  'VLO','MPC','PSX','DK','PARR','CLMT','DINO','TRGP','ALTM','KNTK','ET','KMI','WMB','OKE','MMP',
  'ESTE','MTDR','CIVI','CPE','BATL','REI','GPOR','SM','CRGY','NOG','VTLE','CDEV',
  'BTU','ARCH','AMR','CEIX','HCC','METC','ARLP','NRP',
  'JPM','BAC','WFC','GS','MS','C','BLK','SCHW','COF','AXP','V','MA','ICE','CME','CBOE','NDAQ','SPGI','MCO','MSCI','FIS','FISV','GPN','BR',
  'AFRM','SOFI','UPST','LC','FICO','SLM','HOOD','NU',
  'NMIH','ESNT','MGIC','RDN','PFSI','UWMC','RKT','GHLD','LDI','COOP','TWO','MFA','AGNC','NLY','RITM','PMT','CHMI','BXMT',
  'WMT','TGT','COST','HD','LOW','TJX','ROST','BURL','M','KSS','JWN','GPS','ANF','AEO','URBN','BOOT','DKS','FL','BGFV','SPWH','ASO','LESL','POOL','SBH','ULTA','ELF','COTY','CHWY','ETSY','EBAY','RVLV','W','OLLI','FIVE','DLTR','DG',
  'GME','AMC','DIS','DASH','ABNB','DKNG','PENN','MGM','LYFT','UBER','PTON','BYND','RBLX','SNAP','PINS','PET','BARK','WOOF','ZTS','IDXX',
  'TSLA','RIVN','LCID','GOEV','RIDE','FFIE','MULN','SOLO','AYRO','ZEV','HYZN','IDEX','EVGO','CHPT','BLNK','WKHS','NKLA','PTRA','HYLN','NIO','XPEV','LI','GM','F','STLA',
  'NEM','GOLD','AEM','FCX','AA','ALB','MP','LTHM','LAC','SQM','HL','AG','CDE','PAAS','EXK','WPM',
  'TLRY','CRON','ACB','CGC','OGI','GRWG','IIPR','MAPS','SNDL','HEXO','VFF','CURLF','TCNNF','GABY',
  'BA','LMT','RTX','NOC','GE','CAT','HON','MMM','DE','LIN','APD','EMR','ITW',
  'T','VZ','TMUS','PARA','WBD','CMCSA',
  'ENPH','FSLR','RUN','NEE','PLUG','BLDP','FCEL','BE',
  'USB','PNC','TFC','MTB','FITB','HBAN','KEY','RF','CFG','ZION',
  'AMT','PLD','SPG','O','VICI','WELL','EQR','AVB','PSA','EXR',
  'ROKU','TDOC','HIMS','SPCE','OPEN','LMND','JOBY','MTTR','RDFN','DBRX','APPS','ILUS','ADMA','AEVA','MIND',
  'SPY','QQQ','IWM','GLD','SLV','TLT','HYG','XLK','XLF','XLE','XLV','XLI','XLC','XLY','XLP','XLB','XLU','ARKK','ARKG','ARKW','ARKF',
  'NAKD','EXPR','KOSS','CTRM','NAT','ZIM','EGLE','GOGL','SB','TOPS','FREE','MARK','XTIA','XELA','GOVX','OGEN','CBAT','BEEM','CLPS','KERN','HITI','CVLY',
];

console.log(`  Total tickers to audit: ${MASTER_WATCHLIST.length}`);

// Split into batches of 100
function chunks(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const batches = chunks(MASTER_WATCHLIST, 100);
console.log(`  Fetching in ${batches.length} batches of ~100...`);

const validTickers   = [];
const invalidTickers = [];  // price=0 or no volume
const errorTickers   = [];  // 502/404

for (let b = 0; b < batches.length; b++) {
  const batch = batches[b];
  process.stdout.write(`  Batch ${b + 1}/${batches.length} (${batch.length} tickers)... `);
  try {
    const res = await bget(`/api/batch?tickers=${encodeURIComponent(batch.join(','))}`);
    const returned = res.tickers || [];
    const snapMap = {};
    returned.forEach(t => { snapMap[t.ticker] = mapSnap(t); });

    for (const t of batch) {
      const snap = snapMap[t];
      if (!snap) {
        // Not returned by Polygon — either delisted or no data
        invalidTickers.push({ ticker: t, reason: 'not returned by Polygon' });
        continue;
      }
      const p = Number(snap.price);
      const v = Number(snap.volume);
      if (p < 0.001) {
        invalidTickers.push({ ticker: t, reason: `price=$${p}` });
      } else if (v === 0) {
        invalidTickers.push({ ticker: t, reason: 'volume=0 (no trading)' });
      } else {
        validTickers.push({ ticker: t, price: p, pct: Number(snap.changePercent), vol: v });
      }
    }
    console.log(`done (${returned.length} returned)`);
  } catch (e) {
    console.log(`ERROR: ${e.message}`);
    batch.forEach(t => errorTickers.push({ ticker: t, reason: e.message }));
  }
}

const totalInvalid = invalidTickers.length + errorTickers.length;
const accuracy = validTickers.length / MASTER_WATCHLIST.length * 100;

console.log(`\n  ┌─────────────────────────────────────────┐`);
console.log(`  │  WATCHLIST AUDIT RESULTS                │`);
console.log(`  │  Total audited:  ${String(MASTER_WATCHLIST.length).padStart(4)} tickers           │`);
console.log(`  │  ✅ Valid:        ${String(validTickers.length).padStart(4)} (real price+volume)   │`);
console.log(`  │  ❌ Invalid:      ${String(invalidTickers.length).padStart(4)} (zero price/volume)  │`);
console.log(`  │  ⚠️  Errors:       ${String(errorTickers.length).padStart(4)} (API errors)         │`);
console.log(`  │  Price accuracy: ${accuracy.toFixed(1).padStart(5)}%                    │`);
console.log(`  └─────────────────────────────────────────┘`);

if (invalidTickers.length > 0) {
  console.log('\n  Invalid tickers (zero/missing data):');
  invalidTickers.forEach(t => console.log(`    ${t.ticker.padEnd(8)} — ${t.reason}`));
}
if (errorTickers.length > 0) {
  console.log('\n  Error tickers:');
  errorTickers.forEach(t => console.log(`    ${t.ticker.padEnd(8)} — ${t.reason}`));
}

// Tickers to remove: those consistently invalid (not just "no volume today")
const toRemove = [
  ...invalidTickers.filter(t => t.reason === 'not returned by Polygon').map(t => t.ticker),
  ...errorTickers.map(t => t.ticker),
];

console.log(`\n  Tickers to REMOVE from MASTER_WATCHLIST: ${toRemove.length}`);
if (toRemove.length > 0) {
  console.log(`  ${toRemove.join(', ')}`);
}

// Save audit report
const report = {
  date: new Date().toISOString(),
  total: MASTER_WATCHLIST.length,
  valid: validTickers.length,
  invalid: invalidTickers.length,
  errors: errorTickers.length,
  accuracy: accuracy.toFixed(1) + '%',
  toRemove,
  invalidList: invalidTickers,
  errorList: errorTickers,
  validSample: validTickers.slice(0, 20),
};
writeFileSync('./watchlist_audit.json', JSON.stringify(report, null, 2));
console.log('  Audit saved → watchlist_audit.json');

ok('Master watchlist data accuracy >= 60%', accuracy >= 60, `${accuracy.toFixed(1)}%`, '>= 60%');
ok('No catastrophic batch errors (all batches fetched)', errorTickers.length < MASTER_WATCHLIST.length * 0.1, errorTickers.length, '< 10% errors');

// ── FINAL SUMMARY ──────────────────────────────────────────────────────────────

section('FINAL SUMMARY');
console.log(`  PASSED:  ${passed}`);
console.log(`  FAILED:  ${failed}`);
console.log(`  TOTAL:   ${passed + failed}`);
if (failures.length > 0) {
  console.log('\n  FAILURES:');
  failures.forEach(f => console.log(`    ❌ ${f}`));
}
console.log('');
process.exit(failed > 0 ? 1 : 0);
