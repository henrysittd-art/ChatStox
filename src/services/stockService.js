import { BACKEND_URL } from '../config/api';
const BACKEND = BACKEND_URL;

function mapSnapshot(snap) {
  const day       = snap.day        || {};
  const prevDay   = snap.prevDay    || {};
  const lastTrade = snap.lastTrade  || {};
  const lastQuote = snap.lastQuote  || {};
  const v3        = snap._v3session || {};   // injected by backend from Polygon v3
  const todaysChangePerc = snap.todaysChangePerc ?? 0;
  const todaysChange     = snap.todaysChange     ?? 0;

  // v3 session.price is extended-hours-aware (AH/PM); v2 lastTrade.p is null
  // on Starter plan after close. Fall through to v2 fields then day.c.
  const price = v3.price ?? lastTrade.p ?? lastQuote.P ?? day.c ?? 0;

  // v3 last_updated nanoseconds — prefer over v2 lastTrade.t for AH label
  const lastTradeTime = v3.lastUpdated ?? lastTrade.t ?? null;

  // IPO detection: no previous-day close AND extreme % gain means Polygon is
  // calculating the change vs the IPO price, not a real prior close.
  const noPrevClose = !prevDay.c || prevDay.c === 0;
  const isIPO       = noPrevClose && todaysChangePerc > 300;
  const ipoLabel    = isIPO
    ? (prevDay.v > 0 ? 'IPO · Day 2' : 'IPO · First day')
    : null;

  return {
    ticker: snap.ticker || '',
    name:   snap.name   || snap.ticker || '',
    price,
    dayClose:      day.c   ?? 0,
    changePercent: todaysChangePerc,
    todaysChange,
    volume:        day.v   ?? 0,
    open:          day.o   ?? 0,
    dayHigh:       day.h   ?? 0,
    dayLow:        day.l   ?? 0,
    vwap:          day.vw  ?? 0,
    previousClose:  prevDay.c ?? 0,
    previousLow:    prevDay.l ?? 0,
    previousHigh:   prevDay.h ?? 0,
    previousVolume: prevDay.v ?? 0,
    lastTradeTime,
    isIPO,
    ipoLabel,
    // Extended-hours deltas from v3 (null when unavailable)
    ahChange:     v3.lateChange     ?? null,
    ahChangePct:  v3.lateChangePct  ?? null,
    preChange:    v3.earlyChange    ?? null,
    preChangePct: v3.earlyChangePct ?? null,
  };
}

// ── Master watchlist ──────────────────────────────────────────────────────────
// 500+ popular, liquid tickers across every sector. Fetched in parallel batches
// of 100 via the Polygon batch snapshot endpoint. isValidStock then filters to
// those with real price/volume/movement — typically 300-450 pass on any trading day.

