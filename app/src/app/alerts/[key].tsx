import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useStore } from '../../lib/store';
import { Avatar } from '../../components/Avatar';
import { SettingRow, SettingSection } from '../../components/SettingRow';
import { LeagueTag, SectionHeader, subtitle } from '../../components/ui';
import { colors, radius, space } from '../../theme';
import { bySection, type EventType } from '../../lib/types';
import { fitsPosition, positionsOf } from '../../lib/positions';
import { leagueColor } from '../../lib/leagueUi';

/**
 * Alert choices for ONE tracked player or team. Anything set here beats the global Settings tab for
 * this target only (e.g. no interception alerts for Daniel Jones while every other QB still sends them).
 */
export default function TargetAlertsScreen() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const targetKey = decodeURIComponent(key);
  const { follows, prefs, updatePrefs, eventTypes, refreshScores } = useStore();
  const target = follows.get(targetKey);

  // Only the alerts that can actually fire for this kind of target in this league, and for a player, at
  // their positions: a pitcher has no hitting alerts, a skater no goalie ones (lib/positions.ts).
  const { types, hidden } = useMemo(() => {
    if (!target) return { types: [], hidden: 0 };
    // "Your Hate Watch" alerts (your streak, the weekly recap) are about you, not one team: Settings only.
    const applies = (t: EventType) => t.leagues.includes(target.league) && (t.scope === target.kind || t.alsoScope === target.kind) && t.section !== 'Your Hate Watch';
    const all = eventTypes.filter(applies);
    const fits = target.kind === 'player' ? all.filter((t) => fitsPosition(t, target)) : all;
    // League-specific alerts first (offense, defense, pitching, team…), then the ones every league shares
    // (the game, injuries and news), each under its section heading as in Settings.
    return { types: fits.sort((a, b) => Number(a.leagues.length > 1) - Number(b.leagues.length > 1)), hidden: all.length - fits.length };
  }, [eventTypes, target]);

  if (!target || !prefs) {
    return <View style={styles.center}><Text style={styles.dim}>You're no longer tracking this player or team.</Text></View>;
  }

  const own = prefs.targetTypes?.[targetKey] ?? {};
  const ownPush = prefs.targetPushTypes?.[targetKey] ?? {};
  const globalOn = (t: EventType) => prefs.leagues[target.league] !== false && (prefs.types[t.id] ?? t.defaultOn);
  const globalPush = (t: EventType) => prefs.pushTypes?.[t.id] ?? t.defaultPush ?? true;
  const setOne = (typeId: string, value: boolean | null) => updatePrefs({ targetTypes: { [targetKey]: { [typeId]: value } } });
  const setPush = (typeId: string, value: boolean | null) => updatePrefs({ targetPushTypes: { [targetKey]: { [typeId]: value } } });
  // "Use global setting" and "Reset all" clear both the switch and the 🔔 overrides.
  const resetTypes = (ids: string[]) => {
    const nulls = (map: Record<string, boolean>) => Object.fromEntries(ids.filter((id) => id in map).map((id) => [id, null]));
    updatePrefs({ targetTypes: { [targetKey]: nulls(own) }, targetPushTypes: { [targetKey]: nulls(ownPush) } });
  };
  const customIds = [...new Set([...Object.keys(own), ...Object.keys(ownPush)])];
  const muted = prefs.muted.includes(targetKey);
  const name = target.kind === 'player' ? target.shortName ?? target.name : target.name;
  const customCount = customIds.length;
  // A player's team: its games on the Scores tab (shown by default), its own alerts (off by default).
  // Tracking the team itself already gets both.
  const team = target.kind === 'player' ? { key: target.teamKey, name: target.teamName ?? 'their team' } : null;
  const teamTracked = !!team && follows.has(team.key);
  const choice = prefs.playerTeams?.[targetKey] ?? {};
  const setTeam = (patch: { scores?: boolean | null; alerts?: boolean | null }) =>
    updatePrefs({ playerTeams: { [targetKey]: patch } }).then(() => { if (patch.scores !== undefined) refreshScores().catch(() => {}); }).catch(() => {});

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

        {team ? (
          <>
            <SectionHeader>Their team</SectionHeader>
            <View style={styles.card}>
              {target.league !== 'f1' ? (
                <SettingRow
                  title="Show their team's games"
                  desc={teamTracked ? `You track the ${team.name} too.` : `${team.name} games in My games and Up next on the Scores tab.`}
                  value={teamTracked || choice.scores !== false}
                  disabled={teamTracked}
                  onChange={(on) => setTeam({ scores: on ? null : false })}
                />
              ) : null}
              <SettingRow
                title="Get their team's alerts"
                desc={teamTracked ? `You track the ${team.name} too.` : `${team.name} alerts as if you tracked them, by your Team alerts settings.`}
                value={teamTracked || choice.alerts === true}
                disabled={teamTracked}
                onChange={(on) => setTeam({ alerts: on ? true : null })}
              />
            </View>
          </>
        ) : null}

        <SectionHeader>Alerts for {name}</SectionHeader>
        {hidden && target.kind === 'player' ? (
          <Text style={styles.positionNote}>
            Showing the alerts that fit {name}'s position{positionsOf(target).length > 1 ? 's' : ''} ({positionsOf(target).join(', ')}). {hidden} that don't {hidden === 1 ? 'is' : 'are'} hidden.
          </Text>
        ) : null}
        <View style={[styles.card, { borderLeftWidth: 3, borderLeftColor: leagueColor(target.league) ?? colors.border }]}>
          {bySection(types).map((s) => (
            <View key={s.section}>
              <SettingSection title={s.section} />
              {s.types.map((t) => {
                const custom = own[t.id] !== undefined || ownPush[t.id] !== undefined;
                return (
                  <SettingRow
                    key={t.id}
                    emoji={t.emoji}
                    title={t.label}
                    value={own[t.id] ?? globalOn(t)}
                    onChange={(v) => setOne(t.id, v)}
                    push={{ on: ownPush[t.id] ?? globalPush(t), onChange: (v) => setPush(t.id, v) }}
                    footer={custom ? (
                      <View style={styles.footer}>
                        <Text style={styles.custom}>Custom for {name}</Text>
                        <Pressable onPress={() => resetTypes([t.id])} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Use the global setting for ${t.label}`}>
                          <Text style={styles.reset}>Use global setting</Text>
                        </Pressable>
                      </View>
                    ) : (
                      <Text style={styles.global}>Global setting ({!globalOn(t) ? 'off' : globalPush(t) ? 'on' : 'on, feed only'})</Text>
                    )}
                  />
                );
              })}
            </View>
          ))}
        </View>

        <Pressable onPress={() => resetTypes(customIds)} disabled={!customCount} style={({ pressed }) => [styles.resetAll, !customCount && { opacity: 0.4 }, pressed && { opacity: 0.8 }]}>
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
  positionNote: { color: colors.textFaint, fontSize: 12, lineHeight: 17, paddingHorizontal: space(4), paddingBottom: space(2) },
  explain: { color: colors.textFaint, fontSize: 13, lineHeight: 18, paddingHorizontal: space(4), paddingTop: space(3) },
  card: { marginHorizontal: space(3), backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  footer: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space(2), marginTop: 4 },
  custom: { color: colors.hate, fontSize: 12, fontWeight: '800' },
  reset: { color: colors.text, fontSize: 12, fontWeight: '700', textDecorationLine: 'underline' },
  global: { color: colors.textFaint, fontSize: 12, marginTop: 4 },
  resetAll: { margin: space(4), paddingVertical: space(3), borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, alignItems: 'center' },
  resetAllText: { color: colors.textDim, fontWeight: '800', fontSize: 14 },
});
