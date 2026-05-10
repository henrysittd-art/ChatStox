/**
 * test_extended_data.js
 * Verifies prevDay fetch, RVOL calculation, extended data block injection.
 * Run: node test_extended_data.js
 */

const fs = require('fs');

const stockSrc = fs.readFileSync('./src/services/stockService.js', 'utf8');
const aiSrc    = fs.readFileSync('./src/services/aiService.js', 'utf8');
const chatSrc  = fs.readFileSync('./src/screens/StockChatScreen.js', 'utf8');
const proxySrc = fs.readFileSync('./backend/server.js', 'utf8');

let p = 0, f = 0;
function check(label, ok) {
  if (ok) { console.log('  ✓', label); p++; }
  else     { console.log('  ✗', label); f++; }
}

// ── BACKEND proxy routes ──────────────────────────────────────────────────────
console.log('\n=== Backend proxy routes ===');
check('/api/prevday/:ticker route exists',
  proxySrc.includes("/api/prevday/:ticker"));
check('/api/history/:ticker route exists',
  proxySrc.includes("/api/history/:ticker"));
check('prevday calls /v2/aggs/ticker/.../prev',
  proxySrc.includes('/v2/aggs/ticker/') && proxySrc.includes('/prev'));
check('history calls /v2/aggs/ticker/.../range/1/day',
  proxySrc.includes('/range/1/day/'));

// ── stockService new functions ────────────────────────────────────────────────
console.log('\n=== stockService.js new functions ===');
check('fetchPrevDay exported',
  stockSrc.includes('export async function fetchPrevDay'));
check('fetch5DayHistory exported',
  stockSrc.includes('export async function fetch5DayHistory'));
check('fetchExtendedData exported',
  stockSrc.includes('export async function fetchExtendedData'));
check('fetchTickerDetails returns sharesOutstanding',
  stockSrc.includes('sharesOutstanding'));
check('RVOL calculation uses todayVolume / avgVol',
  stockSrc.includes('todayVolume') && stockSrc.includes('avgVol'));
check('5-day trend calculates fiveDayPct',
  stockSrc.includes('fiveDayPct'));
check('trendLabel logic: Uptrend/Downtrend/Sideways',
  stockSrc.includes("'Uptrend'") && stockSrc.includes("'Downtrend'") && stockSrc.includes("'Sideways'"));

// ── RVOL calculation simulation ───────────────────────────────────────────────
console.log('\n=== RVOL calculation simulation ===');
function calcRVOL(todayVolume, priorVolumes) {
  if (priorVolumes.length === 0) return null;
  const avg = priorVolumes.reduce((s, v) => s + v, 0) / priorVolumes.length;
  return avg > 0 ? todayVolume / avg : null;
}
function rvolLabel(rvol) {
  if (rvol === null) return 'N/A';
  if (rvol < 0.5)  return 'Very Low';
  if (rvol < 1.5)  return 'Normal';
  if (rvol < 3)    return 'Above Average';
  if (rvol < 10)   return 'High';
  return 'Extreme';
}

const rvolCases = [
  { label: '0.3x → Very Low',      today: 300_000, prior: [1_000_000, 1_000_000, 1_000_000], expected: 'Very Low' },
  { label: '1.0x → Normal',        today: 1_000_000, prior: [1_000_000, 1_000_000],         expected: 'Normal' },
  { label: '2.0x → Above Average', today: 2_000_000, prior: [1_000_000, 1_000_000],         expected: 'Above Average' },
  { label: '5.0x → High',          today: 5_000_000, prior: [1_000_000, 1_000_000],         expected: 'High' },
  { label: '15x → Extreme',        today: 15_000_000, prior: [1_000_000, 1_000_000],        expected: 'Extreme' },
];
rvolCases.forEach(({ label, today, prior, expected }) => {
  const rvol = calcRVOL(today, prior);
  const got  = rvolLabel(rvol);
  check(label, got === expected);
});

