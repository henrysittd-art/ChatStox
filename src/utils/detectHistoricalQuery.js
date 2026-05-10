const MONTHS_ES = {
  enero:1, febrero:2, marzo:3, abril:4, mayo:5, junio:6,
  julio:7, agosto:8, septiembre:9, octubre:10, noviembre:11, diciembre:12,
};
const MONTHS_EN = {
  january:1, february:2, march:3, april:4, may:5, june:6,
  july:7, august:8, september:9, october:10, november:11, december:12,
  jan:1, feb:2, mar:3, apr:4, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12,
};

// Weekday name → JS day-of-week (0=Sun)
const WEEKDAY_MAP = {
  domingo:0, lunes:1, martes:2, miercoles:3, jueves:4, viernes:5, sabado:6,
  sunday:0, monday:1, tuesday:2, wednesday:3, thursday:4, friday:5, saturday:6,
};

// Stored WITHOUT accents — compared against accent-stripped message
const TRIGGER_PHRASES = [
  // Spanish price verbs
  'abrio', 'cerro', 'abria', 'cerraba',
  'apertura', 'cierre',
  'en cuanto estaba', 'cuanto valia', 'cuanto valio',
  'que precio', 'precio el', 'precio del',
  'estaba el', 'estaba en',
  'valia el', 'valio el',
  'como cerro', 'como abrio',
  'cuanto cerraba', 'cuanto abria',
  'costo el',
  // Relative-time triggers (clearly historical)
  'ayer', 'anteayer', 'semana pasada',
  // English
  'what was', 'how much was', 'price on',
  'how much did', 'what did',
  'what was the open', 'what was the close', 'what was it on',
  'what did it open', 'what did it close',
  'yesterday', 'last week',
];

function stripAccents(s) {
  return s.replace(/[áéíóúàèìòùâêîôûäëïöüñ]/g,
    c => ({á:'a',é:'e',í:'i',ó:'o',ú:'u',
           à:'a',è:'e',ì:'i',ò:'o',ù:'u',
           â:'a',ê:'e',î:'i',ô:'o',û:'u',
           ä:'a',ë:'e',ï:'i',ö:'o',ü:'u',ñ:'n'}[c] || c));
}

function pad(n) { return String(n).padStart(2, '0'); }

function toDateStr(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Returns today's date in ET as a JS Date (at midnight ET)
function todayET() {
  const etStr = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  // etStr: "MM/DD/YYYY"
  const [m, d, y] = etStr.split('/').map(Number);
  return new Date(y, m - 1, d); // local midnight, but values are correct
}

// Resolve relative day references → YYYY-MM-DD or null
function resolveRelativeDate(normalized) {
  const today = todayET();

  if (normalized.includes('anteayer')) {
    const d = new Date(today); d.setDate(d.getDate() - 2); return toDateStr(d);
  }
  if (normalized.includes('ayer') || normalized.includes('yesterday')) {
    const d = new Date(today); d.setDate(d.getDate() - 1); return toDateStr(d);
  }
  if (normalized.includes('semana pasada') || normalized.includes('last week')) {
    const d = new Date(today); d.setDate(d.getDate() - 7); return toDateStr(d);
  }
  // Named weekday — resolve to most recent past occurrence
  for (const [name, dow] of Object.entries(WEEKDAY_MAP)) {
    // match whole word so "martes" doesn't match inside "trimestres"
    const re = new RegExp(`\\b${name}\\b`);
    if (re.test(normalized)) {
      const todayDow = today.getDay();
      let offset = todayDow - dow;
      if (offset <= 0) offset += 7; // go back to last occurrence
      const d = new Date(today); d.setDate(d.getDate() - offset);
      return toDateStr(d);
    }
  }
  return null;
}

/**
 * Detects a historical price query in `message`.
 * @param {string} message  - user's raw message
 * @param {string|null} knownTicker - ticker already in context (StockChatScreen)
 * @returns {{ isHistorical: boolean, date: string|null, ticker: string|null }}
 */
export function detectHistoricalQuery(message, knownTicker = null) {
  const NONE = { isHistorical: false, date: null, ticker: knownTicker || null };
  if (!message) return NONE;

  const lower      = message.toLowerCase();
  const normalized = stripAccents(lower);

  const triggered = TRIGGER_PHRASES.some(t => normalized.includes(t));
  if (!triggered) return NONE;

  const year0 = new Date().getFullYear();
  let dateStr = null;

  // 1. "DD de MONTH [del? YYYY]" — Spanish explicit date
  const esRe = /(\d{1,2})\s+de\s+([a-záéíóú]+)(?:\s+(?:del?\s+)?(\d{4}))?/;
  const esM  = lower.match(esRe);
  if (esM) {
    const day  = parseInt(esM[1], 10);
    const mKey = stripAccents(esM[2]);
    const mon  = MONTHS_ES[mKey];
    if (mon && day >= 1 && day <= 31) {
      const yr = esM[3] ? parseInt(esM[3], 10) : year0;
      dateStr = `${yr}-${pad(mon)}-${pad(day)}`;
    }
  }

  // 2. "MONTH DD[th/st/nd/rd][,] [YYYY]" — English explicit date
  if (!dateStr) {
    const enRe = /\b([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:[,\s]+(\d{4}))?\b/;
    const enM  = lower.match(enRe);
    if (enM) {
      const mon = MONTHS_EN[enM[1]];
      const day = parseInt(enM[2], 10);
      if (mon && day >= 1 && day <= 31) {
        const yr = enM[3] ? parseInt(enM[3], 10) : year0;
        dateStr = `${yr}-${pad(mon)}-${pad(day)}`;
      }
    }
  }

  // 3. "MM/DD[/YYYY]" or "MM-DD[-YYYY]"
  if (!dateStr) {
    const numRe = /\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{4}))?\b/;
    const numM  = lower.match(numRe);
    if (numM) {
      const m = parseInt(numM[1], 10);
      const d = parseInt(numM[2], 10);
      if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
        const yr = numM[3] ? parseInt(numM[3], 10) : year0;
        dateStr = `${yr}-${pad(m)}-${pad(d)}`;
      }
    }
  }

  // 4. Relative day references (ayer, lunes, last week, etc.)
  if (!dateStr) {
    dateStr = resolveRelativeDate(normalized);
  }

  if (!dateStr) return NONE;

  return { isHistorical: true, date: dateStr, ticker: knownTicker || null };
}