const MASTER_WATCHLIST = [
  // ── Mega-cap Tech / FAANG
  'AAPL', 'MSFT', 'NVDA', 'AMD', 'GOOGL', 'META', 'AMZN', 'NFLX',
  'INTC', 'QCOM', 'TXN', 'AVGO', 'MU', 'AMAT', 'LRCX', 'KLAC', 'MRVL',
  'ARM', 'SMCI', 'ADBE', 'INTU',
  // ── Cloud / SaaS (CFLT, PSTG, SEMR removed — no Polygon data)
  'CRM', 'ORCL', 'NOW', 'WDAY', 'TEAM', 'ZM', 'DOCU', 'TWLO', 'SHOP',
  'SNOW', 'DDOG', 'NET', 'CRWD', 'ZS', 'OKTA', 'PANW', 'FTNT',
  'MDB', 'GTLB', 'HUBS', 'VEEV', 'FRSH', 'BILL', 'BRZE',
  'TTD', 'NTAP', 'WDC', 'STX', 'DELL', 'HPQ', 'HPE',
  'S', 'MNDY', 'CWAN',
  // ── Fintech / Crypto (SQ removed — Polygon returns no data)
  'PYPL', 'COIN', 'MSTR', 'RIOT', 'MARA', 'HUT', 'CLSK', 'IREN',
  // ── AI / Data
  'PLTR', 'SOUN', 'BBAI', 'GFAI', 'PATH', 'IONQ', 'QUBT', 'RGTI', 'AIXI',
  // ── Optical / Networking (INFN removed — no Polygon data)
  'AAOI', 'VIAV', 'CIEN', 'LITE', 'COHR', 'LPTH', 'KOPN',

  // ── Bio / Pharma — large-cap
  'MRNA', 'PFE', 'JNJ', 'ABBV', 'BMY', 'LLY', 'AMGN', 'GILD', 'BIIB',
  'VRTX', 'REGN', 'ILMN', 'ABT', 'UNH', 'CVS', 'BNTX',
  // ── Bio / Pharma — mid-cap (SAGE, ITCI, HZNP, SPPI, EXAS, VERV, MRTX removed)
  'ALNY', 'BMRN', 'IONS', 'EXEL', 'HALO', 'ACAD',
  'AXSM', 'INVA', 'PRGO', 'AGEN', 'IMVT', 'KPTI', 'XNCR', 'ALKS',
  'INCY', 'JAZZ', 'AGIO', 'ARWR', 'KYMR',
  'PRAX', 'PRVA', 'RCUS', 'ACMR',
  'NBIX', 'PTGX', 'ADPT', 'ROIV', 'LEGN', 'ANAB', 'CLDX', 'RVMD',
  // ── Genomics / Gene editing (MRUS removed)
  'CRSP', 'BEAM', 'EDIT', 'NTLA', 'PACB', 'VCYT', 'NTRA', 'FATE',

  // ── Energy — oil & gas majors (PXD, MRO, HES removed — acquired/delisted)
  'XOM', 'CVX', 'COP', 'EOG', 'DVN', 'FANG', 'APA', 'OXY',
  'SLB', 'HAL', 'RIG', 'AR', 'EQT', 'CNX',
  // ── Energy — midstream / refining (ALTM, MMP removed — no Polygon data)
  'VLO', 'MPC', 'PSX', 'DK', 'PARR', 'CLMT', 'DINO', 'TRGP', 'KNTK',
  'ET', 'KMI', 'WMB', 'OKE',
  // ── Energy — E&P small/mid (ESTE, CIVI, CPE, VTLE, CDEV removed)
  'MTDR', 'BATL', 'REI', 'GPOR', 'SM', 'CRGY', 'NOG',
  // ── Coal (ARCH, CEIX removed)
  'BTU', 'AMR', 'HCC', 'METC', 'ARLP', 'NRP',

  // ── Finance — banks & investment
  'JPM', 'BAC', 'WFC', 'GS', 'MS', 'C', 'BLK', 'SCHW', 'COF', 'AXP',
  'V', 'MA', 'ICE', 'CME', 'CBOE', 'NDAQ', 'SPGI', 'MCO', 'MSCI',
  'FIS', 'FISV', 'GPN', 'BR',
  // ── Finance — fintech / lending
  'AFRM', 'SOFI', 'UPST', 'LC', 'FICO', 'SLM', 'HOOD', 'NU',
  // ── Finance — mortgage / REIT debt (MGIC, GHLD, COOP removed)
  'NMIH', 'ESNT', 'RDN', 'PFSI', 'UWMC', 'RKT', 'LDI',
  'TWO', 'MFA', 'AGNC', 'NLY', 'RITM', 'PMT', 'CHMI', 'BXMT',

  // ── Retail / Consumer hard goods (JWN, GPS, FL, BGFV, PET removed)
  'WMT', 'TGT', 'COST', 'HD', 'LOW', 'TJX', 'ROST', 'BURL',
  'M', 'KSS', 'ANF', 'AEO', 'URBN',
  'BOOT', 'DKS', 'SPWH', 'ASO',
  'LESL', 'POOL', 'SBH', 'ULTA', 'ELF', 'COTY', 'CHWY',
  'ETSY', 'EBAY', 'RVLV', 'W', 'OLLI', 'FIVE', 'DLTR', 'DG',
  // ── Consumer / Entertainment
  'GME', 'AMC', 'DIS', 'DASH', 'ABNB', 'DKNG', 'PENN', 'MGM',
  'LYFT', 'UBER', 'PTON', 'BYND', 'RBLX', 'SNAP', 'PINS',
  'BARK', 'WOOF', 'ZTS', 'IDXX',

  // ── EV / Auto (GOEV, RIDE, FFIE, MULN, SOLO, AYRO, ZEV, HYZN, IDEX, NKLA, PTRA removed)
  'TSLA', 'RIVN', 'LCID', 'EVGO', 'CHPT', 'BLNK', 'WKHS',
  'HYLN', 'NIO', 'XPEV', 'LI', 'GM', 'F', 'STLA',

  // ── Mining / Materials / Metals (LTHM removed)
  'NEM', 'GOLD', 'AEM', 'FCX', 'AA', 'ALB', 'MP', 'LAC', 'SQM',
  'HL', 'AG', 'CDE', 'PAAS', 'EXK', 'WPM',

  // ── Cannabis (MAPS, HEXO, CURLF, TCNNF, GABY removed — OTC/no data)
  'TLRY', 'CRON', 'ACB', 'CGC', 'OGI', 'GRWG', 'IIPR', 'SNDL', 'VFF',

  // ── Defense / Industrial / Aerospace
  'BA', 'LMT', 'RTX', 'NOC', 'GE', 'CAT', 'HON', 'MMM', 'DE',
  'LIN', 'APD', 'EMR', 'ITW',

  // ── Telecom / Media (PARA removed — no Polygon data)
  'T', 'VZ', 'TMUS', 'WBD', 'CMCSA',

  // ── Clean Energy / Utilities
  'ENPH', 'FSLR', 'RUN', 'NEE', 'PLUG', 'BLDP', 'FCEL', 'BE',

  // ── Banks / Regionals
  'USB', 'PNC', 'TFC', 'MTB', 'FITB', 'HBAN', 'KEY', 'RF', 'CFG', 'ZION',

  // ── Real estate
  'AMT', 'PLD', 'SPG', 'O', 'VICI', 'WELL', 'EQR', 'AVB', 'PSA', 'EXR',

  // ── Additional notable (MTTR, RDFN, DBRX, ILUS removed — no Polygon data)
  'ROKU', 'TDOC', 'HIMS', 'SPCE', 'OPEN', 'LMND', 'JOBY',
  'APPS', 'ADMA', 'AEVA', 'MIND',

  // ── ETFs (high-volume, move daily)
  'SPY', 'QQQ', 'IWM', 'GLD', 'SLV', 'TLT', 'HYG',
  'XLK', 'XLF', 'XLE', 'XLV', 'XLI', 'XLC', 'XLY', 'XLP', 'XLB', 'XLU',
  'ARKK', 'ARKG', 'ARKW', 'ARKF',

  // ── Penny / high-volatility (NAKD, EXPR, GOGL, FREE, MARK, XELA, KERN, CVLY, EGLE removed)
  'KOSS', 'CTRM', 'NAT', 'ZIM',
  'SB', 'TOPS', 'XTIA',
  'GOVX', 'OGEN', 'CBAT', 'BEEM', 'CLPS', 'HITI',
];

// ── Penny / OTC watchlist ─────────────────────────────────────────────────────
// Additional tickers beyond MASTER_WATCHLIST focused on OTC and micro-cap
// high-volatility names that frequently show up in penny stock screeners.
const PENNY_WATCHLIST = [
  // Biotech / pharma micro-cap
  'NRXP', 'BTAI', 'ADXS', 'SIGA', 'ADMP', 'ANVS', 'ATNX', 'MRSN',
  'NUVB', 'INVU', 'RSSS', 'DRUG', 'CRVS', 'VVOS', 'ACER', 'PRTK',
  'SRNE', 'TCON', 'XOMA', 'CLRB', 'CTIC', 'INFI', 'ACST', 'GNPX',
  // OTC cannabis
  'GTBIF', 'AYRWF', 'CCHWF', 'HRVSF', 'PLNHF', 'VRNOF',
  // Small-cap EV / energy
  'KNDI', 'SOS', 'TANH', 'EVTV',
  // OTC mining / resources
  'UUUU', 'UEC', 'GATO', 'IAUX', 'UAMY', 'PPTA',
  // Momentum / volatile small-cap
  'MVIS', 'DPLS', 'AABB', 'MINE', 'LIQT', 'VERB', 'HOFV', 'MMAT',
  'BFRI', 'TRVI', 'CODA', 'GFAI', 'SHOT', 'SOPA', 'AGFY', 'BTCS',
];

