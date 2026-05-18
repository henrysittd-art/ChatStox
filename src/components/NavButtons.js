import React from 'react';
import { View, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { useLanguage } from '../context/LanguageContext';

const NavButtons = ({ currentScreen, navigation }) => {
  const { lang, setLang } = useLanguage();

  const buttons = [
    { label: 'Pipeline',    screen: 'Home' },
    { label: 'Market Chat', screen: 'GeneralChat' },
    { label: 'Stock Chat',  screen: 'StockChat' },
  ];

  return (
    <View style={styles.container}>
      {buttons.map((btn) => {
        const isActive = currentScreen === btn.screen;
        return (
          <TouchableOpacity
            key={btn.label}
            style={[styles.button, isActive && styles.activeButton]}
            onPress={() => !isActive && navigation.navigate(btn.screen)}
          >
            <Text style={[styles.text, isActive && styles.activeText]}>
              {btn.label}
            </Text>
          </TouchableOpacity>
        );
      })}

      {/* Language toggle */}
      <TouchableOpacity
        style={styles.langBtn}
        onPress={() => setLang(lang === 'en' ? 'es' : 'en')}
        activeOpacity={0.7}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Text style={styles.langText}>🌐 {lang.toUpperCase()}</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  button: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#0a1628',
    backgroundColor: 'white',
  },
  activeButton: {
    backgroundColor: '#0a1628',
    borderColor: '#f5a623',
  },
  text: {
    fontSize: 12,
    color: '#0a1628',
    fontWeight: '500',
  },
  activeText: {
    color: 'white',
  },
  langBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#d1d5db',
    backgroundColor: '#f9fafb',
  },
  langText: {
    fontSize: 11,
    color: '#374151',
    fontWeight: '600',
  },
});

export default NavButtons;
