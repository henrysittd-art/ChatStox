// All entries lowercase. Checked against word.toLowerCase() so accents are handled
// by stripping non-ASCII letters before the lookup.
const STOP_WORDS = new Set([
  // English — function words
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought', 'used',
  'what', 'which', 'who', 'whom', 'whose', 'when', 'where', 'why', 'how',
  'all', 'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such',
  'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very',
  'just', 'because', 'as', 'until', 'while', 'of', 'at', 'by', 'for',
  'with', 'about', 'against', 'between', 'into', 'through', 'during',
  'before', 'after', 'above', 'below', 'to', 'from', 'up', 'down', 'in',
  'out', 'on', 'off', 'over', 'under', 'again', 'further', 'then', 'once',
  'or', 'and', 'but', 'if', 'since', 'although', 'though', 'even',
  // English — pronouns & determiners
  'i', 'me', 'my', 'you', 'your', 'we', 'our', 'they', 'their', 'them',
  'he', 'him', 'his', 'she', 'her', 'hers', 'it', 'its',
  'this', 'that', 'these', 'those',
  // English — common verbs & market words that look like tickers
  'give', 'gave', 'get', 'got', 'go', 'went', 'come', 'came',
  'buy', 'buying', 'sell', 'selling', 'trade', 'trading',
  'tell', 'show', 'look', 'know', 'think', 'say', 'see', 'want',
  'use', 'find', 'make', 'take', 'like', 'back', 'also', 'am',
  'stock', 'stocks', 'market', 'price', 'today', 'now', 'open', 'close',
  'penny', 'pennies',
  'much', 'many', 'low', 'high', 'good', 'bad', 'big', 'small',
  'new', 'old', 'top', 'best', 'worst', 'any', 'its', 'less', 'long',
  'right', 'great', 'first', 'last', 'next', 'own', 'let',
  // Common -ing / -ed / -er forms that look like tickers
  'doing', 'going', 'being', 'having', 'looking', 'buying', 'selling',
  'trading', 'getting', 'making', 'thinking', 'saying', 'using',
  'ratio', 'level', 'move', 'gain', 'loss', 'drop', 'rise', 'fall',
  'bull', 'bear', 'call', 'puts', 'hold', 'with', 'cash', 'bay',
  // ETF plural forms
  'etfs', 'etf',
  'hola', 'hey', 'hi', 'hello', 'buenas',
  // Spanish — function words
  'que', 'qué', 'pq', 'porque', 'porqué', 'como', 'cómo',
  'cuando', 'cuándo', 'donde', 'dónde', 'quien', 'quién',
  'cual', 'cuál', 'cuales', 'cuáles',
  'si', 'no', 'ni', 'más', 'mas', 'menos', 'muy', 'tan', 'tanto',
  'ya', 'aún', 'aun', 'también', 'tampoco', 'sino',
  'aunque', 'mientras', 'durante', 'antes', 'después',
  'sobre', 'bajo', 'entre', 'desde', 'hasta', 'hacia',
  'con', 'sin', 'para', 'por', 'en', 'de', 'del', 'al',
  'la', 'el', 'lo', 'los', 'las', 'un', 'una', 'uno', 'unos', 'unas',
  // Spanish — pronouns, object pronouns & possessives
  'me', 'te', 'se', 'le', 'mi', 'tu', 'su', 'nos', 'os', 'sus', 'mis', 'tus',
  'yo', 'él', 'ella', 'nosotros', 'vosotros', 'ellos', 'ellas',
  'este', 'esta', 'estos', 'estas', 'ese', 'esa', 'esos', 'esas', 'esto', 'eso',
  'aquel', 'aquella',
  // Spanish — to-be verbs (ser/estar) — critical: "es" means "is"
  'es', 'está', 'esta', 'ser', 'fue', 'era', 'eran', 'eras', 'son', 'hay',
  // estar conjugations (stripped of accents → exact lowercase match)
  'estoy', 'estas', 'estan', 'estamos', 'estais', 'estaba', 'estaban',
  'estabas', 'estabamos', 'estabais', 'estare', 'estaran', 'estaria',
  // Spanish — common verbs & market words
  'dar', 'dame', 'dime', 'quiero', 'quieres', 'quiere',
  'tiene', 'tengo', 'tienes',
  'comprar', 'compra', 'vender', 'invertir',
  'vale', 'valen', 'valio', 'valió', 'valia', 'valía',
  'pena', 'penas', 'bueno', 'buena', 'buenos', 'buenas',
  'inversion', 'inversión', 'invertir', 'venta',
  'accion', 'acción', 'acciones', 'mercado', 'precio',
  'hoy', 'ahora', 'mucho', 'poco', 'bien', 'mal', 'grande', 'pequeño',
  'han', 'haber', 'habia', 'había', 'hubo', 'hayan', 'haya',
  'subio', 'subió', 'sube', 'suben', 'subir', 'baja', 'bajan', 'bajó',
  'salen', 'caen', 'creen', 'piden', 'usan', 'ven', 'dan', 'van',
  // Spanish — verb infinitives (3-5 chars after accent-stripping) commonly mistaken for tickers
  'estar', 'poder', 'tener', 'hacer', 'venir', 'salir',
  'ganar', 'tomar', 'pasar', 'mirar', 'bajar', 'desde', 'hacia',
  // Spanish — question/conversation verbs / nouns that look like tickers
  'pero', 'broker',
  'ayuda', 'ayudo', 'ayudar',
  'gracias', 'favor', 'pues', 'bueno', 'claro', 'igual', 'saber',
  'lista', 'lista', 'otras', 'otro',
  'puedo', 'puedes', 'puede', 'podria', 'podría',
  'dejar', 'deja', 'permite',
  'creo', 'pienso', 'espero', 'espera',
  'opina', 'opinas', 'recomienda', 'recomiendas',
  'sugiere', 'sugiero',
  'busco', 'busca', 'necesito', 'necesita',
  'sigue', 'sigan',
  'mejor', 'peor',
  // Spanish — time words
  'ayer', 'mañana', 'nunca', 'siempre', 'entonces',
  // Spanish — pronouns / quantifiers
  'solo', 'sólo', 'alguien', 'nadie',
  // Spanish common nouns / adjectives that look like tickers after stripping accents
  'dias', 'anos', 'meses', 'veces', 'tipo', 'todo', 'toda', 'todos',
  'algo', 'nada', 'cada', 'otro', 'otra', 'mismo', 'misma',
  'hace', 'ver', 'saber',
  'modo', 'moda', 'forma', 'caso', 'vez', 'lado', 'parte',
  // English false-positives
  'times',
  // Additional English verbs/nouns that appear as 2-5 char uppercase false positives
  'says', 'goes', 'runs', 'hits', 'gets', 'puts', 'sets', 'lets', 'sees',
  'adds', 'cuts', 'ups', 'big', 'hot', 'cold', 'top', 'new', 'key', 'raw',
  'data', 'news', 'week', 'year', 'time', 'way', 'day', 'end', 'out',
  // Time / frequency words
  'mid', 'noon', 'midday', 'morning', 'afternoon', 'evening', 'night',
  'month', 'hour', 'minute', 'second', 'date', 'today', 'yesterday', 'tomorrow',
  'later', 'soon', 'early', 'late',
  // Market / action words already partially covered — explicit additions
  'open', 'close', 'closed', 'market', 'markets',
  'stock', 'stocks', 'share', 'shares',
  'trade', 'trades', 'trading',
  'invest', 'investing', 'investment',
  'sector', 'sectors', 'industry',
  'cap', 'large', 'small', 'micro', 'mega', 'nano',
  'list', 'show', 'give', 'find', 'tell', 'ask',
  'buy', 'sell', 'hold', 'watch', 'look', 'check',
  'compare', 'analyze', 'analysis',
  // Spanish action / context words
  'alta', 'bajo',
  'caliente', 'calientes', 'frio',
  'muestra', 'encuentra', 'compara', 'analiza',
]);

