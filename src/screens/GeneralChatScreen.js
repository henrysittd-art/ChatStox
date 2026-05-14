import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  SafeAreaView, ActivityIndicator, KeyboardAvoidingView, Platform, Animated, Easing,
} from 'react-native';
import Markdown from 'react-native-markdown-display';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchTopGainers, fetchTopLosers, fetchTopVolume } from '../services/stockService';
import { callAI, aiErrorMessage } from '../services/aiService';
import { buildDisclaimerMessage, hasSeenDisclaimer, markDisclaimerSeen } from '../utils/disclaimer';
import { LogoIcon } from '../components/ChatstoxLogo';
import NavPillBar from '../components/NavPillBar';
import { useTabs, generateTabName } from '../context/TabContext';
import { extractTicker } from '../utils/tickerExtractor';
import { detectHistoricalQuery } from '../utils/detectHistoricalQuery';
import { nowISO, formatMessageTime } from '../utils/formatTime';
import { BACKEND_URL } from '../config/api';

const BACKEND = BACKEND_URL;

const LEGACY_KEY = 'chat_general_market';

const QUICK_ACTIONS = [
  { label: "Today's Gainers", prompt: "What are today's top gaining stocks from live market data?" },
  { label: "Today's Losers", prompt: "What are today's top losing stocks from live market data?" },
  { label: 'Market Sentiment', prompt: "What does today's real-time data tell us about overall market sentiment?" },
  { label: 'Top Volume', prompt: "Which stocks have the highest volume today?" },
  { label: 'Market Overview', prompt: "Give me a brief overview of today's market conditions based on real-time data." },
];

function StreamingCursor() {
  const blink = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(blink, { toValue: 0, duration: 530, useNativeDriver: true }),
        Animated.timing(blink, { toValue: 1, duration: 530, useNativeDriver: true }),
      ])
    ).start();
    return () => blink.stopAnimation();
  }, []);
  return <Animated.Text style={{ opacity: blink, color: '#f5a623', fontWeight: '700' }}>|</Animated.Text>;
}

function TypingLogo() {
  const rotation = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.loop(
      Animated.timing(rotation, {
        toValue: 1,
        duration: 1500,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    ).start();
    Animated.loop(
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.15, duration: 600, useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1,    duration: 600, useNativeDriver: true }),
      ])
    ).start();
    return () => { rotation.stopAnimation(); scale.stopAnimation(); };
  }, []);
  const spin = rotation.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', padding: 8 }}>
      <Animated.Image
        source={require('../assets/chatstox-icon.png')}
        style={{ width: 28, height: 28, transform: [{ rotate: spin }, { scale }] }}
        resizeMode="contain"
      />
    </View>
  );
}

const aiMarkdownStyles = {
  body: { color: '#1e293b', fontSize: 14, lineHeight: 21 },
  strong: { fontWeight: '800', color: '#0a1628' },
  bullet_list: { marginVertical: 4 },
  bullet_list_icon: { color: '#f5a623', marginTop: 6 },
  list_item: { flexDirection: 'row', marginBottom: 2 },
  paragraph: { marginBottom: 8, marginTop: 0 },
  heading2: { fontSize: 15, fontWeight: '800', color: '#0a1628', marginBottom: 4, marginTop: 4 },
  heading3: { fontSize: 14, fontWeight: '700', color: '#0a1628', marginBottom: 2, marginTop: 4 },
};

// ── ChatBubble ────────────────────────────────────────────────────────────────

function ChatBubble({ msg }) {
  const isUser = msg.role === 'user';
  return (
    <View style={[styles.bubbleWrap, isUser ? styles.bubbleRight : styles.bubbleLeft]}>
      {!isUser && <Text style={styles.aiLabel}>CHATSTOX AI</Text>}
      <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAI]}>
        {isUser ? (
          <Text style={styles.bubbleTextUser}>{msg.content}</Text>
        ) : msg.isStreaming && !msg.content ? (
          <TypingLogo />
        ) : (
          <>
            <Markdown style={aiMarkdownStyles}>{msg.content}</Markdown>
            {msg.isStreaming && <StreamingCursor />}
          </>
        )}
      </View>
      {msg.time ? <Text style={styles.timestamp}>{formatMessageTime(msg.time)}</Text> : null}
    </View>
  );
}

