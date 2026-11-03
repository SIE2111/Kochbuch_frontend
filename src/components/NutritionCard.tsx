import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator, TextInput, Keyboard } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useTheme } from '../theme/ThemeContext';
import { api, ApiError } from '../api/client';
import { useUebersetzung } from '../i18n';

type Anteil = {
  name: string;
  gramm: number;
  kcal: number;
  unsicher: boolean;
};

type Antwort = {
  portionen: number;
  calories_kcal: number;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
  unsichere_zutaten: number;
  anteile: Anteil[];
  vom_benutzer?: boolean;
};

type Props = {
  recipeId: string;
  /** Bereits gespeicherte Werte aus dem Rezept, falls schon geschätzt. */
  gespeichert?: {
    calories_kcal?: number | null;
    protein_g?: number | null;
    fat_g?: number | null;
    carbs_g?: number | null;
    nutrition_user_edited?: boolean;
  };
};

/**
 * Naehrwerte je Portion.
 *
 * Bewusst auf Knopfdruck statt beim Oeffnen: Die Schaetzung kostet einen
 * KI-Aufruf, und die meisten Rezepte werden gekocht, nicht bilanziert.
 * Einmal berechnet, liegt sie am Rezept und wird ohne weiteren Aufruf
 * angezeigt.
 *
 * Gerundet und ohne Nachkommastellen - zu einer Schaetzung passen keine
 * zwei Nachkommastellen, die eine Genauigkeit vortaeuschen, die es nicht
 * gibt.
 */
