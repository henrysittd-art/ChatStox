// Risk level calculation tests — mirrors src/utils/riskLevel.js
// Run: node test_risk_level.mjs

function calcRisk(stock) {
  const ticker  = (stock.ticker  || '').toUpperCase();
  const price   = Number(stock.price)          || 0;
  const pct     = Number(stock.changePercent)  || 0;
  const vol     = Number(stock.volume)         || 0;
  const prevVol = Number(stock.previousVolume) || 0;
  const rvol    = prevVol > 0 ? vol / prevVol  : 0;
  const mktCap  = Number(stock.marketCap)      || 0;

  const highReasons = [];
  if (price > 0 && price < 1)                    highReasons.push('Penny Stock');
  if (pct > 30 || pct < -20)                     highReasons.push('Extreme Move');
  if (vol > 0 && vol < 100_000)                  highReasons.push('Low Volume');
  if (prevVol > 0 && rvol > 10)                  highReasons.push('Unusual Volume');
  if (mktCap > 0 && mktCap < 50_000_000)         highReasons.push('Micro Cap');
  if (ticker.endsWith('F') || ticker.length > 5) highReasons.push('OTC/Warrant');

  if (highReasons.length > 0) return { level: 'high', reasons: highReasons };

  const medReasons = [];
  if (price >= 1 && price < 5)                                     medReasons.push('Low-Priced Stock');
  if ((pct >= 15 && pct <= 30) || (pct >= -20 && pct <= -10))     medReasons.push('Large Move');
  if (prevVol > 0 && rvol >= 3 && rvol <= 10)                     medReasons.push('High Volume');
  if (mktCap >= 50_000_000 && mktCap < 300_000_000)               medReasons.push('Small Cap');

  if (medReasons.length > 0) return { level: 'medium', reasons: medReasons };

  return { level: 'low', reasons: [] };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
function check(label, cond) {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.log(`  ❌ ${label}`); failed++; }
}

console.log('\n=== Risk Level Tests ===\n');

// ── Spec test cases ────────────────────────────────────────────────────────────

console.log('Spec test cases:');

// SPCNF — penny stock, OTC (ends F), low volume
const spcnf = calcRisk({ ticker: 'SPCNF', price: 0.08, changePercent: 12, volume: 45_000, previousVolume: 60_000 });
check('SPCNF → HIGH RISK',                spcnf.level === 'high');
check('SPCNF reason: Penny Stock',        spcnf.reasons.includes('Penny Stock'));
check('SPCNF reason: Low Volume',         spcnf.reasons.includes('Low Volume'));
check('SPCNF reason: OTC/Warrant (ends F)', spcnf.reasons.includes('OTC/Warrant'));

// AEHL — +180% extreme move
const aehl = calcRisk({ ticker: 'AEHL', price: 3.50, changePercent: 180, volume: 8_000_000, previousVolume: 500_000 });
check('AEHL → HIGH RISK',                 aehl.level === 'high');
check('AEHL reason: Extreme Move',        aehl.reasons.includes('Extreme Move'));

// NVDA — stable large-cap, no badge
const nvda = calcRisk({ ticker: 'NVDA', price: 875, changePercent: 1.2, volume: 45_000_000, previousVolume: 40_000_000, marketCap: 2_150_000_000_000 });
check('NVDA → LOW (no badge)',            nvda.level === 'low');

// TSLA — stable large-cap
const tsla = calcRisk({ ticker: 'TSLA', price: 182, changePercent: -1.5, volume: 90_000_000, previousVolume: 85_000_000, marketCap: 580_000_000_000 });
check('TSLA → LOW (no badge)',            tsla.level === 'low');

// SOFI — $16, small cap in test data
const sofi = calcRisk({ ticker: 'SOFI', price: 16, changePercent: 2.1, volume: 22_000_000, previousVolume: 18_000_000, marketCap: 150_000_000 });
check('SOFI → MEDIUM RISK (Small Cap)',       sofi.level === 'medium');
check('SOFI reason: Small Cap',               sofi.reasons.includes('Small Cap'));
check('SOFI badge suppressed (not high)',      sofi.level !== 'high');  // medium shows no badge in UI

// ── HIGH RISK — individual triggers ───────────────────────────────────────────

console.log('\nHigh Risk — individual triggers:');