// ── Static name map ───────────────────────────────────────────────────────────
// Covers all MASTER_WATCHLIST tickers so enrichWithNames avoids per-stock API
// calls for known tickers (critical at 500-ticker scale).
const TICKER_NAMES = {
  // Mega-cap Tech
  AAPL: 'Apple', MSFT: 'Microsoft', NVDA: 'NVIDIA', AMD: 'Advanced Micro Devices',
  GOOGL: 'Alphabet', META: 'Meta Platforms', AMZN: 'Amazon', NFLX: 'Netflix',
  INTC: 'Intel', QCOM: 'Qualcomm', TXN: 'Texas Instruments', AVGO: 'Broadcom',
  MU: 'Micron Technology', AMAT: 'Applied Materials', LRCX: 'Lam Research',
  KLAC: 'KLA Corporation', MRVL: 'Marvell Technology', ARM: 'Arm Holdings',
  SMCI: 'Super Micro Computer', ADBE: 'Adobe', INTU: 'Intuit',
  // Cloud / SaaS
  CRM: 'Salesforce', ORCL: 'Oracle', NOW: 'ServiceNow', WDAY: 'Workday',
  TEAM: 'Atlassian', ZM: 'Zoom Video', DOCU: 'DocuSign', TWLO: 'Twilio',
  SHOP: 'Shopify', SNOW: 'Snowflake', DDOG: 'Datadog', NET: 'Cloudflare',
  CRWD: 'CrowdStrike', ZS: 'Zscaler', OKTA: 'Okta', PANW: 'Palo Alto Networks',
  FTNT: 'Fortinet', MDB: 'MongoDB', CFLT: 'Confluent', GTLB: 'GitLab',
  HUBS: 'HubSpot', VEEV: 'Veeva Systems', FRSH: 'Freshworks', BILL: 'Bill.com',
  BRZE: 'Braze', TTD: 'The Trade Desk', PSTG: 'Pure Storage', NTAP: 'NetApp',
  WDC: 'Western Digital', STX: 'Seagate Technology', DELL: 'Dell Technologies',
  HPQ: 'HP Inc.', HPE: 'Hewlett Packard Enterprise', S: 'SentinelOne',
  MNDY: 'monday.com', SEMR: 'Semrush', CWAN: 'Clearwater Analytics',
  // Fintech / Crypto
  SQ: 'Block', PYPL: 'PayPal', COIN: 'Coinbase', MSTR: 'MicroStrategy',
  RIOT: 'Riot Platforms', MARA: 'MARA Holdings', HUT: 'Hut 8 Corp',
  CLSK: 'CleanSpark', IREN: 'IREN Limited',
  // AI / Data
  PLTR: 'Palantir Technologies', SOUN: 'SoundHound AI', BBAI: 'BigBear.ai',
  GFAI: 'Guardforce AI', PATH: 'UiPath', IONQ: 'IonQ', QUBT: 'Quantum Computing',
  RGTI: 'Rigetti Computing', AIXI: 'Aixin AI International',
  // Optical / Networking
  AAOI: 'Applied Optoelectronics', VIAV: 'Viavi Solutions', INFN: 'Infinera',
  CIEN: 'Ciena', LITE: 'Lumentum Holdings', COHR: 'Coherent Corp',
  LPTH: 'LiqTech International', KOPN: 'Kopin Corporation',
  // Bio / Pharma large-cap
  MRNA: 'Moderna', PFE: 'Pfizer', JNJ: 'Johnson & Johnson', ABBV: 'AbbVie',
  BMY: 'Bristol-Myers Squibb', LLY: 'Eli Lilly', AMGN: 'Amgen',
  GILD: 'Gilead Sciences', BIIB: 'Biogen', VRTX: 'Vertex Pharmaceuticals',
  REGN: 'Regeneron', ILMN: 'Illumina', ABT: 'Abbott Laboratories',
  UNH: 'UnitedHealth Group', CVS: 'CVS Health', BNTX: 'BioNTech',
  // Bio / Pharma mid-cap
  ALNY: 'Alnylam Pharmaceuticals', BMRN: 'BioMarin', IONS: 'Ionis Pharmaceuticals',
  EXEL: 'Exelixis', HALO: 'Halozyme', ACAD: 'ACADIA Pharmaceuticals',
  SAGE: 'Sage Therapeutics', ITCI: 'Intra-Cellular Therapies',
  AXSM: 'Axsome Therapeutics', INVA: 'Innoviva', PRGO: 'Perrigo',
  AGEN: 'Agenus', IMVT: 'Immunovant', KPTI: 'Karyopharm Therapeutics',
  XNCR: 'Xencor', ALKS: 'Alkermes', INCY: 'Incyte', JAZZ: 'Jazz Pharmaceuticals',
  HZNP: 'Horizon Therapeutics', SPPI: 'Spectrum Pharmaceuticals', AGIO: 'Agios',
  ARWR: 'Arrowhead Pharmaceuticals', EXAS: 'Exact Sciences',
  KYMR: 'Kymera Therapeutics', VERV: 'Verve Therapeutics',
  PRAX: 'Praxis Precision Medicine', PRVA: 'Privia Health',
  RCUS: 'Arcus Biosciences', ACMR: 'ACM Research',
  NBIX: 'Neurocrine Biosciences', PTGX: 'Protagonist Therapeutics',
  MRTX: 'Mirati Therapeutics', ADPT: 'Adaptive Biotechnologies',
  ROIV: 'Roivant Sciences', LEGN: 'Legend Biotech',
  ANAB: 'AnaptysBio', CLDX: 'Celldex Therapeutics', RVMD: 'Revolution Medicines',
  // Genomics / Gene editing
  CRSP: 'CRISPR Therapeutics', BEAM: 'Beam Therapeutics', EDIT: 'Editas Medicine',
  NTLA: 'Intellia Therapeutics', PACB: 'Pacific Biosciences', VCYT: 'Veracyte',
  NTRA: 'Natera', MRUS: 'Merus', FATE: 'Fate Therapeutics',
  // Energy — oil & gas majors
  XOM: 'ExxonMobil', CVX: 'Chevron', COP: 'ConocoPhillips',
  EOG: 'EOG Resources', PXD: 'Pioneer Natural Resources', DVN: 'Devon Energy',
  FANG: 'Diamondback Energy', MRO: 'Marathon Oil', APA: 'APA Corporation',
  OXY: 'Occidental Petroleum', HES: 'Hess', SLB: 'SLB (Schlumberger)',
  HAL: 'Halliburton', RIG: 'Transocean', AR: 'Antero Resources',
  EQT: 'EQT Corporation', CNX: 'CNX Resources',
  // Energy — midstream / refining
  VLO: 'Valero Energy', MPC: 'Marathon Petroleum', PSX: 'Phillips 66',
  DK: 'Delek US Holdings', PARR: 'Par Pacific', CLMT: 'Calumet Specialty',
  DINO: 'HF Sinclair', TRGP: 'Targa Resources', ALTM: 'Altus Midstream',
  KNTK: 'Kinetik Holdings', ET: 'Energy Transfer', KMI: 'Kinder Morgan',
  WMB: 'Williams Companies', OKE: 'ONEOK', MMP: 'Magellan Midstream',
  // Energy — E&P
  ESTE: 'Earthstone Energy', MTDR: 'Matador Resources', CIVI: 'Civitas Resources',
  CPE: 'Callon Petroleum', BATL: 'Battalion Oil', REI: 'Ring Energy',
  GPOR: 'Gulfport Energy', SM: 'SM Energy', CRGY: 'Crescent Energy',
  NOG: 'Northern Oil and Gas', VTLE: 'Vital Energy', CDEV: 'Centennial Resource',
  // Coal
  BTU: 'Peabody Energy', ARCH: 'Arch Resources', AMR: 'Alpha Metallurgical Resources',
  CEIX: 'CONSOL Energy', HCC: 'Warrior Met Coal', METC: 'Ramaco Resources',
  ARLP: 'Alliance Resource Partners', NRP: 'Natural Resource Partners',
  // Finance — banks & investment
  JPM: 'JPMorgan Chase', BAC: 'Bank of America', WFC: 'Wells Fargo',
  GS: 'Goldman Sachs', MS: 'Morgan Stanley', C: 'Citigroup',
  BLK: 'BlackRock', SCHW: 'Charles Schwab', COF: 'Capital One',
  AXP: 'American Express', V: 'Visa', MA: 'Mastercard',
  ICE: 'Intercontinental Exchange', CME: 'CME Group', CBOE: 'Cboe Global Markets',
  NDAQ: 'Nasdaq', SPGI: 'S&P Global', MCO: "Moody's", MSCI: 'MSCI',
  FIS: 'Fidelity National Information', FISV: 'Fiserv', GPN: 'Global Payments',
  BR: 'Broadridge Financial',
  // Finance — fintech / lending
  AFRM: 'Affirm', SOFI: 'SoFi Technologies', UPST: 'Upstart', LC: 'LendingClub',
  FICO: 'Fair Isaac (FICO)', SLM: 'Sallie Mae', HOOD: 'Robinhood', NU: 'Nu Holdings',
  // Finance — mortgage / REIT debt
  NMIH: 'NMI Holdings', ESNT: 'Essent Group', MGIC: 'MGIC Investment',
  RDN: 'Radian Group', PFSI: 'PennyMac Financial', UWMC: 'UWM Holdings',
  RKT: 'Rocket Companies', GHLD: 'Guild Holdings', LDI: 'loanDepot',
  COOP: 'Mr. Cooper Group', TWO: 'Two Harbors', MFA: 'MFA Financial',
  AGNC: 'AGNC Investment', NLY: 'Annaly Capital', RITM: 'Rithm Capital',
  PMT: 'PennyMac Mortgage Trust', CHMI: 'Cherry Hill Mortgage',
  BXMT: 'Blackstone Mortgage',
  // Retail / Consumer
  WMT: 'Walmart', TGT: 'Target', COST: 'Costco', HD: 'Home Depot',
  LOW: "Lowe's", TJX: 'TJX Companies', ROST: 'Ross Stores',
  BURL: 'Burlington Stores', M: "Macy's", KSS: "Kohl's",
  JWN: 'Nordstrom', GPS: 'Gap', ANF: 'Abercrombie & Fitch',
  AEO: 'American Eagle', URBN: 'Urban Outfitters', BOOT: 'Boot Barn',
  DKS: "Dick's Sporting Goods", FL: 'Foot Locker', BGFV: 'Big 5 Sporting Goods',
  SPWH: "Sportsman's Warehouse", ASO: 'Academy Sports', LESL: "Leslie's",
  POOL: 'Pool Corporation', SBH: 'Sally Beauty', ULTA: 'Ulta Beauty',
  ELF: 'e.l.f. Beauty', COTY: 'Coty', CHWY: 'Chewy',
  ETSY: 'Etsy', EBAY: 'eBay', RVLV: 'Revolve Group', W: 'Wayfair',
  OLLI: "Ollie's Bargain Outlet", FIVE: 'Five Below', DLTR: 'Dollar Tree',
  DG: 'Dollar General',
  // Consumer / Entertainment
  GME: 'GameStop', AMC: 'AMC Entertainment', DIS: 'Walt Disney',
  DASH: 'DoorDash', ABNB: 'Airbnb', DKNG: 'DraftKings', PENN: 'Penn Entertainment',
  MGM: 'MGM Resorts', LYFT: 'Lyft', UBER: 'Uber', PTON: 'Peloton',
  BYND: 'Beyond Meat', RBLX: 'Roblox', SNAP: 'Snap', PINS: 'Pinterest',
  PET: 'PetMed Express', BARK: 'BARK Inc.', WOOF: 'Petco Health & Wellness',
  ZTS: 'Zoetis', IDXX: 'IDEXX Laboratories',
  // EV / Auto
  TSLA: 'Tesla', RIVN: 'Rivian', LCID: 'Lucid Motors', GOEV: 'Canoo',
  RIDE: 'Lordstown Motors', FFIE: 'Faraday Future', MULN: 'Mullen Automotive',
  SOLO: 'Electrameccanica', AYRO: 'AYRO', ZEV: 'Lightning eMotors',
  HYZN: 'Hyzon Motors', IDEX: 'Ideanomics', EVGO: 'EVgo', CHPT: 'ChargePoint',
  BLNK: 'Blink Charging', WKHS: 'Workhorse Group', NKLA: 'Nikola',
  PTRA: 'Proterra', HYLN: 'Hyliion', NIO: 'NIO', XPEV: 'XPeng', LI: 'Li Auto',
  GM: 'General Motors', F: 'Ford Motor', STLA: 'Stellantis',
  // Mining / Materials
  NEM: 'Newmont', GOLD: 'Barrick Gold', AEM: 'Agnico Eagle',
  FCX: 'Freeport-McMoRan', AA: 'Alcoa', ALB: 'Albemarle', MP: 'MP Materials',
  LTHM: 'Livent', LAC: 'Lithium Americas', SQM: 'SQM',
  HL: 'Hecla Mining', AG: 'First Majestic Silver', CDE: 'Coeur Mining',
  PAAS: 'Pan American Silver', EXK: 'Endeavour Silver', WPM: 'Wheaton Precious Metals',
  // Cannabis
  TLRY: 'Tilray Brands', CRON: 'Cronos Group', ACB: 'Aurora Cannabis',
  CGC: 'Canopy Growth', OGI: 'OrganiGram', GRWG: 'GrowGeneration',
  IIPR: 'Innovative Industrial', MAPS: 'WM Technology', SNDL: 'SNDL Inc.',
  HEXO: 'HEXO Corp', VFF: 'Village Farms', CURLF: 'Curaleaf Holdings',
  TCNNF: 'Trulieve Cannabis', GABY: 'GABY Inc.',
  // Defense / Industrial
  BA: 'Boeing', LMT: 'Lockheed Martin', RTX: 'RTX Corporation',
  NOC: 'Northrop Grumman', GE: 'GE Aerospace', CAT: 'Caterpillar',
  HON: 'Honeywell', MMM: '3M', DE: 'Deere & Company',
  LIN: 'Linde', APD: 'Air Products', EMR: 'Emerson Electric', ITW: 'Illinois Tool Works',
  // Telecom / Media
  T: 'AT&T', VZ: 'Verizon', TMUS: 'T-Mobile', PARA: 'Paramount Global',
  WBD: 'Warner Bros. Discovery', CMCSA: 'Comcast',
  // Clean Energy / Utilities
  ENPH: 'Enphase Energy', FSLR: 'First Solar', RUN: 'Sunrun',
  NEE: 'NextEra Energy', PLUG: 'Plug Power', BLDP: 'Ballard Power',
  FCEL: 'FuelCell Energy', BE: 'Bloom Energy',
  // Regional banks
  USB: 'U.S. Bancorp', PNC: 'PNC Financial Services', TFC: 'Truist Financial',
  MTB: 'M&T Bank', FITB: 'Fifth Third Bancorp', HBAN: 'Huntington Bancshares',
  KEY: 'KeyCorp', RF: 'Regions Financial', CFG: 'Citizens Financial', ZION: 'Zions Bancorporation',
  // Real estate REITs
  AMT: 'American Tower', PLD: 'Prologis', SPG: 'Simon Property Group',
  O: 'Realty Income', VICI: 'VICI Properties', WELL: 'Welltower',
  EQR: 'Equity Residential', AVB: 'AvalonBay Communities',
  PSA: 'Public Storage', EXR: 'Extra Space Storage',
  // Additional notable
  ROKU: 'Roku', TDOC: 'Teladoc Health', HIMS: 'Hims & Hers Health',
  SPCE: 'Virgin Galactic', OPEN: 'Opendoor Technologies', LMND: 'Lemonade',
  JOBY: 'Joby Aviation', MTTR: 'Matterport', RDFN: 'Redfin',
  APPS: 'Digital Turbine', ILUS: 'ILUS International',
  ADMA: 'ADMA Biologics', AEVA: 'Aeva Technologies', MIND: 'MIND Technology',
  // ETFs
  SPY: 'SPDR S&P 500 ETF', QQQ: 'Invesco QQQ', IWM: 'iShares Russell 2000',
  GLD: 'SPDR Gold Shares', SLV: 'iShares Silver Trust',
  TLT: 'iShares 20+ Year Treasury', HYG: 'iShares High Yield Bond',
  XLK: 'Technology Select Sector SPDR', XLF: 'Financial Select Sector SPDR',
  XLE: 'Energy Select Sector SPDR', XLV: 'Health Care Select Sector SPDR',
  XLI: 'Industrial Select Sector SPDR', XLC: 'Communication Services SPDR',
  XLY: 'Consumer Discretionary SPDR', XLP: 'Consumer Staples SPDR',
  XLB: 'Materials Select Sector SPDR', XLU: 'Utilities Select Sector SPDR',
  ARKK: 'ARK Innovation ETF', ARKG: 'ARK Genomic Revolution ETF',
  ARKW: 'ARK Next Generation Internet ETF', ARKF: 'ARK Fintech Innovation ETF',
  // Penny / high-volatility
  NAKD: 'Naked Brand Group', EXPR: 'Express', KOSS: 'Koss Corporation',
  CTRM: 'Castor Maritime', NAT: 'Nordic American Tankers',
  ZIM: 'ZIM Integrated Shipping', EGLE: 'Eagle Bulk Shipping',
  GOGL: 'Golden Ocean Group', SB: 'Safe Bulkers', TOPS: 'TOP Ships',
  FREE: 'Whole Earth Brands', MARK: 'Remark Holdings', XTIA: 'XTI Aerospace',
  XELA: 'Exela Technologies', GOVX: 'GeoVax Labs', OGEN: 'Oragenics',
  CBAT: 'CBAK Energy Technology', BEEM: 'Beam Global', CLPS: 'CLPS Technology',
  KERN: 'Akerna Corp', HITI: 'High Tide', CVLY: 'Codorus Valley Bancorp',
  VIX: 'CBOE Volatility Index',
  // Penny / OTC watchlist additions
  NRXP: 'NRx Pharmaceuticals', BTAI: 'BioAtla', ADXS: 'Advaxis',
  SIGA: 'SIGA Technologies', ADMP: 'Adamis Pharmaceuticals', ANVS: 'Annovis Bio',
  ATNX: 'Athenex', MRSN: 'Mersana Therapeutics', NUVB: 'Nuvation Bio',
  INVU: 'Investview', RSSS: 'Research Solutions', DRUG: 'Dare Bioscience',
  CRVS: 'Corvus Pharmaceuticals', VVOS: 'Vivos Therapeutics', ACER: 'Acer Therapeutics',
  PRTK: 'Paratek Pharmaceuticals', SRNE: 'Sorrento Therapeutics',
  TCON: 'Tricida', XOMA: 'XOMA Corp', CLRB: 'Cellectar Biosciences',
  CTIC: 'CTI BioPharma', INFI: 'Infinity Pharmaceuticals',
  ACST: 'Acasti Pharma', GNPX: 'Genprobe',
  GTBIF: 'Green Thumb Industries', AYRWF: 'AYR Wellness',
  CCHWF: 'Columbia Care', HRVSF: 'Harvest Health & Recreation',
  PLNHF: 'Planet 13 Holdings', VRNOF: 'Verano Holdings',
  KNDI: 'Kandi Technologies', SOS: 'SOS Limited',
  TANH: 'Tantech Holdings', EVTV: 'Envirotech Vehicles',
  UUUU: 'Energy Fuels', UEC: 'Uranium Energy Corp',
  GATO: 'Gatos Silver', IAUX: 'i-80 Gold Corp', UAMY: 'US Antimony',
  PPTA: 'Perpetua Resources', MVIS: 'MicroVision', DPLS: 'DPW Holdings',
  AABB: 'Asia Broadband', MINE: 'Minerium Resources', LIQT: 'LiqTech International',
  VERB: 'Verb Technology', HOFV: 'Hall of Fame Resort', MMAT: 'Meta Materials',
  BFRI: 'Biofrontera', TRVI: 'Trevi Therapeutics', CODA: 'Coda Octopus Group',
  SHOT: 'Safety Shot', SOPA: 'Society Pass', AGFY: 'Agrify Corp',
  BTCS: 'BTCS Inc.',
};

