/**
 * test_news_relevance.js
 * Tests the news specificity filtering logic in aiService buildSystemPrompt.
 * Run: node test_news_relevance.js
 */

// ── Reproduce the filtering logic from aiService.js ──────────────────────────

function filterNews(ticker, name, news) {
  const tickerUpper = ticker.toUpperCase();
  const tickerRegex = new RegExp(`\\b${tickerUpper}\\b`);
  const allNews = news || [];

  const specificNews = allNews.filter(n => {
    if (Array.isArray(n.tickers) && n.tickers.map(t => t.toUpperCase()).includes(tickerUpper)) return true;
    const text = `${n.headline || ''} ${n.description || ''}`.toUpperCase();
    return tickerRegex.test(text);
  });
  const generalNews = allNews.filter(n => !specificNews.includes(n));
  return { specificNews, generalNews, allNews };
}

function buildNewsBlock(ticker, name, news) {
  const tickerUpper = ticker.toUpperCase();
  const { specificNews, generalNews, allNews } = filterNews(ticker, name, news);
  const hasSpecificNews = specificNews.length > 0;
  const hasAnyNews = allNews.length > 0;

  const fmtLine = (n, i) =>
    `  ${i + 1}. ${n.headline} (tickers: ${(n.tickers || []).join(',') || 'none'})`;

  let newsBlock = '';
  if (hasSpecificNews) {
    newsBlock = `NEWS: ${tickerUpper}-SPECIFIC (${specificNews.length} headline(s)):\n${specificNews.map(fmtLine).join('\n')}`;
    if (generalNews.length > 0) {
      newsBlock += `\n\nGENERAL MARKET NEWS (NOT about ${tickerUpper}):\n${generalNews.slice(0, 3).map(fmtLine).join('\n')}`;
    }
  } else if (hasAnyNews) {
    newsBlock = `⚠️ NO ${tickerUpper}-SPECIFIC NEWS FOUND. General market headlines only:\n${allNews.slice(0, 3).map(fmtLine).join('\n')}`;
  } else {
    newsBlock = `(no news data)`;
  }

  let catalystInstruction;
  if (hasSpecificNews) {
    catalystInstruction = `→ CATALYST: cite most relevant headline from "${tickerUpper}-SPECIFIC" block`;
  } else if (hasAnyNews) {
    catalystInstruction = `→ CATALYST: say "No encontré noticias específicas de ${tickerUpper} hoy. La noticia más reciente relacionada con el mercado es: [${allNews[0]?.headline}]"`;
  } else {
    catalystInstruction = `→ CATALYST: infer from price/volume data, end with "Recomiendo verificar las noticias..."`;
  }

  return { newsBlock, catalystInstruction };
}

// ── Test data ─────────────────────────────────────────────────────────────────

const ES_NEWS_GENERAL_ONLY = [
  {
    headline: 'S&P 500 futures edge higher ahead of Fed decision',
    tickers: ['SPY', 'QQQ'],
  },
  {
    headline: 'Bond yields rise as investors await inflation data',
    tickers: [],
  },
  {
    headline: 'Oil prices drop amid OPEC uncertainty',
    tickers: ['USO'],
  },
];

const ES_NEWS_MIXED = [
  {
    headline: 'S&P 500 futures edge higher ahead of Fed decision',
    tickers: ['SPY', 'QQQ'],
  },
  {
    headline: 'ES futures hit session high after CPI print comes in cool',
    tickers: ['ES'],
    description: 'ES /ES futures rallied sharply after the CPI data...',
  },
];

const PLUG_NEWS_SPECIFIC = [
  {
    headline: 'PLUG Power secures $50M DOE grant for green hydrogen expansion',
    tickers: ['PLUG'],
  },
  {
    headline: 'Energy sector rotation continues as oil pulls back',
    tickers: ['XLE'],
  },
];

const PLUG_NEWS_GENERAL_ONLY = [
  {
    headline: 'Energy sector sees broad selloff on rising rates',
    tickers: ['XLE', 'XOM'],
  },
  {
    headline: 'Fed signals two rate cuts possible in 2025',
    tickers: [],
  },
];

const NO_NEWS = [];

// ── Run tests ─────────────────────────────────────────────────────────────────

const tests = [
  { label: 'ES — general market news only (no ES mention)', ticker: 'ES', name: 'E-mini S&P 500', news: ES_NEWS_GENERAL_ONLY },
  { label: 'ES — mixed (one ES-specific + general)', ticker: 'ES', name: 'E-mini S&P 500', news: ES_NEWS_MIXED },
  { label: 'PLUG — specific news present', ticker: 'PLUG', name: 'Plug Power', news: PLUG_NEWS_SPECIFIC },
  { label: 'PLUG — general market news only (no PLUG mention)', ticker: 'PLUG', name: 'Plug Power', news: PLUG_NEWS_GENERAL_ONLY },
  { label: 'PLUG — no news at all', ticker: 'PLUG', name: 'Plug Power', news: NO_NEWS },
];

let passed = 0;
let failed = 0;

tests.forEach(({ label, ticker, name, news }) => {
  const { newsBlock, catalystInstruction } = buildNewsBlock(ticker, name, news);
  const { specificNews, generalNews } = filterNews(ticker, name, news);

  const isGeneralOnly = news.length > 0 && specificNews.length === 0;
  const hasSpecific   = specificNews.length > 0;

  // Assertions
  const checks = [];

  if (isGeneralOnly) {
    checks.push({
      desc: 'newsBlock warns NO SPECIFIC NEWS',
      pass: newsBlock.includes('NO') && newsBlock.includes('SPECIFIC'),
    });
    checks.push({
      desc: 'catalystInstruction uses the required phrase',
      pass: catalystInstruction.includes('No encontré noticias específicas'),
    });
    checks.push({
      desc: 'catalystInstruction pastes the first headline',
      pass: catalystInstruction.includes(news[0]?.headline),
    });
  }

  if (hasSpecific) {
    checks.push({
      desc: 'newsBlock labels SPECIFIC block',
      pass: newsBlock.includes(`${ticker.toUpperCase()}-SPECIFIC`),
    });
    checks.push({
      desc: 'catalystInstruction references SPECIFIC block',
      pass: catalystInstruction.includes('SPECIFIC'),
    });
    checks.push({
      desc: 'general news marked NOT about ticker',
      pass: generalNews.length === 0 || newsBlock.includes(`NOT about ${ticker.toUpperCase()}`),
    });
  }

  if (news.length === 0) {
    checks.push({
      desc: 'shows (no news data)',
      pass: newsBlock === '(no news data)',
    });
    checks.push({
      desc: 'catalystInstruction falls back to infer',
      pass: catalystInstruction.includes('infer from price'),
    });
  }

  const allPass = checks.every(c => c.pass);
  if (allPass) passed++;
  else failed++;

  const status = allPass ? '✅ PASS' : '❌ FAIL';
  console.log(`\n${status} — ${label}`);
  console.log(`  Specific news: ${specificNews.length} | General news: ${generalNews.length}`);
  console.log(`  NEWS BLOCK:\n    ${newsBlock.replace(/\n/g, '\n    ')}`);
  console.log(`  CATALYST INSTRUCTION:\n    ${catalystInstruction}`);
  checks.forEach(c => {
    console.log(`  ${c.pass ? '✓' : '✗'} ${c.desc}`);
  });
});

console.log(`\n${'─'.repeat(60)}`);
console.log(`Results: ${passed}/${tests.length} passed, ${failed} failed`);
if (failed === 0) {
  console.log('All news relevance tests passed ✅');
} else {
  console.log('Some tests FAILED — check output above');
  process.exit(1);
}
