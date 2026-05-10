/**
 * test_news_specificity.js
 * Verifies the SPECIFICITY REQUIREMENT is correctly embedded in the system prompt
 * and that all banned filler phrases and correct examples are present.
 * Run: node test_news_specificity.js
 */

const fs = require('fs');
const src = fs.readFileSync('./src/services/aiService.js', 'utf8');

const identityMatch = src.match(/const IDENTITY = `([\s\S]+?)`;/);
if (!identityMatch) {
  console.error('❌ Could not extract IDENTITY constant');
  process.exit(1);
}
const IDENTITY = identityMatch[1];

let passed = 0;
let failed = 0;

function check(label, condition) {
  if (condition) { console.log(`  ✓ ${label}`); passed++; }
  else            { console.log(`  ✗ ${label}`); failed++; }
}

// ── Test 1: SPECIFICITY REQUIREMENT block present ─────────────────────────────
console.log('\n=== TEST 1: SPECIFICITY REQUIREMENT block ===');
check('Heading "SPECIFICITY REQUIREMENT" present', IDENTITY.includes('SPECIFICITY REQUIREMENT'));
check('"approximate dates or quarters" instruction present', IDENTITY.includes('approximate dates or quarters'));
check('"Generic summaries are forbidden" present', IDENTITY.includes('Generic summaries are forbidden'));

// ── Test 2: Banned filler phrases listed ──────────────────────────────────────
console.log('\n=== TEST 2: Banned filler phrases ===');
const banned = [
  'ha estado enfocándose en',
  'ha habido un interés creciente en',
  'ha estado trabajando en',
  'ha tenido desafíos',
  'ha enfrentado presiones',
  'sigue siendo relevante en su sector',
  'ha experimentado volatilidad',
  'el mercado ha mostrado interés',
  'continúa su estrategia de',
];
banned.forEach(phrase => {
  check(`Banned phrase listed: "${phrase}"`, IDENTITY.includes(phrase));
});

// ── Test 3: Correct example responses present ─────────────────────────────────
console.log('\n=== TEST 3: Correct examples ===');
check('INTC example: Lip-Bu Tan mentioned', IDENTITY.includes('Lip-Bu Tan'));
check('INTC example: Pat Gelsinger mentioned', IDENTITY.includes('Pat Gelsinger'));
check('INTC example: 15,000 employees mentioned', IDENTITY.includes('15,000'));
check('BYND example: 20%+ revenue decline mentioned', IDENTITY.includes('20%+'));
check('BYND example: dilución/convertible bond mentioned', IDENTITY.includes('dilución accionaria') || IDENTITY.includes('convertible bond'));
check('PLTR example: S&P 500 inclusion September 2024', IDENTITY.includes('S&P 500 en septiembre 2024'));
check('PLTR example: Alex Karp selling shares', IDENTITY.includes('Alex Karp'));
check('PLTR example: Project Maven or government contracts', IDENTITY.includes('Project Maven') || IDENTITY.includes('Maven Smart System'));

// ── Test 4: WHO/WHAT/WHEN instruction ────────────────────────────────────────
console.log('\n=== TEST 4: WHO/WHAT/WHEN requirement ===');
check('"WHO did WHAT, approximately WHEN" instruction present',
  IDENTITY.includes('WHO did WHAT') && IDENTITY.includes('approximately WHEN'));

// ── Test 5: Wrong format examples explicitly marked as banned ─────────────────
console.log('\n=== TEST 5: Wrong format examples explicitly shown ===');
check('Beyond Meat filler example marked as WRONG',
  IDENTITY.includes('Beyond Meat ha estado enfocándose en'));
check('Intel filler example marked as WRONG',
  IDENTITY.includes('Intel ha tenido desafíos en el sector'));
check('Palantir filler example marked as WRONG',
  IDENTITY.includes('Palantir ha mostrado un interés creciente'));

// ── Test 6: Integration — specificity block is inside NEWS KNOWLEDGE RULE ─────
console.log('\n=== TEST 6: SPECIFICITY block inside NEWS KNOWLEDGE RULE ===');
const newsRuleIdx      = IDENTITY.indexOf('NEWS KNOWLEDGE RULE');
const specificityIdx   = IDENTITY.indexOf('SPECIFICITY REQUIREMENT');
const dataRuleIdx      = IDENTITY.indexOf('=== DATA RULE — PRICES ONLY ===');
check('SPECIFICITY block comes after NEWS KNOWLEDGE RULE',
  newsRuleIdx !== -1 && specificityIdx > newsRuleIdx);
check('SPECIFICITY block comes before DATA RULE (correct section)',
  specificityIdx !== -1 && dataRuleIdx !== -1 && specificityIdx < dataRuleIdx);

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(60)}`);
console.log(`Results: ${passed}/${passed + failed} passed, ${failed} failed`);

if (failed === 0) {
  console.log('All specificity tests passed ✅');
  console.log('\nManual verification checklist (run in app):');
  console.log('  □ "noticias recientes de INTC" → must mention Lip-Bu Tan, Pat Gelsinger,');
  console.log('    ~15,000 layoffs Aug 2024, foundry restructuring 2025');
  console.log('  □ "que ha pasado con BYND" → must mention 20%+ revenue decline,');
  console.log('    specific layoff rounds, debt/dilution issues, convertible bond');
  console.log('  □ "noticias de PLTR" → must mention S&P 500 inclusion Sep 2024,');
  console.log('    Project Maven / government contracts, Alex Karp share sales');
  console.log('  □ None of the above should contain phrases like "ha estado enfocándose en"');
} else {
  console.log('Some tests FAILED ❌');
  process.exit(1);
}