export default function NutritionCard({ recipeId, gespeichert }: Props) {
  const { colors, radius, gradient } = useTheme();
  const { t } = useUebersetzung();

  const hatGespeicherte = gespeichert?.calories_kcal != null;
  const [werte, setWerte] = useState<Antwort | null>(
    hatGespeicherte
      ? {
          portionen: 1,
          calories_kcal: gespeichert!.calories_kcal!,
          protein_g: gespeichert!.protein_g ?? 0,
          fat_g: gespeichert!.fat_g ?? 0,
          carbs_g: gespeichert!.carbs_g ?? 0,
          unsichere_zutaten: 0,
          anteile: [],
          vom_benutzer: !!gespeichert?.nutrition_user_edited,
        }
      : null,
  );
  // Von Hand aendern (03.11.2026): kostenlos, danach "vom Benutzer geaendert"
  const [bearbeiten, setBearbeiten] = useState(false);
  const [eingabe, setEingabe] = useState({ kcal: '', eiweiss: '', fett: '', kh: '' });
  const bearbeitenStarten = () => {
    setEingabe({
      kcal: werte ? String(werte.calories_kcal) : '', eiweiss: werte ? String(werte.protein_g) : '',
      fett: werte ? String(werte.fat_g) : '', kh: werte ? String(werte.carbs_g) : '',
    });
    setBearbeiten(true);
  };
  const zahl = (s: string) => Math.max(0, Math.round(Number(String(s).replace(',', '.')) || 0));
  const speichern = async () => {
    Keyboard.dismiss();
    setLaeuft(true);
    setFehler(null);
    try {
      const res = await api.put<Antwort>(`/nutrition/${recipeId}`, {
        calories_kcal: zahl(eingabe.kcal), protein_g: zahl(eingabe.eiweiss), fat_g: zahl(eingabe.fett), carbs_g: zahl(eingabe.kh),
      });
      setWerte(res);
      setBearbeiten(false);
    } catch (err) {
      setFehler(err instanceof ApiError ? err.detail : t('naehrwerte.speichernFehlgeschlagen'));
    } finally {
      setLaeuft(false);
    }
  };
  const feld = (beschriftung: string, wert: string, setze: (v: string) => void, einheit: string) => (
    <View style={styles.kachel}>
      <Text style={[styles.kachelLabel, { color: colors.text, marginBottom: 4 }]}>{beschriftung}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <TextInput
          value={wert}
          onChangeText={setze}
          keyboardType="number-pad"
          returnKeyType="done"
          onSubmitEditing={() => Keyboard.dismiss()}
          style={[styles.eingabe, { color: colors.text, borderColor: colors.muted + '66', borderRadius: radius.sm }]}
        />
        <Text style={{ color: colors.muted, fontSize: 13 }}>{einheit}</Text>
      </View>
    </View>
  );
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  const schaetzen = async (neu = false) => {
    setLaeuft(true);
    setFehler(null);
    try {
      const res = await api.post<Antwort>(`/nutrition/${recipeId}${neu ? '?force=true' : ''}`, {});
      setWerte(res);
    } catch (err) {
      setFehler(err instanceof ApiError ? err.detail : t('naehrwerte.fehlgeschlagen'));
    } finally {
      setLaeuft(false);
    }
  };

  const kachel = (icon: string, beschriftung: string, wert: number, einheit: string) => (
    <View style={styles.kachel}>
      <View style={styles.kachelKopf}>
        <MaterialCommunityIcons name={icon as any} size={15} color={gradient[0]} />
        <Text style={[styles.kachelLabel, { color: colors.text }]}>{beschriftung}</Text>
      </View>
      <Text style={[styles.kachelWert, { color: colors.text }]}>
        {wert}
        <Text style={[styles.kachelEinheit, { color: colors.muted }]}> {einheit}</Text>
      </Text>
    </View>
  );

  return (
    <View style={[styles.karte, { backgroundColor: colors.card, borderRadius: radius.md }]}>
      <Text style={[styles.titel, { color: colors.text }]}>{t('naehrwerte.titel')}</Text>

      {bearbeiten && (
        <>
          <View style={styles.raster}>
            {feld(t('naehrwerte.energie'), eingabe.kcal, (v) => setEingabe((e) => ({ ...e, kcal: v })), 'kcal')}
            {feld(t('naehrwerte.eiweiss'), eingabe.eiweiss, (v) => setEingabe((e) => ({ ...e, eiweiss: v })), 'g')}
            {feld(t('naehrwerte.fett'), eingabe.fett, (v) => setEingabe((e) => ({ ...e, fett: v })), 'g')}
            {feld(t('naehrwerte.kohlenhydrate'), eingabe.kh, (v) => setEingabe((e) => ({ ...e, kh: v })), 'g')}
          </View>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
            <Pressable onPress={speichern} disabled={laeuft} style={[styles.knopf, { flex: 1, backgroundColor: gradient[0], borderRadius: radius.sm }]}>
              <Text style={styles.knopfText}>{t('naehrwerte.speichern')}</Text>
            </Pressable>
            <Pressable onPress={() => setBearbeiten(false)} style={[styles.knopf, { borderRadius: radius.sm }]}>
              <Text style={{ color: colors.muted, fontSize: 14, fontWeight: '600' }}>{t('naehrwerte.abbrechen')}</Text>
            </Pressable>
          </View>
        </>
      )}

      {!werte && !laeuft && !bearbeiten && (
        <Pressable
          onPress={() => schaetzen()}
          style={[styles.knopf, { backgroundColor: gradient[0], borderRadius: radius.sm }]}
        >
          <MaterialCommunityIcons name="calculator-variant-outline" size={16} color="#fff" />
          <Text style={styles.knopfText}>{t('naehrwerte.schaetzen')}</Text>
        </Pressable>
      )}

      {laeuft && (
        <View style={styles.laeuftZeile}>
          <ActivityIndicator size="small" color={gradient[0]} />
          <Text style={[styles.laeuftText, { color: colors.muted }]}>{t('naehrwerte.laeuft')}</Text>
        </View>
      )}

      {!werte && !laeuft && !bearbeiten && (
        <Pressable onPress={bearbeitenStarten} style={styles.neuKnopf}>
          <Text style={{ color: gradient[0], fontSize: 12.5, fontWeight: '600' }}>{t('naehrwerte.selbstEintragen')}</Text>
        </Pressable>
      )}

      {werte && !bearbeiten && (
        <>
          {werte.vom_benutzer && (
            <View style={styles.vermerk}>
              <MaterialCommunityIcons name="account-edit-outline" size={14} color={colors.muted} />
              <Text style={{ color: colors.muted, fontSize: 12 }}>{t('naehrwerte.vomBenutzer')}</Text>
            </View>
          )}
          <View style={styles.raster}>
            {kachel('fire', t('naehrwerte.energie'), werte.calories_kcal, 'kcal')}
            {kachel('egg-outline', t('naehrwerte.eiweiss'), werte.protein_g, 'g')}
            {kachel('water-outline', t('naehrwerte.fett'), werte.fat_g, 'g')}
            {kachel('barley', t('naehrwerte.kohlenhydrate'), werte.carbs_g, 'g')}
          </View>

          {werte.anteile.length > 0 && (
            <View style={styles.anteile}>
              <Text style={[styles.anteileTitel, { color: colors.muted }]}>
                {t('naehrwerte.groessterAnteil')}
              </Text>
              {werte.anteile.slice(0, 3).map((a, i) => (
                <Text key={i} style={[styles.anteilZeile, { color: colors.muted }]}>
                  {a.name} · {Math.round(a.gramm)} g · {Math.round(a.kcal)} kcal
                  {a.unsicher ? ' ·' : ''}
                  {a.unsicher ? <Text style={{ color: '#B45309' }}> ?</Text> : null}
                </Text>
              ))}
            </View>
          )}

          {werte.unsichere_zutaten > 0 && (
            <Text style={[styles.unsicher, { color: '#B45309' }]}>
              {t('naehrwerte.unsicher', { anzahl: werte.unsichere_zutaten })}
            </Text>
          )}

          {!werte.vom_benutzer && <Text style={[styles.hinweis, { color: colors.muted }]}>{t('naehrwerte.hinweis')}</Text>}

          <View style={{ flexDirection: 'row', gap: 18 }}>
            <Pressable onPress={bearbeitenStarten} disabled={laeuft} style={styles.neuKnopf}>
              <Text style={{ color: gradient[0], fontSize: 12.5, fontWeight: '600' }}>{t('naehrwerte.aendern')}</Text>
            </Pressable>
            <Pressable onPress={() => schaetzen(true)} disabled={laeuft} style={styles.neuKnopf}>
              <Text style={{ color: gradient[0], fontSize: 12.5, fontWeight: '600' }}>
                {t('naehrwerte.neuBerechnen')}
              </Text>
            </Pressable>
          </View>
        </>
      )}

      {fehler && <Text style={[styles.fehler, { color: '#DC2626' }]}>{fehler}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  karte: { padding: 16, marginTop: 10 },
  titel: { fontSize: 16, fontWeight: '700', marginBottom: 12 },
  knopf: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    minHeight: 44, paddingHorizontal: 16,
  },
  knopfText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  laeuftZeile: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 },
  laeuftText: { fontSize: 13 },
  raster: { flexDirection: 'row', flexWrap: 'wrap' },
  kachel: { width: '50%', paddingVertical: 8, paddingRight: 8 },
  kachelKopf: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  kachelLabel: { fontSize: 13, fontWeight: '600' },
  kachelWert: { fontSize: 20, fontWeight: '700' },
  kachelEinheit: { fontSize: 13, fontWeight: '500' },
  anteile: { marginTop: 10 },
  anteileTitel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 4 },
  anteilZeile: { fontSize: 12, lineHeight: 18 },
  unsicher: { fontSize: 12, marginTop: 8, fontWeight: '600' },
  hinweis: { fontSize: 11.5, lineHeight: 16, marginTop: 10 },
  neuKnopf: { minHeight: 44, justifyContent: 'center' },
  fehler: { fontSize: 12.5, marginTop: 8 },
  eingabe: { minWidth: 70, height: 40, borderWidth: 1, paddingHorizontal: 10, fontSize: 16 },
  vermerk: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 6 },
});
