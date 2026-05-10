/**
 * test_volatile_events.js
 * Verifies volatile event examples and VOLATILE EVENTS RULE are in the prompt.
 * Run: node test_volatile_events.js
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

console.log('\n=== TEST 1: VOLATILE EVENTS examples in SPECIFICITY block ===');
check('SNAP example present', IDENTITY.includes('SNAP: "En mayo 2022'));
check('SNAP mentions 40% crash', IDENTITY.includes('40%'));
check('SNAP mentions revenue guidance miss', IDENTITY.includes('guías de revenue'));
check('META example present', IDENTITY.includes('META: "En febrero 2022'));
check('META mentions 26% crash', IDENTITY.includes('26%'));
check('META mentions first daily active user decline', IDENTITY.includes('usuarios activos diarios'));
check('NFLX example present', IDENTITY.includes('NFLX: "En enero 2022'));
check('NFLX mentions 20% crash', IDENTITY.includes('20%'));
check('NFLX mentions subscriber loss', IDENTITY.includes('suscriptores'));

console.log('\n=== TEST 2: VOLATILE EVENTS examples are inside SPECIFICITY block ===');
const specIdx     = IDENTITY.indexOf('SPECIFICITY REQUIREMENT');
const snapIdx     = IDENTITY.indexOf('SNAP: "En mayo 2022');
const dataRuleIdx = IDENTITY.indexOf('=== DATA RULE — PRICES ONLY ===');
check('SNAP example comes after SPECIFICITY REQUIREMENT', snapIdx > specIdx);
check('SNAP example comes before DATA RULE (correct section)', snapIdx < dataRuleIdx || dataRuleIdx === -1);

console.log('\n=== TEST 3: Trigger phrases listed ===');
check('"la noticia más polémica" trigger listed', IDENTITY.includes('la noticia más polémica') || IDENTITY.includes('noticia más polémica'));
check('"el peor día" trigger listed', IDENTITY.includes('peor día'));
check('"mayor caída" trigger listed', IDENTITY.includes('mayor caída'));
check('"biggest crash" trigger listed', IDENTITY.includes('biggest crash'));

console.log('\n=== TEST 4: VOLATILE EVENTS RULE in PERSONALITY ===');
const personalityIdx = IDENTITY.indexOf('=== PERSONALITY ===');
const volatileRuleIdx = IDENTITY.indexOf('VOLATILE EVENTS RULE');
check('VOLATILE EVENTS RULE heading present', volatileRuleIdx !== -1);
check('VOLATILE EVENTS RULE is inside PERSONALITY section', volatileRuleIdx > personalityIdx);
check('Rule instructs: specific event + date + % move',
  IDENTITY.includes('specific event') && IDENTITY.includes('approximate date') && IDENTITY.includes('approximate % move'));
check('Rule gives SNAP inline example in PERSONALITY',
  IDENTITY.includes('SNAP cayó más del 40% en mayo 2022'));
check('Rule bans generic "volatilidad significativa" style answers',
  IDENTITY.includes('volatilidad significativa'));

console.log('\n=== TEST 5: Examples are correctly marked as CORRECT (✓) ===');
const snapLineIdx = IDENTITY.indexOf('SNAP: "En mayo 2022');
const metaLineIdx = IDENTITY.indexOf('META: "En febrero 2022');
const nflxLineIdx = IDENTITY.indexOf('NFLX: "En enero 2022');
// Each example line should be preceded by ✓
const snapLine = IDENTITY.slice(Math.max(0, snapLineIdx - 5), snapLineIdx + 5);
const metaLine = IDENTITY.slice(Math.max(0, metaLineIdx - 5), metaLineIdx + 5);
const nflxLine = IDENTITY.slice(Math.max(0, nflxLineIdx - 5), nflxLineIdx + 5);
check('SNAP example preceded by ✓', snapLine.includes('✓'));
check('META example preceded by ✓', metaLine.includes('✓'));
check('NFLX example preceded by ✓', nflxLine.includes('✓'));

console.log(`\n${'─'.repeat(60)}`);
console.log(`Results: ${passed}/${passed + failed} passed, ${failed} failed`);
if (failed === 0) {
  console.log('All volatile events tests passed ✅');
  console.log('\nManual verification checklist (run in app):');
  console.log('  □ "cual fue la noticia mas polemica de SNAP?" →');
  console.log('    must mention mayo 2022, 40%+ crash, revenue guidance miss');
  console.log('  □ "cual fue el peor dia de META en bolsa?" →');
  console.log('    must mention febrero 2022, 26% crash, first DAU decline');
  console.log('  □ "cuando cayo mas NFLX?" →');
  console.log('    must mention enero 2022, 20%+ crash, subscriber loss');
} else {
  console.log('Some tests FAILED ❌');
  process.exit(1);
}
