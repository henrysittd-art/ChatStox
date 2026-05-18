import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  SafeAreaView, KeyboardAvoidingView, Platform, Animated,
  useWindowDimensions, ActivityIndicator, ScrollView,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../services/supabase';
import { LogoIcon } from '../components/ChatstoxLogo';

const GREEN  = '#00C853';
const DARK   = '#1a1a1a';
const MID    = '#4b5563';
const SUBTLE = '#9ca3af';
const BG     = '#ffffff';
const FIELD  = '#f3f4f6';
const BORDER = '#e5e7eb';

// ── Google G icon ─────────────────────────────────────────────────────────────
function GoogleIcon({ size = 20 }) {
  return (
    <View style={{
      width: size, height: size, borderRadius: size / 2,
      backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center',
      borderWidth: 1, borderColor: '#dadce0',
    }}>
      <Text style={{ fontSize: size * 0.62, fontWeight: '700', color: '#4285F4', fontFamily: 'Georgia' }}>G</Text>
    </View>
  );
}

// ── Animated checkmark ────────────────────────────────────────────────────────
function Checkmark() {
  const scale = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(scale, { toValue: 1, friction: 5, tension: 100, useNativeDriver: true }).start();
  }, []);
  return (
    <Animated.View style={[styles.checkCircle, { transform: [{ scale }] }]}>
      <Text style={styles.checkMark}>✓</Text>
    </Animated.View>
  );
}

// ── OTP digit boxes ───────────────────────────────────────────────────────────
function OTPInput({ length = 6, value, onChange }) {
  const inputs = useRef([]);
  const handleChange = (text, idx) => {
    const digit = text.replace(/\D/g, '').slice(-1);
    const arr = value.split('');
    arr[idx] = digit;
    const next = arr.join('');
    onChange(next);
    if (digit && idx < length - 1) inputs.current[idx + 1]?.focus();
  };
  const handleKeyPress = (e, idx) => {
    if (e.nativeEvent.key === 'Backspace' && !value[idx] && idx > 0) {
      inputs.current[idx - 1]?.focus();
      const arr = value.split('');
      arr[idx - 1] = '';
      onChange(arr.join(''));
    }
  };
  return (
    <View style={styles.otpRow}>
      {Array.from({ length }).map((_, i) => (
        <TextInput
          key={i}
          ref={r => { inputs.current[i] = r; }}
          style={[styles.otpBox, value[i] ? styles.otpBoxFilled : null]}
          value={value[i] || ''}
          onChangeText={t => handleChange(t, i)}
          onKeyPress={e => handleKeyPress(e, i)}
          keyboardType="number-pad"
          maxLength={1}
          textAlign="center"
          selectTextOnFocus
        />
      ))}
    </View>
  );
}