check('price = 0.99 → Penny Stock', calcRisk({ ticker: 'X', price: 0.99, changePercent: 5, volume: 500_000, previousVolume: 400_000 }).reasons.includes('Penny Stock'));
check('price = 1.00 → NOT Penny Stock', !calcRisk({ ticker: 'X', price: 1.00, changePercent: 5, volume: 500_000, previousVolume: 400_000 }).reasons.includes('Penny Stock'));
check('pct = 30.01 → Extreme Move', calcRisk({ ticker: 'X', price: 10, changePercent: 30.01, volume: 500_000, previousVolume: 400_000 }).reasons.includes('Extreme Move'));
check('pct = 30.00 → NOT Extreme Move (exactly 30)', !calcRisk({ ticker: 'X', price: 10, changePercent: 30.00, volume: 500_000, previousVolume: 400_000 }).reasons.includes('Extreme Move'));
check('pct = -20.01 → Extreme Move', calcRisk({ ticker: 'X', price: 10, changePercent: -20.01, volume: 500_000, previousVolume: 400_000 }).reasons.includes('Extreme Move'));
check('vol = 99_999 → Low Volume', calcRisk({ ticker: 'X', price: 10, changePercent: 5, volume: 99_999, previousVolume: 80_000 }).reasons.includes('Low Volume'));
check('vol = 100_000 → NOT Low Volume', !calcRisk({ ticker: 'X', price: 10, changePercent: 5, volume: 100_000, previousVolume: 80_000 }).reasons.includes('Low Volume'));
check('rvol = 10.01x → Unusual Volume', calcRisk({ ticker: 'X', price: 10, changePercent: 5, volume: 1_001_000, previousVolume: 100_000 }).reasons.includes('Unusual Volume'));
check('rvol = 10.0x → NOT Unusual Volume (exactly 10)', !calcRisk({ ticker: 'X', price: 10, changePercent: 5, volume: 1_000_000, previousVolume: 100_000 }).reasons.includes('Unusual Volume'));
check('marketCap = 49M → Micro Cap', calcRisk({ ticker: 'X', price: 10, changePercent: 5, volume: 500_000, previousVolume: 400_000, marketCap: 49_000_000 }).reasons.includes('Micro Cap'));
check('marketCap = 50M → NOT Micro Cap', !calcRisk({ ticker: 'X', price: 10, changePercent: 5, volume: 500_000, previousVolume: 400_000, marketCap: 50_000_000 }).reasons.includes('Micro Cap'));
check('ticker ABCDEF (6 chars) → OTC/Warrant', calcRisk({ ticker: 'ABCDEF', price: 10, changePercent: 5, volume: 500_000, previousVolume: 400_000 }).reasons.includes('OTC/Warrant'));
check('ticker GOOGL (5 chars, no F) → NOT OTC/Warrant', !calcRisk({ ticker: 'GOOGL', price: 150, changePercent: 1, volume: 20_000_000, previousVolume: 18_000_000 }).reasons.includes('OTC/Warrant'));
check('ticker ends F → OTC/Warrant', calcRisk({ ticker: 'NSRGYF', price: 5, changePercent: 1, volume: 500_000, previousVolume: 400_000 }).reasons.includes('OTC/Warrant'));

// ── MEDIUM RISK — individual triggers ─────────────────────────────────────────

console.log('\nMedium Risk — individual triggers:');

check('price = 1.00 → Low-Priced Stock', calcRisk({ ticker: 'X', price: 1.00, changePercent: 5, volume: 200_000, previousVolume: 150_000 }).reasons.includes('Low-Priced Stock'));
check('price = 4.99 → Low-Priced Stock', calcRisk({ ticker: 'X', price: 4.99, changePercent: 5, volume: 200_000, previousVolume: 150_000 }).reasons.includes('Low-Priced Stock'));
check('price = 5.00 → NOT Low-Priced',   !calcRisk({ ticker: 'X', price: 5.00, changePercent: 5, volume: 200_000, previousVolume: 150_000 }).reasons.includes('Low-Priced Stock'));
check('pct = 15% → Large Move',          calcRisk({ ticker: 'X', price: 10, changePercent: 15, volume: 200_000, previousVolume: 150_000 }).reasons.includes('Large Move'));
check('pct = 14.99% → NOT Large Move',   !calcRisk({ ticker: 'X', price: 10, changePercent: 14.99, volume: 200_000, previousVolume: 150_000 }).reasons.includes('Large Move'));
check('pct = -10% → Large Move',         calcRisk({ ticker: 'X', price: 10, changePercent: -10, volume: 200_000, previousVolume: 150_000 }).reasons.includes('Large Move'));
check('pct = -9.99% → NOT Large Move',   !calcRisk({ ticker: 'X', price: 10, changePercent: -9.99, volume: 200_000, previousVolume: 150_000 }).reasons.includes('Large Move'));
check('rvol = 3x → High Volume',         calcRisk({ ticker: 'X', price: 10, changePercent: 5, volume: 300_000, previousVolume: 100_000 }).reasons.includes('High Volume'));
check('rvol = 2.99x → NOT High Volume',  !calcRisk({ ticker: 'X', price: 10, changePercent: 5, volume: 299_000, previousVolume: 100_000 }).reasons.includes('High Volume'));
check('mktCap = 50M → Small Cap',        calcRisk({ ticker: 'X', price: 10, changePercent: 5, volume: 200_000, previousVolume: 150_000, marketCap: 50_000_000 }).reasons.includes('Small Cap'));
check('mktCap = 299.9M → Small Cap',     calcRisk({ ticker: 'X', price: 10, changePercent: 5, volume: 200_000, previousVolume: 150_000, marketCap: 299_900_000 }).reasons.includes('Small Cap'));
check('mktCap = 300M → NOT Small Cap',   !calcRisk({ ticker: 'X', price: 10, changePercent: 5, volume: 200_000, previousVolume: 150_000, marketCap: 300_000_000 }).reasons.includes('Small Cap'));

