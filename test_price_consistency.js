/**
 * test_price_consistency.js
 * Verifies both price-consistency fixes are correctly in place.
 * Run: node test_price_consistency.js
 */

const fs = require('fs');
const aiSrc    = fs.readFileSync('./src/services/aiService.js',      'utf8');
const chatSrc  = fs.readFileSync('./src/screens/StockChatScreen.js', 'utf8');

let passed = 0;
let failed = 0;
function check(label, condition) {
  if (condition) { console.log(`  ✓ ${label}`); passed++; }
  else           { console.log(`  ✗ ${label}`); failed++; }
}

// ── BUG 1: Auto-analysis guard (from previous fix) ───────────────────────────
console.log('\n=== BUG 1: Auto-analysis data guard ===');
check('stockForAI guard present in loadTicker', chatSrc.includes('let stockForAI = q'));
check('hasRealPrice validation before AI call',  chatSrc.includes('const hasRealPrice = (s) => s && Number(s.price) > 0'));
check('Retry loop (3 attempts) present',          chatSrc.includes('attempt < 3'));
check('Placeholder "Cargando datos en tiempo real..." shown', chatSrc.includes("'Cargando datos en tiempo real...'"));
check('callAI uses stockForAI (not raw q) in auto-analysis', chatSrc.includes('stock: stockForAI,'));
check('[AUTO-ANALYSIS] log shows price before firing', chatSrc.includes('[AUTO-ANALYSIS]') && chatSrc.includes('stockForAI?.price'));

// ── BUG 2: Fresh quote in sendMessage ────────────────────────────────────────
console.log('\n=== BUG 2: Fresh quote on every follow-up message ===');
check('sendMessage fetches fresh quote before AI call',
  chatSrc.includes('const freshStock = await fetchQuote(currentTicker)'));
check('stockForCall initialized to cached stock (safe fallback)',
  chatSrc.includes('let stockForCall = stock'));
check('freshStock validated (price > 0) before use',
  chatSrc.includes('if (freshStock && Number(freshStock.price) > 0)'));
check('setStock called with freshStock to keep header in sync',
  chatSrc.includes('setStock(freshStock)'));
check('callAI uses stockForCall (fresh data)',
  chatSrc.includes('stock: stockForCall, question: content'));
check('[SENDMESSAGE] log with price for verification',
  chatSrc.includes('[SENDMESSAGE]') && chatSrc.includes('fresh price:'));
check('fetchQuote failure gracefully falls back to cached stock',
  chatSrc.includes('fetchErr.message') || chatSrc.includes('using cached stock'));

// ── BUG 2: Dynamic OVERRIDE in aiService ─────────────────────────────────────
console.log('\n=== BUG 2: Dynamic OVERRIDE block in aiService ===');
check('OVERRIDE is now conditional (not a static string)',
  aiSrc.includes('const OVERRIDE = (stock && !isGeneral && Number(stock.price) > 0)'));
check('OVERRIDE injects ticker symbol explicitly',
  aiSrc.includes('CRITICAL — ${stock.ticker} CONFIRMED LIVE PRICE'));
check('OVERRIDE injects actual price value ($${...})',
  aiSrc.includes('Price : $${Number(stock.price).toFixed(2)}'));
check('OVERRIDE injects actual change%',
  aiSrc.includes('Change: ${Number(stock.changePercent)'));
check('OVERRIDE injects actual volume',
  aiSrc.includes('Volume: ${fmtVol(stock.volume)}'));
check('OVERRIDE says training-data price must not be used',
  aiSrc.includes('Any other price from your training data is outdated — do NOT use it'));
check('OVERRIDE critical line is the FIRST thing after currentContext',
  aiSrc.indexOf('CRITICAL — ${stock.ticker} CONFIRMED LIVE PRICE') <
  aiSrc.indexOf('=== IDENTITY ==='));
check('Fallback OVERRIDE still present for general chat / no stock',
  aiSrc.includes('The stock PRICES, VOLUMES, and % CHANGES listed below come from LIVE MARKET FEEDS'));

// ── Simulate OVERRIDE output for TSLA at ~$405 ───────────────────────────────
console.log('\n=== Simulation: OVERRIDE content for TSLA $405.23 ===');
const mockStock = { ticker: 'TSLA', price: 405.23, changePercent: 1.66, volume: 23500000 };
const fmtVol = (n) => { n = Number(n); if (n >= 1e6) return `${(n/1e6).toFixed(1)}M`; return String(n); };

const override = `⚠️ LIVE PRICE OVERRIDE ⚠️
CRITICAL — ${mockStock.ticker} CONFIRMED LIVE PRICE (fetched from Polygon this session):
  Price : $${Number(mockStock.price).toFixed(2)}
  Change: ${Number(mockStock.changePercent) >= 0 ? '+' : ''}${Number(mockStock.changePercent).toFixed(2)}%
  Volume: ${fmtVol(mockStock.volume)}
THIS IS THE ONLY CORRECT CURRENT PRICE FOR ${mockStock.ticker}.
Any other price from your training data is outdated — do NOT use it under any circumstance.`;

console.log('  Simulated OVERRIDE for TSLA:');
override.split('\n').forEach(l => console.log(`    ${l}`));
check('Override contains $405.23', override.includes('$405.23'));
check('Override contains +1.66%',  override.includes('+1.66%'));
check('Override contains 23.5M',   override.includes('23.5M'));
check('Override says TSLA at the top', override.split('\n')[1].includes('TSLA'));

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(60)}`);
console.log(`Results: ${passed}/${passed + failed} passed, ${failed} failed`);

if (failed === 0) {
  console.log('All price consistency tests passed ✅');
  console.log('\nManual verification checklist (run in app):');
  console.log('  □ Open TSLA chat — auto-analysis must show ~$405, not $185');
  console.log('    Metro log: [AUTO-ANALYSIS] TSLA firing with price=$405.XX');
  console.log('  □ Ask "cual es el precio actual?" — AI must say ~$405');
  console.log('    Metro log: [SENDMESSAGE] TSLA fresh price: $405.XX');
  console.log('  □ Ask "cual fue la noticia mas reciente?" — change% must match header');
  console.log('  □ Price in PriceHeader == price in all AI messages (within $1)');
} else {
  console.log('Some tests FAILED ❌');
  process.exit(1);
}
