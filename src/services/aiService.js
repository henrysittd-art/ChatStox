import { BACKEND_URL } from '../config/api';

const AI_MODEL = 'gemini-2.5-flash'; // model selection happens on the backend; this is for logging only

function formatNumber(n) {
  if (!n && n !== 0) return 'N/A';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(2);
}

function tickerInHistory(ticker, history) {
  if (!ticker || !history?.length) return false;
  const t = ticker.toUpperCase();
  return history.some(msg => msg.role === 'assistant' && msg.content?.toUpperCase().includes(t));
}

// Tickers with known bad data — filtered out of every AI prompt
const AI_BLACKLIST = new Set(['AGNT']);

function buildSystemPrompt({ stock, isGeneral, isAutoAnalysis, history, details, news, gainers, losers, volume, extendedData, marketIndices, earnings }) {

  // Strip blacklisted tickers from market data arrays before they reach any prompt block
  gainers = (gainers || []).filter(s => !AI_BLACKLIST.has((s.ticker || '').toUpperCase()));
  losers  = (losers  || []).filter(s => !AI_BLACKLIST.has((s.ticker || '').toUpperCase()));
  volume  = (volume  || []).filter(s => !AI_BLACKLIST.has((s.ticker || '').toUpperCase()));

  // ── Temporal context — injected first in every prompt ────────────────────────
  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const currentYear = new Date().getFullYear();
  const currentContext = `TODAY'S DATE: ${today}. You are operating in ${currentYear}. Your training data goes up to early 2025. For events after early 2025, rely on the live market data and news feed injected below and acknowledge uncertainty about very recent developments.`;

  // ── Shared volume formatter ────────────────────────────────────────────────
  const fmtVol = (n) => {
    n = Number(n);
    if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
    if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
    return String(n);
  };

  // Price formatter: 4 decimals for sub-$1, 2 decimals otherwise
  const fmtP = (n) => {
    const num = Number(n);
    return num > 0 && num < 1 ? `$${num.toFixed(4)}` : `$${num.toFixed(2)}`;
  };

  // Standard list row: TICKER - Company Name | $price | +/-% | Vol: XM
  const fmtRow = (s) => {
    const pct = Number(s.changePercent);
    const sign = pct >= 0 ? '+' : '';
    return `${s.ticker} - ${s.name || s.ticker} | ${fmtP(s.price)} | ${sign}${pct.toFixed(2)}% | Vol: ${fmtVol(s.volume)}`;
  };

  // ── Override block — must appear FIRST in every prompt ───────────────────────
  // For single-stock chat with real data: inject explicit price at the very top so
  // the model cannot substitute training-data prices for the current quote.
  const OVERRIDE = (stock && !isGeneral && Number(stock.price) > 0)
    ? `⚠️ LIVE PRICE OVERRIDE ⚠️
CRITICAL — ${stock.ticker} CONFIRMED LIVE PRICE (real-time market data):
  Price : ${fmtP(stock.price)}
  Change: ${Number(stock.changePercent) >= 0 ? '+' : ''}${Number(stock.changePercent).toFixed(2)}%
  Volume: ${fmtVol(stock.volume)}
THIS IS THE ONLY CORRECT CURRENT PRICE FOR ${stock.ticker}.
Any other price from your training data is outdated — do NOT use it under any circumstance.
All additional data below was also fetched live. Use these EXACT numbers.
This override applies ONLY to real-time market data. It does NOT restrict general financial knowledge.`
    : `⚠️ LIVE PRICE OVERRIDE ⚠️
The stock PRICES, VOLUMES, and % CHANGES listed below come from LIVE MARKET FEEDS updated seconds ago.
They SUPERSEDE training-data prices. USE THESE EXACT NUMBERS for anything price-related.
DO NOT recall training-data prices for current quotes — ONLY use the prices shown in this prompt.
This override applies ONLY to real-time market data (price, volume, change%, VWAP, high, low, open).
It does NOT restrict your general financial knowledge — see TWO TYPES OF KNOWLEDGE below.`;

  // Rules/personality/format are now owned by the backend (server.js SYSTEM_RULES).
  // Frontend only sends data blocks + language + profile as metadata fields.

  // ── GENERAL CHAT (no specific stock loaded) ────────────────────────────────
  if (isGeneral) {

    // ── DEBUG: log what's coming in ───────────────────────────────────────────
    console.log(`[PENNY DEBUG] gainers array received: ${(gainers || []).length} stocks`);
    if ((gainers || []).length > 0) {
      console.log('[PENNY DEBUG] Top 10 gainers (ticker | price | pct | volume):');
      (gainers || []).slice(0, 10).forEach((s, i) => {
        console.log(`  ${i + 1}. ${s.ticker} | $${Number(s.price).toFixed(2)} | ${Number(s.changePercent).toFixed(2)}% | vol ${Number(s.volume).toLocaleString()}`);
      });
    }

    // Primary: momentum movers (>15% gain, >50k volume) — true penny/momentum plays
    let pennyLike = (gainers || [])
      .filter(s => Number(s.changePercent) > 15 && Number(s.volume) > 50000)
      .sort((a, b) => Number(b.changePercent) - Number(a.changePercent))
      .slice(0, 20);

    console.log(`[PENNY DEBUG] Primary filter (>15% gain, vol>50k): ${pennyLike.length} stocks found`);

    // Fallback: if market is slow, lower threshold — still excludes large caps
    if (pennyLike.length < 5) {
      console.log('[PENNY DEBUG] Primary thin — fallback (>5% gain, price<$20, vol>10k)');
      pennyLike = (gainers || [])
        .filter(s => Number(s.changePercent) > 5 && Number(s.price) < 20 && Number(s.volume) > 10000)
        .sort((a, b) => Number(b.changePercent) - Number(a.changePercent))
        .slice(0, 20);
      console.log(`[PENNY DEBUG] Fallback filter: ${pennyLike.length} stocks found`);
    }

    if (pennyLike.length > 0) {
      console.log('[PENNY DEBUG] Injecting into GPT:');
      pennyLike.forEach((s, i) => {
        console.log(`  ${i + 1}. ${s.ticker} (${s.name || 'no name'}) | $${Number(s.price).toFixed(2)} | ${Number(s.changePercent).toFixed(2)}% | vol ${Number(s.volume).toLocaleString()}`);
      });
    } else {
      console.warn('[PENNY DEBUG] ⚠️  No penny/momentum stocks to inject');
    }

    const gainersBlock = (gainers || []).slice(0, 8).map(fmtRow).join('\n') || 'No data';
    const losersBlock  = (losers  || []).slice(0, 5).map(fmtRow).join('\n') || 'No data';

    // Sector rotation detection from top 10 gainers (reduced from 30 to save prompt space)
    const _sectorOf = (ticker, name) => {
      const n = (name || '').toLowerCase();
      const t = (ticker || '').toUpperCase();
      if (['XLK','ARKK','ARKW','ARKF'].includes(t)) return 'Tech';
      if (['XLF'].includes(t)) return 'Finance';
      if (['XLE'].includes(t)) return 'Energy';
      if (['XLV','ARKG'].includes(t)) return 'Healthcare';
      if (['XLI'].includes(t)) return 'Industrial';
      if (/pharma|bio(?!tech)|therapeut|genomic|gene|oncol|medic|drug|clinical|trial/.test(n)) return 'Healthcare/Bio';
      if (/biotech|bioscien/.test(n)) return 'Healthcare/Bio';
      if (/tech|software|\bai\b|artificial|cloud|cyber|data|digital|semiconductor|chip|comput|network|saas|silicon/.test(n)) return 'Tech';
      if (/bitcoin|crypto|blockchain|mstr|coin|riot|mara|hut|clsk/.test(n) || ['MSTR','COIN','RIOT','MARA','HUT','CLSK','IREN'].includes(t)) return 'Crypto';
      if (/cannabis|marijuana|hemp|cbd/.test(n)) return 'Cannabis';
      if (/electric vehicle|ev |battery|charging|chpt|blnk|rivian|lucid|nio/.test(n) || ['TSLA','RIVN','LCID','EVGO','CHPT','BLNK','NIO','XPEV','LI'].includes(t)) return 'EV/Auto';
      if (/energy|oil|gas|solar|wind|power|petroleum|coal|uranium|lithium|gold|silver|mining|metal|copper/.test(n)) return 'Energy/Mining';
      if (/bank|financ|capital|invest|credit|insurance|mortgage|payment|fintech|lend/.test(n)) return 'Finance';
      if (/retail|consumer|restaurant|food|beverage|apparel|fashion|beauty/.test(n)) return 'Consumer';
      if (/defense|aerospace|military|weapon|lockheed|northrop|raytheon/.test(n)) return 'Defense';
      return 'Other';
    };
    const _sectorMap = {};
    (gainers || []).slice(0, 10).forEach(s => {
      const sec = s.sector || _sectorOf(s.ticker, s.name);
      if (!_sectorMap[sec]) _sectorMap[sec] = { count: 0, tickers: [] };
      _sectorMap[sec].count++;
      if (_sectorMap[sec].tickers.length < 4) _sectorMap[sec].tickers.push(s.ticker);
    });
    const sectorLines = Object.entries(_sectorMap)
      .sort((a, b) => b[1].count - a[1].count)
      .map(([sec, d]) => {
        const icon = d.count >= 5 ? '🔥 Leading' : d.count >= 3 ? '📈 Active' : '→ Light';
        return `${icon} ${sec}: ${d.count} stock${d.count > 1 ? 's' : ''} in top gainers (${d.tickers.join(', ')})`;
      });
    const sectorBlock = sectorLines.length > 0
      ? `\n━━━ SECTOR ROTATION (from top gainers) ━━━\n${sectorLines.join('\n')}\nWhen asked "what sectors are leading?" or "qué sectores lideran?" — use EXACTLY this breakdown.`
      : '';

    return `${currentContext}

${OVERRIDE}

━━━ LIVE MARKET DATA (USE THESE EXACT NUMBERS) ━━━

TOP GAINERS TODAY (sorted by % gain):
${gainersBlock}

TOP LOSERS TODAY (sorted by % loss):
${losersBlock}
${sectorBlock}

━━━ DATA USAGE MAP (match the user's question to the correct section above) ━━━
• "most active" / "más activas" / "más movidas" / "más volumen" / "hottest" / "calientes" → use TOP GAINERS (sort by highest volume × % gain)
• "top gainers" / "ganadores" / "más subidas" / "las que más suben" → use TOP GAINERS TODAY
• "top losers" / "perdedoras" / "más bajas" / "las que más bajan" → use TOP LOSERS TODAY
• "penny stocks" / "momentum plays" / "hot movers" / "acciones baratas" → use TOP GAINERS: highest % gain with volume over 1M, price over $1
• sectors / sectores / qué sectores lideran / what sectors are leading → use SECTOR ROTATION section
• "recommendations" / "qué comprar" / "mejores picks" → recommend from TOP GAINERS
• Any general market question → synthesize from all sections

━━━ ABSOLUTE PROHIBITIONS ━━━
NEVER say: "no tengo acceso", "no puedo acceder", "I don't have access", "no tengo una lista específica", "no tengo información", "no cuento con datos", "no tengo acceso a datos en tiempo real", or any phrase suggesting data is unavailable.
NEVER say any variation of: "no puedo proporcionar un análisis tan extenso", "no es posible dar un análisis de X líneas", "I cannot provide such a long analysis", "that would be too long", "no puedo escribir 100 líneas", "es demasiado largo", "un análisis tan detallado excede", or any refusal based on length.
The live market data IS in this prompt. Your general financial knowledge IS in your training. Use both.
NEVER invent stocks not listed above for market-mover questions. NEVER use training-data prices for current quotes.

━━━ INSTRUCTIONS ━━━
• For live market questions (gainers, losers, movers, volume): use ONLY the data above.
• When user asks for penny stocks, hot movers, or momentum plays: use TOP GAINERS — filter for highest % gain with volume > 1M and price > $1. Use FORMAT 1. NEVER say there are none if the list has stocks.
• When user asks about "most active" or "hottest": use TOP GAINERS sorted by volume × % gain. Give the list in FORMAT 1.
• When user asks about earnings, fundamentals, company history, or general financial knowledge for any stock: answer from your training knowledge confidently. These are TYPE 2 questions — you have the knowledge.
• When user asks about a specific stock's CURRENT price that is NOT in the data above: say "Para ver el precio actual de [TICKER] necesito cargarlo en su propio chat — búscalo en el buscador." Do NOT refuse to share general knowledge about that stock.
• When user asks about the overall market: use gainers, losers, and volume to give a directional view.
• Respond in the SAME language as the user's message.`;
  }

  // ── SINGLE STOCK CHAT ──────────────────────────────────────────────────────
  if (!stock) return `${currentContext}\n\n${OVERRIDE}`;

  const name = details?.name || stock.ticker;

  // Classify this stock so the AI understands what tier it is
  const mcap = details?.marketCap || 0;
  const stockTier =
    mcap > 10e9  ? 'Large Cap (>$10B)' :
    mcap > 2e9   ? 'Mid Cap ($2B–$10B)' :
    mcap > 300e6 ? 'Small Cap ($300M–$2B)' :
    mcap > 0     ? 'Micro Cap / Penny (<$300M)' :
    'Cap desconocido';

  // ── Candle pattern detection ─────────────────────────────────────────────────
  const _o = Number(stock.open);
  const _h = Number(stock.dayHigh);
  const _l = Number(stock.dayLow);
  const _c = Number(stock.price);   // current price = live close proxy
  const _range  = _h - _l;
  const _body   = Math.abs(_c - _o);
  const _isGreen = _c >= _o;
  const _upWick  = _h - Math.max(_o, _c);
  const _loWick  = Math.min(_o, _c) - _l;
  let _candlePat, _candleBias;
  if (_range < 0.0001) {
    _candlePat = 'Doji (range too small to classify)'; _candleBias = 'neutral';
  } else {
    const bPct = _body / _range;
    const uPct = _upWick / _range;
    const lPct = _loWick / _range;
    if (bPct < 0.1) { _candlePat = 'Doji — indecision, buyers and sellers equal'; _candleBias = 'neutral'; }
    else if (!_isGreen && uPct > 0.6) { _candlePat = 'Shooting Star — bearish reversal (long upper wick, small red body at bottom)'; _candleBias = 'bearish'; }
    else if (_isGreen  && lPct > 0.6) { _candlePat = 'Hammer — bullish reversal (long lower wick, small green body at top)'; _candleBias = 'bullish'; }
    else if (!_isGreen && lPct > 0.6) { _candlePat = 'Hanging Man — bearish warning despite lower wick'; _candleBias = 'neutral'; }
    else if (_isGreen  && bPct > 0.7)  { _candlePat = 'Bullish Marubozu — buyers in control all session'; _candleBias = 'bullish'; }
    else if (!_isGreen && bPct > 0.7)  { _candlePat = 'Bearish Marubozu — sellers in control all session'; _candleBias = 'bearish'; }
    else { _candlePat = _isGreen ? 'Bullish (green) candle' : 'Bearish (red) candle'; _candleBias = _isGreen ? 'bullish' : 'bearish'; }
  }

  // ── S/R level computation ─────────────────────────────────────────────────────
  const _prevH  = Number(stock.previousHigh || 0);
  const _prevL  = Number(stock.previousLow  || 0);
  const _vwapN  = Number(stock.vwap);
  const _step   = _c >= 100 ? 10 : _c >= 10 ? 5 : _c >= 1 ? 1 : 0.1;
  const _psych1 = Math.floor(_c / _step) * _step;
  const _psych0 = Math.max(0, _psych1 - _step);
  const _psych2 = _psych1 + _step;
  const _vwapBias = _c > _vwapN ? 'above VWAP → bullish intraday bias' :
                    _c < _vwapN ? 'below VWAP → bearish intraday bias' : 'at VWAP → pivot';

  // ── Gap vs prev close ────────────────────────────────────────────────────────
  const _prevClose = Number(stock.previousClose || 0);
  const _gapPct    = _prevClose > 0 && _o > 0 ? ((_o - _prevClose) / _prevClose) * 100 : null;
  const _gapLine   = _gapPct !== null
    ? `\nGap vs Prev Close: ${_gapPct >= 0 ? '+' : ''}${_gapPct.toFixed(2)}% [${
        _gapPct > 2   ? 'Gap Up ↑'      :
        _gapPct < -2  ? 'Gap Down ↓'    :
        _gapPct > 0.5 ? 'Minor Gap Up'  :
        _gapPct < -0.5 ? 'Minor Gap Down' : 'Flat Open'}]`
    : '';

  // ── HOD/LOD proximity ────────────────────────────────────────────────────────
  const _rangePosLine = _range > 0.0001 ? (() => {
    const hPct = (_h - _c) / _range * 100;
    const lPct = (_c - _l) / _range * 100;
    const label = hPct <= 10 ? `Near HOD (top ${hPct.toFixed(0)}% of range)`
                : lPct <= 10 ? `Near LOD (bottom ${lPct.toFixed(0)}% of range)`
                : `Mid-range (${lPct.toFixed(0)}% from LOD, ${hPct.toFixed(0)}% from HOD)`;
    return `\nRange Position    : ${label}`;
  })() : '';

  // ── AH/PM session data ───────────────────────────────────────────────────────
  const _ahPrice   = stock.ahPrice      != null ? Number(stock.ahPrice)     : null;
  const _ahChg     = stock.ahChange    != null ? Number(stock.ahChange)    : null;
  const _ahChgPct  = stock.ahChangePct != null ? Number(stock.ahChangePct) : null;
  const _preChg    = stock.preChange    != null ? Number(stock.preChange)   : null;
  const _preChgPct = stock.preChangePct != null ? Number(stock.preChangePct): null;
  let _sessionLine = '';
  if (_ahChg !== null && _ahChgPct !== null && Math.abs(_ahChg) > 0.001) {
    const _ahPriceStr = _ahPrice && _ahPrice > 0 ? `${fmtP(_ahPrice)} | ` : '';
    _sessionLine = `\nAfter Hours    : ${_ahPriceStr}${_ahChg >= 0 ? '+' : '-'}$${Math.abs(_ahChg).toFixed(2)} (${_ahChgPct >= 0 ? '+' : ''}${_ahChgPct.toFixed(2)}%) vs RTH close`;
  } else if (_preChg !== null && _preChgPct !== null && Math.abs(_preChg) > 0.001) {
    _sessionLine = `\nPre-Market     : ${_preChg >= 0 ? '+' : '-'}$${Math.abs(_preChg).toFixed(2)} (${_preChgPct >= 0 ? '+' : ''}${_preChgPct.toFixed(2)}%) vs prev close`;
  }

  // ── Smart Stop/Target precompute (mirrors FORMAT 3 logic exactly) ────────────
  const _entryP = _c;
  let _smartStop, _stopMethod;
  const _dayLowDist = _l > 0 && _entryP > 0 ? (_entryP - _l) / _entryP : 0;
  const _dayLowTooWide = _dayLowDist > 0.15; // day low > 15% below entry → unrealistic stop
  if (_l > 0 && _dayLowDist >= 0.01 && !_dayLowTooWide)                               { _smartStop = _l;             _stopMethod = 'Day Low'; }
  else if (_dayLowTooWide && _vwapN > 0)                                               { _smartStop = _vwapN * 0.97;  _stopMethod = 'VWAP −3% (day low too wide)'; }
  else if (_vwapN > 0 && _entryP > 0 && (_entryP - _vwapN * 0.99) / _entryP >= 0.01) { _smartStop = _vwapN * 0.99;  _stopMethod = 'VWAP −1%'; }
  else if (_prevL > 0 && _entryP > 0 && (_entryP - _prevL) / _entryP >= 0.01)         { _smartStop = _prevL;         _stopMethod = 'Prev Day Low'; }
  else                                                                                  { _smartStop = _entryP * 0.99; _stopMethod = 'Entry −1% (fallback)'; }
  const _stopDistST = _entryP > 0 ? _entryP - _smartStop : 0;
  const _t1ST = (_entryP > 0 && _stopDistST > 0)
    ? Math.max(_entryP + (_h - _entryP) * 0.5, _entryP * 1.015, _entryP + _stopDistST * 1.5) : 0;
  const _t2ST = (_entryP > 0 && _stopDistST > 0)
    ? Math.max(_h, _entryP * 1.025, _entryP + _stopDistST * 2.5) : 0;
  const _rr1val = _stopDistST > 0 ? (_t1ST - _entryP) / _stopDistST : 0;
  const _rr2val = _stopDistST > 0 ? (_t2ST - _entryP) / _stopDistST : 0;
  const smartSetupBlock = (_entryP > 0 && _stopDistST > 0) ? `

━━━ SMART STOP LOSS & TARGETS ━━━
Use EXACTLY these pre-computed numbers in FORMAT 3 — do NOT recalculate:
Entry (current price) : ${fmtP(_entryP)}
Smart Stop Loss       : ${fmtP(_smartStop)} (${((_smartStop - _entryP) / _entryP * 100).toFixed(1)}% from entry) — ${_stopMethod}
Target 1              : ${fmtP(_t1ST)} (+${((_t1ST - _entryP) / _entryP * 100).toFixed(1)}%) — R/R 1:${_rr1val.toFixed(1)}
Target 2              : ${fmtP(_t2ST)} (+${((_t2ST - _entryP) / _entryP * 100).toFixed(1)}%) — R/R 1:${_rr2val.toFixed(1)}` : '';

  const marketData = `━━━ LIVE DATA: ${stock.ticker} — ${name} ━━━
Precio actual : ${fmtP(stock.price)}
Cambio hoy    : ${Number(stock.changePercent) >= 0 ? '+' : ''}${Number(stock.changePercent).toFixed(2)}% (${fmtP(stock.todaysChange ?? 0)})
Volumen       : ${fmtVol(stock.volume)}
Apertura      : ${fmtP(stock.open)}
Máximo del día: ${fmtP(stock.dayHigh)}
Mínimo del día: ${fmtP(stock.dayLow)}
VWAP          : ${fmtP(stock.vwap)}
Cierre previo : ${fmtP(stock.previousClose)}${_sessionLine}

━━━ CANDLE ANALYSIS ━━━
Open: ${fmtP(_o)} | High: ${fmtP(_h)} | Low: ${fmtP(_l)} | Close/Current: ${fmtP(_c)}
Pattern: ${_candlePat} [${_candleBias} bias]
Body: ${(_body / (_range || 1) * 100).toFixed(0)}% of range | Upper wick: ${(_upWick / (_range || 1) * 100).toFixed(0)}% | Lower wick: ${(_loWick / (_range || 1) * 100).toFixed(0)}%${_gapLine}

━━━ KEY LEVELS ━━━
S1 — Today Low    : ${fmtP(_l)}
S2 — Prev Day Low : ${_prevL > 0 ? fmtP(_prevL) : 'N/A (prev data unavailable)'}
R1 — Today High   : ${fmtP(_h)}
R2 — Prev Day High: ${_prevH > 0 ? fmtP(_prevH) : 'N/A (prev data unavailable)'}
VWAP              : ${fmtP(_vwapN)} (${_vwapBias})
Psychological     : ${fmtP(_psych0)} / ${fmtP(_psych1)} (nearest support) / ${fmtP(_psych2)} (nearest resistance)${_rangePosLine}`;

  const companyData = details ? `
━━━ COMPANY: ${name} ━━━
Sector      : ${details.sector || 'N/A'}
Exchange    : ${details.exchange || 'N/A'}
Market Cap  : ${formatNumber(details.marketCap)} — ${stockTier}
Employees   : ${details.employees ? details.employees.toLocaleString() : 'N/A'}
Description : ${details.description ? details.description.slice(0, 250) + '…' : 'N/A'}` : `
Stock Tier  : ${stockTier}`;

  // Split news into stock-specific vs general market
  const tickerUpper = stock.ticker.toUpperCase();
  const tickerRegex = new RegExp(`\\b${tickerUpper}\\b`);
  const allNews = news || [];

  const specificNews = allNews.filter(n => {
    if (Array.isArray(n.tickers) && n.tickers.map(t => t.toUpperCase()).includes(tickerUpper)) return true;
    const text = `${n.headline || ''} ${n.description || ''}`.toUpperCase();
    return tickerRegex.test(text);
  });
  const generalNews = allNews.filter(n => !specificNews.includes(n));

  const hasSpecificNews = specificNews.length > 0;
  const hasAnyNews = allNews.length > 0;

  const fmtNewsLine = (n, i) =>
    `${i + 1}. ${n.headline} (${n.published ? new Date(n.published).toLocaleDateString() : 'Recent'})`;

  let newsData = '';
  if (hasSpecificNews) {
    newsData = `
━━━ NEWS: ${tickerUpper}-SPECIFIC ━━━
These headlines directly mention ${tickerUpper} / ${name}:
${specificNews.map(fmtNewsLine).join('\n')}`;
    if (generalNews.length > 0) {
      newsData += `

GENERAL MARKET NEWS (NOT about ${tickerUpper} — do NOT attribute these to the stock):
${generalNews.slice(0, 3).map(fmtNewsLine).join('\n')}`;
    }
  } else if (hasAnyNews) {
    newsData = `
━━━ NEWS ━━━
⚠️ NO ${tickerUpper}-SPECIFIC NEWS FOUND. Only general market headlines available — these are NOT about ${tickerUpper}:
${allNews.slice(0, 3).map(fmtNewsLine).join('\n')}`;
  }

  const pct = Number(stock.changePercent);
  const sector = details?.sector || 'sector desconocido';

  let catalystInstruction;
  if (hasSpecificNews) {
    catalystInstruction = `cite the most relevant headline from the "${tickerUpper}-SPECIFIC" news section above`;
  } else if (hasAnyNews) {
    catalystInstruction = `NO ${tickerUpper}-specific news was found — the NEWS section only has general market headlines. Use this EXACT phrasing: "No encontré noticias específicas de ${tickerUpper} hoy. La noticia más reciente relacionada con el mercado es: [paste the first general headline]" (or in English: "I couldn't find ${tickerUpper}-specific news today. The most recent market-related headline is: [paste the first general headline]"). Then infer the likely catalyst from the price/volume data`;
  } else if (pct >= 100) {
    catalystInstruction = `no headlines in NEWS — this is an EXTREME move. Infer from data: +${pct.toFixed(2)}% with volume ${fmtVol(stock.volume)} in ${sector} (${stockTier}). Say specifically: "Con un movimiento de +${pct.toFixed(0)}% en volumen ${fmtVol(stock.volume)}, esto parece un squeeze o pump — alto riesgo, verifica si hay catalizador real antes de entrar." (or English equivalent: "A +${pct.toFixed(0)}% move on ${fmtVol(stock.volume)} volume looks like a squeeze or pump — high risk, verify if there's a real catalyst before entering."). NEVER say "es difícil determinar la causa exacta" — always name the pattern explicitly.`;
  } else if (pct >= 20) {
    catalystInstruction = `no headlines in NEWS — infer from data: +${pct.toFixed(2)}% in ${sector} (${stockTier}) at this magnitude likely signals earnings beat, FDA approval, major contract, or short squeeze. State this inference clearly. End with: "Recomiendo verificar las noticias más recientes para confirmar el catalizador exacto." (or English equivalent if responding in English)`;
  } else if (pct >= 5) {
    catalystInstruction = `no headlines in NEWS — infer from data: +${pct.toFixed(2)}% in ${sector} (${stockTier}) suggests analyst upgrade, sector rotation, or minor positive catalyst. State this inference. End with: "Recomiendo verificar las noticias más recientes para confirmar el catalizador exacto." (or English equivalent if responding in English)`;
  } else if (pct <= -10) {
    catalystInstruction = `no headlines in NEWS — infer from data: ${pct.toFixed(2)}% drop in ${sector} (${stockTier}) likely signals earnings miss, FDA rejection, weak guidance, or adverse news. State this inference. End with: "Recomiendo verificar las noticias más recientes para confirmar el catalizador exacto." (or English equivalent if responding in English)`;
  } else {
    catalystInstruction = `no headlines in NEWS — infer from data: moderate ${pct >= 0 ? '+' : ''}${pct.toFixed(2)}% move in ${sector} (${stockTier}) likely reflects sector rotation or technical adjustment. State this inference. End with: "Recomiendo verificar las noticias más recientes para confirmar el catalizador exacto." (or English equivalent if responding in English)`;
  }

  const useFormat2 = isAutoAnalysis || !tickerInHistory(stock?.ticker, history);

  const analysisInstruction = useFormat2
    ? `\n━━━ YOUR TASK (${isAutoAnalysis ? 'FIRST MESSAGE — AUTO-ANALYSIS' : 'FIRST MENTION OF THIS TICKER'}) ━━━
Write the opening analysis using FORMAT 2.
• Copy all numbers exactly from the LIVE DATA above.
• Support = today's low or VWAP (whichever is lower). Resistance = today's high.
• For the ⚡ Catalizador/Catalyst field: ${catalystInstruction}
• End with a clear directional opinion.
• Respond in Spanish by default (unless stock name/context is clearly English).`
    : `\n━━━ INSTRUCTIONS (FOLLOW-UP MESSAGE) ━━━
Use FORMAT 4: short bullets only, NO paragraphs, NO walls of text.
• DO NOT use FORMAT 2. DO NOT output 📊📈💡🎯⚡📌 as section headers.
• Answer ONLY what the user asked. Do not repeat the price data block.
• If the user asks about catalyst/driver: ${catalystInstruction}
• If the user asks for a trade setup: use FORMAT 3.
• If the user explicitly says "análisis completo" or "full analysis": then use FORMAT 2.
• For trade direction questions: give a direct 2-4 sentence opinion using price vs VWAP, high/low range, and volume to support your view.
• Never invent prices. Respond in the SAME language as the user's message.`;

  // ── Extended data block (prevDay, RVOL, 5-day trend, float) ──────────────────
  let extendedBlock = '';
  if (extendedData) {
    const { prevDay, rvol, fiveDayPct, trendLabel } = extendedData;
    const lines = ['', '━━━ EXTENDED DATA ━━━'];
    if (prevDay) {
      lines.push(`Prev Day: Close $${Number(prevDay.close).toFixed(2)} | High $${Number(prevDay.high).toFixed(2)} | Low $${Number(prevDay.low).toFixed(2)} | Vol: ${fmtVol(prevDay.volume)}`);
    }
    if (fiveDayPct !== null && fiveDayPct !== undefined) {
      const sign = fiveDayPct >= 0 ? '+' : '';
      lines.push(`5-Day Trend: ${sign}${fiveDayPct.toFixed(1)}% over last 5 days [${trendLabel}]`);
    }
    if (rvol !== null && rvol !== undefined) {
      const rvolLabel = rvol < 0.5 ? 'Very Low' : rvol < 1.5 ? 'Normal' : rvol < 3 ? 'Above Average' : rvol < 10 ? 'High' : 'Extreme';
      lines.push(`Relative Volume (RVOL): ${rvol.toFixed(1)}x [${rvolLabel}]${rvol > 3 ? ' ← flag this to user' : ''}`);
    }
    if (details?.sharesOutstanding) {
      const shares  = Number(details.sharesOutstanding);
      const sharesMM = shares / 1e6;
      const floatTier = sharesMM < 5   ? 'Ultra Low Float — extreme move/squeeze risk' :
                        sharesMM < 50  ? 'Low Float — elevated squeeze potential' :
                        sharesMM < 500 ? 'Mid Float' : 'Large Float';
      const squeezNote = sharesMM < 50 ? ' ← mention squeeze risk if RVOL is elevated' : '';
      lines.push(`Float: ${sharesMM.toFixed(1)}M shares [${floatTier}]${squeezNote}`);
    }
    if (lines.length > 2) extendedBlock = lines.join('\n');
  }

  // Market context block: SPY/QQQ + risk-on/off signal + RS vs SPY + top movers
  const spy = (marketIndices || []).find(m => m.ticker === 'SPY');
  const qqq = (marketIndices || []).find(m => m.ticker === 'QQQ');

  let marketContextBlock = '';
  if (spy || qqq || gainers?.length || losers?.length) {
    const ctxLines = ['', '━━━ MARKET CONTEXT ━━━'];

    if (spy) {
      const s = Number(spy.changePercent);
      ctxLines.push(`SPY (S&P 500 ETF): ${fmtP(spy.price)} | ${s >= 0 ? '+' : ''}${s.toFixed(2)}% today`);
    }
    if (qqq) {
      const q = Number(qqq.changePercent);
      ctxLines.push(`QQQ (NASDAQ-100 ETF): ${fmtP(qqq.price)} | ${q >= 0 ? '+' : ''}${q.toFixed(2)}% today`);
    }

    // Risk-on / risk-off derived from SPY direction
    if (spy) {
      const spyPct = Number(spy.changePercent);
      const tone = spyPct >= 1 ? 'Risk-ON — broad market rally' :
                   spyPct >= 0.3 ? 'Mildly Risk-ON' :
                   spyPct <= -1 ? 'Risk-OFF — broad market selloff' :
                   spyPct <= -0.3 ? 'Mildly Risk-OFF' : 'Neutral / flat market';
      ctxLines.push(`Market Tone: ${tone}`);
    }

    // Relative Strength vs SPY for the loaded stock
    if (stock && spy) {
      const stockPct = Number(stock.changePercent);
      const spyPct   = Number(spy.changePercent);
      const rs       = stockPct - spyPct;
      const rsSign   = rs >= 0 ? '+' : '';
      const rsLabel  = rs >= 3  ? 'Strong outperformer' :
                       rs >= 0.5 ? 'Outperforming market' :
                       rs <= -3  ? 'Significant underperformer' :
                       rs <= -0.5 ? 'Underperforming market' : 'In-line with market';
      ctxLines.push(
        `Relative Strength vs SPY: ${rsSign}${rs.toFixed(2)}% [${rsLabel}]` +
        ` — ${stock.ticker} ${stockPct >= 0 ? '+' : ''}${stockPct.toFixed(2)}% vs SPY ${spyPct >= 0 ? '+' : ''}${spyPct.toFixed(2)}%`
      );
      ctxLines.push(
        `RS RULE: When asked about relative strength, use EXACTLY these numbers. ` +
        `RS ${rs >= 0 ? '≥ 0 → outperforming' : '< 0 → underperforming'} the S&P 500 today.`
      );
    }

    // Top 5 movers for breadth context (not the full list)
    if ((gainers || []).length > 0) {
      ctxLines.push(`Top gainers today: ${(gainers || []).slice(0, 5).map(fmtRow).join(' | ')}`);
    }
    if ((losers || []).length > 0) {
      ctxLines.push(`Top losers today: ${(losers || []).slice(0, 5).map(fmtRow).join(' | ')}`);
    }

    marketContextBlock = ctxLines.join('\n');
  }

  // Earnings block (last 4 quarters from Polygon financials)
  let earningsBlock = '';
  if (!isGeneral && Array.isArray(earnings) && earnings.length > 0) {
    const fmtRev = v => v == null ? 'N/A' : v >= 1e9 ? `$${(v/1e9).toFixed(2)}B` : v >= 1e6 ? `$${(v/1e6).toFixed(1)}M` : `$${v.toFixed(0)}`;
    const fmtEps = v => v == null ? 'N/A' : `$${Number(v).toFixed(2)}`;

    // Compute staleness relative to today (May 2026)
    const NOW_MS = new Date('2026-05-08').getTime();
    const mostRecentDate = earnings[0]?.endDate || '';
    let stalenessWarning = '';
    if (mostRecentDate) {
      const reportMs = new Date(mostRecentDate).getTime();
      const monthsAgo = Math.max(0, Math.round((NOW_MS - reportMs) / (1000 * 60 * 60 * 24 * 30.4)));
      const quartersAgo = Math.round(monthsAgo / 3);
      if (monthsAgo >= 12) {
        stalenessWarning = `\n⚠️ STALENESS — most recent report date: ${mostRecentDate} (~${quartersAgo} quarters ago, ${monthsAgo} months). This data is ${monthsAgo >= 18 ? '1.5–2 years' : 'over 1 year'} old. You MUST tell the user this when citing these numbers. Never call this "recent."`;
      } else if (monthsAgo >= 3) {
        stalenessWarning = `\n📅 Most recent report: ${mostRecentDate} (~${quartersAgo} quarter(s) ago). Acknowledge this gap when presenting data.`;
      }
    }

    const tickerSym = stock?.ticker || '';
    const secLink = tickerSym
      ? `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=${tickerSym}&type=10-Q&dateb=&owner=include&count=10`
      : 'https://www.sec.gov/cgi-bin/browse-edgar';

    const earningsLines = earnings.map(e =>
      `  ${e.period || e.endDate}: EPS ${fmtEps(e.eps)} | Revenue ${fmtRev(e.revenue)}`
    );

    earningsBlock = `\n━━━ EARNINGS DATA (real Polygon data — USE THIS FIRST before training knowledge) ━━━\n${earningsLines.join('\n')}\n${stalenessWarning}\nFor most recent 2025-2026 filings: ${secLink}\nWhen presenting earnings: state the exact date from above, compute quarters elapsed since May 2026, and end with the SEC Edgar link. If EPS trend is improving QoQ, note it.\n`;
  }

  return `${currentContext}

${OVERRIDE}

${marketData}${companyData}${newsData}${extendedBlock}${smartSetupBlock}${earningsBlock}${marketContextBlock}${analysisInstruction}

━━━ LENGTH RULE — ABSOLUTE ━━━
NEVER refuse to write a long analysis. If the user asks for 100 lines, write 100 lines. If the user asks for 50 lines, write 50 lines. Use BOTH the live data above AND your training knowledge about this stock — cover price action, technical levels, volume, sector context, historical performance, fundamentals, catalysts, risks, and trading recommendation. Fill every requested line with real, specific, actionable content.
BANNED: "no puedo proporcionar un análisis tan extenso", "no es posible dar un análisis de X líneas", "I cannot provide such a long analysis", "that would be too long", "un análisis tan detallado excede mis capacidades", or any refusal based on length.`;
}

