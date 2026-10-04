import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useStore } from '../../lib/store';
import { Avatar } from '../../components/Avatar';
import { SettingRow } from '../../components/SettingRow';
import { LeagueTag, SectionHeader, subtitle } from '../../components/ui';
import { colors, leagueColors, radius, space } from '../../theme';
import type { EventType } from '../../lib/types';

/**
 * Alert choices for ONE tracked player or team. Anything set here beats the global Settings tab for
 * this target only (e.g. no interception alerts for Daniel Jones while every other QB still sends them).
 */
export default function TargetAlertsScreen() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const targetKey = decodeURIComponent(key);
  const { follows, prefs, updatePrefs, eventTypes } = useStore();
  const target = follows.get(targetKey);

  // Only the alerts that can actually fire for this kind of target in this league.
  const types = useMemo(() => {
    if (!target) return [];
    const applies = (t: EventType) => t.leagues.includes(target.league) && (t.scope === target.kind || t.alsoScope === target.kind);
    // League-specific alerts first, then the ones every league shares (injuries, losses…).
    return eventTypes.filter(applies).sort((a, b) => Number(a.leagues.length > 1) - Number(b.leagues.length > 1));
  }, [eventTypes, target]);

  if (!target || !prefs) {
    return <View style={styles.center}><Text style={styles.dim}>You're no longer tracking this player or team.</Text></View>;
  }

  const own = prefs.targetTypes?.[targetKey] ?? {};
  const globalOn = (t: EventType) => prefs.leagues[target.league] !== false && (prefs.types[t.id] ?? t.defaultOn);
  const setOne = (typeId: string, value: boolean | null) => updatePrefs({ targetTypes: { [targetKey]: { [typeId]: value } } });
  const resetAll = () => updatePrefs({ targetTypes: { [targetKey]: Object.fromEntries(Object.keys(own).map((id) => [id, null])) } });
  const muted = prefs.muted.includes(targetKey);
  const name = target.kind === 'player' ? target.shortName ?? target.name : target.name;
  const customCount = Object.keys(own).length;

  return (
    <>
      <Stack.Screen options={{ title: `${name} alerts` }} />
      <ScrollView contentContainerStyle={{ paddingBottom: space(16) }} style={{ backgroundColor: colors.bg }}>
        <View style={styles.hero}>
          <Avatar target={target} size={64} />
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={styles.name} numberOfLines={2}>{target.name}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2) }}>
              <LeagueTag league={target.league} />
              <Text style={styles.dim} numberOfLines={1}>{subtitle(target)}</Text>
            </View>
          </View>
        </View>
        <Text style={styles.explain}>
          Choices here apply to {target.name} only and override your global alert settings. Anything you haven't changed follows the Settings tab.
        </Text>

        <SectionHeader>Delivery</SectionHeader>
        <View style={styles.card}>
          <SettingRow
            title="Push notifications"
            desc={muted ? `Off: ${name}'s alerts still show up in your feed, without a push.` : `Alerts about ${name} are pushed to your phone.`}
            value={!muted}
            onChange={(on) => updatePrefs({ muted: on ? prefs.muted.filter((k) => k !== targetKey) : [...prefs.muted, targetKey] })}
          />
        </View>

        <SectionHeader>Alerts for {name}</SectionHeader>
        <View style={[styles.card, { borderLeftWidth: 3, borderLeftColor: leagueColors[target.league] ?? colors.border }]}>
          {types.map((t) => {
            const custom = own[t.id] !== undefined;
            return (
              <SettingRow
                key={t.id}
                emoji={t.emoji}
                title={t.label}
                desc={t.description}
                value={custom ? own[t.id] : globalOn(t)}
                onChange={(v) => setOne(t.id, v)}
                footer={custom ? (
                  <View style={styles.footer}>
                    <Text style={styles.custom}>Custom for {name}</Text>
                    <Pressable onPress={() => setOne(t.id, null)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Use the global setting for ${t.label}`}>
                      <Text style={styles.reset}>Use global setting</Text>
                    </Pressable>
                  </View>
                ) : (
                  <Text style={styles.global}>Global setting ({globalOn(t) ? 'on' : 'off'})</Text>
                )}
              />
            );
          })}
        </View>

        <Pressable onPress={resetAll} disabled={!customCount} style={({ pressed }) => [styles.resetAll, !customCount && { opacity: 0.4 }, pressed && { opacity: 0.8 }]}>
          <Text style={styles.resetAllText}>{customCount ? `Reset all ${customCount} to global settings` : 'Everything follows your global settings'}</Text>
        </Pressable>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space(8), backgroundColor: colors.bg },
  hero: { flexDirection: 'row', alignItems: 'center', gap: space(4), padding: space(4), backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  name: { color: colors.text, fontSize: 20, fontWeight: '900' },
  dim: { color: colors.textDim, fontSize: 13, flexShrink: 1 },
  explain: { color: colors.textFaint, fontSize: 13, lineHeight: 18, paddingHorizontal: space(4), paddingTop: space(3) },
  card: { marginHorizontal: space(3), backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  footer: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space(2), marginTop: 4 },
  custom: { color: colors.hate, fontSize: 12, fontWeight: '800' },
  reset: { color: colors.text, fontSize: 12, fontWeight: '700', textDecorationLine: 'underline' },
  global: { color: colors.textFaint, fontSize: 12, marginTop: 4 },
  resetAll: { margin: space(4), paddingVertical: space(3), borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, alignItems: 'center' },
  resetAllText: { color: colors.textDim, fontWeight: '800', fontSize: 14 },
});
