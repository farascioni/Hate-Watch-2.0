import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useStore } from '../../lib/store';
import { Avatar } from '../../components/Avatar';
import { SettingRow, SettingSection } from '../../components/SettingRow';
import { LeagueTag, SectionHeader, subtitle } from '../../components/ui';
import { GOLD, colors, radius, space } from '../../theme';
import { PresetSheet } from '../../components/PresetSheet';
import { usePlus } from '../../lib/plus';
import { presetPatch, snapshotChoices, type Choices } from '../../lib/profileLogic';
import { bySection, type EventType } from '../../lib/types';
import { fitsPosition, positionsOf } from '../../lib/positions';
import { leagueColor } from '../../lib/leagueUi';
import { useT } from '../../lib/i18n';
import type { Key } from '../../lib/strings/en';

/**
 * Alert choices for ONE tracked player or team. Anything set here beats the global Settings tab for
 * this target only (e.g. no interception alerts for Daniel Jones while every other QB still sends them).
 * With `?fav=1` it is a Hate Watch Plus favorite instead: the same alerts, but the ones about the favorite's
 * opponent while they play, kept on the favorite (not in prefs.targetTypes).
 */
export default function TargetAlertsScreen() {
  const t = useT();
  const { key, fav } = useLocalSearchParams<{ key: string; fav?: string }>();
  const isFav = fav === '1';
  const targetKey = decodeURIComponent(key);
  const { follows, favorites, updateFavorite, prefs, updatePrefs, eventTypes, refreshScores } = useStore();
  const favorite = isFav ? favorites.get(targetKey) : undefined;
  const target = isFav ? favorite?.target ?? undefined : follows.get(targetKey);
  const { active: plus } = usePlus();
  const [presets, setPresets] = useState(false);

  // Only the alerts that can actually fire for this kind of target in this league, and for a player, at
  // their positions: a pitcher has no hitting alerts, a skater no goalie ones (lib/positions.ts).
  const { types, hidden } = useMemo(() => {
    if (!target) return { types: [], hidden: 0 };
    // "Your Hate Watch" alerts (your streak, the weekly recap) are about you, not one team: Settings only.
    const applies = (e: EventType) => e.leagues.includes(target.league) && (e.scope === target.kind || e.alsoScope === target.kind) && e.section !== 'Your Hate Watch';
    const all = eventTypes.filter(applies);
    const fits = target.kind === 'player' ? all.filter((e) => fitsPosition(e, target)) : all;
    // League-specific alerts first (offense, defense, pitching, team…), then the ones every league shares
    // (the game, injuries and news), each under its section heading as in Settings.
    return { types: fits.sort((a, b) => Number(a.leagues.length > 1) - Number(b.leagues.length > 1)), hidden: all.length - fits.length };
  }, [eventTypes, target]);

  if (!target || !prefs) {
    return <View style={styles.center}><Text style={styles.dim}>{isFav ? t('alerts.noFav') : t('alerts.noTarget')}</Text></View>;
  }

  const own = (isFav ? favorite?.types : prefs.targetTypes?.[targetKey]) ?? {};
  const ownPush = (isFav ? favorite?.pushTypes : prefs.targetPushTypes?.[targetKey]) ?? {};
  const globalOn = (e: EventType) => prefs.leagues[target.league] !== false && (prefs.types[e.id] ?? e.defaultOn);
  const globalPush = (e: EventType) => prefs.pushTypes?.[e.id] ?? e.defaultPush ?? true;
  const setOne = (typeId: string, value: boolean | null) => (isFav ? updateFavorite(targetKey, { types: { [typeId]: value } }).catch(() => {}) : updatePrefs({ targetTypes: { [targetKey]: { [typeId]: value } } }));
  const setPush = (typeId: string, value: boolean | null) => (isFav ? updateFavorite(targetKey, { pushTypes: { [typeId]: value } }).catch(() => {}) : updatePrefs({ targetPushTypes: { [targetKey]: { [typeId]: value } } }));
  // "Use global setting" and "Reset all" clear both the switch and the 🔔 overrides.
  const resetTypes = (ids: string[]) => {
    const nulls = (map: Record<string, boolean>) => Object.fromEntries(ids.filter((id) => id in map).map((id) => [id, null]));
    if (isFav) updateFavorite(targetKey, { types: nulls(own), pushTypes: nulls(ownPush) }).catch(() => {});
    else updatePrefs({ targetTypes: { [targetKey]: nulls(own) }, targetPushTypes: { [targetKey]: nulls(ownPush) } });
  };
  const customIds = [...new Set([...Object.keys(own), ...Object.keys(ownPush)])];
  const muted = isFav ? favorite?.push === false : prefs.muted.includes(targetKey);
  const name = target.kind === 'player' ? target.shortName ?? target.name : target.name;
  const customCount = customIds.length;
  // Hate Watch Plus's presets (a followed target only): one updatePrefs call replaces this target's custom choices, as rapid calls race.
  const ids = types.map((e) => e.id);
  const only = (map: Record<string, boolean>) => Object.fromEntries(Object.entries(map).filter(([id]) => ids.includes(id)));
  const typeById = new Map(types.map((e) => [e.id, e]));
  const current = snapshotChoices(only(own), only(ownPush), (id) => globalOn(typeById.get(id)!), (id) => globalPush(typeById.get(id)!));
  const applyPreset = (choices: Choices) => {
    const patch = presetPatch(choices, ids, own, ownPush);
    updatePrefs({ targetTypes: { [targetKey]: patch.types }, targetPushTypes: { [targetKey]: patch.push } });
  };
  // A player's team: its games on the Scores tab (shown by default), its own alerts (off by default).
  // Tracking the team itself already gets both.
  const team = target.kind === 'player' ? { key: target.teamKey, name: target.teamName ?? 'their team' } : null;
  const teamTracked = !!team && follows.has(team.key);
  const choice = prefs.playerTeams?.[targetKey] ?? {};
  const setTeam = (patch: { scores?: boolean | null; alerts?: boolean | null }) =>
    updatePrefs({ playerTeams: { [targetKey]: patch } }).then(() => { if (patch.scores !== undefined) refreshScores().catch(() => {}); }).catch(() => {});

  return (
    <>
      <Stack.Screen options={{ title: isFav ? t('alerts.titleFav', { name }) : t('alerts.title', { name }) }} />
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
          {isFav ? t('alerts.explainFav', { name }) : t('alerts.explain', { name: target.name })}
        </Text>

        <SectionHeader>{t('settings.delivery')}</SectionHeader>
        <View style={styles.card}>
          <SettingRow
            title={t('settings.push')}
            desc={t(`alerts.push${isFav ? 'Fav' : ''}${muted ? 'Off' : 'On'}` as Key, { name })}
            value={!muted}
            onChange={(on) => (isFav ? updateFavorite(targetKey, { push: on }).catch(() => {}) : updatePrefs({ muted: on ? prefs.muted.filter((k) => k !== targetKey) : [...prefs.muted, targetKey] }))}
          />
        </View>

        {team ? (
          <>
            <SectionHeader>{t('alerts.theirTeam')}</SectionHeader>
            <View style={styles.card}>
              {target.league !== 'f1' ? (
                <SettingRow
                  title={t('alerts.teamGames')}
                  desc={teamTracked ? t('alerts.teamTracked', { team: team.name }) : t('alerts.teamGamesDesc', { team: team.name })}
                  value={teamTracked || choice.scores !== false}
                  disabled={teamTracked}
                  onChange={(on) => setTeam({ scores: on ? null : false })}
                />
              ) : null}
              <SettingRow
                title={t('alerts.teamAlerts')}
                desc={teamTracked ? t('alerts.teamTracked', { team: team.name }) : t('alerts.teamAlertsDesc', { team: team.name })}
                value={teamTracked || choice.alerts === true}
                disabled={teamTracked}
                onChange={(on) => setTeam({ alerts: on ? true : null })}
              />
            </View>
          </>
        ) : null}

        {plus && !isFav ? (
          <Pressable onPress={() => setPresets(true)} style={({ pressed }) => [styles.presets, pressed && { opacity: 0.8 }]} accessibilityRole="button">
            <Text style={styles.presetsTitle}>{t('preset.row')}</Text>
            <Text style={styles.presetsBody}>{t('preset.rowBody')}</Text>
          </Pressable>
        ) : null}
        <SectionHeader>{isFav ? t('alerts.inGames', { name }) : t('alerts.for', { name })}</SectionHeader>
        {hidden && target.kind === 'player' ? (
          <Text style={styles.positionNote}>
            {t(positionsOf(target).length > 1 ? 'alerts.positionsNote' : 'alerts.positionNote', { name, list: positionsOf(target).join(', '), n: hidden })}
          </Text>
        ) : null}
        <View style={[styles.card, { borderLeftWidth: 3, borderLeftColor: leagueColor(target.league) ?? colors.border }]}>
          {bySection(types).map((s) => (
            <View key={s.section}>
              <SettingSection title={s.section} />
              {s.types.map((ty) => {
                const custom = own[ty.id] !== undefined || ownPush[ty.id] !== undefined;
                return (
                  <SettingRow
                    key={ty.id}
                    emoji={ty.emoji}
                    title={ty.label}
                    value={own[ty.id] ?? globalOn(ty)}
                    onChange={(v) => setOne(ty.id, v)}
                    push={{ on: ownPush[ty.id] ?? globalPush(ty), onChange: (v) => setPush(ty.id, v) }}
                    footer={custom ? (
                      <View style={styles.footer}>
                        <Text style={styles.custom}>{t('alerts.customFor', { name: isFav ? t('alerts.titleFav', { name }) : name })}</Text>
                        <Pressable onPress={() => resetTypes([ty.id])} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('alerts.useGlobalFor', { label: ty.label })}>
                          <Text style={styles.reset}>{t('alerts.useGlobal')}</Text>
                        </Pressable>
                      </View>
                    ) : (
                      <Text style={styles.global}>{t(!globalOn(ty) ? 'alerts.globalOff' : globalPush(ty) ? 'alerts.globalOn' : 'alerts.globalFeed')}</Text>
                    )}
                  />
                );
              })}
            </View>
          ))}
        </View>

        <Pressable onPress={() => resetTypes(customIds)} disabled={!customCount} style={({ pressed }) => [styles.resetAll, !customCount && { opacity: 0.4 }, pressed && { opacity: 0.8 }]}>
          <Text style={styles.resetAllText}>{customCount ? t('alerts.resetAll', { n: customCount }) : t('alerts.allGlobal')}</Text>
        </Pressable>
      </ScrollView>
      {presets ? <PresetSheet name={name} types={types} current={current} onApply={applyPreset} onClose={() => setPresets(false)} /> : null}
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
  presets: { marginHorizontal: space(3), marginTop: space(3), padding: space(3), borderRadius: radius.lg, borderWidth: 1, borderColor: GOLD, backgroundColor: colors.surface },
  presetsTitle: { color: GOLD, fontSize: 15, fontWeight: '800' },
  presetsBody: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  resetAll: { margin: space(4), paddingVertical: space(3), borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, alignItems: 'center' },
  resetAllText: { color: colors.textDim, fontWeight: '800', fontSize: 14 },
});