// ── Sector classification ─────────────────────────────────────────────────────
// Returns one of: Tech | Bio/Pharma | Clean Energy | Energy | Finance | Crypto |
// EV/Auto | Cannabis | Defense | Consumer | Other
export function classifySector(ticker, name) {
  const t = (ticker || '').toUpperCase();
  const n = (name || '').toLowerCase();
  // Crypto — checked first (some names overlap with tech)
  if (['MSTR','COIN','RIOT','MARA','HUT','CLSK','IREN'].includes(t) ||
      /bitcoin|crypto|blockchain/.test(n)) return 'Crypto';
  // Cannabis
  if (['TLRY','CRON','ACB','CGC','GRWG','SNDL','IIPR'].includes(t) ||
      /cannabis|marijuana|\bhemp\b|\bcbd\b/.test(n)) return 'Cannabis';
  // EV/Auto
  if (['TSLA','RIVN','LCID','EVGO','CHPT','BLNK','NIO','XPEV','LI','GM','F','STLA','WKHS','HYLN'].includes(t) ||
      /electric vehicle|ev motor|\bautomotive\b|vehicle manuf/.test(n)) return 'EV/Auto';
  // Bio/Pharma
  if (['PFE','MRNA','BNTX','JNJ','MRK','GILD','BIIB','VRTX','REGN','AMGN','ABBV','LLY','BMY'].includes(t) ||
      /pfizer|moderna|biontech|johnson|merck|gilead|biogen|vertex|regeneron/.test(n) ||
      /\bpharma\b|therapeut|genomic|gene therap|oncolog|bioscien|biotech|biopharma/.test(n) ||
      /\bclinical trial\b|drug discov/.test(n)) return 'Bio/Pharma';
  // Clean Energy / Utilities
  if (['NEE','DUK','RUN','ENPH','SEDG','BE','FCEL','PLUG','BLDP','FSLR'].includes(t) ||
      /eversource|nextera|duke energy|dominion|sunrun|enphase|solaredge/.test(n) ||
      /\bsolar\b|\bwind power\b|fuel cell|\bclean energy\b|utilities/.test(n)) return 'Clean Energy';
  // Energy (oil, gas, mining, materials)
  if (['XOM','CVX','COP','DVN','MPC','VLO','HAL','SLB','OXY','PSX','EOG'].includes(t) ||
      /exxonmobil|chevron|conocophillips|pioneer natural|devon energy|marathon petroleum|halliburton/.test(n) ||
      /\boil\b|\bpetroleum\b|natural gas co|fossil fuel|\bcoal\b|\bmining\b|precious metal|lithium mine/.test(n)) return 'Energy';
  // Finance
  if (['JPM','BAC','GS','MS','WFC','C','V','MA','AXP','SOFI','HOOD','AFRM','UPST','PYPL'].includes(t) ||
      /jpmorgan|goldman sachs|bank of america|wells fargo|morgan stanley|citigroup|capital one|american express/.test(n) ||
      /\bbank\b|\bbanking\b|financial serv|fintech|\binsurance\b|\bmortgage\b|\blending\b/.test(n)) return 'Finance';
  // Defense/Industrial
  if (['BA','LMT','NOC','RTX','GE','CAT','HON'].includes(t) ||
      /boeing|lockheed|northrop|raytheon|\bdefense\b|\baerospace\b|\bmilitary\b|\bweapon\b/.test(n)) return 'Defense';
  // Consumer/Retail
  if (['WMT','TGT','COST','AMZN','DIS','DASH','ABNB','DKNG','GME','AMC'].includes(t) ||
      /walmart|target|costco|amazon|walt disney|doordash|airbnb|draftking/.test(n) ||
      /\bretail\b|\brestaurant\b|\bhospitality\b|\bapparel\b|\bgrocery\b/.test(n)) return 'Consumer';
  // Tech — broad catch-all last
  if (['AAPL','MSFT','GOOGL','GOOG','META','NVDA','AMD','INTC','QCOM','CRM','ORCL','ADBE',
       'NOW','ZM','NET','CRWD','PANW','DDOG','SNOW','PLTR','SOUN','BBAI','PATH','IONQ'].includes(t) ||
      /intel|amd|nvidia|apple|microsoft|google|alphabet|meta platforms|snap inc|zoom video|salesforce|oracle|adobe|shopify|paypal/.test(n) ||
      /technolog|software|\bsemiconductor\b|\bcomputing\b|cybersec|\bsaas\b|\bcloud\b|\bsilicon\b|artificial intel|machine learn/.test(n)) return 'Tech';
  return 'Other';
}