// ── GeneralTabBar ─────────────────────────────────────────────────────────────

function GeneralTabBar({ tabs, activeId, onTabPress, onTabClose }) {
  if (tabs.length === 0) return null;
  return (
    <View style={gtStyles.wrapper}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={gtStyles.content}
        style={{ flex: 1 }}
      >
        {tabs.map(tab => {
          const isActive = tab.id === activeId;
          const label = tab.tabName.length > 15 ? tab.tabName.slice(0, 15) : tab.tabName;
          return (
            <TouchableOpacity
              key={tab.id}
              style={[gtStyles.tab, isActive && gtStyles.tabActive]}
              onPress={() => onTabPress(tab.id)}
              activeOpacity={0.75}
            >
              <Text style={[gtStyles.tabName, isActive && gtStyles.tabNameActive]} numberOfLines={1}>
                {label}
              </Text>
              <TouchableOpacity
                onPress={() => onTabClose(tab.id)}
                hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
                style={gtStyles.closeBtn}
              >
                <Text style={gtStyles.closeBtnText}>×</Text>
              </TouchableOpacity>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const gtStyles = StyleSheet.create({
  wrapper: {
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e8e8e8',
    height: 40,
  },
  content: { paddingHorizontal: 6, alignItems: 'center' },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginHorizontal: 2,
    borderRadius: 6,
    gap: 5,
    height: 32,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    borderBottomColor: '#f5a623',
  },
  tabName: { fontSize: 11, fontWeight: '600', color: '#94a3b8', letterSpacing: 0.3 },
  tabNameActive: { color: '#0a1628', fontWeight: '700' },
  closeBtn: { marginLeft: 1 },
  closeBtnText: { fontSize: 13, color: '#bbbbbb', fontWeight: '700', lineHeight: 14 },
});

// ── GeneralChatScreen ─────────────────────────────────────────────────────────

export default function GeneralChatScreen({ navigation, route }) {
  const { tabs, tabsLoaded, addGeneralTab, closeTab } = useTabs();

  const [gainers, setGainers] = useState([]);
  const [losers, setLosers] = useState([]);
  const [volume, setVolume] = useState([]);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [loading, setLoading] = useState(true);
  const [marketReady, setMarketReady] = useState(false);
  const [profile, setProfile] = useState(null);
  const [currentTabId, setCurrentTabId] = useState(null);

  const scrollRef = useRef(null);
  // Refs so callbacks always see fresh values without re-creating
  const gainersRef       = useRef([]);
  const losersRef        = useRef([]);
  const volumeRef        = useRef([]);
  const profileRef       = useRef(null);
  const currentTabIdRef  = useRef(null);
  const processedQRef    = useRef(null); // prevents double-processing same question
  const marketReadyRef   = useRef(false);

  // Stable ref to latest openNewTab (avoids stale closure in init effect)
  const openNewTabRef = useRef(null);

  // Keep currentTabIdRef in sync
  useEffect(() => { currentTabIdRef.current = currentTabId; }, [currentTabId]);

  const generalTabs = tabs.filter(t => t.type === 'general');

  const scrollToBottom = useCallback(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  }, []);

  // ── Open a new general tab and answer its question ────────────────────────

  const openNewTab = useCallback(async (question) => {
    const id = addGeneralTab(question);
    currentTabIdRef.current = id;
    setCurrentTabId(id);

    const sk = `chat_general_${id}`;
    const infoSk = `chat_general_info_${id}`;
    const tabName = generateTabName(question);
    const userMsg = { role: 'user', content: question, time: nowISO() };
    const withDisclaimer = [buildDisclaimerMessage(), userMsg];
    setMessages(withDisclaimer);
    setThinking(true);

    // Save user message immediately
    await AsyncStorage.setItem(sk, JSON.stringify(withDisclaimer)).catch(() => {});
    await AsyncStorage.setItem(infoSk, JSON.stringify({ tabName, question, lastTime: userMsg.time })).catch(() => {});

    // Detect historical date query and inject OHLCV data
    let questionForAI = question;
    const ticker = extractTicker(question);
    const { isHistorical, date, ticker: histTicker } = detectHistoricalQuery(question, ticker);
    console.log('[HISTORICAL CHECK]', { isHistorical, date, histTicker: histTicker ?? ticker, text: question });
    if (isHistorical && date) {
      const resolvedTicker = histTicker || ticker;
      if (resolvedTicker) {
        try {
          const histUrl = `${BACKEND}/api/historical/${resolvedTicker}/${date}`;
          console.log('[HISTORICAL FETCH]', histUrl);
          const histRes = await fetch(histUrl);
          const h = histRes.ok ? await histRes.json() : null;
          if (h && h.open != null) {
            const volStr = h.volume ? ` | Vol: ${(Number(h.volume) / 1e6).toFixed(1)}M` : '';
            questionForAI = `HISTORICAL DATA for ${resolvedTicker} on ${date}: Open: $${h.open} | High: $${h.high} | Low: $${h.low} | Close: $${h.close}${volStr} — Use these exact numbers to answer.\n\n${question}`;
            console.log(`[HISTORICAL] injected data: open=$${h.open} close=$${h.close}`);
          } else {
            questionForAI = `HISTORICAL NOTE: No data available for ${resolvedTicker} on ${date}. Possible reasons: weekend/holiday, stock didn't exist yet (recent IPO), or data not covered. Tell the user this specifically.\n\n${question}`;
            console.log(`[HISTORICAL] no data for ${resolvedTicker} on ${date} (status=${histRes.status})`);
          }
        } catch (histErr) {
          console.warn(`[HISTORICAL] fetch error: ${histErr.message}`);
        }
      }
    }
    console.log(`[HISTORICAL] calling AI with${isHistorical ? ' enriched' : ' original'} message`);

    // Add streaming placeholder bubble
    const streamTs = nowISO();
    const streamingId = Date.now();
    setMessages([...withDisclaimer, { id: streamingId, role: 'assistant', content: '', time: streamTs, isStreaming: true }]);

    try {
      const aiText = await callAI({
        isGeneral: true,
        question: questionForAI,
        history: [userMsg],
        profile: profileRef.current,
        gainers: gainersRef.current,
        losers: losersRef.current,
        volume: volumeRef.current,
        onChunk: (text) => {
          setMessages(prev => prev.map(msg =>
            msg.id === streamingId ? { ...msg, content: text } : msg
          ));
        },
      });
      const aiMsg = { role: 'assistant', content: aiText, time: streamTs };
      const final = [...withDisclaimer, aiMsg];
      setMessages(final);
      await AsyncStorage.setItem(sk, JSON.stringify(final));
      await AsyncStorage.setItem(infoSk, JSON.stringify({ tabName, question, lastTime: aiMsg.time })).catch(() => {});
      await markDisclaimerSeen('general');
    } catch (e) {
      console.error('[CHATSTOX AI] openNewTab failed:', e.message);
      setMessages(prev => prev.map(msg =>
        msg.id === streamingId
          ? { role: 'assistant', content: aiErrorMessage(question), time: nowISO() }
          : msg
      ));
    } finally {
      setThinking(false);
    }
  }, [addGeneralTab]);

  // Keep stable ref current
  useEffect(() => { openNewTabRef.current = openNewTab; }, [openNewTab]);

  // ── Switch to an existing general tab ─────────────────────────────────────

  const switchToTab = useCallback(async (tabId) => {
    if (tabId === currentTabIdRef.current) return;
    currentTabIdRef.current = tabId;
    setCurrentTabId(tabId);
    setThinking(false);
    try {
      const raw = await AsyncStorage.getItem(`chat_general_${tabId}`);
      if (raw) {
        const msgs = JSON.parse(raw);
        // Inject session divider to mark boundary between previous and new messages
        setMessages(msgs.length > 0 ? [...msgs, { role: 'session_divider' }] : []);
      } else {
        setMessages([]);
      }
    } catch {
      setMessages([]);
    }
  }, []);

  // ── Close a general tab ───────────────────────────────────────────────────

  const handleTabClose = useCallback((tabId) => {
    closeTab(tabId);
    const remaining = generalTabs.filter(t => t.id !== tabId);
    if (tabId === currentTabIdRef.current) {
      if (remaining.length > 0) {
        switchToTab(remaining[remaining.length - 1].id);
      } else {
        currentTabIdRef.current = null;
        setCurrentTabId(null);
        setMessages([]);
      }
    }
  }, [closeTab, generalTabs, switchToTab]);

  // ── Send a message in the current tab ────────────────────────────────────

  const sendMessage = useCallback(async (text) => {
    const content = (text || input).trim();
    if (!content || thinking) return;
    setInput('');

    const userMsg = { role: 'user', content, time: nowISO() };
    const updated = [...messages, userMsg];
    setMessages(updated);
    setThinking(true);

    const sk = currentTabIdRef.current
      ? `chat_general_${currentTabIdRef.current}`
      : LEGACY_KEY;

    // Save user message immediately so it persists even if AI call fails
    const updatedToSave = updated.filter(m => m.role !== 'session_divider');
    await AsyncStorage.setItem(sk, JSON.stringify(updatedToSave)).catch(() => {});

    // Detect historical date query and inject OHLCV data
    let questionForAI = content;
    const ticker = extractTicker(content);
    const { isHistorical, date, ticker: histTicker } = detectHistoricalQuery(content, ticker);
    console.log('[HISTORICAL CHECK]', { isHistorical, date, histTicker: histTicker ?? ticker, text: content });
    if (isHistorical && date) {
      const resolvedTicker = histTicker || ticker;
      if (resolvedTicker) {
        try {
          const histUrl = `${BACKEND}/api/historical/${resolvedTicker}/${date}`;
          console.log('[HISTORICAL FETCH]', histUrl);
          const histRes = await fetch(histUrl);
          const h = histRes.ok ? await histRes.json() : null;
          if (h && h.open != null) {
            const volStr = h.volume ? ` | Vol: ${(Number(h.volume) / 1e6).toFixed(1)}M` : '';
            questionForAI = `HISTORICAL DATA for ${resolvedTicker} on ${date}: Open: $${h.open} | High: $${h.high} | Low: $${h.low} | Close: $${h.close}${volStr} — Use these exact numbers to answer.\n\n${content}`;
            console.log(`[HISTORICAL] injected data: open=$${h.open} close=$${h.close}`);
          } else {
            questionForAI = `HISTORICAL NOTE: No data available for ${resolvedTicker} on ${date}. Possible reasons: weekend/holiday, stock didn't exist yet (recent IPO), or data not covered. Tell the user this specifically.\n\n${content}`;
            console.log(`[HISTORICAL] no data for ${resolvedTicker} on ${date} (status=${histRes.status})`);
          }
        } catch (histErr) {
          console.warn(`[HISTORICAL] fetch error: ${histErr.message}`);
        }
      }
    }
    console.log(`[HISTORICAL] calling AI with${isHistorical ? ' enriched' : ' original'} message`);

    // Add streaming placeholder bubble
    const streamTs = nowISO();
    const streamingId = Date.now();
    setMessages([...updated, { id: streamingId, role: 'assistant', content: '', time: streamTs, isStreaming: true }]);

    try {
      const convoHistory = updated.filter(m => m.role === 'user' || m.role === 'assistant');
      const aiText = await callAI({
        isGeneral: true,
        question: questionForAI,
        history: convoHistory.slice(-10),
        profile: profileRef.current,
        gainers: gainersRef.current,
        losers: losersRef.current,
        volume: volumeRef.current,
        onChunk: (text) => {
          setMessages(prev => prev.map(msg =>
            msg.id === streamingId ? { ...msg, content: text } : msg
          ));
        },
      });
      const aiMsg = { role: 'assistant', content: aiText, time: streamTs };
      const finalMessages = [...updated, aiMsg];
      setMessages(finalMessages);
      const finalToSave = finalMessages.filter(m => m.role !== 'session_divider');
      await AsyncStorage.setItem(sk, JSON.stringify(finalToSave));
      if (currentTabIdRef.current) {
        const infoSk = `chat_general_info_${currentTabIdRef.current}`;
        const infoRaw = await AsyncStorage.getItem(infoSk).catch(() => null);
        const info = infoRaw ? JSON.parse(infoRaw) : {};
        await AsyncStorage.setItem(infoSk, JSON.stringify({ ...info, lastTime: aiMsg.time })).catch(() => {});
      }
    } catch (e) {
      console.error('[CHATSTOX AI] GeneralChat sendMessage failed:', e.message);
      setMessages(prev => prev.map(msg =>
        msg.id === streamingId
          ? { role: 'assistant', content: aiErrorMessage(content), time: nowISO() }
          : msg
      ));
    } finally {
      setThinking(false);
    }
  }, [input, messages, thinking]);

  // ── Init: fetch market data ───────────────────────────────────────────────

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      try {
        const [g, l, v, profileRaw] = await Promise.all([
          fetchTopGainers(),
          fetchTopLosers(),
          fetchTopVolume(),
          AsyncStorage.getItem('userProfile'),
        ]);
        gainersRef.current = g; setGainers(g);
        losersRef.current  = l; setLosers(l);
        volumeRef.current  = v; setVolume(v);
        const parsedProfile = profileRaw ? JSON.parse(profileRaw) : null;
        if (parsedProfile) { profileRef.current = parsedProfile; setProfile(parsedProfile); }

        marketReadyRef.current = true;
        setMarketReady(true);
      } catch (e) {
        console.error('GeneralChatScreen init error:', e);
        marketReadyRef.current = true;
        setMarketReady(true);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handle incoming question (initial mount + re-navigation) ─────────────

  useEffect(() => {
    if (!marketReady) return;
    const incoming = route?.params?.question;
    if (!incoming || incoming === processedQRef.current) return;
    processedQRef.current = incoming;
    navigation.setParams({ question: undefined });
    openNewTabRef.current?.(incoming);
  }, [marketReady, route?.params?.question]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handle incoming tabId from sidebar (reopen a specific chat) ───────────

  useEffect(() => {
    if (!marketReady) return;
    const incomingTabId = route?.params?.tabId;
    if (!incomingTabId) return;
    navigation.setParams({ tabId: undefined });
    switchToTab(incomingTabId);
  }, [marketReady, route?.params?.tabId, switchToTab]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── When tabs load and no active tab: restore or generate welcome ─────────

  useEffect(() => {
    if (!tabsLoaded || !marketReady) return;
    if (currentTabIdRef.current) return; // already have an active tab
    if (processedQRef.current) return;   // question is being processed

    const existing = tabs.filter(t => t.type === 'general');
    if (existing.length > 0) {
      // Restore most recent general tab
      const last = existing[existing.length - 1];
      switchToTab(last.id);
    } else {
      // No tabs at all — generate welcome tab
      openNewTabRef.current?.('Give me a brief market overview based on today\'s data.');
    }
  }, [tabsLoaded, marketReady]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (messages.length > 0) scrollToBottom();
  }, [messages]);

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={styles.loadingScreen}>
        <ActivityIndicator size="large" color="#f5a623" />
        <Text style={styles.loadingText}>Loading live market data...</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={80}>

        {/* Gold accent bar */}
        <View style={styles.goldBar} />

        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.navigate('Landing')} style={styles.logoBtn} activeOpacity={0.75}>
            <LogoIcon size={40} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.openDrawer()} style={styles.menuBtn} activeOpacity={0.7}>
            <Text style={styles.menuIcon}>☰</Text>
          </TouchableOpacity>
          <View style={styles.headerInfo}>
            <Text style={styles.headerTitle}>Market Chat</Text>
          </View>
          <Text style={styles.liveBadge}>● LIVE</Text>
        </View>

        {/* Nav pills */}
        <NavPillBar navigation={navigation} active="GeneralChat" />

        {/* General tab bar */}
        <GeneralTabBar
          tabs={generalTabs}
          activeId={currentTabId}
          onTabPress={switchToTab}
          onTabClose={handleTabClose}
        />

        {/* Market Summary Strip */}
        {gainers.length > 0 && (
          <View style={styles.summaryStrip}>
            <Text style={styles.sumGreen}>
              ▲ {gainers[0]?.ticker} +{Number(gainers[0]?.changePercent).toFixed(1)}%
            </Text>
            <View style={styles.summaryDivider} />
            <Text style={styles.sumRed}>
              ▼ {losers[0]?.ticker} {Number(losers[0]?.changePercent).toFixed(1)}%
            </Text>
          </View>
        )}

        {/* Messages */}
        <ScrollView
          ref={scrollRef}
          style={styles.messages}
          contentContainerStyle={styles.messagesContent}
          showsVerticalScrollIndicator={false}
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
          {thinking && !messages[messages.length - 1]?.isStreaming && (
            <View style={styles.thinkingRow}>
              <ActivityIndicator size="small" color="#f5a623" />
              <Text style={styles.thinkingText}>Analyzing market data...</Text>
            </View>
          )}
        </ScrollView>

        {/* Quick Actions */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.quickRow} contentContainerStyle={styles.quickContent}>
          {QUICK_ACTIONS.map(a => (
            <TouchableOpacity key={a.label} style={styles.quickBtn} onPress={() => sendMessage(a.prompt)} disabled={thinking}>
              <Text style={styles.quickBtnText}>{a.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Input */}
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="Ask about the market or type a ticker..."
            placeholderTextColor="#94a3b8"
            multiline
            onSubmitEditing={() => sendMessage()}
            returnKeyType="send"
            blurOnSubmit
          />
          <TouchableOpacity
            style={[styles.sendBtn, (!input.trim() || thinking) && styles.sendBtnDisabled]}
            onPress={() => sendMessage()}
            disabled={!input.trim() || thinking}
          >
            <Text style={styles.sendBtnText}>›</Text>
          </TouchableOpacity>
        </View>

      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: '#f7f8fa' },
  loadingScreen: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f7f8fa', gap: 16 },
  loadingText:   { color: '#64748b', fontSize: 14 },

  // ── Header ──
  goldBar: { height: 2, backgroundColor: '#f5a623' },
  header: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#ffffff',
    paddingHorizontal: 12, height: 52,
    borderBottomWidth: 1, borderBottomColor: '#e8e8e8',
    gap: 8,
  },
  logoBtn:     { flexShrink: 0 },
  menuBtn:     { padding: 4, flexShrink: 0 },
  menuIcon:    { fontSize: 20, color: '#666666' },
  headerInfo:  { flex: 1 },
  headerTitle: { fontSize: 17, fontWeight: '800', color: '#0a1628', letterSpacing: 0.3, textAlign: 'center' },
  liveBadge:   { color: '#22c55e', fontSize: 11, fontWeight: '800', letterSpacing: 0.8, flexShrink: 0 },

  // ── Market Summary Strip ──
  summaryStrip: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#ffffff',
    paddingHorizontal: 16, paddingVertical: 7,
    borderBottomWidth: 1, borderBottomColor: '#f0f0f0',
    gap: 12,
  },
  sumGreen:       { fontSize: 11, fontWeight: '700', color: '#16a34a' },
  sumRed:         { fontSize: 11, fontWeight: '700', color: '#dc2626' },
  summaryDivider: { width: 1, height: 12, backgroundColor: '#e0e0e0' },

  // ── Messages ──
  messages:        { flex: 1, backgroundColor: '#f7f8fa' },
  messagesContent: { padding: 16, paddingBottom: 8, gap: 12 },

  // ── Disclaimer ──
  disclaimerBox: {
    backgroundColor: '#fffbeb', borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: '#fcd34d',
    shadowColor: '#d97706', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1, shadowRadius: 4, elevation: 2,
  },
  disclaimerLabel: { fontSize: 9, fontWeight: '800', color: '#d97706', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 6 },
  disclaimerText:  { fontSize: 13, color: '#78350f', lineHeight: 19, fontWeight: '500' },

  // ── Chat Bubbles ──
  bubbleWrap:  { maxWidth: '85%', gap: 2 },
  bubbleLeft:  { alignSelf: 'flex-start' },
  bubbleRight: { alignSelf: 'flex-end' },
  aiLabel: {
    fontSize: 10, color: '#f5a623', fontWeight: '800',
    letterSpacing: 1.5, marginBottom: 3, textTransform: 'uppercase',
  },
  bubble: { borderRadius: 16, padding: 12 },
  bubbleUser: {
    backgroundColor: '#0a1628', borderBottomRightRadius: 4,
  },
  bubbleAI: {
    backgroundColor: '#ffffff', borderBottomLeftRadius: 4,
    borderLeftWidth: 3, borderLeftColor: '#f5a623',
    shadowColor: '#0a1628', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.07, shadowRadius: 6, elevation: 2,
  },
  bubbleTextUser: { color: '#ffffff', fontSize: 14, lineHeight: 20 },
  timestamp: { fontSize: 9, color: '#94a3b8', marginTop: 2 },

  // ── Thinking / session divider ──
  thinkingRow:    { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8 },
  thinkingText:   { fontSize: 12, color: '#64748b', fontStyle: 'italic' },
  sessionDivider: { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 8 },
  dividerLine:    { flex: 1, height: 1, backgroundColor: '#e2e8f0' },
  dividerText:    { fontSize: 10, color: '#94a3b8', fontWeight: '600', letterSpacing: 0.5 },

  // ── Quick Actions ──
  quickRow:     { maxHeight: 50, backgroundColor: '#ffffff', borderTopWidth: 1, borderTopColor: '#f0f0f0' },
  quickContent: { paddingHorizontal: 14, gap: 8, alignItems: 'center', paddingVertical: 9 },
  quickBtn: {
    backgroundColor: '#ffffff', borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 6,
    borderWidth: 1, borderColor: '#0a1628',
  },
  quickBtnText: { color: '#0a1628', fontSize: 13, fontWeight: '600' },

  // ── Input Bar ──
  inputRow: {
    flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 10, gap: 10,
    backgroundColor: '#ffffff', borderTopWidth: 1, borderTopColor: '#e8e8e8',
    alignItems: 'flex-end',
  },
  input: {
    flex: 1, backgroundColor: '#f7f8fa', borderRadius: 22,
    paddingHorizontal: 16, paddingVertical: 10,
    fontSize: 14, color: '#0a1628', maxHeight: 100,
  },
  sendBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#f5a623',
    justifyContent: 'center', alignItems: 'center',
  },
  sendBtnDisabled: { backgroundColor: '#e0e0e0' },
  sendBtnText: { fontSize: 26, color: '#ffffff', fontWeight: '700', lineHeight: 30, marginTop: -1 },
});
