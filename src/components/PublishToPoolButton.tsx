import React, { useState } from 'react';
import { Pressable, StyleSheet, ActivityIndicator, Alert, View, Text, Modal, ScrollView } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useTheme } from '../theme/ThemeContext';
import { useUebersetzung } from '../i18n';
import { api, ApiError } from '../api/client';
import { useServerSync } from '../context/ServerSyncContext';

interface MeinPool {
  id: string;
  name: string;
  is_community: boolean;
  active: boolean;
}

/**
 * Kleiner Knopf "ins Gemeinschaftskochbuch stellen" - sitzt direkt an der
 * Rezeptzeile bzw. auf der Rezeptseite, damit Veroeffentlichen dort
 * moeglich ist, wo man das Rezept gerade sieht, statt in einem Menue
 * dahinter.
 *
 * Bewusst mit Rueckfrage: Veroeffentlichen macht das Rezept fuer alle
 * sichtbar und laesst sich nicht stillschweigend rueckgaengig machen
 * (Kopien, die andere bereits uebernommen haben, bleiben bestehen). Ein
 * Knopf, der das auf einen Fingertipp ohne Nachfrage tut, waere in einer
 * Liste neben "oeffnen" zu gefaehrlich.
 *
 * Die Fehlerfaelle des Backends sind echte, erwartbare Zustaende und
 * werden deshalb im Klartext gezeigt statt als "Unbekannter Fehler":
 * fehlender Server-Sync (403), Tageslimit (429) und die inhaltliche
 * KI-Vorpruefung (400).
 */
