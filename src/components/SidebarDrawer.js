import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, SafeAreaView, Alert,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { LogoIcon } from './ChatstoxLogo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DrawerContentScrollView } from '@react-navigation/drawer';
import { useAuth } from '../context/AuthContext';

// ── SVG nav icons ─────────────────────────────────────────────────────────────

function GridIcon({ size = 16, color = '#374151' }) {
  const s = Math.floor(size / 2) - 1;
  return (
    <View style={{ width: size, height: size, flexDirection: 'row', flexWrap: 'wrap', gap: 2 }}>
      {[0, 1, 2, 3].map(i => (
        <View key={i} style={{ width: s, height: s, backgroundColor: color, borderRadius: 1.5 }} />
      ))}
    </View>
  );
}

function ChatIcon({ size = 16, color = '#374151' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2v10z"
        stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
      />
    </Svg>
  );
}

function GearIcon({ size = 16, color = '#374151' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 15a3 3 0 100-6 3 3 0 000 6z"
        stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
      />
      <Path
        d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"
        stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
      />
    </Svg>
  );
}

// ── Timestamp formatter ────────────────────────────────────────────────────────

function formatSidebarTime(timeStr) {
  if (!timeStr) return '';
  const d = new Date(timeStr);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth()    === now.getMonth()    &&
    d.getDate()     === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// ── Profile / trader metadata ─────────────────────────────────────────────────

const TRADER_LABELS = {
  day: 'Day Trader',
  swing: 'Swing Trader',
  longterm: 'Long-term Investor',
  options: 'Options Trader',
};

const RISK_LABELS = {
  conservative: 'Conservative',
  moderate: 'Moderate',
  aggressive: 'Aggressive',
  very_aggressive: 'Very Aggressive',
};

const RISK_BADGE = {
  conservative: { bg: '#dcfce7', text: '#166534' },
  moderate:     { bg: '#fef3c7', text: '#92400e' },
  aggressive:   { bg: '#fee2e2', text: '#991b1b' },
  very_aggressive: { bg: '#fecaca', text: '#7f1d1d' },
};

const SECTOR_LABELS = {
  tech: 'Technology', healthcare: 'Healthcare',
  energy: 'Energy', finance: 'Finance',
  all: 'All Sectors',
};

// ── Ticker avatar palette (soft muted) ────────────────────────────────────────

const SOFT_PALETTES = [
  { bg: '#fee2e2', text: '#991b1b' },  // rose
  { bg: '#dcfce7', text: '#166534' },  // mint
  { bg: '#dbeafe', text: '#1e40af' },  // blue
  { bg: '#ede9fe', text: '#5b21b6' },  // purple
  { bg: '#fef3c7', text: '#92400e' },  // amber
];

function tickerPalette(ticker = '') {
  let hash = 0;
  for (let i = 0; i < ticker.length; i++) hash = ticker.charCodeAt(i) + ((hash << 5) - hash);
  return SOFT_PALETTES[Math.abs(hash) % SOFT_PALETTES.length];
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function SidebarDrawer(props) {
  const { user } = useAuth();
  const [profile, setProfile] = useState(null);
  const [chatItems, setChatItems] = useState([]);

  const load = async () => {
    try {
      const profileRaw = await AsyncStorage.getItem('userProfile');
      if (profileRaw) setProfile(JSON.parse(profileRaw));

      const keys = await AsyncStorage.getAllKeys();

      const stockKeys = keys.filter(k =>
        k.startsWith('chat_') &&
        !k.startsWith('chat_general_') &&
        !k.startsWith('chat_info_') &&
        k !== 'chat_general_market'
      );

      const generalKeys = keys.filter(k =>
        k.startsWith('chat_general_') &&
        !k.startsWith('chat_general_info_') &&
        k !== 'chat_general_market'
      );

      const stockItems = await Promise.all(
        stockKeys.map(async (key) => {
          const ticker = key.replace('chat_', '');
          const [infoRaw, msgsRaw] = await Promise.all([
            AsyncStorage.getItem(`chat_info_${ticker}`),
            AsyncStorage.getItem(key),
          ]);
          const info = infoRaw ? JSON.parse(infoRaw) : {};
          const messages = msgsRaw ? JSON.parse(msgsRaw) : [];
          const lastMsg = [...messages].reverse().find(m => m.role === 'user' || m.role === 'assistant');
          return {
            type: 'stock',
            id: ticker,
            ticker,
            name: info.name || ticker,
            lastTime: info.lastTime || lastMsg?.time || '',
          };
        })
      );

      const generalItems = await Promise.all(
        generalKeys.map(async (key) => {
          const tabId = key.replace('chat_general_', '');
          const [infoRaw, msgsRaw] = await Promise.all([
            AsyncStorage.getItem(`chat_general_info_${tabId}`),
            AsyncStorage.getItem(key),
          ]);
          const info = infoRaw ? JSON.parse(infoRaw) : {};
          const messages = msgsRaw ? JSON.parse(msgsRaw) : [];
          const lastMsg = [...messages].reverse().find(m => m.role === 'user' || m.role === 'assistant');
          return {
            type: 'general',
            id: tabId,
            tabName: info.tabName || 'Market Chat',
            lastTime: info.lastTime || lastMsg?.time || '',
          };
        })
      );

      const all = [...stockItems, ...generalItems]
        .sort((a, b) => (b.lastTime || '').localeCompare(a.lastTime || ''));
      setChatItems(all);
    } catch (e) {
      console.error('SidebarDrawer load error:', e);
    }
  };

  useEffect(() => {
    load();
    const unsub = props.navigation.addListener('focus', load);
    return unsub;
  }, [props.navigation]);

  const close = () => props.navigation.closeDrawer();
  const openHome     = () => { close(); props.navigation.navigate('Home'); };
  const openGeneral  = () => { close(); props.navigation.navigate('GeneralChat'); };
  const openSettings = () => { close(); props.navigation.navigate('Settings'); };

  const openItem = (item) => {
    close();
    if (item.type === 'stock') {
      props.navigation.navigate('StockChat', { ticker: item.ticker });
    } else {
      props.navigation.navigate('GeneralChat', { tabId: item.id });
    }
  };

  const deleteItem = (item) => {
    const label = item.type === 'stock' ? item.ticker : item.tabName;
    Alert.alert(
      'Clear Chat',
      `Delete all history for "${label}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            if (item.type === 'stock') {
              await Promise.all([
                AsyncStorage.removeItem(`chat_${item.ticker}`),
                AsyncStorage.removeItem(`chat_info_${item.ticker}`),
              ]);
            } else {
              await Promise.all([
                AsyncStorage.removeItem(`chat_general_${item.id}`),
                AsyncStorage.removeItem(`chat_general_info_${item.id}`),
              ]);
            }
            setChatItems(prev => prev.filter(i => i.id !== item.id));
          },
        },
      ]
    );
  };

  const traderLabel = TRADER_LABELS[profile?.traderType] || profile?.traderType || 'Trader';
  const riskLabel   = RISK_LABELS[profile?.riskTolerance] || '';
  const riskBadge   = RISK_BADGE[profile?.riskTolerance] || { bg: '#f1f5f9', text: '#64748b' };
  const sectorLabel = SECTOR_LABELS[profile?.sectors] || profile?.sectors || '';
  const initials    = traderLabel.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

  const visibleChats = chatItems.slice(0, 10);
  const hasMore      = chatItems.length > 6;

  return (
    <DrawerContentScrollView {...props} contentContainerStyle={styles.container}>
      <SafeAreaView style={{ flex: 1 }}>

        {/* ── Gold accent stripe at very top ── */}
        <View style={styles.goldStripe} />

        {/* ── Brand ── */}
        <View style={styles.brand}>
          <LogoIcon size={40} />
          <Text style={styles.brandText}>ChatStox</Text>
        </View>

        {/* ── Navigation ── */}
        <View style={styles.navSection}>
          <TouchableOpacity style={[styles.navItem, styles.navItemActive]} onPress={openGeneral} activeOpacity={0.7}>
            <View style={styles.navActiveBar} />
            <ChatIcon size={16} color="#b45309" />
            <Text style={[styles.navLabel, styles.navLabelActive]}>Market Chat</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.navItem} onPress={openHome} activeOpacity={0.7}>
            <GridIcon size={16} color="#6b7280" />
            <Text style={styles.navLabel}>Pipeline</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.navItem} onPress={openSettings} activeOpacity={0.7}>
            <GearIcon size={16} color="#6b7280" />
            <Text style={styles.navLabel}>Settings</Text>
            {user && (
              <View style={styles.navAvatarDot}>
                <Text style={styles.navAvatarDotText}>
                  {`${user.firstName?.[0] || ''}`.toUpperCase() || '·'}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.sectionDivider} />

        {/* Spacer — pushes profile card to bottom */}
        <View style={{ flex: 1, minHeight: 16 }} />

        {/* ── Profile card — floating at bottom ── */}
        {profile && (
          <View style={styles.profileCard}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initials}</Text>
            </View>

            <View style={styles.profileRight}>
              <Text style={styles.profileName}>{traderLabel}</Text>
              <View style={styles.badgeRow}>
                {riskLabel ? (
                  <View style={[styles.softBadge, { backgroundColor: riskBadge.bg }]}>
                    <Text style={[styles.softBadgeText, { color: riskBadge.text }]}>{riskLabel}</Text>
                  </View>
                ) : null}
                {sectorLabel ? (
                  <View style={styles.navyBadge}>
                    <Text style={styles.navyBadgeText}>{sectorLabel}</Text>
                  </View>
                ) : null}
                <View style={styles.navyBadge}>
                  <Text style={styles.navyBadgeText}>{traderLabel}</Text>
                </View>
              </View>
            </View>
          </View>
        )}

      </SafeAreaView>
    </DrawerContentScrollView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },

  goldStripe: { height: 2, backgroundColor: '#f5a623' },

  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 10,
  },
  brandText: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0a1628',
    letterSpacing: -0.3,
  },


  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 12,
    marginRight: 12,
    marginBottom: 12,
    padding: 16,
    gap: 11,
    backgroundColor: '#0a1628',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(245,167,35,0.3)',
  },
  // 44px circle: subtle gold-tinted bg + gold ring border
  avatar: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(245,166,35,0.15)',
    borderWidth: 2, borderColor: '#f5a623',
    justifyContent: 'center', alignItems: 'center', flexShrink: 0,
  },
  avatarText: { fontSize: 14, fontWeight: '900', color: '#f5a623' },

  profileRight: { flex: 1, gap: 5 },
  profileName:  { fontSize: 13, fontWeight: '700', color: '#fff' },
  badgeRow:     { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },

  // Soft colored badge (risk)
  softBadge: {
    paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10,
  },
  softBadgeText: { fontSize: 9, fontWeight: '700' },

  // Navy-tinted badge (sector / type)
  navyBadge: {
    paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  navyBadgeText: { fontSize: 9, fontWeight: '600', color: 'rgba(255,255,255,0.75)' },

  // ── Navigation
  navSection: { paddingHorizontal: 10, paddingTop: 8, paddingBottom: 2 },
  navItem: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 10,
    borderRadius: 10, gap: 9, marginBottom: 2,
    position: 'relative',
  },
  navItemActive: {
    backgroundColor: '#fffdf5',
  },
  navLabel: { fontSize: 14, fontWeight: '500', color: '#374151', flex: 1 },
  navLabelActive: { color: '#b45309', fontWeight: '600' },
  navAvatarDot: {
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: '#1a3a5c',
    justifyContent: 'center', alignItems: 'center',
  },
  navAvatarDotText: { fontSize: 10, color: '#fff', fontWeight: '700' },
  navActiveBar: {
    position: 'absolute', left: 0, top: 8, bottom: 8,
    width: 3, borderRadius: 2, backgroundColor: '#f5a623',
  },

  sectionDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#e8e8e8',
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 6,
  },

  // ── Recent chats
  sectionTitle: {
    fontSize: 10, fontWeight: '800', color: '#94a3b8',
    letterSpacing: 1.5, paddingHorizontal: 20, paddingBottom: 4,
    marginTop: 6, marginBottom: 2,
    textTransform: 'uppercase',
  },
  emptyBox: { paddingHorizontal: 20, paddingVertical: 14, alignItems: 'center', gap: 4 },
  emptyIcon: { fontSize: 26, marginBottom: 4 },
  emptyText: { fontSize: 13, fontWeight: '600', color: '#64748b' },
  emptyHint: { fontSize: 11, color: '#94a3b8', textAlign: 'center', lineHeight: 16 },

  chatList: { flexGrow: 0 },

  // Row: ~44px max so 10 fit without scrolling
  chatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 8,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 8,
    gap: 8,
    maxHeight: 44,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f0f0f0',
  },

  // 32px circle, soft palette
  tickerBadge: {
    width: 32, height: 32, borderRadius: 16,
    justifyContent: 'center', alignItems: 'center', flexShrink: 0,
  },
  tickerBadgeText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.2 },

  chatMeta: { flex: 1, minWidth: 0 },
  chatTicker: { fontSize: 12, fontWeight: '700', color: '#0a1628' },
  chatName:   { fontSize: 10, color: '#94a3b8', marginTop: 1 },

  chatRight: { flexDirection: 'column', alignItems: 'flex-end', gap: 2, flexShrink: 0 },
  chatTime: { fontSize: 10, color: '#94a3b8' },
  deleteBtnText: { fontSize: 14, color: '#d1d5db', fontWeight: '300', lineHeight: 16 },

  viewAllRow: {
    paddingTop: 14,
    paddingBottom: 10,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  viewAllText: { fontSize: 12, color: '#f5a623', fontWeight: '600' },

});
