// Untradeable filter + momentum disclaimer tracking tests
// Run: node test_untradeable_filter.mjs

// ── Mirror isUntradeable from HomeScreen.js ────────────────────────────────────

function isUntradeable(s) {
  const ticker = (s.ticker || '').toUpperCase();
  const price  = Number(s.price)         || 0;
  const vol    = Number(s.volume)        || 0;
  const pct    = Number(s.changePercent) || 0;
  if (price > 0 && price < 0.01)                          return true; // sub-penny
  if (vol < 50_000)                                        return true; // too illiquid
  if (ticker.length > 5)                                   return true; // warrants/rights/special
  if (ticker.length >= 5 && ticker.endsWith('W'))          return true; // warrants (e.g. ACACW)
  if (ticker.length >= 5 && ticker.endsWith('R'))          return true; // rights (e.g. GLTAR)
  if (price < 0.05 && vol < 200_000)                      return true; // OTC illiquid
  if (pct > 500)                                           return true; // bad data
  return false;
}

// ── Mirror detectRunners (simplified, no HOD) ─────────────────────────────────

function isRunnerCriteria(s) {
  const pct     = Number(s.changePercent);
  const vol     = Number(s.volume);
  const prevVol = Number(s.previousVolume) || 0;
  const rvol    = prevVol > 0 ? vol / prevVol : 0;
  return (pct > 20 && vol > 500_000) || (pct > 10 && rvol > 3) || pct > 50;
}

function detectRunners(stocks) {
  return stocks.filter(s => {
    if (isUntradeable(s)) return false;
    const pct     = Number(s.changePercent);
    const vol     = Number(s.volume);
    const prevVol = Number(s.previousVolume) || 0;
    const rvol    = prevVol > 0 ? vol / prevVol : 0;
    return (pct > 20 && vol > 500_000) || (pct > 10 && rvol > 3) || pct > 50;
  });
}

function detectHeatingUp(stocks) {
  return stocks.filter(s => {
    if (isUntradeable(s)) return false;
    const pct     = Number(s.changePercent);
    const vol     = Number(s.volume);
    const prevVol = Number(s.previousVolume) || 0;
    const rvol    = prevVol > 0 ? vol / prevVol : 0;
    const price   = Number(s.price);
    const vwap    = Number(s.vwap);
    return (
      pct >= 3 && pct < 20 &&
      rvol >= 1.5 && rvol <= 5 &&
      vwap > 0 && price > vwap &&
      prevVol > 0 && vol > prevVol * 0.5 &&
      !isRunnerCriteria(s)
    );
  });
}

// ── Mirror goToMomentumStock from HomeScreen.js ───────────────────────────────

function makeGoToMomentumStock() {
  const seen = new Set();
  const navLog = [];
  function navigate(screen, params) { navLog.push({ screen, params }); }
  function go(ticker) {
    const showAlert = !seen.has(ticker);
    if (showAlert) seen.add(ticker);
    navigate('StockChat', { ticker, ...(showAlert && { momentumAlert: true }) });
  }
  return { go, navLog, seen };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

let passed = 0, failed = 0;
function check(label, cond) {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.log(`  ❌ ${label}`); failed++; }
}

function mkStock(overrides = {}) {
  return {
    ticker: 'TSLA', price: 30, changePercent: 25, volume: 2_000_000,
    previousVolume: 800_000, vwap: 28, dayHigh: 32,
    ...overrides,
  };
}

console.log('\n=== Untradeable Filter Tests ===\n');

// ── Sub-penny ─────────────────────────────────────────────────────────────────
console.log('Sub-penny (price < $0.01):');
check('price=$0.009 → untradeable',   isUntradeable(mkStock({ price: 0.009 })));
check('price=$0.01  → tradeable',     !isUntradeable(mkStock({ price: 0.01 })));
check('price=$0     → NOT sub-penny (no data)', !isUntradeable(mkStock({ price: 0, volume: 500_000 })));

