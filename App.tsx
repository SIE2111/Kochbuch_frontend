import React, { useEffect, useState } from 'react';
import { Platform, Dimensions } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Updates from 'expo-updates';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from './src/theme/ThemeContext';
import { AuthProvider } from './src/context/AuthContext';
import { ServerSyncProvider } from './src/context/ServerSyncContext';
import AppNavigator from './src/navigation/AppNavigator';
import BrutzelHinweisHost from './src/components/BrutzelHinweis';
import { UpdatePruefung } from './src/components/UpdatePruefung';
import { spracheLaden } from './src/i18n';
import { TABLET_AB } from './src/utils/layout';

export default function App() {
  // Die Sprache soll vor dem ersten Bild feststehen - sonst erscheint die
  // App kurz auf Deutsch und springt dann um, was nach Fehler aussieht.
  //
  // ABER: Warten darf nie endlos sein. Bleibt das Laden haengen (Speicher
  // nicht erreichbar, Geraetesprache nicht ermittelbar), sah man nur den
  // Startbildschirm und kam nie zur Anmeldung. Ein weisser Bildschirm
  // ohne Ausweg ist schlimmer als ein kurzes Umspringen der Sprache.
  const [spracheBereit, setSpracheBereit] = useState(false);
  useEffect(() => {
    let erledigt = false;
    const fertig = () => {
      if (!erledigt) {
        erledigt = true;
        setSpracheBereit(true);
      }
    };
    spracheLaden().finally(fertig);
    const notbremse = setTimeout(fertig, 2000);
    return () => clearTimeout(notbremse);
  }, []);

  // Ein neues EAS Update wurde bisher nur im Hintergrund heruntergeladen,
  // aktiv wurde es erst beim UEBERNAECHSTEN Start - einmal Schliessen und
  // Neuoeffnen reichte also nicht, was wie ein nicht behobener Fehler
  // aussah (22.09.2026). Jetzt: direkt beim Start pruefen, herunterladen
  // und sofort neu starten, solange noch niemand mit der App interagiert
  // hat. Ganz eigenstaendig neben der Sprachladung oben - blockiert diese
  // nicht und hat ein eigenes, grosszuegigeres Zeitfenster (Netzwerk
  // braucht laenger als das lokale Sprachladen). Faengt jemand in der
  // Zwischenzeit schon an zu kochen (naechFruehesFenster ist um), wird
  // NICHT mehr neu gestartet - das Update kommt dann ganz normal beim
  // naechsten Kaltstart, statt mitten in einer laufenden Nutzung den
  // Boden unter den Fuessen wegzuziehen.
  useEffect(() => {
    if (__DEV__ || !Updates.isEnabled) return;
    let nochFrueh = true;
    const fensterSchliessen = setTimeout(() => {
      nochFrueh = false;
    }, 4000);

    (async () => {
      try {
        const ergebnis = await Updates.checkForUpdateAsync();
        if (!ergebnis.isAvailable || !nochFrueh) return;
        await Updates.fetchUpdateAsync();
        if (!nochFrueh) return;
        await Updates.reloadAsync();
      } catch {
        // Kein Netz, Server nicht erreichbar o.ae. - normal weiterstarten,
        // naechster Versuch beim naechsten App-Start.
      }
    })();

    return () => clearTimeout(fensterSchliessen);
  }, []);

  // Nur Android: iOS unterscheidet ueber "supportsTablet" in app.json
  // schon von selbst zwischen iPhone (Hochformat gesperrt) und iPad
  // (frei drehbar) - fuer Android gibt es keine solche eingebaute
  // Handy/Tablet-Unterscheidung. Ohne das hier wuerde "orientation:
  // portrait" in app.json AUCH Android-Tablets fest aufs Hochformat
  // sperren, und die ganze quer/hoch-Aufteilung (siehe useLayout)
  // haette dort nie eine Wirkung. Einmalig beim Start, nach derselben
  // Schwelle wie useLayout - Dimensions.get('screen') statt 'window',
  // weil die Geraeteklasse sich waehrend der Sitzung nicht aendert und
  // unabhaengig von der aktuellen Ausrichtung ermittelt werden soll.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const { width, height } = Dimensions.get('screen');
    const istTabletGeraet = Math.max(width, height) >= TABLET_AB;
    (async () => {
      try {
        // Bewusst per require() HIER drin statt als statischer Top-Level-
        // Import (siehe oben, wo er vorher stand): ein statischer Import
        // fuehrt das native Modul schon beim Laden des JS-Bundles nach -
        // das crasht die GESAMTE App (auch auf iOS, wo dieser Code nie
        // laeuft!), wenn ein per OTA ausgeliefertes Update diese
        // Abhaengigkeit nutzt, der installierte native Build eines Nutzers
        // sie aber (noch kein neuer eas build) gar nicht enthaelt - siehe
        // Absturzreport "Cannot find native module 'ExpoScreenOrientation'"
        // bei einem Nutzer. Mit require() HIER greift das try/catch auch
        // fuer genau diesen Fall.
        const ScreenOrientation = require('expo-screen-orientation');
        if (istTabletGeraet) {
          await ScreenOrientation.unlockAsync();
        } else {
          await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
        }
      } catch {
        // Kein kritischer Pfad - im schlimmsten Fall bleibt es bei der
        // app.json-Standardausrichtung.
      }
    })();
  }, []);

  if (!spracheBereit) return null;

  // GestureHandlerRootView so nah wie moeglich an der Wurzel - Pflicht
  // fuer react-native-gesture-handler (siehe ManageCategoriesScreen, wo
  // es fuer echtes Ziehen zum Umsortieren genutzt wird), sonst schlagen
  // Gesten mit einer Fehlermeldung fehl statt einfach nichts zu tun.
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <AuthProvider>
            <ServerSyncProvider>
              <StatusBar style="auto" />
              <AppNavigator />
              <BrutzelHinweisHost />
              {/* Start-Pruefung macht der Effekt oben (mit 4-Sekunden-Fenster); hier nur die Rueckkehr in die App */}
              <UpdatePruefung beimStart={false} />
            </ServerSyncProvider>
          </AuthProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
