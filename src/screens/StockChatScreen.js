import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  SafeAreaView, ActivityIndicator, Dimensions, KeyboardAvoidingView,
  Platform, Modal, Animated, Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Markdown from 'react-native-markdown-display';
import PriceChart from '../components/PriceChart';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchQuote, fetchTickerDetails, fetchTickerNews, fetchIntradayChart, fetchExtendedData, fetchMarketIndices, fetchEarnings } from '../services/stockService';
import { callAI, aiErrorMessage } from '../services/aiService';
import { useTabs } from '../context/TabContext';
import { extractTicker } from '../utils/tickerExtractor';
import { buildDisclaimerMessage, hasSeenDisclaimer, markDisclaimerSeen } from '../utils/disclaimer';
import { calcRisk } from '../utils/riskLevel';
import { LogoIcon } from '../components/ChatstoxLogo';
import { detectHistoricalQuery } from '../utils/detectHistoricalQuery';
import { nowISO, formatMessageTime } from '../utils/formatTime';
import { BACKEND_URL } from '../config/api';

const BACKEND = BACKEND_URL;

const { width } = Dimensions.get('window');

// ── Market session helpers ────────────────────────────────────────────────────

function getETTotalMinutes() {
  const etStr = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date());
  const [h, m] = etStr.split(':').map(Number);
  return h * 60 + m;
}

function getMarketSession() {
  const now = new Date();
  const utcHour = now.getUTCHours();
  const utcMin  = now.getUTCMinutes();
  const utcDay  = now.getUTCDay(); // 0=Sun, 6=Sat
  const month   = now.getUTCMonth() + 1;
  const isDST   = month > 3 && month < 11;
  const offset  = isDST ? 4 : 5;
  const etHour  = (utcHour - offset + 24) % 24;
  const etTime  = etHour + utcMin / 60;

  if (utcDay === 6 || utcDay === 0) return 'afterhours'; // weekend
  if (etTime >= 4.0  && etTime < 9.5)  return 'premarket';
  if (etTime >= 9.5  && etTime < 16.0) return 'open';
  return 'afterhours';
}

function formatETTimestamp(nanosTs) {
  const date = nanosTs && nanosTs > 0 ? new Date(nanosTs / 1e6) : new Date();
  return date.toLocaleTimeString('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function getETZoneAbbr() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    timeZoneName: 'short',
  }).formatToParts(new Date());
  return parts.find(p => p.type === 'timeZoneName')?.value ?? 'ET';
}

function fmtPrice(n) {
  const num = Number(n);
  return num > 0 && num < 1 ? `$${num.toFixed(4)}` : `$${num.toFixed(2)}`;
}
function fmtDelta(n) { return `${Number(n) >= 0 ? '+' : ''}${Number(n).toFixed(2)}`; }
function fmtPct(n) { return `(${Number(n) >= 0 ? '+' : ''}${Number(n).toFixed(2)}%)`; }

// ── PriceHeader ───────────────────────────────────────────────────────────────

function PriceHeader({ stock }) {
  if (!stock) return null;

  const session   = getMarketSession();
  const tz        = getETZoneAbbr();
  const lastP     = Number(stock.price)        || 0;
  const dayC      = Number(stock.dayClose)      || 0;
  const prevC     = Number(stock.previousClose) || 0;
  const changePct = Number(stock.changePercent) || 0;
  const changeAmt = Number(stock.todaysChange)  || 0;
  const tTime     = stock.lastTradeTime ? formatETTimestamp(stock.lastTradeTime) : null;

  const regColor = changePct >= 0 ? '#16a34a' : '#dc2626';

  // MARKET OPEN — single column, current live price
  if (session === 'open') {
    return (
      <View style={phStyles.block}>
        <Text style={phStyles.mainPrice}>{fmtPrice(lastP)}</Text>
        <Text style={[phStyles.change, { color: regColor }]}>
          {changeAmt >= 0 ? '+' : ''}{changeAmt.toFixed(2)} ({changePct >= 0 ? '+' : ''}{changePct.toFixed(2)}%)
        </Text>
        <Text style={phStyles.label}>
          {tTime ? `As of ${tTime} ${tz}` : `Market Open · ${tz}`}
        </Text>
      </View>
    );
  }

  // AFTER HOURS — two columns: official close | AH price
  if (session === 'afterhours') {
    const utcDay  = new Date().getUTCDay();
    const isWeekend = utcDay === 0 || utcDay === 6;

    // v3 gives pre-computed late_trading_change; fall back to derived delta
    const ahDelta    = stock.ahChange    !== null && stock.ahChange    !== undefined
      ? Number(stock.ahChange)    : (lastP - dayC);
    const ahDeltaPct = stock.ahChangePct !== null && stock.ahChangePct !== undefined
      ? Number(stock.ahChangePct) : (dayC > 0 ? (ahDelta / dayC) * 100 : 0);
    const hasAH      = Math.abs(ahDelta) > 0.0001 || (lastP > 0 && lastP !== dayC);
    const ahColor    = ahDelta >= 0 ? '#16a34a' : '#dc2626';

    const ahLabel = isWeekend
      ? `🌙 Extended hours${tTime ? ` · ${tTime}` : ''}`
      : `🌙${tTime ? ` ${tTime}` : ' After hours'}`;

    return (
      <View style={phStyles.dualRow}>
        <View style={phStyles.leftCol}>
          <Text style={phStyles.mainPrice}>{fmtPrice(dayC)}</Text>
          <Text style={[phStyles.change, { color: regColor }]}>
            {changeAmt >= 0 ? '+' : ''}{changeAmt.toFixed(2)} ({changePct.toFixed(2)}%)
          </Text>
          <Text style={phStyles.label}>At close · 4:00 PM {tz}</Text>
        </View>
        <View style={phStyles.divider} />
        <View style={phStyles.rightCol}>
          {hasAH ? (
            <>
              <Text style={phStyles.subPrice}>{fmtPrice(lastP)}</Text>
              <Text style={[phStyles.change, { color: ahColor }]}>
                {ahDelta >= 0 ? '+' : ''}{ahDelta.toFixed(2)} ({ahDeltaPct.toFixed(2)}%)
              </Text>
              <Text style={phStyles.label}>{ahLabel}</Text>
            </>
          ) : (
            <>
              <Text style={[phStyles.subPrice, { color: '#94a3b8' }]}>{fmtPrice(dayC)}</Text>
              <Text style={phStyles.label}>{isWeekend ? '🌙 Extended hours' : '🌙 After hours'}</Text>
              <Text style={phStyles.label}>No trades yet</Text>
            </>
          )}
        </View>
      </View>
    );
  }

  // PRE-MARKET — two columns: prev close | premarket price
  if (session === 'premarket') {
    const base       = prevC || dayC;
    // v3 gives pre-computed early_trading_change; fall back to derived delta
    const pmDelta    = stock.preChange    !== null && stock.preChange    !== undefined
      ? Number(stock.preChange)    : (lastP - base);
    const pmDeltaPct = stock.preChangePct !== null && stock.preChangePct !== undefined
      ? Number(stock.preChangePct) : (base > 0 ? (pmDelta / base) * 100 : 0);
    const hasPM      = base > 0 && (Math.abs(pmDelta) > 0.0001 || (lastP > 0 && lastP !== base));
    const pmColor    = pmDelta >= 0 ? '#16a34a' : '#dc2626';

    return (
      <View style={phStyles.dualRow}>
        <View style={phStyles.leftCol}>
          <Text style={phStyles.mainPrice}>{fmtPrice(base)}</Text>
          <Text style={phStyles.label}>Prev close</Text>
        </View>
        <View style={phStyles.divider} />
        <View style={phStyles.rightCol}>
          {hasPM ? (
            <>
              <Text style={phStyles.subPrice}>{fmtPrice(lastP)}</Text>
              <Text style={[phStyles.change, { color: pmColor }]}>
                {pmDelta >= 0 ? '+' : ''}{pmDelta.toFixed(2)} ({pmDeltaPct.toFixed(2)}%)
              </Text>
              <Text style={phStyles.label}>☀️{tTime ? ` ${tTime}` : ' Pre-market'}</Text>
            </>
          ) : (
            <>
              <Text style={[phStyles.subPrice, { color: '#94a3b8' }]}>{fmtPrice(base)}</Text>
              <Text style={phStyles.label}>☀️ Pre-market</Text>
              <Text style={phStyles.label}>No trades yet</Text>
            </>
          )}
        </View>
      </View>
    );
  }

  // CLOSED — single column, last known closing price
  const closeP = dayC || prevC || lastP;
  return (
    <View style={phStyles.block}>
      <Text style={phStyles.mainPrice}>{fmtPrice(closeP)}</Text>
      <Text style={[phStyles.change, { color: regColor }]}>
        {changeAmt >= 0 ? '+' : ''}{changeAmt.toFixed(2)} ({changePct.toFixed(2)}%)
      </Text>
      <Text style={phStyles.label}>Market Closed · Last close</Text>
    </View>
  );
}

