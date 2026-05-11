import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, RefreshControl, SafeAreaView, Animated,
  Platform, UIManager, LayoutAnimation, useWindowDimensions,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchTopGainers, fetchTopLosers, fetchMarketIndices, fetchSectorSummary, fetchBriefIndices, fetchVIX, fetchQuote, fetchTickerDetails } from '../services/stockService';
import { generateMarketBrief } from '../services/aiService';
import { extractTicker } from '../utils/tickerExtractor';
import { calcRisk } from '../utils/riskLevel';
import { LogoIcon } from '../components/ChatstoxLogo';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const TABS = [
  { key: 'active',   label: 'Most Active' },
  { key: 'trending', label: 'Trending Now' },
  { key: 'gainers',  label: 'Top Gainers' },
  { key: 'losers',   label: 'Top Losers' },
];

const PAGE_SIZE = 20;
const INITIAL_VISIBLE = {
  active: PAGE_SIZE, trending: PAGE_SIZE, gainers: PAGE_SIZE, losers: PAGE_SIZE,
};

const DEFAULT_SORT = {
  active:   { col: 'vol',      dir: 'desc' },
  trending: { col: 'trending', dir: 'desc' },
  gainers:  { col: 'pct',      dir: 'desc' },
  losers:   { col: 'pct',      dir: 'asc'  },
};

// ── Sector filter constants & helpers ─────────────────────────────────────────

const SIDEBAR_CATEGORIES = [
  { key: 'All',        label: 'All Stocks' },
  { key: 'Tech',       label: 'Tech' },
  { key: 'Bio/Pharma', label: 'Bio/Pharma' },
  { key: 'Energy',     label: 'Energy' },
  { key: 'Finance',    label: 'Finance' },
  { key: 'Retail',     label: 'Retail' },
  { key: 'Mining',     label: 'Mining' },
  { key: 'Cannabis',   label: 'Cannabis' },
  { key: 'EV/Auto',    label: 'EV/Auto' },
  { key: 'AI',         label: 'AI' },
];

const KNOWN_TICKER_SECTORS = {
  NVDA: 'AI', PLTR: 'AI', SOUN: 'AI', BBAI: 'AI',
  AAPL: 'Tech', MSFT: 'Tech', GOOGL: 'Tech', GOOG: 'Tech', META: 'Tech',
  AMZN: 'Tech', NFLX: 'Tech', AMD: 'Tech', INTC: 'Tech', QCOM: 'Tech',
  AVGO: 'Tech', CRM: 'Tech', ORCL: 'Tech', ADBE: 'Tech', NOW: 'Tech',
  SNOW: 'Tech', CRWD: 'Tech', PANW: 'Tech', ZS: 'Tech', NET: 'Tech', DDOG: 'Tech',
  SHOP: 'Tech', UBER: 'Tech', LYFT: 'Tech', TWLO: 'Tech', COIN: 'Tech',
  TSLA: 'EV/Auto', RIVN: 'EV/Auto', LCID: 'EV/Auto', NIO: 'EV/Auto',
  XPEV: 'EV/Auto', LI: 'EV/Auto', GM: 'EV/Auto', F: 'EV/Auto', TM: 'EV/Auto',
  MRNA: 'Bio/Pharma', BNTX: 'Bio/Pharma', PFE: 'Bio/Pharma', JNJ: 'Bio/Pharma',
  ABBV: 'Bio/Pharma', LLY: 'Bio/Pharma', GILD: 'Bio/Pharma', AMGN: 'Bio/Pharma',
  REGN: 'Bio/Pharma', BIIB: 'Bio/Pharma', VRTX: 'Bio/Pharma', BMY: 'Bio/Pharma',
  XOM: 'Energy', CVX: 'Energy', OXY: 'Energy', COP: 'Energy', SLB: 'Energy',
  HAL: 'Energy', PSX: 'Energy', MPC: 'Energy', VLO: 'Energy', DVN: 'Energy',
  JPM: 'Finance', BAC: 'Finance', GS: 'Finance', MS: 'Finance', WFC: 'Finance',
  C: 'Finance', V: 'Finance', MA: 'Finance', AXP: 'Finance', PYPL: 'Finance',
  HOOD: 'Finance', SQ: 'Finance', SOFI: 'Finance', AFRM: 'Finance',
  WMT: 'Retail', TGT: 'Retail', COST: 'Retail', GME: 'Retail', AMC: 'Retail',
  DKNG: 'Retail', DIS: 'Retail', DASH: 'Retail', ABNB: 'Retail',
  TLRY: 'Cannabis', CRON: 'Cannabis', ACB: 'Cannabis', CGC: 'Cannabis',
};

function classifySector(ticker, name) {
  if (KNOWN_TICKER_SECTORS[ticker]) return KNOWN_TICKER_SECTORS[ticker];
  const n = (name || ticker).toLowerCase();
  if (/cannabis|marijuana|\bhemp\b|\bweed\b|\bcbd\b|dispensar|\bthc\b/.test(n)) return 'Cannabis';
  if (/artificial intel|machine learn|neural net|deep learn|generative ai|large language/.test(n)) return 'AI';
  if (/electric vehicle|ev motor|\bautomotive\b|\bautomobile\b|vehicle manuf/.test(n)) return 'EV/Auto';
  if (/\bbio|biolog|biopharma|biotech|\bpharma\b|pharmaceut|therapeut|oncolog|genomic|gene therap|bioscien|life science|antibod|\bvaccine\b/.test(n)) return 'Bio/Pharma';
  if (/\bmining\b|\bminerals\b|\blithium\b|gold mine|silver mine|copper mine|precious metal|mineral explor/.test(n)) return 'Mining';
  if (/\benergy\b|petroleum|\bpipeline\b|\brefiner|\bdrilling\b|\blng\b|natural gas co|fossil fuel/.test(n)) return 'Energy';
  if (/\bbank\b|\bbanking\b|financial serv|investment bank|\binsurance\b|\bsecurities\b|asset manag|wealth manag|\bmortgage\b|\blending\b/.test(n)) return 'Finance';
  if (/\bretail\b|\brestaurant\b|\bhotel\b|\bairline\b|\bhospitality\b|\bapparel\b|\bgrocery\b|\bsupermarket\b/.test(n)) return 'Retail';
  if (/technolog|software|\bsemiconductor\b|\bcomputing\b|cybersec|\bsaas\b|\bsilicon\b|\bnetwork\b|\bplatform\b/.test(n)) return 'Tech';
  return null;
}

function filterBySectors(stocks, selectedSectors) {
  if (selectedSectors.includes('All')) return stocks;
  return stocks.filter(s => selectedSectors.includes(classifySector(s.ticker, s.name)));
}

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtPrice(val) {
  const n = Number(val);
  return n > 0 && n < 1 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;
}
function fmtChangeDollar(val) { const n = Number(val); return `${n >= 0 ? '+' : ''}${n.toFixed(2)}`; }
function fmtChangePct(val) { const n = Number(val); return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`; }
function fmtVol(val) {
  const n = Number(val);
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return String(n);
}

function truncateName(name, ticker) {
  if (!name) return ticker;
  const words = name.split(/\s+/);
  const stop = new Set([
    'Inc.', 'Inc', 'Ltd.', 'Ltd', 'Corp.', 'Corp', 'Corporation',
    'Holdings', 'Group', 'Co.', 'Co', 'PLC', 'LLC', 'N.V.', 'S.A.',
    'Ordinary', 'Shares', 'Class', 'Common', 'American', 'Depositary',
  ]);
  const out = [];
  for (const w of words) {
    if (stop.has(w) && out.length > 0) break;
    out.push(w);
    if (out.length >= 3) break;
  }
  return out.join(' ') || ticker;
}

// ── US market holidays & early-close dates (NYSE observed) ────────────────────
const NYSE_HOLIDAYS = new Set([
  '2026-01-01','2026-01-19','2026-02-16','2026-04-03','2026-05-25',
  '2026-07-03','2026-09-07','2026-11-26','2026-12-25',
  '2027-01-01','2027-01-18','2027-02-15','2027-03-26','2027-05-31',
  '2027-07-05','2027-09-06','2027-11-25','2027-12-24',
]);
const NYSE_EARLY_CLOSE = new Set([
  '2026-11-27','2026-12-24',
  '2027-11-26','2027-12-24',
]);

function etDateStr(etDate) {
  const y = etDate.getFullYear();
  const m = String(etDate.getMonth() + 1).padStart(2, '0');
  const d = String(etDate.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function nextTradingDay(etDate) {
  const d = new Date(etDate);
  d.setDate(d.getDate() + 1);
  while (true) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6 && !NYSE_HOLIDAYS.has(etDateStr(d))) break;
    d.setDate(d.getDate() + 1);
  }
  return d;
}

function getMarketStatus() {
  const now = new Date();

  // ET clock via Intl
  const etParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now);
  const p = {};
  etParts.forEach(({ type, value }) => { p[type] = value; });
  const etDate = new Date(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00`);
  const hour   = Number(p.hour);
  const minute = Number(p.minute);
  const dow    = etDate.getDay(); // 0=Sun 6=Sat
  const dateStr = etDateStr(etDate);
  const timeDecimal = hour + minute / 60;

  const isWeekend  = dow === 0 || dow === 6;
  const isHoliday  = NYSE_HOLIDAYS.has(dateStr);
  const isEarlyClose = NYSE_EARLY_CLOSE.has(dateStr);
  const closeTime  = isEarlyClose ? 13.0 : 16.0;

  // Formatted ET time string for display
  const time = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(now);
  const zone = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', timeZoneName: 'short',
  }).formatToParts(now).find(q => q.type === 'timeZoneName')?.value ?? 'ET';

  // Closed (weekend or holiday)
  if (isWeekend || isHoliday) {
    const next = nextTradingDay(etDate);
    const nextName = next.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/New_York' });
    let label;
    if (dow === 6) label = 'Market Closed · Opens Monday';
    else if (dow === 0) label = 'Market Closed · Opens Tomorrow';
    else label = `Market Holiday · Opens ${nextName}`;
    return { time, zone, statusLabel: label, dotColor: '#9aa0aa',
             isOpen: false, isPreMarket: false, isAfterHours: false, session: 'closed' };
  }

  // Weekday sessions
  if (timeDecimal >= 4.0 && timeDecimal < 9.5) {
    return { time, zone, statusLabel: 'Pre-Market', dotColor: '#f5a623',
             isOpen: false, isPreMarket: true, isAfterHours: false, session: 'premarket' };
  }
  if (timeDecimal >= 9.5 && timeDecimal < closeTime) {
    const label = isEarlyClose ? 'Market Open · Early Close 1PM' : 'Market Open';
    return { time, zone, statusLabel: label, dotColor: '#00c853',
             isOpen: true, isPreMarket: false, isAfterHours: false, session: 'open' };
  }
  if (timeDecimal >= closeTime && timeDecimal < 20.0) {
    return { time, zone, statusLabel: 'After Hours', dotColor: '#f5a623',
             isOpen: false, isPreMarket: false, isAfterHours: true, session: 'afterhours' };
  }
  // After 8 PM ET — closed until tomorrow
  return { time, zone, statusLabel: 'Market Closed · Opens Tomorrow', dotColor: '#9aa0aa',
           isOpen: false, isPreMarket: false, isAfterHours: false, session: 'closed' };
}