// ── HIGH takes priority over MEDIUM ──────────────────────────────────────────

console.log('\nHigh takes priority over Medium:');

// Price $1.50 would be Medium (Low-Priced), but rvol > 10 makes it High
const dual = calcRisk({ ticker: 'X', price: 1.50, changePercent: 5, volume: 2_000_000, previousVolume: 150_000 });
check('price=$1.50 (med) + rvol=13x (high) → HIGH wins', dual.level === 'high');
check('reason: Unusual Volume present', dual.reasons.includes('Unusual Volume'));

// ── Missing data edge cases ───────────────────────────────────────────────────

console.log('\nEdge cases:');

check('price = 0 (no data) → NOT Penny Stock', !calcRisk({ ticker: 'X', price: 0, changePercent: 0, volume: 0, previousVolume: 0 }).reasons.includes('Penny Stock'));
check('prevVol = 0 → RVOL skipped (no crash)',  calcRisk({ ticker: 'X', price: 10, changePercent: 5, volume: 1_000_000, previousVolume: 0 }).level !== undefined);
check('marketCap = 0 → no cap rules fire',      calcRisk({ ticker: 'X', price: 10, changePercent: 5, volume: 500_000, previousVolume: 400_000, marketCap: 0 }).level === 'low');

// ── UI badge rule: only HIGH shows a badge ────────────────────────────────────

console.log('\nUI badge rule — medium risk shows no badge:');

function showsBadge(stock) {
  // Mirrors the UI condition: only render badge when level === 'high'
  return calcRisk(stock).level === 'high';
}

// Medium stocks — badge suppressed
check('SOFI (med: Small Cap) → no badge',          !showsBadge({ ticker: 'SOFI', price: 16, changePercent: 2.1, volume: 22_000_000, previousVolume: 18_000_000, marketCap: 150_000_000 }));
check('Low-Priced $3 stock (med) → no badge',      !showsBadge({ ticker: 'X', price: 3, changePercent: 5, volume: 200_000, previousVolume: 150_000 }));
check('Large Move +18% (med) → no badge',          !showsBadge({ ticker: 'X', price: 10, changePercent: 18, volume: 200_000, previousVolume: 150_000 }));
check('High Volume 3x (med) → no badge',           !showsBadge({ ticker: 'X', price: 10, changePercent: 5, volume: 300_000, previousVolume: 100_000 }));
// Low stocks — no badge either
check('NVDA (low) → no badge',                     !showsBadge({ ticker: 'NVDA', price: 875, changePercent: 1.2, volume: 45_000_000, previousVolume: 40_000_000, marketCap: 2_150_000_000_000 }));
// High stocks — badge shows
check('SPCNF (high: penny+OTC+low vol) → badge',   showsBadge({ ticker: 'SPCNF', price: 0.08, changePercent: 12, volume: 45_000, previousVolume: 60_000 }));
check('AEHL (high: extreme move) → badge',          showsBadge({ ticker: 'AEHL', price: 3.50, changePercent: 180, volume: 8_000_000, previousVolume: 500_000 }));

// ── Summary ────────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed === 0) { console.log('All tests passed ✅'); }
else { console.log(`${failed} test(s) failed ❌`); process.exit(1); }
