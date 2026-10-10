import React from 'react';
import { View, Image } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useTheme } from '../theme/ThemeContext';
import { API_BASE_URL } from '../api/client';
import { zutatenSymbol } from '../utils/zutatenSymbol';

// KI-Bild, wenn es eines gibt, sonst ein Symbol.
export default function ZutatBild({ name, abteilung, bild, groesse, aktiv }: {
  name: string; abteilung?: string | null; bild?: string | null; groesse: number; aktiv?: boolean;
}) {
  const { colors, gradient } = useTheme();
  const radius = Math.round(groesse * 0.26);
  return (
    <View style={{
      width: groesse, height: groesse, borderRadius: radius, overflow: 'hidden',
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: aktiv ? gradient[0] + '22' : colors.bg,
    }}>
      {bild ? (
        <Image source={{ uri: `${API_BASE_URL}${bild}` }} style={{ width: groesse, height: groesse }} />
      ) : (
        <MaterialCommunityIcons name={zutatenSymbol(name, abteilung)} size={Math.round(groesse * 0.5)}
          color={aktiv ? gradient[0] : colors.muted} />
      )}
    </View>
  );
}