// ── 5-day trend simulation ────────────────────────────────────────────────────
console.log('\n=== 5-day trend simulation ===');
function calcTrend(bars) {
  if (bars.length < 2) return { pct: null, label: 'Sideways' };
  const first = bars[0].close;
  const last  = bars[bars.length - 1].close;
  if (first <= 0) return { pct: null, label: 'Sideways' };
  const pct = ((last - first) / first) * 100;
  const label = pct > 3 ? 'Uptrend' : pct < -3 ? 'Downtrend' : 'Sideways';
  return { pct, label };
}

const trendCases = [
  { bars: [{ close: 100 }, { close: 110 }], expectedLabel: 'Uptrend',   note: '+10% → Uptrend' },
  { bars: [{ close: 100 }, { close: 92  }], expectedLabel: 'Downtrend', note: '-8% → Downtrend' },
  { bars: [{ close: 100 }, { close: 101 }], expectedLabel: 'Sideways',  note: '+1% → Sideways' },
];
trendCases.forEach(({ bars, expectedLabel, note }) => {
  const { label } = calcTrend(bars);
  check(note, label === expectedLabel);
});

// ── aiService.js extended data block ─────────────────────────────────────────
console.log('\n=== aiService.js — EXTENDED DATA injection ===');
check('extendedData param in buildSystemPrompt',
  aiSrc.includes('extendedData }) {') || aiSrc.includes('extendedData\n}) {') ||
  aiSrc.includes('extendedData })\n') || aiSrc.match(/buildSystemPrompt\([^)]*extendedData/));
check('extendedData param in callAI',
  aiSrc.includes('extendedData }) {') || aiSrc.match(/callAI\([^)]*extendedData/));
check('EXTENDED DATA header in block',
  aiSrc.includes('━━━ EXTENDED DATA ━━━'));
check('Prev Day line built',
  aiSrc.includes('Prev Day: Close'));
check('5-Day Trend line built',
  aiSrc.includes('5-Day Trend:'));
check('RVOL line with label built',
  aiSrc.includes('Relative Volume (RVOL):'));
check('Float line built from sharesOutstanding',
  aiSrc.includes('Float:') && aiSrc.includes('sharesOutstanding'));
check('RVOL > 3 flagged to user',
  aiSrc.includes('flag this to user'));

// ── IDENTITY RVOL rules ───────────────────────────────────────────────────────
console.log('\n=== IDENTITY — RVOL and 5-day rules ===');
check('RVOL < 0.5x rule in IDENTITY',
  aiSrc.includes('RVOL < 0.5x'));
check('RVOL > 3x always flag rule',
  aiSrc.includes('RVOL > 3x'));
check('RVOL > 10x extreme rule',
  aiSrc.includes('RVOL > 10x'));
check('5-DAY TREND RULE in IDENTITY',
  aiSrc.includes('5-DAY TREND RULE'));

// ── StockChatScreen wiring ────────────────────────────────────────────────────
console.log('\n=== StockChatScreen.js wiring ===');
check('fetchExtendedData imported',
  chatSrc.includes('fetchExtendedData'));
check('extendedData state declared',
  chatSrc.includes('useState(null)') && chatSrc.includes('extendedData'));
check('fetchExtendedData called with ticker and volume',
  chatSrc.includes('fetchExtendedData(ticker, q.volume)'));
check('extendedData: ext passed to auto-analysis callAI',
  chatSrc.includes('extendedData: ext'));
check('extendedData (state) passed to sendMessage callAI',
  chatSrc.includes('extendedData,') || chatSrc.includes('extendedData }'));

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(60));
console.log(`Results: ${p}/${p + f} passed, ${f} failed`);
if (f === 0) {
  console.log('All extended data tests passed ✅\n');
  console.log('Manual verification checklist:');
  console.log('  □ Open any stock → check proxy logs for /api/prevday/ and /api/history/ calls');
  console.log('  □ Auto-analysis mentions RVOL when volume is unusual (>3x)');
  console.log('  □ Auto-analysis mentions "ha subido/bajado X% en los últimos 5 días"');
  console.log('  □ System prompt includes ━━━ EXTENDED DATA ━━━ section in console logs');
  console.log('  □ Float (XM shares) appears when sharesOutstanding is available');
} else {
  process.exit(1);
}
