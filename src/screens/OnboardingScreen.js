import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  SafeAreaView, Dimensions, Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const { width } = Dimensions.get('window');
const CARD_W = Math.min(width - 48, 480);

const QUESTIONS = [
  {
    key: 'traderType',
    question: 'What type of trader are you?',
    pregunta: '¿Qué tipo de trader eres?',
    options: [
      { label: 'Day Trader', value: 'day' },
      { label: 'Swing Trader', value: 'swing' },
      { label: 'Long-term Investor', value: 'longterm' },
      { label: 'Options Trader', value: 'options' },
    ],
  },
  {
    key: 'stockPreference',
    question: 'What stocks do you prefer?',
    pregunta: '¿Qué tipo de acciones prefieres?',
    options: [
      { label: 'Penny Stocks / Micro-caps', value: 'penny' },
      { label: 'Mid-Cap', value: 'midcap' },
      { label: 'Large-Cap', value: 'largecap' },
      { label: 'All Categories', value: 'all' },
    ],
  },
  {
    key: 'riskTolerance',
    question: 'What is your risk tolerance?',
    pregunta: '¿Cuál es tu tolerancia al riesgo?',
    options: [
      { label: 'Conservative', value: 'conservative' },
      { label: 'Moderate', value: 'moderate' },
      { label: 'Aggressive', value: 'aggressive' },
      { label: 'Very Aggressive', value: 'very_aggressive' },
    ],
  },
  {
    key: 'tradeSize',
    question: 'What is your typical trade size?',
    pregunta: '¿Cuál es tu tamaño de operación típico?',
    options: [
      { label: 'Under $1,000', value: 'micro' },
      { label: '$1,000 – $10,000', value: 'small' },
      { label: '$10,000 – $50,000', value: 'medium' },
      { label: 'Over $50,000', value: 'large' },
    ],
  },
  {
    key: 'sectors',
    question: 'Which sectors interest you most?',
    pregunta: '¿Qué sectores te interesan más?',
    options: [
      { label: 'Technology', value: 'tech' },
      { label: 'Healthcare', value: 'healthcare' },
      { label: 'Energy', value: 'energy' },
      { label: 'Finance', value: 'finance' },
    ],
  },
];

export default function OnboardingScreen({ navigation }) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState({});

  const q = QUESTIONS[step];

  const handleSelect = async (value) => {
    const updated = { ...answers, [q.key]: value };
    setAnswers(updated);

    if (step < QUESTIONS.length - 1) {
      setStep(step + 1);
    } else {
      await AsyncStorage.setItem('userProfile', JSON.stringify(updated));
      navigation.replace('Main');
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={styles.logo}>CHATSTOX</Text>
          <Text style={styles.tagline}>AI-Powered Stock Intelligence</Text>
        </View>

        <View style={styles.progressRow}>
          {QUESTIONS.map((_, i) => (
            <View
              key={i}
              style={[styles.dot, i <= step ? styles.dotActive : styles.dotInactive]}
            />
          ))}
        </View>

        <View style={styles.card}>
          <Text style={styles.stepLabel}>Step {step + 1} of {QUESTIONS.length}</Text>
          <Text style={styles.question}>{q.question}</Text>
          <Text style={styles.questionEs}>{q.pregunta}</Text>

          <View style={styles.optionsGrid}>
            {q.options.map((opt) => (
              <TouchableOpacity
                key={opt.value}
                style={[
                  styles.option,
                  answers[q.key] === opt.value && styles.optionSelected,
                ]}
                onPress={() => handleSelect(opt.value)}
                activeOpacity={0.8}
              >
                <Text style={[
                  styles.optionText,
                  answers[q.key] === opt.value && styles.optionTextSelected,
                ]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <Text style={styles.disclaimer}>
          CHATSTOX provides AI analysis for educational purposes only. Not financial advice.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f0f4f8' },
  container: { flexGrow: 1, alignItems: 'center', paddingVertical: 32, paddingHorizontal: 24 },
  header: { alignItems: 'center', marginBottom: 24 },
  logo: { fontSize: 36, fontWeight: '900', color: '#0a1628', letterSpacing: 4 },
  tagline: { fontSize: 13, color: '#64748b', marginTop: 4, letterSpacing: 1 },
  progressRow: { flexDirection: 'row', gap: 8, marginBottom: 32 },
  dot: { width: 40, height: 4, borderRadius: 2 },
  dotActive: { backgroundColor: '#f5a623' },
  dotInactive: { backgroundColor: '#cbd5e1' },
  card: {
    width: CARD_W,
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 28,
    shadowColor: '#0a1628',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 8,
  },
  stepLabel: { fontSize: 12, color: '#94a3b8', fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 },
  question: { fontSize: 22, fontWeight: '800', color: '#0a1628', marginBottom: 4 },
  questionEs: { fontSize: 14, color: '#64748b', marginBottom: 24, fontStyle: 'italic' },
  optionsGrid: { gap: 12 },
  option: {
    borderWidth: 2,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 20,
    backgroundColor: '#f8fafc',
  },
  optionSelected: {
    borderColor: '#f5a623',
    backgroundColor: '#0a1628',
  },
  optionText: { fontSize: 15, fontWeight: '600', color: '#334155', textAlign: 'center' },
  optionTextSelected: { color: '#f5a623' },
  disclaimer: { fontSize: 11, color: '#94a3b8', textAlign: 'center', marginTop: 24, maxWidth: CARD_W, lineHeight: 16 },
});