// ── Shared fetch helper ───────────────────────────────────────────────────────

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function openaiStream(payload, onChunk) {
  const bodyStr = JSON.stringify({ ...payload, stream: true });
  const systemLen = payload.messages?.find(m => m.role === 'system')?.content?.length ?? 0;
  console.log(`[CHATSTOX AI] → /api/chat stream | model=${payload.model} | system=${systemLen}chars`);

  const response = await fetch(`${BACKEND_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: bodyStr,
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`OpenAI ${response.status}: ${errBody}`);
  }

  // Fallback for environments without ReadableStream
  if (!response.body || typeof response.body.getReader !== 'function') {
    const json = await response.json();
    const text = json.choices?.[0]?.message?.content || '';
    if (text) onChunk(text);
    return text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullText = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    for (const line of chunk.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data: ')) continue;
      const data = trimmed.slice(6);
      if (data === '[DONE]') return fullText;
      try {
        const parsed = JSON.parse(data);
        const token = parsed.choices?.[0]?.delta?.content || '';
        if (token) {
          fullText += token;
          onChunk(fullText);
        }
      } catch { /* skip malformed SSE lines */ }
    }
  }
  return fullText;
}

async function openaiPost(payload) {
  const bodyStr = JSON.stringify(payload);
  const systemLen = payload.messages?.find(m => m.role === 'system')?.content?.length ?? 0;
  console.log(`[CHATSTOX AI] → /api/chat | model=${payload.model} | messages=${payload.messages?.length} | system=${systemLen}chars | body=${bodyStr.length}B`);

  const response = await fetch(`${BACKEND_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: bodyStr,
  });

  if (!response.ok) {
    const errBody = await response.text();
    console.error(`[CHATSTOX AI] ✗ OpenAI HTTP ${response.status} ${response.statusText}:`, errBody);
    throw new Error(`OpenAI ${response.status}: ${errBody}`);
  }

  const json = await response.json();
  const usage = json.usage;
  if (usage) {
    console.log(`[CHATSTOX AI] ✓ OpenAI OK | prompt_tokens=${usage.prompt_tokens} completion_tokens=${usage.completion_tokens} total=${usage.total_tokens}`);
  }
  return json;
}