// ── Low volume ────────────────────────────────────────────────────────────────
console.log('\nLow volume (< 50K):');
check('vol=49_999 → untradeable',     isUntradeable(mkStock({ volume: 49_999, price: 5 })));
check('vol=50_000 → tradeable',       !isUntradeable(mkStock({ volume: 50_000, price: 5 })));

// ── Ticker length > 5 ─────────────────────────────────────────────────────────
console.log('\nTicker length > 5:');
check('ABCDEF (6 chars) → untradeable', isUntradeable(mkStock({ ticker: 'ABCDEF', price: 5, volume: 500_000 })));
check('GOOGL (5 chars) → tradeable',    !isUntradeable(mkStock({ ticker: 'GOOGL', price: 150, volume: 20_000_000 })));
check('TSLA (4 chars) → tradeable',     !isUntradeable(mkStock({ ticker: 'TSLA', price: 250, volume: 50_000_000 })));

// ── Warrants (ends W) ─────────────────────────────────────────────────────────
console.log('\nWarrants (ticker ends W):');
check('AAPLW (5 chars, ends W) → untradeable',  isUntradeable(mkStock({ ticker: 'AAPLW', price: 2, volume: 500_000 })));
check('ACACW (5 chars, ends W) → untradeable',  isUntradeable(mkStock({ ticker: 'ACACW', price: 1, volume: 500_000 })));
check('AAPL  (4 chars) → tradeable',            !isUntradeable(mkStock({ ticker: 'AAPL', price: 180, volume: 50_000_000 })));
check('LOW   (3 chars, ends W) → tradeable',    !isUntradeable(mkStock({ ticker: 'LOW', price: 220, volume: 5_000_000 })));
check('SNOW  (4 chars, ends W) → tradeable',    !isUntradeable(mkStock({ ticker: 'SNOW', price: 140, volume: 8_000_000 })));

// ── Rights offerings (ends R) ─────────────────────────────────────────────────
console.log('\nRights offerings (ticker ends R):');
check('AAPLR (5 chars, ends R) → untradeable',  isUntradeable(mkStock({ ticker: 'AAPLR', price: 1, volume: 500_000 })));
check('GLTAR (5 chars, ends R) → untradeable',  isUntradeable(mkStock({ ticker: 'GLTAR', price: 0.5, volume: 200_000 })));
check('NVDA  (4 chars) → tradeable',            !isUntradeable(mkStock({ ticker: 'NVDA', price: 875, volume: 40_000_000 })));
check('MARA  (4 chars, ends A) → tradeable',    !isUntradeable(mkStock({ ticker: 'MARA', price: 20, volume: 30_000_000 })));

// ── OTC illiquid (price < $0.05 AND vol < 200K) ───────────────────────────────
console.log('\nOTC illiquid (price < $0.05 AND vol < 200K):');
check('price=$0.04, vol=150K → untradeable',
  isUntradeable(mkStock({ price: 0.04, volume: 150_000, previousVolume: 100_000 })));
check('price=$0.04, vol=200K → tradeable (vol at boundary)',
  !isUntradeable(mkStock({ price: 0.04, volume: 200_000, previousVolume: 150_000 })));
check('price=$0.05, vol=150K → tradeable (price at boundary)',
  !isUntradeable(mkStock({ price: 0.05, volume: 150_000, previousVolume: 100_000 })));

// ── Bad data (pct > 500%) ─────────────────────────────────────────────────────
console.log('\nBad data (changePercent > 500%):');
check('pct=501% → untradeable',  isUntradeable(mkStock({ changePercent: 501 })));
check('pct=500% → tradeable',    !isUntradeable(mkStock({ changePercent: 500 })));
check('pct=180% → tradeable',    !isUntradeable(mkStock({ changePercent: 180 })));