const phStyles = StyleSheet.create({
  block: {
    alignItems: 'flex-end',
    paddingRight: 20,
  },
  dualRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingRight: 20,
  },
  leftCol: {
    alignItems: 'flex-end',
  },
  rightCol: {
    alignItems: 'flex-end',
  },
  divider: {
    width: 1,
    height: 40,
    backgroundColor: '#e0e0e0',
    alignSelf: 'center',
  },
  mainPrice: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0a1628',
    letterSpacing: -0.3,
    lineHeight: 26,
  },
  subPrice: {
    fontSize: 16,
    fontWeight: '400',
    color: '#374151',
    lineHeight: 20,
  },
  change: {
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 16,
    marginTop: 1,
  },
  label: {
    fontSize: 10,
    color: '#94a3b8',
    lineHeight: 13,
    marginTop: 1,
  },
});

// ── Typing dots animation ─────────────────────────────────────────────────────

function TypingDots() {
  const anims = [
    useRef(new Animated.Value(0.3)).current,
    useRef(new Animated.Value(0.3)).current,
    useRef(new Animated.Value(0.3)).current,
  ];
  useEffect(() => {
    const make = (anim, delay) => Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(anim, { toValue: 1,   duration: 400, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0.3, duration: 400, useNativeDriver: true }),
        Animated.delay(400),
      ])
    );
    anims.forEach((a, i) => make(a, i * 160).start());
    return () => anims.forEach(a => a.stopAnimation());
  }, []);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 12 }}>
      {anims.map((anim, i) => (
        <Animated.View
          key={i}
          style={{
            width: 6, height: 6, borderRadius: 3,
            backgroundColor: '#9aa0aa',
            marginHorizontal: 2,
            opacity: anim,
          }}
        />
      ))}
    </View>
  );
}

// ── ChatBubble ────────────────────────────────────────────────────────────────

const aiMarkdownStyles = {
  body: { color: '#1e293b', fontSize: 13, lineHeight: 18 },
  strong: { fontWeight: '800', color: '#0a1628' },
  bullet_list: { marginVertical: 4 },
  bullet_list_icon: { color: '#f5a623', marginTop: 6 },
  list_item: { flexDirection: 'row', marginBottom: 2 },
  paragraph: { marginBottom: 8, marginTop: 0 },
  heading2: { fontSize: 15, fontWeight: '800', color: '#0a1628', marginBottom: 4, marginTop: 4 },
  heading3: { fontSize: 14, fontWeight: '700', color: '#0a1628', marginBottom: 2, marginTop: 4 },
};

function ChatBubble({ msg }) {
  const isUser = msg.role === 'user';
  return (
    <View style={[isUser ? styles.bubbleWrapUser : styles.bubbleWrapAI, isUser ? styles.bubbleRight : styles.bubbleLeft]}>
      {!isUser && <Text style={styles.aiLabel}>✨ CHATSTOX AI</Text>}
      {isUser ? (
        <LinearGradient
          colors={['#1a2a4a', '#0a1628']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.bubbleUser}
        >
          <Text style={styles.bubbleTextUser}>{msg.displayContent ?? msg.content}</Text>
        </LinearGradient>
      ) : (
        <View style={styles.bubbleAI}>
          {msg.streaming && !msg.content ? (
            <TypingDots />
          ) : (
            <Markdown style={aiMarkdownStyles}>{msg.content}</Markdown>
          )}
        </View>
      )}
      <Text style={[styles.timestamp, isUser && { textAlign: 'right' }]}>{formatMessageTime(msg.time)}</Text>
    </View>
  );
}

// ── TabBar ────────────────────────────────────────────────────────────────────

function TabBar({ tabs, activeTicker, onTabPress, onTabClose, onAddPress }) {
  const scrollRef = useRef(null);
  // Only show stock tabs in this bar
  const stockTabs = tabs.filter(t => !t.type || t.type === 'stock');

  return (
    <View style={tbStyles.wrapper}>
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={tbStyles.content}
        style={{ flex: 1 }}
      >
        {stockTabs.map(tab => {
          const isActive = tab.ticker === activeTicker;
          const isPos = Number(tab.changePercent) >= 0;
          return (
            <TouchableOpacity
              key={tab.ticker}
              style={[tbStyles.tab, isActive && tbStyles.tabActive]}
              onPress={() => onTabPress(tab.ticker)}
              activeOpacity={0.75}
            >
              <Text style={[tbStyles.tabTicker, isActive && tbStyles.tabTickerActive]}>
                {tab.tabName || tab.ticker}
              </Text>
              <View style={[tbStyles.tabPctBadge, { backgroundColor: isPos ? '#22c55e' : '#ef4444' }]}>
                <Text style={tbStyles.tabPctText}>
                  {isPos ? '+' : ''}{Number(tab.changePercent).toFixed(1)}%
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => onTabClose(tab.ticker)}
                hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
                style={tbStyles.closeBtn}
              >
                <Text style={tbStyles.closeBtnText}>×</Text>
              </TouchableOpacity>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
      <TouchableOpacity style={tbStyles.addBtn} onPress={onAddPress}>
        <View style={tbStyles.addBtnCircle}>
          <Text style={tbStyles.addBtnText}>+</Text>
        </View>
      </TouchableOpacity>
    </View>
  );
}

const tbStyles = StyleSheet.create({
  wrapper: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e8e8e8',
    height: 32,
  },
  content: { paddingHorizontal: 4, alignItems: 'center' },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginHorizontal: 1,
    gap: 4,
    height: 32,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    borderBottomColor: '#f5a623',
  },
  tabTicker: { fontSize: 11, fontWeight: '700', color: '#94a3b8', letterSpacing: 0.3 },
  tabTickerActive: { color: '#0a1628' },
  tabPctBadge: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 20,
  },
  tabPctText: { fontSize: 9, fontWeight: '700', color: '#fff' },
  closeBtn: { marginLeft: 1 },
  closeBtnText: { fontSize: 11, color: '#cbd5e1', fontWeight: '500', lineHeight: 13 },
  addBtn: {
    width: 36,
    alignSelf: 'stretch',
    justifyContent: 'center',
    alignItems: 'center',
    borderLeftWidth: 1,
    borderLeftColor: '#e8e8e8',
  },
  addBtnCircle: {
    width: 20, height: 20, borderRadius: 10,
    borderWidth: 1.5, borderColor: '#f5a623',
    justifyContent: 'center', alignItems: 'center',
  },
  addBtnText: { fontSize: 12, color: '#f5a623', fontWeight: '600', lineHeight: 14, marginTop: -1 },
});

// ── SearchModal ───────────────────────────────────────────────────────────────

