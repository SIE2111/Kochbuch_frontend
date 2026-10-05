import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, Pressable, StyleSheet, Image, PanResponder, ActivityIndicator, Modal,
} from 'react-native';
import * as ImageManipulator from 'expo-image-manipulator';
import { useTheme } from '../theme/ThemeContext';
import { useUebersetzung } from '../i18n';

type Props = {
  uri: string | null;
  onFertig: (uri: string) => void;
  onAbbruch: () => void;
};

const GRIFF = 30;
const MIN = 60;

/**
 * Zuschnitt mit frei ziehbarem Rahmen.
 *
 * Der eingebaute Rahmen von expo-image-picker (allowsEditing) erzwingt
 * auf iOS ein Quadrat. Fuer eine hochformatige Kochbuchseite ist das
 * unbrauchbar - unten fehlen dann Zeilen, und zwar unbemerkt.
 *
 * Gebraucht wird er trotzdem: Stehen zwei Rezepte auf einer Seite, muss
 * man eines herausgreifen koennen. Deshalb hier ein eigener Rahmen, der
 * jede Form annimmt.
 *
 * Bewusst mit PanResponder aus React Native statt einer Gestenbibliothek:
 * Vier Ecken ziehen und ein Rechteck verschieben ist wenig Logik, und
 * eine zusaetzliche native Abhaengigkeit haette einen neuen Build
 * erzwungen.
 */
