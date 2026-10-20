import { useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Chip } from './ui';
import { ProfileSheet } from './ProfileSheet';
import { setActiveProfile, useProfiles } from '../lib/profiles';
import type { Profile } from '../lib/profileLogic';
import { usePlus } from '../lib/plus';
import type { Target } from '../lib/types';
import { GOLD, space } from '../theme';
import { useT } from '../lib/i18n';

/**
 * Hate Watch Plus: a profile's chips in the row of a screen's own chip (`lead`: Most hated on the Tracking tab, Saved on
 * the Feed). Each profile is a toggle: tap to narrow, tap again for everyone (there is no Everyone chip). On the Tracking
 * tab (`editable`) a + chip, next to `lead`, makes a profile and an Edit chip follows the active one. `hidden` keeps only
 * `lead` (the Feed's Saved list ignores profiles). Without Plus only `lead` shows, or nothing when there is none.
 */
export function ProfileChips({ follows, editable, lead, hidden, style }: { follows: ReadonlyMap<string, Target>; editable?: boolean; lead?: ReactNode; hidden?: boolean; style?: StyleProp<ViewStyle> }) {
  const t = useT();
  const { active: plus } = usePlus();
  const { list, active } = useProfiles();
  const [editing, setEditing] = useState<Profile | 'new' | null>(null);
  const chips = plus && !hidden;
  if (!lead && !chips) return null;
  return (
    <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[styles.scroll, style]} contentContainerStyle={styles.row}>
        {lead}
        {chips && editable ? <Chip label="+" color={GOLD} onPress={() => setEditing('new')} accessibilityLabel={t('profile.new')} /> : null}
        {chips ? list.flatMap((p) => [
          <Chip key={p.id} label={p.name} active={active === p.id} color={GOLD} onPress={() => setActiveProfile(active === p.id ? null : p.id)} />,
          ...(editable && active === p.id ? [<Chip key={`${p.id}-edit`} label={t('profile.edit')} color={GOLD} onPress={() => setEditing(p)} accessibilityLabel={t('profile.editA11y', { name: p.name })} />] : []),
        ]) : null}
      </ScrollView>
      {editing ? <ProfileSheet profile={editing === 'new' ? null : editing} follows={follows} onClose={() => setEditing(null)} /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0, flexShrink: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space(1.5), paddingHorizontal: space(3) },
});