// ── Language detection & error messages ──────────────────────────────────────

export function detectSpanish(text) {
  if (!text) return false;
  if (/[áéíóúüñ¿¡]/i.test(text)) return true;
  const lower = text.toLowerCase();
  return [' es ', ' de ', ' la ', ' el ', ' los ', ' las ', ' una ',
    'qué', 'cómo', 'cuál', 'dime', 'dame', 'quiero', 'hola', 'gracias', 'buenas',
  ].some(m => lower.includes(m));
}

export function aiErrorMessage(question) {
  return detectSpanish(question)
    ? 'Hubo un error al procesar tu pregunta. Por favor intenta de nuevo.'
    : 'Sorry, I encountered an error. Please try again.';
}

// ── Connection test ───────────────────────────────────────────────────────────

export async function testAIConnection() {
  try {
    const data = await openaiPost({
      model: AI_MODEL,
      max_tokens: 16,
      messages: [{ role: 'user', content: 'Reply with just the word: OK' }],
    });
    const reply = data.choices?.[0]?.message?.content?.trim() || '(empty)';
    console.log('[CHATSTOX AI] ✓ Connection test passed:', reply);
    return { ok: true, reply };
  } catch (e) {
    console.error('[CHATSTOX AI] ✗ Connection test failed:', e.message);
    return { ok: false, error: e.message };
  }
}