// ── Cache & in-flight state ───────────────────────────────────────────────────
let _masterCache = null;
let _masterCacheTime = 0;
let _masterFlight = null;
const MASTER_CACHE_TTL = 60_000;

// Fetch one batch of tickers (≤100) via the local proxy's /api/batch endpoint.
async function fetchBatchSnapshots(tickers) {
  const joined = encodeURIComponent(tickers.join(','));
  const url = `${BACKEND}/api/batch?tickers=${joined}`;
  const res = await fetch(url);
  const json = await res.json();
  return json.tickers || [];
}

// Fetch PENNY_WATCHLIST batch snapshot (separate cache so it doesn't compete with master).
let _pennyCache = null;
let _pennyCacheTime = 0;
let _pennyFlight = null;
const PENNY_CACHE_TTL = 60_000;

async function fetchPennyBatch() {
  if (_pennyCache && Date.now() - _pennyCacheTime < PENNY_CACHE_TTL) return _pennyCache;
  if (_pennyFlight) return _pennyFlight;
  _pennyFlight = (async () => {
    try {
      const raw = await fetchBatchSnapshots(PENNY_WATCHLIST);
      console.log(`[fetchPennyBatch] ${raw.length} raw snapshots for ${PENNY_WATCHLIST.length} penny tickers`);
      _pennyCache = raw;
      _pennyCacheTime = Date.now();
      return raw;
    } catch (e) {
      console.error('[fetchPennyBatch] error:', e);
      return [];
    } finally {
      _pennyFlight = null;
    }
  })();
  return _pennyFlight;
}

