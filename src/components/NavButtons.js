import React from 'react';
import { View, TouchableOpacity, Text, StyleSheet } from 'react-native';

const NavButtons = ({ currentScreen, navigation }) => {
  const buttons = [
    { label: 'Pipeline', screen: 'Home' },
    { label: 'Market Chat', screen: 'GeneralChat' },
    { label: 'Stock Chat', screen: 'StockChat' },
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
});

export default NavButtons;
