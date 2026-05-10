import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  SafeAreaView, KeyboardAvoidingView, Platform, Animated,
  useWindowDimensions, ActivityIndicator, ScrollView,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '../context/AuthContext';
import { LogoIcon } from '../components/ChatstoxLogo';
import { BACKEND_URL } from '../config/api';

const API_BASE = BACKEND_URL;

// ── Google color G icon ───────────────────────────────────────────────────────
function GoogleIcon({ size = 20 }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center' }}>
      <Text style={{ fontSize: size * 0.65, fontWeight: '700', color: '#4285F4', fontFamily: 'Georgia' }}>G</Text>
    </View>
  );
}

// ── Animated checkmark ────────────────────────────────────────────────────────
function Checkmark() {
  const scale = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.sequence([
      Animated.delay(200),
      Animated.parallel([
        Animated.spring(scale, { toValue: 1, friction: 5, tension: 100, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 300, useNativeDriver: true }),
      ]),
    ]).start();
  }, []);
  return (
    <Animated.View style={[styles.checkCircle, { transform: [{ scale }], opacity }]}>
      <Text style={styles.checkMark}>✓</Text>
    </Animated.View>
  );
}

// ── OTP digit box ─────────────────────────────────────────────────────────────
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
export default function AuthScreen({ navigation, route }) {
  const { signIn } = useAuth();
  const { width } = useWindowDimensions();
  const isWide = width >= 600;

  const initialState = route?.params?.initialState || 'signup_options';
  const [screen, setScreen] = useState(initialState);
  const [email, setEmail]   = useState('');
  const [otp, setOtp]       = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName]   = useState('');
  const [traderType, setTraderType] = useState('');
  const [error, setError]   = useState('');
  const [loading, setLoading] = useState(false);

  // Auto-navigate from complete → Main after 2s
  useEffect(() => {
    if (screen === 'complete') {
      const t = setTimeout(() => navigation.replace('Main'), 2000);
      return () => clearTimeout(t);
    }
  }, [screen]);

  // Auto-submit OTP when all 6 digits entered
  useEffect(() => {
    if (otp.length === 6 && screen === 'verification') {
      handleVerifyOtp();
    }
  }, [otp]);

  const handleSendOtp = async () => {
    setError('');
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return setError('Please enter a valid email address.');
    }
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/send-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send code');
      setScreen('verification');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code: otp }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Invalid code');
      setScreen('profile_setup');
    } catch (e) {
      setError(e.message);
      setOtp('');
    } finally {
      setLoading(false);
    }
  };

  const handleCompleteProfile = async () => {
    setError('');
    if (!firstName.trim()) return setError('Please enter your first name.');
    if (!traderType) return setError('Please select your trader type.');
    setLoading(true);
    try {
      const userData = {
        email,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        traderType,
        authMethod: 'email',
        createdAt: new Date().toISOString(),
      };
      await signIn(userData);
      // Keep existing profile in AsyncStorage for onboarding compatibility
      const existing = await AsyncStorage.getItem('userProfile');
      if (!existing) {
        await AsyncStorage.setItem('userProfile', JSON.stringify({ traderType }));
      }
      setScreen('complete');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    // Firebase Google sign-in — placeholder for web implementation
    setError('Google sign-in requires Firebase configuration. Use email sign-in for now.');
  };

  const cardWidth = isWide ? 420 : '100%';

  // ── signup_options ────────────────────────────────────────────────────────
  if (screen === 'signup_options') {
    return (
      <SafeAreaView style={styles.root}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={[styles.card, { width: cardWidth }]}>
            <View style={styles.logoRow}>
              <LogoIcon size={36} />
              <Text style={styles.brand}>ChatStox</Text>
            </View>
            <Text style={styles.title}>Create your account</Text>
            <Text style={styles.subtitle}>Sign up to save your chats and personalize your experience.</Text>

            <TouchableOpacity style={styles.primaryBtn} onPress={() => setScreen('email_input')}>
              <Text style={styles.primaryBtnText}>Continue with Email</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.skipBtn} onPress={() => navigation.replace('Main')}>
              <Text style={styles.skipText}>Skip for now</Text>
            </TouchableOpacity>

            <View style={styles.signinRow}>
              <Text style={styles.signinLabel}>Already have an account? </Text>
              <TouchableOpacity onPress={() => setScreen('email_input')}>
                <Text style={styles.signinLink}>Sign in</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── email_input ───────────────────────────────────────────────────────────
  if (screen === 'email_input') {
    return (
      <SafeAreaView style={styles.root}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={styles.scroll}>
            <View style={[styles.card, { width: cardWidth }]}>
              <TouchableOpacity style={styles.backBtn} onPress={() => setScreen('signup_options')}>
                <Text style={styles.backText}>← Back</Text>
              </TouchableOpacity>

              <View style={styles.logoRow}>
                <LogoIcon size={36} />
                <Text style={styles.brand}>ChatStox</Text>
              </View>

              <Text style={styles.title}>Enter your email</Text>
              <Text style={styles.subtitle}>We'll send you a 6-digit verification code.</Text>

              <TextInput
                style={styles.textInput}
                placeholder="your@email.com"
                placeholderTextColor="#8a9bb5"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                value={email}
                onChangeText={t => { setEmail(t); setError(''); }}
                onSubmitEditing={handleSendOtp}
                returnKeyType="send"
              />

              {error ? <Text style={styles.errorText}>{error}</Text> : null}

              <TouchableOpacity
                style={[styles.primaryBtn, loading && styles.btnDisabled]}
                onPress={handleSendOtp}
                disabled={loading}
              >
                {loading
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={styles.primaryBtnText}>Send verification code</Text>
                }
              </TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // ── verification ──────────────────────────────────────────────────────────
  if (screen === 'verification') {
    return (
      <SafeAreaView style={styles.root}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={styles.scroll}>
            <View style={[styles.card, { width: cardWidth }]}>
              <TouchableOpacity style={styles.backBtn} onPress={() => { setScreen('email_input'); setOtp(''); setError(''); }}>
                <Text style={styles.backText}>← Back</Text>
              </TouchableOpacity>

              <View style={styles.logoRow}>
                <LogoIcon size={36} />
                <Text style={styles.brand}>ChatStox</Text>
              </View>

              <Text style={styles.title}>Check your email</Text>
              <Text style={styles.subtitle}>
                We sent a 6-digit code to{'\n'}
                <Text style={styles.emailHighlight}>{email}</Text>
              </Text>

              <OTPInput length={6} value={otp} onChange={setOtp} />

              {error ? <Text style={styles.errorText}>{error}</Text> : null}

              {loading && <ActivityIndicator color="#1a3a5c" style={{ marginTop: 16 }} />}

              <TouchableOpacity style={styles.resendBtn} onPress={handleSendOtp}>
                <Text style={styles.resendText}>Didn't get a code? Resend</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // ── profile_setup ─────────────────────────────────────────────────────────
  if (screen === 'profile_setup') {
    const types = [
      { key: 'day_trader',    label: 'Day Trader',    desc: 'I trade intraday' },
      { key: 'swing_trader',  label: 'Swing Trader',  desc: '2–10 day holds' },
      { key: 'investor',      label: 'Investor',      desc: 'Long-term holds' },
      { key: 'options',       label: 'Options Trader', desc: 'Calls & puts' },
      { key: 'beginner',      label: 'Learning',      desc: 'Still learning' },
    ];
    return (
      <SafeAreaView style={styles.root}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={styles.scroll}>
            <View style={[styles.card, { width: cardWidth }]}>
              <View style={styles.logoRow}>
                <LogoIcon size={36} />
                <Text style={styles.brand}>ChatStox</Text>
              </View>

              <Text style={styles.title}>Set up your profile</Text>
              <Text style={styles.subtitle}>Help us personalize your AI analysis.</Text>

              <View style={styles.nameRow}>
                <TextInput
                  style={[styles.textInput, styles.halfInput]}
                  placeholder="First name"
                  placeholderTextColor="#8a9bb5"
                  value={firstName}
                  onChangeText={setFirstName}
                  autoCapitalize="words"
                />
                <TextInput
                  style={[styles.textInput, styles.halfInput]}
                  placeholder="Last name (optional)"
                  placeholderTextColor="#8a9bb5"
                  value={lastName}
                  onChangeText={setLastName}
                  autoCapitalize="words"
                />
              </View>

              <Text style={styles.fieldLabel}>Trader type</Text>
              <View style={styles.typeGrid}>
                {types.map(t => (
                  <TouchableOpacity
                    key={t.key}
                    style={[styles.typeChip, traderType === t.key && styles.typeChipActive]}
                    onPress={() => setTraderType(t.key)}
                  >
                    <Text style={[styles.typeChipLabel, traderType === t.key && styles.typeChipLabelActive]}>
                      {t.label}
                    </Text>
                    <Text style={[styles.typeChipDesc, traderType === t.key && styles.typeChipDescActive]}>
                      {t.desc}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {error ? <Text style={styles.errorText}>{error}</Text> : null}

              <TouchableOpacity
                style={[styles.primaryBtn, loading && styles.btnDisabled]}
                onPress={handleCompleteProfile}
                disabled={loading}
              >
                {loading
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={styles.primaryBtnText}>Complete setup</Text>
                }
              </TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // ── complete ──────────────────────────────────────────────────────────────
  if (screen === 'complete') {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.completeWrap}>
          <Checkmark />
          <Text style={styles.completeTitle}>Welcome, {firstName}!</Text>
          <Text style={styles.completeSubtitle}>Your account is ready. Taking you in…</Text>
          <ActivityIndicator color="#1a3a5c" style={{ marginTop: 24 }} />
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
    backgroundColor: '#f0f4f8',
  },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
    paddingHorizontal: 20,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 32,
    shadowColor: '#0a1628',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: 8,
    maxWidth: 420,
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
    fontWeight: '700',
    color: '#0a1628',
    letterSpacing: -0.5,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#0a1628',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#5a7a9a',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 28,
  },
  emailHighlight: {
    color: '#1a3a5c',
    fontWeight: '600',
  },
  googleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: '#4285F4',
    borderRadius: 12,
    paddingVertical: 14,
    marginBottom: 16,
  },
  googleBtnText: {
    color: '#fff',
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
    backgroundColor: '#e8edf2',
  },
  dividerText: {
    color: '#8a9bb5',
    fontSize: 13,
  },
  primaryBtn: {
    backgroundColor: '#1a3a5c',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  primaryBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  btnDisabled: {
    opacity: 0.6,
  },
  skipBtn: {
    alignItems: 'center',
    paddingVertical: 12,
    marginTop: 8,
  },
  skipText: {
    color: '#8a9bb5',
    fontSize: 14,
  },
  signinRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 4,
  },
  signinLabel: {
    color: '#5a7a9a',
    fontSize: 13,
  },
  signinLink: {
    color: '#1a3a5c',
    fontSize: 13,
    fontWeight: '600',
  },
  backBtn: {
    alignSelf: 'flex-start',
    marginBottom: 20,
  },
  backText: {
    color: '#5a7a9a',
    fontSize: 14,
  },
  textInput: {
    backgroundColor: '#f5f8fa',
    borderWidth: 1,
    borderColor: '#d8e2ec',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 13,
    fontSize: 15,
    color: '#0a1628',
    marginBottom: 16,
  },
  errorText: {
    color: '#e53935',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 8,
  },
  otpRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 20,
    marginTop: 8,
  },
  otpBox: {
    width: 46,
    height: 56,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#d8e2ec',
    backgroundColor: '#f5f8fa',
    fontSize: 22,
    fontWeight: '700',
    color: '#0a1628',
    textAlign: 'center',
  },
  otpBoxFilled: {
    borderColor: '#1a3a5c',
    backgroundColor: '#eef3f8',
  },
  resendBtn: {
    alignItems: 'center',
    paddingVertical: 12,
    marginTop: 8,
  },
  resendText: {
    color: '#1a3a5c',
    fontSize: 14,
    fontWeight: '500',
  },
  nameRow: {
    flexDirection: 'row',
    gap: 12,
  },
  halfInput: {
    flex: 1,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0a1628',
    marginBottom: 12,
    letterSpacing: 0.3,
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
    borderColor: '#d8e2ec',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minWidth: '45%',
    flex: 1,
  },
  typeChipActive: {
    borderColor: '#1a3a5c',
    backgroundColor: '#eef3f8',
  },
  typeChipLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0a1628',
    marginBottom: 2,
  },
  typeChipLabelActive: {
    color: '#1a3a5c',
  },
  typeChipDesc: {
    fontSize: 11,
    color: '#8a9bb5',
  },
  typeChipDescActive: {
    color: '#4a6a8a',
  },
  completeWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  checkCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#1a3a5c',
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkMark: {
    fontSize: 40,
    color: '#f5a623',
    lineHeight: 44,
  },
  completeTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: '#0a1628',
  },
  completeSubtitle: {
    fontSize: 15,
    color: '#5a7a9a',
  },
});