// Financial / tech abbreviations that must never be treated as tickers
const ABBREV_BLOCKLIST = new Set([
  'AI', 'ML', 'DL', 'EV', 'US', 'EU', 'UK', 'UN',
  'FY', 'Q1', 'Q2', 'Q3', 'Q4',
  'ETF', 'IPO', 'CEO', 'CFO', 'CTO', 'COO', 'CIO',
  'EPS', 'PE', 'PB', 'ROI', 'ROE', 'ROA',
  'RSI', 'ATH', 'ATL', 'YTD', 'YOY', 'MOM', 'QOQ',
  'EMA', 'SMA', 'MACD', 'VWAP', 'OTC', 'SEC',
  'FED', 'GDP', 'CPI', 'PCE', 'PMI', 'NFP',
  'ECB', 'BOJ', 'FX', 'IV', 'OI',
  'AM', 'PM', 'EST', 'EDT', 'ET', 'PT', 'CT', 'MT',
  'LLC', 'INC', 'LTD', 'PLC', 'AG', 'SA', 'NV', 'BV',
  'TV', 'PC', 'USB', 'API', 'APP', 'URL', 'IA',
  'NYSE', 'NASDAQ', 'NYSE',
]);

// Well-known tickers — bypasses the generic algorithm for single-char and ambiguous ones
const KNOWN_TICKERS = new Set([
  // Mega-cap tech
  'AAPL', 'MSFT', 'GOOGL', 'GOOG', 'AMZN', 'META', 'TSLA', 'NVDA', 'NFLX',
  // Semi / hardware
  'AMD', 'INTC', 'QCOM', 'AVGO', 'MU', 'AMAT', 'KLAC', 'LRCX', 'TXN', 'ARM',
  // Enterprise software
  'CRM', 'ORCL', 'ADBE', 'NOW', 'WDAY', 'INTU', 'VEEV', 'PANW', 'CRWD', 'ZS',
  // Fintech / payments
  'PYPL', 'SQ', 'AFRM', 'UPST', 'HOOD', 'SOFI', 'COIN',
  // Ride / gig
  'UBER', 'LYFT', 'DASH',
  // ETFs / indices
  'SPY', 'QQQ', 'IWM', 'DIA', 'GLD', 'SLV', 'USO', 'TLT', 'HYG',
  'XLK', 'XLF', 'XLE', 'XLV', 'XLI', 'XLC', 'XLY', 'XLP', 'XLB', 'XLU',
  'ARKK', 'ARKG', 'ARKW', 'ARKF', 'ARKQ',
  // China ADRs
  'BABA', 'JD', 'NIO', 'XPEV', 'LI', 'PDD', 'BIDU',
  // Social / consumer tech
  'SHOP', 'SNAP', 'PINS', 'RBLX', 'ABNB', 'PLTR', 'TWTR',
  // Meme / retail
  'GME', 'AMC', 'BB', 'NOK',
  // Banks / finance
  'JPM', 'BAC', 'GS', 'MS', 'WFC', 'C', 'V', 'MA', 'AXP', 'BRK',
  // Health
  'JNJ', 'PFE', 'MRNA', 'BNTX', 'ABBV', 'UNH', 'CVS', 'LLY', 'ABT',
  // Retail
  'WMT', 'TGT', 'COST', 'AMZN',
  // Energy
  'XOM', 'CVX', 'BP', 'OXY', 'COP',
  // Defense / industrial
  'BA', 'LMT', 'RTX', 'NOC', 'GE', 'CAT', 'HON',
  // Auto
  'F', 'GM', 'RIVN', 'LCID', 'TM',
  // Media / entertainment
  'DIS', 'PARA', 'WBD', 'NFLX',
  // Telecom
  'T', 'VZ', 'TMUS',
  // Real estate / utilities
  'AMT', 'PLD', 'NEE',
  // Clean energy
  'ENPH', 'FSLR', 'RUN', 'BE',
  // Cloud / SaaS
  'NET', 'SNOW', 'DDOG', 'TWLO', 'ZM', 'DOCU', 'MDB', 'CFLT', 'U', 'PATH',
  // Other notable
  'PTON', 'BYND', 'TDOC', 'HIMS', 'ROKU', 'ACMR', 'DKNG', 'SPCE',
]);

