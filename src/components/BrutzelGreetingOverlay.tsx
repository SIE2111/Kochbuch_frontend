import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Animated, Image, Modal, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { VideoView, useVideoPlayer } from 'expo-video';
import * as Speech from 'expo-speech';
import { SPEECH_LANGUAGE, vorleserStimme } from '../utils/speech';
import { useTheme } from '../theme/ThemeContext';
import MarkenZeile from './MarkenZeile';
import BrutzelIntroScreens from './BrutzelIntroScreens';
import { useUebersetzung } from '../i18n';
import { begruessungTonGemerkt, begruessungTonMerken } from '../utils/begruessungTon';

interface Props {
  name: string;
  onDismiss: () => void;
  // Steht der Profil-Schalter "Begruessungs-Animation" auf aus, bleibt der
  // Bildschirm samt Standbild, Gruss und Knopf trotzdem stehen - nur Video
  // und Sprachausgabe entfallen. Vorher verschwand die ganze Begruessung.
  mitVideo?: boolean;
  // Profil-Schalter "Schritte automatisch vorlesen" - die Begruessung wird
  // NUR dann gesprochen, wenn er an ist (siehe Auftrag Punkt 3). Ohne
  // eigenen Wert wird nicht gesprochen, nicht geraten.
  sprechen?: boolean;
  // Ton der Begruessung: Die Videodatei traegt eine eigene Tonspur, die
  // sonst immer mitlaeuft. Profil-Schalter "Animations-Musik", nur
  // wirksam, wenn mitVideo ueberhaupt ein Video zeigt.
  mitMusik?: boolean;
}


/**
 * Animierte Begruessung beim Start (Profil-Schalter "Begruessungs-
 * Animation") - nutzt dasselbe echte Brutzel-Video wie die Guten-Appetit-
 * Feier am Ende (siehe CookingFinishedCelebration.tsx), nicht mehr eine
 * reine Bounce-Animation mit dem statischen Bild. Liest den
 * Begruessungstext zusaetzlich vor - mit der neutralen Vorlese-Stimme
 * (nicht Brutzels eigener), und nur wenn "Schritte automatisch vorlesen"
 * an ist. Brutzels eigene Stimme bleibt den Tipp-Karten im Koch-Modus
 * vorbehalten (siehe Auftrag Punkt 3).
 */
