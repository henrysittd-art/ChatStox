import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

const PILLS = [
  { label: 'Pipeline',    route: 'Home' },
  { label: 'Market Chat', route: 'GeneralChat' },
  { label: 'Stock Chat',  route: 'StockChat' },
];

export default function NavPillBar({ navigation, active }) {
  return (
    <View style={styles.bar}>
      {PILLS.map(({ label, route }) => {
        const isActive = active === route;
        return (
          <TouchableOpacity
            key={route}
            style={[styles.pill, isActive && styles.pillActive]}
            onPress={() => { if (!isActive) navigation.navigate(route); }}
            activeOpacity={isActive ? 1 : 0.75}
          >
            <Text style={[styles.label, isActive && styles.labelActive]}>{label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 7,
    gap: 8,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#cbd5e1',
  },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#0a1628',
    backgroundColor: '#fff',
  },
  pillActive: {
    backgroundColor: '#0a1628',
    borderColor: '#f5a623',
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: '#0a1628',
  },
  labelActive: {
    color: '#fff',
  },
});
