import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ScrollView, SafeAreaView, useWindowDimensions, Platform,
} from 'react-native';
// ScrollView kept for the outer page scroll
import { LogoIcon } from '../components/ChatstoxLogo';
import { extractTicker, isTickerSearch } from '../utils/tickerExtractor';
import { useAuth } from '../context/AuthContext';
import NavButtons from '../components/NavButtons';

// ── Grid icon (2×2 squares) ───────────────────────────────────────────────────

function GridIcon({ size = 14, color = '#ffffff' }) {
  const s = size / 2 - 1;
  return (
    <View style={{ width: size, height: size, flexDirection: 'row', flexWrap: 'wrap', gap: 1.5 }}>
      {[0, 1, 2, 3].map(i => (
        <View key={i} style={{ width: s, height: s, backgroundColor: color, borderRadius: 1.5 }} />
      ))}
    </View>
  );
}

// ── Feature card ──────────────────────────────────────────────────────────────

function FeatureCard({ icon, title, description }) {
  return (
    <View style={cardStyles.card}>
      <Text style={cardStyles.icon}>{icon}</Text>
      <Text style={cardStyles.title}>{title}</Text>
      <Text style={cardStyles.desc}>{description}</Text>
    </View>
  );
}

const cardStyles = StyleSheet.create({
  card: {
    width: 180,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 20,
    borderWidth: 1,
    borderColor: '#e8edf2',
    alignItems: 'flex-start',
    shadowColor: '#0a1628',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  icon:  { fontSize: 22, marginBottom: 10 },
  title: { fontSize: 14, fontWeight: '700', color: '#0a1628', marginBottom: 4 },
  desc:  { fontSize: 12, color: '#64748b', lineHeight: 17 },
});

// ── Chips ─────────────────────────────────────────────────────────────────────

const CHIPS = [
  "What stocks have momentum right now?",
  "What's the market sentiment today?",
  "Any short squeeze plays?",
  "What's the VIX saying?",
  "Best risk/reward setups today?",
  "Any unusual volume activity?",
  "What to watch at market open?",
  "Give me a market overview",
];

// ── Hamburger icon ────────────────────────────────────────────────────────────

function HamburgerIcon() {
  return (
    <View style={{ gap: 4 }}>
      {[0, 1, 2].map(i => (
        <View key={i} style={{ width: 18, height: 2, backgroundColor: '#0a1628', borderRadius: 1 }} />
      ))}
    </View>
  );
}

// ── LandingScreen ─────────────────────────────────────────────────────────────

export default function LandingScreen({ navigation }) {
  const [query, setQuery] = useState('');
  const { width } = useWindowDimensions();
  const { user } = useAuth();

  const isWide = width >= 700;

  const handleSearch = () => {
    const raw = query.trim();
    if (!raw) return;
    if (isTickerSearch(raw)) {
      const ticker = extractTicker(raw) || raw.toUpperCase();
      navigation.navigate('StockChat', { ticker, question: raw });
    } else {
      navigation.navigate('GeneralChat', { question: raw });
    }
    setQuery('');
  };

  const handleChip = (question) => {
    navigation.navigate('GeneralChat', { question });
  };

  return (
    <SafeAreaView style={styles.safe}>

      {/* ── Navbar ─────────────────────────────────────────────────────────── */}
      <View style={styles.navbar}>
        <View style={styles.navLeft}>
          <TouchableOpacity
            onPress={() => navigation.openDrawer()}
            style={styles.menuBtn}
            activeOpacity={0.7}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <HamburgerIcon />
          </TouchableOpacity>
          <LogoIcon size={38} />
          <Text style={styles.navBrand}>ChatStox</Text>
        </View>
        <View style={styles.navRight}>
          <NavButtons currentScreen={null} navigation={navigation} />
          <TouchableOpacity
            style={styles.signInBtn}
            onPress={() => navigation.navigate(user ? 'Settings' : 'Auth')}
            activeOpacity={0.8}
          >
            {user ? (
              <View style={styles.avatarCircle}>
                <Text style={styles.avatarInitials}>
                  {`${user.firstName?.[0] || ''}${user.lastName?.[0] || ''}`.toUpperCase() || user.email?.[0]?.toUpperCase() || '?'}
                </Text>
              </View>
            ) : (
              <Text style={styles.signInText}>Sign In</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Main content ───────────────────────────────────────────────────── */}
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >

        {/* Hero */}
        <View style={styles.hero}>
          <Text style={[styles.heroTitle, isWide && styles.heroTitleWide]}>
            What's on your mind{'\n'}
            <Text style={styles.heroGold}>today?</Text>
          </Text>
          <Text style={styles.heroSub}>
            AI-powered stock market intelligence. Ask anything.
          </Text>
        </View>

        {/* Search bar */}
        <View style={[styles.searchWrap, isWide && styles.searchWrapWide]}>
          <View style={styles.searchBar}>
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="Ask about the market or search a ticker..."
              placeholderTextColor="#94a3b8"
              onSubmitEditing={handleSearch}
              returnKeyType="search"
              autoCorrect={false}
              autoCapitalize="none"
            />
            <TouchableOpacity
              style={[styles.searchBtn, !query.trim() && styles.searchBtnDim]}
              onPress={handleSearch}
              disabled={!query.trim()}
              activeOpacity={0.8}
            >
              <Text style={styles.searchBtnText}>›</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Quick chips — wrapping rows, centered */}
        <View style={[styles.chipsWrap, isWide && styles.chipsWrapWide]}>
          {CHIPS.map((q) => (
            <TouchableOpacity
              key={q}
              style={styles.chip}
              onPress={() => handleChip(q)}
              activeOpacity={0.7}
            >
              <Text style={styles.chipText}>{q}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Feature cards */}
        <View style={styles.cardsRow}>
          <FeatureCard
            icon="📊"
            title="Real-Time Data"
            description="Live prices, volume & market data"
          />
          <FeatureCard
            icon="🤖"
            title="AI Analysis"
            description="Powered by advanced AI models"
          />
          <FeatureCard
            icon="⚡"
            title="Instant Alerts"
            description="Never miss a market move"
          />
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#ffffff',
  },

  // Navbar
  navbar: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 16,
    paddingRight: 20,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  navLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  menuBtn: {
    padding: 4,
  },
  navBrand: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0a1628',
    letterSpacing: -0.3,
  },
  navRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  signInBtn: {
    borderRadius: 20,
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderWidth: 1.5,
    borderColor: '#0a1628',
    justifyContent: 'center',
    alignItems: 'center',
  },
  signInText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0a1628',
  },
  avatarCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#f5a623',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarInitials: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0a1628',
  },
  pipelineBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: '#0a1628',
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: 'rgba(245,167,35,0.4)',
  },
  pipelineBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#ffffff',
    letterSpacing: 0.2,
  },

  // Scroll content
  scroll: {
    flexGrow: 1,
    alignItems: 'center',
    paddingBottom: 60,
  },

  // Hero
  hero: {
    alignItems: 'center',
    marginTop: Platform.OS === 'web' ? '15vh' : 80,
    paddingHorizontal: 24,
  },
  heroTitle: {
    fontSize: 36,
    fontWeight: '800',
    color: '#1e293b',
    textAlign: 'center',
    lineHeight: 46,
    letterSpacing: -0.5,
  },
  heroTitleWide: {
    fontSize: 44,
    lineHeight: 56,
  },
  heroGold: {
    color: '#f5a623',
  },
  heroSub: {
    fontSize: 16,
    color: '#64748b',
    textAlign: 'center',
    marginTop: 14,
    lineHeight: 24,
  },

  // Search bar
  searchWrap: {
    width: '100%',
    paddingHorizontal: 24,
    marginTop: 32,
    alignItems: 'center',
  },
  searchWrapWide: {
    maxWidth: 680 + 48,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 50,
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    paddingLeft: 20,
    paddingRight: 6,
    paddingVertical: 6,
    width: '100%',
    maxWidth: 680,
    shadowColor: '#0a1628',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 24,
    elevation: 4,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: '#0a1628',
    paddingVertical: 8,
    outlineStyle: 'none',
  },
  searchBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#f5a623',
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchBtnDim: {
    backgroundColor: '#e2e8f0',
  },
  searchBtnText: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '400',
    lineHeight: 26,
    marginLeft: 2,
  },

  // Chips — wrapping centered rows
  chipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginTop: 20,
    paddingHorizontal: 24,
    width: '100%',
  },
  chipsWrapWide: {
    maxWidth: 728,
  },
  chip: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#0a1628',
  },
  chipText: {
    fontSize: 12,
    color: '#0a1628',
    fontWeight: '500',
  },

  // Feature cards
  cardsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    marginTop: 64,
    paddingHorizontal: 24,
    justifyContent: 'center',
  },
});