function SearchModal({ visible, onClose, onSearch }) {
  const [query, setQuery] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (visible) {
      setQuery('');
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [visible]);

  const handleSubmit = () => {
    const raw = query.trim();
    if (!raw) return;
    const detected = extractTicker(raw);
    const ticker = detected || (raw.length <= 6 ? raw.toUpperCase() : null);
    if (ticker) {
      onSearch(ticker);
      setQuery('');
      onClose();
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={smStyles.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={smStyles.card}>
          <Text style={smStyles.title}>Open Stock Chat</Text>
          <TextInput
            ref={inputRef}
            style={smStyles.input}
            placeholder="Ticker or company (e.g. Apple, TSLA, NVDA)..."
            placeholderTextColor="#94a3b8"
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={handleSubmit}
            autoCapitalize="characters"
            autoCorrect={false}
            returnKeyType="go"
          />
          <View style={smStyles.btnRow}>
            <TouchableOpacity style={smStyles.cancelBtn} onPress={onClose}>
              <Text style={smStyles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={smStyles.openBtn} onPress={handleSubmit}>
              <Text style={smStyles.openText}>Open Chat</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const smStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 24,
    elevation: 16,
  },
  title: { fontSize: 18, fontWeight: '800', color: '#0a1628', marginBottom: 16 },
  input: {
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#0a1628',
    backgroundColor: '#f8fafc',
  },
  btnRow: { flexDirection: 'row', gap: 12, marginTop: 16 },
  cancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    alignItems: 'center',
  },
  cancelText: { fontSize: 14, fontWeight: '700', color: '#64748b' },
  openBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#f5a623',
    alignItems: 'center',
  },
  openText: { fontSize: 14, fontWeight: '800', color: '#0a1628' },
});

// ── Quick Actions ─────────────────────────────────────────────────────────────

const QUICK_ACTIONS = [
  { label: 'Analyze setup', prompt: 'Analyze the current technical setup for this stock based on real-time market data.' },
  { label: 'Key levels', prompt: "What are the key support and resistance levels based on today's data?" },
  { label: 'Risk/reward', prompt: 'What is the risk/reward profile for this stock at current levels?' },
  { label: "What's driving this?", prompt: "What are the main factors driving this stock's price action today?" },
  { label: 'Options flow', prompt: 'Based on current price and volume data, what does options flow suggest about market sentiment?' },
];

// Builds the Trade Setup prompt with smart stop/target logic.
// Stop: best option giving ≥1% from entry (day low → VWAP-1% → prev low → forced 1%).
// Targets: real price levels (midpoint to high, day high) floored at 1.5% / 2.5%.
function buildTradeSetupPrompt(ticker, stock) {
  const entryNum    = Number(stock.price);
  const dayHighNum  = Number(stock.dayHigh);
  const dayLowNum   = Number(stock.dayLow);
  const vwapNum     = Number(stock.vwap);
  const prevLowNum  = Number(stock.previousLow)  || 0;
  const prevHighNum = Number(stock.previousHigh) || 0;
  const openNum     = Number(stock.open);
  const chgPct      = Number(stock.changePercent).toFixed(2);

  // sub-$1 stocks: 4 decimal places; $1+ stocks: 2 decimal places
  const fmt = (n) => (Number(n) > 0 && Number(n) < 1) ? Number(n).toFixed(4) : Number(n).toFixed(2);

  // ── Smart stop: use best option giving ≥1% distance from entry ───────────
  const minDist     = entryNum * 0.01;
  const dayLowDist  = entryNum - dayLowNum;
  const vwapStopNum = vwapNum > 0 ? vwapNum * 0.99 : 0;
  const vwapDist    = vwapStopNum > 0 ? entryNum - vwapStopNum : 0;
  const prevLowDist = prevLowNum > 0 ? entryNum - prevLowNum : 0;

  let stopNum, stopLabel;
  if (dayLowNum > 0 && dayLowDist >= minDist) {
    stopNum   = dayLowNum;
    stopLabel = `day low $${fmt(dayLowNum)}`;
  } else if (vwapStopNum > 0 && vwapDist >= minDist) {
    stopNum   = vwapStopNum;
    stopLabel = `VWAP−1% $${fmt(vwapStopNum)}`;
  } else if (prevLowNum > 0 && prevLowDist >= minDist) {
    stopNum   = prevLowNum;
    stopLabel = `prev-day low $${fmt(prevLowNum)}`;
  } else {
    stopNum   = entryNum * 0.99;
    stopLabel = `1% floor $${fmt(entryNum * 0.99)}`;
  }

  const stopDist = entryNum - stopNum;
  const stopPct  = (stopDist / entryNum) * 100;

  // ── Day range analysis ─────────────────────────────────────────────────────
  const dayRange    = (dayHighNum > 0 && dayLowNum > 0) ? dayHighNum - dayLowNum : 0;
  const dayRangePct = entryNum > 0 ? (dayRange / entryNum) * 100 : 0;
  const isNarrow    = dayRangePct < 1;

  // ── Smart Target 1: max of (midpoint to high | 1.5% floor | 1.5× stop) ───
  const midToHigh = dayHighNum > entryNum
    ? (entryNum + dayHighNum) / 2
    : entryNum * 1.02;
  const t1 = Math.max(midToHigh, entryNum + stopDist * 1.5, entryNum * 1.015);

  // ── Smart Target 2: max of (today's high | prev high if narrow | 2.5% floor | 2.5× stop)
  const highRef = isNarrow && prevHighNum > entryNum
    ? Math.max(dayHighNum, prevHighNum)
    : (dayHighNum > entryNum ? dayHighNum : entryNum * 1.04);
  const t2 = Math.max(highRef, entryNum + stopDist * 2.5, entryNum * 1.025);

  const t1Pct   = ((t1 - entryNum) / entryNum) * 100;
  const t2Pct   = ((t2 - entryNum) / entryNum) * 100;
  const rrRatio = stopDist > 0 ? (t1 - entryNum) / stopDist : 0;

  const price   = fmt(entryNum);
  const high    = fmt(dayHighNum);
  const low     = fmt(dayLowNum);
  const vwap    = fmt(vwapNum);
  const stopFmt = fmt(stopNum);
  const t1Fmt   = fmt(t1);
  const t2Fmt   = fmt(t2);
  const openFmt = fmt(openNum);

  const narrowBlock = isNarrow
    ? `⚠️ NARROW DAY RANGE (${dayRangePct.toFixed(1)}% < 1%) — append this bilingual note after the setup:
[Spanish] "⚠️ ${ticker} tiene un rango muy estrecho hoy (${dayRangePct.toFixed(1)}%) — no es el mejor día para un setup intraday. Considera swing trade con niveles del día anterior."
[English] "⚠️ ${ticker} has a very narrow range today (${dayRangePct.toFixed(1)}%) — not ideal for intraday. Consider a swing trade using prior-day levels."
`
    : '';

  const dayLowPctStr = dayLowNum > 0
    ? `${(dayLowDist / entryNum * 100).toFixed(2)}% below entry${dayLowDist < minDist ? ' ← TOO TIGHT' : ' ✓'}`
    : 'N/A';

  return `Use FORMAT 3 EXACTLY. No other format.
${narrowBlock}SMART STOP LOSS (pre-computed — use exactly, do NOT change):
  Entry         : $${price}
  Day low       : $${low} (${dayLowPctStr})
  VWAP stop     : ${vwapStopNum > 0 ? `$${fmt(vwapStopNum)} (${(vwapDist / entryNum * 100).toFixed(2)}% below entry)` : 'N/A'}
  → CHOSEN stop : $${stopFmt} via ${stopLabel} (−${stopPct.toFixed(2)}%) ← USE THIS
  Stop distance : ${fmt(stopDist)}

SMART TARGETS (pre-computed using real levels, not just stop multiples):
  Today's high  : $${high} | Day range: ${dayRangePct.toFixed(1)}%${isNarrow ? ' ← NARROW' : ''}
  Target 1      : $${t1Fmt} (+${t1Pct.toFixed(2)}%) [midpoint-to-high or +1.5% floor] ✓
  Target 2      : $${t2Fmt} (+${t2Pct.toFixed(2)}%) [today's high${isNarrow && prevHighNum > 0 ? '/prev-day high' : ''} or +2.5% floor] ✓
  R/R           : 1:${rrRatio.toFixed(1)}
USE THESE EXACT NUMBERS — do NOT recalculate.

Output:
📊 TRADE SETUP — ${ticker}
🟢 Entrada: $${price}
🎯 Target 1: $${t1Fmt} (+${t1Pct.toFixed(1)}%)
🎯 Target 2: $${t2Fmt} (+${t2Pct.toFixed(1)}%)
🛑 Stop Loss: $${stopFmt} (−${stopPct.toFixed(1)}%)
📈 Breakout: Si rompe $${high} con volumen → continuación confirmada
⚖️ Risk/Reward: 1:${rrRatio.toFixed(1)} — [Spanish: "Por cada $1 que arriesgas, puedes ganar $${rrRatio.toFixed(2)}" | English: "For every $1 you risk, you can make $${rrRatio.toFixed(2)}"] (match user language)
💰 [Spanish: "Ejemplo: Con $1,000 → Stop en $${stopFmt} te arriesgas ~$[Y]. Target 1 daría ~$[Z]." | English: "Example: With $1,000 → Stop at $${stopFmt} you risk ~$[Y]. Target 1 gives ~$[Z]."] (shares=floor(1000÷${price}); Y=shares×${fmt(stopDist)}; Z=shares×${fmt(t1 - entryNum)}; round to nearest dollar)
💡 Timeframe: ${isNarrow ? 'Swing (rango intraday estrecho / narrow intraday range)' : 'Intraday / Swing'}
📌 [Spanish: "Basado en: Stop vía ${stopLabel} | Targets con niveles reales de precio | R/R verificado." | English: "Based on: Stop via ${stopLabel} | Targets from real price levels | R/R verified."]
VERIFY: (${t1Fmt} − ${price}) ÷ (${price} − ${stopFmt}) must be ≥ 1.5.
Real data: Price: $${price} (${chgPct}%) | Open: $${openFmt} | High: $${high} | Low: $${low} | VWAP: $${vwap}`;
}

