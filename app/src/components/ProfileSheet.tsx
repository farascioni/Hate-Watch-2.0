import { useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { PlusSheet } from './PlusSheet';
import { Avatar } from './Avatar';
import { MAX_NAME, MAX_PROFILES, deleteProfile, saveProfile, useProfiles } from '../lib/profiles';
import type { Profile } from '../lib/profileLogic';
import type { Target } from '../lib/types';
import { GOLD, colors, radius, space } from '../theme';
import { useT } from '../lib/i18n';

/**
 * Hate Watch Plus: make or edit a tracking profile (a name and which of the players and teams you track are in it).
 * Mounted only while open, so it starts fresh each time. The note says what a profile does not touch: notifications.
 */
export function ProfileSheet({ profile, follows, onClose }: { profile: Profile | null; follows: ReadonlyMap<string, Target>; onClose: () => void }) {
  const t = useT();
  const { list } = useProfiles();
  const [name, setName] = useState(profile?.name ?? '');
  // Members who are no longer tracked drop out here, so saving tidies the profile.
  const [picked, setPicked] = useState(() => new Set((profile?.keys ?? []).filter((k) => follows.has(k))));
  const all = useMemo(() => [...follows.values()].sort((a, b) => a.name.localeCompare(b.name)), [follows]);
  const full = !profile && list.length >= MAX_PROFILES;
  const ok = !!name.trim() && !full;
  const toggle = (key: string) => setPicked((s) => { const n = new Set(s); if (!n.delete(key)) n.add(key); return n; });
  const save = () => { if (ok && saveProfile({ id: profile?.id, name, keys: [...picked] })) onClose(); };

  return (
    <PlusSheet title={t(profile ? 'profile.edit' : 'profile.new')} onClose={onClose}>
      <TextInput value={name} onChangeText={setName} placeholder={t('profile.name')} placeholderTextColor={colors.textFaint} maxLength={MAX_NAME}
        style={styles.input} autoCorrect={false} returnKeyType="done" accessibilityLabel={t('profile.name')} />
      <Text style={styles.note}>{t('profile.note')}</Text>
      <Text style={styles.group}>{t('profile.members', { n: picked.size })}</Text>
      {all.map((tg) => {
        const on = picked.has(tg.key);
        return (
          <Pressable key={tg.key} onPress={() => toggle(tg.key)} style={styles.row} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
            <Avatar target={tg} size={32} />
            <Text style={styles.rowName} numberOfLines={1}>{tg.name}</Text>
            <Ionicons name={on ? 'checkbox' : 'square-outline'} size={22} color={on ? GOLD : colors.textFaint} />
          </Pressable>
        );
      })}
      {full ? <Text style={styles.note}>{t('profile.full', { n: MAX_PROFILES })}</Text> : null}
      <Pressable onPress={save} disabled={!ok} style={[styles.save, !ok && { opacity: 0.4 }]} accessibilityRole="button">
        <Text style={styles.saveText}>{t('profile.save')}</Text>
      </Pressable>
      {profile ? (
        <Pressable onPress={() => { deleteProfile(profile.id); onClose(); }} style={styles.del} accessibilityRole="button">
          <Text style={styles.delText}>{t('profile.delete')}</Text>
        </Pressable>
      ) : null}
    </PlusSheet>
  );
}

const styles = StyleSheet.create({
  input: { color: colors.text, fontSize: 16, paddingHorizontal: space(3), paddingVertical: space(2.5), backgroundColor: colors.surfaceHi, borderRadius: radius.md, ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null) },
  note: { color: colors.textFaint, fontSize: 12, lineHeight: 17 },
  group: { color: colors.textFaint, fontSize: 11, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space(3), paddingVertical: space(1) },
  rowName: { flex: 1, color: colors.text, fontSize: 15, fontWeight: '600' },
  save: { alignItems: 'center', paddingVertical: space(3), borderRadius: radius.pill, backgroundColor: GOLD },
  saveText: { color: '#1A1200', fontWeight: '800', fontSize: 15 },
  del: { alignItems: 'center', paddingVertical: space(2) },
  delText: { color: colors.hate, fontWeight: '700', fontSize: 14 },
});
