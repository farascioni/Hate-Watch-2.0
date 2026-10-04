import { useMemo } from 'react';
import { Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useStore } from '../../lib/store';
import { Empty, PrimaryButton, SectionHeader, TargetRow } from '../../components/ui';
import { colors, radius, space } from '../../theme';
import type { Target } from '../../lib/types';

export default function FollowingScreen() {
  const { follows, toggleFollow, prefs, updatePrefs } = useStore();
  const muted = new Set(prefs?.muted ?? []);

  const sections = useMemo((): { title: string; data: Target[] }[] => {
    const all = [...follows.values()].sort((a, b) => a.name.localeCompare(b.name));
    return [
      { title: 'Teams', data: all.filter((t) => t.kind === 'team') },
      { title: 'Players', data: all.filter((t) => t.kind === 'player') },
    ].filter((s) => s.data.length);
  }, [follows]);

  const toggleMute = (t: Target) => {
    const next = muted.has(t.key) ? [...muted].filter((k) => k !== t.key) : [...muted, t.key];
    updatePrefs({ muted: next });
  };

  if (!follows.size) {
    return <Empty emoji="🎯" title="You're not tracking anyone" body="Search for a player or team and tap Track." action={<PrimaryButton label="Search" onPress={() => router.navigate('/search')} />} />;
  }

  return (
    <SectionList
      sections={sections}
      keyExtractor={(t) => t.key}
      renderSectionHeader={({ section }) => <SectionHeader>{section.title} · {section.data.length}</SectionHeader>}
      ListHeaderComponent={<Text style={styles.hint}>🔕 turns off push notifications for one player or team. Their alerts still show up in your feed. Unfollow stops tracking them entirely.</Text>}
      renderItem={({ item }) => (
        <TargetRow
          target={item}
          right={
            <View style={styles.actions}>
              <Pressable onPress={() => toggleMute(item)} hitSlop={8} style={styles.icon} accessibilityLabel={muted.has(item.key) ? `Turn push notifications back on for ${item.name}` : `Turn off push notifications for ${item.name} (alerts stay in your feed)`}>
                <Ionicons name={muted.has(item.key) ? 'notifications-off' : 'notifications'} size={20} color={muted.has(item.key) ? colors.textFaint : colors.text} />
              </Pressable>
              <Pressable onPress={() => toggleFollow(item)} hitSlop={8} style={styles.unfollow} accessibilityLabel={`Unfollow ${item.name}`}>
                <Text style={styles.unfollowText}>Unfollow</Text>
              </Pressable>
            </View>
          }
        />
      )}
      contentContainerStyle={{ paddingBottom: space(8) }}
    />
  );
}

const styles = StyleSheet.create({
  hint: { color: colors.textFaint, fontSize: 13, paddingHorizontal: space(4), paddingTop: space(3), lineHeight: 18 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  icon: { padding: space(2), borderRadius: radius.pill, backgroundColor: colors.surface },
  unfollow: { paddingHorizontal: space(3), paddingVertical: space(2), borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border },
  unfollowText: { color: colors.textDim, fontWeight: '700', fontSize: 13 },
});
