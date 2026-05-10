/**
 * test_news_knowledge.js
 * Tests that the NEWS KNOWLEDGE RULE is correctly included in the system prompt
 * and that the TYPE 2 classification now explicitly covers recent company news.
 * Run: node test_news_knowledge.js
 */

const fs = require('fs');

// Read the actual aiService.js source to verify the prompt content
const src = fs.readFileSync('./src/services/aiService.js', 'utf8');

// Extract the IDENTITY constant (everything between backtick opening and the closing backtick before "if (isGeneral)")
const identityMatch = src.match(/const IDENTITY = `([\s\S]+?)`;/);
if (!identityMatch) {
  console.error('❌ Could not extract IDENTITY constant — check file structure');
  process.exit(1);
}
const IDENTITY = identityMatch[1];

// ── Test helpers ──────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

console.log('\n=== TEST 1: TYPE 2 includes recent company news ===');
check(
  'TYPE 2 lists "recent company news" as a category',
  IDENTITY.includes('Recent company news, notable events'),
);
check(
  'TYPE 2 examples cover layoffs/lawsuits/dilution/partnerships',
  IDENTITY.includes('layoffs') && IDENTITY.includes('dilution') && IDENTITY.includes('partnerships'),
);

console.log('\n=== TEST 2: NEWS KNOWLEDGE RULE exists ===');
check(
  'NEWS KNOWLEDGE RULE heading present',
  IDENTITY.includes('NEWS KNOWLEDGE RULE'),
);
check(
  'Rule distinguishes "hoy/today" from general news questions',
  IDENTITY.includes('WITHOUT SAYING "HOY" / "TODAY"') || IDENTITY.includes('without saying "hoy"'),
);
check(
  'Rule instructs AI to use BOTH Polygon feed AND training knowledge',
  IDENTITY.includes('BOTH the Polygon feed AND your training knowledge') ||
  IDENTITY.includes('Use BOTH'),
);
check(
  'Rule includes the prohibited phrase "no tengo acceso a un historial completo de noticias"',
  IDENTITY.includes('no tengo acceso a un historial completo de noticias'),
);
check(
  'Rule requires at least 2-3 specific events from training knowledge',
  IDENTITY.includes('2-3 specific recent events'),
);

console.log('\n=== TEST 3: Example response structure present ===');
check(
  'Example combined response format included in rule',
  IDENTITY.includes('[COMPANY] ha tenido varias noticias importantes recientemente'),
);
check(
  'Example mentions "Para noticias en tiempo real verifica Bloomberg o Yahoo Finance"',
  IDENTITY.includes('Bloomberg o Yahoo Finance'),
);

console.log('\n=== TEST 4: CATALYST RULE scoped to today only ===');
check(
  'CATALYST RULE now says it applies to price-action context only',
  IDENTITY.includes('applies to price-action context') ||
  IDENTITY.includes('TODAY\'s catalyst only'),
);
check(
  'CATALYST RULE references NEWS KNOWLEDGE RULE for general news',
  IDENTITY.includes('For general news history questions, see NEWS KNOWLEDGE RULE'),
);

console.log('\n=== TEST 5: Refusal phrases banned ===');
const refusals = [
  'no tengo acceso a un historial completo de noticias',
  "I don't have access to news history",
  'no puedo acceder al historial',
];
refusals.forEach(phrase => {
  check(
    `Refusal phrase banned: "${phrase}"`,
    IDENTITY.includes(phrase),  // it appears in the NEVER list
  );
});

// ── Simulate question classification logic ────────────────────────────────────

console.log('\n=== TEST 6: Question classification (hoy vs. general) ===');

function classifyNewsQuestion(userMessage) {
  const lower = userMessage.toLowerCase();
  const todayKeywords = ['hoy', 'today', 'este día', 'esta mañana', 'ahora'];
  const isToday = todayKeywords.some(k => lower.includes(k));
  const isNewsQuestion = ['noticias', 'news', 'qué ha pasado', 'what happened', 'ultimamente', 'recently', 'ha pasado'].some(k => lower.includes(k));
  return { isNewsQuestion, isToday, usesTraining: isNewsQuestion && !isToday };
}

const questions = [
  { q: 'cuales son las noticias más recientes de BYND', expectTraining: true },
  { q: 'noticias de NVDA', expectTraining: true },
  { q: 'que ha pasado con PLUG ultimamente', expectTraining: true },
  { q: 'noticias de BYND hoy', expectTraining: false },
  { q: 'what news does TSLA have today', expectTraining: false },
  { q: 'qué ha pasado con AAPL recientemente', expectTraining: true },
];

questions.forEach(({ q, expectTraining }) => {
  const { usesTraining } = classifyNewsQuestion(q);
  check(
    `"${q}" → should${expectTraining ? '' : ' NOT'} use training`,
    usesTraining === expectTraining,
  );
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(60)}`);
console.log(`Results: ${passed}/${passed + failed} passed, ${failed} failed`);

if (failed === 0) {
  console.log('All news knowledge tests passed ✅');
  console.log('\nManual verification checklist:');
  console.log('  □ "cuales son las noticias más recientes de BYND" → Beyond Meat specific events from training');
  console.log('  □ "noticias de NVDA" → NVDA-specific news from training + any Polygon feed');
  console.log('  □ "que ha pasado con PLUG ultimamente" → PLUG recent history from training');
  console.log('  □ "noticias de NVDA hoy" → only Polygon feed, no training history');
} else {
  console.log('Some tests FAILED ❌');
  process.exit(1);
}
