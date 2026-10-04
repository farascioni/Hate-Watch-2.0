import { Alert, Linking, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useStore } from '../../lib/store';
import { api, API_URL } from '../../lib/api';
import { SectionHeader } from '../../components/ui';
import { TipJar } from '../../components/TipJar';
import { colors, leagueColors, radius, space } from '../../theme';
import type { EventType, League } from '../../lib/types';

function Row({ title, desc, value, onChange, emoji, disabled }: { title: string; desc?: string; value: boolean; onChange: (v: boolean) => void; emoji?: string; disabled?: boolean }) {
  return (
    <View style={[styles.row, disabled && { opacity: 0.45 }]}>
      {emoji ? <Text style={styles.emoji}>{emoji}</Text> : null}
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>{title}</Text>
        {desc ? <Text style={styles.desc}>{desc}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ true: colors.hate, false: colors.border }}
        thumbColor="#fff"
        ios_backgroundColor={colors.border}
        // react-native-web otherwise paints the "on" thumb Material teal
        {...({ activeThumbColor: '#fff' } as object)}
        accessibilityLabel={title}
      />
    </View>
  );
}

const HOURS = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`);
const fmtHour = (hm: string) => {
  const h = Number(hm.slice(0, 2));
  return `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`;
};

function HourStepper({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const i = Math.max(0, HOURS.indexOf(value));
  return (
    <View style={styles.stepper}>
      <Text style={styles.desc}>{label}</Text>
      <View style={styles.stepRow}>
        <Pressable style={styles.stepBtn} onPress={() => onChange(HOURS[(i + 23) % 24])} accessibilityLabel={`${label} earlier`}><Text style={styles.stepTxt}>−</Text></Pressable>
        <Text style={styles.stepVal}>{fmtHour(value)}</Text>
        <Pressable style={styles.stepBtn} onPress={() => onChange(HOURS[(i + 1) % 24])} accessibilityLabel={`${label} later`}><Text style={styles.stepTxt}>+</Text></Pressable>
      </View>
    </View>
  );
}

export default function SettingsScreen() {
  const { prefs, updatePrefs, eventTypes, leagues, push, enablePush, clearFeed, deleteAllData } = useStore();
  if (!prefs) return null;

  const on = (t: EventType) => prefs.types[t.id] ?? t.defaultOn;
  const setType = (id: string, v: boolean) => updatePrefs({ types: { [id]: v } });
  const leagueOn = (l: League) => prefs.leagues[l] !== false;
  const setAll = (types: EventType[], v: boolean) => updatePrefs({ types: Object.fromEntries(types.map((t) => [t.id, v])) });

  const groups: { title: string; color?: string; league?: League; types: EventType[] }[] = [
    ...leagues.map((l) => ({ title: `${l.name} player alerts`, color: leagueColors[l.id], league: l.id, types: eventTypes.filter((t) => t.scope === 'player' && t.leagues.length === 1 && t.leagues[0] === l.id) })),
    { title: 'All player alerts', types: eventTypes.filter((t) => t.scope === 'player' && t.leagues.length > 1) },
    { title: 'Team alerts', types: eventTypes.filter((t) => t.scope === 'team') },
  ];

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: space(16) }}>
      <SectionHeader>Support Hate Watch</SectionHeader>
      <TipJar />

      <SectionHeader>Delivery</SectionHeader>
      <View style={styles.card}>
        <Row title="Push notifications" desc={push.status === 'granted' ? 'Alerts arrive even when the app is closed.' : push.status === 'denied' ? 'Blocked in system settings — the feed still updates live.' : push.reason ?? 'Checking…'} value={prefs.pushEnabled && push.status === 'granted'} onChange={async (v) => { if (v && push.status !== 'granted') await enablePush(); updatePrefs({ pushEnabled: v }); }} disabled={push.status === 'unavailable'} />
        <Row title="Sound" desc="Play a sound with each alert." value={prefs.sound} onChange={(v) => updatePrefs({ sound: v })} />
        <Row title="Quiet hours" desc="Silence pushes overnight. Everything still lands in your feed." value={prefs.quietHours.enabled} onChange={(v) => updatePrefs({ quietHours: { ...prefs.quietHours, enabled: v, tz: Intl.DateTimeFormat().resolvedOptions().timeZone } })} />
        {prefs.quietHours.enabled ? (
          <View style={styles.quiet}>
            <HourStepper label="From" value={prefs.quietHours.start} onChange={(start) => updatePrefs({ quietHours: { ...prefs.quietHours, start } })} />
            <HourStepper label="Until" value={prefs.quietHours.end} onChange={(end) => updatePrefs({ quietHours: { ...prefs.quietHours, end } })} />
          </View>
        ) : null}
      </View>

      <SectionHeader>Leagues</SectionHeader>
      <View style={styles.card}>
        {leagues.map((l) => <Row key={l.id} title={l.name} desc={leagueOn(l.id) ? undefined : 'All alerts from this league are off'} value={leagueOn(l.id)} onChange={(v) => updatePrefs({ leagues: { [l.id]: v } })} />)}
      </View>

      {groups.filter((g) => g.types.length).map((g) => {
        const off = g.league ? !leagueOn(g.league) : false;
        const allOn = g.types.every(on);
        return (
          <View key={g.title}>
            <View style={styles.groupHead}>
              <SectionHeader>{g.title}</SectionHeader>
              <Pressable onPress={() => setAll(g.types, !allOn)} hitSlop={8}><Text style={styles.toggleAll}>{allOn ? 'All off' : 'All on'}</Text></Pressable>
            </View>
            <View style={[styles.card, g.color ? { borderLeftColor: g.color, borderLeftWidth: 3 } : null]}>
              {g.types.map((t) => <Row key={t.id} emoji={t.emoji} title={t.label} desc={t.description} value={on(t)} onChange={(v) => setType(t.id, v)} disabled={off} />)}
            </View>
          </View>
        );
      })}

      <SectionHeader>Data</SectionHeader>
      <View style={styles.card}>
        <Pressable style={styles.action} onPress={() => updatePrefs({ types: Object.fromEntries(eventTypes.map((t) => [t.id, t.defaultOn])), leagues: { nba: true, mlb: true, nfl: true, nhl: true } })}>
          <Text style={styles.actionText}>Reset alerts to defaults</Text>
        </Pressable>
        <Pressable style={styles.action} onPress={() => {
          const go = () => clearFeed();
          if (Platform.OS === 'web') go();
          else Alert.alert('Clear feed?', 'This removes every item from your feed.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Clear', style: 'destructive', onPress: go }]);
        }}>
          <Text style={[styles.actionText, { color: colors.hate }]}>Clear feed</Text>
        </Pressable>
        <Pressable style={styles.action} onPress={() => {
          const go = () => deleteAllData().catch((e) => Alert.alert('Could not delete', String(e)));
          const msg = 'This permanently deletes everyone you track, your settings and your feed from our server, and gives this device a fresh anonymous identity.';
          if (Platform.OS === 'web') { if (window.confirm(msg)) go(); }
          else Alert.alert('Delete all my data?', msg, [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete everything', style: 'destructive', onPress: go }]);
        }}>
          <Text style={[styles.actionText, { color: colors.hate }]}>Delete all my data</Text>
        </Pressable>
        {__DEV__ ? (
          <Pressable style={styles.action} onPress={() => api.simulate().catch((e) => Alert.alert('Simulate failed', String(e)))}>
            <Text style={styles.actionText}>🧪 Send a test event (dev)</Text>
          </Pressable>
        ) : null}
      </View>
      <SectionHeader>About</SectionHeader>
      <View style={styles.card}>
        <Pressable style={styles.action} onPress={() => Linking.openURL(`${API_URL}/privacy`)} accessibilityRole="link">
          <Text style={styles.actionText}>Privacy policy</Text>
        </Pressable>
        <Pressable style={styles.action} onPress={() => Linking.openURL(`${API_URL}/support`)} accessibilityRole="link">
          <Text style={styles.actionText}>Help & support</Text>
        </Pressable>
      </View>
      <Text style={styles.footer}>Data: ESPN public APIs. Live plays polled every ~2s; injury report every 30s; standings every 60s.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: space(3), backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space(3), paddingHorizontal: space(4), paddingVertical: space(3), borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  emoji: { fontSize: 20, width: 26, textAlign: 'center' },
  title: { color: colors.text, fontSize: 15, fontWeight: '700' },
  desc: { color: colors.textDim, fontSize: 13, marginTop: 2, lineHeight: 17 },
  groupHead: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', paddingRight: space(4) },
  toggleAll: { color: colors.hate, fontWeight: '800', fontSize: 13, paddingBottom: space(2) },
  quiet: { flexDirection: 'row', gap: space(3), padding: space(4), paddingTop: space(1) },
  stepper: { flex: 1, gap: space(1) },
  stepRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surfaceHi, borderRadius: radius.md },
  stepBtn: { paddingHorizontal: space(4), paddingVertical: space(2) },
  stepTxt: { color: colors.text, fontSize: 20, fontWeight: '700' },
  stepVal: { color: colors.text, fontWeight: '800' },
  action: { paddingHorizontal: space(4), paddingVertical: space(4), borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  actionText: { color: colors.text, fontWeight: '700', fontSize: 15 },
  footer: { color: colors.textFaint, fontSize: 12, textAlign: 'center', padding: space(6) },
});
