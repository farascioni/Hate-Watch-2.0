import { useState } from 'react';
import { Alert, LayoutAnimation, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useStore } from '../../lib/store';
import { api, API_URL } from '../../lib/api';
import { SectionHeader } from '../../components/ui';
import { Plus } from '../../components/Plus';
import { Favorites } from '../../components/Favorites';
import { setDevPlus, useDevPlus } from '../../lib/plus';
import { HateWatchCounter } from '../../components/HateWatchCounter';
import { SettingRow, SettingSection } from '../../components/SettingRow';
import { COLUMN } from '../../lib/webLayout';
import { liveBoardSupported, LIVE_LAYOUTS, setLiveBoard, setLiveLayout, useLiveBoard, useLiveLayout } from '../../lib/liveScoreboard';
import { FEEDBACK_EMAIL, sendFeedback } from '../../lib/feedback';
import { colors, radius, space } from '../../theme';
import { bySection, type EventType, type League } from '../../lib/types';
import { leagueColor } from '../../lib/leagueUi';
import { LANGS, currentLocale, setLangPref, useLangPref, useT } from '../../lib/i18n';

/** A folded alert group shows this many of its emoji (the last place becomes "+N" when there are more). Cutting the line short would split an emoji. */
const FOLDED_EMOJI = 6;
const HOURS = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`);
const fmtHour = (hm: string) => new Date(2000, 0, 1, Number(hm.slice(0, 2))).toLocaleTimeString(currentLocale(), { hour: 'numeric' });

function HourStepper({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const t = useT();
  const i = Math.max(0, HOURS.indexOf(value));
  return (
    <View style={styles.stepper}>
      <Text style={styles.desc}>{label}</Text>
      <View style={styles.stepRow}>
        <Pressable style={styles.stepBtn} onPress={() => onChange(HOURS[(i + 23) % 24])} accessibilityLabel={t('settings.earlier', { label })}><Text style={styles.stepTxt}>−</Text></Pressable>
        <Text style={styles.stepVal}>{fmtHour(value)}</Text>
        <Pressable style={styles.stepBtn} onPress={() => onChange(HOURS[(i + 1) % 24])} accessibilityLabel={t('settings.later', { label })}><Text style={styles.stepTxt}>+</Text></Pressable>
      </View>
    </View>
  );
}

export default function SettingsScreen() {
  const liveBoard = useLiveBoard();
  const liveLayout = useLiveLayout();
  const t = useT();
  const langPref = useLangPref();
  const { prefs, updatePrefs, eventTypes, leagues, push, enablePush, clearFeed, deleteAllData } = useStore();
  // Each alert group folds up (all start folded, so the page isn't 69 rows long). The tab stays mounted, so this survives switching tabs.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const devPlus = useDevPlus();
  if (!prefs) return null;
  const toggleGroup = (title: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpenGroups((o) => ({ ...o, [title]: !o[title] }));
  };

  const on = (t: EventType) => prefs.types[t.id] ?? t.defaultOn;
  const setType = (id: string, v: boolean) => updatePrefs({ types: { [id]: v } });
  // An alert's 🔔: off keeps it in the feed without a notification.
  const pushOn = (t: EventType) => prefs.pushTypes?.[t.id] ?? t.defaultPush ?? true;
  const setPush = (id: string, v: boolean) => updatePrefs({ pushTypes: { [id]: v } });
  const leagueOn = (l: League) => prefs.leagues[l] !== false;
  // A league switched off (from when Settings had a Leagues section) comes back on with its group's "All on".
  const setAll = (types: EventType[], v: boolean, league?: League) =>
    updatePrefs({ types: Object.fromEntries(types.map((t) => [t.id, v])), ...(v && league && !leagueOn(league) ? { leagues: { [league]: true } } : {}) });

  const groups: { title: string; color?: string; league?: League; types: EventType[] }[] = [
    // League-only alerts live under their league, in the server's order: offense, defense, pitching, then
    // team ones like MLB "strands runners", each under its section heading.
    ...leagues.map((l) => ({
      title: t('settings.leagueAlerts', { name: l.name }), color: leagueColor(l.id), league: l.id,
      types: eventTypes.filter((t) => t.leagues.length === 1 && t.leagues[0] === l.id),
    })),
    { title: t('settings.allPlayerAlerts'), types: eventTypes.filter((t) => t.scope === 'player' && t.leagues.length > 1) },
    { title: t('settings.teamAlerts'), types: eventTypes.filter((t) => t.scope === 'team' && t.leagues.length > 1) },
  ];

  return (
    <ScrollView contentContainerStyle={[{ paddingBottom: space(16) }, COLUMN]}>
      <HateWatchCounter />

      <SectionHeader>{t('settings.support')}</SectionHeader>
      <Plus />
      <Favorites />

      <SectionHeader>{t('settings.delivery')}</SectionHeader>
      <View style={styles.card}>
        <SettingRow title={t('settings.push')} desc={push.status === 'granted' ? t('settings.pushGranted') : push.status === 'denied' ? t('settings.pushDenied') : push.reason ?? t('settings.pushChecking')} value={prefs.pushEnabled && push.status === 'granted'} onChange={async (v) => { if (v && push.status !== 'granted') await enablePush(); updatePrefs({ pushEnabled: v }); }} disabled={push.status === 'unavailable'} />
        <SettingRow title={t('settings.sound')} desc={t('settings.soundDesc')} value={prefs.sound} onChange={(v) => updatePrefs({ sound: v })} />
        {liveBoardSupported ? <SettingRow title={t('settings.lockScreen')} desc={t('settings.lockScreenDesc')} value={liveBoard} onChange={(v) => { setLiveBoard(v); }} /> : null}
        {liveBoardSupported && liveBoard ? (
          <View style={styles.layoutRow}>
            <Text style={styles.layoutTitle}>{t('settings.layout')}</Text>
            <Text style={styles.desc}>{t(`layout.${liveLayout}Desc`)}{liveLayout === 'compact' ? '' : t('settings.layoutNewest')}</Text>
            <View style={styles.layoutChips}>
              {LIVE_LAYOUTS.map((l) => (
                <Pressable key={l} onPress={() => { setLiveLayout(l); }} accessibilityRole="radio" aria-checked={l === liveLayout} style={[styles.layoutChip, l === liveLayout && styles.layoutChipOn]}>
                  <Text style={[styles.layoutChipText, l === liveLayout && { color: colors.text }]}>{t(`layout.${l}`)}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}
        <SettingRow title={t('settings.quiet')} desc={t('settings.quietDesc')} value={prefs.quietHours.enabled} onChange={(v) => updatePrefs({ quietHours: { ...prefs.quietHours, enabled: v, tz: Intl.DateTimeFormat().resolvedOptions().timeZone } })} />
        {prefs.quietHours.enabled ? (
          <View style={styles.quiet}>
            <HourStepper label={t('settings.from')} value={prefs.quietHours.start} onChange={(start) => updatePrefs({ quietHours: { ...prefs.quietHours, start } })} />
            <HourStepper label={t('settings.until')} value={prefs.quietHours.end} onChange={(end) => updatePrefs({ quietHours: { ...prefs.quietHours, end } })} />
          </View>
        ) : null}
      </View>

      <Text style={styles.hint}>
        {t('settings.hint')}
      </Text>

      {groups.filter((g) => g.types.length).map((g) => {
        const off = g.league ? !leagueOn(g.league) : false;
        const allOn = !off && g.types.every(on);
        const isOpen = !!openGroups[g.title];
        const summary = off ? t('settings.leagueOff') : t('settings.countOn', { on: g.types.filter(on).length, total: g.types.length });
        return (
          <View key={g.title}>
            <View style={styles.groupHead}>
              <Pressable onPress={() => toggleGroup(g.title)} hitSlop={8} style={({ pressed }) => [styles.groupToggle, pressed && { opacity: 0.6 }]}
                accessibilityRole="button" aria-expanded={isOpen} accessibilityLabel={`${g.title}, ${summary}`} accessibilityHint={isOpen ? t('settings.hides') : t('settings.shows')}>
                <Text style={styles.groupTitle}>{g.title}</Text>
                <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={13} color={colors.textFaint} />
              </Pressable>
              <Pressable onPress={() => setAll(g.types, !allOn, g.league)} hitSlop={8}><Text style={styles.toggleAll}>{allOn ? t('settings.allOff') : t('settings.allOn')}</Text></Pressable>
            </View>
            <View style={[styles.card, g.color ? { borderLeftColor: g.color, borderLeftWidth: 3 } : null]}>
              {isOpen ? bySection(g.types).map((s) => (
                <View key={s.section}>
                  <SettingSection title={s.section} />
                  {s.types.map((t) => (
                    <SettingRow key={t.id} emoji={t.emoji} title={t.label} value={on(t)} onChange={(v) => setType(t.id, v)} disabled={off}
                      push={{ on: pushOn(t), onChange: (v) => setPush(t.id, v) }} />
                  ))}
                </View>
              )) : (
                // Folded: the group's alerts at a glance, and how many are on. Tapping opens it.
                <Pressable onPress={() => toggleGroup(g.title)} style={({ pressed }) => [styles.folded, off && { opacity: 0.45 }, pressed && { opacity: 0.6 }]}
                  accessibilityRole="button" aria-expanded={false} accessibilityLabel={t('settings.showGroup', { total: g.types.length, title: g.title, summary })}>
                  <Text style={styles.foldedEmoji} numberOfLines={1}>
                    {(g.types.length > FOLDED_EMOJI ? g.types.slice(0, FOLDED_EMOJI - 1) : g.types).map((t) => t.emoji).join(' ')}
                    {g.types.length > FOLDED_EMOJI ? <Text style={styles.foldedMore}>  +{g.types.length - FOLDED_EMOJI + 1}</Text> : null}
                  </Text>
                  <Text style={styles.foldedCount}>{summary}</Text>
                  <Ionicons name="chevron-down" size={16} color={colors.textDim} />
                </Pressable>
              )}
            </View>
          </View>
        );
      })}

      <SectionHeader>{t('settings.language')}</SectionHeader>
      <View style={styles.card}>
        <View style={styles.layoutRow}>
          <Text style={styles.desc}>{t('settings.languageDesc')}</Text>
          <View style={styles.layoutChips}>
            {([['auto', t('settings.languageDevice')], ...LANGS.map((l) => [l.id, l.name] as const)] as const).map(([id, name]) => (
              <Pressable key={id} onPress={() => setLangPref(id)} accessibilityRole="radio" aria-checked={id === langPref} style={[styles.layoutChip, id === langPref && styles.layoutChipOn]}>
                <Text style={[styles.layoutChipText, id === langPref && { color: colors.text }]}>{name}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </View>

      <SectionHeader>{t('settings.data')}</SectionHeader>
      <View style={styles.card}>
        <Pressable style={styles.action} onPress={() => updatePrefs({ types: Object.fromEntries(eventTypes.map((t) => [t.id, t.defaultOn])), pushTypes: Object.fromEntries(eventTypes.map((t) => [t.id, t.defaultPush ?? true])), leagues: Object.fromEntries(leagues.map((l) => [l.id, true])) })}>
          <Text style={styles.actionText}>{t('settings.reset')}</Text>
        </Pressable>
        <Pressable style={styles.action} onPress={() => {
          const go = () => clearFeed();
          if (Platform.OS === 'web') go();
          else Alert.alert(t('settings.clearFeedTitle'), t('settings.clearFeedBody'), [{ text: t('settings.cancel'), style: 'cancel' }, { text: t('settings.clear'), style: 'destructive', onPress: go }]);
        }}>
          <Text style={[styles.actionText, { color: colors.hate }]}>{t('settings.clearFeed')}</Text>
        </Pressable>
        <Pressable style={styles.action} onPress={() => {
          const go = () => deleteAllData().catch((e) => Alert.alert(t('settings.deleteFailed'), String(e)));
          const msg = t('settings.deleteAllBody');
          if (Platform.OS === 'web') { if (window.confirm(msg)) go(); }
          else Alert.alert(t('settings.deleteAllTitle'), msg, [{ text: t('settings.cancel'), style: 'cancel' }, { text: t('settings.deleteEverything'), style: 'destructive', onPress: go }]);
        }}>
          <Text style={[styles.actionText, { color: colors.hate }]}>{t('settings.deleteAll')}</Text>
        </Pressable>
        {__DEV__ ? (
          <Pressable style={styles.action} onPress={() => api.simulate().catch((e) => Alert.alert('Simulate failed', String(e)))}>
            <Text style={styles.actionText}>🧪 Send a test event (dev)</Text>
          </Pressable>
        ) : null}
        {__DEV__ ? (
          <Pressable style={styles.action} onPress={() => setDevPlus(!devPlus)} accessibilityRole="switch" accessibilityState={{ checked: devPlus }}>
            <Text style={styles.actionText}>🧪 Hate Watch Plus (dev): {devPlus ? 'on' : 'off'}</Text>
            <Text style={styles.actionSub}>Reads as a subscriber on this test build, to try Plus's perks.</Text>
          </Pressable>
        ) : null}
      </View>
      <SectionHeader>{t('settings.about')}</SectionHeader>
      <View style={styles.card}>
        <Pressable style={styles.action} onPress={() => router.push('/guide')} accessibilityRole="button">
          <Text style={styles.actionText}>{t('settings.guide')}</Text>
          <Text style={styles.actionSub}>{t('settings.guideDesc')}</Text>
        </Pressable>
        <Pressable style={styles.action} onPress={sendFeedback} accessibilityRole="button" accessibilityHint={t('settings.feedbackHint', { email: FEEDBACK_EMAIL })}>
          <Text style={styles.actionText}>{t('settings.feedback')}</Text>
          <Text style={styles.actionSub}>{t('settings.feedbackDesc', { email: FEEDBACK_EMAIL })}</Text>
        </Pressable>
        <Pressable style={styles.action} onPress={() => Linking.openURL(`${API_URL}/privacy`)} accessibilityRole="link">
          <Text style={styles.actionText}>{t('settings.privacy')}</Text>
        </Pressable>
        <Pressable style={styles.action} onPress={() => Linking.openURL(`${API_URL}/support`)} accessibilityRole="link">
          <Text style={styles.actionText}>{t('settings.help')}</Text>
        </Pressable>
      </View>
      <Text style={styles.footer}>{t('settings.footer')}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  layoutRow: { paddingHorizontal: space(4), paddingVertical: space(3), borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  layoutTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  layoutChips: { flexDirection: 'row', gap: space(2), marginTop: space(2.5) },
  layoutChip: { flex: 1, alignItems: 'center', paddingVertical: space(2), borderRadius: radius.pill, backgroundColor: colors.surfaceHi, borderWidth: 1, borderColor: colors.border },
  layoutChipOn: { borderColor: colors.hate },
  layoutChipText: { color: colors.textDim, fontSize: 13, fontWeight: '700' },
  card: { marginHorizontal: space(3), backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  desc: { color: colors.textDim, fontSize: 13, marginTop: 2, lineHeight: 17 },
  groupHead: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', paddingRight: space(4) },
  // Matches SectionHeader, with room for the chevron.
  groupToggle: { flexDirection: 'row', alignItems: 'center', gap: space(1.5), paddingHorizontal: space(4), paddingTop: space(6), paddingBottom: space(2) },
  groupTitle: { color: colors.textFaint, fontSize: 12, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
  folded: { flexDirection: 'row', alignItems: 'center', gap: space(3), paddingHorizontal: space(4), paddingVertical: space(3.5) },
  foldedEmoji: { flex: 1, fontSize: 17 },
  foldedMore: { color: colors.textDim, fontWeight: '700', fontSize: 13 },
  foldedCount: { color: colors.textDim, fontWeight: '700', fontSize: 13 },
  toggleAll: { color: colors.hate, fontWeight: '800', fontSize: 13, paddingBottom: space(2) },
  quiet: { flexDirection: 'row', gap: space(3), padding: space(4), paddingTop: space(1) },
  stepper: { flex: 1, gap: space(1) },
  stepRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surfaceHi, borderRadius: radius.md },
  stepBtn: { paddingHorizontal: space(4), paddingVertical: space(2) },
  stepTxt: { color: colors.text, fontSize: 20, fontWeight: '700' },
  stepVal: { color: colors.text, fontWeight: '800' },
  action: { paddingHorizontal: space(4), paddingVertical: space(4), borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  actionText: { color: colors.text, fontWeight: '700', fontSize: 15 },
  actionSub: { color: colors.textDim, fontSize: 13, marginTop: 2, lineHeight: 17 },
  footer: { color: colors.textFaint, fontSize: 12, textAlign: 'center', padding: space(6) },
  hint: { color: colors.textFaint, fontSize: 13, lineHeight: 18, paddingHorizontal: space(4), paddingTop: space(3) },
});