// Fetch all MASTER_WATCHLIST tickers in parallel batches of 100.
// 60 s TTL cache + in-flight dedup so concurrent callers (fetchTopGainers,
// fetchTopLosers) share a single set of requests on the first load.
async function fetchMasterWatchlist() {
  if (_masterCache && Date.now() - _masterCacheTime < MASTER_CACHE_TTL) {
    return _masterCache;
  }
  if (_masterFlight) return _masterFlight;
  _masterFlight = (async () => {
    try {
      const BATCH_SIZE = 100;
      const batches = [];
      for (let i = 0; i < MASTER_WATCHLIST.length; i += BATCH_SIZE) {
        batches.push(MASTER_WATCHLIST.slice(i, i + BATCH_SIZE));
      }
      const results = await Promise.all(batches.map(fetchBatchSnapshots));
      const flat = results.flat();
      console.log(`[fetchMasterWatchlist] ${flat.length} raw snapshots from ${batches.length} batches (${MASTER_WATCHLIST.length} requested)`);
      _masterCache = flat;
      _masterCacheTime = Date.now();
      return flat;
    } catch (e) {
      console.error('[fetchMasterWatchlist] error:', e);
      return [];
    } finally {
      _masterFlight = null;
    }
  })();
  return _masterFlight;
}

