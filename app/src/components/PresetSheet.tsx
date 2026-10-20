import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { PlusSheet } from './PlusSheet';
import { Chip } from './ui';
import { MAX_PRESETS, MAX_PRESET_NAME, deleteAlertPreset, saveAlertPreset, updateAlertPreset, useAlertPresets, type AlertPreset } from '../lib/alertPresets';
import { fitCount, uniformChoices, type Choices, type Tier } from '../lib/profileLogic';
import type { EventType } from '../lib/types';
import { GOLD, colors, radius, space } from '../theme';
import { useT } from '../lib/i18n';

/**
 * Hate Watch Plus: apply a set of alert choices to one player's or team's alerts in one tap, or save this target's
 * custom choices as a preset. `applicable` is the alert types that exist for this target, `current` its custom choices
 * as tiers (profileLogic.snapshotChoices). Two ready-made presets are worked out here, not stored. A preset of your own
 * can be edited, or made from scratch, in the editor below (`PresetEditor`), which needs no custom choices on this target.
 */
export function PresetSheet({ name, types, current, onApply, onClose }: {
  name: string; types: EventType[]; current: Choices; onApply: (choices: Choices) => void; onClose: () => void;
}) {
  const t = useT();
  const presets = useAlertPresets();
  const [label, setLabel] = useState('');
  const [editing, setEditing] = useState<AlertPreset | 'new' | null>(null);
  const applicable = types.map((e) => e.id);
  if (editing) return <PresetEditor preset={editing === 'new' ? null : editing} types={types} onBack={() => setEditing(null)} />;
  const apply = (choices: Choices) => { onApply(choices); onClose(); };
  const canSave = Object.keys(current).length > 0 && presets.length < MAX_PRESETS;
  const row = (key: string, title: string, desc: string, choices: Choices, own?: AlertPreset) => {
    const fits = fitCount(choices, applicable);
    return (
      <View key={key} style={[styles.row, !fits && { opacity: 0.5 }]}>
        <Pressable onPress={() => apply(choices)} disabled={!fits} style={{ flex: 1 }} accessibilityRole="button">
          <Text style={styles.rowTitle}>{title}</Text>
          <Text style={styles.rowDesc}>{fits ? desc : t('preset.noFit', { name })}</Text>
        </Pressable>
        {own ? <Pressable onPress={() => setEditing(own)} hitSlop={8} accessibilityRole="button"><Text style={styles.edit}>{t('preset.edit')}</Text></Pressable> : null}
        {own ? <Pressable onPress={() => deleteAlertPreset(own.id)} hitSlop={8} accessibilityRole="button"><Text style={styles.del}>{t('preset.delete')}</Text></Pressable> : null}
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
      {presets.map((p) => row(p.id, p.name, t('preset.fits', { n: fitCount(p.choices, applicable), total: Object.keys(p.choices).length }), p.choices, p))}
      {presets.length < MAX_PRESETS ? (
        <Pressable onPress={() => setEditing('new')} accessibilityRole="button"><Text style={styles.edit}>{t('preset.new')}</Text></Pressable>
      ) : null}
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

const TIERS: { tier: Tier; key: 'preset.tierOff' | 'preset.tierFeed' | 'preset.tierPush' }[] = [
  { tier: 'off', key: 'preset.tierOff' }, { tier: 'feed', key: 'preset.tierFeed' }, { tier: 'push', key: 'preset.tierPush' },
];

/**
 * Name and per-alert choices of one preset: edits `preset`, or makes a new one (every alert in the feed to start from)
 * when `preset` is null. Tapping the picked choice again leaves that alert out of the preset. Alerts the preset sets
 * that this target doesn't have are kept as they are.
 */
function PresetEditor({ preset, types, onBack }: { preset: AlertPreset | null; types: EventType[]; onBack: () => void }) {
  const t = useT();
  const ids = types.map((e) => e.id);
  const [label, setLabel] = useState(preset?.name ?? '');
  const [draft, setDraft] = useState<Choices>(() => (preset ? Object.fromEntries(Object.entries(preset.choices).filter(([id]) => ids.includes(id))) : uniformChoices(ids, 'feed')));
  const pick = (id: string, tier: Tier) => setDraft((d) => {
    const { [id]: was, ...rest } = d;
    return was === tier ? rest : { ...rest, [id]: tier };
  });
  const choices: Choices = { ...Object.fromEntries(Object.entries(preset?.choices ?? {}).filter(([id]) => !ids.includes(id))), ...draft };
  const ok = !!label.trim() && Object.keys(choices).length > 0;
  const save = () => { if (preset ? updateAlertPreset(preset.id, label, choices) : saveAlertPreset(label, choices)) onBack(); };
  return (
    <PlusSheet title={t(preset ? 'preset.editTitle' : 'preset.new')} onClose={onBack} onSave={save} canSave={ok}>
      <TextInput value={label} onChangeText={setLabel} placeholder={t('preset.name')} placeholderTextColor={colors.textFaint} maxLength={MAX_PRESET_NAME}
        style={styles.input} autoCorrect={false} returnKeyType="done" accessibilityLabel={t('preset.name')} />
      <Text style={styles.note}>{t('preset.editHint')}</Text>
      {types.map((e) => (
        <View key={e.id} style={styles.typeRow}>
          <Text style={styles.typeLabel} numberOfLines={2}>{e.emoji} {e.label}</Text>
          <View style={styles.tiers}>
            {TIERS.map(({ tier, key }) => <Chip key={tier} label={t(key)} active={draft[e.id] === tier} color={GOLD} onPress={() => pick(e.id, tier)} />)}
          </View>
        </View>
      ))}
      <View style={styles.saveRow}>
        <Pressable onPress={onBack} hitSlop={8} accessibilityRole="button"><Text style={styles.edit}>{t('preset.back')}</Text></Pressable>
        <Pressable onPress={save} disabled={!ok} style={[styles.save, !ok && { opacity: 0.4 }]} accessibilityRole="button">
          <Text style={styles.saveText}>{t('profile.save')}</Text>
        </Pressable>
      </View>
    </PlusSheet>
  );
}

const styles = StyleSheet.create({
  note: { color: colors.textFaint, fontSize: 12, lineHeight: 17 },
  group: { color: colors.textFaint, fontSize: 11, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space(3), padding: space(3), backgroundColor: colors.surfaceHi, borderRadius: radius.md },
  rowTitle: { color: colors.text, fontSize: 15, fontWeight: '800' },
  rowDesc: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  edit: { color: GOLD, fontSize: 13, fontWeight: '700' },
  typeRow: { flexDirection: 'row', alignItems: 'center', gap: space(2), padding: space(2.5), backgroundColor: colors.surfaceHi, borderRadius: radius.md },
  typeLabel: { flex: 1, color: colors.text, fontSize: 14, fontWeight: '700' },
  tiers: { flexDirection: 'row', gap: space(1) },
  del: { color: colors.hate, fontSize: 13, fontWeight: '700' },
  saveRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space(2) },
  input: { flex: 1, color: colors.text, fontSize: 15, paddingHorizontal: space(3), paddingVertical: space(2.5), backgroundColor: colors.surfaceHi, borderRadius: radius.md, ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null) },
  save: { paddingHorizontal: space(4), paddingVertical: space(2.5), borderRadius: radius.pill, backgroundColor: GOLD },
  saveText: { color: '#1A1200', fontWeight: '800', fontSize: 14 },
});