// ── callAI ────────────────────────────────────────────────────────────────────

export async function callAI({ stock, question, history = [], profile, isGeneral, isAutoAnalysis, details, news, gainers, losers, volume, extendedData, marketIndices, earnings, onChunk }) {
  // Data blocks only — rules/personality/format live in backend SYSTEM_RULES
  const dataBlocks = buildSystemPrompt({ stock, isGeneral, isAutoAnalysis, history, details, news, gainers, losers, volume, extendedData, marketIndices, earnings });

  const lang = profile?.language || 'en';
  const profileContext = profile
    ? `USER: ${profile.traderType||'trader'} | sectors: ${Array.isArray(profile.sectors) ? profile.sectors.join(',') : profile.sectors||'all'} | risk: ${profile.riskTolerance||'medium'} | pennies: ${profile.likesPennyStocks?'yes':'no'} | lang: ${lang}`
    : '';

  console.log(`[CHATSTOX AI] Data blocks: ${dataBlocks.length} chars | lang: ${lang}`);

  const messages = [
    { role: 'system', content: dataBlocks },
    ...history.slice(-6).map(msg => ({ role: msg.role, content: msg.content })),
    { role: 'user', content: question || (isAutoAnalysis ? `Analyze ${stock?.ticker} using the real-time market data provided.` : 'What can you tell me about the market?') },
  ];

  const payload = {
    model: AI_MODEL, temperature: 0.2, max_tokens: 1800, messages,
    currentTicker: stock?.ticker || null,
    language: lang,
    profileContext,
  };

  if (onChunk) {
    return await openaiStream(payload, onChunk);
  }

  let data;
  try {
    data = await openaiPost(payload);
  } catch (e) {
    console.error('[CHATSTOX AI] OpenAI attempt 1 failed:', e.message);
    await wait(1000);
    console.log('[CHATSTOX AI] Retrying OpenAI request...');
    data = await openaiPost(payload);
  }

  return data.choices?.[0]?.message?.content || 'No response from AI.';
}

