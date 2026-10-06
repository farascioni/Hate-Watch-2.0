import { useEffect, useRef, useState, type ReactNode } from 'react';
import { FlatList, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View, useWindowDimensions } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AlsoGot, LeagueTag } from '../components/ui';
import { markGuideSeen, settleGuide } from '../lib/guide';
import { colors, radius, space } from '../theme';

/**
 * The startup guide. Opens over the app on a device's first launch (`?first=1`, see _layout.tsx) and
 * from Settings → Show the guide. Swipe or tap Next through it; Skip ends it from any page.
 * The pictures are drawings of the real controls, not live ones, so nothing in here changes settings.
 */
type Icon = keyof typeof Ionicons.glyphMap;
// demo is a function so it's built at render time (styles are defined at the bottom of the file).
interface Page { key: string; icon?: Icon; where?: string; title: string; body: string; demo?: () => ReactNode }

const PAGES: Page[] = [
  {
    key: 'welcome', title: 'Welcome to Hate Watch',
    body: "Track the players and teams you can't stand. When something goes wrong for them, you'll know within seconds.",
  },
  {
    key: 'track', icon: 'search', where: 'Search tab', title: 'Pick who to hate',
    body: 'Type a player or team and tap Track. The NBA, MLB, NFL, NHL, F1 and WNBA are all here, and you can track as many as you like.',
    demo: () => (
      <DemoCard>
        <Badge text="DAL" color="#041E42" />
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={styles.demoTitle} numberOfLines={1}>Dallas Cowboys</Text>
          <View style={styles.inline}><LeagueTag league="nfl" /><Text style={styles.demoSub} numberOfLines={1}>Dallas</Text></View>
        </View>
        <View style={styles.trackPill}><Text style={styles.trackText}>Track</Text></View>
      </DemoCard>
    ),
  },
  {
    key: 'feed', icon: 'flame', where: 'Feed tab', title: 'Every bad moment, live',
    body: 'Alerts land in your feed the moment they happen, newest first, and arrive as notifications. A Successful Hate Watch (a team you track losing) shows how many other hate watchers got it too. Tap the share icon to send one to a friend.',
    demo: () => (
      <DemoCard>
        <Badge text="PHI" color="#06424d" />
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={styles.demoTitle}>Successful Hate Watch! Eagles lost to the Bears</Text>
          <Text style={styles.demoSub}>Final Score: 24 to 17</Text>
          <AlsoGot n={23} />
        </View>
        <Ionicons name={Platform.OS === 'ios' ? 'share-outline' : 'share-social-outline'} size={20} color={colors.textDim} style={{ alignSelf: 'flex-start' }} />
      </DemoCard>
    ),
  },
  {
    key: 'scores', icon: 'trophy', where: 'Scores tab', title: 'Every game, live',
    body: "Today's games for everyone you track: the score, how badly it's going for them, who has the ball or who's pitching, and the chance they lose. Finals stay for a day. Tap one for the play-by-play.",
    demo: () => (
      <View style={styles.demoCard}>
        <View style={styles.row}>
          <Badge text="ATL" color="#A71930" />
          <Text style={[styles.demoTitle, { flex: 1 }]}>Falcons</Text>
          <Text style={styles.demoScore}>17</Text>
        </View>
        <View style={[styles.row, { marginTop: space(2) }]}>
          <Badge text="NO" color="#9F8958" />
          <Text style={[styles.demoTitle, { flex: 1, color: colors.textDim }]}>Saints</Text>
          <Text style={[styles.demoScore, { color: colors.textDim }]}>24</Text>
        </View>
        <View style={[styles.row, { marginTop: space(3), justifyContent: 'space-between' }]}>
          <Text style={styles.demoSub}>Q4 · 2:14 · ATL ball, 3rd & 8</Text>
          <View style={styles.downPill}><Text style={styles.downText}>Down 7</Text></View>
        </View>
        <Text style={[styles.demoFaint, { marginTop: space(2) }]}>Timeouts left: ATL 1 · NO 3</Text>
        <Text style={styles.demoFaint}>Passing: <Text style={styles.demoStrong}>M. Penix Jr.</Text>, 18/27, 211 YDS</Text>
        <View style={[styles.row, { marginTop: space(2), justifyContent: 'space-between' }]}>
          <Text style={styles.demoSub}>Chance the Falcons lose</Text>
          <Text style={[styles.demoSub, { color: '#FF8A8F', fontWeight: '800' }]}>78%</Text>
        </View>
        <View style={styles.bar}><View style={[styles.barFill, { width: '78%' }]} /></View>
      </View>
    ),
  },
  {
    key: 'leaderboard', icon: 'podium', where: 'Top left of every tab', title: 'See who\'s most hated',
    body: 'The leaderboard ranks players and teams by how many people hate them. Filter it like your feed: players or teams, one sport or all of them.',
    demo: () => (
      <View style={styles.demoCard}>
        {([['🥇', 'DAL', '#041E42', 'Dallas Cowboys', 'nfl', '1,204'], ['🥈', 'LAL', '#552583', 'Los Angeles Lakers', 'nba', '987'], ['🥉', 'NYY', '#0C2340', 'New York Yankees', 'mlb', '842']] as const)
          .map(([medal, abbr, color, name, league, n], i) => (
            <View key={abbr} style={[styles.row, i > 0 && { marginTop: space(3) }]}>
              <Text style={styles.medal}>{medal}</Text>
              <Badge text={abbr} color={color} />
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={styles.demoTitle} numberOfLines={1}>{name}</Text>
                <View style={{ alignSelf: 'flex-start' }}><LeagueTag league={league} /></View>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.haterCount}>{n}</Text>
                <Text style={styles.demoFaint}>haters</Text>
              </View>
            </View>
          ))}
      </View>
    ),
  },
  {
    key: 'global', icon: 'options', where: 'Settings tab', title: 'Choose your alerts',
    body: "Turn each kind of alert on or off for every league. An alert's bell decides whether it sends a notification or just lands in your feed.",
    demo: () => (
      <View style={styles.demoCard}>
        <ToggleRow label="🙅  Throws an interception" on push />
        <View style={styles.divider} />
        <ToggleRow label="🙄  Makes an out" on push={false} note="Feed only: no notification" />
      </View>
    ),
  },
  {
    key: 'record', icon: 'medal', where: 'Settings tab', title: 'Keep score',
    body: 'The top of Settings counts your Successful Hate Watches: every time a team you track loses. Tap "+3 more" to see every team.',
    demo: () => (
      <View style={[styles.demoCard, { borderColor: colors.hateDim, gap: space(3) }]}>
        <View style={[styles.row, { gap: space(4) }]}>
          <Text style={styles.recordCount}>12</Text>
          <View style={{ flex: 1 }}>
            <Text style={[styles.demoTitle, { fontSize: 17 }]}>Successful Hate Watches</Text>
            <Text style={styles.demoSub}>Each time a team you track lost.</Text>
          </View>
        </View>
        <View style={[styles.inline, { flexWrap: 'wrap' }]}>
          {([['DAL', '#041E42', 'Cowboys', 5], ['LAL', '#552583', 'Lakers', 4]] as const).map(([abbr, color, name, n]) => (
            <View key={abbr} style={styles.chip}>
              <View style={[styles.chipBadge, { backgroundColor: color }]}><Text style={styles.chipBadgeText}>{abbr}</Text></View>
              <Text style={styles.chipName}>{name}</Text>
              <Text style={styles.chipCount}>{n}</Text>
            </View>
          ))}
          <View style={[styles.chip, { paddingLeft: space(2.5) }]}><Text style={styles.chipMore}>+3 more</Text><Ionicons name="chevron-down" size={14} color={colors.textDim} /></View>
        </View>
      </View>
    ),
  },
  {
    key: 'one', icon: 'eye', where: 'Tracking tab', title: 'Fine-tune one player or team',
    body: 'Next to everyone you track:',
    demo: () => (
      <View style={{ gap: space(4) }}>
        <DemoCard>
          <Badge text="DJ" color="#002C5F" />
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={styles.demoTitle} numberOfLines={1}>Daniel Jones</Text>
            <View style={styles.inline}><LeagueTag league="nfl" /><Text style={styles.demoSub} numberOfLines={1}>QB</Text></View>
            <View style={[styles.inline, { gap: 4 }]}><Ionicons name="eye" size={12} color={colors.textFaint} /><Text style={styles.demoFaint}>214 haters</Text></View>
          </View>
          <RoundIcon name="notifications" />
          <RoundIcon name="settings-sharp" highlight />
        </DemoCard>
        <Explain icon="eye" text="How many people hate them, you included." />
        <Explain icon="notifications" text="Bell: no notifications about just them. Their alerts still reach your feed." />
        <Explain icon="settings-sharp" text="Gear: pick exactly which alerts you get about them. It beats your global settings." />
      </View>
    ),
  },
  {
    key: 'done', icon: 'checkmark-circle', title: "You're all set",
    body: 'You can watch this guide again any time from Settings.',
  },
];

