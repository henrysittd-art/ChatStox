// Tests for detectHistoricalQuery and formatMessageTime
// Run: node test_historical_timestamp.mjs

// ── Import detectHistoricalQuery ───────────────────────────────────────────────

const MONTHS_ES = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};
const MONTHS_EN = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8,
  sep: 9, oct: 10, nov: 11, dec: 12,
};
const TRIGGER_PHRASES = [
  'en cuanto estaba', 'cuánto valía', 'cuanto valia', 'cuanto valio', 'cuánto valió',
  'precio el', 'what was', 'how much was', 'price on',
  'estaba en', 'cerró en', 'cerro el', 'abrió el', 'abrio el',
  'como cerro', 'cómo cerró', 'cuánto cerraba', 'cuanto cerraba',
  'how much did', 'que precio', 'qué precio', 'costo el',
];
function stripAccents(s) {
  return s.replace(/[áéíóú]/g, c => ({ á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u' }[c] || c));
}
function pad(n) { return String(n).padStart(2, '0'); }

function detectHistoricalQuery(message) {
  if (!message) return null;
  const lower = message.toLowerCase();
  const triggered = TRIGGER_PHRASES.some(t => lower.includes(t));
  if (!triggered) return null;
  const year0 = 2026; // simulate current year
  const esRe = /(\d{1,2})\s+de\s+([a-záéíóú]+)(?:\s+(?:del?\s+)?(\d{4}))?/;
  const esM = lower.match(esRe);
  if (esM) {
    const day = parseInt(esM[1], 10);
    const mName = stripAccents(esM[2]);
    const mon = MONTHS_ES[mName];
    if (mon && day >= 1 && day <= 31) {
      const yr = esM[3] ? parseInt(esM[3], 10) : year0;
      return { dateStr: `${yr}-${pad(mon)}-${pad(day)}` };
    }
  }
  const enRe = /\b([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:[,\s]+(\d{4}))?\b/;
  const enM = lower.match(enRe);
  if (enM) {
    const mon = MONTHS_EN[enM[1]];
    const day = parseInt(enM[2], 10);
    if (mon && day >= 1 && day <= 31) {
      const yr = enM[3] ? parseInt(enM[3], 10) : year0;
      return { dateStr: `${yr}-${pad(mon)}-${pad(day)}` };
    }
  }
  const numRe = /\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{4}))?\b/;
  const numM = lower.match(numRe);
  if (numM) {
    const m = parseInt(numM[1], 10);
    const d = parseInt(numM[2], 10);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      const yr = numM[3] ? parseInt(numM[3], 10) : year0;
      return { dateStr: `${yr}-${pad(m)}-${pad(d)}` };
    }
  }
  return null;
}

// ── formatMessageTime (inline) ─────────────────────────────────────────────────

function formatMessageTime(timeStr) {
  if (!timeStr) return '';
  const d = new Date(timeStr);
  if (isNaN(d.getTime())) return timeStr;
  const timeOnly = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const now = new Date();
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  if (sameDay) return timeOnly;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = d.getFullYear() === yesterday.getFullYear() && d.getMonth() === yesterday.getMonth() && d.getDate() === yesterday.getDate();
  if (isYesterday) return `Ayer · ${timeOnly}`;
  const dateLabel = d.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' });
  return `${dateLabel} · ${timeOnly}`;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

let passed = 0, failed = 0;
function check(label, cond) {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.log(`  ❌ ${label}`); failed++; }
}

// ── detectHistoricalQuery tests ────────────────────────────────────────────────

console.log('\n=== detectHistoricalQuery Tests ===\n');

console.log('Spanish date triggers:');
check('Spanish DD de MONTH (no year → 2026)',
  detectHistoricalQuery('en cuanto estaba TSLA el 4 de mayo')?.dateStr === '2026-05-04');
check('Spanish DD de MONTH with year',
  detectHistoricalQuery('cuánto valía NVDA el 15 de marzo de 2025')?.dateStr === '2025-03-15');
check('Spanish "precio el 8 de enero"',
  detectHistoricalQuery('que precio tenía AAPL el 8 de enero')?.dateStr === '2026-01-08');
check('Spanish "cerró en" with date',
  detectHistoricalQuery('cerró en cuánto TSLA el 2 de abril')?.dateStr === '2026-04-02');

console.log('\nEnglish date triggers:');
check('English "what was" + Month DD (no year → 2026)',
  detectHistoricalQuery('what was TSLA on May 4')?.dateStr === '2026-05-04');
check('English "how much was" + Month DDth with year',
  detectHistoricalQuery('how much was AAPL on March 15th 2025')?.dateStr === '2025-03-15');
check('English "price on" + Month DD',
  detectHistoricalQuery('price on January 8')?.dateStr === '2026-01-08');

console.log('\nNumeric date triggers:');
check('MM/DD (no year → 2026)',
  detectHistoricalQuery('precio el 05/04 de TSLA')?.dateStr === '2026-05-04');
check('MM-DD-YYYY',
  detectHistoricalQuery('what was TSLA on 03-15-2025')?.dateStr === '2025-03-15');

console.log('\nNon-trigger messages → null:');
check('Normal question → null',   detectHistoricalQuery('what is TSLA doing today?') === null);
check('Earnings question → null', detectHistoricalQuery('when does AAPL report earnings?') === null);
check('Empty string → null',      detectHistoricalQuery('') === null);
check('No date → null',           detectHistoricalQuery('en cuanto estaba TSLA ayer?') === null);

// ── formatMessageTime tests ────────────────────────────────────────────────────

console.log('\n=== formatMessageTime Tests ===\n');

console.log('Same-day ISO → time only:');
const nowISO = new Date().toISOString();
const nowFormatted = formatMessageTime(nowISO);
check('Same-day ISO → does not include "·"', !nowFormatted.includes('·'));
check('Same-day ISO → contains AM/PM or colon', /\d+:\d+/.test(nowFormatted));

console.log('\nYesterday ISO → "Ayer · HH:MM":');
const yesterday = new Date(Date.now() - 86400000);
const yesterdayFormatted = formatMessageTime(yesterday.toISOString());
check('Yesterday → starts with "Ayer"', yesterdayFormatted.startsWith('Ayer'));
check('Yesterday → contains "·"', yesterdayFormatted.includes('·'));

console.log('\nOlder date → "D de month · HH:MM":');
const older = new Date(Date.now() - 5 * 86400000);
const olderFormatted = formatMessageTime(older.toISOString());
check('Older → contains "·"', olderFormatted.includes('·'));
check('Older → does NOT start with "Ayer"', !olderFormatted.startsWith('Ayer'));

console.log('\nLegacy string (non-ISO) → returned as-is (backward compat):');
check('"10:51 PM" → "10:51 PM"', formatMessageTime('10:51 PM') === '10:51 PM');
check('"9:05 AM" → "9:05 AM"',  formatMessageTime('9:05 AM')  === '9:05 AM');
check('empty string → ""',      formatMessageTime('') === '');

// ── Summary ────────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed === 0) console.log('All tests passed ✅');
else { console.log(`${failed} test(s) failed ❌`); process.exit(1); }