export default function BrutzelGreetingOverlay({ name, onDismiss, mitVideo = true, sprechen = false, mitMusik = true }: Props) {
  const { colors, gradient, radius } = useTheme();
  const insets = useSafeAreaInsets();
  const { t } = useUebersetzung();
  const textOpacity = React.useRef(new Animated.Value(0)).current;
  // Dieselbe kurze Einfuehrung wie bei der Registrierung (BrutzelIntroScreens)
  // - hier ueber einen Knopf abrufbar statt einmalig erzwungen, fuer alle,
  // die sie beim Anlegen des Kontos uebersprungen haben oder noch mal
  // sehen wollen.
  const [zeigeIntro, setZeigeIntro] = useState(false);

  const greetingText = `Hallo ${name}! Was möchtest du heute kochen?`;

  const [videoReady, setVideoReady] = useState(false);

  // Der Haken laeuft unbedingt - Hooks duerfen nicht bedingt aufgerufen
  // werden. Abgespielt und angezeigt wird nur bei eingeschalteter Animation.
  const player = useVideoPlayer(require('../../assets/brutzel-celebration.mp4'), (p) => {
    p.loop = false;
    p.muted = true;   // startet immer stumm, Ton erst auf Wunsch (Knopf "Ton an")
    if (mitVideo) p.play();
  });

  useEffect(() => {
    if (!mitVideo) return;
    // Standbild bleibt bei aktivierter Animation verborgen, bis das Video
    // wirklich bereit ist - vorher blitzte es beim Start immer kurz auf,
    // bevor der erste Frame kam (unschoen). Wird der Player NIE bereit
    // (echter Ladefehler), bleibt videoReady false und das Standbild
        // erscheint als Sicherheitsnetz weiterhin (siehe Kommentar unten).
    if (player.status === 'readyToPlay') {
      setVideoReady(true);
      return;
    }
    const sub = player.addListener('statusChange', ({ status }) => {
      if (status === 'readyToPlay') setVideoReady(true);
    });
    return () => sub.remove();
  }, [mitVideo, player]);

  useEffect(() => {
    // Frueher lief hier ein Zeitgeber von 3,5 Sekunden, damit der Text erst
    // nach dem Video kam. Die Markenzeile oben steht aber sofort - der
    // Versatz liess den Bildschirm dazwischen halb leer wirken. Beide
    // Textbloecke erscheinen jetzt gemeinsam.
    Animated.timing(textOpacity, { toValue: 1, duration: 500, useNativeDriver: true }).start();

    // Haengt jetzt an "Animations-Musik" (mitMusik) statt am separaten
    // sprechen-Prop - gleiche Vereinheitlichung wie bei Buerroablage und
    // in CookingFinishedCelebration.tsx (Vorlesen laeuft automatisch mit
    // der Animation mit, kein eigener Schalter mehr dafuer noetig).
    // Ton nur, wenn der Profil-Schalter an ist UND der Nutzer ihn hier schon einmal eingeschaltet hat
    if (mitMusik) begruessungTonGemerkt().then((an) => { if (an) tonSchalten(true, false); });
    return () => {
      Speech.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [tonAn, setTonAn] = useState(false);
  // Ton an/aus: Video-Ton und vorgelesene Begruessung zusammen. Beim Einschalten startet die Animation neu,
  // damit man Musik und Gruss auch hoert.
  function tonSchalten(an: boolean, merken = true) {
    setTonAn(an);
    if (merken) begruessungTonMerken(an);
    try { player.muted = !an; } catch { /* egal */ }
    if (an) {
      try { player.currentTime = 0; if (mitVideo) player.play(); } catch { /* egal */ }
      Speech.stop();
      // Feste Vorleser-Stimme (weiblich) statt Brutzels eigener (maennlich) - die ist den Tipp-Karten vorbehalten
      vorleserStimme().then((voice) => Speech.speak(greetingText, { language: SPEECH_LANGUAGE, voice }));
    } else {
      Speech.stop();
    }
  }

  const handleDismiss = () => {
    Speech.stop();
    onDismiss();
  };

  return (
    <View style={[styles.overlay, { backgroundColor: colors.bg }]}>
      {/*
       * Vorher stand die Markenzeile absolut am oberen Rand, waehrend
       * Video und Text im verbleibenden Platz VERTIKAL ZENTRIERT wurden -
       * beide Bloecke kannten einander nicht. Kam wie heute mit dem
       * "Kurze Hilfe"-Link mehr Inhalt dazu, wanderte der zentrierte
       * Block weiter nach unten, bis das Video die Markenzeile
       * ueberdeckte und der Link hinter der Tab-Leiste verschwand.
       * Jetzt steht die Markenzeile im normalen Fluss ganz oben, fest
       * an ihrem Platz, und alles andere folgt darunter in einer
       * ScrollView - bei viel Inhalt oder kleinem Bildschirm scrollt der
       * Rest, statt sich zu ueberlappen.
       */}
      <MarkenZeile style={[styles.markenZeile, { paddingTop: insets.top + 12 }]} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 90 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Standbild LIEGT HINTER dem Player, nicht als Ersatz daneben: Bleibt
            der Player stumm - was bei genau diesem Video schon am Ende des
            Kochvorgangs vorkam -, steht hier Brutzel statt einer Luecke.
            Spielt das Video, verdeckt es das Bild vollstaendig. Bei
            eingeschalteter Animation aber erst NACH videoReady zeigen -
            sonst blitzte es beim Start immer kurz auf, bevor der erste
            Frame da war. */}
        <View style={styles.videoBox}>
          {(!mitVideo || !videoReady) && (
            <Image source={require('../../assets/brutzel-full.png')} style={styles.videoFallback} resizeMode="contain" />
          )}
          {mitVideo && <VideoView player={player} style={styles.video} contentFit="cover" nativeControls={false} />}
        </View>
        {mitVideo && (
          <Pressable onPress={() => tonSchalten(!tonAn)} hitSlop={8} style={[styles.tonKnopf, { borderColor: colors.muted }]}>
            <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}>{tonAn ? t('begruessungTon.aus') : t('begruessungTon.an')}</Text>
          </Pressable>
        )}

        <Animated.View style={{ opacity: textOpacity, alignItems: 'center' }}>
          <Text style={[styles.title, { color: colors.text }]}>{t('sonstiges.hallo', { name })}</Text>
          <Text style={[styles.subtitle, { color: colors.muted }]}>{t('sonstiges.wasKochen')}</Text>
          <Pressable onPress={handleDismiss} style={[styles.doneButton, { backgroundColor: gradient[0], borderRadius: radius.md }]}>
            <Text style={styles.doneButtonText}>{t('sonstiges.losGehts')}</Text>
          </Pressable>
          <Pressable onPress={() => setZeigeIntro(true)} hitSlop={10} style={{ marginTop: 14 }}>
            <Text style={{ color: colors.muted, fontSize: 12.5, fontWeight: '600', textDecorationLine: 'underline' }}>
              {t('sonstiges.kurzeHilfe')}
            </Text>
          </Pressable>
        </Animated.View>
      </ScrollView>

      <Modal visible={zeigeIntro} animationType="slide" onRequestClose={() => setZeigeIntro(false)}>
        <BrutzelIntroScreens onFertig={() => setZeigeIntro(false)} />
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 50 },
  // Im normalen Fluss statt zentriert: waechst der Inhalt darunter, bleibt
  // die Markenzeile trotzdem an ihrem festen Platz oben.
  scroll: { flex: 1, width: '100%' },
  scrollContent: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, paddingTop: 16 },
  // schrumpft statt ueberzulaufen, wenn der Platz eng wird
  // 'cover' statt 'contain' bei beiden: Das Standbild ist hochformatig, das
  // Video breit - eingepasst blieben Raender frei und das Bild schaute unter
  // dem Video hervor. Randlos fuellend verdeckt das Video es vollstaendig.
  // overflow verhindert, dass der beschnittene Teil ueber die Ecken laeuft.
  videoBox: { width: '100%', height: 300, marginBottom: 20, borderRadius: 16, overflow: 'hidden' },
  videoFallback: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' },
  markenZeile: { paddingHorizontal: 24, paddingBottom: 4 },
  tonKnopf: { marginTop: -8, marginBottom: 18, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 16, borderWidth: 1 },
  video: { width: '100%', height: '100%' },
  title: { fontSize: 22, fontWeight: '700', marginBottom: 6 },
  subtitle: { fontSize: 13, marginBottom: 22, textAlign: 'center' },
  doneButton: { paddingHorizontal: 40, paddingVertical: 13 },
  doneButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
