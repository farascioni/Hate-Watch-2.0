import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Chip } from './ui';
import { ProfileSheet } from './ProfileSheet';
import { setActiveProfile, useProfiles } from '../lib/profiles';
import type { Profile } from '../lib/profileLogic';
import { usePlus } from '../lib/plus';
import type { Target } from '../lib/types';
import { GOLD, colors, space } from '../theme';
import { useT } from '../lib/i18n';

/**
 * Hate Watch Plus: the row of profile chips (Everyone, then your profiles) above the Feed and the Tracking tab. On the
 * Tracking tab (`editable`) there is a + chip to make one and a tap on the active chip edits it; on the Feed a profile
 * can only be picked (and the row isn't there until one exists). Hidden for anyone not subscribed.
 */
export function ProfileChips({ follows, editable }: { follows: ReadonlyMap<string, Target>; editable?: boolean }) {
  const t = useT();
  const { active: plus } = usePlus();
  const { list, active } = useProfiles();
  const [editing, setEditing] = useState<Profile | 'new' | null>(null);
  if (!plus || (!list.length && !editable)) return null;
  const pick = (p: Profile) => (active === p.id ? (editable ? setEditing(p) : setActiveProfile(null)) : setActiveProfile(p.id));
  return (
    <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scroll} contentContainerStyle={styles.row}>
        <Chip label={t('profile.everyone')} active={!active || !list.some((p) => p.id === active)} color={GOLD} onPress={() => setActiveProfile(null)} />
        {list.map((p) => <Chip key={p.id} label={p.name} active={active === p.id} color={GOLD} onPress={() => pick(p)} accessibilityLabel={active === p.id && editable ? t('profile.editA11y', { name: p.name }) : undefined} />)}
        {editable ? <Chip label="+" color={GOLD} onPress={() => setEditing('new')} accessibilityLabel={t('profile.new')} /> : null}
      </ScrollView>
      {editing ? <ProfileSheet profile={editing === 'new' ? null : editing} follows={follows} onClose={() => setEditing(null)} /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0, flexShrink: 0, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  row: { flexDirection: 'row', gap: space(1.5), paddingHorizontal: space(3), paddingVertical: space(2) },
});
