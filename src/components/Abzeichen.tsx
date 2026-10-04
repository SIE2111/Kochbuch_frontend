import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

/** Kleines "?" am Maskottchen - bleibt dauerhaft als Zeichen für die Hilfe
 * (Wunsch 04.10.2026; vorher nur bis zum ersten Antippen). */
export function FrageAbzeichen({ farbe }: { farbe: string }) {
  return (
    <View pointerEvents="none" style={[styles.punkt, { backgroundColor: farbe }]}>
      <Text style={styles.text}>?</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  punkt: { position: 'absolute', top: -4, right: -4, width: 18, height: 18, borderRadius: 9,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: '#fff' },
  text: { color: '#fff', fontSize: 11, fontWeight: '800', lineHeight: 13 },
});
