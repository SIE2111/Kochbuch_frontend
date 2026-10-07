import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, Image, Pressable, StyleSheet, ActivityIndicator, Alert, Modal, TextInput } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useTheme } from '../theme/ThemeContext';
import { useUebersetzung } from '../i18n';
import { api, ApiError } from '../api/client';
import type { HaubenLevel } from '../utils/stepLevels';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../navigation/AppNavigator';
import { useLayout } from '../utils/layout';

type Props = NativeStackScreenProps<MainStackParamList, 'PoolRecipeDetail'> & {
  onClose?: () => void;
  // Beim Uebernehmen eines schon vorhandenen Rezepts (409-Fall) springt
  // die eigenstaendige Version per navigation.replace() direkt zur
  // eigenen Kopie. Eingebettet gibt es dafuer keinen Stack-Eintrag zum
  // Ersetzen - der Elternscreen (CommunityPoolScreen) wechselt stattdessen
  // selbst auf die eingebettete RecipeDetailScreen fuer diese ID.
  onOpenLocal?: (recipeId: string, title: string) => void;
};

interface PublicRecipeDetail {
  id: string;
  title: string;
  servings: number | null;
  prep_time_minutes: number | null;
  tags: string[] | null;
  cover_image_url: string | null;
  download_count: number;
  avg_rating: number | null;
  ingredients: { name: string; amount?: number | null; unit?: string | null }[];
  steps: { order: number; text: string; timer_seconds?: number | null }[];
  level: string;
  // Ob der BETRACHTER selbst der Autor ist bzw. es schon uebernommen hat -
  // vom eigenen Rezept eine Kopie anzubieten waere ein Duplikat ohne
  // Nutzen (siehe CommunityPoolScreen fuer dieselbe Unterscheidung in der
  // Liste).
  is_own?: boolean;
  already_forked?: boolean;
  // Nur gesetzt, wenn is_own - die id der PRIVATEN Quelle, die
  // /pool/unpublish erwartet.
  original_recipe_id?: string | null;
  owner_display_name?: string | null;
}

const LEVELS: { key: HaubenLevel; label: string; hats: number }[] = [
  { key: 'anfaenger', label: 'Anfänger', hats: 1 },
  { key: 'fortgeschritten', label: 'Fortgeschritten', hats: 2 },
  { key: 'profi', label: 'Profi', hats: 3 },
];

/**
 * Vollansicht eines Rezepts aus dem Community-Pool - VOR dem Uebernehmen.
 *
 * Vorher konnte man ein fremdes Rezept nur blind uebernehmen: In der Liste
 * standen Titel, Zeit und Portionen, sonst nichts. Wer wissen wollte, was
 * drin ist, musste es erst in die eigene Sammlung holen.
 *
 * Die Schritte erscheinen in der Stufe, die der BETRACHTER eingestellt
 * hat, nicht in der des Autors - wer als Anfaenger unterwegs ist, soll
 * auch fremde Rezepte kleinschrittig erklaert bekommen. Umschalten geht
 * hier trotzdem, ohne die eigene Grundeinstellung zu aendern.
 */