// Returns what kind of auto-analysis to show when returning to a chat with history.
// 'FULL_ANALYSIS' — different day or no timestamp → fire FORMAT 2
// 'SHORT_UPDATE'  — same day, 60+ minutes ago   → fire 3-line market update
// 'SILENT'        — same day, < 60 minutes ago  → just load history quietly
function getAnalysisTiming(lastAnalysisTs) {
  if (!lastAnalysisTs) return 'FULL_ANALYSIS';
  const now = Date.now();
  const elapsed = now - lastAnalysisTs;
  const tsDate = new Date(lastAnalysisTs);
  const nowDate = new Date(now);
  const sameDay =
    tsDate.getFullYear() === nowDate.getFullYear() &&
    tsDate.getMonth()    === nowDate.getMonth()    &&
    tsDate.getDate()     === nowDate.getDate();
  if (!sameDay) return 'FULL_ANALYSIS';
  if (elapsed >= 60 * 60 * 1000) return 'SHORT_UPDATE';
  return 'SILENT';
}

const CUSTOM_PROMPTS_KEY = 'customQuickPrompts';

// ── AddPromptModal ────────────────────────────────────────────────────────────

function AddPromptModal({ visible, onClose, onSave }) {
  const [text, setText] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (visible) {
      setText('');
      setTimeout(() => inputRef.current?.focus(), 120);
    }
  }, [visible]);

  const handleSave = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSave(trimmed);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={apStyles.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={apStyles.sheet}>
          <View style={apStyles.handle} />
          <Text style={apStyles.title}>New Quick Button</Text>
          <Text style={apStyles.subtitle}>Type your question — it becomes a one-tap button in every stock chat.</Text>
          <TextInput
            ref={inputRef}
            style={apStyles.input}
            placeholder='e.g. "What is the short interest?"'
            placeholderTextColor="#94a3b8"
            value={text}
            onChangeText={setText}
            onSubmitEditing={handleSave}
            returnKeyType="done"
            autoCorrect={false}
            multiline={false}
            maxLength={80}
          />
          <Text style={apStyles.charCount}>{text.length}/80</Text>
          <View style={apStyles.btnRow}>
            <TouchableOpacity style={apStyles.cancelBtn} onPress={onClose}>
              <Text style={apStyles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[apStyles.saveBtn, !text.trim() && apStyles.saveBtnDisabled]}
              onPress={handleSave}
              disabled={!text.trim()}
            >
              <Text style={apStyles.saveText}>Save Button</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const apStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 36,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 24,
  },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: '#e2e8f0', alignSelf: 'center', marginBottom: 20,
  },
  title: { fontSize: 18, fontWeight: '800', color: '#0a1628', marginBottom: 6 },
  subtitle: { fontSize: 13, color: '#64748b', marginBottom: 16, lineHeight: 18 },
  input: {
    borderWidth: 1.5, borderColor: '#e2e8f0', borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, color: '#0a1628', backgroundColor: '#f8fafc',
  },
  charCount: { fontSize: 11, color: '#94a3b8', textAlign: 'right', marginTop: 4, marginBottom: 16 },
  btnRow: { flexDirection: 'row', gap: 12 },
  cancelBtn: {
    flex: 1, paddingVertical: 13, borderRadius: 12,
    borderWidth: 1.5, borderColor: '#e2e8f0', alignItems: 'center',
  },
  cancelText: { fontSize: 14, fontWeight: '700', color: '#64748b' },
  saveBtn: {
    flex: 1, paddingVertical: 13, borderRadius: 12,
    backgroundColor: '#f5a623', alignItems: 'center',
  },
  saveBtnDisabled: { backgroundColor: '#e2e8f0' },
  saveText: { fontSize: 14, fontWeight: '800', color: '#0a1628' },
});

// ── StockChatScreen ───────────────────────────────────────────────────────────