// Mapping of common company/product names → ticker symbol
const COMPANY_MAP = {
  // Big tech
  apple: 'AAPL', microsoft: 'MSFT', google: 'GOOGL', alphabet: 'GOOGL',
  amazon: 'AMZN', meta: 'META', facebook: 'META', instagram: 'META',
  whatsapp: 'META', tesla: 'TSLA', nvidia: 'NVDA', nvdia: 'NVDA',
  netflix: 'NFLX', amd: 'AMD', intel: 'INTC', qualcomm: 'QCOM',
  broadcom: 'AVGO', micron: 'MU',
  // Enterprise
  salesforce: 'CRM', oracle: 'ORCL', adobe: 'ADBE', servicenow: 'NOW',
  workday: 'WDAY', intuit: 'INTU', 'palo alto': 'PANW', crowdstrike: 'CRWD',
  // Fintech
  paypal: 'PYPL', square: 'SQ', block: 'SQ', affirm: 'AFRM',
  robinhood: 'HOOD', coinbase: 'COIN', sofi: 'SOFI',
  // Gig / consumer
  uber: 'UBER', lyft: 'LYFT', doordash: 'DASH', airbnb: 'ABNB',
  shopify: 'SHOP', snap: 'SNAP', snapchat: 'SNAP', pinterest: 'PINS',
  roblox: 'RBLX', palantir: 'PLTR',
  // Meme
  gamestop: 'GME',
  // Banks
  jpmorgan: 'JPM', 'jp morgan': 'JPM', 'bank of america': 'BAC',
  'goldman sachs': 'GS', goldman: 'GS', 'morgan stanley': 'MS',
  'wells fargo': 'WFC', citigroup: 'C', citi: 'C',
  visa: 'V', mastercard: 'MA', 'american express': 'AXP', amex: 'AXP',
  // Health
  pfizer: 'PFE', moderna: 'MRNA', 'johnson & johnson': 'JNJ', jnj: 'JNJ',
  abbvie: 'ABBV', 'united health': 'UNH', unitedhealth: 'UNH', 'eli lilly': 'LLY',
  // Retail
  walmart: 'WMT', target: 'TGT', costco: 'COST',
  // Energy
  exxon: 'XOM', chevron: 'CVX',
  // Defense
  boeing: 'BA', lockheed: 'LMT', raytheon: 'RTX',
  // Auto
  ford: 'F', rivian: 'RIVN', lucid: 'LCID', toyota: 'TM',
  'general motors': 'GM',
  // Media
  disney: 'DIS', paramount: 'PARA',
  // Cloud
  cloudflare: 'NET', snowflake: 'SNOW', datadog: 'DDOG', zoom: 'ZM',
  docusign: 'DOCU', mongodb: 'MDB',
  // Other
  peloton: 'PTON', 'beyond meat': 'BYND', teladoc: 'TDOC',
  roku: 'ROKU', draftkings: 'DKNG',
  // Spanish aliases
  manzana: 'AAPL', // "apple" in Spanish slang for AAPL
};

