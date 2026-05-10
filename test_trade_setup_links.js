/**
 * test_trade_setup_links.js
 * Verifies trade setup triggers and source links are correctly in the prompt.
 * Run: node test_trade_setup_links.js
 */

const fs = require('fs');
const src = fs.readFileSync('./src/services/aiService.js', 'utf8');

const identityMatch = src.match(/const IDENTITY = `([\s\S]+?)`;/);
if (!identityMatch) { console.error('❌ Cannot extract IDENTITY'); process.exit(1); }
const IDENTITY = identityMatch[1];

let passed = 0;
let failed = 0;
function check(label, condition) {
  if (condition) { console.log(`  ✓ ${label}`); passed++; }
  else           { console.log(`  ✗ ${label}`); failed++; }
}

// ── TEST 1: FORMAT 3 trigger phrases ─────────────────────────────────────────
console.log('\n=== TEST 1: FORMAT 3 trigger phrases ===');
const triggers = [
  'trade setup', 'trend setup', 'setup completo', 'dame el setup',
  'setup de trading', 'give me the setup', 'quiero el setup',
  'hazme un setup', 'setup para', 'setup técnico',
];
triggers.forEach(t => check(`Trigger listed: "${t}"`, IDENTITY.includes(t)));

// ── TEST 2: FORMAT 3 uses live data instruction ───────────────────────────────
console.log('\n=== TEST 2: FORMAT 3 uses Polygon data, never asks user ===');
check('FORMAT 3 says to use LIVE DATA section directly',
  IDENTITY.includes('LIVE DATA section already contains current price') ||
  IDENTITY.includes('LIVE DATA section contains current price'));
check('FORMAT 3 says do NOT ask user to provide prices',
  IDENTITY.includes('NEVER say "please provide the price"') ||
  IDENTITY.includes('do NOT ask the user to provide prices'));
check('FORMAT 3 explicitly bans numbered lists for setup requests',
  IDENTITY.includes('NEVER output a generic numbered list for a setup request') ||
  IDENTITY.includes('NEVER output a numbered list'));
check('FORMAT 3 explicitly bans asking for price',
  IDENTITY.includes("NEVER say \"please provide the price\""));

// ── TEST 3: TradingView link removed from FORMAT 3 ───────────────────────────
console.log('\n=== TEST 3: TradingView link NOT in FORMAT 3 (removed) ===');
check('Ver gráfica line removed from FORMAT 3',
  !IDENTITY.includes('📈 Ver gráfica: https://www.tradingview.com/chart/?symbol=[TICKER]'));
check('TradingView link still present in SOURCE LINKS (personality)',
  IDENTITY.includes('https://www.tradingview.com/chart/?symbol=[TICKER]'));

// ── TEST 4: PERSONALITY trade setup trigger rule ──────────────────────────────
console.log('\n=== TEST 4: PERSONALITY trade setup trigger rule ===');
const personalityIdx = IDENTITY.indexOf('=== PERSONALITY ===');
const tradeRuleIdx   = IDENTITY.indexOf('TRADE SETUP TRIGGER — MANDATORY');
check('TRADE SETUP TRIGGER rule in PERSONALITY section', tradeRuleIdx > personalityIdx);
check('Rule says immediately output FORMAT 3', IDENTITY.includes('immediately output FORMAT 3'));
check('Rule says NEVER output a numbered list', IDENTITY.includes('NEVER output a numbered list'));
check('Rule says NEVER ask for prices (you have them)',
  IDENTITY.includes('NEVER ask for prices — you have them'));

// ── TEST 5: SOURCE LINKS rule in PERSONALITY ──────────────────────────────────
console.log('\n=== TEST 5: SOURCE LINKS rule in PERSONALITY ===');
check('SOURCE LINKS rule present', IDENTITY.includes('SOURCE LINKS — add these'));
check('Yahoo Finance link with [TICKER] placeholder',
  IDENTITY.includes('https://finance.yahoo.com/quote/[TICKER]'));
check('SEC Edgar link with [TICKER] placeholder',
  IDENTITY.includes('https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=[TICKER]'));
check('TradingView link in source links',
  IDENTITY.includes('https://www.tradingview.com/chart/?symbol=[TICKER]'));
check('Links trigger after earnings/news/fundamental responses',
  IDENTITY.includes('earnings, news, or fundamental analysis response'));
check('SOURCE LINKS rule says not to add TradingView link after trade setup',
  IDENTITY.includes('do NOT add the TradingView chart link'));

// ── TEST 6: FORMAT 4 updated to reference FORMAT 3 triggers ──────────────────
console.log('\n=== TEST 6: FORMAT 4 references FORMAT 3 triggers ===');
check('FORMAT 4 says use FORMAT 3 only when trigger matched',
  IDENTITY.includes("matches a FORMAT 3 trigger"));

// ── TEST 7: Simulate trigger classification ───────────────────────────────────
console.log('\n=== TEST 7: Trigger classification simulation ===');
const FORMAT3_TRIGGERS = [
  'trade setup', 'trend setup', 'setup completo', 'dame el setup',
  'setup de trading', 'give me the setup', 'quiero el setup',
  'hazme un setup', 'setup para', 'setup técnico',
];

function isSetupRequest(msg) {
  const lower = msg.toLowerCase();
  return FORMAT3_TRIGGERS.some(t => lower.includes(t));
}

const testCases = [
  { q: 'dame el setup para TSLA',              expectSetup: true  },
  { q: 'quiero un trade setup de NVDA',        expectSetup: true  },
  { q: 'setup completo por favor',             expectSetup: true  },
  { q: 'give me the setup for AAPL',           expectSetup: true  },
  { q: 'hazme un setup de PLUG',               expectSetup: true  },
  { q: 'cual es el precio de TSLA?',           expectSetup: false },
  { q: 'noticias de META',                     expectSetup: false },
  { q: 'cuando reporta NVDA?',                 expectSetup: false },
  { q: 'setup de trading para BYND',           expectSetup: true  },
  { q: 'setup técnico de AMD',                 expectSetup: true  },
  { q: 'que opinas del mercado hoy',           expectSetup: false },
];

testCases.forEach(({ q, expectSetup }) => {
  const got = isSetupRequest(q);
  const ok  = got === expectSetup;
  if (ok) { console.log(`  ✓ [${got ? 'FORMAT3' : 'FORMAT4'}] "${q}"`); passed++; }
  else     { console.log(`  ✗ [got:${got} want:${expectSetup}] "${q}"`); failed++; }
});

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(60)}`);
console.log(`Results: ${passed}/${passed + failed} passed, ${failed} failed`);

if (failed === 0) {
  console.log('All trade setup & links tests passed ✅');
  console.log('\nManual verification checklist (run in app):');
  console.log('  □ "dame el setup" → FORMAT 3 with 📊🟢🎯🛑📈⚖️ emojis, real Polygon prices');
  console.log('  □ "trade setup de NVDA" → FORMAT 3, NO numbered list, NO "please provide price"');
  console.log('  □ FORMAT 3 ends with 📈 Ver gráfica: tradingview.com/chart/?symbol=NVDA');
  console.log('  □ "cuando reporta TSLA?" → answer + 🔗 Fuentes: Yahoo | SEC Edgar | TradingView');
  console.log('  □ "noticias de PLUG" → answer + 🔗 Fuentes with PLUG in the URLs');
} else {
  console.log('Some tests FAILED ❌');
  process.exit(1);
}