// ── Main AuthScreen ───────────────────────────────────────────────────────────
export default function AuthScreen({ navigation }) {
  const { width } = useWindowDimensions();
  const isWide = width >= 600;
  const cardWidth = isWide ? 420 : '100%';

  const [tab, setTab]               = useState('signin');
  const [screen, setScreen]         = useState('main');   // 'main' | 'otp' | 'profile' | 'complete'
  const [email, setEmail]           = useState('');
  const [otp, setOtp]               = useState('');
  const [firstName, setFirstName]   = useState('');
  const [lastName, setLastName]     = useState('');
  const [traderType, setTraderType] = useState('');
  const [error, setError]           = useState('');
  const [loading, setLoading]       = useState(false);
  const [resendTimer, setResendTimer] = useState(0);

  // Countdown for resend button
  useEffect(() => {
    if (resendTimer <= 0) return;
    const id = setTimeout(() => setResendTimer(t => t - 1), 1000);
    return () => clearTimeout(id);
  }, [resendTimer]);

  // Auto-submit when all 6 digits filled
  useEffect(() => {
    if (otp.length === 6 && screen === 'otp') handleVerify();
  }, [otp]);

  // Navigate to Main after completion
  useEffect(() => {
    if (screen === 'complete') {
      const t = setTimeout(() => navigation.replace('Main'), 2000);
      return () => clearTimeout(t);
    }
  }, [screen]);

  const handleSendOtp = async () => {
    setError('');
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return setError('Please enter a valid email address.');
    }
    setLoading(true);
    try {
      const { error: e } = await supabase.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: true,
          emailRedirectTo: undefined, // forces OTP code, not magic link
        },
      });
      if (e) throw e;
      setResendTimer(60);
      setScreen('otp');
    } catch (e) {
      setError(e.message || 'Failed to send code. Try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    setError('');
    setLoading(true);
    try {
      const { data, error: e } = await supabase.auth.verifyOtp({
        email,
        token: otp,
        type: 'email',
      });
      if (e) throw e;
      const meta = data?.user?.user_metadata || {};
      if (!meta.firstName) {
        setScreen('profile');
      } else {
        await AsyncStorage.setItem('userProfile', JSON.stringify({ traderType: meta.traderType || 'general' }));
        setScreen('complete');
      }
    } catch (e) {
      setError(e.message || 'Invalid code. Try again.');
      setOtp('');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveProfile = async () => {
    setError('');
    if (!firstName.trim()) return setError('Please enter your first name.');
    if (!traderType) return setError('Please select your trader type.');
    setLoading(true);
    try {
      const { error: e } = await supabase.auth.updateUser({
        data: { firstName: firstName.trim(), lastName: lastName.trim(), traderType },
      });
      if (e) throw e;
      await AsyncStorage.setItem('userProfile', JSON.stringify({ traderType }));
      setScreen('complete');
    } catch (e) {
      setError(e.message || 'Failed to save profile.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setError('');
    try {
      const redirectTo = typeof window !== 'undefined' ? window.location.origin : undefined;
      const { error: e } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo },
      });
      if (e) throw e;
    } catch (e) {
      setError(e.message || 'Google sign-in failed. Use email instead.');
    }
  };

  // ── Main screen ──────────────────────────────────────────────────────────
  if (screen === 'main') {
    return (
      <SafeAreaView style={styles.root}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            <View style={[styles.card, { width: cardWidth }]}>

              <View style={styles.logoRow}>
                <LogoIcon size={42} />
                <Text style={styles.brand}>ChatStox</Text>
              </View>

              {/* Sign In / Sign Up tabs */}
              <View style={styles.tabs}>
                {[
                  { key: 'signin', label: 'Sign In' },
                  { key: 'signup', label: 'Sign Up' },
                ].map(t => (
                  <TouchableOpacity
                    key={t.key}
                    style={[styles.tab, tab === t.key && styles.tabActive]}
                    onPress={() => { setTab(t.key); setError(''); }}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.tabText, tab === t.key && styles.tabTextActive]}>
                      {t.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.title}>
                {tab === 'signin' ? 'Welcome back' : 'Create your account'}
              </Text>
              <Text style={styles.subtitle}>
                {tab === 'signin'
                  ? 'Sign in to access your personalized market analysis.'
                  : 'Join ChatStox for AI-powered trading insights.'}
              </Text>

              <TouchableOpacity style={styles.googleBtn} onPress={handleGoogle} activeOpacity={0.85}>
                <GoogleIcon size={20} />
                <Text style={styles.googleBtnText}>Continue with Google</Text>
              </TouchableOpacity>

              <View style={styles.dividerRow}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>or</Text>
                <View style={styles.dividerLine} />
              </View>

              <TextInput
                style={styles.input}
                placeholder="Email address"
                placeholderTextColor={SUBTLE}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                value={email}
                onChangeText={t => { setEmail(t); setError(''); }}
                onSubmitEditing={handleSendOtp}
                returnKeyType="send"
              />

              {error ? <Text style={styles.error}>{error}</Text> : null}

              <TouchableOpacity
                style={[styles.primaryBtn, loading && styles.btnDisabled]}
                onPress={handleSendOtp}
                disabled={loading}
                activeOpacity={0.85}
              >
                {loading
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={styles.primaryBtnText}>Continue with Email</Text>
                }
              </TouchableOpacity>

              <TouchableOpacity style={styles.skipBtn} onPress={() => navigation.navigate('Main')} activeOpacity={0.7}>
                <Text style={styles.skipText}>Continue without account</Text>
              </TouchableOpacity>

            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // ── OTP screen ─────────────────────────────────────────────────────────────
  if (screen === 'otp') {
    return (
      <SafeAreaView style={styles.root}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            <View style={[styles.card, { width: cardWidth }]}>

              <TouchableOpacity onPress={() => { setScreen('main'); setOtp(''); setError(''); }} activeOpacity={0.7}>
                <Text style={styles.back}>← Back</Text>
              </TouchableOpacity>

              <View style={[styles.logoRow, { marginTop: 24 }]}>
                <LogoIcon size={42} />
                <Text style={styles.brand}>ChatStox</Text>
              </View>

              <Text style={styles.title}>Check your email</Text>
              <Text style={styles.subtitle}>
                {'We sent a 6-digit code to\n'}
                <Text style={styles.emailHL}>{email}</Text>
              </Text>

              <OTPInput length={6} value={otp} onChange={setOtp} />

              {error ? <Text style={styles.error}>{error}</Text> : null}
              {loading && <ActivityIndicator color={GREEN} style={{ marginTop: 8 }} />}

              <TouchableOpacity
                onPress={resendTimer > 0 ? undefined : handleSendOtp}
                style={styles.resendBtn}
                activeOpacity={resendTimer > 0 ? 1 : 0.7}
              >
                <Text style={[styles.resendText, resendTimer > 0 && styles.resendDisabled]}>
                  {resendTimer > 0
                    ? `Resend code in ${resendTimer}s`
                    : "Didn't get a code? Resend"}
                </Text>
              </TouchableOpacity>

            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // ── Profile setup ─────────────────────────────────────────────────────────
  if (screen === 'profile') {
    const types = [
      { key: 'day_trader',   label: 'Day Trader',   desc: 'I trade intraday' },
      { key: 'swing_trader', label: 'Swing Trader', desc: '2–10 day holds' },
      { key: 'investor',     label: 'Investor',     desc: 'Long-term holds' },
      { key: 'options',      label: 'Options',      desc: 'Calls & puts' },
      { key: 'beginner',     label: 'Learning',     desc: 'Still learning' },
    ];
    return (
      <SafeAreaView style={styles.root}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            <View style={[styles.card, { width: cardWidth }]}>

              <View style={styles.logoRow}>
                <LogoIcon size={42} />
                <Text style={styles.brand}>ChatStox</Text>
              </View>
              <Text style={styles.title}>One last step</Text>
              <Text style={styles.subtitle}>Help us personalize your AI analysis.</Text>

              <View style={styles.nameRow}>
                <TextInput
                  style={[styles.input, styles.halfInput]}
                  placeholder="First name"
                  placeholderTextColor={SUBTLE}
                  value={firstName}
                  onChangeText={setFirstName}
                  autoCapitalize="words"
                />
                <TextInput
                  style={[styles.input, styles.halfInput]}
                  placeholder="Last name"
                  placeholderTextColor={SUBTLE}
                  value={lastName}
                  onChangeText={setLastName}
                  autoCapitalize="words"
                />
              </View>

              <Text style={styles.fieldLabel}>I am a…</Text>
              <View style={styles.typeGrid}>
                {types.map(t => (
                  <TouchableOpacity
                    key={t.key}
                    style={[styles.typeChip, traderType === t.key && styles.typeChipActive]}
                    onPress={() => setTraderType(t.key)}
                    activeOpacity={0.75}
                  >
                    <Text style={[styles.chipLabel, traderType === t.key && styles.chipLabelActive]}>
                      {t.label}
                    </Text>
                    <Text style={[styles.chipDesc, traderType === t.key && styles.chipDescActive]}>
                      {t.desc}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {error ? <Text style={styles.error}>{error}</Text> : null}

              <TouchableOpacity
                style={[styles.primaryBtn, loading && styles.btnDisabled]}
                onPress={handleSaveProfile}
                disabled={loading}
                activeOpacity={0.85}
              >
                {loading
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={styles.primaryBtnText}>Get started</Text>
                }
              </TouchableOpacity>

            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // ── Complete ───────────────────────────────────────────────────────────────
  if (screen === 'complete') {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.completeWrap}>
          <Checkmark />
          <Text style={styles.title}>
            {firstName ? `Welcome, ${firstName}!` : "You're in!"}
          </Text>
          <Text style={styles.subtitle}>Taking you to your dashboard…</Text>
          <ActivityIndicator color={GREEN} />
        </View>
      </SafeAreaView>
    );
  }

  return null;
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BG,
  },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 48,
    paddingHorizontal: 20,
  },
  card: {
    backgroundColor: BG,
    borderRadius: 24,
    padding: 32,
    maxWidth: 420,
    width: '100%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 16,
    elevation: 4,
    borderWidth: 1,
    borderColor: BORDER,
  },

  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 28,
  },
  brand: {
    fontSize: 22,
    fontWeight: '800',
    color: DARK,
    letterSpacing: -0.5,
  },

  tabs: {
    flexDirection: 'row',
    backgroundColor: FIELD,
    borderRadius: 12,
    padding: 3,
    marginBottom: 24,
  },
  tab: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 10,
    alignItems: 'center',
  },
  tabActive: {
    backgroundColor: BG,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  tabText: {
    fontSize: 14,
    fontWeight: '500',
    color: SUBTLE,
  },
  tabTextActive: {
    color: DARK,
    fontWeight: '700',
  },

  title: {
    fontSize: 24,
    fontWeight: '700',
    color: DARK,
    textAlign: 'center',
    marginBottom: 8,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 14,
    color: MID,
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: 28,
  },
  emailHL: {
    color: DARK,
    fontWeight: '600',
  },

  googleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: BG,
    borderRadius: 12,
    paddingVertical: 13,
    borderWidth: 1.5,
    borderColor: BORDER,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  googleBtnText: {
    color: DARK,
    fontSize: 15,
    fontWeight: '600',
  },

  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: BORDER,
  },
  dividerText: {
    color: SUBTLE,
    fontSize: 13,
  },

  input: {
    backgroundColor: FIELD,
    borderWidth: 1.5,
    borderColor: BORDER,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 13,
    fontSize: 15,
    color: DARK,
    marginBottom: 16,
    outlineStyle: 'none',
  },

  primaryBtn: {
    backgroundColor: GREEN,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
    shadowColor: GREEN,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 3,
  },
  primaryBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  btnDisabled: {
    opacity: 0.6,
  },

  skipBtn: {
    alignItems: 'center',
    paddingVertical: 14,
    marginTop: 4,
  },
  skipText: {
    color: SUBTLE,
    fontSize: 13,
  },

  back: {
    color: MID,
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 4,
  },

  error: {
    color: '#ef4444',
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 8,
  },

  otpRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
    marginVertical: 20,
  },
  otpBox: {
    width: 46,
    height: 56,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: BORDER,
    backgroundColor: FIELD,
    fontSize: 22,
    fontWeight: '700',
    color: DARK,
    textAlign: 'center',
  },
  otpBoxFilled: {
    borderColor: GREEN,
    backgroundColor: '#f0fdf4',
  },
  resendBtn: {
    alignItems: 'center',
    paddingVertical: 14,
  },
  resendText: {
    color: GREEN,
    fontSize: 14,
    fontWeight: '500',
  },
  resendDisabled: {
    color: SUBTLE,
  },

  nameRow: {
    flexDirection: 'row',
    gap: 10,
  },
  halfInput: {
    flex: 1,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: MID,
    marginTop: 4,
    marginBottom: 12,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  typeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 24,
  },
  typeChip: {
    borderWidth: 1.5,
    borderColor: BORDER,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minWidth: '45%',
    flex: 1,
    backgroundColor: FIELD,
  },
  typeChipActive: {
    borderColor: GREEN,
    backgroundColor: '#f0fdf4',
  },
  chipLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: DARK,
    marginBottom: 2,
  },
  chipLabelActive: {
    color: '#16a34a',
  },
  chipDesc: {
    fontSize: 11,
    color: SUBTLE,
  },
  chipDescActive: {
    color: '#4ade80',
  },

  completeWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 32,
  },
  checkCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: GREEN,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: GREEN,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 8,
  },
  checkMark: {
    fontSize: 38,
    color: '#fff',
    lineHeight: 44,
  },
});
