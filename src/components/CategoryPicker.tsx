import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, Alert } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useTheme } from '../theme/ThemeContext';
import { useUebersetzung } from '../i18n';
import { api, ApiError } from '../api/client';
import { BEKANNTE_KATEGORIEN } from '../utils/kategorien';

interface Props {
  selected: string[];
  onChange: (tags: string[]) => void;
}

/**
 * Kategorien-Auswahl statt reinem Freitextfeld: zeigt alle Kategorien, die
 * schon irgendwo im eigenen Kochbuch vorkommen, als antippbare Chips -
 * gibt es die gewuenschte Kategorie noch nicht, kann sie ueber das
 * Eingabefeld direkt neu angelegt werden (wird dann sofort mit ausgewaehlt
 * und erscheint kuenftig auch in der Chip-Liste).
 */
export default function CategoryPicker({ selected, onChange }: Props) {
  const { colors, gradient, radius } = useTheme();
  const { t } = useUebersetzung();
  const [existingCategories, setExistingCategories] = useState<string[]>([]);
  const [newCategoryText, setNewCategoryText] = useState('');

  useEffect(() => {
    api
      .get<{ tags: string[] | null }[]>('/recipes/')
      .then((recipes) => {
        const distinct = Array.from(new Set([...recipes.flatMap((r) => r.tags ?? []), ...BEKANNTE_KATEGORIEN])).sort((a, b) =>
          a.localeCompare(b, 'de'),
        );
        setExistingCategories(distinct);
      })
      .catch(() => {
        // Bestehende Kategorien sind hier nur "nice to have" - schlaegt das
        // Laden fehl, kann trotzdem ueber das Eingabefeld frei getippt werden
      });
  }, []);

  const toggle = (tag: string) => {
    if (selected.includes(tag)) {
      onChange(selected.filter((t) => t !== tag));
    } else {
      onChange([...selected, tag]);
    }
  };

  const handleAddNew = () => {
    const trimmed = newCategoryText.trim();
    if (!trimmed) return;
    if (!selected.includes(trimmed)) {
      onChange([...selected, trimmed]);
    }
    if (!existingCategories.includes(trimmed)) {
      setExistingCategories((prev) => [...prev, trimmed].sort((a, b) => a.localeCompare(b, 'de')));
    }
    setNewCategoryText('');
  };

  const handleDeleteCategory = (tag: string) => {
    Alert.alert(
      t('sonstiges.kategorieLoeschen'),
      `"${tag}" wird aus ALLEN Rezepten entfernt, die diese Kategorie haben - nicht nur hier. Die Rezepte selbst bleiben erhalten.`,
      [
        { text: t('allgemein.abbrechen'), style: 'cancel' },
        {
          text: t('allgemein.loeschen'),
          style: 'destructive',
          onPress: async () => {
            try {
              await api.delete(`/recipes/tags/${encodeURIComponent(tag)}`);
              setExistingCategories((prev) => prev.filter((t) => t !== tag));
              if (selected.includes(tag)) onChange(selected.filter((t) => t !== tag));
            } catch (err) {
              Alert.alert(t('allgemein.fehler'), err instanceof ApiError ? err.detail : t('sonstiges.kategorieNichtGeloescht'));
            }
          },
        },
      ],
    );
  };

  // Bereits ausgewaehlte Kategorien zuerst, auch wenn sie (weil gerade neu
  // angelegt) noch nicht in existingCategories stehen - direkt sichtbares
  // Feedback statt "wo ist meine Auswahl hin".
  const allChips = Array.from(new Set([...selected, ...existingCategories]));

  return (
    <View>
      {allChips.length > 0 && (
        <>
          <View style={styles.chipsRow}>
            {allChips.map((tag) => {
              const isSelected = selected.includes(tag);
              return (
                <Pressable
                  key={tag}
                  onPress={() => toggle(tag)}
                  onLongPress={() => handleDeleteCategory(tag)}
                  style={[styles.chip, { backgroundColor: isSelected ? gradient[0] : colors.card, borderRadius: radius.sm }]}
                >
                  <Text style={{ color: isSelected ? '#fff' : colors.text, fontSize: 12, fontWeight: '600' }}>{tag}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={{ color: colors.muted, fontSize: 10, marginBottom: 8 }}>{t('sonstiges.langeDruecken')}</Text>
        </>
      )}
      <View style={styles.addRow}>
        <TextInput
          style={[styles.addInput, { backgroundColor: colors.card, color: colors.text, borderRadius: radius.md }]}
          placeholder={t('sonstiges.neueKategorie')}
          placeholderTextColor={colors.muted}
          value={newCategoryText}
          onChangeText={setNewCategoryText}
          onSubmitEditing={handleAddNew}
        />
        <Pressable
          onPress={handleAddNew}
          disabled={!newCategoryText.trim()}
          style={[styles.addButton, { backgroundColor: gradient[0], borderRadius: radius.md, opacity: newCategoryText.trim() ? 1 : 0.4 }]}
        >
          <MaterialCommunityIcons name="plus" size={18} color="#fff" />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  chip: { paddingHorizontal: 12, paddingVertical: 8 },
  addRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  addInput: { flex: 1, height: 40, paddingHorizontal: 12, fontSize: 13 },
  addButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
});