export default function PublishToPoolButton({
  recipeId,
  recipeTitle,
  size = 18,
  style,
  // Ob das Rezept schon veroeffentlicht ist, wenn der Bildschirm
  // OEFFNET - vom Rezeptdetail aus recipe.visibility === 'public_pool'
  // gereicht. Ohne das wuesste der Knopf beim Wiederoeffnen eines
  // frueher veroeffentlichten Rezepts nichts von diesem Zustand und
  // wuerde faelschlich "Veroeffentlichen" statt "Aus dem Pool nehmen"
  // anbieten.
  initialPublished = false,
}: {
  recipeId: string;
  recipeTitle: string;
  size?: number;
  style?: object;
  initialPublished?: boolean;
}) {
  const { colors, gradient, radius } = useTheme();
  const { t } = useUebersetzung();
  const { serverSyncEnabled, isLoading: syncLoading } = useServerSync();
  const [isPublishing, setIsPublishing] = useState(false);
  const [isPublished, setIsPublished] = useState(initialPublished);
  // Fenster IMMER zeigen (23.09.2026, vorher nur bei >1 aktiven Pools) -
  // bei nur einem aktiven ist der schon vormarkiert, man muss nur noch
  // "Übernehmen" antippen statt eines zweiten Rueckfrage-Dialogs.
  // Mehrfachauswahl: ein Rezept kann in mehrere Pools gleichzeitig.
  const [poolAuswahl, setPoolAuswahl] = useState<MeinPool[] | null>(null);
  const [ausgewaehlteIds, setAusgewaehlteIds] = useState<Set<string>>(new Set());

  // Solange der Wert noch laedt, NICHT sperren: Ein kurz verzoegerter
  // Ladevorgang darf nicht wie eine Sperre aussehen.
  const isLocked = !syncLoading && !serverSyncEnabled;

  // publish() ohne eigenen Alert (23.09.2026) - wird jetzt aus einer
  // Schleife heraus fuer mehrere Pools auf einmal aufgerufen, da waere
  // ein Alert PRO Pool störend gestapelt. Die Zusammenfassung uebernimmt
  // veroeffentlicheAusgewaehlte() unten.
  const publish = async (poolId: string): Promise<{ ok: true; coins: number } | { ok: false; status?: number; detail: string }> => {
    try {
      // Im oeffentlichen Pool bekommt man 5 AI Coins gutgeschrieben (einmal je Rezept)
      const antwort = await api.post<{ coins_gutgeschrieben?: number }>('/pool/publish', { recipe_id: recipeId, pool_id: poolId });
      return { ok: true, coins: antwort?.coins_gutgeschrieben ?? 0 };
    } catch (err) {
      return {
        ok: false,
        status: err instanceof ApiError ? err.status : undefined,
        detail: err instanceof ApiError ? err.detail : t('profil.unbekannterFehler'),
      };
    }
  };

  const veroeffentlicheAusgewaehlte = async () => {
    if (ausgewaehlteIds.size === 0) {
      Alert.alert(t('sonstiges.keinPoolMarkiert'), t('sonstiges.keinPoolMarkiertText'));
      return;
    }
    setIsPublishing(true);
    const ziele = Array.from(ausgewaehlteIds);
    try {
      const ergebnisse = await Promise.all(ziele.map((id) => publish(id)));
      setPoolAuswahl(null);
      const erfolge = ergebnisse.filter((r) => r.ok).length;
      const fehler = ergebnisse.filter((r) => !r.ok);
      if (erfolge > 0) setIsPublished(true);

      const belohnung = ergebnisse.reduce((summe, r) => summe + (r.ok ? r.coins : 0), 0);
      if (fehler.length === 0) {
        Alert.alert(
          t('sonstiges.veroeffentlicht'),
          belohnung > 0
            ? t('sonstiges.veroeffentlichtBelohnung', { titel: recipeTitle, n: belohnung })
            : t('sonstiges.veroeffentlichtText', { titel: recipeTitle }),
        );
      } else {
        // Mind. ein Ziel fehlgeschlagen (z.B. Tageslimit) - konkret sagen,
        // wie viele es trotzdem geschafft haben, statt eines pauschalen
        // Fehlers, der einen erfolgreichen Teil verschweigen wuerde.
        const ersterFehler = fehler[0];
        const titel =
          ersterFehler.status === 403
            ? t('sonstiges.syncNoetig')
            : ersterFehler.status === 429
              ? t('sonstiges.tageslimit')
              : t('sonstiges.veroeffentlichenFehlgeschlagen');
        Alert.alert(
          titel,
          erfolge > 0
            ? t('sonstiges.teilweiseVeroeffentlicht', { erfolge, gesamt: ziele.length, fehler: ersterFehler.detail })
            : ersterFehler.detail,
        );
      }
    } finally {
      setIsPublishing(false);
    }
  };

  // Keyed ueber die PRIVATE recipe_id, nicht die id des PublicRecipe-
  // Datensatzes - die kennt dieser Knopf gar nicht (siehe
  // routers/pool.py unpublish_recipe fuer den Grund).
  const unpublish = async () => {
    setIsPublishing(true);
    try {
      await api.post('/pool/unpublish', { recipe_id: recipeId });
      setIsPublished(false);
      Alert.alert(t('sonstiges.ausPoolEntfernt'), t('sonstiges.ausPoolEntferntText', { titel: recipeTitle }));
    } catch (err) {
      Alert.alert(
        t('sonstiges.ausPoolEntfernenFehlgeschlagen'),
        err instanceof ApiError ? err.detail : t('profil.unbekannterFehler'),
      );
    } finally {
      setIsPublishing(false);
    }
  };

  const confirm = async () => {
    if (isPublishing) return;
    if (isPublished) {
      // Bewusst mit derselben Rueckfrage-Staerke wie das Veroeffentlichen
      // selbst: Kopien, die andere schon uebernommen haben, bleiben
      // bestehen - das steht auch schon im Text beim Veroeffentlichen,
      // hier wird es noch einmal explizit gesagt, weil es der Moment ist,
      // in dem es tatsaechlich relevant wird.
      Alert.alert(
        t('sonstiges.ausPoolFrage'),
        t('sonstiges.ausPoolText', { titel: recipeTitle }),
        [
          { text: t('allgemein.abbrechen'), style: 'cancel' },
          { text: t('sonstiges.ausPoolNehmen'), style: 'destructive', onPress: unpublish },
        ],
      );
      return;
    }
    if (isLocked) {
      // Der Knopf ist sichtbar ausgegraut - wer ihn trotzdem antippt,
      // bekommt den Grund gesagt statt gar nichts. Ein Knopf, der auf
      // Beruehrung schweigt, wirkt kaputt.
      Alert.alert(
        t('sonstiges.syncNoetig'),
        t('sonstiges.teilenBrauchtSync'),
      );
      return;
    }

    // Aktive Pools erst hier laden (nicht vorab beim Rendern) - der
    // Knopf sitzt in Listenzeilen, ein Netzwerkaufruf pro Zeile beim
    // blossen Anzeigen waere unnoetig teuer.
    setIsPublishing(true);
    let meinePools: MeinPool[] = [];
    try {
      meinePools = await api.get<MeinPool[]>('/pools/');
    } catch {
      // Fehlschlag hier soll das gewohnte Veroeffentlichen nicht
      // blockieren - einfach so weitermachen, als gaebe es nur den
      // Community-Pool (bisheriges Verhalten).
    } finally {
      setIsPublishing(false);
    }
    const aktive = meinePools.filter((p) => p.active);
    // Bei genau einem aktiven Pool ist er schon markiert - ein Tipp auf
    // "Übernehmen" reicht dann. Bei mehreren startet die Auswahl leer,
    // bewusst kein Vorauswaehlen aller, damit nicht versehentlich in
    // mehr Pools veroeffentlicht wird als gewollt.
    setAusgewaehlteIds(new Set(aktive.length === 1 ? [aktive[0].id] : []));
    setPoolAuswahl(aktive);
  };

  return (
    <>
    <Pressable
      onPress={confirm}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={
        isPublished
          ? t('sonstiges.ausPoolNehmen')
          : isLocked
            ? t('sonstiges.insPoolOhneSync')
            : t('sonstiges.insPool')
      }
      accessibilityState={{ disabled: isLocked }}
      style={[styles.button, isLocked && styles.locked, style]}
    >
      {isPublishing ? (
        <ActivityIndicator size="small" color={colors.muted} />
      ) : (
        <MaterialCommunityIcons
          name={isPublished ? 'account-group' : 'account-group-outline'}
          size={size}
          color={isPublished ? gradient[0] : colors.muted}
        />
      )}
    </Pressable>

    <Modal visible={!!poolAuswahl} transparent animationType="fade" onRequestClose={() => setPoolAuswahl(null)}>
      <View style={styles.modalUeberlagerung}>
        <View style={[styles.modalKarte, { backgroundColor: colors.card, borderRadius: radius.md }]}>
          <Text style={[styles.modalTitel, { color: colors.text }]}>{t('sonstiges.poolWaehlen')}</Text>
          {poolAuswahl && poolAuswahl.length === 0 ? (
            <Text style={{ color: colors.muted, fontSize: 13, paddingVertical: 10 }}>{t('sonstiges.keineAktivenPools')}</Text>
          ) : (
            <ScrollView style={{ maxHeight: 300 }}>
              {(poolAuswahl ?? []).map((p) => {
                const ausgewaehlt = ausgewaehlteIds.has(p.id);
                return (
                  <Pressable
                    key={p.id}
                    onPress={() =>
                      setAusgewaehlteIds((prev) => {
                        const naechste = new Set(prev);
                        if (naechste.has(p.id)) naechste.delete(p.id);
                        else naechste.add(p.id);
                        return naechste;
                      })
                    }
                    style={[styles.poolZeile, { borderColor: colors.cardBorder }]}
                  >
                    <MaterialCommunityIcons
                      name={ausgewaehlt ? 'checkbox-marked' : 'checkbox-blank-outline'}
                      size={19}
                      color={ausgewaehlt ? gradient[0] : colors.muted}
                    />
                    <MaterialCommunityIcons
                      name={p.is_community ? 'earth' : 'account-group'}
                      size={17}
                      color={colors.muted}
                      style={{ marginLeft: 10 }}
                    />
                    <Text style={{ color: colors.text, fontSize: 14, marginLeft: 8 }}>{p.name}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
            <Pressable
              onPress={() => setPoolAuswahl(null)}
              style={[styles.modalKnopf, { borderColor: colors.muted, borderWidth: 1, borderRadius: radius.sm }]}
            >
              <Text style={{ color: colors.muted, fontWeight: '600' }}>{t('allgemein.abbrechen')}</Text>
            </Pressable>
            <Pressable
              onPress={veroeffentlicheAusgewaehlte}
              disabled={isPublishing}
              style={[
                styles.modalKnopf,
                { backgroundColor: gradient[0], borderRadius: radius.sm, opacity: ausgewaehlteIds.size === 0 ? 0.5 : 1 },
              ]}
            >
              {isPublishing ? <ActivityIndicator color="#fff" size="small" /> : <Text style={{ color: '#fff', fontWeight: '700' }}>{t('sonstiges.veroeffentlichen')}</Text>}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  button: { padding: 4 },
  // Ausgegraut statt versteckt: Der Knopf soll erkennbar bleiben, damit
  // klar ist, dass es die Funktion gibt - sie ist nur gerade nicht
  // freigeschaltet.
  locked: { opacity: 0.35 },
  modalUeberlagerung: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 24 },
  modalKarte: { padding: 20 },
  modalTitel: { fontSize: 15.5, fontWeight: '700', marginBottom: 12 },
  poolZeile: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1 },
  modalKnopf: { flex: 1, height: 46, alignItems: 'center', justifyContent: 'center' },
});
