/**
 * test_historical_vs_today.js
 * Verifies the HISTORICAL EVENT QUESTIONS sub-rule is correctly placed and
 * that question classification logic routes correctly.
 * Run: node test_historical_vs_today.js
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

// ── TEST 1: Sub-rule exists and is inside NEWS KNOWLEDGE RULE ─────────────────
console.log('\n=== TEST 1: HISTORICAL EVENT QUESTIONS sub-rule exists ===');
check('Sub-rule heading present', IDENTITY.includes('HISTORICAL EVENT QUESTIONS'));
const newsRuleIdx  = IDENTITY.indexOf('NEWS KNOWLEDGE RULE');
const histRuleIdx  = IDENTITY.indexOf('HISTORICAL EVENT QUESTIONS');
const todayRuleIdx = IDENTITY.indexOf('WHEN THE USER ASKS ABOUT NEWS FOR "HOY" / "TODAY" SPECIFICALLY');
check('Sub-rule comes after NEWS KNOWLEDGE RULE', histRuleIdx > newsRuleIdx);
check('Sub-rule comes before the HOY/TODAY rule', histRuleIdx < todayRuleIdx);

// ── TEST 2: All trigger phrases listed ───────────────────────────────────────
console.log('\n=== TEST 2: Trigger phrases in HISTORICAL sub-rule ===');
const triggers = [
  'la noticia más polémica',
  'la noticia mas polemica',
  'mayor caída',
  'mayor caida',
  'peor día',
  'peor dia',
  'cuando cayó más',
  'cuando cayo mas',
  'el crash de',
  'por qué cayó tanto',
  'por que cayo tanto',
  'el evento que más movió',
  'el evento que mas movio',
  'biggest crash',
  'worst day',
  'biggest drop',
];
triggers.forEach(t => {
  check(`Trigger listed: "${t}"`, IDENTITY.includes(t));
});

// ── TEST 3: Sub-rule instructs to SKIP Polygon ────────────────────────────────
console.log('\n=== TEST 3: Sub-rule skips Polygon feed ===');
check('Sub-rule says "SKIP the Polygon feed entirely"',
  IDENTITY.includes('SKIP the Polygon feed entirely'));
check('Sub-rule says do NOT mention today\'s feed',
  IDENTITY.includes('Do NOT mention today\'s feed') || IDENTITY.includes('do NOT mention today\'s feed'));
check('Sub-rule says go DIRECTLY to training knowledge',
  IDENTITY.includes('answer DIRECTLY from training knowledge'));

// ── TEST 4: Example response format included ──────────────────────────────────
console.log('\n=== TEST 4: Example response format ===');
check('Example opens directly with the event (not "Hoy en el feed...")',
  IDENTITY.includes('"El peor día de META fue en febrero 2022'));
check('Instruction says do NOT start with "Hoy en el feed..."',
  IDENTITY.includes('"Hoy en el feed..."'));
check('Instruction says do NOT start with "No encontré noticias hoy..."',
  IDENTITY.includes('"No encontré noticias hoy..."'));

// ── TEST 5: Question classifier simulation ────────────────────────────────────
console.log('\n=== TEST 5: Question classification logic ===');

const HISTORICAL_TRIGGERS = [
  'la noticia más polémica', 'la noticia mas polemica',
  'mayor caída', 'mayor caida',
  'peor día', 'peor dia',
  'cuando cayó más', 'cuando cayo mas',
  'qué pasó en', 'que paso en',
  'qué pasó con', 'que paso con',
  'el crash de', 'por qué cayó tanto', 'por que cayo tanto',
  'el evento que más movió', 'el evento que mas movio',
  'historically', 'historia de',
  'biggest crash', 'worst day', 'biggest drop',
  'what happened in',
];
const TODAY_TRIGGERS = ['hoy', 'today', 'esta mañana', 'ahora mismo', 'right now'];
const RECENT_TRIGGERS = ['noticias', 'news', 'qué ha pasado', 'what happened', 'ultimamente', 'recently', 'ha pasado', 'recientes'];

function classifyQuestion(q) {
  const lower = q.toLowerCase();
  const isHistorical = HISTORICAL_TRIGGERS.some(t => lower.includes(t));
  const isToday      = !isHistorical && TODAY_TRIGGERS.some(t => lower.includes(t));
  const isRecent     = !isHistorical && !isToday && RECENT_TRIGGERS.some(t => lower.includes(t));
  return {
    isHistorical,
    isToday,
    isRecent,
    route: isHistorical ? 'TRAINING_ONLY' : isToday ? 'POLYGON_ONLY' : isRecent ? 'POLYGON+TRAINING' : 'GENERAL',
  };
}

const testCases = [
  { q: 'cual fue la noticia mas polemica de SNAP',   expect: 'TRAINING_ONLY',    desc: 'SNAP historical volatile event' },
  { q: 'cuando fue el peor dia de META',             expect: 'TRAINING_ONLY',    desc: 'META worst day historical' },
  { q: 'noticias recientes de PLUG',                 expect: 'POLYGON+TRAINING', desc: 'PLUG recent news (both sources)' },
  { q: 'noticias de PLUG hoy',                       expect: 'POLYGON_ONLY',     desc: 'PLUG today feed only' },
  { q: 'cuando cayo mas NFLX',                       expect: 'TRAINING_ONLY',    desc: 'NFLX biggest drop historical' },
  { q: 'que paso con BYND en 2022',                  expect: 'TRAINING_ONLY',    desc: 'BYND historical year question' },
  { q: 'noticias de TSLA',                           expect: 'POLYGON+TRAINING', desc: 'TSLA recent news (both sources)' },
  { q: 'what was the biggest crash for AMZN',        expect: 'TRAINING_ONLY',    desc: 'AMZN biggest crash in English' },
  { q: 'noticias de NVDA today',                     expect: 'POLYGON_ONLY',     desc: 'NVDA today — English today trigger' },
  { q: 'el evento que mas movio la stock de GOOGL',  expect: 'TRAINING_ONLY',    desc: 'GOOGL historical event trigger' },
];

testCases.forEach(({ q, expect, desc }) => {
  const { route } = classifyQuestion(q);
  const ok = route === expect;
  if (ok) { console.log(`  ✓ [${route}] "${q}"`); passed++; }
  else     { console.log(`  ✗ [got:${route} want:${expect}] "${q}" — ${desc}`); failed++; }
});

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(60)}`);
console.log(`Results: ${passed}/${passed + failed} passed, ${failed} failed`);

if (failed === 0) {
  console.log('All historical vs. today routing tests passed ✅');
  console.log('\nManual verification checklist (run in app):');
  console.log('  □ "cual fue la noticia mas polemica de SNAP"');
  console.log('    → MUST go directly to mayo 2022, 40%+ crash');
  console.log('    → MUST NOT start with "Hoy en el feed..." or "No encontré noticias hoy"');
  console.log('  □ "cuando fue el peor dia de META"');
  console.log('    → MUST cite feb 2022, 26% crash, first DAU decline');
  console.log('    → MUST NOT mention today\'s feed');
  console.log('  □ "noticias recientes de PLUG"');
  console.log('    → MUST combine Polygon feed + training knowledge about PLUG history');
  console.log('  □ "noticias de PLUG hoy"');
  console.log('    → MUST use only Polygon feed, no training history');
} else {
  console.log('Some tests FAILED ❌');
  process.exit(1);
}
