/**
 * test_auto_analysis_guard.js
 * Verifies the auto-analysis data guard is correctly implemented in StockChatScreen.js.
 * Run: node test_auto_analysis_guard.js
 */

const fs = require('fs');
const src = fs.readFileSync('./src/screens/StockChatScreen.js', 'utf8');

let passed = 0;
let failed = 0;
function check(label, condition) {
  if (condition) { console.log(`  ✓ ${label}`); passed++; }
  else           { console.log(`  ✗ ${label}`); failed++; }
}

// ── TEST 1: Guard variables present ──────────────────────────────────────────
console.log('\n=== TEST 1: Guard variables present ===');
check('stockForAI variable declared', src.includes('let stockForAI = q'));
check('hasRealPrice helper declared', src.includes('const hasRealPrice = (s) => s && Number(s.price) > 0'));

// ── TEST 2: Price validation gate ────────────────────────────────────────────
console.log('\n=== TEST 2: Price validation gate ===');
check('Guard checks !hasRealPrice(stockForAI)', src.includes('if (!hasRealPrice(stockForAI))'));
check('Placeholder message "Cargando datos en tiempo real..."',
  src.includes("'Cargando datos en tiempo real...'"));
check('Placeholder shown in messages array with disclaimer',
  src.includes('buildDisclaimerMessage(),\n          {\n            role: \'assistant\',\n            content: \'Cargando datos en tiempo real...\'') ||
  src.includes("content: 'Cargando datos en tiempo real...'"));

// ── TEST 3: Retry loop ────────────────────────────────────────────────────────
console.log('\n=== TEST 3: Retry loop ===');
check('Retry loop iterates up to 3 attempts', src.includes('attempt < 3'));
check('Retry waits 2000ms between attempts', src.includes('setTimeout(r, 2000)'));
check('Retry calls fetchQuote(ticker)', src.includes('const refreshed = await fetchQuote(ticker)'));
check('Retry updates stockForAI on success', src.includes('stockForAI = refreshed'));
check('Retry updates setStock on success', src.includes('setStock(refreshed)'));
check('Retry breaks on first valid price', src.includes('break;'));
check('Retry checks loadingTickerRef guard (stale protection)',
  src.includes('if (loadingTickerRef.current !== ticker) return;'));

// ── TEST 4: AI call uses stockForAI not q ────────────────────────────────────
console.log('\n=== TEST 4: AI called with validated data ===');
// Find the auto-analysis callAI block
const autoAnalysisCallIdx = src.indexOf('stock: stockForAI,');
check('callAI uses stockForAI (validated data, not raw q)', autoAnalysisCallIdx !== -1);
check('callAI still passes isAutoAnalysis: true',
  src.slice(autoAnalysisCallIdx, autoAnalysisCallIdx + 320).includes('isAutoAnalysis: true'));

// ── TEST 5: Debug log present ─────────────────────────────────────────────────
console.log('\n=== TEST 5: Debug log for price verification ===');
check('[AUTO-ANALYSIS] console.log with price fields present',
  src.includes('[AUTO-ANALYSIS]') && src.includes('stockForAI?.price'));
check('Log includes open, high, low, vwap for full data verification',
  src.includes('stockForAI?.open') &&
  src.includes('stockForAI?.dayHigh') &&
  src.includes('stockForAI?.dayLow') &&
  src.includes('stockForAI?.vwap'));

// ── TEST 6: Simulate guard logic ──────────────────────────────────────────────
console.log('\n=== TEST 6: Guard logic simulation ===');

function hasRealPrice(s) { return s && Number(s.price) > 0; }

const scenarios = [
  { label: 'TSLA real data ($405)',    stock: { price: 405.23, open: 400.1, dayHigh: 410.5, dayLow: 399.0, vwap: 403.2 }, expectGuard: false },
  { label: 'price=0 (bad Polygon)',    stock: { price: 0, open: 0, dayHigh: 0, dayLow: 0, vwap: 0 },                    expectGuard: true  },
  { label: 'null quote',              stock: null,                                                                        expectGuard: true  },
  { label: 'price=NaN',              stock: { price: NaN, open: 400 },                                                   expectGuard: true  },
  { label: 'training-like $185.50',   stock: { price: 185.50, open: 184.0, dayHigh: 186.0, dayLow: 183.5, vwap: 185.0 }, expectGuard: false },
];

scenarios.forEach(({ label, stock, expectGuard }) => {
  const guarded = !hasRealPrice(stock);
  const ok = guarded === expectGuard;
  if (ok) { console.log(`  ✓ ${label} → guard ${guarded ? 'TRIGGERED' : 'skipped'} (correct)`); passed++; }
  else     { console.log(`  ✗ ${label} → got guard=${guarded}, expected=${expectGuard}`); failed++; }
});

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(60)}`);
console.log(`Results: ${passed}/${passed + failed} passed, ${failed} failed`);

if (failed === 0) {
  console.log('All auto-analysis guard tests passed ✅');
  console.log('\nManual verification checklist (run in app):');
  console.log('  □ Open TSLA chat for the first time');
  console.log('  □ Watch Metro logs for: [AUTO-ANALYSIS] TSLA firing with price=$XXX.XX');
  console.log('  □ Verify auto-analysis message shows ~$405 (today\'s real price)');
  console.log('  □ NOT $185.50 or any other training-data price');
  console.log('  □ If Polygon returns price=0: "Cargando datos en tiempo real..." appears first,');
  console.log('    then retries up to 3× before firing AI with valid data');
} else {
  console.log('Some tests FAILED ❌');
  process.exit(1);
}
