import { useCallback, useMemo } from 'react';
import { Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useStore } from '../../lib/store';
import { Empty, PrimaryButton, SectionHeader, TargetRow } from '../../components/ui';
import { FilterBar, describeFilter, matchesFilter, useFilter } from '../../components/FilterBar';
import { colors, radius, space } from '../../theme';
import type { Target } from '../../lib/types';

export default function FollowingScreen() {
  const { follows, toggleFollow, prefs, updatePrefs, refreshTrackers } = useStore();
  // Other people follow and unfollow too: fresh counts each time the tab opens.
  useFocusEffect(useCallback(() => { refreshTrackers().catch(() => {}); }, [refreshTrackers]));
  const muted = new Set(prefs?.muted ?? []);
  const customized = new Set([...Object.keys(prefs?.targetTypes ?? {}), ...Object.keys(prefs?.targetPushTypes ?? {})]);
  const { filter, setFilter, active, reset } = useFilter();

  const sections = useMemo((): { title: string; data: Target[] }[] => {
    const all = [...follows.values()].filter((t) => matchesFilter(filter, t)).sort((a, b) => a.name.localeCompare(b.name));
    return [
      { title: 'Teams', data: all.filter((t) => t.kind === 'team') },
      { title: 'Players', data: all.filter((t) => t.kind === 'player') },
    ].filter((s) => s.data.length);
  }, [follows, filter]);

  const toggleMute = (t: Target) => {
    const next = muted.has(t.key) ? [...muted].filter((k) => k !== t.key) : [...muted, t.key];
    updatePrefs({ muted: next });
  };

  if (!follows.size) {
    return <Empty emoji="🎯" title="You're not tracking anyone" body="Search for a player or team and tap Track." action={<PrimaryButton label="Search" onPress={() => router.navigate('/search')} />} />;
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
    <View style={styles.filters}><FilterBar filter={filter} onChange={setFilter} /></View>
    <SectionList
      sections={sections}
      keyExtractor={(t) => t.key}
      renderSectionHeader={({ section }) => <SectionHeader>{section.title} · {section.data.length}</SectionHeader>}
      stickySectionHeadersEnabled // "Teams · 3" / "Players · 6" stay on top while scrolling, on every platform
      ListHeaderComponent={<Text style={styles.hint}>🔕 turns off push notifications for one player or team; their alerts still show up in your feed. ⚙️ picks which alerts you get for just that player or team. Unfollow stops tracking them entirely.</Text>}
      renderItem={({ item }) => (
        <TargetRow
          target={item}
          right={
            <View style={styles.actions}>
              <Pressable onPress={() => toggleMute(item)} hitSlop={8} style={styles.icon} accessibilityLabel={muted.has(item.key) ? `Turn push notifications back on for ${item.name}` : `Turn off push notifications for ${item.name} (alerts stay in your feed)`}>
                <Ionicons name={muted.has(item.key) ? 'notifications-off' : 'notifications'} size={20} color={muted.has(item.key) ? colors.textFaint : colors.text} />
              </Pressable>
              {/* Per-player/team alert choices. Red when this target has any that differ from the global settings. */}
              <Pressable
                onPress={() => router.push(`/alerts/${encodeURIComponent(item.key)}`)}
                hitSlop={8}
                style={[styles.icon, customized.has(item.key) && styles.iconCustom]}
                accessibilityRole="button"
                accessibilityLabel={`Alert settings for ${item.name}${customized.has(item.key) ? ' (customized)' : ''}`}
              >
                <Ionicons name="settings-sharp" size={20} color={customized.has(item.key) ? colors.hate : colors.text} />
              </Pressable>
              <Pressable onPress={() => toggleFollow(item)} hitSlop={8} style={styles.unfollow} accessibilityLabel={`Unfollow ${item.name}`}>
                <Text style={styles.unfollowText}>Unfollow</Text>
              </Pressable>
            </View>
          }
        />
      )}
      ListEmptyComponent={active ? <Empty emoji="🔎" title={`You're not tracking any ${describeFilter(filter)}`} body="Change the filter, or find some on the Search tab." action={<PrimaryButton label="Show everything" onPress={reset} />} /> : null}
      contentContainerStyle={{ paddingBottom: space(8), flexGrow: 1 }}
    />
    </View>
  );
}

const styles = StyleSheet.create({
  filters: { paddingTop: space(3), borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  hint: { color: colors.textFaint, fontSize: 13, paddingHorizontal: space(4), paddingTop: space(3), lineHeight: 18 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  icon: { padding: space(2), borderRadius: radius.pill, backgroundColor: colors.surface },
  iconCustom: { borderWidth: 1, borderColor: colors.hate },
  unfollow: { paddingHorizontal: space(3), paddingVertical: space(2), borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border },
  unfollowText: { color: colors.textDim, fontWeight: '700', fontSize: 13 },
});
