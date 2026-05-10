import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Switch, SafeAreaView, Alert, useWindowDimensions,
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import { LogoIcon } from '../components/ChatstoxLogo';

// ── Section wrapper ───────────────────────────────────────────────────────────
function Section({ title, children }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionCard}>{children}</View>
    </View>
  );
}

// ── Row types ─────────────────────────────────────────────────────────────────
function SettingRow({ label, value, onPress, showArrow = true, textColor, last }) {
  return (
    <TouchableOpacity
      style={[styles.row, last && styles.rowLast]}
      onPress={onPress}
      disabled={!onPress}
      activeOpacity={onPress ? 0.7 : 1}
    >
      <Text style={[styles.rowLabel, textColor && { color: textColor }]}>{label}</Text>
      <View style={styles.rowRight}>
        {value ? <Text style={styles.rowValue}>{value}</Text> : null}
        {showArrow && onPress ? <Text style={styles.rowArrow}>›</Text> : null}
      </View>
    </TouchableOpacity>
  );
}

function ToggleRow({ label, value, onToggle, last }) {
  return (
    <View style={[styles.row, last && styles.rowLast]}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onToggle}
        trackColor={{ false: '#d8e2ec', true: '#1a3a5c' }}
        thumbColor="#fff"
      />
    </View>
  );
}

// ── Avatar initials ───────────────────────────────────────────────────────────
function Avatar({ user, size = 52 }) {
  const initials = user
    ? `${user.firstName?.[0] || ''}${user.lastName?.[0] || ''}`.toUpperCase() || user.email?.[0]?.toUpperCase() || '?'
    : '?';
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[styles.avatarText, { fontSize: size * 0.38 }]}>{initials}</Text>
    </View>
  );
}

// ── Trader type labels ────────────────────────────────────────────────────────
const TRADER_LABELS = {
  day_trader:   'Day Trader',
  swing_trader: 'Swing Trader',
  investor:     'Investor',
  options:      'Options Trader',
  beginner:     'Learning',
};

// ── Main ──────────────────────────────────────────────────────────────────────
export default function SettingsScreen({ navigation }) {
  const { user, signOut } = useAuth();
  const { width } = useWindowDimensions();
  const isWide = width >= 700;

  const [notifMarket, setNotifMarket] = useState(false);
  const [notifNews, setNotifNews]     = useState(true);
  const [compactMode, setCompactMode] = useState(false);
  const [darkMode, setDarkMode]       = useState(false);

  const handleSignOut = () => {
    Alert.alert(
      'Sign out',
      'Are you sure you want to sign out?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign out',
          style: 'destructive',
          onPress: async () => {
            await signOut();
            navigation.navigate('Landing');
          },
        },
      ]
    );
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete account',
      'This will permanently delete your account and all chat history. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await signOut();
            navigation.navigate('Landing');
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.root}>
      {/* Navbar */}
      <View style={styles.navbar}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>‹ Back</Text>
        </TouchableOpacity>
        <View style={styles.navBrand}>
          <LogoIcon size={28} />
          <Text style={styles.navTitle}>Settings</Text>
        </View>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, isWide && { maxWidth: 680, alignSelf: 'center', width: '100%' }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Account header */}
        <View style={styles.accountHeader}>
          <Avatar user={user} size={60} />
          <View style={styles.accountInfo}>
            {user ? (
              <>
                <Text style={styles.accountName}>
                  {[user.firstName, user.lastName].filter(Boolean).join(' ') || 'ChatStox User'}
                </Text>
                <Text style={styles.accountEmail}>{user.email}</Text>
                <View style={styles.traderBadge}>
                  <Text style={styles.traderBadgeText}>
                    {TRADER_LABELS[user.traderType] || 'Trader'}
                  </Text>
                </View>
              </>
            ) : (
              <>
                <Text style={styles.accountName}>Guest</Text>
                <Text style={styles.accountEmail}>Not signed in</Text>
              </>
            )}
          </View>
        </View>

        {/* Account */}
        <Section title="Account">
          {user ? (
            <>
              <SettingRow label="Email" value={user.email} showArrow={false} />
              <SettingRow label="Edit profile" onPress={() => navigation.navigate('Auth', { initialState: 'profile_setup' })} />
              <SettingRow label="Sign out" onPress={handleSignOut} textColor="#e53935" last />
            </>
          ) : (
            <SettingRow label="Sign in / Create account" onPress={() => navigation.navigate('Auth')} last />
          )}
        </Section>

        {/* Subscription */}
        <Section title="Subscription">
          <SettingRow label="Current plan" value="Free" showArrow={false} />
          <SettingRow label="Upgrade to Pro" onPress={() => {}} last />
        </Section>

        {/* Trader Profile */}
        <Section title="Trader Profile">
          <SettingRow
            label="Trader type"
            value={TRADER_LABELS[user?.traderType] || '—'}
            onPress={() => navigation.navigate('Auth', { initialState: 'profile_setup' })}
          />
          <SettingRow label="Watchlist" value="Coming soon" showArrow={false} last />
        </Section>

        {/* Preferences */}
        <Section title="Preferences">
          <ToggleRow label="Market open/close alerts" value={notifMarket} onToggle={setNotifMarket} />
          <ToggleRow label="Breaking news alerts" value={notifNews} onToggle={setNotifNews} />
          <ToggleRow label="Compact chat view" value={compactMode} onToggle={setCompactMode} />
          <ToggleRow label="Dark mode (coming soon)" value={darkMode} onToggle={setDarkMode} last />
        </Section>

        {/* Data & Privacy */}
        <Section title="Data & Privacy">
          <SettingRow label="Clear chat history" onPress={() => Alert.alert('Clear history', 'This will delete all saved chats.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Clear', style: 'destructive', onPress: () => {} }])} />
          <SettingRow label="Export my data" onPress={() => Alert.alert('Export data', 'Your data export will be emailed to you.')} />
          <SettingRow label="Privacy policy" onPress={() => {}} last />
        </Section>

        {/* Danger zone */}
        {user ? (
          <Section title="Danger Zone">
            <SettingRow
              label="Delete account"
              onPress={handleDeleteAccount}
              textColor="#e53935"
              last
            />
          </Section>
        ) : null}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#f0f4f8',
  },
  navbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e8edf2',
  },
  backBtn: {
    width: 60,
  },
  backText: {
    color: '#1a3a5c',
    fontSize: 16,
    fontWeight: '500',
  },
  navBrand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  navTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0a1628',
  },
  scroll: {
    paddingHorizontal: 16,
    paddingTop: 20,
  },
  accountHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    marginBottom: 24,
    shadowColor: '#0a1628',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  avatar: {
    backgroundColor: '#1a3a5c',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: '#fff',
    fontWeight: '700',
  },
  accountInfo: {
    flex: 1,
    gap: 4,
  },
  accountName: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0a1628',
  },
  accountEmail: {
    fontSize: 13,
    color: '#5a7a9a',
  },
  traderBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#eef3f8',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 3,
    marginTop: 4,
  },
  traderBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#1a3a5c',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#8a9bb5',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
    paddingLeft: 4,
  },
  sectionCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    overflow: 'hidden',
    shadowColor: '#0a1628',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f4f8',
  },
  rowLast: {
    borderBottomWidth: 0,
  },
  rowLabel: {
    fontSize: 15,
    color: '#0a1628',
    flex: 1,
  },
  rowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  rowValue: {
    fontSize: 14,
    color: '#8a9bb5',
  },
  rowArrow: {
    fontSize: 20,
    color: '#c0cdd8',
    lineHeight: 22,
  },
});
