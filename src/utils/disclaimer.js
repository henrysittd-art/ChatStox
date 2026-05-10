import AsyncStorage from '@react-native-async-storage/async-storage';

const DISCLAIMER_ES =
  '👋 Bienvenido a CHATSTOX. El análisis que te brindo es orientativo y no constituye asesoría financiera oficial. Siempre corrobora la información y toma tus propias decisiones de inversión. ¡Con gusto te ayudo a analizar el mercado! 📊';

const DISCLAIMER_EN =
  '👋 Welcome to CHATSTOX. The analysis I provide is for informational purposes only and does not constitute financial advice. Always verify information and make your own investment decisions. Happy to help you analyze the market! 📊';

export function getDisclaimerText() {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale || '';
    if (locale.toLowerCase().startsWith('en')) return DISCLAIMER_EN;
  } catch {}
  return DISCLAIMER_ES;
}

export function buildDisclaimerMessage() {
  return {
    role: 'disclaimer',
    content: getDisclaimerText(),
    time: '',
  };
}

export async function hasSeenDisclaimer(key) {
  try {
    const val = await AsyncStorage.getItem(`disclaimer_shown_${key}`);
    return val === 'true';
  } catch {
    return false;
  }
}

export async function markDisclaimerSeen(key) {
  try {
    await AsyncStorage.setItem(`disclaimer_shown_${key}`, 'true');
  } catch {}
}
