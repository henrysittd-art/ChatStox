import React, { useState, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Animated, SafeAreaView, ScrollView, useWindowDimensions, Alert,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { supabase } from '../services/supabase';
import { LogoIcon } from '../components/ChatstoxLogo';

const GREEN  = '#00C853';
const DARK   = '#1a1a1a';
const MID    = '#4b5563';
const SUBTLE = '#9ca3af';
const BORDER = '#e5e7eb';
const FIELD  = '#f9fafb';

const QUESTIONS = [
  {
    id: 'traderType',
    en: 'What type of trader are you?',
    es: '¿Qué tipo de trader eres?',
    type: 'single',
    options: [
      { key: 'day_trader',   en: 'Day Trader',  es: 'Day Trader',  desc_en: 'Intraday — in and out same session',       desc_es: 'Intradía — entro y salgo en la misma sesión' },
      { key: 'swing_trader', en: 'Swing Trader', es: 'Swing Trader', desc_en: '2–10 day holds on chart setups',          desc_es: 'Posiciones de 2–10 días en setups' },
      { key: 'long_term',    en: 'Long Term',    es: 'Largo Plazo', desc_en: 'Weeks to months, fundamentals-driven',    desc_es: 'Semanas a meses, basado en fundamentos' },
    ],
  },
  {
    id: 'sectors',
    en: 'Which sectors interest you?',
    es: '¿Qué sectores te interesan?',
    type: 'multi',
    hint_en: 'Select one or more',
    hint_es: 'Selecciona uno o más',
    options: [
      { key: 'tech',    en: 'Tech',         es: 'Tecnología' },
      { key: 'energy',  en: 'Energy',       es: 'Energía' },
      { key: 'health',  en: 'Healthcare',   es: 'Salud' },
      { key: 'finance', en: 'Finance',      es: 'Finanzas' },
      { key: 'all',     en: 'All Sectors',  es: 'Todos los sectores' },
    ],
  },
  {
    id: 'likesPennyStocks',
    en: 'Do you like penny stocks?',
    es: '¿Te gustan las penny stocks?',
    type: 'single',
    options: [
      { key: 'yes', en: 'Yes — show me momentum plays',       es: 'Sí — muéstrame momentum plays' },
      { key: 'no',  en: 'No — prefer established companies',  es: 'No — prefiero empresas establecidas' },
    ],
  },
  {
    id: 'riskTolerance',
    en: "What's your risk tolerance?",
    es: '¿Cuál es tu tolerancia al riesgo?',
    type: 'single',
    options: [
      { key: 'high',   en: 'High',   es: 'Alto',  desc_en: 'Aggressive — big swings, momentum plays',    desc_es: 'Agresivo — grandes movimientos, momentum' },
      { key: 'medium', en: 'Medium', es: 'Medio', desc_en: 'Balanced risk/reward',                       desc_es: 'Riesgo/beneficio balanceado' },
      { key: 'low',    en: 'Low',    es: 'Bajo',  desc_en: 'Conservative — dividends, large-cap stocks', desc_es: 'Conservador — dividendos, grandes empresas' },
    ],
  },
  {
    id: 'capitalRange',
    en: 'How much capital do you manage?',
    es: '¿Cuánto capital manejas?',
    type: 'single',
    options: [
      { key: 'under_5k', en: 'Under $5K',  es: 'Menos de $5K' },
      { key: '5k_50k',   en: '$5K – $50K', es: '$5K – $50K' },
      { key: 'over_50k', en: 'Over $50K',  es: 'Más de $50K' },
    ],
  },
];

export default function OnboardingScreen({ navigation }) {
  const { user, reloadProfile } = useAuth();
  const { lang } = useLanguage();
  const { width } = useWindowDimensions();
  const isWide = width >= 600;

  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState({
    traderType: null, sectors: [],
    likesPennyStocks: null, riskTolerance: null, capitalRange: null,
  });
  const [saving, setSaving] = useState(false);
  const slideAnim = useRef(new Animated.Value(0)).current;

  const q       = QUESTIONS[step];
  const isLast  = step === QUESTIONS.length - 1;
  const progress = (step + 1) / QUESTIONS.length;

  const animateSlide = (dir) => {
    Animated.sequence([
      Animated.timing(slideAnim, { toValue: dir === 'next' ? -24 : 24, duration: 110, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 180, useNativeDriver: true }),
    ]).start();
  };

  const handleSelect = (optionKey) => {
    setAnswers(prev => {
      if (q.type === 'multi') {
        const cur = prev[q.id] || [];
        if (optionKey === 'all') return { ...prev, [q.id]: ['all'] };
        const withoutAll = cur.filter(k => k !== 'all');
        return {
          ...prev,
          [q.id]: withoutAll.includes(optionKey)
            ? withoutAll.filter(k => k !== optionKey)
            : [...withoutAll, optionKey],
        };
      }
      return { ...prev, [q.id]: optionKey };
    });
  };

  const isSelected = (optionKey) => {
    const val = answers[q.id];
    return q.type === 'multi'
      ? Array.isArray(val) && val.includes(optionKey)
      : val === optionKey;
  };

  const canAdvance = () => {
    const val = answers[q.id];
    return q.type === 'multi' ? Array.isArray(val) && val.length > 0 : val !== null;
  };

  const handleNext = async () => {
    if (!canAdvance()) return;
    if (!isLast) {
      animateSlide('next');
      setStep(s => s + 1);
      return;
    }
    setSaving(true);

    // Write AsyncStorage backup first — survives any Supabase failure.
    await AsyncStorage.setItem('onboarding_complete', 'true').catch(() => {});

    const { error } = await supabase
      .from('profiles')
      .upsert({
        id:                  user.id,
        trader_type:         answers.traderType,
        sectors:             answers.sectors || [],
        likes_penny_stocks:  answers.likesPennyStocks === 'yes',
        risk_tolerance:      answers.riskTolerance,
        capital_range:       answers.capitalRange,
        language:            lang,
        onboarding_complete: true,
      }, { onConflict: 'id' });

    if (error) {
      console.error('Save profile error:', error);
      Alert.alert('Error saving profile', error.message);
      setSaving(false);
      return;
    }

    await reloadProfile();
    navigation.replace('Main');
  };

  const handleBack = () => {
    if (step === 0) return;
    animateSlide('back');
    setStep(s => s - 1);
  };

  const L = (en, es) => lang === 'es' ? es : en;

  return (
    <SafeAreaView style={styles.root}>

      {/* Progress bar */}
      <View style={styles.progressWrap}>
        <View style={styles.progressBg}>
          <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
        </View>
        <Text style={styles.progressLabel}>{step + 1} / {QUESTIONS.length}</Text>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, isWide && { paddingHorizontal: 60 }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.card, isWide && { maxWidth: 480, alignSelf: 'center', width: '100%' }]}>

          <View style={styles.logoRow}>
            <LogoIcon size={36} />
            <Text style={styles.brand}>ChatStox</Text>
          </View>

          <Animated.View style={{ transform: [{ translateX: slideAnim }] }}>
            <Text style={styles.question}>{L(q.en, q.es)}</Text>
            {q.type === 'multi' && (
              <Text style={styles.hint}>{L(q.hint_en || '', q.hint_es || '')}</Text>
            )}

            <View style={styles.optionsWrap}>
              {q.options.map(opt => {
                const sel = isSelected(opt.key);
                return (
                  <TouchableOpacity
                    key={opt.key}
                    style={[styles.option, sel && styles.optionSel]}
                    onPress={() => handleSelect(opt.key)}
                    activeOpacity={0.75}
                  >
                    <View style={styles.optionBody}>
                      <Text style={[styles.optionLabel, sel && styles.optionLabelSel]}>
                        {L(opt.en, opt.es)}
                      </Text>
                      {(opt.desc_en || opt.desc_es) ? (
                        <Text style={[styles.optionDesc, sel && styles.optionDescSel]}>
                          {L(opt.desc_en || '', opt.desc_es || '')}
                        </Text>
                      ) : null}
                    </View>
                    <View style={[styles.check, sel && styles.checkSel]}>
                      {sel && <Text style={styles.checkMark}>✓</Text>}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          </Animated.View>

          {/* Navigation */}
          <View style={styles.navRow}>
            <TouchableOpacity
              onPress={handleBack}
              style={[styles.backBtn, step === 0 && { opacity: 0 }]}
              disabled={step === 0}
              activeOpacity={0.7}
            >
              <Text style={styles.backText}>← {L('Back', 'Atrás')}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.nextBtn, (!canAdvance() || saving) && styles.nextBtnDim]}
              onPress={handleNext}
              disabled={!canAdvance() || saving}
              activeOpacity={0.85}
            >
              <Text style={styles.nextBtnText}>
                {saving ? '…'
                  : isLast
                    ? L('Get Started', 'Empezar')
                    : L('Next →', 'Siguiente →')}
              </Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            onPress={() => navigation.replace('Main')}
            style={styles.skipBtn}
            activeOpacity={0.6}
          >
            <Text style={styles.skipText}>{L('Skip for now', 'Omitir por ahora')}</Text>
          </TouchableOpacity>

        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#ffffff' },

  progressWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8,
  },
  progressBg: { flex: 1, height: 5, backgroundColor: BORDER, borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: GREEN, borderRadius: 3 },
  progressLabel: { fontSize: 12, color: SUBTLE, fontWeight: '600', minWidth: 36, textAlign: 'right' },

  scroll: { flexGrow: 1, justifyContent: 'center', padding: 20 },

  card: {
    backgroundColor: '#ffffff', borderRadius: 24, padding: 28,
    borderWidth: 1, borderColor: BORDER,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 12, elevation: 3,
  },

  logoRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: 8, marginBottom: 24,
  },
  brand: { fontSize: 20, fontWeight: '800', color: DARK, letterSpacing: -0.4 },

  question: {
    fontSize: 21, fontWeight: '700', color: DARK,
    textAlign: 'center', letterSpacing: -0.3, marginBottom: 4,
  },
  hint: { fontSize: 12, color: SUBTLE, textAlign: 'center', marginBottom: 4 },

  optionsWrap: { gap: 10, marginTop: 20, marginBottom: 24 },

  option: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1.5, borderColor: BORDER, borderRadius: 14,
    padding: 16, backgroundColor: FIELD,
  },
  optionSel:       { borderColor: GREEN, backgroundColor: '#f0fdf4' },
  optionBody:      { flex: 1 },
  optionLabel:     { fontSize: 15, fontWeight: '600', color: DARK },
  optionLabelSel:  { color: '#16a34a' },
  optionDesc:      { fontSize: 12, color: SUBTLE, marginTop: 3 },
  optionDescSel:   { color: '#86efac' },

  check: {
    width: 22, height: 22, borderRadius: 11,
    borderWidth: 1.5, borderColor: '#d1d5db', backgroundColor: '#fff',
    justifyContent: 'center', alignItems: 'center', marginLeft: 12, flexShrink: 0,
  },
  checkSel:   { backgroundColor: GREEN, borderColor: GREEN },
  checkMark:  { fontSize: 11, color: '#fff', fontWeight: '800' },

  navRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  backBtn: { paddingVertical: 12, paddingRight: 16 },
  backText: { fontSize: 14, color: MID, fontWeight: '500' },

  nextBtn: {
    backgroundColor: GREEN, borderRadius: 12,
    paddingVertical: 13, paddingHorizontal: 28,
    shadowColor: GREEN, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.28, shadowRadius: 8, elevation: 3,
  },
  nextBtnDim: { opacity: 0.4 },
  nextBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },

  skipBtn: { alignItems: 'center', paddingTop: 16 },
  skipText: { fontSize: 13, color: SUBTLE },
});
