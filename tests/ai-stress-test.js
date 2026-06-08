o.  Estamos #!/usr/bin/env node
/**
 * ChatStox AI Stress Test
 * Calls the Railway backend directly and validates AI response quality.
 * Run: node tests/ai-stress-test.js
 */

'use strict';

const BACKEND  = process.env.BACKEND_URL || 'http://localhost:8080';
const MODEL    = 'gemini-2.5-flash';
const WARN_MS  = 8_000;
const FAIL_MS  = 22_000;

const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

// ── API call ───────────────────────────────────────────────────────────────────

async function chat({ systemContent = '', userMessage, history = [], currentTicker = null, language = 'en' }) {
  const messages = [
    ...(systemContent ? [{ role: 'system', content: systemContent }] : []),
    ...history,
    { role: 'user', content: userMessage },
  ];

  const start = Date.now();
  let text = '', status = 0, error = null;

  try {
    const res = await fetch(`${BACKEND}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.2,
        max_tokens: 1800,
        stream: false,
        messages,
        currentTicker,
        language,
        profileContext: '',
      }),
      signal: AbortSignal.timeout(FAIL_MS + 3000),
    });
    status = res.status;
    const json = await res.json();
    text = json.choices?.[0]?.message?.content?.trim() || '';
    if (!text && json.error) error = json.error;
  } catch (e) {
    error = e.message;
    status = 0;
  }

  return { text, elapsed: Date.now() - start, status, error };
}

// ── Detectors ──────────────────────────────────────────────────────────────────

const hasPricePat   = t => /\$\d+(\.\d{1,4})?/.test(t);
const hasPctPat     = t => /[+\-]?\d+(\.\d+)?%/.test(t);
const hasTickerPat  = t => /\b[A-Z]{2,5}\b/.test(t);
const noAccessPhrase = t => /no tengo acceso|don'?t have access|no cuento con datos|no tengo información|I don'?t have (access|the data|real.?time)/i.test(t);
const lengthRefusal  = t => /no puedo proporcionar un análisis tan extenso|cannot provide such a long|demasiado largo|too long to|excede mis capacidades/i.test(t);
const isSpanish      = t => /[áéíóúüñ¿¡]/.test(t) || /\b(el|la|los|las|una?|qué|cómo|para|con|por|del|que|más|está|tiene|precio|acción)\b/i.test(t);
const isEnglish      = t => /\b(the|is|are|was|for|with|this|that|have|will|price|stock)\b/i.test(t);
const mentionsTicker = (t, ticker) => t.toUpperCase().includes(ticker.toUpperCase());
const mentionsAny    = (t, words) => words.some(w => t.toLowerCase().includes(w.toLowerCase()));
const hasFormat2     = t => /📊|📈|💡|🎯|⚡|📌/.test(t);

// ── System message stubs ───────────────────────────────────────────────────────
// These mimic buildSystemPrompt data-only output; backend auto-enriches with Polygon data.

const GENERAL_STUB = `DATE: ${today}
MESSAGE_TYPE: GENERAL`;

const stockStub = ticker => `DATE: ${today}
MESSAGE_TYPE: FIRST_MENTION

LIVE DATA: ${ticker} — (backend will inject real-time Polygon data)`;

const followupStub = ticker => `DATE: ${today}
MESSAGE_TYPE: FOLLOWUP

LIVE DATA: ${ticker}`;

// ── Test runner ────────────────────────────────────────────────────────────────

const allResults = [];
let passed = 0, failed = 0, warned = 0;

function check(label, resp, assertions) {
  const failures = [];
  const warnings = [];

  if (resp.error)     failures.push(`Request error: ${resp.error}`);
  if (resp.status !== 200 && resp.status !== 0)
                      failures.push(`HTTP ${resp.status}`);
  if (!resp.text && !resp.error)
                      failures.push('Empty response');
  if (resp.elapsed > FAIL_MS)
                      failures.push(`Response too slow: ${resp.elapsed}ms`);
  else if (resp.elapsed > WARN_MS)
                      warnings.push(`Slow: ${resp.elapsed}ms`);

  for (const [desc, pass, detail] of assertions) {
    if (!pass) failures.push(detail ? `${desc} — ${detail}` : desc);
  }

  const ok = failures.length === 0;
  const icon = ok ? (warnings.length ? '⚠️ ' : '✅') : '❌';
  const timing = `${resp.elapsed}ms`;
  const chars = resp.text ? `${resp.text.length}ch` : '0ch';

  console.log(`  ${icon} ${label.padEnd(46)} ${timing.padStart(6)}  ${chars.padStart(6)}`);
  if (!ok) for (const f of failures) console.log(`       ✗ ${f}`);
  if (warnings.length) for (const w of warnings) console.log(`       ~ ${w}`);

  if (ok) { passed++; if (warnings.length) warned++; }
  else failed++;

  allResults.push({ label, ok, elapsed: resp.elapsed, chars: resp.text?.length ?? 0, failures, warnings, snippet: resp.text?.slice(0, 140).replace(/\n/g, ' ') });
}

// ── Test suites ────────────────────────────────────────────────────────────────

async function suite1_generalMarket() {
  console.log('\n── 1. GENERAL MARKET QUESTIONS ────────────────────────────────');

  const r1 = await chat({ systemContent: GENERAL_STUB, userMessage: 'how did the market close today?', language: 'en' });
  check('Market close summary', r1, [
    ['Contains price data ($X.XX)', hasPricePat(r1.text)],
    ['Contains % change',           hasPctPat(r1.text)],
    ['Mentions SPY or QQQ',         mentionsAny(r1.text, ['SPY', 'QQQ', 'S&P', 'Nasdaq', 'market'])],
    ['No "no access" refusal',      !noAccessPhrase(r1.text)],
  ]);

  const r2 = await chat({ systemContent: GENERAL_STUB, userMessage: 'what sectors are hot right now?', language: 'en' });
  check('Sector rotation query', r2, [
    ['Mentions sector names',        mentionsAny(r2.text, ['Tech', 'Energy', 'Health', 'Finance', 'Consumer', 'sector'])],
    ['No "no access" refusal',       !noAccessPhrase(r2.text)],
    ['Substantive reply (>80 chars)', r2.text.length > 80],
  ]);

  const r3 = await chat({ systemContent: GENERAL_STUB, userMessage: 'give me the top 5 movers today', language: 'en' });
  check('Top 5 movers list', r3, [
    ['Returns tickers',              hasTickerPat(r3.text)],
    ['Has price/% data',             hasPricePat(r3.text) || hasPctPat(r3.text)],
    ['No "no access" refusal',       !noAccessPhrase(r3.text)],
  ]);
}

async function suite2_stockRecs() {
  console.log('\n── 2. STOCK RECOMMENDATIONS ───────────────────────────────────');

  const r1 = await chat({ systemContent: GENERAL_STUB, userMessage: 'recommend me cheap stocks under $5 with momentum', language: 'en' });
  check('Cheap momentum stocks (< $5)', r1, [
    ['Returns tickers',             hasTickerPat(r1.text)],
    ['Has price data',              hasPricePat(r1.text)],
    ['Has % change data',           hasPctPat(r1.text)],
    ['No "no access" refusal',      !noAccessPhrase(r1.text)],
  ]);

  const r2 = await chat({ systemContent: GENERAL_STUB, userMessage: "what's moving today?", language: 'en' });
  check("What's moving today", r2, [
    ['Returns tickers',             hasTickerPat(r2.text)],
    ['Has % or volume data',        hasPctPat(r2.text) || /vol/i.test(r2.text)],
    ['No "no access" refusal',      !noAccessPhrase(r2.text)],
  ]);

  const r3 = await chat({ systemContent: GENERAL_STUB, userMessage: 'dame las mejores acciones del día', language: 'es' });
  check('Best stocks today (Spanish req.)', r3, [
    ['Returns tickers',             hasTickerPat(r3.text)],
    ['Responds in Spanish',         isSpanish(r3.text)],
    ['No "no access" refusal',      !noAccessPhrase(r3.text)],
  ]);

  const r4 = await chat({ systemContent: GENERAL_STUB, userMessage: 'qué penny stocks están moviendo hoy?', language: 'es' });
  check('Penny stocks query (Spanish)', r4, [
    ['Returns tickers',             hasTickerPat(r4.text)],
    ['Responds in Spanish',         isSpanish(r4.text)],
    ['Has price data',              hasPricePat(r4.text)],
    ['No "no access" refusal',      !noAccessPhrase(r4.text)],
  ]);
}

async function suite3_stockAnalysis() {
  console.log('\n── 3. STOCK ANALYSIS ──────────────────────────────────────────');

  const r1 = await chat({ systemContent: stockStub('AAPL'), userMessage: 'tell me about AAPL', currentTicker: 'AAPL', language: 'en' });
  check('AAPL first-mention analysis', r1, [
    ['Mentions AAPL',               mentionsTicker(r1.text, 'AAPL')],
    ['Has live price data',         hasPricePat(r1.text)],
    ['Uses FORMAT 2 emojis',        hasFormat2(r1.text)],
    ['No "no access" refusal',      !noAccessPhrase(r1.text)],
    ['Substantive (> 200 chars)',   r1.text.length > 200],
  ]);

  const r2 = await chat({ systemContent: stockStub('TSLA'), userMessage: 'is TSLA worth buying right now?', currentTicker: 'TSLA', language: 'en' });
  check('TSLA buy/sell directional opinion', r2, [
    ['Mentions TSLA',               mentionsTicker(r2.text, 'TSLA')],
    ['Has directional opinion',     mentionsAny(r2.text, ['buy', 'sell', 'hold', 'wait', 'long', 'short', 'bullish', 'bearish', 'pass'])],
    ['Has price data',              hasPricePat(r2.text)],
    ['No "no access" refusal',      !noAccessPhrase(r2.text)],
  ]);

  const r3 = await chat({ systemContent: stockStub('NVDA'), userMessage: 'dame un análisis completo de NVDA', currentTicker: 'NVDA', language: 'es' });
  check('NVDA full analysis (Spanish)', r3, [
    ['Mentions NVDA',               mentionsTicker(r3.text, 'NVDA')],
    ['Responds in Spanish',         isSpanish(r3.text)],
    ['No length refusal',           !lengthRefusal(r3.text)],
    ['Substantive (> 300 chars)',   r3.text.length > 300],
  ]);

  const r4 = await chat({ systemContent: stockStub('MSTR'), userMessage: 'what is the trade setup for MSTR?', currentTicker: 'MSTR', language: 'en' });
  check('MSTR trade setup (FORMAT 3)', r4, [
    ['Mentions MSTR',               mentionsTicker(r4.text, 'MSTR')],
    ['Has entry/stop/target',       mentionsAny(r4.text, ['Entry', 'Stop', 'Target', 'T1', 'T2', 'R/R'])],
    ['Has price levels',            hasPricePat(r4.text)],
    ['No "no access" refusal',      !noAccessPhrase(r4.text)],
  ]);
}

async function suite4_followupContext() {
  console.log('\n── 4. FOLLOW-UP CONTEXT ───────────────────────────────────────');

  // EZGO: initial + follow-up must stay on EZGO
  const ezgoFirst = await chat({ systemContent: stockStub('EZGO'), userMessage: 'tell me about EZGO', currentTicker: 'EZGO', language: 'en' });
  const ezgoFollowup = await chat({
    systemContent: followupStub('EZGO'),
    userMessage: 'is it worth buying?',
    currentTicker: 'EZGO',
    history: [
      { role: 'user',      content: 'tell me about EZGO' },
      { role: 'assistant', content: ezgoFirst.text.slice(0, 600) },
    ],
    language: 'en',
  });
  check('Follow-up stays on EZGO (not generic)', ezgoFollowup, [
    ['First response mentions EZGO',   mentionsTicker(ezgoFirst.text, 'EZGO')],
    ['Follow-up mentions EZGO',        mentionsTicker(ezgoFollowup.text, 'EZGO')],
    ['Follow-up has directional view', mentionsAny(ezgoFollowup.text, ['buy', 'wait', 'risk', 'entry', 'sell', 'long', 'hold'])],
    ['No "no access" refusal',         !noAccessPhrase(ezgoFollowup.text)],
  ]);

  // Trade setup follow-up
  const setupFirst = await chat({ systemContent: stockStub('QUBT'), userMessage: 'tell me about QUBT', currentTicker: 'QUBT', language: 'en' });
  const setupFollowup = await chat({
    systemContent: followupStub('QUBT'),
    userMessage: 'dame el setup completo',
    currentTicker: 'QUBT',
    history: [
      { role: 'user',      content: 'tell me about QUBT' },
      { role: 'assistant', content: setupFirst.text.slice(0, 600) },
    ],
    language: 'es',
  });
  check('Trade setup follow-up (ES, stays on QUBT)', setupFollowup, [
    ['Mentions QUBT',           mentionsTicker(setupFollowup.text, 'QUBT')],
    ['Has entry/stop/target',   mentionsAny(setupFollowup.text, ['Entry', 'Entrada', 'Stop', 'Target', 'T1', 'T2', 'R/R'])],
    ['Has prices',              hasPricePat(setupFollowup.text)],
    ['Responds in Spanish',     isSpanish(setupFollowup.text)],
  ]);

  // Second follow-up — 3-turn conversation
  const spyA = await chat({ systemContent: stockStub('SPY'), userMessage: 'how is SPY looking?', currentTicker: 'SPY', language: 'en' });
  const spyB = await chat({
    systemContent: followupStub('SPY'),
    userMessage: 'what are the key levels to watch?',
    currentTicker: 'SPY',
    history: [
      { role: 'user',      content: 'how is SPY looking?' },
      { role: 'assistant', content: spyA.text.slice(0, 400) },
    ],
    language: 'en',
  });
  const spyC = await chat({
    systemContent: followupStub('SPY'),
    userMessage: 'and if it breaks below support?',
    currentTicker: 'SPY',
    history: [
      { role: 'user',      content: 'how is SPY looking?' },
      { role: 'assistant', content: spyA.text.slice(0, 400) },
      { role: 'user',      content: 'what are the key levels to watch?' },
      { role: 'assistant', content: spyB.text.slice(0, 400) },
    ],
    language: 'en',
  });
  check('3-turn SPY conversation coherence', spyC, [
    ['Mentions SPY',            mentionsTicker(spyC.text, 'SPY')],
    ['Discusses scenario',      mentionsAny(spyC.text, ['break', 'below', 'support', 'level', 'target', 'watch', 'S1'])],
    ['No "no access" refusal',  !noAccessPhrase(spyC.text)],
  ]);
}

async function suite5_ambiguous() {
  console.log('\n── 5. AMBIGUOUS QUESTIONS ─────────────────────────────────────');

  const r1 = await chat({ systemContent: followupStub('GME'), userMessage: 'vale la pena?', currentTicker: 'GME', language: 'es' });
  check('"vale la pena?" → interprets as GME', r1, [
    ['Mentions GME',            mentionsTicker(r1.text, 'GME')],
    ['Responds in Spanish',     isSpanish(r1.text)],
    ['Has opinion/direction',   mentionsAny(r1.text, ['riesgo', 'entrada', 'comprar', 'esperar', 'buy', 'wait', 'risk', 'caro', 'soportes'])],
  ]);

  const r2 = await chat({ systemContent: followupStub('AAPL'), userMessage: 'what about support?', currentTicker: 'AAPL', language: 'en' });
  check('"what about support?" → AAPL levels', r2, [
    ['Mentions AAPL or level context', mentionsTicker(r2.text, 'AAPL') || mentionsAny(r2.text, ['support', 'S1', 'S2', 'VWAP', 'low'])],
    ['Has price levels',               hasPricePat(r2.text)],
  ]);

  const r3 = await chat({ systemContent: followupStub('TSLA'), userMessage: 'cuánto?', currentTicker: 'TSLA', language: 'es' });
  check('"cuánto?" → TSLA price context', r3, [
    ['Mentions TSLA or gives price',   mentionsTicker(r3.text, 'TSLA') || hasPricePat(r3.text)],
    ['Responds in Spanish',            isSpanish(r3.text)],
  ]);

  const r4 = await chat({ systemContent: GENERAL_STUB, userMessage: 'thoughts?', language: 'en' });
  check('"thoughts?" in general chat', r4, [
    ['Responds usefully (>30 chars)',  r4.text.length > 30],
    ['No crash',                       r4.status === 200],
  ]);
}

async function suite6_news() {
  console.log('\n── 6. NEWS QUESTIONS ──────────────────────────────────────────');

  const r1 = await chat({ systemContent: stockStub('NVDA'), userMessage: 'what news does NVDA have today?', currentTicker: 'NVDA', language: 'en' });
  check('NVDA news today', r1, [
    ['Mentions NVDA',           mentionsTicker(r1.text, 'NVDA')],
    ['Has news-like content',   mentionsAny(r1.text, ['news', 'headline', 'announced', 'reported', 'quarter', 'earnings', 'catalyst', 'partnership'])],
    ['No "no access" refusal',  !noAccessPhrase(r1.text)],
  ]);

  const r2 = await chat({ systemContent: stockStub('AAPL'), userMessage: 'any recent catalysts for AAPL?', currentTicker: 'AAPL', language: 'en' });
  check('AAPL catalyst inquiry', r2, [
    ['Mentions AAPL',           mentionsTicker(r2.text, 'AAPL')],
    ['Has catalyst content',    mentionsAny(r2.text, ['catalyst', 'news', 'earnings', 'product', 'iPhone', 'analyst', 'upgrade', 'Apple'])],
    ['No "no access" refusal',  !noAccessPhrase(r2.text)],
  ]);

  const r3 = await chat({ systemContent: GENERAL_STUB, userMessage: 'any big macro news today?', language: 'en' });
  check('General macro news', r3, [
    ['Has content (>60 chars)', r3.text.length > 60],
    ['No "no access" refusal',  !noAccessPhrase(r3.text)],
    ['Has something specific',  hasTickerPat(r3.text) || mentionsAny(r3.text, ['Fed', 'rate', 'CPI', 'jobs', 'inflation', 'earnings', 'sector', 'market'])],
  ]);
}

async function suite7_language() {
  console.log('\n── 7. LANGUAGE CONSISTENCY ────────────────────────────────────');

  const r1 = await chat({ systemContent: stockStub('AMZN'), userMessage: '¿cuál es el análisis técnico de AMZN?', currentTicker: 'AMZN', language: 'es' });
  check('Spanish question → Spanish response', r1, [
    ['Responds in Spanish',     isSpanish(r1.text)],
    ['Mentions AMZN',           mentionsTicker(r1.text, 'AMZN')],
    ['Has technical content',   mentionsAny(r1.text, ['VWAP', 'soporte', 'resistencia', 'support', 'resistance', 'volumen', 'precio'])],
  ]);

  const r2 = await chat({ systemContent: stockStub('META'), userMessage: 'Give me a full technical breakdown of META', currentTicker: 'META', language: 'en' });
  check('English question → English response', r2, [
    ['Responds in English',     isEnglish(r2.text)],
    ['Mentions META',           mentionsTicker(r2.text, 'META')],
    ['Has price data',          hasPricePat(r2.text)],
  ]);

  // Mid-conversation language switch EN→ES
  const msftFirst = await chat({ systemContent: stockStub('MSFT'), userMessage: 'tell me about MSFT', currentTicker: 'MSFT', language: 'en' });
  const msftSwitch = await chat({
    systemContent: followupStub('MSFT'),
    userMessage: 'ahora en español, ¿cuál es el setup?',
    currentTicker: 'MSFT',
    history: [
      { role: 'user',      content: 'tell me about MSFT' },
      { role: 'assistant', content: msftFirst.text.slice(0, 400) },
    ],
    language: 'es',
  });
  check('Language switch EN→ES mid-conversation', msftSwitch, [
    ['Switches to Spanish',     isSpanish(msftSwitch.text)],
    ['Still mentions MSFT',     mentionsTicker(msftSwitch.text, 'MSFT')],
  ]);

  // Mid-conversation language switch ES→EN
  const spyFirst = await chat({ systemContent: stockStub('SPY'), userMessage: 'háblame de SPY', currentTicker: 'SPY', language: 'es' });
  const spySwitch = await chat({
    systemContent: followupStub('SPY'),
    userMessage: 'now switch to English — what is the trend?',
    currentTicker: 'SPY',
    history: [
      { role: 'user',      content: 'háblame de SPY' },
      { role: 'assistant', content: spyFirst.text.slice(0, 400) },
    ],
    language: 'en',
  });
  check('Language switch ES→EN mid-conversation', spySwitch, [
    ['Switches to English',     isEnglish(spySwitch.text)],
    ['Mentions SPY',            mentionsTicker(spySwitch.text, 'SPY')],
  ]);
}

async function suite8_edgeCases() {
  console.log('\n── 8. EDGE CASES ──────────────────────────────────────────────');

  // Typos
  const r1 = await chat({ systemContent: stockStub('AAPL'), userMessage: 'tell me about APPL', currentTicker: 'AAPL', language: 'en' });
  check('Typo APPL (currentTicker=AAPL)', r1, [
    ['Responds without crash',       r1.status === 200],
    ['Has stock content',            hasPricePat(r1.text) || mentionsAny(r1.text, ['Apple', 'AAPL', 'stock', 'price'])],
    ['Substantive (>80 chars)',      r1.text.length > 80],
  ]);

  const r2 = await chat({ systemContent: GENERAL_STUB, userMessage: 'GOGL momentum play?', language: 'en' });
  check('Ambiguous ticker GOGL', r2, [
    ['Responds without crash',       r2.status === 200],
    ['Has meaningful content (>50)', r2.text.length > 50],
    ['No "no access" refusal',       !noAccessPhrase(r2.text)],
  ]);

  // Long question
  const longQ = [
    'I am an experienced day trader and I want a comprehensive analysis of NVDA right now.',
    'Please cover: (1) current price action and whether it is bullish or bearish today,',
    '(2) VWAP position and what it tells us about intraday bias,',
    '(3) relative strength vs SPY,',
    '(4) the candle pattern forming and its implication,',
    '(5) key support and resistance levels with exact prices,',
    '(6) any recent news catalyst driving the move,',
    '(7) whether volume is above or below average,',
    '(8) the 5-day trend direction,',
    '(9) an explicit trade setup with entry, stop, and two targets,',
    '(10) your overall recommendation — buy, sell, or wait — with specific reasoning.',
  ].join(' ');
  const r3 = await chat({ systemContent: stockStub('NVDA'), userMessage: longQ, currentTicker: 'NVDA', language: 'en' });
  check('Very long 10-part NVDA question', r3, [
    ['No length refusal',            !lengthRefusal(r3.text)],
    ['No "no access" refusal',       !noAccessPhrase(r3.text)],
    ['Substantive reply (>500 chars)', r3.text.length > 500],
    ['Has prices',                   hasPricePat(r3.text)],
    ['Mentions NVDA',                mentionsTicker(r3.text, 'NVDA')],
  ]);

  // Acknowledgments
  const r4 = await chat({ systemContent: GENERAL_STUB, userMessage: 'ok', language: 'en' });
  check('Bare acknowledgment "ok"', r4, [
    ['Responds usefully (>20 chars)', r4.text.length > 20],
    ['No crash',                      r4.status === 200],
  ]);

  const r5 = await chat({ systemContent: GENERAL_STUB, userMessage: 'gracias', language: 'es' });
  check('Spanish "gracias" acknowledgment', r5, [
    ['Responds usefully (>20 chars)', r5.text.length > 20],
    ['Responds in Spanish',           isSpanish(r5.text)],
  ]);

  // Garbage input
  const r6 = await chat({ systemContent: GENERAL_STUB, userMessage: '???', language: 'en' });
  check('Garbage input "???"', r6, [
    ['Responds without error',       r6.status === 200],
    ['Has some content (>10 chars)', r6.text.length > 10],
  ]);

  // No ticker in very open question
  const r7 = await chat({ systemContent: GENERAL_STUB, userMessage: 'what should I buy today?', language: 'en' });
  check('"What should I buy today?" (general)', r7, [
    ['Returns tickers',              hasTickerPat(r7.text)],
    ['Has price/% data',             hasPricePat(r7.text) || hasPctPat(r7.text)],
    ['No "no access" refusal',       !noAccessPhrase(r7.text)],
  ]);
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${'═'.repeat(65)}`);
  console.log(`  ChatStox AI Stress Test  ·  ${today}`);
  console.log(`  Backend: ${BACKEND}`);
  console.log(`${'═'.repeat(65)}`);
  console.log(`  ${'Test'.padEnd(46)} ${'Time'.padStart(6)}  ${'Chars'.padStart(6)}`);
  console.log(`  ${'─'.repeat(62)}`);

  await suite1_generalMarket();
  await suite2_stockRecs();
  await suite3_stockAnalysis();
  await suite4_followupContext();
  await suite5_ambiguous();
  await suite6_news();
  await suite7_language();
  await suite8_edgeCases();

  // ── Summary ──────────────────────────────────────────────────────────────

  const total   = allResults.length;
  const failList = allResults.filter(r => !r.ok);
  const warnList = allResults.filter(r => r.ok && r.warnings.length > 0);
  const avgMs   = Math.round(allResults.reduce((s, r) => s + r.elapsed, 0) / total);
  const slowest = allResults.reduce((a, r) => r.elapsed > a.elapsed ? r : a, allResults[0]);
  const fastest = allResults.reduce((a, r) => r.elapsed < a.elapsed ? r : a, allResults[0]);

  console.log(`\n${'═'.repeat(65)}`);
  console.log(`  RESULTS: ${total} tests  |  ✅ ${passed} passed  |  ❌ ${failList.length} failed  |  ⚠️  ${warnList.length} slow`);
  console.log(`  Timing: avg ${avgMs}ms · fastest "${fastest.label}" (${fastest.elapsed}ms) · slowest "${slowest.label}" (${slowest.elapsed}ms)`);
  console.log(`${'═'.repeat(65)}\n`);

  if (failList.length > 0) {
    console.log('── FAILURES ─────────────────────────────────────────────────────\n');
    for (const r of failList) {
      console.log(`❌  ${r.label}  (${r.elapsed}ms · ${r.chars} chars)`);
      for (const f of r.failures) console.log(`    • ${f}`);
      if (r.snippet) console.log(`    snippet: "${r.snippet}…"`);
      console.log();
    }
  }

  if (warnList.length > 0) {
    console.log('── SLOW TESTS ───────────────────────────────────────────────────\n');
    for (const r of warnList) {
      console.log(`⚠️   ${r.label}: ${r.warnings.join(' · ')}`);
    }
    console.log();
  }

  if (failList.length === 0 && warnList.length === 0) {
    console.log('✅  All tests passed with no warnings.\n');
  }

  process.exit(failList.length > 0 ? 1 : 0);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