export default function ImageCropper({ uri, onFertig, onAbbruch }: Props) {
  const { radius, gradient } = useTheme();
  const { t } = useUebersetzung();

  const [bildGroesse, setBildGroesse] = useState<{ w: number; h: number } | null>(null);
  const [flaeche, setFlaeche] = useState<{ w: number; h: number } | null>(null);
  const [laeuft, setLaeuft] = useState(false);

  // iOS: Der Foto-Picker (und die Kamera) schließt sich mit Animation, waehrend die Auswahl
  // schon an die App zurueckgegeben wird. Ein Modal, das in diesem Moment aufgeht, wird von
  // iOS verworfen - der Zuschnitt erschien dann nie, die Auswahl wurde nicht uebernommen.
  // Deshalb das Fenster erst nach dem Schliessen des Pickers oeffnen.
  const [bereit, setBereit] = useState(false);
  useEffect(() => {
    if (!uri) { setBereit(false); return; }
    const timer = setTimeout(() => setBereit(true), 700);
    return () => clearTimeout(timer);
  }, [uri]);

  // Rahmen in Bildschirmkoordinaten, relativ zur angezeigten Bildflaeche.
  const [rahmen, setRahmen] = useState({ x: 0, y: 0, w: 0, h: 0 });
  const rahmenRef = useRef(rahmen);
  rahmenRef.current = rahmen;

  useEffect(() => {
    if (!uri) return;
    Image.getSize(uri, (w, h) => setBildGroesse({ w, h }), () => setBildGroesse(null));
  }, [uri]);

  // Anzeigegroesse des Bildes innerhalb der Flaeche (kontain, nicht beschnitten)
  const anzeige = (() => {
    if (!bildGroesse || !flaeche) return null;
    const faktor = Math.min(flaeche.w / bildGroesse.w, flaeche.h / bildGroesse.h);
    return {
      w: bildGroesse.w * faktor,
      h: bildGroesse.h * faktor,
      links: (flaeche.w - bildGroesse.w * faktor) / 2,
      oben: (flaeche.h - bildGroesse.h * faktor) / 2,
      faktor,
    };
  })();

  useEffect(() => {
    if (!anzeige || rahmen.w > 0) return;
    // Startrahmen: fast das ganze Bild. Wer nichts wegschneiden will,
    // drueckt einfach auf Uebernehmen.
    setRahmen({
      x: anzeige.links + anzeige.w * 0.03,
      y: anzeige.oben + anzeige.h * 0.03,
      w: anzeige.w * 0.94,
      h: anzeige.h * 0.94,
    });
  }, [anzeige?.w, anzeige?.h]);

  const begrenzen = (r: { x: number; y: number; w: number; h: number }) => {
    if (!anzeige) return r;
    const minX = anzeige.links;
    const minY = anzeige.oben;
    const maxX = anzeige.links + anzeige.w;
    const maxY = anzeige.oben + anzeige.h;
    let { x, y, w, h } = r;
    w = Math.max(MIN, w);
    h = Math.max(MIN, h);
    x = Math.min(Math.max(x, minX), maxX - w);
    y = Math.min(Math.max(y, minY), maxY - h);
    w = Math.min(w, maxX - x);
    h = Math.min(h, maxY - y);
    return { x, y, w, h };
  };

  // Beim Ziehen an einer Ecke soll der Bezugspunkt der Stand beim
  // Loslassen sein, nicht der beim Beginn - sonst springt der Rahmen beim
  // zweiten Zug zurueck.
  const startRef = useRef(rahmen);
  const responderMit = (ecke: 'ol' | 'or' | 'ul' | 'ur' | 'move') =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        startRef.current = rahmenRef.current;
      },
      onPanResponderMove: (_, g) => {
        const r = startRef.current;
        let neu = { ...r };
        if (ecke === 'move') {
          neu.x = r.x + g.dx; neu.y = r.y + g.dy;
        } else if (ecke === 'ol') {
          neu = { x: r.x + g.dx, y: r.y + g.dy, w: r.w - g.dx, h: r.h - g.dy };
        } else if (ecke === 'or') {
          neu = { x: r.x, y: r.y + g.dy, w: r.w + g.dx, h: r.h - g.dy };
        } else if (ecke === 'ul') {
          neu = { x: r.x + g.dx, y: r.y, w: r.w - g.dx, h: r.h + g.dy };
        } else {
          neu = { x: r.x, y: r.y, w: r.w + g.dx, h: r.h + g.dy };
        }
        setRahmen(begrenzen(neu));
      },
    });

  const responder = useRef({
    move: responderMit('move'),
    ol: responderMit('ol'),
    or: responderMit('or'),
    ul: responderMit('ul'),
    ur: responderMit('ur'),
  }).current;

  const zuschneiden = async () => {
    if (!uri || !anzeige) return;
    setLaeuft(true);
    try {
      // Bildschirm- in Bildpunkte umrechnen.
      const x = Math.round((rahmen.x - anzeige.links) / anzeige.faktor);
      const y = Math.round((rahmen.y - anzeige.oben) / anzeige.faktor);
      const w = Math.round(rahmen.w / anzeige.faktor);
      const h = Math.round(rahmen.h / anzeige.faktor);
      const ergebnis = await ImageManipulator.manipulateAsync(
        uri,
        [{ crop: { originX: Math.max(0, x), originY: Math.max(0, y), width: w, height: h } }],
        { compress: 0.95, format: ImageManipulator.SaveFormat.JPEG },
      );
      onFertig(ergebnis.uri);
    } catch {
      // Schlaegt der Zuschnitt fehl, lieber das ganze Bild nehmen als
      // den Nutzer mit einer Fehlermeldung stehen zu lassen.
      onFertig(uri);
    } finally {
      setLaeuft(false);
    }
  };

  return (
    <Modal visible={!!uri && bereit} animationType="slide" onRequestClose={onAbbruch}>
      <View style={styles.hintergrund}>
        <Text style={styles.hinweis}>{t('erfassen.zuschnittHinweis')}</Text>

        <View
          style={styles.flaeche}
          onLayout={(e) => setFlaeche({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
        >
          {uri && <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="contain" />}

          {rahmen.w > 0 && (
            <>
              <View
                {...responder.move.panHandlers}
                style={[styles.rahmen, { left: rahmen.x, top: rahmen.y, width: rahmen.w, height: rahmen.h }]}
              />
              {([
                ['ol', rahmen.x, rahmen.y],
                ['or', rahmen.x + rahmen.w - GRIFF, rahmen.y],
                ['ul', rahmen.x, rahmen.y + rahmen.h - GRIFF],
                ['ur', rahmen.x + rahmen.w - GRIFF, rahmen.y + rahmen.h - GRIFF],
              ] as const).map(([ecke, left, top]) => (
                <View
                  key={ecke}
                  {...responder[ecke].panHandlers}
                  style={[styles.griff, { left, top }]}
                />
              ))}
            </>
          )}
        </View>

        <View style={styles.leiste}>
          <Pressable onPress={onAbbruch} style={styles.knopfZweit}>
            <Text style={styles.knopfZweitText}>{t('allgemein.abbrechen')}</Text>
          </Pressable>
          <Pressable onPress={() => uri && onFertig(uri)} style={styles.knopfZweit}>
            <Text style={styles.knopfZweitText}>{t('erfassen.ganzesBild')}</Text>
          </Pressable>
          <Pressable
            onPress={zuschneiden}
            disabled={laeuft}
            style={[styles.knopf, { backgroundColor: gradient[0], borderRadius: radius.sm }]}
          >
            {laeuft ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.knopfText}>{t('erfassen.zuschneiden')}</Text>
            )}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  hintergrund: { flex: 1, backgroundColor: '#000' },
  hinweis: { color: '#bbb', fontSize: 12.5, textAlign: 'center', paddingHorizontal: 20, paddingTop: 50, paddingBottom: 10 },
  flaeche: { flex: 1, margin: 8 },
  rahmen: { position: 'absolute', borderWidth: 2, borderColor: '#fff', backgroundColor: 'rgba(255,255,255,0.08)' },
  griff: {
    position: 'absolute', width: GRIFF, height: GRIFF, borderRadius: GRIFF / 2,
    backgroundColor: '#fff', borderWidth: 2, borderColor: '#E0A81C',
  },
  leiste: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, paddingBottom: 32, gap: 8 },
  knopf: { minHeight: 48, paddingHorizontal: 22, alignItems: 'center', justifyContent: 'center' },
  knopfText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  knopfZweit: { minHeight: 48, paddingHorizontal: 10, justifyContent: 'center' },
  knopfZweitText: { color: '#ccc', fontSize: 14 },
});