// Backwards-compat alias so all call sites work unchanged
const getETTime = getMarketStatus;

// ── IndexStrip ─────────────────────────────────────────────────────────────────

function IndexStrip({ indices }) {
  if (!indices || indices.length === 0) return null;
  return (
    <View style={styles.indexStrip}>
      {indices.map((idx, i) => {
        const isPos = Number(idx.changePercent) >= 0;
        return (
          <View key={idx.ticker} style={[styles.indexItem, i < indices.length - 1 && styles.indexItemBorder]}>
            <Text style={styles.indexLabel}>{idx.label || idx.ticker}</Text>
            <Text style={styles.indexPrice}>{idx.rawValue ?? fmtPrice(idx.price)}</Text>
            <Text style={[styles.indexChange, { color: isPos ? '#22c55e' : '#ef4444' }]}>
              {idx.rawChange ?? fmtChangePct(idx.changePercent)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

// ── Brief helpers & constants ──────────────────────────────────────────────────

function getTimePhase() {
  const { session } = getMarketStatus();
  if (session !== 'open') return session; // 'premarket' | 'afterhours' | 'closed'
  // Granular sub-phases during open session (used by AI brief prompt)
  const etStr = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date());
  const [h, m] = etStr.split(':').map(Number);
  const mins = h * 60 + m;
  if (mins < 630) return 'open';        // 9:30–10:30 AM
  if (mins < 840) return 'midday';      // 10:30 AM–2:00 PM
  return 'powerhour';                   // 2:00 PM–close
}

function computeMarketTone(indices) {
  if (!indices || indices.length === 0) return 'mixed';
  const spyPct = Number(indices.find(i => i.ticker === 'SPY')?.changePercent ?? 0);
  const qqqPct = Number(indices.find(i => i.ticker === 'QQQ')?.changePercent ?? 0);
  const avg = (spyPct + qqqPct) / 2;
  if (avg > 0.3) return 'risk-on';
  if (avg < -0.3) return 'risk-off';
  return 'mixed';
}

function getVixMeta(value) {
  const v = Number(value);
  if (isNaN(v)) return null;
  if (v < 15) return { label: 'Low Vol',  color: '#16a34a', bg: '#f0fdf4' };
  if (v < 20) return { label: 'Normal',   color: '#64748b', bg: '#f8fafc' };
  if (v < 30) return { label: 'Caution',  color: '#d97706', bg: '#fffbeb' };
  return      { label: 'Fear',    color: '#dc2626', bg: '#fff1f2' };
}

const TONE_BORDER = { 'risk-on': '#22c55e', 'risk-off': '#ef4444', mixed: '#f5a623' };
const TONE_LABEL  = { 'risk-on': 'Risk-On 🟢', 'risk-off': 'Risk-Off 🔴', mixed: 'Mixed ⚪' };
const TONE_BG     = { 'risk-on': '#f0fdf4', 'risk-off': '#fff1f2', mixed: '#fffbeb' };
const TONE_FG     = { 'risk-on': '#166534', 'risk-off': '#9f1239', mixed: '#92400e' };
const PHASE_LABEL = {
  premarket:  '🌅 PRE-MARKET',
  open:       '🔔 MARKET OPEN',
  midday:     '☀️ MID-DAY',
  powerhour:  '⚡ POWER HOUR',
  afterhours: '🌙 AFTER HOURS',
  overnight:  '🌙 OVERNIGHT',
  closed:     '🔒 MARKET CLOSED',
};

// ── BriefCard ──────────────────────────────────────────────────────────────────

function BriefCard({ briefLoading, aiBrief, briefSectors, briefIndices, briefVix, et, lastUpdated }) {
  const [expanded, setExpanded] = useState(false);
  const dataFadeAnim  = useRef(new Animated.Value(1)).current;
  const timePulseAnim = useRef(new Animated.Value(0)).current;

  const toggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded(p => !p);
  };

  useEffect(() => {
    if (!lastUpdated) return;
    // Fade data section down then back up (0.3s total)
    Animated.sequence([
      Animated.timing(dataFadeAnim, { toValue: 0.55, duration: 120, useNativeDriver: true }),
      Animated.timing(dataFadeAnim, { toValue: 1,    duration: 300, useNativeDriver: true }),
    ]).start();
    // Pulse timestamp color gold → grey
    timePulseAnim.setValue(1);
    Animated.timing(timePulseAnim, { toValue: 0, duration: 1200, useNativeDriver: false }).start();
  }, [lastUpdated]); // eslint-disable-line react-hooks/exhaustive-deps

  const timeLabelColor = timePulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['#94a3b8', '#f5a623'],
  });

  const tone      = computeMarketTone(briefIndices);
  const timePhase = getTimePhase();

  const spy = briefIndices.find(i => i.ticker === 'SPY');
  const qqq = briefIndices.find(i => i.ticker === 'QQQ');
  const dia = briefIndices.find(i => i.ticker === 'DIA');
  const iwm = briefIndices.find(i => i.ticker === 'IWM');

  const vixMeta = briefVix?.value != null ? getVixMeta(briefVix.value) : null;
  const vixVal  = briefVix?.value != null ? Number(briefVix.value).toFixed(1) : null;
  const vixChg  = briefVix ? Number(briefVix.todaysChangePerc ?? 0) : 0;

  // Fix 2 & 3: price + % on same line; display label overrides ticker
  const renderIdxCell = (stock, label) => {
    if (!stock) return <View style={bcStyles.idxCell}><Text style={bcStyles.idxTicker}>–</Text></View>;
    const isPos = Number(stock.changePercent) >= 0;
    const pctColor = isPos ? '#16a34a' : '#dc2626';
    const pctStr = `${isPos ? '+' : ''}${Number(stock.changePercent).toFixed(2)}%`;
    return (
      <View style={bcStyles.idxCell}>
        <Text style={bcStyles.idxTicker}>{label || stock.ticker}</Text>
        <View style={bcStyles.idxPriceRow}>
          <Text style={bcStyles.idxPrice}>${Number(stock.price).toFixed(2)}</Text>
          <Text style={[bcStyles.idxPct, { color: pctColor }]}>{pctStr}</Text>
        </View>
      </View>
    );
  };

  return (
    <TouchableOpacity
      style={[styles.briefCard, { borderLeftColor: TONE_BORDER[tone] }]}
      onPress={toggle}
      activeOpacity={0.88}
      disabled={briefLoading && !aiBrief}
    >
      {/* Header — static, never animated */}
      <View style={bcStyles.headerRow}>
        <View style={bcStyles.headerLeft}>
          <View style={[bcStyles.dot, { backgroundColor: et.dotColor }]} />
          <Text style={bcStyles.title}>Market Brief</Text>
        </View>
        <View style={bcStyles.headerRight}>
          <View style={[bcStyles.toneBadge, { backgroundColor: TONE_BG[tone] }]}>
            <Text style={[bcStyles.toneText, { color: TONE_FG[tone] }]}>{TONE_LABEL[tone]}</Text>
          </View>
          {!briefLoading && <Text style={bcStyles.chevron}>{expanded ? ' ▲' : ' ▼'}</Text>}
        </View>
      </View>

      {/* Phase + time — phase label static, timestamp pulses on refresh */}
      <View style={bcStyles.subRow}>
        <Text style={bcStyles.phaseLabel}>{PHASE_LABEL[timePhase] || 'MARKET'}</Text>
        <Animated.Text style={[bcStyles.timeLabel, { color: timeLabelColor }]}>
          {et.time} {et.zone} · {et.statusLabel}
        </Animated.Text>
      </View>

      {/* Data section — fades on refresh */}
      <Animated.View style={{ opacity: dataFadeAnim }}>
        {/* VIX */}
        {vixVal && vixMeta && (
          <View style={[bcStyles.vixRow, { backgroundColor: vixMeta.bg }]}>
            <Text style={bcStyles.vixLabel}>VIX</Text>
            <Text style={[bcStyles.vixValue, { color: vixMeta.color }]}>{vixVal}</Text>
            <Text style={[bcStyles.vixInterpret, { color: vixMeta.color }]}>· {vixMeta.label}</Text>
            <Text style={[bcStyles.vixChg, { color: vixChg >= 0 ? '#dc2626' : '#16a34a' }]}>
              {vixChg >= 0 ? '+' : ''}{vixChg.toFixed(1)}%
            </Text>
          </View>
        )}

        {/* Loading state (initial only) */}
        {briefLoading && !aiBrief ? (
          <View style={bcStyles.loadingRow}>
            <Text style={bcStyles.loadingText}>Generating market brief...</Text>
          </View>
        ) : (
          <>
            {/* Section label: Major Indices */}
            <Text style={bcStyles.sectionLabel}>MAJOR INDICES</Text>

            {/* 4-index single row */}
            <View style={bcStyles.idxGrid}>
              <View style={bcStyles.idxRow}>
                {renderIdxCell(spy, 'SPY')}
                <View style={bcStyles.idxVDivider} />
                {renderIdxCell(qqq, 'QQQ')}
                <View style={bcStyles.idxVDivider} />
                {renderIdxCell(dia, 'DOW')}
                <View style={bcStyles.idxVDivider} />
                {renderIdxCell(iwm, 'Russell')}
              </View>
            </View>

            {/* AI insight */}
            {aiBrief ? (
              <>
                <Text style={bcStyles.sectionLabel}>🧠 AI MARKET INSIGHT</Text>
                <Text style={bcStyles.insight} numberOfLines={expanded ? undefined : 2}>{aiBrief}</Text>
                {!expanded && aiBrief.length > 100 && (
                  <Text style={bcStyles.readMore}>Read more...</Text>
                )}
              </>
            ) : null}

            {/* Sector pills — expanded only */}
            {expanded && briefSectors.length > 0 && (
              <View style={bcStyles.sectorRow}>
                {briefSectors.map(s => {
                  const isPos = Number(s.changePercent) >= 0;
                  return (
                    <View
                      key={s.ticker || s.label}
                      style={[bcStyles.sectorPill, { backgroundColor: isPos ? '#f0fdf4' : '#fff1f2' }]}
                    >
                      <Text style={[bcStyles.sectorPillTxt, { color: isPos ? '#166534' : '#9f1239' }]}>
                        {s.label} {isPos ? '+' : ''}{Number(s.changePercent).toFixed(1)}%
                      </Text>
                    </View>
                  );
                })}
              </View>
            )}
          </>
        )}
      </Animated.View>
    </TouchableOpacity>
  );
}

// ── RunnerBar ─────────────────────────────────────────────────────────────────

function isUntradeable(s) {
  const ticker = (s.ticker || '').toUpperCase();
  const price  = Number(s.price)         || 0;
  const vol    = Number(s.volume)        || 0;
  const pct    = Number(s.changePercent) || 0;
  if (price > 0 && price < 0.01)         return true; // below $0.01 minimum
  if (vol < 50_000)                      return true; // too illiquid
  if (ticker.length > 5)                 return true; // warrants/rights/special
  if (ticker.length >= 5 && ticker.endsWith('W')) return true; // warrants (e.g. ACACW)
  if (ticker.length >= 5 && ticker.endsWith('R')) return true; // rights (e.g. GLTAR)
  if (ticker.length === 5 && ticker.endsWith('F')) return true; // foreign OTC (e.g. SWYDF)
  if (ticker.length === 5 && ticker.endsWith('Y')) return true; // foreign ADR OTC (e.g. BYDDY)
  if (price < 0.05 && vol < 200_000)    return true; // OTC illiquid
  if (pct > 500)                         return true; // bad data
  return false;
}

function detectRunners(stocks) {
  return stocks
    .filter(s => {
      if (isUntradeable(s)) return false;
      return Number(s.changePercent) >= 20 && Number(s.volume) > 500_000;
    })
    .sort((a, b) => Number(b.changePercent) - Number(a.changePercent))
    .slice(0, 15);
}

function RunnerBar({ stocks, onPress }) {
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const [runners, setRunners] = useState([]);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.2, duration: 700, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1.0, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []); // pulseAnim is a stable ref

  useEffect(() => {
    if (!stocks.length) return;
    setRunners(detectRunners(stocks));
  }, [stocks]);

  if (!runners.length) return null;

  return (
    <View style={rnStyles.wrapper}>
      <Text style={rnStyles.sectionLabel}>TODAY'S TOP MOVERS</Text>
      <View style={rnStyles.titleRow}>
        <Text style={rnStyles.title}>🔥 Runners</Text>
        <Animated.View style={[rnStyles.liveBadge, { opacity: pulseAnim }]}>
          <Text style={rnStyles.liveText}>LIVE</Text>
        </Animated.View>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={rnStyles.scrollContent}
      >
        {runners.map(s => {
          const pct     = Number(s.changePercent);
          const vol     = Number(s.volume);
          const prevVol = Number(s.previousVolume) || 0;
          const rvol    = prevVol > 0 ? vol / prevVol : 0;
          const risk    = calcRisk(s);
          return (
            <TouchableOpacity
              key={s.ticker}
              style={rnStyles.card}
              onPress={() => onPress(s.ticker)}
              activeOpacity={0.7}
            >
              <View style={rnStyles.cardHeader}>
                <Text style={rnStyles.ticker}>{s.ticker}</Text>
                {rvol >= 5 && <Text style={rnStyles.fireEmoji}>🔥</Text>}
              </View>
              <Text style={rnStyles.price}>${Number(s.price).toFixed(2)}</Text>
              <Text style={rnStyles.pct}>▲ +{pct.toFixed(2)}%</Text>
              <Text style={rnStyles.vol}>{fmtVol(vol)}</Text>
              {risk.level === 'high' && (
                <Text style={rnStyles.riskBadge}>● High Risk</Text>
              )}
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const rnStyles = StyleSheet.create({
  wrapper: {
    paddingTop: 8,
    paddingBottom: 4,
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#94a3b8',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    paddingHorizontal: 24,
    marginBottom: 6,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    marginBottom: 8,
    gap: 8,
  },
  title: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0a1628',
    letterSpacing: 0.3,
  },
  liveBadge: {
    backgroundColor: '#ef4444',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  liveText: {
    color: '#ffffff',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingBottom: 6,
    gap: 8,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    width: 110,
    height: 110,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  ticker: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0a1628',
  },
  fireEmoji: { fontSize: 12 },
  riskBadge: { fontSize: 8, fontWeight: '400', color: '#ff6b6b', marginTop: 3 },
  price: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0a1628',
    marginBottom: 1,
  },
  pct: {
    fontSize: 12,
    fontWeight: '700',
    color: '#16a34a',
    marginBottom: 2,
  },
  vol: {
    fontSize: 10,
    color: '#64748b',
  },
});

// ── HeatingUpBar ──────────────────────────────────────────────────────────────

function detectHeatingUp(stocks) {
  // Runners are already defined as pct >= 20 && vol > 500K — exclude them here
  return stocks
    .filter(s => {
      if (isUntradeable(s)) return false;
      const pct     = Number(s.changePercent);
      const vol     = Number(s.volume);
      const prevVol = Number(s.previousVolume) || 0;
      const rvol    = prevVol > 0 ? vol / prevVol : 0;
      // 5%–19.99% change, at least 1.5× average volume, not already a Runner
      return pct >= 5 && pct < 20 && rvol >= 1.5;
    })
    .sort((a, b) => {
      const prevVolA = Number(a.previousVolume) || 0;
      const prevVolB = Number(b.previousVolume) || 0;
      const rvolA = prevVolA > 0 ? Number(a.volume) / prevVolA : 0;
      const rvolB = prevVolB > 0 ? Number(b.volume) / prevVolB : 0;
      return rvolB - rvolA; // highest relative volume first
    })
    .slice(0, 8);
}

function HeatingUpBar({ stocks, onPress }) {
  const [heaters, setHeaters] = useState([]);

  useEffect(() => {
    if (!stocks.length) return;
    setHeaters(detectHeatingUp(stocks));
  }, [stocks]);

  if (!heaters.length) return null;

  return (
    <View style={huStyles.wrapper}>
      <Text style={huStyles.sectionLabel}>VOLUME BUILDING</Text>
      <View style={huStyles.titleRow}>
        <Text style={huStyles.title}>🌡️ Heating Up</Text>
        <Text style={huStyles.subtitle}>Building momentum</Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={huStyles.scrollContent}
      >
        {heaters.map(s => {
          const pct     = Number(s.changePercent);
          const vol     = Number(s.volume);
          const prevVol = Number(s.previousVolume) || 0;
          const rvol    = prevVol > 0 ? vol / prevVol : 0;
          const risk    = calcRisk(s);
          return (
            <TouchableOpacity
              key={s.ticker}
              style={huStyles.card}
              onPress={() => onPress(s.ticker)}
              activeOpacity={0.7}
            >
              <View style={huStyles.cardHeader}>
                <Text style={huStyles.ticker}>{s.ticker}</Text>
                <Text style={huStyles.trendIcon}>📈</Text>
              </View>
              <Text style={huStyles.price}>${Number(s.price).toFixed(2)}</Text>
              <Text style={huStyles.pct}>▲ +{pct.toFixed(2)}%</Text>
              <Text style={huStyles.rvol}>{rvol.toFixed(1)}x vol</Text>
              {risk.level === 'high' && (
                <Text style={huStyles.riskBadge}>● High Risk</Text>
              )}
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const huStyles = StyleSheet.create({
  wrapper: {
    paddingTop: 24,
    paddingBottom: 4,
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#94a3b8',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    paddingHorizontal: 24,
    marginBottom: 6,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    paddingHorizontal: 24,
    marginBottom: 8,
    gap: 8,
  },
  title: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0a1628',
    letterSpacing: 0.3,
  },
  subtitle: {
    fontSize: 11,
    color: '#94a3b8',
    fontWeight: '500',
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingBottom: 6,
    gap: 8,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    width: 110,
    height: 110,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  ticker: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0a1628',
  },
  trendIcon: { fontSize: 11 },
  riskBadge: { fontSize: 8, fontWeight: '400', color: '#ff6b6b', marginTop: 3 },
  price: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0a1628',
    marginBottom: 1,
  },
  pct: {
    fontSize: 12,
    fontWeight: '700',
    color: '#16a34a',
    marginBottom: 2,
  },
  rvol: {
    fontSize: 10,
    color: '#d97706',
    fontWeight: '600',
  },
});

// ── Sort helper ───────────────────────────────────────────────────────────────

function sortData(data, col, dir) {
  const m = dir === 'asc' ? 1 : -1;
  return [...data].sort((a, b) => {
    switch (col) {
      case 'symbol':   return m * a.ticker.localeCompare(b.ticker);
      case 'name':     return m * (a.name || a.ticker).localeCompare(b.name || b.ticker);
      case 'price':    return m * (Number(a.price) - Number(b.price));
      case 'change':   return m * (Number(a.todaysChange) - Number(b.todaysChange));
      case 'pct':      return m * (Number(a.changePercent) - Number(b.changePercent));
      case 'vol':      return m * (Number(a.volume) - Number(b.volume));
      case 'trending': {
        const scoreA = Number(a.changePercent) * Math.log10(Math.max(Number(a.volume), 1));
        const scoreB = Number(b.changePercent) * Math.log10(Math.max(Number(b.volume), 1));
        return m * (scoreA - scoreB);
      }
      default: return 0;
    }
  });
}

// ── SkeletonRow ───────────────────────────────────────────────────────────────

function SkeletonRow({ anim }) {
  return (
    <Animated.View style={[styles.skeletonRow, { opacity: anim }]}>
      <View style={[styles.skeletonCell, { width: 44 }]} />
      <View style={[styles.skeletonCell, { flex: 1, marginHorizontal: 8 }]} />
      <View style={[styles.skeletonCell, { width: 56, marginLeft: 4 }]} />
      <View style={[styles.skeletonCell, { width: 50, marginLeft: 4 }]} />
      <View style={[styles.skeletonCell, { width: 62, marginLeft: 4 }]} />
      <View style={[styles.skeletonCell, { width: 44, marginLeft: 4 }]} />
    </Animated.View>
  );
}

// ── LeftSidebar ────────────────────────────────────────────────────────────────

function LeftSidebar({ selected, onSelect }) {
  return (
    <View style={sbStyles.sidebarOuter}>
      <View style={sbStyles.sidebar}>
        {SIDEBAR_CATEGORIES.map(({ key, label }) => {
          const active = selected === key;
          return (
            <TouchableOpacity
              key={key}
              style={[sbStyles.item, active && sbStyles.itemActive]}
              onPress={() => onSelect(key)}
              activeOpacity={0.7}
            >
              {active && <View style={sbStyles.activeBar} />}
              <Text style={[sbStyles.itemText, active && sbStyles.itemTextActive]} numberOfLines={1}>
                {label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

// ── Sparkline ─────────────────────────────────────────────────────────────────
// Draws a mini line chart from OHLCV snapshot data using rotated Views (no SVG dep).

function Sparkline({ item, width, height }) {
  const open  = Number(item.open)          || 0;
  const high  = Number(item.dayHigh)       || 0;
  const low   = Number(item.dayLow)        || 0;
  const vwap  = Number(item.vwap)          || 0;
  const price = Number(item.price)         || 0;
  const prev  = Number(item.previousClose) || open;

  if (!open || !price) return <View style={{ width, height }} />;

  const isUp = price >= prev;
  const lineColor = isUp ? '#00a651' : '#e0281a';

  const mid = isUp
    ? open + (high - open) * 0.45
    : open - (open - low)  * 0.45;

  const pts = [prev, open, mid, vwap || mid, price];
  const minV = Math.min(...pts);
  const maxV = Math.max(...pts);
  const range = maxV - minV || Math.abs(price) * 0.01 || 1;

  const PAD = 3;
  const innerH = height - PAD * 2;
  const toX = (i) => (i / (pts.length - 1)) * width;
  const toY = (v)  => PAD + innerH - ((v - minV) / range) * innerH;

  const segs = pts.slice(0, -1).map((v, i) => {
    const x1 = toX(i),     y1 = toY(v);
    const x2 = toX(i + 1), y2 = toY(pts[i + 1]);
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1) return null;
    return {
      len,
      angle: Math.atan2(dy, dx) * 180 / Math.PI,
      mx: (x1 + x2) / 2,
      my: (y1 + y2) / 2,
    };
  }).filter(Boolean);

  return (
    <View style={{ width, height, overflow: 'hidden' }}>
      {segs.map((s, i) => (
        <View
          key={i}
          style={{
            position: 'absolute',
            width: s.len,
            height: 1.5,
            backgroundColor: lineColor,
            left:  s.mx - s.len / 2,
            top:   s.my - 0.75,
            transform: [{ rotate: `${s.angle}deg` }],
          }}
        />
      ))}
    </View>
  );
}

// ── Table components ───────────────────────────────────────────────────────────

function TableHeader({ sortCol, sortDir, onSort }) {
  const Th = ({ colKey, label, style, align = 'left' }) => {
    const active = sortCol === colKey;
    const isRight = align === 'right';
    return (
      <TouchableOpacity
        style={[style, { flexDirection: 'row', alignItems: 'center',
                         justifyContent: isRight ? 'flex-end' : 'flex-start' }]}
        onPress={() => onSort(colKey)}
        activeOpacity={0.6}
      >
        <Text style={[styles.th, active && styles.thActive]}>{label}</Text>
        {active && <Text style={styles.thSortArrow}>{sortDir === 'asc' ? '▲' : '▼'}</Text>}
      </TouchableOpacity>
    );
  };
  return (
    <View style={styles.tableHeader}>
      <Th colKey="symbol" label="SYMBOL" style={styles.cSymbol} />
      <Th colKey="name"   label="NAME"   style={styles.cName} />
      <View style={{ width: C.sparkline }} />
      <Th colKey="price"  label="PRICE"  style={styles.cPrice}  align="right" />
      <Th colKey="change" label="CHANGE" style={styles.cChange} align="right" />
      <Th colKey="pct"    label="CHG %"  style={styles.cPct}    align="right" />
      <Th colKey="vol"    label="VOLUME" style={styles.cVol}    align="right" />
    </View>
  );
}

function TableRow({ item, flash, onPress, index }) {
  const isPos = Number(item.changePercent) >= 0;
  const changeColor = isPos ? '#00a651' : '#e0281a';
  const rowBg = index % 2 === 0 ? '#ffffff' : '#fafafa';

  const flashAnim = useRef(new Animated.Value(0)).current;
  const [flashBg, setFlashBg] = useState('transparent');

  useEffect(() => {
    if (!flash) return;
    const color = flash.dir === 'up' ? 'rgba(0,166,81,0.1)' : 'rgba(224,40,26,0.1)';
    setFlashBg(color);
    flashAnim.setValue(1);
    Animated.timing(flashAnim, { toValue: 0, duration: 1500, useNativeDriver: true })
      .start(() => setFlashBg('transparent'));
  }, [flash?.v]); // eslint-disable-line react-hooks/exhaustive-deps

  const risk = calcRisk(item);

  return (
    <TouchableOpacity style={[styles.tableRow, { backgroundColor: rowBg }]} onPress={onPress} activeOpacity={0.6}>
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { opacity: flashAnim, backgroundColor: flashBg }]}
      />
      <View style={[styles.cSymbol, styles.tdSymbolCell]}>
        {risk.level === 'high' && <View style={[styles.riskDot, { backgroundColor: '#ef4444' }]} />}
        <Text style={styles.tdSymbol} numberOfLines={1}>{item.ticker}</Text>
      </View>
      <Text style={[styles.cName,   styles.tdName]}   numberOfLines={1}>{truncateName(item.name, item.ticker)}</Text>
      <Sparkline item={item} width={C.sparkline} height={22} />
      <Text style={[styles.cPrice,  styles.tdPrice]}  numberOfLines={1}>{fmtPrice(item.price)}</Text>
      <Text style={[styles.cChange, styles.tdChange, { color: changeColor }]} numberOfLines={1}>{fmtChangeDollar(item.todaysChange)}</Text>
      <Text style={[styles.cPct,    styles.tdPct,   { color: changeColor }]} numberOfLines={1}>{fmtChangePct(item.changePercent)}</Text>
      <Text style={[styles.cVol,    styles.tdVol]}    numberOfLines={1}>{fmtVol(item.volume)}</Text>
    </TouchableOpacity>
  );
}

// ── WatchlistPanel ─────────────────────────────────────────────────────────────

const WATCHLIST_KEY = 'watchlist_v1';
const WATCHLIST_MAX = 15;

function WatchlistSparkline({ item, width = 50, height = 20 }) {
  const open  = Number(item.open)          || 0;
  const high  = Number(item.dayHigh)       || 0;
  const low   = Number(item.dayLow)        || 0;
  const vwap  = Number(item.vwap)          || 0;
  const price = Number(item.price)         || 0;
  const prev  = Number(item.previousClose) || open;

  const isUp = price >= prev;
  const lineColor = isUp ? '#00a651' : '#e0281a';

  if (!open || !price || high <= low) {
    return (
      <View style={{ width, height, justifyContent: 'center' }}>
        <View style={{ height: 1.5, backgroundColor: lineColor, marginHorizontal: 2 }} />
      </View>
    );
  }

  const mid = isUp ? open + (high - open) * 0.45 : open - (open - low) * 0.45;
  const pts = [prev, open, mid, vwap || mid, price];
  const minV = Math.min(...pts);
  const maxV = Math.max(...pts);
  const range = maxV - minV || Math.abs(price) * 0.01 || 1;
  const PAD = 2;
  const innerH = height - PAD * 2;
  const toX = (i) => (i / (pts.length - 1)) * width;
  const toY = (v)  => PAD + innerH - ((v - minV) / range) * innerH;

  const segs = pts.slice(0, -1).map((v, i) => {
    const x1 = toX(i), y1 = toY(v);
    const x2 = toX(i + 1), y2 = toY(pts[i + 1]);
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1) return null;
    return { len, angle: Math.atan2(dy, dx) * 180 / Math.PI, mx: (x1 + x2) / 2, my: (y1 + y2) / 2 };
  }).filter(Boolean);

  return (
    <View style={{ width, height, overflow: 'hidden' }}>
      {segs.map((s, i) => (
        <View key={i} style={{
          position: 'absolute', width: s.len, height: 1.5,
          backgroundColor: lineColor,
          left: s.mx - s.len / 2, top: s.my - 0.75,
          transform: [{ rotate: `${s.angle}deg` }],
        }} />
      ))}
    </View>
  );
}

function WatchlistItem({ entry, quoteData, onOpen, onRemove }) {
  const [showDelete, setShowDelete] = useState(false);
  const [pressed, setPressed] = useState(false);
  const d = quoteData || {};
  const isPos = Number(d.changePercent) >= 0;
  const pctColor = isPos ? '#00a651' : '#e0281a';
  const pctStr = d.changePercent != null
    ? `${isPos ? '+' : ''}${Number(d.changePercent).toFixed(2)}%`
    : '—';
  const priceStr = d.price != null
    ? (Number(d.price) > 0 && Number(d.price) < 1
        ? `$${Number(d.price).toFixed(4)}`
        : `$${Number(d.price).toFixed(2)}`)
    : '—';

  return (
    <TouchableOpacity
      style={[wlStyles.item, pressed && wlStyles.itemPressed]}
      onPress={() => onOpen(entry.ticker)}
      onLongPress={() => setShowDelete(s => !s)}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      activeOpacity={1}
    >
      <View style={wlStyles.itemLeft}>
        <Text style={wlStyles.itemTicker}>{entry.ticker}</Text>
        <Text style={wlStyles.itemName} numberOfLines={1}>{entry.name || entry.ticker}</Text>
      </View>
      <WatchlistSparkline item={d} width={48} height={24} />
      <View style={wlStyles.itemRight}>
        <Text style={wlStyles.itemPrice}>{priceStr}</Text>
        <View style={[wlStyles.pctPill, { backgroundColor: isPos ? '#f0fdf4' : '#fff1f2' }]}>
          <Text style={[wlStyles.pctText, { color: pctColor }]}>{pctStr}</Text>
        </View>
      </View>
      {showDelete && (
        <TouchableOpacity
          style={wlStyles.deleteBtn}
          onPress={(e) => { e.stopPropagation?.(); onRemove(entry.ticker); }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={wlStyles.deleteBtnText}>×</Text>
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
}

function WatchlistPanel({ watchlist, quoteMap, input, onInputChange, onAdd, onRemove, onOpen, lastUpdated }) {
  const timeStr = lastUpdated
    ? lastUpdated.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
    : null;

  return (
    <View style={wlStyles.panel}>
      {/* Header */}
      <View style={wlStyles.header}>
        <Text style={wlStyles.headerTitle}>
          <Text style={{ color: '#f5a623' }}>⭐</Text>
          {' Watchlist'}
        </Text>
        <Text style={wlStyles.editBtn}>Edit</Text>
      </View>

      {/* Add input */}
      <View style={wlStyles.inputRow}>
        <TextInput
          style={wlStyles.input}
          placeholder="Add ticker..."
          placeholderTextColor="#aaaaaa"
          value={input}
          onChangeText={onInputChange}
          onSubmitEditing={onAdd}
          returnKeyType="done"
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={8}
        />
        <TouchableOpacity style={wlStyles.addBtn} onPress={onAdd} activeOpacity={0.7}>
          <Text style={wlStyles.addBtnText}>+</Text>
        </TouchableOpacity>
      </View>

      {/* Items or empty state */}
      <ScrollView style={wlStyles.list} showsVerticalScrollIndicator={false}>
        {watchlist.length === 0 ? (
          <View style={wlStyles.empty}>
            <Text style={wlStyles.emptyIcon}>⭐</Text>
            <Text style={wlStyles.emptyTitle}>Add stocks to track</Text>
            <Text style={wlStyles.emptyHint}>{'Type a ticker above\nto get started'}</Text>
          </View>
        ) : (
          watchlist.map(entry => (
            <WatchlistItem
              key={entry.ticker}
              entry={entry}
              quoteData={quoteMap[entry.ticker]}
              onOpen={onOpen}
              onRemove={onRemove}
            />
          ))
        )}
      </ScrollView>

      {/* Footer */}
      {timeStr && (
        <View style={wlStyles.footer}>
          <Text style={wlStyles.footerText}>Updated {timeStr} · 30s refresh</Text>
        </View>
      )}
    </View>
  );
}

// ── HomeScreen ─────────────────────────────────────────────────────────────────

export default function HomeScreen({ navigation }) {
  const [gainers, setGainers]         = useState([]);
  const [losers, setLosers]           = useState([]);
  const [indices, setIndices]         = useState([]);
  const [aiBrief, setAiBrief]         = useState('');
  const [briefLoading, setBriefLoading] = useState(false);
  const [briefSectors, setBriefSectors] = useState([]);
  const [loading, setLoading]         = useState(true);
  const [refreshing, setRefreshing]   = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [search, setSearch]           = useState('');
  const [activeTab, setActiveTab]     = useState('active');
  const [sortState, setSortState]     = useState(DEFAULT_SORT);
  const [visibleCounts, setVisibleCounts] = useState(INITIAL_VISIBLE);
  const [selectedSector, setSelectedSector] = useState('All');

  // Animated values — stable refs
  const pulseAnim    = useRef(new Animated.Value(1)).current;
  const skeletonAnim = useRef(new Animated.Value(0.4)).current;
  const liveDotAnim  = useRef(new Animated.Value(1)).current;

  const [briefIndices, setBriefIndices]       = useState([]);
  const [briefVix, setBriefVix]               = useState(null);
  const [briefLastUpdated, setBriefLastUpdated] = useState(null);

  const [flashMap, setFlashMap] = useState({});
  const prevPricesRef = useRef({});
  const flashVersionRef = useRef(0);
  const latestGainersRef = useRef([]);
  const latestLosersRef  = useRef([]);

  // ── Watchlist state ──────────────────────────────────────────────────────────
  const [watchlist, setWatchlist]               = useState([]); // [{ticker, name}]
  const [watchlistQuotes, setWatchlistQuotes]   = useState({});  // ticker → quote data
  const [watchlistInput, setWatchlistInput]     = useState('');
  const [watchlistUpdated, setWatchlistUpdated] = useState(null);
  const wlRefreshingRef = useRef(false);
  const momentumSeenRef = useRef(new Set());

  const { width: windowWidth } = useWindowDimensions();
  const showWatchlist = windowWidth >= 680;

  const et = getETTime();

  // Skeleton shimmer while initial load is in progress
  useEffect(() => {
    if (!loading) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(skeletonAnim, { toValue: 1,   duration: 900, useNativeDriver: true }),
        Animated.timing(skeletonAnim, { toValue: 0.4, duration: 900, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [loading]); // skeletonAnim is a stable ref value

  // Continuously pulse the LIVE dot so it feels truly live
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(liveDotAnim, { toValue: 0.25, duration: 900, useNativeDriver: true }),
        Animated.timing(liveDotAnim, { toValue: 1,    duration: 900, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []); // liveDotAnim is stable

  // Flash the LIVE text on each data update
  const triggerPulse = useCallback(() => {
    pulseAnim.setValue(0.15);
    Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }).start();
  }, []); // pulseAnim is stable

  const loadBrief = useCallback(async (freshGainers, freshLosers, isBackground = false) => {
    if (!isBackground) {
      setBriefLoading(true);
      setAiBrief('');
    }
    try {
      const [sectorData, idxRaw, vixRaw] = await Promise.all([
        fetchSectorSummary(),
        fetchBriefIndices(),
        fetchVIX(),
      ]);
      setBriefSectors(sectorData);
      setBriefIndices(idxRaw);
      setBriefVix(vixRaw);
      const timePhase = getTimePhase();
      const brief = await generateMarketBrief({
        indices: idxRaw,
        vix: vixRaw,
        gainers: freshGainers.slice(0, 5),
        losers:  freshLosers.slice(0, 5),
        sectorData,
        timePhase,
      });
      setAiBrief(brief);
      setBriefLastUpdated(new Date());
    } catch (e) {
      console.error('loadBrief error:', e);
    } finally {
      if (!isBackground) setBriefLoading(false);
    }
  }, []);

  // silent=true → no spinner, no brief reload (used by auto-refresh ticks)
  const loadData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [g, l, idx] = await Promise.all([
        fetchTopGainers(),
        fetchTopLosers(),
        fetchMarketIndices(),
      ]);
      if (!silent) {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      }
      // Compute market breadth (gainers vs losers ratio) to replace VIX slot
      const totalMovers = g.length + l.length;
      const breadthPct = totalMovers > 0 ? Math.round((g.length / totalMovers) * 100) : 50;
      const breadthSentiment = breadthPct > 60 ? 'Bullish' : breadthPct < 40 ? 'Bearish' : 'Mixed';
      const breadthEntry = {
        ticker: 'BREADTH',
        label: 'MKT',
        rawValue: `${breadthPct}%`,
        rawChange: breadthSentiment,
        changePercent: breadthPct - 50,
        price: breadthPct,
      };
      // Build flash map: compare new prices to stored previous prices
      const newFlashMap = {};
      if (Object.keys(prevPricesRef.current).length > 0) {
        flashVersionRef.current += 1;
        const v = flashVersionRef.current;
        [...g, ...l].forEach(s => {
          const prev = prevPricesRef.current[s.ticker];
          const curr = Number(s.price);
          if (prev !== undefined && Math.abs(curr - prev) > 0.001) {
            newFlashMap[s.ticker] = { dir: curr > prev ? 'up' : 'down', v };
          }
        });
      }
      [...g, ...l].forEach(s => { prevPricesRef.current[s.ticker] = Number(s.price); });
      setFlashMap(newFlashMap);

      latestGainersRef.current = g;
      latestLosersRef.current  = l;
      setGainers(g);
      setLosers(l);
      setIndices([...idx, breadthEntry]);
      setLastUpdated(new Date());
      triggerPulse();
      if (!silent) loadBrief(g, l);
    } catch (e) {
      console.error('HomeScreen loadData error:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [loadBrief, triggerPulse]);

  // Initial load
  useEffect(() => { loadData(false); }, [loadData]);

  // Auto-refresh: 60 s when market is open, 5 min otherwise.
  // Self-reschedules after each load so the interval adapts as market status changes.
  useEffect(() => {
    let timerId;
    const schedule = () => {
      const { isOpen } = getETTime();
      const delay = isOpen ? 60_000 : 300_000;
      timerId = setTimeout(async () => {
        await loadData(true);
        schedule();
      }, delay);
    };
    schedule();
    return () => clearTimeout(timerId);
  }, [loadData]);

  // 5-minute brief refresh — keeps AI insight and VIX current without full table reload
  useEffect(() => {
    const id = setInterval(() => {
      if (latestGainersRef.current.length > 0) {
        loadBrief(latestGainersRef.current, latestLosersRef.current, true);
      }
    }, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [loadBrief]);

  const onRefresh = () => {
    setRefreshing(true);
    loadData(false);
  };

  // ── Watchlist logic ──────────────────────────────────────────────────────────

  // Load persisted watchlist from storage on mount
  useEffect(() => {
    AsyncStorage.getItem(WATCHLIST_KEY).then(raw => {
      if (raw) {
        try { setWatchlist(JSON.parse(raw)); } catch {}
      }
    });
  }, []);

  const saveWatchlist = useCallback((entries) => {
    AsyncStorage.setItem(WATCHLIST_KEY, JSON.stringify(entries)).catch(() => {});
  }, []);

  const refreshWatchlistQuotes = useCallback(async (entries) => {
    if (!entries.length || wlRefreshingRef.current) return;
    wlRefreshingRef.current = true;
    try {
      const tickers = entries.map(e => e.ticker);
      const results = await Promise.all(tickers.map(t => fetchQuote(t).catch(() => null)));
      setWatchlistQuotes(prev => {
        const next = { ...prev };
        results.forEach((q, i) => { if (q) next[tickers[i]] = q; });
        return next;
      });
      setWatchlistUpdated(new Date());
    } finally {
      wlRefreshingRef.current = false;
    }
  }, []);

  // Initial + 30s auto-refresh for watchlist quotes
  useEffect(() => {
    if (!watchlist.length) return;
    refreshWatchlistQuotes(watchlist);
    const id = setInterval(() => refreshWatchlistQuotes(watchlist), 30_000);
    return () => clearInterval(id);
  }, [watchlist, refreshWatchlistQuotes]);

  const handleWatchlistAdd = useCallback(async () => {
    const ticker = watchlistInput.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!ticker) return;
    if (watchlist.some(e => e.ticker === ticker)) { setWatchlistInput(''); return; }
    if (watchlist.length >= WATCHLIST_MAX) return;
    setWatchlistInput('');
    // Optimistic add with ticker as placeholder name
    const optimistic = [...watchlist, { ticker, name: ticker }];
    setWatchlist(optimistic);
    saveWatchlist(optimistic);
    // Fetch real name + quote in parallel
    const [details, quote] = await Promise.all([
      fetchTickerDetails(ticker).catch(() => null),
      fetchQuote(ticker).catch(() => null),
    ]);
    const name = details?.name || ticker;
    const final = [...watchlist, { ticker, name }];
    setWatchlist(final);
    saveWatchlist(final);
    if (quote) setWatchlistQuotes(prev => ({ ...prev, [ticker]: quote }));
  }, [watchlist, watchlistInput, saveWatchlist]);

  const handleWatchlistRemove = useCallback((ticker) => {
    const updated = watchlist.filter(e => e.ticker !== ticker);
    setWatchlist(updated);
    saveWatchlist(updated);
    setWatchlistQuotes(prev => { const n = { ...prev }; delete n[ticker]; return n; });
  }, [watchlist, saveWatchlist]);

  const handleSearch = () => {
    const raw = search.trim();
    if (!raw) return;
    const ticker = extractTicker(raw);
    if (ticker) navigation.navigate('StockChat', { ticker, question: raw });
    else navigation.navigate('GeneralChat', { question: raw });
    setSearch('');
  };

  const goToStock = (ticker) => navigation.navigate('StockChat', { ticker });

  const goToMomentumStock = (ticker) => {
    const showAlert = !momentumSeenRef.current.has(ticker);
    if (showAlert) momentumSeenRef.current.add(ticker);
    navigation.navigate('StockChat', { ticker, ...(showAlert && { momentumAlert: true }) });
  };

  const handleTabPress = (key) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setActiveTab(key);
    setSortState(prev => ({ ...prev, [key]: DEFAULT_SORT[key] }));
    setVisibleCounts(prev => ({ ...prev, [key]: PAGE_SIZE }));
  };

  const handleLoadMore = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setVisibleCounts(prev => ({ ...prev, [activeTab]: Number.MAX_SAFE_INTEGER }));
  };

  const handleSort = (col) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setSortState(prev => {
      const cur = prev[activeTab];
      const dir = cur.col === col
        ? (cur.dir === 'desc' ? 'asc' : 'desc')
        : (col === 'symbol' || col === 'name' ? 'asc' : 'desc');
      return { ...prev, [activeTab]: { col, dir } };
    });
  };

  const handleSectorSelect = (key) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setSelectedSector(key);
    setVisibleCounts(INITIAL_VISIBLE);
  };

  // ── Derive tab lists from live Polygon data ──────────────────────────────────
  // Most Active: combined gainers + losers pool sorted by raw volume
  const seenTickers = new Set();
  const combinedPool = [...gainers, ...losers].filter(s => {
    if (seenTickers.has(s.ticker)) return false;
    seenTickers.add(s.ticker);
    return true;
  });
  const activeList = [...combinedPool].sort((a, b) => Number(b.volume) - Number(a.volume));

  // Trending Now: gainers scored by % gain × log(volume) — rewards both momentum and liquidity
  const trendingList = gainers
    .filter(s => Number(s.changePercent) > 0)
    .sort((a, b) => {
      const scoreA = Number(a.changePercent) * Math.log10(Math.max(Number(a.volume), 1));
      const scoreB = Number(b.changePercent) * Math.log10(Math.max(Number(b.volume), 1));
      return scoreB - scoreA;
    });

  const rawList =
    activeTab === 'active'   ? activeList :
    activeTab === 'trending' ? trendingList :
    activeTab === 'gainers'  ? gainers :
    losers;

  const filteredList = filterBySectors(rawList, [selectedSector]);
  const { col: sortCol, dir: sortDir } = sortState[activeTab];
  const listData = sortData(filteredList, sortCol, sortDir);
  const visibleCount = visibleCounts[activeTab];
  const visibleData = listData.slice(0, visibleCount);
  const hasMore = visibleCount < listData.length;

  const statusLabel      = et.statusLabel.toUpperCase();
  const statusBadgeColor = et.dotColor;

  const lastUpdatedStr = lastUpdated
    ? lastUpdated.toLocaleTimeString('en-US', {
        hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/New_York',
      })
    : null;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.goldTopBar} />
      <ScrollView
        stickyHeaderIndices={[2]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#f5a623" />}
      >

        {/* [0] Navbar — scrolls away with page */}
        <View style={styles.navbar}>
          <TouchableOpacity onPress={() => navigation.openDrawer()} style={styles.menuBtn} activeOpacity={0.7}>
            <Text style={styles.menuIcon}>☰</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.navigate('Landing')} activeOpacity={0.75} style={{ flexDirection: 'row', alignItems: 'center', marginLeft: 12 }}>
            <LogoIcon size={44} />
            <View style={[styles.brandBlock, { marginLeft: 10 }]}>
              <Text style={styles.appName}>ChatStox</Text>
              <Text style={[styles.statusDot, { color: statusBadgeColor }]}>● {statusLabel}</Text>
            </View>
          </TouchableOpacity>
          <View style={{ flex: 1 }} />
          <TouchableOpacity style={styles.homeBtn} onPress={() => navigation.navigate('Landing')} activeOpacity={0.8}>
            <Text style={styles.homeBtnText}>← Home</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.chatBtn} onPress={() => navigation.navigate('GeneralChat')}>
            <Text style={styles.chatBtnText}>Market Chat</Text>
          </TouchableOpacity>
        </View>

        {/* [1] Momentum section — gray background, contains Runners + Heating Up */}
        <View style={styles.momentumSection}>
          <RunnerBar stocks={gainers} onPress={goToMomentumStock} />
          <HeatingUpBar stocks={gainers} onPress={goToMomentumStock} />
        </View>

        {/* [2] Hero Search — WHITE, STICKY (stickyHeaderIndices={[2]}) */}
        <View style={styles.heroSection}>
          <View style={styles.goldDivider} />
          <Text style={styles.heroTitle}>
            <Text style={{ color: '#0a1628' }}>{"What's on your mind "}</Text>
            <Text style={{ color: '#f5a623' }}>today?</Text>
          </Text>
          <View style={styles.heroSearchWrap}>
            <TextInput
              style={styles.heroInput}
              placeholder="Ask about the market or search a ticker..."
              placeholderTextColor="#aaaaaa"
              value={search}
              onChangeText={setSearch}
              onSubmitEditing={handleSearch}
              returnKeyType="search"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity style={styles.heroGoBtn} onPress={handleSearch}>
              <Text style={styles.heroGoBtnText}>›</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Market Brief + Table — gray background */}
        <View style={styles.tableAreaSection}>
          {!loading && (
            <BriefCard
              briefLoading={briefLoading}
              aiBrief={aiBrief}
              briefSectors={briefSectors}
              briefIndices={briefIndices}
              briefVix={briefVix}

              et={et}
              lastUpdated={briefLastUpdated}
            />
          )}

        {/* Sidebar + Table — side by side, flat render */}
        <View style={styles.bodyRow}>

          {/* Left sidebar — category filter */}
          <LeftSidebar selected={selectedSector} onSelect={handleSectorSelect} />

          {/* Right — tabs + table (flat, no inner ScrollView) */}
          <View style={styles.tableSection}>
          <View style={styles.tableInner}>

            {/* Tabs */}
            <View style={styles.tabsRow}>
              {TABS.map(tab => (
                <TouchableOpacity
                  key={tab.key}
                  style={[styles.tab, activeTab === tab.key && styles.tabActive]}
                  onPress={() => handleTabPress(tab.key)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.tabText, activeTab === tab.key && styles.tabTextActive]}>
                    {tab.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Data Table */}
            <View style={styles.tableCard}>
              {loading ? (
                <>
                  <View style={styles.countStrip}>
                    <Text style={styles.countText}>Loading market data...</Text>
                    <View style={styles.liveBadge}>
                      <Animated.View style={[styles.liveDot, { opacity: liveDotAnim }]} />
                      <Text style={styles.countLive}>LIVE</Text>
                    </View>
                  </View>
                  {[...Array(10)].map((_, i) => (
                    <SkeletonRow key={i} anim={skeletonAnim} />
                  ))}
                </>
              ) : listData.length === 0 ? (
                <View style={styles.tableEmpty}>
                  <Text style={styles.tableEmptyText}>
                    {selectedSector === 'All'
                      ? 'No data available'
                      : `No ${selectedSector} stocks in current list`}
                  </Text>
                </View>
              ) : (
                <>
                  <View style={styles.countStrip}>
                    <View>
                      <Text style={styles.countText}>
                        <Text style={styles.countBold}>{visibleData.length}</Text> of{' '}
                        <Text style={styles.countBold}>{listData.length}</Text> stocks
                      </Text>
                      {lastUpdatedStr && (
                        <Text style={styles.countUpdated}>
                          Updated {lastUpdatedStr} ET · {et.statusLabel}
                        </Text>
                      )}
                    </View>
                    <View style={styles.liveBadge}>
                      <Animated.View style={[styles.liveDot, { opacity: liveDotAnim }]} />
                      <Text style={styles.countLive}>LIVE</Text>
                    </View>
                  </View>

                  <TableHeader sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />

                  {visibleData.map((item, i) => (
                    <TableRow key={item.ticker} item={item} index={i} flash={flashMap[item.ticker]} onPress={() => goToStock(item.ticker)} />
                  ))}

                  {hasMore && (
                    <TouchableOpacity style={styles.loadMoreBtn} onPress={handleLoadMore} activeOpacity={0.7}>
                      <Text style={styles.loadMoreText}>Ver más ({listData.length - visibleCount} restantes)</Text>
                      <Text style={styles.loadMoreArrow}>↓</Text>
                    </TouchableOpacity>
                  )}

                  {!hasMore && (
                    <View style={styles.tableFooter}>
                      <Text style={styles.tableFooterText}>All {listData.length} stocks shown</Text>
                    </View>
                  )}
                </>
              )}
            </View>

          </View>{/* tableInner */}
          </View>{/* tableSection */}

          {/* Right — Watchlist panel (hidden on narrow screens) */}
          {showWatchlist && (
            <WatchlistPanel
              watchlist={watchlist}
              quoteMap={watchlistQuotes}
              input={watchlistInput}
              onInputChange={setWatchlistInput}
              onAdd={handleWatchlistAdd}
              onRemove={handleWatchlistRemove}
              onOpen={goToStock}
              lastUpdated={watchlistUpdated}
            />
          )}
        </View>{/* bodyRow */}
        </View>{/* tableAreaSection */}

        <View style={{ height: 48 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const C = {
  symbol:    65,
  sparkline: 100,
  price:     90,
  change:    80,
  pct:       80,
  vol:       80,
};

const styles = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: '#f7f8fa' },

  // ── Alternating background sections ──
  momentumSection: {
    backgroundColor: '#f7f8fa',
    paddingTop: 16,
    paddingBottom: 16,
  },
  tableAreaSection: {
    backgroundColor: '#f7f8fa',
    paddingBottom: 8,
  },

  bodyRow: {
    flexDirection: 'row', alignItems: 'flex-start',
    maxWidth: 1100, alignSelf: 'center', width: '100%',
    paddingHorizontal: 24, paddingTop: 8, gap: 12,
  },
  tableSection: {
    flex: 1, marginBottom: 8,
    borderRadius: 12, backgroundColor: '#ffffff',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08, shadowRadius: 10, elevation: 3,
  },
  tableInner: { borderRadius: 12, overflow: 'hidden' },

  // ── Slim Navbar ──
  goldTopBar: { height: 2, backgroundColor: '#f5a623' },
  navbar: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#ffffff',
    paddingLeft: 16, paddingRight: 12, height: 52,
    borderBottomWidth: 1, borderBottomColor: '#e8e8e8',
  },
  menuBtn:        { padding: 4 },
  menuIcon:       { fontSize: 20, color: '#666666' },
  brandBlock:     { flexDirection: 'column', justifyContent: 'center' },
  appName:        { fontSize: 18, fontWeight: '900', color: '#0a1628', letterSpacing: 1, lineHeight: 20 },
  statusDot:      { fontSize: 9, fontWeight: '500', letterSpacing: 0.2, lineHeight: 12 },
  homeBtn: {
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 20, marginRight: 6,
    borderWidth: 1, borderColor: '#e2e8f0',
  },
  homeBtnText: { color: '#64748b', fontWeight: '600', fontSize: 12 },
  chatBtn: {
    backgroundColor: '#0a1628', paddingHorizontal: 14, paddingVertical: 7,
    borderRadius: 20,
  },
  chatBtnText: { color: '#ffffff', fontWeight: '700', fontSize: 12 },

  avatarBtn: { marginLeft: 8 },
  avatarCircle: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: '#1a3a5c',
    justifyContent: 'center', alignItems: 'center',
  },
  avatarInitials: { color: '#fff', fontSize: 13, fontWeight: '700' },
  avatarOutline: {
    width: 34, height: 34, borderRadius: 17,
    borderWidth: 1.5, borderColor: '#c0cdd8',
    justifyContent: 'center', alignItems: 'center',
  },
  avatarOutlineIcon: { fontSize: 16 },

  // ── Hero Search Section ──
  heroSection: {
    backgroundColor: '#ffffff',
    paddingHorizontal: 24, paddingTop: 20, paddingBottom: 20,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.07,
    shadowRadius: 8,
    elevation: 4,
    zIndex: 100,
  },
  goldDivider: {
    width: 60,
    height: 1,
    backgroundColor: '#f5a623',
    alignSelf: 'center',
    marginBottom: 16,
  },
  heroTitle: {
    fontSize: 22, fontWeight: '600',
    marginBottom: 14, textAlign: 'center',
  },
  heroSearchWrap: {
    flexDirection: 'row', alignItems: 'center',
    width: '100%', maxWidth: 600,
    backgroundColor: '#ffffff', borderRadius: 50,
    borderWidth: 1, borderColor: '#e0e0e0',
    paddingLeft: 16, paddingRight: 6, paddingVertical: 6,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1, shadowRadius: 20, elevation: 5,
  },
  heroInput: { flex: 1, fontSize: 14, color: '#1a1a2e', paddingVertical: 4 },
  heroGoBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#f5a623',
    justifyContent: 'center', alignItems: 'center',
  },
  heroGoBtnText: { fontSize: 24, color: '#ffffff', fontWeight: '700', lineHeight: 28 },
  quickChipsRow:     { marginTop: 16 },
  quickChipsContent: { paddingHorizontal: 0, gap: 8, flexDirection: 'row', alignItems: 'center' },
  quickChip: {
    paddingHorizontal: 14, paddingVertical: 6,
    borderRadius: 20, borderWidth: 1, borderColor: '#e0e0e0',
    backgroundColor: '#ffffff',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 4, elevation: 1,
    flexShrink: 0,
  },
  quickChipText: { fontSize: 12, color: '#0a1628', fontWeight: '500' },

  // ── Index strip ──
  indexStrip: {
    flexDirection: 'row', backgroundColor: '#0a1628',
    paddingVertical: 7, paddingHorizontal: 12, justifyContent: 'space-around',
  },
  indexItem: { flex: 1, alignItems: 'center' },
  indexItemBorder: { borderRightWidth: 1, borderRightColor: '#1e293b' },
  indexLabel: { fontSize: 10, color: '#64748b', fontWeight: '700', letterSpacing: 0.8 },
  indexPrice: { fontSize: 13, color: '#fff', fontWeight: '800', marginTop: 1 },
  indexChange: { fontSize: 11, fontWeight: '700', marginTop: 1 },

  // ── Brief card ──
  briefCard: {
    backgroundColor: '#fafbff', marginHorizontal: 24, marginTop: 24, marginBottom: 12,
    borderRadius: 12, padding: 14,
    borderLeftWidth: 3, borderLeftColor: '#f5a623',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1, shadowRadius: 14, elevation: 4,
    maxWidth: 900, alignSelf: 'center', width: '100%',
  },

  // ── Tabs — Yahoo Finance underline style ──
  tabsRow: {
    flexDirection: 'row',
    marginHorizontal: 0, marginTop: 0, marginBottom: 0,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1, borderBottomColor: '#e5e5e5',
  },
  tab: {
    flex: 1, paddingVertical: 7, alignItems: 'center',
    borderBottomWidth: 2, borderBottomColor: 'transparent',
    marginBottom: -1,
  },
  tabActive:     { borderBottomColor: '#0066cc' },
  tabText:       { fontSize: 11, fontWeight: '500', color: '#777777' },
  tabTextActive: { color: '#0066cc', fontWeight: '700' },

  // ── Table card ──
  tableCard: {
    backgroundColor: '#ffffff',
    borderTopWidth: 1, borderTopColor: '#e9ecef',
  },

  // ── Table header — very light gray, bottom border only ──
  tableHeader: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 8, paddingVertical: 5,
    backgroundColor: '#fafafa',
    borderBottomWidth: 1, borderBottomColor: '#e5e5e5',
  },
  th:          { fontSize: 10, fontWeight: '700', color: '#aaaaaa', letterSpacing: 0.3, textTransform: 'uppercase' },
  thActive:    { color: '#333333' },
  thSortArrow: { fontSize: 7, color: '#555555', marginLeft: 2 },

  // ── Table data row — ~36px compact, pure white ──
  tableRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 8, paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#f0f0f0',
  },
  liveBadge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  liveDot:   { width: 6, height: 6, borderRadius: 3, backgroundColor: '#22c55e' },

  // ── Column layout ──
  cSymbol: { width: C.symbol },
  cName:   { flex: 1, minWidth: 100, paddingRight: 4, overflow: 'hidden' },
  cPrice:  { width: C.price },
  cChange: { width: C.change },
  cPct:    { width: C.pct },
  cVol:    { width: C.vol },

  // ── Cell typography ──
  tdSymbolCell: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  riskDot:  { width: 5, height: 5, borderRadius: 2.5, flexShrink: 0 },
  tdSymbol: { fontSize: 13, fontWeight: '700', color: '#0066cc', flexShrink: 1 },
  tdName:   { fontSize: 12, fontWeight: '400', color: '#555555' },
  tdPrice:  { fontSize: 13, fontWeight: '700', color: '#111111', textAlign: 'right' },
  tdChange: { fontSize: 12, fontWeight: '400', textAlign: 'right' },
  tdPct:    { fontSize: 12, fontWeight: '400', textAlign: 'right' },
  tdVol:    { fontSize: 12, fontWeight: '400', color: '#888888', textAlign: 'right' },

  // ── Count / timestamp strip ──
  countStrip: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 10, paddingVertical: 5,
    borderBottomWidth: 1, borderBottomColor: '#f0f0f0',
    backgroundColor: '#ffffff',
  },
  countText:    { fontSize: 11, color: '#888888' },
  countBold:    { fontWeight: '700', color: '#333333' },
  countUpdated: { fontSize: 10, color: '#aaaaaa', marginTop: 1 },
  countLive:    { fontSize: 9, color: '#22c55e', fontWeight: '800', letterSpacing: 1 },

  // ── Skeleton loading ──
  skeletonRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 8, paddingVertical: 6,
    borderBottomWidth: 1, borderBottomColor: '#f5f5f5',
    backgroundColor: '#ffffff',
  },
  skeletonCell: { height: 10, borderRadius: 4, backgroundColor: '#efefef' },

  // ── Load more ──
  loadMoreBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 9,
    borderTopWidth: 1, borderTopColor: '#f0f0f0',
    backgroundColor: '#ffffff',
  },
  loadMoreText:  { fontSize: 12, fontWeight: '500', color: '#0066cc' },
  loadMoreArrow: { fontSize: 11, color: '#0066cc', fontWeight: '700' },

  // ── Table footer / empty ──
  tableEmpty:      { paddingVertical: 24, alignItems: 'center' },
  tableEmptyText:  { fontSize: 13, color: '#aaaaaa' },
  tableFooter:     { paddingVertical: 7, alignItems: 'center', borderTopWidth: 1, borderTopColor: '#f0f0f0' },
  tableFooterText: { fontSize: 10, color: '#aaaaaa', fontWeight: '400' },
});

// ── BriefCard styles ───────────────────────────────────────────────────────────
const bcStyles = StyleSheet.create({
  headerRow:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 },
  headerLeft:   { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerRight:  { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dot:          { width: 7, height: 7, borderRadius: 4 },
  title:        { fontSize: 11, fontWeight: '800', color: '#0a1628', letterSpacing: 0.8, textTransform: 'uppercase' },
  toneBadge:    { borderRadius: 5, paddingHorizontal: 5, paddingVertical: 1 },
  toneText:     { fontSize: 9, fontWeight: '700' },
  chevron:      { fontSize: 8, color: '#94a3b8', marginLeft: 2 },
  subRow:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  phaseLabel:   { fontSize: 9, fontWeight: '800', color: '#64748b', letterSpacing: 1.2, textTransform: 'uppercase' },
  timeLabel:    { fontSize: 9, color: '#94a3b8' },
  vixRow:       { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, marginBottom: 10 },
  vixLabel:     { fontSize: 9, fontWeight: '800', color: '#64748b', letterSpacing: 1 },
  vixValue:     { fontSize: 15, fontWeight: '900' },
  vixInterpret: { fontSize: 10, fontWeight: '700', flex: 1 },
  vixChg:       { fontSize: 10, fontWeight: '700' },
  sectionLabel: { fontSize: 10, color: '#9aa0aa', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 5 },
  idxGrid:      { borderRadius: 8, borderWidth: 1, borderColor: '#f1f5f9', overflow: 'hidden', marginBottom: 8 },
  idxRow:       { flexDirection: 'row' },
  idxRowTop:    { borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  idxCell:      { flex: 1, paddingVertical: 6, paddingHorizontal: 6 },
  idxVDivider:  { width: StyleSheet.hairlineWidth, backgroundColor: '#d1d9e0' },
  idxTicker:    { fontSize: 9, fontWeight: '800', color: '#94a3b8', letterSpacing: 0.8, marginBottom: 2 },
  idxPriceRow:  { flexDirection: 'row', alignItems: 'baseline', gap: 4, flexWrap: 'wrap' },
  idxPrice:     { fontSize: 13, fontWeight: '800', color: '#0f172a' },
  idxPct:       { fontSize: 10, fontWeight: '700' },
  insight:      { fontSize: 12, color: '#475569', lineHeight: 18, fontStyle: 'italic', marginTop: 2 },
  readMore:     { fontSize: 11, color: '#0066cc', fontWeight: '500', marginTop: 3 },
  loadingRow:   { paddingVertical: 8 },
  loadingText:  { fontSize: 12, color: '#d97706', fontStyle: 'italic' },
  sectorRow:    { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  sectorPill:   { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  sectorPillTxt:{ fontSize: 10, fontWeight: '700' },
});

// ── Left Sidebar styles ────────────────────────────────────────────────────────
const sbStyles = StyleSheet.create({
  sidebarOuter: {
    width: 110, marginBottom: 8,
    borderRadius: 12, backgroundColor: '#ffffff',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08, shadowRadius: 10, elevation: 3,
  },
  sidebar: {
    borderRadius: 12, overflow: 'hidden', paddingTop: 4,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#ffffff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f5f5f5',
    minHeight: 36,
  },
  itemActive: {
    backgroundColor: '#fffdf5',
  },
  activeBar: {
    position: 'absolute',
    left: 0, top: 0, bottom: 0,
    width: 3,
    backgroundColor: '#f5a623',
    borderTopRightRadius: 2,
    borderBottomRightRadius: 2,
  },
  itemText: {
    fontSize: 13,
    color: '#666666',
    fontWeight: '400',
    flex: 1,
  },
  itemTextActive: {
    color: '#f5a623',
    fontWeight: '600',
  },
});

// ── Watchlist styles ───────────────────────────────────────────────────────────
const wlStyles = StyleSheet.create({
  panel: {
    width: 200, marginBottom: 8,
    borderRadius: 12, backgroundColor: '#ffffff',
    borderLeftWidth: 3, borderLeftColor: '#f5a623',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 12, elevation: 3,
    flexDirection: 'column',
    maxHeight: 640,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: 'rgba(245,166,35,0.2)',
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 12, borderTopRightRadius: 12,
  },
  headerTitle: { fontSize: 15, fontWeight: '700', color: '#0a1628' },
  editBtn:     { fontSize: 11, color: '#f5a623', fontWeight: '600' },
  inputRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: '#f0f0f0',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 4, elevation: 1,
    backgroundColor: '#ffffff',
  },
  input: {
    flex: 1, height: 30, borderRadius: 8,
    backgroundColor: '#f5f5f5',
    paddingHorizontal: 8, fontSize: 12, color: '#333333',
  },
  addBtn: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: '#f5a623',
    justifyContent: 'center', alignItems: 'center',
  },
  addBtnText: { color: '#ffffff', fontWeight: '800', fontSize: 20, lineHeight: 24, marginTop: -1 },
  list: { flex: 1 },
  empty: { alignItems: 'center', paddingVertical: 28, paddingHorizontal: 14 },
  emptyIcon:  { fontSize: 32, color: '#cccccc', marginBottom: 10 },
  emptyTitle: { fontSize: 12, color: '#aaaaaa', fontWeight: '600', marginBottom: 5 },
  emptyHint:  { fontSize: 11, color: '#bbbbbb', textAlign: 'center', lineHeight: 16 },
  item: {
    flexDirection: 'row', alignItems: 'center',
    paddingLeft: 10, paddingRight: 4,
    minHeight: 56,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#f0f0f0',
    gap: 6,
  },
  itemPressed: { backgroundColor: '#fffdf5' },
  itemLeft:    { flex: 1, minWidth: 0, justifyContent: 'center' },
  itemTicker:  { fontSize: 13, fontWeight: '700', color: '#0a1628' },
  itemName:    { fontSize: 10, color: '#888888', marginTop: 2 },
  itemRight:   { alignItems: 'flex-end', gap: 3 },
  itemPrice:   { fontSize: 13, fontWeight: '700', color: '#111111' },
  pctPill:     { borderRadius: 10, paddingHorizontal: 5, paddingVertical: 2 },
  pctText:     { fontSize: 10, fontWeight: '700' },
  deleteBtn:   { paddingHorizontal: 6, paddingVertical: 10 },
  deleteBtnText: { fontSize: 18, color: '#cccccc', fontWeight: '700', lineHeight: 22 },
  footer: {
    borderTopWidth: 1, borderTopColor: '#f0f0f0',
    paddingHorizontal: 12, paddingVertical: 5,
    alignItems: 'center',
    borderBottomLeftRadius: 12, borderBottomRightRadius: 12,
    backgroundColor: '#fafeff',
  },
  footerText: { fontSize: 9, color: '#aaaaaa' },
});
