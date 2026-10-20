import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { PlusSheet } from './PlusSheet';
import { MAX_PRESETS, MAX_PRESET_NAME, deleteAlertPreset, saveAlertPreset, useAlertPresets } from '../lib/alertPresets';
import { fitCount, uniformChoices, type Choices } from '../lib/profileLogic';
import { GOLD, colors, radius, space } from '../theme';
import { useT } from '../lib/i18n';

/**
 * Hate Watch Plus: apply a set of alert choices to one player's or team's alerts in one tap, or save this target's
 * custom choices as a preset. `applicable` is the alert types that exist for this target, `current` its custom choices
 * as tiers (profileLogic.snapshotChoices). Two ready-made presets are worked out here, not stored.
 */
export function PresetSheet({ name, applicable, current, onApply, onClose }: {
  name: string; applicable: string[]; current: Choices; onApply: (choices: Choices) => void; onClose: () => void;
}) {
  const t = useT();
  const presets = useAlertPresets();
  const [label, setLabel] = useState('');
  const apply = (choices: Choices) => { onApply(choices); onClose(); };
  const canSave = Object.keys(current).length > 0 && presets.length < MAX_PRESETS;
  const row = (key: string, title: string, desc: string, choices: Choices, onDelete?: () => void) => {
    const fits = fitCount(choices, applicable);
    return (
      <View key={key} style={[styles.row, !fits && { opacity: 0.5 }]}>
        <Pressable onPress={() => apply(choices)} disabled={!fits} style={{ flex: 1 }} accessibilityRole="button">
          <Text style={styles.rowTitle}>{title}</Text>
          <Text style={styles.rowDesc}>{fits ? desc : t('preset.noFit', { name })}</Text>
        </Pressable>
        {onDelete ? <Pressable onPress={onDelete} hitSlop={8} accessibilityRole="button"><Text style={styles.del}>{t('preset.delete')}</Text></Pressable> : null}
      </View>
    );
  };

  return (
    <PlusSheet title={t('preset.title')} onClose={onClose}>
      <Text style={styles.note}>{t('preset.explain', { name })}</Text>
      <Text style={styles.group}>{t('preset.builtIn')}</Text>
      {row('all', t('preset.everything'), t('preset.everythingDesc'), uniformChoices(applicable, 'push'))}
      {row('quiet', t('preset.quiet'), t('preset.quietDesc'), uniformChoices(applicable, 'feed'))}
      {presets.length ? <Text style={styles.group}>{t('preset.yours')}</Text> : null}
      {presets.map((p) => row(p.id, p.name, t('preset.fits', { n: fitCount(p.choices, applicable), total: Object.keys(p.choices).length }), p.choices, () => deleteAlertPreset(p.id)))}
      <Text style={styles.group}>{t('preset.saveCurrent', { name })}</Text>
      {canSave ? (
        <View style={styles.saveRow}>
          <TextInput value={label} onChangeText={setLabel} placeholder={t('preset.name')} placeholderTextColor={colors.textFaint} maxLength={MAX_PRESET_NAME}
            style={styles.input} autoCorrect={false} returnKeyType="done" accessibilityLabel={t('preset.name')} />
          <Pressable onPress={() => { if (saveAlertPreset(label, current)) setLabel(''); }} disabled={!label.trim()} style={[styles.save, !label.trim() && { opacity: 0.4 }]} accessibilityRole="button">
            <Text style={styles.saveText}>{t('profile.save')}</Text>
          </Pressable>
        </View>
      ) : <Text style={styles.note}>{t(presets.length >= MAX_PRESETS ? 'preset.full' : 'preset.nothingToSave', { name, n: MAX_PRESETS })}</Text>}
    </PlusSheet>
  );
}

const styles = StyleSheet.create({
  note: { color: colors.textFaint, fontSize: 12, lineHeight: 17 },
  group: { color: colors.textFaint, fontSize: 11, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space(3), padding: space(3), backgroundColor: colors.surfaceHi, borderRadius: radius.md },
  rowTitle: { color: colors.text, fontSize: 15, fontWeight: '800' },
  rowDesc: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  del: { color: colors.hate, fontSize: 13, fontWeight: '700' },
  saveRow: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  input: { flex: 1, color: colors.text, fontSize: 15, paddingHorizontal: space(3), paddingVertical: space(2.5), backgroundColor: colors.surfaceHi, borderRadius: radius.md, ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null) },
  save: { paddingHorizontal: space(4), paddingVertical: space(2.5), borderRadius: radius.pill, backgroundColor: GOLD },
  saveText: { color: '#1A1200', fontWeight: '800', fontSize: 14 },
});
