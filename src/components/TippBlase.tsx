import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useUebersetzung } from '../i18n';
import { alsGesehen, aufAenderungHoeren, gesehenLaden, tippsErlaubt } from '../utils/tipps';

/**
 * Sprechblase des Maskottchens mit einem Tipp je App-Start (siehe
 * utils/tipps.ts). Texte: i18n `tipps.<id>`; Reihenfolge = Liste `tipps`.
 * "✕" blendet diesen Tipp aus, "Nächster Tipp ›" zeigt gleich den nächsten.
 */
export function TippBlase({ tipps, avatar, farben, erlaubt = true }: {
  tipps: string[];
  avatar: React.ReactNode;
  farben: { flaeche: string; text: string; gedaempft: string; akzent: string };
  erlaubt?: boolean;
}) {
  const { t } = useUebersetzung();
  const [id, setId] = useState<string | null>(null);

  async function naechsterUngesehen(nach?: string): Promise<string | null> {
    const gesehen = await gesehenLaden();
    const ab = nach ? tipps.indexOf(nach) + 1 : 0;
    return tipps.slice(ab).find((x) => !gesehen.includes(x)) ?? null;
  }

  useEffect(() => {
    let aktiv = true;
    (async () => {
      if (!erlaubt || !(await tippsErlaubt())) { if (aktiv) setId(null); return; }
      const erster = await naechsterUngesehen();
      if (!aktiv) return;
      setId(erster);
      // Normale Tipps gelten als gesehen, sobald sie einmal da waren;
      // "antippen" bleibt, bis man das Maskottchen antippt oder ✕ drückt.
      if (erster && erster !== 'antippen') alsGesehen(erster);
    })();
    const ab = aufAenderungHoeren(async () => {
      if (!(await tippsErlaubt())) { setId(null); return; }
      const g = await gesehenLaden();
      setId((cur) => (cur && g.includes(cur) && cur === 'antippen' ? null : cur));
    });
    return () => { aktiv = false; ab(); };
  }, [erlaubt, tipps.join(',')]);

  if (!id || !erlaubt) return null;

  return (
    <View style={styles.box}>
      {avatar}
      <View style={[styles.blase, { backgroundColor: farben.flaeche }]}>
        <Text style={[styles.text, { color: farben.text }]}>{t(`tipps.${id}`)}</Text>
        <TouchableOpacity hitSlop={8} style={styles.weiter} onPress={async () => {
          await alsGesehen(id);
          const n = await naechsterUngesehen(id);
          setId(n);
          if (n && n !== 'antippen') alsGesehen(n);
        }}>
          <Text style={[styles.weiterText, { color: farben.akzent }]}>{t('tipps.naechster')}</Text>
        </TouchableOpacity>
      </View>
      <TouchableOpacity hitSlop={10} onPress={() => { alsGesehen(id); setId(null); }} accessibilityLabel={t('tipps.schliessen')}>
        <Text style={[styles.x, { color: farben.gedaempft }]}>✕</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 16 },
  blase: { flex: 1, borderRadius: 12, borderTopLeftRadius: 4, paddingVertical: 10, paddingHorizontal: 12 },
  text: { fontSize: 13.5, lineHeight: 19 },
  weiter: { alignSelf: 'flex-end', marginTop: 6 },
  weiterText: { fontSize: 12.5, fontWeight: '600' },
  x: { fontSize: 14, paddingTop: 4 },
});
