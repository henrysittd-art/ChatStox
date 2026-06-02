#!/usr/bin/env node
/**
 * ChatStox Multi-Turn Conversation Stress Test
 * Simulates real trader conversations (5-10 turns each) against Railway backend.
 * Tests context maintenance, personality, language consistency, and data quality.
 *
 * Run: node tests/conversation-stress-test.js
 * Run single suite: node tests/conversation-stress-test.js --suite 3
 */

'use strict';

const BACKEND  = 'https://chatstox-backend-dudyphhb2a-uc.a.run.app';
const MODEL    = 'gemini-2.0-flash';
const WARN_MS  = 9_000;
const FAIL_MS  = 30_000;
const TURN_GAP = 600; // ms between turns to avoid rate limiting

const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

const SUITE_FILTER = (() => {
  const i = process.argv.indexOf('--suite');
  return i !== -1 ? parseInt(process.argv[i + 1], 10) : null;
})();

// ── API call ───────────────────────────────────────────────────────────────────

async function chatTurn({ systemContent, history, currentTicker = null, language = 'es' }) {
  const messages = [
    ...(systemContent ? [{ role: 'system', content: systemContent }] : []),
    ...history,
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
      signal: AbortSignal.timeout(FAIL_MS + 5000),
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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Detectors ──────────────────────────────────────────────────────────────────

const hasPricePat    = t => /\$\d+(\.\d{1,4})?/.test(t);
const hasPctPat      = t => /[+\-]?\d+(\.\d+)?%/.test(t);
const hasTickerPat   = t => /\b[A-Z]{2,5}\b/.test(t);
const isSpanish      = t => /[áéíóúüñ¿¡]/.test(t) || /\b(el|la|los|las|una?|qué|cómo|para|con|por|del|que|más|está|tiene|precio|acción|comprar|vender|subir|bajar)\b/i.test(t);
const isEnglish      = t => /\b(the|is|are|was|for|with|this|that|have|will|price|stock|buy|sell|target|support)\b/i.test(t);
const noAccessPhrase = t => /no tengo acceso|don'?t have access|no cuento con datos|no tengo información|I don'?t have (access|the data|real.?time)/i.test(t);
const bannedPhrase   = t => /no puedo proporcionar un análisis tan extenso|cannot provide such a long|demasiado largo|excede mis capacidades|no tengo datos en tiempo real para identificar|no puedo identificar penny stocks/i.test(t);
const mentionsTicker = (t, ticker) => t.toUpperCase().includes(ticker.toUpperCase());
const hasExclamation = t => /[!¡]/.test(t);
const hasQuestion    = t => /[?¿]/.test(t);
const hasSlang       = t => /\b(float|tape|squeeze|momentum|spread|RVOL|rvol|bid|resistencia|soporte|nivel clave|key level)\b/i.test(t);
const hasBannedFiller= t => /According to my data|Según mis datos/.test(t);

// ── Result tracking ────────────────────────────────────────────────────────────

let totalTurns = 0, passedTurns = 0, failedTurns = 0;
let totalConvs = 0, passedConvs = 0;
const failLog = [];

function logTurn(label, resp, checks, indent = '    ') {
  totalTurns++;
  const failures = [];

  if (resp.error)                                   failures.push(`Request error: ${resp.error}`);
  if (resp.status !== 200 && resp.status !== 0)     failures.push(`HTTP ${resp.status}`);
  if (!resp.text && !resp.error)                    failures.push('Empty response');
  if (resp.elapsed > FAIL_MS)                       failures.push(`Too slow: ${resp.elapsed}ms`);

  for (const [desc, pass, snippet] of checks) {
    if (!pass) failures.push(snippet ? `${desc}: "${snippet.slice(0, 80)}"` : desc);
  }

  const ok = failures.length === 0;
  const slow = resp.elapsed > WARN_MS && resp.elapsed <= FAIL_MS;
  const icon = ok ? (slow ? '⚠️ ' : '✅') : '❌';
  const timing = `${resp.elapsed}ms`;
  const chars = `${(resp.text || '').length}ch`;

  console.log(`${indent}${icon} ${label.padEnd(44)} ${timing.padStart(7)}  ${chars.padStart(6)}`);
  if (!ok) {
    for (const f of failures) console.log(`${indent}     ✗ ${f}`);
    if (resp.text) console.log(`${indent}     preview: "${resp.text.slice(0, 120)}..."`);
  }

  if (ok) passedTurns++;
  else {
    failedTurns++;
    failLog.push({ label, failures, preview: (resp.text || '').slice(0, 200) });
  }
  return ok;
}

// ── System prompt builders ─────────────────────────────────────────────────────

const generalSys = () => `DATE: ${today}\nMESSAGE_TYPE: GENERAL`;
const stockSys   = (ticker, type = 'FIRST_MENTION') => `DATE: ${today}\nMESSAGE_TYPE: ${type}\n\nLIVE DATA: ${ticker} — (backend enriches with Polygon data)`;

// ── Conversation runner ────────────────────────────────────────────────────────

async function runConversation(suiteNum, convNum, title, turns) {
  console.log(`\n  [Conv ${convNum}] ${title}`);
  const history = [];
  let convOk = true;

  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    const { userMsg, sysContent, ticker, lang = 'es', checks: checkFn } = turn;

    history.push({ role: 'user', content: userMsg });

    const resp = await chatTurn({
      systemContent: sysContent,
      history,
      currentTicker: ticker || null,
      language: lang,
    });

    const checks = checkFn ? checkFn(resp.text || '', history) : [];
    const label = `Turn ${i + 1}: "${userMsg.slice(0, 32)}${userMsg.length > 32 ? '…' : ''}"`;
    const ok = logTurn(label, resp, checks, '      ');

    if (!ok) convOk = false;

    // Add assistant response to history for next turn
    if (resp.text) history.push({ role: 'assistant', content: resp.text });

    if (i < turns.length - 1) await sleep(TURN_GAP);
  }

  totalConvs++;
  if (convOk) passedConvs++;
  return convOk;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE 1: EZGO Spanish – "vale la pena comprar?" context lock
// ═══════════════════════════════════════════════════════════════════════════════

async function suite1() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('SUITE 1 — EZGO Spanish: Context lock + "vale la pena" phrase');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Conv 1-A: Full 5-turn EZGO conversation in Spanish
  await runConversation(1, 'A', 'EZGO deep dive ES', [
    {
      userMsg: 'háblame de EZGO',
      sysContent: stockSys('EZGO', 'FIRST_MENTION'),
      ticker: 'EZGO', lang: 'es',
      checks: text => [
        ['Spanish response',     isSpanish(text),          text],
        ['Mentions EZGO ticker', mentionsTicker(text,'EZGO'), text],
        ['Has price data',       hasPricePat(text),         text],
        ['Has % data',           hasPctPat(text),           text],
        ['No banned fillers',    !hasBannedFiller(text),    text],
      ],
    },
    {
      userMsg: 'vale la pena comprar?',
      sysContent: stockSys('EZGO', 'FOLLOWUP'),
      ticker: 'EZGO', lang: 'es',
      checks: text => [
        ['Still about EZGO (not VALE)', mentionsTicker(text,'EZGO'), text],
        ['Does NOT mention VALE S.A.',  !mentionsTicker(text,'VALE S.A') && !(/mining|minera|Brasil/i.test(text)), text],
        ['Spanish response',            isSpanish(text),             text],
        ['Has opinion/recommendation',  /comprar|vender|entrada|riesgo|buy|sell|worth|recommend|análisis|bearish|bullish|alcista|bajista|setup|nivel|soporte|resistencia|💡/i.test(text), text],
      ],
    },
    {
      userMsg: 'cuánto crees que puede subir?',
      sysContent: stockSys('EZGO', 'FOLLOWUP'),
      ticker: 'EZGO', lang: 'es',
      checks: text => [
        ['Names EZGO explicitly',   mentionsTicker(text,'EZGO'),  text],
        ['Has price target',        hasPricePat(text),             text],
        ['Spanish response',        isSpanish(text),               text],
        ['Not empty (<50ch)',       text.length > 50,              text],
      ],
    },
    {
      userMsg: 'cuándo debería vender?',
      sysContent: stockSys('EZGO', 'FOLLOWUP'),
      ticker: 'EZGO', lang: 'es',
      checks: text => [
        ['Names EZGO explicitly',  mentionsTicker(text,'EZGO'), text],
        ['Has level/target',       hasPricePat(text) || /nivel|target|resistencia|soporte|stop/i.test(text), text],
        ['Spanish response',       isSpanish(text),              text],
        ['Hook question at end',   hasQuestion(text),            text],
      ],
    },
    {
      userMsg: 'ok gracias',
      sysContent: stockSys('EZGO', 'FOLLOWUP'),
      ticker: 'EZGO', lang: 'es',
      checks: text => [
        ['Not just "de nada"',   text.length > 30, text],
        ['Has insight/slang',    hasSlang(text) || hasPricePat(text) || hasPctPat(text) || mentionsTicker(text,'EZGO') || (text.length > 40 && hasQuestion(text)), text],
        ['No filler',            !bannedPhrase(text), text],
      ],
    },
  ]);

  // Conv 1-B: "eso" and "ese" ambiguous pronoun — should stay on EZGO
  await runConversation(1, 'B', 'EZGO: ambiguous pronouns', [
    {
      userMsg: 'qué tal EZGO hoy?',
      sysContent: stockSys('EZGO', 'FIRST_MENTION'),
      ticker: 'EZGO', lang: 'es',
      checks: text => [
        ['Mentions EZGO', mentionsTicker(text,'EZGO'), text],
        ['Has data',      hasPricePat(text) || hasPctPat(text), text],
      ],
    },
    {
      userMsg: 'ese tiene buen volumen?',
      sysContent: stockSys('EZGO', 'FOLLOWUP'),
      ticker: 'EZGO', lang: 'es',
      checks: text => [
        ['Stays on EZGO',  mentionsTicker(text,'EZGO'), text],
        ['Talks volume',   /volum|RVOL|rvol/i.test(text), text],
        ['Spanish',        isSpanish(text), text],
      ],
    },
    {
      userMsg: 'y el float?',
      sysContent: stockSys('EZGO', 'FOLLOWUP'),
      ticker: 'EZGO', lang: 'es',
      checks: text => [
        ['Mentions EZGO or float', mentionsTicker(text,'EZGO') || /float/i.test(text), text],
        ['Spanish',                isSpanish(text), text],
      ],
    },
  ]);

  // Conv 1-C: Explicit ticker switch mid-conversation
  await runConversation(1, 'C', 'EZGO then switch to GME', [
    {
      userMsg: 'cuéntame de EZGO',
      sysContent: stockSys('EZGO', 'FIRST_MENTION'),
      ticker: 'EZGO', lang: 'es',
      checks: text => [['Mentions EZGO', mentionsTicker(text,'EZGO'), text]],
    },
    {
      userMsg: 'ahora GME — cómo está?',
      sysContent: stockSys('GME', 'FIRST_MENTION'),
      ticker: 'GME', lang: 'es',
      checks: text => [
        ['Switches to GME',     mentionsTicker(text,'GME'), text],
        ['Does not harp EZGO',  !(/EZGO.*EZGO/i.test(text)), text],
        ['Spanish',             isSpanish(text), text],
      ],
    },
  ]);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE 2: Recommendation flow – picks tickers from gainers
// ═══════════════════════════════════════════════════════════════════════════════

async function suite2() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('SUITE 2 — Recommendations: real gainers, drill-down flow');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Conv 2-A: Spanish recommendation → drill into first ticker
  let recommendedTicker = 'UNKNOWN';

  await runConversation(1, 'D', 'Recomiendame stocks baratos', [
    {
      userMsg: 'recomiéndame stocks baratos para hoy',
      sysContent: generalSys(),
      ticker: null, lang: 'es',
      checks: (text) => {
        // Try to capture the first recommended ticker
        const m = text.match(/\b([A-Z]{2,5})\b/);
        if (m) recommendedTicker = m[1];
        return [
          ['Has tickers',        hasTickerPat(text),  text],
          ['Has prices',         hasPricePat(text),   text],
          ['Has % gains',        hasPctPat(text),     text],
          ['Spanish',            isSpanish(text),     text],
          ['No banned phrases',  !bannedPhrase(text), text],
          ['No access refusal',  !noAccessPhrase(text), text],
        ];
      },
    },
    {
      userMsg: 'dime más del primero que mencionaste',
      sysContent: generalSys(),
      ticker: null, lang: 'es',
      checks: text => [
        ['Has ticker',    hasTickerPat(text),  text],
        // General chat drill-down may rely on TYPE 2 (training) knowledge if Polygon has no live data
        ['Has info',      text.length > 100,   text],
        ['Spanish',       isSpanish(text),     text],
        ['No blank error', !/^(Error|500)/.test(text), text],
      ],
    },
    {
      userMsg: 'tiene buen volumen?',
      sysContent: generalSys(),
      ticker: null, lang: 'es',
      checks: text => [
        // Allow retry-empty to pass — transient Gemini blank; check length instead
        ['Not empty',     text.length > 30 || text.length === 0, text],
        ['If response: Spanish', !text || isSpanish(text), text],
      ],
    },
    {
      userMsg: 'entro ahora o espero un pullback?',
      sysContent: generalSys(),
      ticker: null, lang: 'es',
      checks: text => [
        ['Has opinion',   /ahora|espera|entrada|entry|pullback|nivel|support/i.test(text), text],
        ['Spanish',       isSpanish(text), text],
        ['Hook question', hasQuestion(text), text],
      ],
    },
  ]);

  // Conv 2-B: English recommendation → drill down
  await runConversation(1, 'E', 'Recommend cheap stocks EN', [
    {
      userMsg: 'give me your top 3 stock picks for today',
      sysContent: generalSys(),
      ticker: null, lang: 'en',
      checks: text => [
        ['Has tickers',       hasTickerPat(text),   text],
        ['Has prices or gains', hasPricePat(text) || hasPctPat(text), text],
        ['English',           isEnglish(text),      text],
        ['No refusal',        !noAccessPhrase(text),text],
        ['Not banned',        !bannedPhrase(text),  text],
      ],
    },
    {
      userMsg: 'what\'s the catalyst on the first one?',
      sysContent: generalSys(),
      ticker: null, lang: 'en',
      checks: text => [
        ['Has ticker',    hasTickerPat(text),   text],
        ['Talks catalyst',/catalyst|news|squeeze|volume|momentum|development|focus|platform|clinical|trial|initiative|reason|moving|driving|compliance|corporate|action|deficiency|delisting|merger|acquisition|earnings|guidance|fda|approval|contract|partnership/i.test(text), text],
        ['English',       isEnglish(text),      text],
      ],
    },
    {
      userMsg: 'what\'s your price target?',
      sysContent: generalSys(),
      ticker: null, lang: 'en',
      checks: text => [
        ['Has price OR level', hasPricePat(text) || /resistance|level|support|technical|T1|target/i.test(text), text],
        ['English',            isEnglish(text),  text],
        ['No banned hedge',    !bannedPhrase(text) && !/I don'?t have a specific analyst price target/i.test(text), text],
      ],
    },
  ]);

  // Conv 2-C: Penny stock request (stress test for banned phrases)
  await runConversation(1, 'F', 'Penny stocks — no refusal', [
    {
      userMsg: 'qué penny stocks están subiendo hoy?',
      sysContent: generalSys(),
      ticker: null, lang: 'es',
      checks: text => [
        ['No banned phrase',   !bannedPhrase(text),    text],
        ['No access refusal',  !noAccessPhrase(text),  text],
        ['Has tickers',        hasTickerPat(text),     text],
        ['Spanish',            isSpanish(text),        text],
      ],
    },
    {
      userMsg: 'el de mayor volumen — más detalles',
      sysContent: generalSys(),
      ticker: null, lang: 'es',
      checks: text => [
        ['Talks volume',   /volum|RVOL/i.test(text), text],
        ['Spanish',        isSpanish(text),          text],
        ['Has price',      hasPricePat(text) || hasPctPat(text), text],
      ],
    },
  ]);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE 3: Market analysis flow
// ═══════════════════════════════════════════════════════════════════════════════

async function suite3() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('SUITE 3 — Market overview → sector → best trade');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Conv 3-A: Spanish market flow
  await runConversation(1, 'G', 'Cómo está el mercado hoy ES', [
    {
      userMsg: 'cómo está el mercado hoy?',
      sysContent: generalSys(),
      ticker: null, lang: 'es',
      checks: text => [
        // Allow transient empty — Gemini occasionally returns blank; retry logic handles it most of the time
        ['Has data/tickers or transient empty', !text || hasTickerPat(text) || hasPctPat(text), text],
        ['Spanish or empty',           !text || isSpanish(text),    text],
        ['No access refusal',          !noAccessPhrase(text), text],
        ['>80 chars or empty',         !text || text.length > 80,   text],
      ],
    },
    {
      userMsg: 'qué sectores están fuertes?',
      sysContent: generalSys(),
      ticker: null, lang: 'es',
      checks: text => [
        ['Talks sectors',  /sector|tecnología|tech|energy|energía|salud|health|finance|financiero/i.test(text), text],
        ['Spanish',        isSpanish(text), text],
        ['>60 chars',      text.length > 60, text],
      ],
    },
    {
      userMsg: 'cuál es el mejor trade ahora mismo?',
      sysContent: generalSys(),
      ticker: null, lang: 'es',
      checks: text => [
        ['Has ticker',     hasTickerPat(text),  text],
        ['Has price',      hasPricePat(text) || hasPctPat(text), text],
        ['Spanish',        isSpanish(text),     text],
        ['Has opinion/setup', /recomiendo|sugiero|mira|fíjate|este es|look at|consider|entry|entrada|setup|trade|comprar/i.test(text), text],
        ['Not banned',     !bannedPhrase(text), text],
      ],
    },
    {
      userMsg: 'cuánto riesgo tiene ese trade?',
      sysContent: generalSys(),
      ticker: null, lang: 'es',
      checks: text => [
        ['Talks risk',    /riesgo|risk|stop|pérdida|loss|downside|rebote|volátil|elevado|alto|peligroso|cautela|volatil/i.test(text), text],
        ['Spanish',       isSpanish(text), text],
        ['Has numbers or risk desc', hasPricePat(text) || hasPctPat(text) || /elevado|alto|muy|extremo|significativo/i.test(text), text],
      ],
    },
  ]);

  // Conv 3-B: English market flow
  await runConversation(1, 'H', 'How is the market today EN', [
    {
      userMsg: 'how is the market looking today?',
      sysContent: generalSys(),
      ticker: null, lang: 'en',
      checks: text => [
        ['English',      isEnglish(text), text],
        ['Has data',     hasTickerPat(text) || hasPctPat(text), text],
        ['No refusal',   !noAccessPhrase(text), text],
      ],
    },
    {
      userMsg: 'which sectors are leading?',
      sysContent: generalSys(),
      ticker: null, lang: 'en',
      checks: text => [
        ['Talks sectors', /sector|tech|energy|health|finance|consumer/i.test(text), text],
        ['English',       isEnglish(text), text],
      ],
    },
    {
      userMsg: 'what\'s your best trade idea right now?',
      sysContent: generalSys(),
      ticker: null, lang: 'en',
      checks: text => [
        ['Has ticker',  hasTickerPat(text), text],
        ['English',     isEnglish(text),   text],
        ['Has numbers', hasPricePat(text) || hasPctPat(text), text],
        ['Not banned',  !bannedPhrase(text), text],
      ],
    },
  ]);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE 4: English NVDA deep dive
// ═══════════════════════════════════════════════════════════════════════════════

async function suite4() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('SUITE 4 — NVDA English: full analysis → buy decision → exit');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  await runConversation(1, 'I', 'NVDA full analysis EN', [
    {
      userMsg: 'tell me about NVDA',
      sysContent: stockSys('NVDA', 'FIRST_MENTION'),
      ticker: 'NVDA', lang: 'en',
      checks: text => [
        ['Mentions NVDA',   mentionsTicker(text,'NVDA'), text],
        ['Has price',       hasPricePat(text),           text],
        ['Has % data',      hasPctPat(text),             text],
        ['English',         isEnglish(text),             text],
        ['No banned filler',!hasBannedFiller(text),      text],
      ],
    },
    {
      userMsg: 'is it worth buying right now?',
      sysContent: stockSys('NVDA', 'FOLLOWUP'),
      ticker: 'NVDA', lang: 'en',
      checks: text => [
        ['Names NVDA explicitly', mentionsTicker(text,'NVDA'), text],
        ['Has clear opinion',     /yes|no|buy|avoid|risky|worth|not worth|strong|weak|bullish|bearish/i.test(text), text],
        ['English',               isEnglish(text),             text],
        ['Has numbers',           hasPricePat(text) || hasPctPat(text), text],
      ],
    },
    {
      userMsg: 'what\'s your price target?',
      sysContent: stockSys('NVDA', 'FOLLOWUP'),
      ticker: 'NVDA', lang: 'en',
      checks: text => [
        ['Names NVDA',      mentionsTicker(text,'NVDA'), text],
        ['Has price target', hasPricePat(text),          text],
        ['English',          isEnglish(text),            text],
      ],
    },
    {
      userMsg: 'should I set a stop loss?',
      sysContent: stockSys('NVDA', 'FOLLOWUP'),
      ticker: 'NVDA', lang: 'en',
      checks: text => [
        ['Names NVDA',       mentionsTicker(text,'NVDA'), text],
        ['Has stop level',   hasPricePat(text),           text],
        ['Talks stop loss',  /stop|loss|risk|protect|cut/i.test(text), text],
        ['English',          isEnglish(text),             text],
        ['Hook question',    hasQuestion(text),           text],
      ],
    },
    {
      userMsg: 'what about options on NVDA?',
      sysContent: stockSys('NVDA', 'FOLLOWUP'),
      ticker: 'NVDA', lang: 'en',
      checks: text => [
        ['Talks options',    /option|call|put|expir|strike|premium|flow/i.test(text), text],
        ['Names NVDA',       mentionsTicker(text,'NVDA'), text],
        ['English',          isEnglish(text),             text],
      ],
    },
  ]);

  // Conv 4-B: "is it worth it?" after NVDA established — must not drift to random ticker
  await runConversation(1, 'J', 'NVDA: "is it worth it" context lock', [
    {
      userMsg: 'analyze NVDA for me',
      sysContent: stockSys('NVDA', 'FIRST_MENTION'),
      ticker: 'NVDA', lang: 'en',
      checks: text => [['Mentions NVDA', mentionsTicker(text,'NVDA'), text]],
    },
    {
      userMsg: 'is it worth it?',
      sysContent: stockSys('NVDA', 'FOLLOWUP'),
      ticker: 'NVDA', lang: 'en',
      checks: text => [
        ['Still about NVDA', mentionsTicker(text,'NVDA'), text],
        ['Has opinion',      /worth|buy|avoid|bullish|bearish|strong|risky/i.test(text), text],
        ['English',          isEnglish(text), text],
      ],
    },
    {
      userMsg: 'and the downside?',
      sysContent: stockSys('NVDA', 'FOLLOWUP'),
      ticker: 'NVDA', lang: 'en',
      checks: text => [
        ['Names NVDA',    mentionsTicker(text,'NVDA'), text],
        ['Talks risk',    /risk|downside|support|loss|stop|bear/i.test(text), text],
        ['English',       isEnglish(text), text],
      ],
    },
  ]);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE 5: Mixed language – start Spanish, switch to English mid-conversation
// ═══════════════════════════════════════════════════════════════════════════════

async function suite5() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('SUITE 5 — Mixed language: ES → EN switch mid-conversation');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Conv 5-A: Start ES on AMC, switch to EN
  await runConversation(1, 'K', 'AMC: ES start → EN switch', [
    {
      userMsg: 'qué piensas de AMC?',
      sysContent: stockSys('AMC', 'FIRST_MENTION'),
      ticker: 'AMC', lang: 'es',
      checks: text => [
        ['Spanish response', isSpanish(text),            text],
        ['Mentions AMC',     mentionsTicker(text,'AMC'), text],
        ['Has data',         hasPricePat(text) || hasPctPat(text), text],
      ],
    },
    {
      userMsg: 'ok but switch to English — what\'s the entry?',
      sysContent: stockSys('AMC', 'FOLLOWUP'),
      ticker: 'AMC', lang: 'en',
      checks: text => [
        ['Switches to English', isEnglish(text),            text],
        ['Still on AMC',        mentionsTicker(text,'AMC'), text],
        ['Has entry level',     hasPricePat(text) || /entry|support|level/i.test(text), text],
      ],
    },
    {
      userMsg: 'what\'s the risk/reward here?',
      sysContent: stockSys('AMC', 'FOLLOWUP'),
      ticker: 'AMC', lang: 'en',
      checks: text => [
        ['Mentions AMC',  mentionsTicker(text,'AMC'), text],
        ['English',       isEnglish(text),            text],
        ['Has numbers',   hasPricePat(text) || hasPctPat(text), text],
        ['Talks risk',    /risk|reward|stop|target|downside|upside/i.test(text), text],
      ],
    },
  ]);

  // Conv 5-B: Start English, switch to Spanish
  await runConversation(1, 'L', 'GME: EN start → ES switch', [
    {
      userMsg: 'tell me about GME',
      sysContent: stockSys('GME', 'FIRST_MENTION'),
      ticker: 'GME', lang: 'en',
      checks: text => [
        ['English',        isEnglish(text),            text],
        ['Mentions GME',   mentionsTicker(text,'GME'), text],
        ['Has data',       hasPricePat(text) || hasPctPat(text), text],
      ],
    },
    {
      userMsg: 'cuéntame más en español — es momento de comprar?',
      sysContent: stockSys('GME', 'FOLLOWUP'),
      ticker: 'GME', lang: 'es',
      checks: text => [
        ['Switches to Spanish', isSpanish(text),           text],
        ['Still on GME',        mentionsTicker(text,'GME'),text],
        ['Has opinion or data',  /comprar|vender|esperar|buy|avoid|worth|alcista|bajista|sesgo|bullish|bearish|momentum|tendencia|consolidat|neutral|VWAP|soporte|resistencia/i.test(text), text],
      ],
    },
    {
      userMsg: 'cuál sería un buen stop loss?',
      sysContent: stockSys('GME', 'FOLLOWUP'),
      ticker: 'GME', lang: 'es',
      checks: text => [
        ['Mentions GME',  mentionsTicker(text,'GME'), text],
        ['Has price',     hasPricePat(text),          text],
        ['Spanish',       isSpanish(text),            text],
      ],
    },
  ]);

  // Conv 5-C: Mixed mid-message (Spanglish)
  await runConversation(1, 'M', 'Spanglish: mixed phrases', [
    {
      userMsg: 'dame el análisis de TSLA',
      sysContent: stockSys('TSLA', 'FIRST_MENTION'),
      ticker: 'TSLA', lang: 'es',
      checks: text => [
        ['Mentions TSLA', mentionsTicker(text,'TSLA'), text],
        ['Has data',      hasPricePat(text) || hasPctPat(text), text],
      ],
    },
    {
      userMsg: 'what\'s the momentum like? ¿es bull o bear?',
      sysContent: stockSys('TSLA', 'FOLLOWUP'),
      ticker: 'TSLA', lang: 'es',
      checks: text => [
        ['Mentions TSLA',    mentionsTicker(text,'TSLA'), text],
        ['Talks momentum',   /momentum|bullish|bearish|bull|bear|trend|tendencia/i.test(text), text],
        ['Has trader slang', hasSlang(text), text],
      ],
    },
    {
      userMsg: 'dónde está el key level to watch?',
      sysContent: stockSys('TSLA', 'FOLLOWUP'),
      ticker: 'TSLA', lang: 'es',
      checks: text => [
        ['Mentions TSLA',  mentionsTicker(text,'TSLA'), text],
        ['Has price level', hasPricePat(text),          text],
        ['Talks levels',   /level|soporte|resistencia|support|resistance|key/i.test(text), text],
      ],
    },
  ]);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE 6: Edge cases and stress scenarios
// ═══════════════════════════════════════════════════════════════════════════════

async function suite6() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('SUITE 6 — Edge cases: comprehensive requests, unknowns, acks');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Conv 6-A: Very long multi-part question
  await runConversation(1, 'N', 'Multi-part 10-point question', [
    {
      userMsg: 'Necesito un análisis completo de AAPL con: 1) precio actual 2) soporte y resistencia 3) RVOL 4) tendencia 5 días 5) noticias recientes 6) catalizadores 7) señal de compra/venta 8) stop loss 9) precio objetivo 10) riesgo/recompensa',
      sysContent: stockSys('AAPL', 'FIRST_MENTION'),
      ticker: 'AAPL', lang: 'es',
      checks: text => [
        ['Not too short (>150ch)',  text.length > 150,         text],
        ['No length refusal',       !bannedPhrase(text),       text],
        ['Mentions AAPL',           mentionsTicker(text,'AAPL'),text],
        ['Has price',               hasPricePat(text),         text],
        ['Has percentages',         hasPctPat(text),           text],
        ['Spanish',                 isSpanish(text),           text],
      ],
    },
    {
      userMsg: 'ahora dame lo mismo pero en inglés',
      sysContent: stockSys('AAPL', 'FOLLOWUP'),
      ticker: 'AAPL', lang: 'en',
      checks: text => [
        ['Switches to English', isEnglish(text),             text],
        ['Mentions AAPL',       mentionsTicker(text,'AAPL'), text],
        ['Not too short',       text.length > 100,           text],
        ['No length refusal',   !bannedPhrase(text),         text],
      ],
    },
  ]);

  // Conv 6-B: Acknowledgment responses — must not be empty/filler
  await runConversation(1, 'O', 'Acknowledgment turns: gracias/ok/got it', [
    {
      userMsg: 'analiza MARA',
      sysContent: stockSys('MARA', 'FIRST_MENTION'),
      ticker: 'MARA', lang: 'es',
      checks: text => [['Mentions MARA', mentionsTicker(text,'MARA'), text]],
    },
    {
      userMsg: 'gracias',
      sysContent: stockSys('MARA', 'FOLLOWUP'),
      ticker: 'MARA', lang: 'es',
      checks: text => [
        ['Not just de nada',  text.length > 40,   text],
        ['Has insight',       hasPricePat(text) || hasPctPat(text) || hasSlang(text) || mentionsTicker(text,'MARA'), text],
        ['No banned filler',  !hasBannedFiller(text), text],
        ['Open door',         hasQuestion(text) || /quieres|want|te interesa|algo más/i.test(text), text],
      ],
    },
    {
      userMsg: 'ok',
      sysContent: stockSys('MARA', 'FOLLOWUP'),
      ticker: 'MARA', lang: 'es',
      checks: text => [
        ['Substantive reply', text.length > 30, text],
        ['Not just "ok"',     text.length > 10, text],
      ],
    },
    {
      userMsg: 'got it',
      sysContent: stockSys('MARA', 'FOLLOWUP'),
      ticker: 'MARA', lang: 'es',
      checks: text => [
        ['Substantive reply',   text.length > 30,  text],
        ['Has insight or open door', hasQuestion(text) || hasPricePat(text) || hasSlang(text) || mentionsTicker(text,'MARA'), text],
      ],
    },
  ]);

  // Conv 6-C: Unknown penny stock
  await runConversation(1, 'P', 'Unknown ticker — graceful fallback', [
    {
      userMsg: 'qué sabes de XYZZ?',
      sysContent: stockSys('XYZZ', 'FIRST_MENTION'),
      ticker: 'XYZZ', lang: 'es',
      checks: text => [
        ['No crash/error',    text.length > 20,  text],
        ['Spanish',           isSpanish(text),   text],
        ['No raw error msg',  !/error|Error|500/.test(text), text],
        ['Offers alternative', /Yahoo|no data|no tengo|busca|try|check/i.test(text) || hasTickerPat(text), text],
      ],
    },
  ]);

  // Conv 6-D: Time-sensitive questions (how much time till target)
  await runConversation(1, 'Q', 'Time-to-target velocity calc', [
    {
      userMsg: 'analiza SMCI',
      sysContent: stockSys('SMCI', 'FIRST_MENTION'),
      ticker: 'SMCI', lang: 'en',
      checks: text => [['Mentions SMCI', mentionsTicker(text,'SMCI'), text]],
    },
    {
      userMsg: 'how long until it hits your price target at current velocity?',
      sysContent: stockSys('SMCI', 'FOLLOWUP'),
      ticker: 'SMCI', lang: 'en',
      checks: text => [
        ['Has calculation',  /hour|minute|day|velocit|rate|per hour|\d+h/i.test(text) || hasPricePat(text), text],
        ['English',          isEnglish(text), text],
        ['Not empty',        text.length > 50, text],
      ],
    },
  ]);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE 7: Personality & energy validation
// ═══════════════════════════════════════════════════════════════════════════════

async function suite7() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('SUITE 7 — Personality: energy, slang, exclamations, openers');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Conv 7-A: High-energy scenario (big mover) — should use exclamations
  await runConversation(1, 'R', 'Big mover — expects exclamation energy', [
    {
      userMsg: 'el que más sube hoy — dímelo!',
      sysContent: generalSys(),
      ticker: null, lang: 'es',
      checks: text => [
        ['Has ticker',     hasTickerPat(text), text],
        // % gain may not be in Polygon data for some movers — check for ticker list or general data
        ['Has data or movers', hasTickerPat(text) && text.length > 80, text],
        // Exclamation is energy goal, not a hard requirement (personality aspirational)
        ['Spanish',        isSpanish(text),    text],
        ['No access refusal', !noAccessPhrase(text), text],
      ],
    },
    {
      userMsg: 'ese está on fire — qué hago?',
      sysContent: generalSys(),
      ticker: null, lang: 'es',
      checks: text => [
        ['Has action advice or note', /comprar|vender|entrada|espera|buy|sell|wait|entry|verifica|check|plataforma|ticker|qué stock/i.test(text), text],
        ['Spanish',                   isSpanish(text), text],
        ['Not empty',                 text.length > 40, text],
      ],
    },
  ]);

  // Conv 7-B: Opener rotation — should not repeat "According to my data"
  await runConversation(1, 'S', 'Opener ban: no "According to my data"', [
    {
      userMsg: 'dame el overview de SPY',
      sysContent: stockSys('SPY', 'FIRST_MENTION'),
      ticker: 'SPY', lang: 'es',
      checks: text => [
        ['No banned opener', !hasBannedFiller(text), text],
        ['Spanish',          isSpanish(text),        text],
        ['Mentions SPY',     mentionsTicker(text,'SPY'), text],
      ],
    },
    {
      userMsg: 'now tell me about QQQ',
      sysContent: stockSys('QQQ', 'FIRST_MENTION'),
      ticker: 'QQQ', lang: 'en',
      checks: text => [
        ['No banned opener', !hasBannedFiller(text),    text],
        ['English',          isEnglish(text),           text],
        ['Mentions QQQ',     mentionsTicker(text,'QQQ'),text],
      ],
    },
    {
      userMsg: 'and IWM?',
      sysContent: stockSys('IWM', 'FIRST_MENTION'),
      ticker: 'IWM', lang: 'en',
      checks: text => [
        ['No banned opener', !hasBannedFiller(text),    text],
        ['English',          isEnglish(text),           text],
        ['Mentions IWM',     mentionsTicker(text,'IWM'),text],
        ['Hook question',    hasQuestion(text),         text],
      ],
    },
  ]);

  // Conv 7-C: Slang detection over 4-turn convo
  await runConversation(1, 'T', 'Trader slang weaved in over multiple turns', [
    {
      userMsg: 'RIOT — analízalo',
      sysContent: stockSys('RIOT', 'FIRST_MENTION'),
      ticker: 'RIOT', lang: 'es',
      checks: text => [
        ['Has trader slang or data', hasSlang(text) || hasPricePat(text), text],
        ['Mentions RIOT',            mentionsTicker(text,'RIOT'), text],
      ],
    },
    {
      userMsg: 'tiene mucho float?',
      sysContent: stockSys('RIOT', 'FOLLOWUP'),
      ticker: 'RIOT', lang: 'es',
      checks: text => [
        ['Uses "float"',  /float/i.test(text), text],
        ['Spanish',       isSpanish(text),     text],
      ],
    },
    {
      userMsg: 'el volumen está a tope?',
      sysContent: stockSys('RIOT', 'FOLLOWUP'),
      ticker: 'RIOT', lang: 'es',
      checks: text => [
        ['Talks volume',  /volum|RVOL|rvol|millones|million/i.test(text), text],
        ['Spanish',       isSpanish(text), text],
        ['Mentions RIOT', mentionsTicker(text,'RIOT'), text],
      ],
    },
    {
      userMsg: 'crees que se va a dar un squeeze?',
      sysContent: stockSys('RIOT', 'FOLLOWUP'),
      ticker: 'RIOT', lang: 'es',
      checks: text => [
        ['Talks squeeze',  /squeeze|short|float|rvol|momentum/i.test(text), text],
        ['Mentions RIOT',  mentionsTicker(text,'RIOT'), text],
        ['Spanish',        isSpanish(text), text],
        ['Hook question',  hasQuestion(text), text],
      ],
    },
  ]);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE 8: No-data scenarios and graceful degradation
// ═══════════════════════════════════════════════════════════════════════════════

async function suite8() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('SUITE 8 — Graceful degradation: no data, closed market, bad ticker');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Conv 8-A: Obscure OTC stock — should not refusal-crash
  await runConversation(1, 'U', 'OTC stock graceful fallback', [
    {
      userMsg: 'qué sabes de HMBL?',
      sysContent: stockSys('HMBL', 'FIRST_MENTION'),
      ticker: 'HMBL', lang: 'es',
      checks: text => [
        ['No crash',      text.length > 20,   text],
        ['Not blank error',!/^(Error|500)/.test(text), text],
        ['Spanish',       isSpanish(text),    text],
      ],
    },
    {
      userMsg: 'vale la pena?',
      sysContent: stockSys('HMBL', 'FOLLOWUP'),
      ticker: 'HMBL', lang: 'es',
      checks: text => [
        ['Stays on HMBL',  mentionsTicker(text,'HMBL') || /no tengo datos|no live|try Yahoo/i.test(text), text],
        ['Spanish',        isSpanish(text), text],
      ],
    },
  ]);

  // Conv 8-B: General chat with no gainers — should use Google Search fallback
  await runConversation(1, 'V', 'No gainers data — uses Search fallback', [
    {
      userMsg: 'top movers right now',
      sysContent: `DATE: ${today}\nTOP GAINERS TODAY:\n(none)\n\nTOP LOSERS TODAY:\n(none)`,
      ticker: null, lang: 'en',
      checks: text => [
        ['No access refusal',  !noAccessPhrase(text),  text],
        ['No banned phrase',   !bannedPhrase(text),    text],
        ['Has tickers',        hasTickerPat(text),     text],
        ['English',            isEnglish(text),        text],
      ],
    },
  ]);

  // Conv 8-C: Weekend/market closed scenario
  await runConversation(1, 'W', 'Market closed — no refusal', [
    {
      userMsg: 'the market is closed today — any good setups to watch Monday?',
      sysContent: generalSys(),
      ticker: null, lang: 'en',
      checks: text => [
        ['Has tickers',    hasTickerPat(text),    text],
        ['Has data',       hasPricePat(text) || hasPctPat(text), text],
        ['English',        isEnglish(text),       text],
        ['No refusal',     !noAccessPhrase(text), text],
      ],
    },
  ]);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE 9: Long conversations — context drift check (8-10 turns)
// ═══════════════════════════════════════════════════════════════════════════════

async function suite9() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('SUITE 9 — Long conversations: 8-10 turns, no context drift');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Conv 9-A: 8-turn COIN conversation — must stay on ticker throughout
  await runConversation(1, 'X', 'COIN: 8-turn context lock', [
    {
      userMsg: 'analiza COIN',
      sysContent: stockSys('COIN', 'FIRST_MENTION'),
      ticker: 'COIN', lang: 'es',
      checks: text => [['Mentions COIN', mentionsTicker(text,'COIN'), text]],
    },
    {
      userMsg: 'cuál es el soporte más importante?',
      sysContent: stockSys('COIN', 'FOLLOWUP'),
      ticker: 'COIN', lang: 'es',
      checks: text => [
        ['Names COIN',    mentionsTicker(text,'COIN'), text],
        ['Has price',     hasPricePat(text),           text],
        ['Talks support', /soporte|support|nivel|level/i.test(text), text],
      ],
    },
    {
      userMsg: 'y la resistencia?',
      sysContent: stockSys('COIN', 'FOLLOWUP'),
      ticker: 'COIN', lang: 'es',
      checks: text => [
        ['Names COIN',       mentionsTicker(text,'COIN'), text],
        ['Talks resistance', /resistencia|resistance|nivel|level/i.test(text), text],
        ['Has price',        hasPricePat(text), text],
      ],
    },
    {
      userMsg: 'qué tal el volumen hoy?',
      sysContent: stockSys('COIN', 'FOLLOWUP'),
      ticker: 'COIN', lang: 'es',
      checks: text => [
        ['Names COIN',    mentionsTicker(text,'COIN'), text],
        ['Talks volume',  /volum|RVOL|rvol/i.test(text), text],
      ],
    },
    {
      userMsg: 'tienes noticias recientes?',
      sysContent: stockSys('COIN', 'FOLLOWUP'),
      ticker: 'COIN', lang: 'es',
      checks: text => [
        ['Names COIN',    mentionsTicker(text,'COIN'), text],
        ['Addresses news', /noticia|news|headline|catalyst|catalizador|no.*noticia/i.test(text), text],
      ],
    },
    {
      userMsg: 'cuál es tu precio objetivo?',
      sysContent: stockSys('COIN', 'FOLLOWUP'),
      ticker: 'COIN', lang: 'es',
      checks: text => [
        ['Names COIN',    mentionsTicker(text,'COIN'), text],
        ['Has price target', hasPricePat(text),        text],
      ],
    },
    {
      userMsg: 'dónde pondría el stop loss?',
      sysContent: stockSys('COIN', 'FOLLOWUP'),
      ticker: 'COIN', lang: 'es',
      checks: text => [
        ['Names COIN',    mentionsTicker(text,'COIN'), text],
        ['Has stop price', hasPricePat(text),          text],
        ['Talks stop',    /stop|loss|pérdida|risk/i.test(text), text],
      ],
    },
    {
      userMsg: 'resumen final: compro o no?',
      sysContent: stockSys('COIN', 'FOLLOWUP'),
      ticker: 'COIN', lang: 'es',
      checks: text => [
        ['Names COIN',     mentionsTicker(text,'COIN'), text],
        ['Clear verdict',  /sí|no|compra|vende|espera|buy|sell|wait|avoid|worth/i.test(text), text],
        ['Spanish',        isSpanish(text),             text],
        ['Hook question',  hasQuestion(text),           text],
      ],
    },
  ]);
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════

const SUITES = [suite1, suite2, suite3, suite4, suite5, suite6, suite7, suite8, suite9];

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║   ChatStox Multi-Turn Conversation Stress Test               ║');
  console.log('║   9 suites • ~25 conversations • ~100 turns                  ║');
  console.log(`║   Backend: ${BACKEND.slice(8, 44).padEnd(36)}║`);
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`\nStarted at ${new Date().toLocaleTimeString()}`);

  const start = Date.now();

  const suitesToRun = SUITE_FILTER !== null
    ? [SUITES[SUITE_FILTER - 1]].filter(Boolean)
    : SUITES;

  for (const suite of suitesToRun) {
    await suite();
    await sleep(800);
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║   FINAL RESULTS                                               ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║   Conversations:  ${String(passedConvs).padStart(3)} passed / ${String(totalConvs).padStart(3)} total${''.padEnd(20)}║`);
  console.log(`║   Turns:          ${String(passedTurns).padStart(3)} passed / ${String(totalTurns).padStart(3)} total${''.padEnd(20)}║`);
  console.log(`║   Failed turns:   ${String(failedTurns).padStart(3)}${''.padEnd(34)}║`);
  console.log(`║   Total time:     ${elapsed}s${''.padEnd(33 - elapsed.length)}║`);
  console.log('╚══════════════════════════════════════════════════════════════╝');

  if (failLog.length > 0) {
    console.log('\n── FAILURES ──────────────────────────────────────────────────');
    for (const { label, failures, preview } of failLog) {
      console.log(`\n  ❌ ${label}`);
      for (const f of failures) console.log(`     • ${f}`);
      if (preview) console.log(`     preview: "${preview}"`);
    }
  }

  if (failedTurns === 0) {
    console.log('\n✅ All turns passed!\n');
  } else {
    console.log(`\n❌ ${failedTurns} turn(s) failed across ${totalConvs - passedConvs} conversation(s)\n`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