export default function StockChatScreen({ route, navigation }) {
  const { tabs, addTab, closeTab, updateTab } = useTabs();

  const initialTicker = route.params?.ticker || '';
  const [currentTicker, setCurrentTicker] = useState(initialTicker);

  const [stock, setStock] = useState(null);
  const [details, setDetails] = useState(null);
  const [news, setNews] = useState([]);
  const [chart, setChart] = useState([]);
  const [extendedData, setExtendedData] = useState(null);
  const [marketIndices, setMarketIndices] = useState([]);
  const [earnings, setEarnings] = useState([]);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [profile, setProfile] = useState(null);
  const [showSearch, setShowSearch] = useState(false);
  const [customPrompts, setCustomPrompts] = useState([]);
  const [showAddPrompt, setShowAddPrompt] = useState(false);

  const scrollRef = useRef(null);
  const loadingTickerRef = useRef('');
  const pendingQuestionRef = useRef(route.params?.question || null);
  const flashAnim = useRef(new Animated.Value(0)).current;
  const [flashColor, setFlashColor] = useState('transparent');
  const [priceDirection, setPriceDirection] = useState(null);
  const prevPriceRef = useRef(null);
  const intervalRef = useRef(null);
  const momentumAlertRef = useRef(false);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  }, []);

  // ── Custom prompts ──────────────────────────────────────────────────────────

  useEffect(() => {
    AsyncStorage.getItem(CUSTOM_PROMPTS_KEY).then(raw => {
      if (raw) setCustomPrompts(JSON.parse(raw));
    }).catch(() => {});
  }, []);

  const saveCustomPrompt = async (label) => {
    const updated = [...customPrompts, { label, prompt: label }];
    setCustomPrompts(updated);
    await AsyncStorage.setItem(CUSTOM_PROMPTS_KEY, JSON.stringify(updated)).catch(() => {});
  };

  const deleteCustomPrompt = (index) => {
    Alert.alert(
      'Remove button',
      `Remove "${customPrompts[index].label}" from quick actions?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            const updated = customPrompts.filter((_, i) => i !== index);
            setCustomPrompts(updated);
            await AsyncStorage.setItem(CUSTOM_PROMPTS_KEY, JSON.stringify(updated)).catch(() => {});
          },
        },
      ]
    );
  };

  // ── Load ticker data ────────────────────────────────────────────────────────

  const loadTicker = useCallback(async (ticker) => {
    if (!ticker) return;
    loadingTickerRef.current = ticker;
    const hasMomentumAlert = momentumAlertRef.current;
    momentumAlertRef.current = false;
    const momentumMsg = hasMomentumAlert ? [{ role: 'momentum_alert' }] : [];

    setLoading(true);
    setStock(null);
    setDetails(null);
    setChart([]);
    setMessages([]);

    try {
      const [q, d, n, c, savedRaw, profileRaw, disclaimerSeen, existingInfoRaw, lastAnalysisRaw, indices, earningsData] = await Promise.all([
        fetchQuote(ticker),
        fetchTickerDetails(ticker),
        fetchTickerNews(ticker),
        fetchIntradayChart(ticker),
        AsyncStorage.getItem(`chat_${ticker}`),
        AsyncStorage.getItem('userProfile'),
        hasSeenDisclaimer(ticker),
        AsyncStorage.getItem(`chat_info_${ticker}`),
        AsyncStorage.getItem(`last_analysis_${ticker}`),
        fetchMarketIndices().catch(() => []),
        fetchEarnings(ticker).catch(() => []),
      ]);
      const lastAnalysisTs = lastAnalysisRaw ? Number(lastAnalysisRaw) : null;
      const hasRealPrice = (s) => s && Number(s.price) > 0;

      if (loadingTickerRef.current !== ticker) return; // stale, ticker switched

      setStock(q);
      setDetails(d);
      setNews(n);
      setChart(c || []);
      if (indices?.length) setMarketIndices(indices);
      setEarnings(earningsData || []);

      // Extended data (prevDay, RVOL, 5-day trend) — fetched after quote so volume is known
      const ext = q ? await fetchExtendedData(ticker, q.volume).catch(() => null) : null;
      if (loadingTickerRef.current !== ticker) return;
      setExtendedData(ext);
      if (profileRaw) setProfile(JSON.parse(profileRaw));

      if (q) {
        addTab({ ticker, name: d?.name || ticker, price: q.price, changePercent: q.changePercent });
        // Merge name into existing info to preserve lastTime from previous sessions
        const existingInfo = existingInfoRaw ? JSON.parse(existingInfoRaw) : {};
        AsyncStorage.setItem(`chat_info_${ticker}`, JSON.stringify({ ...existingInfo, name: d?.name || ticker })).catch(() => {});
      }

      const saved = savedRaw ? JSON.parse(savedRaw) : [];
      const pendingQuestion = pendingQuestionRef.current;
      pendingQuestionRef.current = null; // consume it

      if (saved.length > 0) {
        // Load existing chat history
        let base = saved;
        if (!disclaimerSeen) {
          base = [buildDisclaimerMessage(), ...saved];
          await AsyncStorage.setItem(`chat_${ticker}`, JSON.stringify(base));
          await markDisclaimerSeen(ticker);
        }
        // Inject session divider to visually separate history from new messages
        const baseWithDivider = [...base, { role: 'session_divider' }, ...momentumMsg];

        // If there's a pending question from search bar, answer it inline
        if (pendingQuestion) {
          setLoading(false);
          setThinking(true);
          const userMsg = {
            role: 'user',
            content: pendingQuestion,
            time: nowISO(),
          };
          const withQuestion = [...baseWithDivider, userMsg];
          setMessages(withQuestion);
          // Save user message immediately before AI call
          await AsyncStorage.setItem(`chat_${ticker}`, JSON.stringify(
            withQuestion.filter(m => m.role !== 'session_divider')
          )).catch(() => {});
          const streamTs = nowISO();
          setMessages([...withQuestion, { role: 'assistant', content: '', time: streamTs, streaming: true }]);
          let rafId = null;
          try {
            const aiText = await callAI({
              stock: q, question: pendingQuestion,
              history: withQuestion.filter(m => m.role === 'user' || m.role === 'assistant').slice(-10),
              profile: profileRaw ? JSON.parse(profileRaw) : null,
              details: d, news: n, extendedData: ext, marketIndices: indices, earnings: earningsData,
              onChunk: (text) => {
                if (rafId != null) cancelAnimationFrame(rafId);
                rafId = requestAnimationFrame(() => {
                  setMessages(prev => {
                    const next = [...prev];
                    const last = next[next.length - 1];
                    if (last?.streaming) next[next.length - 1] = { ...last, content: text };
                    return next;
                  });
                });
              },
            });
            if (loadingTickerRef.current !== ticker) return;
            const aiMsg = { role: 'assistant', content: aiText, time: streamTs };
            const final = [...withQuestion, aiMsg];
            setMessages(final);
            await AsyncStorage.setItem(`chat_${ticker}`, JSON.stringify(
              final.filter(m => m.role !== 'session_divider')
            ));
          } catch (e) {
            console.error(`[CHATSTOX AI] loadTicker(${ticker}) pendingQuestion failed:`, e.message);
            if (loadingTickerRef.current === ticker) {
              setMessages(prev => {
                const next = [...prev];
                const errMsg = { role: 'assistant', content: aiErrorMessage(pendingQuestion), time: nowISO() };
                if (next[next.length - 1]?.streaming) next[next.length - 1] = errMsg;
                else next.push(errMsg);
                return next;
              });
            }
          } finally {
            if (loadingTickerRef.current === ticker) setThinking(false);
          }
        } else {
          const timing = getAnalysisTiming(lastAnalysisTs);

          if (timing === 'SILENT') {
            // Returned within 60 min same day — just show history
            setMessages(baseWithDivider);
            setLoading(false);
            return;
          }

          // SHORT_UPDATE or FULL_ANALYSIS — show history, then fire a message
          setMessages(baseWithDivider);
          setLoading(false);
          setThinking(true);

          // Validate real price before firing (same guard as first-open)
          let stockForUpdate = q;
          if (!hasRealPrice(stockForUpdate)) {
            for (let attempt = 0; attempt < 3; attempt++) {
              if (loadingTickerRef.current !== ticker) return;
              await new Promise(r => setTimeout(r, 2000));
              try {
                const refreshed = await fetchQuote(ticker);
                if (hasRealPrice(refreshed)) { stockForUpdate = refreshed; setStock(refreshed); break; }
              } catch { /* keep retrying */ }
            }
          }

          if (loadingTickerRef.current !== ticker) return;

          const updateMsg = {
            role: 'assistant',
            content: '',
            time: nowISO(),
          };

          try {
            if (timing === 'SHORT_UPDATE') {
              console.log(`[MARKET-UPDATE] ${ticker} firing short update`);
              updateMsg.content = await callAI({
                stock: stockForUpdate,
                question: `Output a SHORT market update in this EXACT format — no other text, no greetings, max 3 lines:\n📊 Update — ${ticker} | $[current price] ([change%]) | Vol: [volume]\n[one sentence: what is notable right now — compare price to open, note volume trend or key level nearby, be specific with real numbers from the data.]`,
                history: [], marketIndices: indices,
                profile: profileRaw ? JSON.parse(profileRaw) : null,
                details: d, news: n, extendedData: ext, earnings: earningsData,
              });
            } else {
              // FULL_ANALYSIS — next day or no prior timestamp
              console.log(`[AUTO-ANALYSIS] ${ticker} firing next-day FORMAT 2`);
              updateMsg.content = await callAI({
                stock: stockForUpdate,
                question: `Analyze ${ticker} using the real-time market data provided.`,
                history: [],
                profile: profileRaw ? JSON.parse(profileRaw) : null,
                isAutoAnalysis: true,
                details: d, news: n, extendedData: ext, marketIndices: indices, earnings: earningsData,
              });
            }
          } catch {
            updateMsg.content = timing === 'SHORT_UPDATE'
              ? `📊 Update — ${ticker} | $${Number(stockForUpdate?.price ?? 0).toFixed(2)} | Datos cargados.`
              : `Listo para analizar ${ticker}. ¿Qué quieres saber?`;
          }

          if (loadingTickerRef.current !== ticker) return;

          const updatedHistory = [...baseWithDivider, updateMsg];
          setMessages(updatedHistory);
          await AsyncStorage.setItem(`last_analysis_${ticker}`, String(Date.now())).catch(() => {});
          // Persist the new analysis message (not the transient short update) to chat history
          if (timing === 'FULL_ANALYSIS') {
            const toSave = updatedHistory.filter(m => m.role !== 'session_divider');
            await AsyncStorage.setItem(`chat_${ticker}`, JSON.stringify(toSave)).catch(() => {});
          }
          return;
        }
        setLoading(false);
        return;
      }

      // New chat — check for pending question from search bar
      setLoading(false);
      setThinking(true);

      if (pendingQuestion) {
        // Answer the user's search question directly (skip auto-analysis)
        const userMsg = {
          role: 'user',
          content: pendingQuestion,
          time: nowISO(),
        };
        const withQuestion = [buildDisclaimerMessage(), userMsg];
        setMessages(withQuestion);
        const streamTs = nowISO();
        setMessages([...withQuestion, { role: 'assistant', content: '', time: streamTs, streaming: true }]);
        let rafId = null;
        try {
          const aiText = await callAI({
            stock: q, question: pendingQuestion, history: [],
            profile: profileRaw ? JSON.parse(profileRaw) : null,
            details: d, news: n, extendedData: ext, marketIndices: indices, earnings: earningsData,
            onChunk: (text) => {
              if (rafId != null) cancelAnimationFrame(rafId);
              rafId = requestAnimationFrame(() => {
                setMessages(prev => {
                  const next = [...prev];
                  const last = next[next.length - 1];
                  if (last?.streaming) next[next.length - 1] = { ...last, content: text };
                  return next;
                });
              });
            },
          });
          if (loadingTickerRef.current !== ticker) return;
          const aiMsg = { role: 'assistant', content: aiText, time: streamTs };
          const initial = [buildDisclaimerMessage(), userMsg, aiMsg];
          setMessages(initial);
          await AsyncStorage.setItem(`chat_${ticker}`, JSON.stringify(initial));
          await markDisclaimerSeen(ticker);
        } catch {
          if (loadingTickerRef.current !== ticker) return;
          const initial = [buildDisclaimerMessage(), userMsg, { role: 'assistant', content: `I'm ready to analyze ${ticker}. Ask me anything about this stock.`, time: nowISO() }];
          setMessages(initial);
          await AsyncStorage.setItem(`chat_${ticker}`, JSON.stringify(initial));
          await markDisclaimerSeen(ticker);
        } finally {
          if (loadingTickerRef.current === ticker) setThinking(false);
        }
        return;
      }

      // Auto-analysis for first open (no pending question)
      // Guard: Polygon sometimes returns price=0 on first fetch (slow feed, off-hours).
      // Validate real data is present before firing the AI so it uses live prices.
      let stockForAI = q;

      if (!hasRealPrice(stockForAI)) {
        // Show a placeholder in the chat while we wait for real Polygon data
        setThinking(false);
        setMessages([
          buildDisclaimerMessage(),
          {
            role: 'assistant',
            content: 'Cargando datos en tiempo real...',
            time: nowISO(),
          },
        ]);

        // Retry fetchQuote up to 3× with 2-second gaps
        for (let attempt = 0; attempt < 3; attempt++) {
          if (loadingTickerRef.current !== ticker) return;
          await new Promise(r => setTimeout(r, 2000));
          try {
            const refreshed = await fetchQuote(ticker);
            if (hasRealPrice(refreshed)) {
              stockForAI = refreshed;
              setStock(refreshed);
              break;
            }
          } catch { /* keep retrying */ }
        }
      }

      // Hard stop: if price is still 0 after retries, never call the AI
      if (!hasRealPrice(stockForAI)) {
        const noDataMsg = {
          role: 'assistant',
          content: `No hay datos de mercado disponibles para ${ticker}. Es posible que esta acción esté inactiva o no cotice actualmente.`,
          time: nowISO(),
        };
        setMessages([buildDisclaimerMessage(), noDataMsg]);
        await AsyncStorage.setItem(`chat_${ticker}`, JSON.stringify([buildDisclaimerMessage(), noDataMsg]));
        return;
      }

      setThinking(true);

      const autoMsg = {
        role: 'assistant',
        content: '',
        time: nowISO(),
      };

      console.log(`[AUTO-ANALYSIS] ${ticker} firing with price=$${Number(stockForAI?.price).toFixed(2)} open=$${Number(stockForAI?.open).toFixed(2)} high=$${Number(stockForAI?.dayHigh).toFixed(2)} low=$${Number(stockForAI?.dayLow).toFixed(2)} vwap=$${Number(stockForAI?.vwap).toFixed(2)}`);

      try {
        autoMsg.content = await callAI({
          stock: stockForAI,
          question: `Analyze ${ticker} using the real-time market data provided.`,
          history: [],
          profile: profileRaw ? JSON.parse(profileRaw) : null,
          isAutoAnalysis: true,
          details: d, news: n, extendedData: ext, marketIndices: indices, earnings: earningsData,
        });
      } catch {
        autoMsg.content = `I'm ready to analyze ${ticker}. Ask me anything about this stock.`;
      }

      const initial = [buildDisclaimerMessage(), ...momentumMsg, autoMsg];

      if (loadingTickerRef.current !== ticker) return;
      setMessages(initial);
      await AsyncStorage.setItem(`chat_${ticker}`, JSON.stringify(initial));
      await AsyncStorage.setItem(`last_analysis_${ticker}`, String(Date.now())).catch(() => {});
      await markDisclaimerSeen(ticker);
    } catch (e) {
      console.error(`loadTicker(${ticker}) error:`, e);
    } finally {
      if (loadingTickerRef.current === ticker) {
        setLoading(false);
        setThinking(false);
      }
    }
  }, [addTab]);

  // Reload when currentTicker changes
  useEffect(() => {
    loadTicker(currentTicker);
  }, [currentTicker]);

  // Respond to navigation from HomeScreen (new ticker or question in params)
  useEffect(() => {
    const incoming = route.params?.ticker;
    const question = route.params?.question;
    if (question) pendingQuestionRef.current = question;
    if (incoming && incoming !== currentTicker) {
      if (route.params?.momentumAlert) momentumAlertRef.current = true;
      setCurrentTicker(incoming);
    }
  }, [route.params?.ticker, route.params?.question, route.params?.momentumAlert]);

  // Reset flash state when ticker changes
  useEffect(() => {
    setPriceDirection(null);
    prevPriceRef.current = null;
    flashAnim.setValue(0);
    setFlashColor('transparent');
  }, [currentTicker]);

  // 15-second live price polling
  useEffect(() => {
    if (!currentTicker) return;
    let cancelled = false;

    const poll = async () => {
      try {
        const q = await fetchQuote(currentTicker);
        if (cancelled || !q) return;

        const newPrice = q.price;
        const oldPrice = prevPriceRef.current;

        if (oldPrice !== null && newPrice !== oldPrice) {
          const dir = newPrice > oldPrice ? 'up' : 'down';
          const color = dir === 'up' ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)';
          setPriceDirection(dir);
          setFlashColor(color);
          flashAnim.setValue(1);
          Animated.timing(flashAnim, {
            toValue: 0,
            duration: 2000,
            useNativeDriver: false,
          }).start(({ finished }) => {
            if (finished) setPriceDirection(null);
          });
        }

        prevPriceRef.current = newPrice;
        setStock(q);
        updateTab(currentTicker, { price: q.price, changePercent: q.changePercent });
      } catch {
        // silent fail — polling errors shouldn't surface to user
      }
    };

    const pollMs = getMarketSession() === 'afterhours' ? 60000 : 15000;
    intervalRef.current = setInterval(poll, pollMs);
    return () => {
      cancelled = true;
      clearInterval(intervalRef.current);
    };
  }, [currentTicker]);

  useEffect(() => {
    if (messages.length > 0) scrollToBottom();
  }, [messages]);

  // ── Send message ────────────────────────────────────────────────────────────

  const sendMessage = async (text, { label = null } = {}) => {
    const content = (text || input).trim();
    if (!content || thinking || !currentTicker) return;
    setInput('');

    const userMsg = { role: 'user', content, time: nowISO(), ...(label && { displayContent: label }) };
    const updated = [...messages, userMsg];
    setMessages(updated);
    setThinking(true);

    // Save user message immediately so it persists even if AI call fails
    const updatedToSave = updated.filter(m => m.role !== 'session_divider');
    await AsyncStorage.setItem(`chat_${currentTicker}`, JSON.stringify(updatedToSave)).catch(() => {});

    try {
      // Always fetch fresh Polygon data before every AI call so the system prompt
      // has the latest real price — prevents the AI from reverting to training data.
      let stockForCall = stock;
      try {
        const freshStock = await fetchQuote(currentTicker);
        if (freshStock && Number(freshStock.price) > 0) {
          stockForCall = freshStock;
          setStock(freshStock);
          console.log(`[SENDMESSAGE] ${currentTicker} fresh price: $${Number(freshStock.price).toFixed(2)} (${Number(freshStock.changePercent).toFixed(2)}%)`);
        }
      } catch (fetchErr) {
        console.warn(`[SENDMESSAGE] fetchQuote failed, using cached stock: ${fetchErr.message}`);
      }

      // Detect historical date queries and inject real OHLCV data before calling AI
      let questionForAI = content;
      const { isHistorical, date, ticker: histTicker } = detectHistoricalQuery(content, currentTicker);
      console.log('[HISTORICAL CHECK]', { isHistorical, date, histTicker, text: content });
      if (isHistorical && date) {
        try {
          const histUrl = `${BACKEND}/api/historical/${histTicker || currentTicker}/${date}`;
          console.log('[HISTORICAL FETCH]', histUrl);
          const histRes = await fetch(histUrl);
          const h = histRes.ok ? await histRes.json() : null;
          if (h && h.open != null) {
            const volStr = h.volume ? ` | Vol: ${(Number(h.volume) / 1e6).toFixed(1)}M` : '';
            questionForAI = `HISTORICAL DATA for ${histTicker || currentTicker} on ${date}: Open: $${h.open} | High: $${h.high} | Low: $${h.low} | Close: $${h.close}${volStr} — Use these exact numbers to answer.\n\n${content}`;
            console.log(`[HISTORICAL] injected data: open=$${h.open} close=$${h.close}`);
          } else {
            questionForAI = `HISTORICAL NOTE: No data available for ${histTicker || currentTicker} on ${date}. Possible reasons: weekend/holiday, stock didn't exist yet (recent IPO), or data not covered. Tell the user this specifically.\n\n${content}`;
            console.log(`[HISTORICAL] no data for ${histTicker || currentTicker} on ${date} (status=${histRes.status})`);
          }
        } catch (histErr) {
          console.warn(`[HISTORICAL] fetch error: ${histErr.message}`);
        }
      }

      const history = updated.filter(m => m.role === 'user' || m.role === 'assistant');
      console.log(`[HISTORICAL] calling AI with${isHistorical ? ' enriched' : ' original'} message`);

      // Add streaming placeholder bubble; spinner hides automatically once bubble appears
      const streamTs = nowISO();
      const streamMsg = { role: 'assistant', content: '', time: streamTs, streaming: true };
      setMessages([...updated, streamMsg]);

      let rafId = null;
      const aiText = await callAI({
        stock: stockForCall, question: questionForAI, history: history.slice(-10),
        profile, details, news, extendedData, marketIndices, earnings,
        onChunk: (text) => {
          if (rafId != null) cancelAnimationFrame(rafId);
          rafId = requestAnimationFrame(() => {
            setMessages(prev => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last?.streaming) next[next.length - 1] = { ...last, content: text };
              return next;
            });
          });
        },
      });

      const aiMsg = { role: 'assistant', content: aiText, time: streamTs };
      const final = [...updated, aiMsg];
      setMessages(final);
      const finalToSave = final.filter(m => m.role !== 'session_divider');
      await AsyncStorage.setItem(`chat_${currentTicker}`, JSON.stringify(finalToSave));
      await AsyncStorage.setItem(`chat_info_${currentTicker}`, JSON.stringify({
        name: details?.name || currentTicker,
        lastTime: aiMsg.time,
      }));
    } catch (e) {
      console.error(`[CHATSTOX AI] sendMessage(${currentTicker}) failed:`, e.message);
      setMessages(prev => {
        const next = [...prev];
        const errMsg = { role: 'assistant', content: aiErrorMessage(content), time: nowISO() };
        if (next[next.length - 1]?.streaming) next[next.length - 1] = errMsg;
        else next.push(errMsg);
        return next;
      });
    } finally {
      setThinking(false);
    }
  };

  // ── Tab actions ─────────────────────────────────────────────────────────────

  const handleTabPress = (ticker) => {
    if (ticker !== currentTicker) setCurrentTicker(ticker);
  };

  const handleTabClose = (ticker) => {
    closeTab(ticker);
    if (ticker === currentTicker) {
      const remaining = tabs.filter(t => t.ticker !== ticker);
      if (remaining.length === 0) {
        navigation.navigate('Home');
      } else {
        const closedIdx = tabs.findIndex(t => t.ticker === ticker);
        const nextIdx = Math.min(closedIdx, remaining.length - 1);
        setCurrentTicker(remaining[nextIdx].ticker);
      }
    }
  };

  const handleSearchOpen = (ticker) => {
    setCurrentTicker(ticker);
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  const riskInfo = stock
    ? calcRisk({ ...stock, marketCap: details?.marketCap })
    : null;

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={80}
      >
        {/* Gold top stripe */}
        <View style={styles.goldTopBar} />

        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <TouchableOpacity onPress={() => navigation.navigate('Landing')} style={styles.logoBtn} activeOpacity={0.75}>
              <LogoIcon size={40} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => navigation.openDrawer()} style={styles.menuBtn} activeOpacity={0.7}>
              <Text style={styles.menuIcon}>☰</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.headerCenter}>
            <Text style={styles.headerTicker}>{currentTicker}</Text>
            <Text style={styles.headerSub} numberOfLines={1}>
              {details?.name || currentTicker}
            </Text>
            {riskInfo && riskInfo.level === 'high' && (
              <Text
                style={[styles.headerRisk, { color: '#ef4444' }]}
                numberOfLines={1}
              >
                🔴 High Risk{' · '}{riskInfo.reasons.join(' · ')}
              </Text>
            )}
          </View>
          <View style={styles.priceWrapper}>
            <Animated.View
              pointerEvents="none"
              style={[styles.flashOverlay, { opacity: flashAnim, backgroundColor: flashColor }]}
            />
            {stock && <PriceHeader stock={stock} />}
          </View>
        </View>

        {/* Tab bar — stock tabs only */}
        {tabs.some(t => !t.type || t.type === 'stock') ? (
          <TabBar
            tabs={tabs}
            activeTicker={currentTicker}
            onTabPress={handleTabPress}
            onTabClose={handleTabClose}
            onAddPress={() => setShowSearch(true)}
          />
        ) : (
          <View style={styles.emptyTabBar}>
            <TouchableOpacity onPress={() => setShowSearch(true)} style={styles.addTabBtn}>
              <Text style={styles.addTabBtnText}>+ Open another stock</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Chart */}
        {!loading && currentTicker && (
          <PriceChart ticker={currentTicker} previousClose={stock?.previousClose} />
        )}

        {/* Messages */}
        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color="#f5a623" />
            <Text style={styles.loadingText}>Loading {currentTicker}...</Text>
          </View>
        ) : (
          <ScrollView
            ref={scrollRef}
            style={styles.messages}
            contentContainerStyle={styles.messagesContent}
            showsVerticalScrollIndicator={false}
            onContentSizeChange={scrollToBottom}
          >
            {messages.map((msg, i) => {
              if (msg.role === 'disclaimer' || msg.role === 'system_notice') {
                return (
                  <View key={i} style={styles.disclaimerBox}>
                    <Text style={styles.disclaimerLabel}>CHATSTOX</Text>
                    <Text style={styles.disclaimerText}>{msg.content}</Text>
                  </View>
                );
              }
              if (msg.role === 'momentum_alert') {
                return (
                  <View key={i} style={styles.momentumAlertBox}>
                    <Text style={styles.momentumAlertLabel}>⚡ MOMENTUM ALERT</Text>
                    <Text style={styles.momentumAlertText}>
                      {'Esta acción fue detectada en movimiento activo. Los momentum plays pueden subir rápidamente — y caer igual de rápido.\n\n• Verifica que tu broker permita comprar esta acción antes de actuar\n• El momentum puede revertirse en segundos sin previo aviso\n• Esta información es únicamente informativa y refleja datos de mercado en tiempo real\n• No constituye asesoría de inversión ni recomendación de compra\n\nProcede con precaución y gestiona tu riesgo.'}
                    </Text>
                  </View>
                );
              }
              if (msg.role === 'session_divider') {
                return (
                  <View key={i} style={styles.sessionDivider}>
                    <View style={styles.dividerLine} />
                    <Text style={styles.dividerText}>Previous conversation</Text>
                    <View style={styles.dividerLine} />
                  </View>
                );
              }
              return <ChatBubble key={i} msg={msg} />;
            })}
            {thinking && !messages[messages.length - 1]?.streaming && (
              <View style={styles.thinkingRow}>
                <ActivityIndicator size="small" color="#f5a623" />
                <Text style={styles.thinkingText}>CHATSTOX AI is analyzing...</Text>
              </View>
            )}
          </ScrollView>
        )}

        {/* Quick Actions */}
        {!loading && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.quickRow}
            contentContainerStyle={styles.quickContent}
          >
            {/* Trade Setup — premium gold button, always first */}
            <TouchableOpacity
              style={styles.quickBtnTradeSetup}
              onPress={() => stock && sendMessage(buildTradeSetupPrompt(currentTicker, stock), { label: 'Trade Setup 🎯' })}
              disabled={thinking || !stock}
            >
              <Text style={styles.quickBtnTradeSetupText}>Trade Setup 🎯</Text>
            </TouchableOpacity>

            {QUICK_ACTIONS.map(a => (
              <TouchableOpacity
                key={a.label}
                style={styles.quickBtn}
                onPress={() => sendMessage(a.prompt, { label: a.label })}
                disabled={thinking}
              >
                <Text style={styles.quickBtnText}>{a.label}</Text>
              </TouchableOpacity>
            ))}
            {customPrompts.map((a, i) => (
              <TouchableOpacity
                key={`custom_${i}`}
                style={styles.quickBtnCustom}
                onPress={() => sendMessage(a.prompt, { label: a.label })}
                onLongPress={() => deleteCustomPrompt(i)}
                disabled={thinking}
                delayLongPress={400}
              >
                <Text style={styles.quickBtnText}>{a.label}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={styles.quickBtnAdd}
              onPress={() => setShowAddPrompt(true)}
              disabled={thinking}
            >
              <Text style={styles.quickBtnAddText}>＋</Text>
            </TouchableOpacity>
          </ScrollView>
        )}

        {/* Input */}
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder={currentTicker ? `Ask about ${currentTicker}...` : 'Ask anything...'}
            placeholderTextColor="#94a3b8"
            multiline
            onSubmitEditing={() => sendMessage()}
            returnKeyType="send"
            blurOnSubmit
            editable={!loading}
          />
          <TouchableOpacity
            style={[styles.sendBtn, (!input.trim() || thinking || loading) && styles.sendBtnDisabled]}
            onPress={() => sendMessage()}
            disabled={!input.trim() || thinking || loading}
          >
            <Text style={styles.sendBtnText}>›</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      <SearchModal
        visible={showSearch}
        onClose={() => setShowSearch(false)}
        onSearch={handleSearchOpen}
      />
      <AddPromptModal
        visible={showAddPrompt}
        onClose={() => setShowAddPrompt(false)}
        onSave={saveCustomPrompt}
      />
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f7f8fa' },
  goldTopBar: { height: 2, backgroundColor: '#f5a623' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingHorizontal: 10,
    paddingVertical: 6,
    minHeight: 48,
    borderBottomWidth: 1,
    borderBottomColor: '#e8e8e8',
    gap: 6,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  headerCenter: { flex: 1, alignItems: 'center' },
  logoBtn: {
    flexShrink: 0,
    overflow: 'hidden',
  },
  menuBtn: {
    width: 28, height: 28, borderRadius: 7,
    backgroundColor: '#f7f8fa', justifyContent: 'center', alignItems: 'center', flexShrink: 0,
  },
  menuIcon: { fontSize: 13, color: '#0a1628', fontWeight: '700' },
  headerTicker: { fontSize: 18, fontWeight: '700', color: '#0a1628', letterSpacing: 0 },
  headerSub:    { fontSize: 10, color: '#94a3b8', marginTop: 1 },
  headerRisk:   { fontSize: 9, fontWeight: '600', marginTop: 2 },

  // Empty tab bar (no tabs open)
  emptyTabBar: {
    backgroundColor: '#fff',
    height: 40,
    justifyContent: 'center',
    alignItems: 'flex-start',
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e8e8e8',
  },
  addTabBtn: {
    backgroundColor: '#f0f4ff',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: '#0066cc',
  },
  addTabBtnText: { color: '#0066cc', fontSize: 12, fontWeight: '600' },

  // Loading
  loadingBox: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16 },
  loadingText: { color: '#64748b', fontSize: 14 },

  // Messages
  messages: { flex: 1, backgroundColor: '#f7f8fa' },
  messagesContent: { padding: 12, paddingBottom: 6, gap: 8 },

  // Disclaimer
  disclaimerBox: {
    backgroundColor: '#fffbeb',
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: '#fcd34d',
    shadowColor: '#d97706',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  disclaimerLabel: {
    fontSize: 8,
    fontWeight: '800',
    color: '#d97706',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  disclaimerText: { fontSize: 12, color: '#78350f', lineHeight: 17, fontWeight: '500' },

  momentumAlertBox: {
    backgroundColor: '#fff4e6',
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: '#ea580c',
    shadowColor: '#ea580c',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
    elevation: 2,
  },
  momentumAlertLabel: {
    fontSize: 8,
    fontWeight: '800',
    color: '#ea580c',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  momentumAlertText: { fontSize: 12, color: '#7c2d12', lineHeight: 17, fontWeight: '500' },

  // Chat bubbles
  bubbleWrapUser: { maxWidth: '75%', gap: 2 },
  bubbleWrapAI: { maxWidth: '85%', gap: 2 },
  bubbleLeft: { alignSelf: 'flex-start' },
  bubbleRight: { alignSelf: 'flex-end' },
  aiLabel: {
    fontSize: 9, color: '#f5a623', fontWeight: '700',
    letterSpacing: 0.8, marginBottom: 3, textTransform: 'uppercase',
  },
  bubbleUser: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 4,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
    padding: 10,
  },
  bubbleAI: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 4,
    borderTopRightRadius: 16,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
    borderLeftWidth: 3,
    borderLeftColor: '#f5a623',
    paddingVertical: 10,
    paddingHorizontal: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  bubbleTextUser: { color: '#ffffff', fontSize: 13, lineHeight: 18 },
  timestamp: { fontSize: 9, color: '#94a3b8', marginTop: 2 },
  thinkingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8 },
  thinkingText: { fontSize: 12, color: '#64748b', fontStyle: 'italic' },

  // Session divider
  sessionDivider: { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 8 },
  dividerLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: '#d1d9e0' },
  dividerText: { fontSize: 10, color: '#94a3b8', fontWeight: '500', letterSpacing: 0.4 },

  // Quick action buttons
  quickRow: {
    maxHeight: 44,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
  },
  quickContent: { paddingHorizontal: 10, gap: 5, alignItems: 'center', paddingVertical: 6 },
  quickBtnTradeSetup: {
    backgroundColor: '#f5a623',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 5,
    shadowColor: '#f5a623',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 3,
  },
  quickBtnTradeSetupText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  quickBtn: {
    backgroundColor: '#fff',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: '#0a1628',
  },
  quickBtnCustom: {
    backgroundColor: '#fff',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: '#f5a623',
  },
  quickBtnAdd: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: '#fff',
    borderWidth: 1, borderColor: '#f5a623',
    justifyContent: 'center', alignItems: 'center',
  },
  quickBtnAddText: { color: '#f5a623', fontSize: 16, fontWeight: '300', lineHeight: 20 },
  quickBtnText: { color: '#0a1628', fontSize: 11, fontWeight: '400' },

  // Input bar
  inputRow: {
    flexDirection: 'row',
    padding: 10,
    gap: 8,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e8e8e8',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    backgroundColor: '#f7f8fa',
    borderRadius: 22,
    paddingHorizontal: 14,
    paddingVertical: 8,
    fontSize: 14,
    color: '#0a1628',
    maxHeight: 100,
  },
  sendBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#f5a623',
    justifyContent: 'center', alignItems: 'center',
  },
  sendBtnDisabled: { backgroundColor: '#e2e8f0' },
  sendBtnText: { color: '#fff', fontSize: 20, fontWeight: '400', lineHeight: 24, marginLeft: 2 },

  // Price flash overlay
  priceWrapper: { position: 'relative', flexShrink: 0 },
  flashOverlay: {
    position: 'absolute',
    top: -6,
    left: -10,
    right: -10,
    bottom: -6,
    borderRadius: 8,
    zIndex: 1,
  },
});
