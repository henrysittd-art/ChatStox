// Heating Up detection logic test
// Run: node test_heating_up.mjs

// ── Mirror helpers from HomeScreen.js ─────────────────────────────────────────

function isRunnerCriteria(s) {
  const pct     = Number(s.changePercent);
  const vol     = Number(s.volume);
  const prevVol = Number(s.previousVolume) || 0;
  const rvol    = prevVol > 0 ? vol / prevVol : 0;
  return (pct > 20 && vol > 500_000) || (pct > 10 && rvol > 3) || pct > 50;
}

function detectHeatingUp(stocks) {
  return stocks
    .filter(s => {
      const pct     = Number(s.changePercent);
      const vol     = Number(s.volume);
      const prevVol = Number(s.previousVolume) || 0;
      const rvol    = prevVol > 0 ? vol / prevVol : 0;
      const price   = Number(s.price);
      const vwap    = Number(s.vwap);

      const inPctRange     = pct >= 3 && pct < 20;
      const rvolInRange    = rvol >= 1.5 && rvol <= 5;
      const aboveVwap      = vwap > 0 && price > vwap;
      const volumeBuilding = prevVol > 0 && vol > prevVol * 0.5;
      const notRunner      = !isRunnerCriteria(s);

      return inPctRange && rvolInRange && aboveVwap && volumeBuilding && notRunner;
    })
    .sort((a, b) => {
      const pvA  = Number(a.previousVolume) || 0;
      const pvB  = Number(b.previousVolume) || 0;
      const rvA  = pvA > 0 ? Number(a.volume) / pvA : 0;
      const rvB  = pvB > 0 ? Number(b.volume) / pvB : 0;
      return (Number(b.changePercent) * rvB) - (Number(a.changePercent) * rvA);
    })
    .slice(0, 10);
}

// ── Helpers ────────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function check(label, condition) {
  if (condition) { console.log(`  ✅ ${label}`); passed++; }
  else           { console.log(`  ❌ ${label}`); failed++; }
}

// stock factory — all valid by default, override fields as needed
function mk(ticker, overrides = {}) {
  return {
    ticker,
    changePercent: 8,
    volume:        1_200_000,
    previousVolume: 700_000,   // rvol ≈ 1.71x
    price:         20,
    vwap:          18,          // price (20) > vwap (18) → above VWAP
    ...overrides,
  };
}

console.log('\n=== Heating Up Detection Tests ===\n');

// ── Test 1: Core qualifying stock ─────────────────────────────────────────────
console.log('Test 1 — Valid qualifying stock:');
const t1 = detectHeatingUp([mk('HEAT')]);
check('HEAT qualifies with all criteria met', t1[0]?.ticker === 'HEAT');

// ── Test 2: pct range boundaries ─────────────────────────────────────────────
console.log('\nTest 2 — changePercent boundaries:');
check('3.0% qualifies (lower bound)',    detectHeatingUp([mk('A', { changePercent: 3.0 })]).length === 1);
check('2.99% excluded (below lower)',   detectHeatingUp([mk('B', { changePercent: 2.99 })]).length === 0);
check('19.99% qualifies (just below 20%)', detectHeatingUp([mk('C', { changePercent: 19.99 })]).length === 1);
check('20.0% excluded (runner threshold)', detectHeatingUp([mk('D', { changePercent: 20.0 })]).length === 0);

// ── Test 3: RVOL boundaries ────────────────────────────────────────────────────
console.log('\nTest 3 — RVOL boundaries:');
// rvol = 1.5x → vol = prevVol * 1.5
const rv1_5 = mk('E', { volume: 1_050_000, previousVolume: 700_000 });  // 1.5x
const rv1_4 = mk('F', { volume:   980_000, previousVolume: 700_000 });  // 1.4x
const rv5_0 = mk('G', { volume: 3_500_000, previousVolume: 700_000 });  // 5.0x
const rv5_1 = mk('H', { volume: 3_570_001, previousVolume: 700_000 });  // 5.1x
check('RVOL 1.5x qualifies (lower bound)',   detectHeatingUp([rv1_5]).length === 1);
check('RVOL 1.4x excluded (below 1.5x)',     detectHeatingUp([rv1_4]).length === 0);
check('RVOL 5.0x qualifies (upper bound)',   detectHeatingUp([rv5_0]).length === 1);
check('RVOL 5.1x excluded (above 5x)',       detectHeatingUp([rv5_1]).length === 0);

// ── Test 4: VWAP filter ────────────────────────────────────────────────────────
console.log('\nTest 4 — Price vs VWAP:');
check('price > vwap qualifies',  detectHeatingUp([mk('I', { price: 25, vwap: 22 })]).length === 1);
check('price = vwap excluded',   detectHeatingUp([mk('J', { price: 22, vwap: 22 })]).length === 0);
check('price < vwap excluded',   detectHeatingUp([mk('K', { price: 19, vwap: 22 })]).length === 0);
check('vwap = 0 excluded (no data)', detectHeatingUp([mk('L', { vwap: 0 })]).length === 0);