// Flatten multiple raw snapshot arrays, deduplicate by ticker, map + filter.
function mergeAndFilter(rawArrays) {
  const seen = new Set();
  const flat = rawArrays.flat();
  console.log(`[mergeAndFilter] raw total=${flat.length}`);

  const deduped = flat.filter(s => {
    if (!s?.ticker || seen.has(s.ticker)) return false;
    seen.add(s.ticker);
    return true;
  });
  console.log(`[mergeAndFilter] after dedup=${deduped.length}`);

  const mapped = deduped.map(mapSnapshot);
  const passed = mapped.filter(isValidStock);
  const dropped = mapped.length - passed.length;
  console.log(`[mergeAndFilter] after mapSnapshot=${mapped.length}, after isValidStock=${passed.length} (dropped ${dropped})`);

  // Log any stock with price=0 or vol=0 to catch filter edge cases
  const zeroPx = mapped.filter(s => !Number(s.price)).length;
  const zeroVol = mapped.filter(s => !Number(s.volume) || Number(s.volume) < 1000).length;
  if (zeroPx > 0 || zeroVol > 0) {
    console.log(`[mergeAndFilter] zero-price=${zeroPx}, low-vol(<1K)=${zeroVol}`);
  }

  return passed;
}

// ── Name enrichment ───────────────────────────────────────────────────────────
// Checks TICKER_NAMES first — covers the entire master watchlist so in practice
// the API fallback is only hit for tickers from the gainers/losers endpoints
// that aren't in the static map.

const _nameCache = {};
const _nameFlight = {};

async function fetchName(ticker) {
  if (_nameCache[ticker]) return _nameCache[ticker];
  if (_nameFlight[ticker]) return _nameFlight[ticker];
  _nameFlight[ticker] = (async () => {
    try {
      const res  = await fetch(`${BACKEND}/api/details/${encodeURIComponent(ticker)}`);
      const json = await res.json();
      const name = json.results?.name || ticker;
      _nameCache[ticker] = name;
      return name;
    } catch {
      return ticker;
    } finally {
      delete _nameFlight[ticker];
    }
  })();
  return _nameFlight[ticker];
}

async function enrichWithNames(stocks) {
  if (!stocks.length) return stocks;
  // Apply TICKER_NAMES map first; only call the API for truly unknown tickers.
  const unknowns = stocks.filter(s => !TICKER_NAMES[s.ticker] && !_nameCache[s.ticker]);
  if (unknowns.length) {
    const names = await Promise.all(unknowns.map(s => fetchName(s.ticker)));
    unknowns.forEach((s, i) => { _nameCache[s.ticker] = names[i]; });
  }
  return stocks.map(s => {
    const resolvedName = TICKER_NAMES[s.ticker] || _nameCache[s.ticker] || s.name;
    return {
      ...s,
      name: resolvedName,
      sector: classifySector(s.ticker, resolvedName),
    };
  });
}

// ── Validity filter ───────────────────────────────────────────────────────────

// Tickers with known bad Polygon data (ticker changes, corporate actions, etc.)
// AGNT: eXp World Holdings changed ticker EXPI→AGNT on 2026-05-08.
//       Polygon compares new AGNT price to old EXPI price, generating a ~565% false gain.
//       Remove after a full trading week when Polygon normalises the baseline.
const BLACKLISTED_TICKERS = new Set(['AGNT']);

function isValidStock(s) {
  const pct    = Number(s.changePercent);
  const price  = Number(s.price);
  const vol    = Number(s.volume);
  const ticker = s.ticker || '';

  if (BLACKLISTED_TICKERS.has(ticker)) return false; // known bad data
  if (!price || price < 0.0001)   return false;   // missing, zero, or sub-penny ghost
  if (!vol   || vol < 1000)       return false;   // no real volume
  if (pct === 0)                  return false;   // completely flat
  if (pct > 2000 || pct < -95)    return false;   // extreme outlier
  if (ticker.endsWith('Q'))       return false;   // bankruptcy symbol
  if (ticker.length > 5)          return false;   // warrant / rights suffix

  // Only filter obvious data errors: >900% move on near-zero volume
  if (pct > 900 && vol < 10_000)  return false;

  return true;
}

export async function fetchTopGainers() {
  try {
    const [gainersJson, masterRaws, pennyRaws] = await Promise.all([
      fetch(`${BACKEND}/api/gainers`).then(r => r.json()),
      fetchMasterWatchlist(),
      fetchPennyBatch(),
    ]);
    const stocks = mergeAndFilter([gainersJson.tickers || [], masterRaws, pennyRaws])
      .sort((a, b) => Number(b.changePercent) - Number(a.changePercent));
    console.log(`[fetchTopGainers] ${stocks.length} stocks (gainers OTC: ${(gainersJson.tickers || []).length}, master: ${masterRaws.length}, penny: ${pennyRaws.length})`);

    // ── DEBUG: show price/volume distribution of returned gainers ────────────
    const under5  = stocks.filter(s => Number(s.price) < 5).length;
    const under15 = stocks.filter(s => Number(s.price) >= 5 && Number(s.price) < 15).length;
    const over15  = stocks.filter(s => Number(s.price) >= 15).length;
    const highPct = stocks.filter(s => Number(s.changePercent) > 15).length;
    console.log(`[fetchTopGainers] Price buckets → <$5: ${under5} | $5-$15: ${under15} | >$15: ${over15} | >15% gain: ${highPct}`);
    console.log('[fetchTopGainers] Top 15 gainers by % (ticker | price | pct | volume):');
    stocks.slice(0, 15).forEach((s, i) => {
      console.log(`  ${i + 1}. ${s.ticker} | $${Number(s.price).toFixed(2)} | ${Number(s.changePercent).toFixed(2)}% | vol ${Number(s.volume).toLocaleString()}`);
    });

    const enriched = await enrichWithNames(stocks);
    return enriched;
  } catch (e) {
    console.error('fetchTopGainers error:', e);
    return [];
  }
}

export async function fetchTopLosers() {
  try {
    const [losersJson, masterRaws] = await Promise.all([
      fetch(`${BACKEND}/api/losers`).then(r => r.json()),
      fetchMasterWatchlist(),
    ]);
    const stocks = mergeAndFilter([losersJson.tickers || [], masterRaws])
      .sort((a, b) => Number(a.changePercent) - Number(b.changePercent));
    console.log(`[fetchTopLosers] ${stocks.length} stocks (losers endpoint: ${(losersJson.tickers || []).length}, master: ${masterRaws.length})`);
    return enrichWithNames(stocks);
  } catch (e) {
    console.error('fetchTopLosers error:', e);
    return [];
  }
}