// ── Main export ────────────────────────────────────────────────────────────────

export function extractTicker(text) {
  if (!text || typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!trimmed) return null;

  // 1. Explicit $ prefix — highest confidence, always trust
  const dollarMatch = trimmed.match(/\$([A-Za-z]{1,5})\b/);
  if (dollarMatch) {
    const ticker = dollarMatch[1].toUpperCase();
    // Still require >= 2 chars to avoid $I or $A false positives
    if (ticker.length >= 2 && !ABBREV_BLOCKLIST.has(ticker)) return ticker;
  }

  // 2. KNOWN_TICKERS — exact whole-word match; strip diacritics first so accented
  //    letters (ñ, á, etc.) don't act as false word-boundaries (e.g. "mañana" → MA).
  //    Also verify the ticker appears in UPPERCASE in the original text so common
  //    lowercase words like "now", "cap", "buy" don't match NOW, CAP, BUY tickers.
  const upper = trimmed
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9\s]/g, ' ')
    .toUpperCase();
  for (const ticker of KNOWN_TICKERS) {
    const reUpper = new RegExp(`(?:^|[^A-Z])${ticker}(?:[^A-Z]|$)`);
    if (!reUpper.test(upper)) continue;
    // Confirm the ticker appears with at least its first letter uppercase in original
    const reOrig = new RegExp(`(?:^|[^A-Za-z])[A-Z]${ticker.slice(1)}(?:[^A-Za-z]|$)`);
    if (reOrig.test(trimmed)) return ticker;
  }

  // 3. Company / product name detection (original lowercase text)
  const lower = trimmed.toLowerCase();
  for (const [name, ticker] of Object.entries(COMPANY_MAP)) {
    if (lower.includes(name)) return ticker;
  }

  // 4. Generic uppercase-word scan: 2–5 alpha chars, not a stop word or abbrev
  const words = trimmed.split(/[\s,.!?;:()[\]{}"']+/);
  for (const word of words) {
    // Strip diacritics then non-letter chars so ñ→n (not dropped), then uppercase
    const clean = word
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z]/g, '')
      .toUpperCase();
    if (
      clean.length >= 3 &&
      clean.length <= 5 &&
      /^[A-Z]+$/.test(clean) &&
      !STOP_WORDS.has(clean.toLowerCase()) &&
      !ABBREV_BLOCKLIST.has(clean)
    ) {
      return clean;
    }
  }

  return null;
}
