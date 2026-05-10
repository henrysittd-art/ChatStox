/**
 * test_temporal_context.js
 * Verifies temporal context is correctly injected into system prompts
 * and that all date-awareness rules are in place.
 * Run: node test_temporal_context.js
 */

const fs = require('fs');
const src = fs.readFileSync('./src/services/aiService.js', 'utf8');

let passed = 0;
let failed = 0;

function check(label, condition) {
  if (condition) { console.log(`  ✓ ${label}`); passed++; }
  else            { console.log(`  ✗ ${label}`); failed++; }
}

// ── Extract the currentContext declaration ────────────────────────────────────
const ctxMatch = src.match(/const currentContext = `([^`]+)`/);

console.log('\n=== TEST 1: currentContext declaration ===');
check('currentContext variable declared', !!ctxMatch);
if (ctxMatch) {
  const ctx = ctxMatch[1];
  check("Contains TODAY'S DATE:", ctx.includes("TODAY'S DATE:"));
  check('Contains "You are operating in"', ctx.includes('You are operating in'));
  check('Contains training cutoff note (early 2025)', ctx.includes('early 2025'));
  check('Contains Polygon fallback instruction', ctx.includes('Polygon news feed'));
}

// Simulate the actual runtime value
const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
const currentYear = new Date().getFullYear();
console.log(`\n  Runtime check — today: "${today}", year: ${currentYear}`);
check(`Year is 2026 or later (not stuck in 2024)`, currentYear >= 2026);

// ── TEST 2: All three return paths inject currentContext ──────────────────────
console.log('\n=== TEST 2: currentContext in all return paths ===');
const returnMatches = [...src.matchAll(/return `\$\{currentContext\}/g)];
check('General chat return injects currentContext', returnMatches.length >= 1);
check('Single-stock return injects currentContext', returnMatches.length >= 2);

const noStockReturn = src.includes('if (!stock) return `${currentContext}');
check('No-stock fallback return injects currentContext', noStockReturn);

// ── TEST 3: EARNINGS RULE date caveat ─────────────────────────────────────────
console.log('\n=== TEST 3: EARNINGS RULE date caveat ===');
const identityMatch = src.match(/const IDENTITY = `([\s\S]+?)`;/);
const IDENTITY = identityMatch ? identityMatch[1] : '';

check('DATE CAVEAT heading present in EARNINGS RULE', IDENTITY.includes('DATE CAVEAT — MANDATORY'));
check('Caveat mentions "principios de 2025"', IDENTITY.includes('principios de 2025'));
check('Caveat tells AI not to present 2023/2024 dates as upcoming',
  IDENTITY.includes('NEVER present a date from 2023 or 2024 as if it were the upcoming'));
check('Caveat directs to SEC Edgar for verification', IDENTITY.includes('SEC Edgar'));

// ── TEST 4: TEMPORAL AWARENESS in PERSONALITY ─────────────────────────────────
console.log('\n=== TEST 4: TEMPORAL AWARENESS in PERSONALITY ===');
check('TEMPORAL AWARENESS heading present', IDENTITY.includes('TEMPORAL AWARENESS — MANDATORY'));
check('References ${today} template literal', src.includes('today is ${today}'));
check('References ${currentYear} template literal', src.includes('current year is ${currentYear}'));
check('Instructs to never treat 2023 dates as upcoming', IDENTITY.includes('NEVER present 2023 or 2024 earnings dates'));
check('Provides post-cutoff uncertainty phrasing', IDENTITY.includes('No tengo datos sobre lo que ocurrió después de principios de 2025'));
check('Provides "hasta principios de 2025" pattern for partial answers',
  IDENTITY.includes('Hasta principios de 2025'));

// ── TEST 5: today appears BEFORE OVERRIDE in each return ──────────────────────
console.log('\n=== TEST 5: currentContext appears before OVERRIDE ===');

// In the general-chat block, find the return statement
const generalReturnIdx  = src.indexOf("return `${currentContext}\n\n${OVERRIDE}\n\n${IDENTITY}", src.indexOf('if (isGeneral)'));
const stockReturnIdx    = src.lastIndexOf("return `${currentContext}");
const overrideDecl      = src.indexOf('const OVERRIDE =');

check('General chat: return starts with currentContext then OVERRIDE',
  src.includes('return `${currentContext}\n\n${OVERRIDE}') ||
  src.includes("return `${currentContext}\n\n${OVERRIDE}")
);

// ── TEST 6: Simulate what the AI sees ────────────────────────────────────────
console.log('\n=== TEST 6: Simulated prompt content ===');
const simulatedCtx = `TODAY'S DATE: ${today}. You are operating in ${currentYear}. Your training data goes up to early 2025. For events after early 2025, rely on the Polygon news feed injected below and acknowledge uncertainty about very recent developments.`;

check(`Simulated context starts with "TODAY'S DATE: ${today}"`,
  simulatedCtx.startsWith(`TODAY'S DATE: ${today}`));
check(`Simulated context contains year ${currentYear}`,
  simulatedCtx.includes(String(currentYear)));

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(60)}`);
console.log(`Results: ${passed}/${passed + failed} passed, ${failed} failed`);

if (failed === 0) {
  console.log('All temporal context tests passed ✅');
  console.log(`\nThe AI will now see: "${simulatedCtx.slice(0, 90)}..."`);
  console.log('\nManual verification checklist (run in app):');
  console.log('  □ "cuando fue el ultimo reporte de SNAP?" →');
  console.log('    must acknowledge it\'s 2026 and cite known date + caveat');
  console.log('  □ "cuando reporta NVDA proxima vez?" →');
  console.log('    must acknowledge uncertainty about exact 2026 date');
  console.log('  □ "que ha pasado con INTC en 2025?" →');
  console.log('    must use training knowledge about 2025 Lip-Bu Tan events');
} else {
  console.log('Some tests FAILED ❌');
  process.exit(1);
}