export default function GuideScreen() {
  const { first } = useLocalSearchParams<{ first?: string }>();
  const isFirstRun = first === '1';
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const list = useRef<FlatList<Page>>(null);
  const [index, setIndex] = useState(0);
  const last = index === PAGES.length - 1;

  // Seen as soon as it opens: quitting the app halfway through doesn't bring it back next launch.
  useEffect(() => { markGuideSeen(); }, []);

  const go = (i: number) => list.current?.scrollToIndex({ index: i, animated: true });
  const close = (thenSearch = false) => {
    settleGuide(); // first run: now the app may ask for notification permission
    if (router.canGoBack()) router.back(); else router.replace('/');
    if (thenSearch) router.navigate('/search');
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top + space(2), paddingBottom: insets.bottom + space(4) }]}>
      <View style={styles.topBar}>
        {index > 0 ? (
          <Pressable onPress={() => go(index - 1)} hitSlop={12} accessibilityRole="button" accessibilityLabel="Previous page">
            <Text style={styles.topLink}>Back</Text>
          </Pressable>
        ) : <View />}
        {!last ? (
          <Pressable onPress={() => close()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Skip the guide">
            <Text style={styles.topLink}>Skip</Text>
          </Pressable>
        ) : null}
      </View>

      <FlatList
        ref={list}
        data={PAGES}
        keyExtractor={(p) => p.key}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        bounces={false}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        onScroll={(e) => setIndex(Math.min(PAGES.length - 1, Math.max(0, Math.round(e.nativeEvent.contentOffset.x / width))))}
        scrollEventThrottle={16}
        renderItem={({ item }) => (
          // Each page scrolls on its own if it doesn't fit (small phones, big text sizes).
          <ScrollView style={{ width }} contentContainerStyle={styles.page} showsVerticalScrollIndicator={false} accessibilityLabel={`${item.title}. ${item.body}`}>
            {item.icon ? (
              <View style={styles.iconRing}><Ionicons name={item.icon} size={30} color={colors.hate} /></View>
            ) : <Text style={styles.bigEmoji}>😈</Text>}
            {item.where ? <Text style={styles.where}>{item.where}</Text> : null}
            <Text style={styles.title}>{item.title}</Text>
            <Text style={styles.body}>{item.body}</Text>
            {item.key === 'done' && isFirstRun ? (
              <Text style={styles.body}>Next, your phone will ask to send you notifications. Allow them so alerts reach you even when the app is closed.</Text>
            ) : null}
            {item.demo ? <View style={styles.demo}>{item.demo()}</View> : null}
          </ScrollView>
        )}
      />

      <View style={styles.dots} accessibilityLabel={`Page ${index + 1} of ${PAGES.length}`}>
        {PAGES.map((p, i) => <View key={p.key} style={[styles.dot, i === index && styles.dotOn]} />)}
      </View>
      <Pressable
        onPress={() => (last ? close(isFirstRun) : go(index + 1))}
        style={({ pressed }) => [styles.primary, pressed && { opacity: 0.85 }]}
        accessibilityRole="button"
      >
        <Text style={styles.primaryText}>{last ? (isFirstRun ? 'Find someone to hate' : 'Done') : 'Next'}</Text>
      </Pressable>
    </View>
  );
}