// ── Normal tradeable stock ────────────────────────────────────────────────────
console.log('\nNormal tradeable stocks pass through:');
const nvda = mkStock({ ticker: 'NVDA', price: 875, changePercent: 2, volume: 45_000_000, previousVolume: 40_000_000 });
const aapl = mkStock({ ticker: 'AAPL', price: 180, changePercent: 1.5, volume: 60_000_000, previousVolume: 55_000_000 });
check('NVDA → tradeable', !isUntradeable(nvda));
check('AAPL → tradeable', !isUntradeable(aapl));

// ── detectRunners excludes untradeable ────────────────────────────────────────
console.log('\ndetectRunners excludes untradeable:');

const goodRunner = mkStock({ ticker: 'SOFI', price: 16, changePercent: 35, volume: 10_000_000, previousVolume: 3_000_000 });
const subPenny   = mkStock({ ticker: 'XLOW', price: 0.005, changePercent: 80, volume: 5_000_000 });
const lowVol     = mkStock({ ticker: 'XTST', price: 5, changePercent: 60, volume: 30_000 });
const warrant    = mkStock({ ticker: 'MSTRW', price: 3, changePercent: 40, volume: 1_000_000 });
const badData    = mkStock({ ticker: 'PUMP', price: 1, changePercent: 600, volume: 2_000_000 });

check('Good runner qualifies',         detectRunners([goodRunner]).length === 1);
check('Sub-penny excluded',            detectRunners([subPenny]).length   === 0);
check('Low volume excluded',           detectRunners([lowVol]).length     === 0);
check('Warrant (ends W) excluded',     detectRunners([warrant]).length    === 0);
check('Bad data (600%) excluded',      detectRunners([badData]).length    === 0);

// ── detectHeatingUp excludes untradeable ──────────────────────────────────────
console.log('\ndetectHeatingUp excludes untradeable:');

const goodHeater = mkStock({
  ticker: 'COIN', price: 20, changePercent: 8,
  volume: 1_200_000, previousVolume: 700_000,  // rvol ≈ 1.71x
  vwap: 18,
});
const otcIlliquid = mkStock({
  ticker: 'XLOWP', price: 0.04, changePercent: 10,
  volume: 150_000, previousVolume: 80_000, vwap: 0.03,
});
const rights = mkStock({
  ticker: 'COINR', price: 5, changePercent: 8,
  volume: 1_200_000, previousVolume: 700_000, vwap: 4,
});

check('Good heater qualifies',         detectHeatingUp([goodHeater]).length  === 1);
check('OTC illiquid excluded',         detectHeatingUp([otcIlliquid]).length === 0);
check('Rights (ends R) excluded',      detectHeatingUp([rights]).length      === 0);

// ── Momentum disclaimer tracking ──────────────────────────────────────────────
console.log('\nMomentum disclaimer tracking (goToMomentumStock):');

const { go, navLog } = makeGoToMomentumStock();

go('SOFI');
check('First tap SOFI → momentumAlert: true',  navLog[0]?.params?.momentumAlert === true);

go('SOFI');
check('Second tap SOFI → no momentumAlert',    navLog[1]?.params?.momentumAlert === undefined);

go('AAPL');
check('First tap AAPL → momentumAlert: true',  navLog[2]?.params?.momentumAlert === true);

go('AAPL');
check('Second tap AAPL → no momentumAlert',    navLog[3]?.params?.momentumAlert === undefined);

go('SOFI');
check('Third tap SOFI → still no momentumAlert (Set persists)', navLog[4]?.params?.momentumAlert === undefined);

check('All navigations go to StockChat', navLog.every(e => e.screen === 'StockChat'));
check('Ticker always passed correctly',  navLog.every((e, i) => {
  const expected = ['SOFI', 'SOFI', 'AAPL', 'AAPL', 'SOFI'][i];
  return e.params?.ticker === expected;
}));

// ── Summary ────────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed === 0) { console.log('All tests passed ✅'); }
else { console.log(`${failed} test(s) failed ❌`); process.exit(1); }
