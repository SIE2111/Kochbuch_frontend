import { useEffect, useRef } from 'react'
import { Alert, AppState } from 'react-native'
import * as Updates from 'expo-updates'
import { t } from '../i18n'

/**
 * Automatische Update-Pruefung (06.10.2026, gleich wie im Weinkeller).
 * - Beim START: neue Version pruefen, laden und SOFORT neu starten (die App
 *   ist gerade erst offen, man verliert nichts). Entfaellt mit beimStart=false.
 * - Bei RUECKKEHR in die App: laden und Neustart anbieten ("Neue Version
 *   geladen - jetzt neu starten?"). Bei "Spaeter" wird beim naechsten
 *   Zurueckkehren wieder gefragt.
 * Ohne das wurde ein Update (eas update) nur im Hintergrund geladen und erst
 * beim naechsten Kaltstart aktiv - die Apps bleiben aber oft tagelang offen.
 */
let geladenNichtAktiv = false

async function updatePruefen(sofortNeustart: boolean): Promise<'aktuell' | 'neu'> {
  if (__DEV__ || !Updates.isEnabled) return 'aktuell'
  if (!geladenNichtAktiv) {
    const r = await Updates.checkForUpdateAsync()
    if (!r.isAvailable) return 'aktuell'
    await Updates.fetchUpdateAsync()
    geladenNichtAktiv = true
  }
  if (sofortNeustart) await Updates.reloadAsync()
  return 'neu'
}

export function UpdatePruefung({ beimStart = true }: { beimStart?: boolean }) {
  const laeuft = useRef(false)
  useEffect(() => {
    if (__DEV__ || !Updates.isEnabled) return
    const pruefen = async (start: boolean) => {
      if (laeuft.current) return
      laeuft.current = true
      try {
        const r = await updatePruefen(start)
        if (r === 'neu' && !start) {
          Alert.alert(t('update.titel'), t('update.text'), [
            { text: t('update.spaeter'), style: 'cancel' },
            { text: t('update.jetzt'), onPress: () => { Updates.reloadAsync().catch(() => {}) } },
          ])
        }
      } catch (e) {
        console.warn('[Update]', e)
      } finally {
        laeuft.current = false
      }
    }
    if (beimStart) pruefen(true)
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') pruefen(false) })
    return () => sub.remove()
  }, [beimStart])
  return null
}
