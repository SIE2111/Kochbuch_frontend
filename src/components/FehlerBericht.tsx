import React, { useState } from 'react'
import { ActivityIndicator, Modal, Platform, ScrollView, Share, Text, TouchableOpacity, View } from 'react-native'
import * as Updates from 'expo-updates'
import { t } from '../i18n'

/**
 * Fehlerbericht-Fenster (06.10.2026, gleich in allen HomeArchive-Apps).
 * Zeigt Fehler-/Protokolltexte so, dass man sie markieren, teilen/kopieren
 * und mit einem Tipp an den Support senden kann - ohne Mailprogramm und
 * ohne zusaetzliches natives Paket (Teilen-Menue des Systems enthaelt "Kopieren").
 */
export type BerichtSenden = (betreff: string, nachricht: string) => Promise<void>

const MAX_ZEICHEN = 3500

/** Geraete- und Versionsangaben, die jedem Bericht vorangestellt werden. */
export function berichtKopf(): string {
  const stand = Updates.isEmbeddedLaunch || !Updates.updateId ? 'Build-Stand' : `Update ${Updates.updateId}`
  return [
    `Plattform: ${Platform.OS} ${String(Platform.Version)}`,
    `Runtime: ${Updates.runtimeVersion ?? '-'}`,
    `Stand: ${stand}`,
    `Channel: ${Updates.channel ?? '-'}`,
    `Zeit: ${new Date().toISOString()}`,
  ].join('\n')
}

export function FehlerBerichtFenster({ titel, text, akzent, senden, onClose }: {
  titel: string
  text: string
  akzent: string
  senden?: BerichtSenden
  onClose: () => void
}) {
  const [sendet, setSendet] = useState(false)
  const [status, setStatus] = useState<'' | 'ok' | 'fehler'>('')
  const voll = `${titel}\n\n${berichtKopf()}\n\n${text}`

  async function anSupport() {
    if (!senden || sendet) return
    setSendet(true)
    try {
      await senden(`Fehlerbericht: ${titel}`.slice(0, 120), voll.slice(0, MAX_ZEICHEN))
      setStatus('ok')
    } catch {
      setStatus('fehler')
    } finally {
      setSendet(false)
    }
  }

  const knopf = { paddingVertical: 12, borderRadius: 12, alignItems: 'center' as const }
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: 20 }}>
        <View style={{ backgroundColor: '#FFFFFF', borderRadius: 16, padding: 16, maxHeight: '85%' }}>
          <Text style={{ fontSize: 18, fontWeight: '700', color: '#111111', marginBottom: 10 }}>{titel}</Text>
          <ScrollView style={{ maxHeight: 360, marginBottom: 12 }}>
            <Text selectable style={{ fontSize: 12.5, lineHeight: 18, color: '#222222' }}>{text}</Text>
          </ScrollView>
          {status === 'ok' && <Text style={{ color: '#1B7F3B', marginBottom: 8 }}>{t('update.gesendet')}</Text>}
          {status === 'fehler' && <Text style={{ color: '#B3261E', marginBottom: 8 }}>{t('update.nichtGesendet')}</Text>}
          <TouchableOpacity
            style={[knopf, { backgroundColor: akzent }]}
            onPress={() => { Share.share({ message: voll }).catch(() => {}) }}
          >
            <Text style={{ color: '#FFFFFF', fontWeight: '700' }}>{t('update.teilen')}</Text>
          </TouchableOpacity>
          {senden && status !== 'ok' && (
            <TouchableOpacity style={[knopf, { marginTop: 8, borderWidth: 1.5, borderColor: akzent }]} onPress={anSupport} disabled={sendet}>
              {sendet ? <ActivityIndicator color={akzent} /> : <Text style={{ color: akzent, fontWeight: '700' }}>{t('update.anSupport')}</Text>}
            </TouchableOpacity>
          )}
          <TouchableOpacity style={[knopf, { marginTop: 4 }]} onPress={onClose}>
            <Text style={{ color: '#555555' }}>{t('update.schliessen')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  )
}