// ── Test 5: Volume building filter ────────────────────────────────────────────
console.log('\nTest 5 — Volume building (vol > 50% of prevVol):');
// Note: RVOL >= 1.5x always implies vol >= 1.5 * prevVol > 0.5 * prevVol, so
// rvolInRange and volumeBuilding cannot fail independently when prevVol > 0.
// The volumeBuilding criterion's independent role is to gate out stocks with no
// historical volume data (prevVol = 0), which RVOL can't detect (it falls back to 0).
check('RVOL 1.5x inherently satisfies vol > 50% ADV (1.5 > 0.5)',
  detectHeatingUp([mk('M', { volume: 1_050_000, previousVolume: 700_000 })]).length === 1);
check('vol = 349K < 50% of 700K excluded (also fails RVOL < 1.5x)',
  detectHeatingUp([mk('N', { volume: 349_000, previousVolume: 700_000 })]).length === 0);
check('prevVol = 0 excluded by volumeBuilding guard (RVOL would be 0)',
  detectHeatingUp([mk('O', { previousVolume: 0 })]).length === 0);

// ── Test 6: Runner exclusion ────────────────────────────────────────────────────
console.log('\nTest 6 — Runner exclusion:');
// strongMomentum runner: pct > 20 AND vol > 500K — but pct > 20 already excludes from Heating Up
// We test the RVOL runner case: pct > 10 AND rvol > 3x, where pct is still < 20
// (this is a stock that qualifies for Runners via RVOL but not % — still in 10-20% range)
const rvolRunner = mk('RVOLR', {
  changePercent: 15,            // 3% ≤ pct < 20% → would pass pct range
  volume: 2_500_000,
  previousVolume: 700_000,      // rvol = 3.57x > 3 → isRunnerCriteria = true
  price: 20, vwap: 18,
});
check('RVOL-runner (pct=15%, rvol=3.57x) excluded from Heating Up', detectHeatingUp([rvolRunner]).length === 0);

// extremeMover runner: pct > 50
const extremeRunner = mk('EXTR', { changePercent: 55, volume: 300_000, previousVolume: 200_000 });
check('Extreme runner (pct=55%) excluded', detectHeatingUp([extremeRunner]).length === 0);

// Non-runner in same pct range: pct=15%, rvol=2x (< 3x) → NOT a runner, qualifies for Heating Up
const nonRunner = mk('SAFE', {
  changePercent: 15,
  volume: 1_400_000,
  previousVolume: 700_000,   // rvol = 2.0x → not a runner
  price: 20, vwap: 18,
});
check('Non-runner (pct=15%, rvol=2x) appears in Heating Up', detectHeatingUp([nonRunner]).length === 1);

// ── Test 7: Empty input ────────────────────────────────────────────────────────
console.log('\nTest 7 — Empty / no qualifiers:');
check('Empty input → empty output', detectHeatingUp([]).length === 0);
const noMatch = mk('COLD', { changePercent: 1 }); // below 3%
check('No qualifiers → empty output (section hides)', detectHeatingUp([noMatch]).length === 0);

// ── Test 8: Sort order (score = pct × RVOL) ───────────────────────────────────
console.log('\nTest 8 — Sort order: score = changePercent × RVOL (highest first):');
const stockA = mk('HIGH', { changePercent: 18, volume: 2_000_000, previousVolume: 700_000 }); // pct=18, rvol=2.86 → score=51.4
const stockB = mk('LOW',  { changePercent: 5,  volume: 1_050_000, previousVolume: 700_000 }); // pct=5,  rvol=1.5  → score=7.5
const sorted = detectHeatingUp([stockB, stockA]); // pass LOW first to ensure sort matters
check('HIGH-score stock (pct=18%, rvol=2.86x) is first', sorted[0]?.ticker === 'HIGH');
check('LOW-score stock (pct=5%, rvol=1.5x) is second',   sorted[1]?.ticker === 'LOW');

const scoreHigh = 18 * (2_000_000 / 700_000);
const scoreLow  = 5  * (1_050_000 / 700_000);
check(`Score HIGH (${scoreHigh.toFixed(1)}) > Score LOW (${scoreLow.toFixed(1)})`, scoreHigh > scoreLow);

// ── Test 9: 10-card cap ────────────────────────────────────────────────────────
console.log('\nTest 9 — 10-card cap:');
const manyStocks = Array.from({ length: 15 }, (_, i) =>
  mk(`S${i}`, { changePercent: 5 + i * 0.1 })
);
const capped = detectHeatingUp(manyStocks);
check('Capped at 10 cards even with 15 qualifiers', capped.length === 10);

// ── Test 10: isRunnerCriteria helper ─────────────────────────────────────────
console.log('\nTest 10 — isRunnerCriteria helper:');
check('pct=25%, vol=600K → runner (strongMomentum)',         isRunnerCriteria(mk('R1', { changePercent: 25, volume: 600_000, previousVolume: 300_000 })));
check('pct=11%, rvol=3.5x → runner (unusualVolSpike)',       isRunnerCriteria(mk('R2', { changePercent: 11, volume: 2_450_000, previousVolume: 700_000 })));
check('pct=60% → runner (extremeMover)',                     isRunnerCriteria(mk('R3', { changePercent: 60, volume: 100_000, previousVolume: 50_000 })));
check('pct=15%, rvol=2x → NOT a runner',                    !isRunnerCriteria(mk('NR', { changePercent: 15, volume: 1_400_000, previousVolume: 700_000 })));

// ── Summary ────────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed === 0) { console.log('All tests passed ✅'); }
else { console.log(`${failed} test(s) failed ❌`); process.exit(1); }
