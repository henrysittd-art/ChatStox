/**
 * test_rr_position_sizing.js
 * Verifies R/R explanation and position sizing are correctly in FORMAT 3.
 * Run: node test_rr_position_sizing.js
 */

const fs = require('fs');
const aiSrc   = fs.readFileSync('./src/services/aiService.js', 'utf8');
const chatSrc = fs.readFileSync('./src/screens/StockChatScreen.js', 'utf8');

const idMatch = aiSrc.match(/const IDENTITY = `([\s\S]+?)`;/);
if (!idMatch) { console.error('Cannot extract IDENTITY'); process.exit(1); }
const IDENTITY = idMatch[1];

let p = 0, f = 0;
function check(label, ok) {
  if (ok) { console.log('  ✓', label); p++; } else { console.log('  ✗', label); f++; }
}

// ── IDENTITY FORMAT 3 structure ───────────────────────────────────────────────
console.log('\n=== FORMAT 3 in IDENTITY (aiService.js) ===');
check('Risk/Reward line includes language explanation',
  IDENTITY.includes('Risk/Reward: 1:X.X — [if Spanish:'));
check('Spanish R/R phrase',
  IDENTITY.includes('Por cada $1 que arriesgas, puedes ganar $X.XX'));
check('English R/R phrase',
  IDENTITY.includes('For every $1 you risk, you can make $X.XX'));
check('Position sizing line (💰) present',
  IDENTITY.includes('💰'));
check('Spanish Ejemplo template',
  IDENTITY.includes('Ejemplo: Con $1,000'));
check('English Example template',
  IDENTITY.includes('Example: With $1,000'));
check('Shares calculation instruction',
  IDENTITY.includes('shares=floor(1000') || IDENTITY.includes('shares=floor(1000÷entry'));
check('Risk calculation Y=shares x (entry-stop)',
  IDENTITY.includes('Y=shares') && IDENTITY.includes('stop)'));
check('Gain calculation Z=shares x (target1-entry)',
  IDENTITY.includes('Z=shares') && IDENTITY.includes('target1'));
check('Round to nearest dollar instruction',
  IDENTITY.includes('round') && IDENTITY.includes('nearest dollar'));
check('Timeframe line still in FORMAT 3',
  IDENTITY.includes('💡 Timeframe:') && IDENTITY.indexOf('💡 Timeframe:') < IDENTITY.indexOf('DATA SOURCE'));
check('📌 explanation line present in FORMAT 3',
  IDENTITY.includes('📌 [if Spanish: "Basado en:'));
check('Order: Risk/Reward < Position < Timeframe < 📌 explanation',
  IDENTITY.indexOf('Risk/Reward') < IDENTITY.indexOf('💰') &&
  IDENTITY.indexOf('💰') < IDENTITY.indexOf('💡 Timeframe:') &&
  IDENTITY.indexOf('💡 Timeframe:') < IDENTITY.indexOf('📌 [if Spanish: "Basado en:'));

// ── Button template ───────────────────────────────────────────────────────────
console.log('\n=== Button template (buildTradeSetupPrompt) ===');
// buildTradeSetupPrompt uses template literals with dynamic values (rrRatio.toFixed(1)), so
// check for the surrounding static text that must always be present.
check('Button Risk/Reward has explanation placeholder',
  chatSrc.includes('Risk/Reward: 1:') && chatSrc.includes('— [Spanish: "Por cada $1 que arriesgas'));
check('Button Spanish R/R phrase',
  chatSrc.includes('Por cada $1 que arriesgas, puedes ganar $'));
check('Button English R/R phrase',
  chatSrc.includes('For every $1 you risk, you can make $'));
check('Button has position sizing line',
  chatSrc.includes('Ejemplo: Con $1,000') && chatSrc.includes('Example: With $1,000'));
check('Button has shares formula',
  chatSrc.includes('shares=floor(1000'));
check('Button has Y and Z calc',
  chatSrc.includes('Y=shares') && chatSrc.includes('Z=shares'));
check('Button Timeframe still present',
  chatSrc.includes('Timeframe:') && chatSrc.includes('Intraday'));
check('Button order: Risk/Reward < Position < Timeframe < 📌 explanation',
  (() => {
    const i1 = chatSrc.indexOf('Risk/Reward: 1:');
    const i2 = chatSrc.indexOf('Ejemplo: Con $1,000');
    const i3 = chatSrc.indexOf('💡 Timeframe:');
    const i4 = chatSrc.indexOf('R/R verificado');
    return i1 > -1 && i2 > -1 && i3 > -1 && i4 > -1 && i1 < i2 && i2 < i3 && i3 < i4;
  })());

// ── Calculation simulation ────────────────────────────────────────────────────
console.log('\n=== Calculation simulation ===');
function simulatePositionSizing(entry, stop, target1) {
  const shares     = Math.floor(1000 / entry);
  const riskDollar = Math.round(shares * (entry - stop));
  const gainDollar = Math.round(shares * (target1 - entry));
  const rr         = ((target1 - entry) / (entry - stop)).toFixed(1);
  return { shares, riskDollar, gainDollar, rr };
}

const cases = [
  { label: 'TSLA $405 | stop $397.80 | target $418.50',  entry: 405.23, stop: 397.80, target1: 418.50, wShares: 2,  wRisk: 15,  wGain: 27 },
  { label: 'NVDA $875 | stop $860.00 | target $910.00',  entry: 875.00, stop: 860.00, target1: 910.00, wShares: 1,  wRisk: 15,  wGain: 35 },
  { label: 'PLUG $2.50 | stop $2.30 | target $2.85',     entry: 2.50,   stop: 2.30,   target1: 2.85,   wShares: 400, wRisk: 80, wGain: 140 },
];

cases.forEach(({ label, entry, stop, target1, wShares, wRisk, wGain }) => {
  const { shares, riskDollar, gainDollar, rr } = simulatePositionSizing(entry, stop, target1);
  check(label + ': shares=' + shares, shares === wShares);
  check(label + ': risk=$' + riskDollar, riskDollar === wRisk);
  check(label + ': gain=$' + gainDollar, gainDollar === wGain);
  console.log('    R/R=' + rr + 'x | Spanish: "Ejemplo: Con $1,000 -> Stop en $' + stop.toFixed(2) + ' te arriesgas ~$' + riskDollar + '. Target 1 daria ~$' + gainDollar + ' de ganancia."');
});

console.log('\n' + '-'.repeat(60));
console.log('Results: ' + p + '/' + (p + f) + ' passed, ' + f + ' failed');
if (f === 0) {
  console.log('All R/R + position sizing tests passed ✅');
  console.log('\nManual verification checklist:');
  console.log('  [] Spanish: "dame el setup de TSLA" -> Risk/Reward shows explanation in Spanish');
  console.log('  [] English: "trade setup for NVDA" -> Risk/Reward explanation in English');
  console.log('  [] Position line shows real dollar amounts, not [Y] or [Z] placeholders');
  console.log('  [] shares = floor(1000 / entry price), risk and gain rounded to $');
  console.log('  [] Timeframe line still appears after position sizing');
} else {
  process.exit(1);
}