export default function PoolRecipeDetailScreen({ route, navigation, onClose, onOpenLocal }: Props) {
  const { publicRecipeId } = route.params;
  const eingebettet = !!onClose;
  const schliessen = onClose ?? (() => navigation.goBack());
  const oeffneLocal = onOpenLocal ?? ((recipeId: string, title: string) => navigation.replace('RecipeDetail', { recipeId, title }));
  const { colors, gradient, radius } = useTheme();
  const { inhaltsBreite } = useLayout();
  const { t } = useUebersetzung();
  const [recipe, setRecipe] = useState<PublicRecipeDetail | null>(null);
  const [level, setLevel] = useState<HaubenLevel>('fortgeschritten');
  const [isLoading, setIsLoading] = useState(true);
  const [isSwitchingLevel, setIsSwitchingLevel] = useState(false);
  const [isForking, setIsForking] = useState(false);
  const [isUnpublishing, setIsUnpublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Gerade JETZT in dieser Sitzung uebernommen - fuer "Übernommen ✓" mit
  // Zielordner-Hinweis, ohne Dialog (Auftrag Punkt 12). justForked statt
  // nur den Ordnernamen zu pruefen, weil der Ordnername null sein kann
  // (Fallback-Ordner unbekannt) und das trotzdem ein Erfolg ist.
  const [justForked, setJustForked] = useState(false);
  const [justForkedFolder, setJustForkedFolder] = useState<string | null>(null);
  // Nachricht an den Einsteller (23.09.2026) - eigenes kleines Modal statt
  // eines vollen Postfachs: Text eingeben, Server verschickt per E-Mail
  // (siehe /pool/{id}/contact-owner), reply_to zeigt auf den Absender.
  const [nachrichtOffen, setNachrichtOffen] = useState(false);
  const [nachrichtText, setNachrichtText] = useState('');
  const [nachrichtSendet, setNachrichtSendet] = useState(false);

  const sendeNachricht = async () => {
    const text = nachrichtText.trim();
    if (!text) return;
    setNachrichtSendet(true);
    try {
      await api.post(`/pool/${publicRecipeId}/contact-owner`, { message: text });
      setNachrichtOffen(false);
      setNachrichtText('');
      Alert.alert(t('sonstiges.nachrichtGesendetTitel'), t('sonstiges.nachrichtGesendetText'));
    } catch (err) {
      Alert.alert(t('allgemein.fehler'), err instanceof ApiError ? err.detail : t('sonstiges.nachrichtFehlgeschlagen'));
    } finally {
      setNachrichtSendet(false);
    }
  };

  const load = async (wantedLevel: HaubenLevel) => {
    try {
      const data = await api.get<PublicRecipeDetail>(
        `/pool/${publicRecipeId}?level=${wantedLevel}`,
      );
      setRecipe(data);
      // Das Backend kann auf die Grundfassung zurueckfallen, wenn die
      // Umrechnung scheitert - dann soll die Anzeige nicht behaupten,
      // man lese gerade die Anfaengerfassung.
      setLevel(data.level as HaubenLevel);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : t('detail.nichtGeladen'));
    }
  };

  useEffect(() => {
    // Startstufe ist die eigene Einstellung aus dem Profil.
    api
      .get<{ default_hauben_level: HaubenLevel }>('/preferences/')
      .then((prefs) => load(prefs.default_hauben_level))
      .catch(() => load('fortgeschritten'))
      .finally(() => setIsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicRecipeId]);

  const handleLevelChange = async (next: HaubenLevel) => {
    if (next === level || isSwitchingLevel) return;
    setIsSwitchingLevel(true);
    await load(next);
    setIsSwitchingLevel(false);
  };

  // Ohne Dialog (Auftrag Punkt 12): bei Erfolg wird der Knopf direkt hier
  // zu "Übernommen ✓" mit Zielordner-Hinweis; ein 409 (schon uebernommen)
  // oeffnet die vorhandene Kopie direkt.
  const handleFork = async () => {
    if (!recipe) return;
    setIsForking(true);
    try {
      const result = await api.post<{ local_recipe_id: string; folder_name?: string }>(`/pool/${recipe.id}/fork`);
      setJustForked(true);
      setJustForkedFolder(result.folder_name ?? null);
      setRecipe((prev) => (prev ? { ...prev, already_forked: true } : prev));
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const localRecipeId = (err.data as { local_recipe_id?: string } | undefined)?.local_recipe_id;
        if (localRecipeId) {
          oeffneLocal(localRecipeId, recipe.title);
          return;
        }
      }
      Alert.alert(t('sonstiges.uebernehmenFehlgeschlagen'), err instanceof ApiError ? err.detail : t('profil.unbekannterFehler'));
    } finally {
      setIsForking(false);
    }
  };

  const handleOpenExisting = async () => {
    if (!recipe) return;
    setIsForking(true);
    try {
      await api.post(`/pool/${recipe.id}/fork`);
      // Sollte hier eigentlich nie ohne Fehler durchgehen (already_forked
      // ist ja schon true) - zur Sicherheit trotzdem kein Absturz.
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const localRecipeId = (err.data as { local_recipe_id?: string } | undefined)?.local_recipe_id;
        if (localRecipeId) {
          oeffneLocal(localRecipeId, recipe.title);
          return;
        }
      }
      Alert.alert(t('sonstiges.uebernehmenFehlgeschlagen'), err instanceof ApiError ? err.detail : t('profil.unbekannterFehler'));
    } finally {
      setIsForking(false);
    }
  };

  // Eigenes Rezept aus dem Pool nehmen - dieselbe Aktion wie der Knopf
  // im eigenen Rezeptdetail (PublishToPoolButton), hier direkt aus der
  // Pool-Ansicht heraus, weil man genau von hier kommt, wenn man das
  // eigene Rezept im Pool nachschlaegt.
  const handleUnpublish = () => {
    if (!recipe?.original_recipe_id) return;
    Alert.alert(
      t('sonstiges.ausPoolFrage'),
      t('sonstiges.ausPoolText', { titel: recipe.title }),
      [
        { text: t('allgemein.abbrechen'), style: 'cancel' },
        {
          text: t('sonstiges.ausPoolNehmen'),
          style: 'destructive',
          onPress: async () => {
            setIsUnpublishing(true);
            try {
              await api.post('/pool/unpublish', { recipe_id: recipe.original_recipe_id });
              Alert.alert(t('sonstiges.ausPoolEntfernt'), t('sonstiges.ausPoolEntferntText', { titel: recipe.title }));
              schliessen();
            } catch (err) {
              Alert.alert(
                t('sonstiges.ausPoolEntfernenFehlgeschlagen'),
                err instanceof ApiError ? err.detail : t('profil.unbekannterFehler'),
              );
              setIsUnpublishing(false);
            }
          },
        },
      ],
    );
  };

  if (isLoading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.bg }]}>
        <ActivityIndicator color={colors.muted} />
      </View>
    );
  }

  if (error || !recipe) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.bg, padding: 24 }]}>
        <Text style={{ color: colors.muted, fontSize: 13, textAlign: 'center' }}>
          {error ?? t('sonstiges.rezeptNichtGefunden')}
        </Text>
      </View>
    );
  }

  const meta = [
    recipe.prep_time_minutes ? `${recipe.prep_time_minutes} Min.` : null,
    recipe.servings ? `${recipe.servings} Portionen` : null,
    `${recipe.download_count}× übernommen`,
    recipe.avg_rating ? `★ ${recipe.avg_rating}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <>
    {eingebettet && (
      <View style={[styles.eingebetterHeader, { backgroundColor: colors.bg, borderBottomColor: colors.cardBorder }]}>
        <Text style={[styles.eingebetterTitel, { color: colors.text }]} numberOfLines={1}>
          {recipe.title}
        </Text>
        <Pressable onPress={schliessen} hitSlop={10} style={styles.eingebetterSchliessen}>
          <MaterialCommunityIcons name="close" size={18} color={colors.text} />
          <Text style={{ color: colors.text, fontSize: 13.5, fontWeight: '600' }}>{t('allgemein.schliessen')}</Text>
        </Pressable>
      </View>
    )}
    <ScrollView automaticallyAdjustKeyboardInsets
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={[styles.container, inhaltsBreite]}
    >
      {recipe.cover_image_url && (
        <Image
          source={{ uri: recipe.cover_image_url }}
          style={[styles.cover, { borderRadius: radius.md }]}
          resizeMode="cover"
        />
      )}

      <Text style={[styles.title, { color: colors.text }]}>{recipe.title}</Text>
      <Text style={[styles.meta, { color: colors.muted }]}>{meta}</Text>
      {recipe.tags && recipe.tags.length > 0 && (
        <Text style={[styles.meta, { color: colors.muted }]}>{recipe.tags.join(' · ')}</Text>
      )}
      {!recipe.is_own && recipe.owner_display_name && (
        <Text style={[styles.meta, { color: colors.muted }]}>
          {t('rezepte.vonMitglied', { name: recipe.owner_display_name })}
        </Text>
      )}

      {recipe.is_own ? (
        <Pressable
          onPress={handleUnpublish}
          disabled={isUnpublishing || !recipe.original_recipe_id}
          style={[styles.forkButton, styles.dangerButton, { borderRadius: radius.md }]}
        >
          {isUnpublishing ? (
            <ActivityIndicator color={colors.muted} />
          ) : (
            <Text style={[styles.forkButtonText, { color: '#C0392B' }]}>{t('sonstiges.ausPoolNehmen')}</Text>
          )}
        </Pressable>
      ) : justForked ? (
        <View style={[styles.forkButton, styles.disabledButton, { borderRadius: radius.md }]}>
          <Text style={[styles.forkButtonText, { color: '#16A34A' }]}>
            {t('sonstiges.uebernommenHaken')}{justForkedFolder ? ` – ${justForkedFolder}` : ''}
          </Text>
        </View>
      ) : recipe.already_forked ? (
        <Pressable
          onPress={handleOpenExisting}
          disabled={isForking}
          style={[styles.forkButton, styles.disabledButton, { borderRadius: radius.md }]}
        >
          {isForking ? (
            <ActivityIndicator color={colors.muted} />
          ) : (
            <Text style={[styles.forkButtonText, { color: gradient[0] }]}>{t('sonstiges.inSammlungOeffnen')}</Text>
          )}
        </Pressable>
      ) : (
        <Pressable
          onPress={handleFork}
          disabled={isForking}
          style={[styles.forkButton, { backgroundColor: gradient[0], borderRadius: radius.md }]}
        >
          {isForking ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.forkButtonText}>{t('sonstiges.inKochbuchUebernehmen')}</Text>
          )}
        </Pressable>
      )}

      {!recipe.is_own && (
        <Pressable onPress={() => setNachrichtOffen(true)} style={styles.nachrichtLink}>
          <MaterialCommunityIcons name="email-outline" size={15} color={colors.muted} />
          <Text style={{ color: colors.muted, fontSize: 12.5, fontWeight: '600' }}>
            {t('sonstiges.nachrichtSchreiben')}
          </Text>
        </Pressable>
      )}

      <Text style={[styles.sectionLabel, { color: colors.muted }]}>ZUTATEN</Text>
      {recipe.ingredients.map((ing, i) => (
        <View key={i} style={styles.ingredientRow}>
          <Text style={[styles.ingredientAmount, { color: colors.muted }]}>
            {[ing.amount ?? '', ing.unit ?? ''].filter(Boolean).join(' ')}
          </Text>
          <Text style={[styles.ingredientName, { color: colors.text }]}>{ing.name}</Text>
        </View>
      ))}

      <View style={styles.stepsHeader}>
        <Text style={[styles.sectionLabel, { color: colors.muted, marginTop: 0 }]}>ZUBEREITUNG</Text>
        {isSwitchingLevel && <ActivityIndicator size="small" color={colors.muted} />}
      </View>

      {/* Stufe hier umschaltbar, ohne die Grundeinstellung im Profil zu
          aendern: Man will vielleicht nur bei diesem einen fremden Rezept
          genauer nachlesen. */}
      <View style={styles.levelRow}>
        {LEVELS.map((l) => {
          const active = l.key === level;
          return (
            <Pressable
              key={l.key}
              onPress={() => handleLevelChange(l.key)}
              disabled={isSwitchingLevel}
              style={[
                styles.levelChip,
                {
                  backgroundColor: active ? gradient[0] : colors.card,
                  borderRadius: radius.sm,
                  opacity: isSwitchingLevel && !active ? 0.5 : 1,
                },
              ]}
            >
              <Text style={{ fontSize: 11, marginRight: 4 }}>
                {Array.from({ length: l.hats }).map(() => '👨‍🍳').join('')}
              </Text>
              <Text style={{ color: active ? '#fff' : colors.muted, fontSize: 11.5, fontWeight: '600' }}>
                {l.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {recipe.steps.map((step) => (
        <View key={step.order} style={[styles.stepCard, { backgroundColor: colors.card, borderRadius: radius.md }]}>
          <Text style={[styles.stepNumber, { color: colors.muted }]}>{t('detail.schritt', { nummer: step.order })}</Text>
          <Text style={[styles.stepText, { color: colors.text }]}>{step.text}</Text>
          {step.timer_seconds ? (
            <View style={styles.timerRow}>
              <MaterialCommunityIcons name="timer-outline" size={13} color={colors.muted} />
              <Text style={{ color: colors.muted, fontSize: 11.5 }}>
                {Math.round(step.timer_seconds / 60)} Min.
              </Text>
            </View>
          ) : null}
        </View>
      ))}
    </ScrollView>

    <Modal visible={nachrichtOffen} transparent animationType="fade" onRequestClose={() => setNachrichtOffen(false)}>
      <View style={styles.modalUeberlagerung}>
        <View style={[styles.modalKarte, { backgroundColor: colors.card, borderRadius: radius.md }]}>
          <Text style={[styles.modalTitle, { color: colors.text }]}>{t('sonstiges.nachrichtSchreiben')}</Text>
          <Text style={[styles.meta, { color: colors.muted, marginBottom: 12 }]}>
            {t('sonstiges.nachrichtHinweis', { titel: recipe.title })}
          </Text>
          <TextInput
            value={nachrichtText}
            onChangeText={setNachrichtText}
            placeholder={t('sonstiges.nachrichtPlatzhalter')}
            placeholderTextColor={colors.muted}
            multiline
            numberOfLines={5}
            style={[styles.nachrichtInput, { backgroundColor: colors.bg, color: colors.text, borderRadius: radius.sm }]}
          />
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
            <Pressable
              onPress={() => setNachrichtOffen(false)}
              style={[styles.modalKnopf, { borderColor: colors.muted, borderWidth: 1, borderRadius: radius.sm }]}
            >
              <Text style={{ color: colors.muted, fontWeight: '600' }}>{t('allgemein.abbrechen')}</Text>
            </Pressable>
            <Pressable
              onPress={sendeNachricht}
              disabled={nachrichtSendet || !nachrichtText.trim()}
              style={[
                styles.modalKnopf,
                { backgroundColor: gradient[0], borderRadius: radius.sm, opacity: !nachrichtText.trim() ? 0.5 : 1 },
              ]}
            >
              {nachrichtSendet ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={{ color: '#fff', fontWeight: '700' }}>{t('sonstiges.senden')}</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  eingebetterHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 12, borderBottomWidth: 1 },
  eingebetterTitel: { fontSize: 15.5, fontWeight: '700', flex: 1, marginRight: 12 },
  eingebetterSchliessen: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  nachrichtLink: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center', marginTop: 10, marginBottom: 4, padding: 6 },
  modalUeberlagerung: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 24 },
  modalKarte: { padding: 20 },
  modalTitle: { fontSize: 15.5, fontWeight: '700', marginBottom: 6 },
  modalKnopf: { flex: 1, height: 46, alignItems: 'center', justifyContent: 'center' },
  nachrichtInput: { minHeight: 100, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13.5, textAlignVertical: 'top' },
  container: { padding: 18, paddingBottom: 60 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  cover: { width: '100%', height: 190, marginBottom: 14 },
  title: { fontSize: 21, fontWeight: '700' },
  meta: { fontSize: 12, marginTop: 4 },
  forkButton: { height: 46, alignItems: 'center', justifyContent: 'center', marginTop: 16 },
  dangerButton: { backgroundColor: '#FBEAE8', borderWidth: 1, borderColor: '#F0C6C1' },
  disabledButton: { backgroundColor: '#EFEFEF' },
  forkButtonText: { color: '#fff', fontWeight: '700', fontSize: 14.5 },
  sectionLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5, marginTop: 26, marginBottom: 8 },
  ingredientRow: { flexDirection: 'row', paddingVertical: 5 },
  ingredientAmount: { width: 82, fontSize: 13 },
  ingredientName: { flex: 1, fontSize: 13.5 },
  stepsHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 26 },
  levelRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  levelChip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 7 },
  stepCard: { padding: 13, marginBottom: 9 },
  stepNumber: { fontSize: 10.5, fontWeight: '700', marginBottom: 4 },
  stepText: { fontSize: 14, lineHeight: 21 },
  timerRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 7 },
});
