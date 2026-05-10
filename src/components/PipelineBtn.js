import React from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';

export default function PipelineBtn({ onPress, style }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.btn, style]}
      activeOpacity={0.72}
    >
      <Text style={styles.icon}>🏠</Text>
      <Text style={styles.label}>Pipeline</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0a1628',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1.5,
    borderColor: '#f5a623',
    gap: 4,
    flexShrink: 0,
    shadowColor: '#f5a623',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.28,
    shadowRadius: 6,
    elevation: 4,
  },
  icon: { fontSize: 11 },
  label: {
    fontSize: 11,
    fontWeight: '800',
    color: '#f5a623',
    letterSpacing: 0.5,
  },
});