export async function fetchTopVolume() {
  try {
    const [gainersJson, losersJson, masterRaws] = await Promise.all([
      fetch(`${BACKEND}/api/gainers`).then(r => r.json()),
      fetch(`${BACKEND}/api/losers`).then(r => r.json()),
      fetchMasterWatchlist(),
    ]);
    const stocks = mergeAndFilter([gainersJson.tickers || [], losersJson.tickers || [], masterRaws])
      .sort((a, b) => Number(b.volume) - Number(a.volume));
    console.log(`[fetchTopVolume] ${stocks.length} stocks`);
    return enrichWithNames(stocks);
  } catch (e) {
    console.error('fetchTopVolume error:', e);
    return [];
  }
}

export async function fetchQuote(ticker) {
  try {
    const res  = await fetch(`${BACKEND}/api/quote/${encodeURIComponent(ticker)}`);
    const json = await res.json();
    if (json.ticker) return mapSnapshot(json.ticker);
    return null;
  } catch (e) {
    console.error(`fetchQuote(${ticker}) error:`, e);
    return null;
  }
}

export async function fetchTickerDetails(ticker) {
  try {
    const res  = await fetch(`${BACKEND}/api/details/${encodeURIComponent(ticker)}`);
    const json = await res.json();
    const r = json.results || {};
    return {
      name: r.name || ticker,
      sector: r.sic_description || '',
      description: r.description || '',
      exchange: r.primary_exchange || '',
      marketCap: r.market_cap || 0,
      employees: r.total_employees || 0,
      sharesOutstanding: r.share_class_shares_outstanding || r.weighted_shares_outstanding || 0,
    };
  } catch (e) {
    console.error(`fetchTickerDetails(${ticker}) error:`, e);
    return { name: ticker, sector: '', description: '', exchange: '', marketCap: 0, employees: 0 };
  }
}

export async function fetchTickerNews(ticker) {
  try {
    const res     = await fetch(`${BACKEND}/api/news/${encodeURIComponent(ticker)}`);
    const json    = await res.json();
    const results = json.results || [];
    return results.map(item => ({
      headline: item.title || '',
      description: item.description || '',
      published: item.published_utc || '',
    }));
  } catch (e) {
    console.error(`fetchTickerNews(${ticker}) error:`, e);
    return [];
  }
}

export async function fetchPrevDay(ticker) {
  try {
    const res  = await fetch(`${BACKEND}/api/prevday/${encodeURIComponent(ticker)}`);
    const json = await res.json();
    // Backend returns {open,high,low,close,volume} directly (normalized, not wrapped in results[])
    if (!json || !json.close) return null;
    return { close: json.close, high: json.high, low: json.low, open: json.open, volume: json.volume };
  } catch (e) {
    console.error(`fetchPrevDay(${ticker}) error:`, e);
    return null;
  }
}

export async function fetch5DayHistory(ticker) {
  try {
    const res  = await fetch(`${BACKEND}/api/history/${encodeURIComponent(ticker)}`);
    const json = await res.json();
    // Backend returns a plain array [{t,o,h,l,c,v}, ...] directly
    const bars = Array.isArray(json) ? json : [];
    return bars.map(bar => ({
      date:   new Date(bar.t).toISOString().split('T')[0],
      close:  bar.c, high: bar.h, low: bar.l, open: bar.o, volume: bar.v,
    }));
  } catch (e) {
    console.error(`fetch5DayHistory(${ticker}) error:`, e);
    return [];
  }
}

export async function fetchExtendedData(ticker, todayVolume) {
  const [prevDay, history] = await Promise.all([
    fetchPrevDay(ticker),
    fetch5DayHistory(ticker),
  ]);

  // RVOL: today's volume vs average of prior bars (exclude today's bar if included)
  let rvol = null;
  if (history.length >= 2 && Number(todayVolume) > 0) {
    const priorBars = history.slice(0, history.length - 1).slice(-5);
    if (priorBars.length > 0) {
      const avgVol = priorBars.reduce((s, b) => s + Number(b.volume), 0) / priorBars.length;
      if (avgVol > 0) rvol = Number(todayVolume) / avgVol;
    }
  }

  // 5-day price trend from first to last bar
  let fiveDayPct = null;
  let trendLabel = 'Sideways';
  if (history.length >= 2) {
    const first = Number(history[0].close);
    const last  = Number(history[history.length - 1].close);
    if (first > 0) {
      fiveDayPct = ((last - first) / first) * 100;
      trendLabel = fiveDayPct > 3 ? 'Uptrend' : fiveDayPct < -3 ? 'Downtrend' : 'Sideways';
    }
  }

  return { prevDay, history, rvol, fiveDayPct, trendLabel };
}

export async function fetchIntradayChart(ticker) {
  try {
    const res  = await fetch(`${BACKEND}/api/chart/${encodeURIComponent(ticker)}`);
    const json = await res.json();
    return (json.results || []).map(bar => ({
      t: bar.t, o: bar.o, h: bar.h, l: bar.l, c: bar.c, v: bar.v,
    }));
  } catch (e) {
    console.error(`fetchIntradayChart(${ticker}) error:`, e);
    return [];
  }
}

export async function fetchMarketIndices() {
  const tickers = ['SPY', 'QQQ'];
  try {
    const results = await Promise.all(tickers.map(t => fetchQuote(t)));
    return results.filter(Boolean);
  } catch (e) {
    return [];
  }
}

const BRIEF_SECTORS = [
  { ticker: 'XLK', label: 'Tech' },
  { ticker: 'XLF', label: 'Finance' },
  { ticker: 'XLE', label: 'Energy' },
  { ticker: 'XLV', label: 'Health' },
  { ticker: 'XLI', label: 'Indust.' },
];

export async function fetchSectorSummary() {
  try {
    const res  = await fetch(`${BACKEND}/api/sector-summary`);
    const json = await res.json();
    const byTicker = {};
    (json.tickers || []).forEach(snap => { byTicker[snap.ticker] = mapSnapshot(snap); });
    return BRIEF_SECTORS.map(({ ticker, label }) => ({
      ...(byTicker[ticker] || { ticker, price: 0, changePercent: 0 }),
      label,
    }));
  } catch (e) {
    console.error('fetchSectorSummary error:', e);
    return [];
  }
}

export async function fetchBriefIndices() {
  try {
    const res  = await fetch(`${BACKEND}/api/batch?tickers=SPY,QQQ,DIA,IWM`);
    const json = await res.json();
    return (json.tickers || []).map(mapSnapshot);
  } catch {
    return [];
  }
}

export async function fetchVIX() {
  try {
    const res = await fetch(`${BACKEND}/api/vix`);
    if (!res.ok) return null;
    const json = await res.json();
    if (json.error || json.value == null) return null;
    return json;
  } catch {
    return null;
  }
}

export async function fetchEarnings(ticker) {
  try {
    const res  = await fetch(`${BACKEND}/api/earnings/${encodeURIComponent(ticker)}`);
    const json = await res.json();
    return Array.isArray(json) ? json : [];
  } catch {
    return [];
  }
}