// ─── Drawings of the app's controls ───────────────────────────────────────────────────────────
function DemoCard({ children }: { children: ReactNode }) {
  return <View style={[styles.demoCard, styles.row]}>{children}</View>;
}
function Badge({ text, color }: { text: string; color: string }) {
  return <View style={[styles.badge, { backgroundColor: color }]}><Text style={styles.badgeText}>{text}</Text></View>;
}
function RoundIcon({ name, highlight, dim }: { name: Icon; highlight?: boolean; dim?: boolean }) {
  return (
    <View style={[styles.round, highlight && { borderColor: colors.hate }]}>
      <Ionicons name={name} size={18} color={highlight ? colors.hate : dim ? colors.textFaint : colors.text} />
    </View>
  );
}
function ToggleRow({ label, on, push, note }: { label: string; on: boolean; push?: boolean; note?: string }) {
  return (
    <View style={[styles.row, { paddingVertical: space(1) }]} pointerEvents="none">
      <View style={{ flex: 1 }}>
        <Text style={styles.demoTitle}>{label}</Text>
        {note ? <Text style={[styles.demoSub, { marginTop: 2 }]}>{note}</Text> : null}
      </View>
      {push !== undefined ? <RoundIcon name={push ? 'notifications' : 'notifications-off'} dim={!push} /> : null}
      {/* Same look as SettingRow's switches (react-native-web otherwise paints the "on" thumb teal). */}
      <Switch value={on} trackColor={{ true: colors.hate, false: colors.border }} thumbColor="#fff" ios_backgroundColor={colors.border} {...({ activeThumbColor: '#fff' } as object)} />
    </View>
  );
}
function Explain({ icon, text }: { icon: Icon; text: string }) {
  return (
    <View style={[styles.row, { alignItems: 'flex-start' }]}>
      <Ionicons name={icon} size={18} color={colors.hate} style={{ marginTop: 2 }} />
      <Text style={[styles.body, { flex: 1, textAlign: 'left', marginTop: 0 }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  topBar: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: space(5), minHeight: 28 },
  topLink: { color: colors.textDim, fontSize: 16, fontWeight: '700' },
  page: { paddingHorizontal: space(5), paddingTop: space(5), paddingBottom: space(4), alignItems: 'center' },
  bigEmoji: { fontSize: 64, marginBottom: space(1) },
  iconRing: { width: 64, height: 64, borderRadius: 32, borderWidth: 2, borderColor: colors.hateDim, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', marginBottom: space(2) },
  where: { color: colors.hate, fontSize: 13, fontWeight: '800', letterSpacing: 0.5, marginTop: space(2) },
  title: { color: colors.text, fontSize: 26, fontWeight: '900', textAlign: 'center', marginTop: space(1) },
  body: { color: colors.textDim, fontSize: 16, lineHeight: 23, textAlign: 'center', marginTop: space(3) },
  demo: { alignSelf: 'stretch', marginTop: space(5) },
  demoCard: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: space(3) },
  row: { flexDirection: 'row', alignItems: 'center', gap: space(2.5) },
  inline: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: space(2) },
  demoTitle: { color: colors.text, fontSize: 15, fontWeight: '800', lineHeight: 20 },
  demoSub: { color: colors.textDim, fontSize: 13 },
  badge: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'rgba(255,255,255,0.16)' },
  badgeText: { color: '#fff', fontSize: 13, fontWeight: '900' },
  demoScore: { color: colors.text, fontSize: 20, fontWeight: '900' },
  demoFaint: { color: colors.textFaint, fontSize: 12 },
  demoStrong: { color: colors.textDim, fontWeight: '700' },
  bar: { height: 5, borderRadius: 3, backgroundColor: colors.border, overflow: 'hidden', marginTop: space(1) },
  barFill: { height: '100%', backgroundColor: colors.hate },
  medal: { fontSize: 20, width: 26, textAlign: 'center' },
  haterCount: { color: colors.hate, fontSize: 17, fontWeight: '900' },
  recordCount: { color: colors.hate, fontSize: 40, fontWeight: '900' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: space(1.5), backgroundColor: colors.surfaceHi, borderRadius: radius.pill, paddingLeft: 3, paddingRight: space(2.5), paddingVertical: 3 },
  chipBadge: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  chipBadgeText: { color: '#fff', fontSize: 8, fontWeight: '900' },
  chipName: { color: colors.text, fontSize: 13, fontWeight: '700' },
  chipCount: { color: colors.hate, fontSize: 13, fontWeight: '900' },
  chipMore: { color: colors.textDim, fontSize: 13, fontWeight: '700' },
  downPill: { backgroundColor: colors.hateDim, borderRadius: radius.pill, paddingHorizontal: space(2.5), paddingVertical: 3 },
  downText: { color: '#FF8A8F', fontSize: 12, fontWeight: '800' },
  trackPill: { backgroundColor: colors.hate, borderRadius: radius.pill, paddingHorizontal: space(4), paddingVertical: space(2) },
  trackText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  round: { width: 34, height: 34, borderRadius: 17, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surfaceHi, alignItems: 'center', justifyContent: 'center' },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: space(2), marginTop: space(2), marginBottom: space(4) },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.border },
  dotOn: { width: 22, backgroundColor: colors.hate },
  primary: { marginHorizontal: space(5), backgroundColor: colors.hate, borderRadius: radius.pill, paddingVertical: space(4), alignItems: 'center' },
  primaryText: { color: '#fff', fontSize: 17, fontWeight: '900' },
});