export async function generateMarketBrief({ indices = [], vix = null, gainers = [], losers = [], sectorData = [], timePhase = 'midday' }) {
  const pct = (s) => `${Number(s.changePercent) >= 0 ? '+' : ''}${Number(s.changePercent).toFixed(2)}%`;

  const spy     = indices.find(i => i.ticker === 'SPY');
  const qqq     = indices.find(i => i.ticker === 'QQQ');
  const dia     = indices.find(i => i.ticker === 'DIA');
  const iwm     = indices.find(i => i.ticker === 'IWM');
  const breadth = indices.find(i => i.ticker === 'BREADTH');

  const vixStr = vix?.value != null
    ? `VIX: ${Number(vix.value).toFixed(1)} (${
        Number(vix.value) < 15 ? 'Low volatility' :
        Number(vix.value) < 20 ? 'Normal volatility' :
        Number(vix.value) < 30 ? 'Elevated / caution' : 'Fear / high vol'
      })`
    : null;

  const lines = [
    spy     ? `SPY: $${Number(spy.price).toFixed(2)} (${pct(spy)})` : null,
    qqq     ? `QQQ: $${Number(qqq.price).toFixed(2)} (${pct(qqq)})` : null,
    dia     ? `DIA: $${Number(dia.price).toFixed(2)} (${pct(dia)})` : null,
    iwm     ? `IWM: $${Number(iwm.price).toFixed(2)} (${pct(iwm)})` : null,
    vixStr,
    breadth ? `Market breadth: ${breadth.rawValue} gainers (${breadth.rawChange})` : null,
    gainers[0] ? `Top gainer: ${gainers[0].ticker} ${pct(gainers[0])}` : null,
    losers[0]  ? `Top loser: ${losers[0].ticker} ${pct(losers[0])}`   : null,
    sectorData.length > 0
      ? `Sectors: ${sectorData.map(s => `${s.label} ${pct(s)}`).join(', ')}`
      : null,
  ].filter(Boolean).join('\n');

  const phaseInstructions = {
    premarket:  'Write a pre-market briefing. Cover: what the data implies about the open, key levels to watch, and overall tone. Sound like a trading desk pre-market note.',
    open:       'Write an opening bell note (first 60 min). Cover: opening tone (buyers or sellers in control?), early direction, and trend setting up for the session. Direct and actionable.',
    midday:     'Write a mid-day market note. Cover: morning session performance, current trend direction (continuing or fading?), and what to watch this afternoon. Direct and actionable.',
    powerhour:  'Write a power hour alert. The final trading hour is now underway. Cover: current SPY/QQQ direction, whether momentum into close is building or fading, key levels. Mention "power hour."',
    afterhours: "Write an after-hours recap. Cover: full-day performance, day's biggest winner and loser by name and %, and one key setup to watch tomorrow. Concise.",
  };

  const phasePrompt = phaseInstructions[timePhase] || phaseInstructions.midday;

  const messages = [
    {
      role: 'system',
      content: 'You are a professional financial analyst writing concise market briefs. Use ONLY the provided real-time data — never invent figures. Plain prose. No markdown. No bullet points. 65-word max.',
    },
    {
      role: 'user',
      content: `${phasePrompt}\n\nReal-time data:\n${lines}\n\nRules: 2-3 sentences max. 65-word limit. Start with the overall market direction. Name SPY and QQQ specifically. No disclaimers.`,
    },
  ];

  let data;
  try {
    data = await openaiPost({ model: AI_MODEL, temperature: 0.3, max_tokens: 160, messages });
  } catch (e) {
    console.error('[CHATSTOX AI] Market brief attempt 1 failed:', e.message);
    await wait(1000);
    data = await openaiPost({ model: AI_MODEL, temperature: 0.3, max_tokens: 160, messages });
  }
  return data.choices?.[0]?.message?.content?.trim() || '';
}
