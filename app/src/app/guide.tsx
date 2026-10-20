import { createContext, memo, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Easing, FlatList, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AlsoGot, LeagueTag } from '../components/ui';
import { markGuideSeen, settleGuide } from '../lib/guide';
import { useT, type T } from '../lib/i18n';
import { GOLD, colors, radius, space } from '../theme';

/**
 * The startup guide. Opens over the app on a device's first launch (`?first=1`, see _layout.tsx) and
 * from Settings → Show the guide. Swipe or tap Next through it; Skip ends it from any page.
 * The pictures are drawings of the real controls, not live ones, so nothing in here changes settings.
 * They move, in the style of the guide video (marketing/video-ads): each page runs one clock (`p`, in ms)
 * every time it becomes the current page, and its pieces enter, count, flip and light up at set times on it.
 * Plain `Animated` (JS driver, so the web version moves too); reduced motion shows every page finished.
 */
// ─── Motion ───────────────────────────────────────────────────────────────────────────────────
const END = 3000; // ms a page's entrance clock runs for
const pop = Easing.bezier(0.22, 1, 0.36, 1); // the video's ease-out
const back = Easing.out(Easing.back(1.8));
type Ease = (t: number) => number;

interface Motion {
  p: Animated.Value;    // the entrance clock: 0 → END ms, restarted each time the page becomes the current one
  loop: Animated.Value; // 0 → 1 over and over while the page is current; rests at 1, where every loop below is calm
  active: boolean;
  reduced: boolean;
}
const MotionCtx = createContext<Motion | null>(null);
const useMotion = () => useContext(MotionCtx)!;

/** A value of the clock easing from `out[0]` to `out[1]` between two times. */
const seg = (p: Animated.Value, from: number, to: number, out: number[] | string[] = [0, 1], easing: Ease = pop) =>
  p.interpolate({ inputRange: [from, to], outputRange: out as number[], easing, extrapolate: 'clamp' });

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduced).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => sub.remove();
  }, []);
  return reduced;
}

/** A number that rises from 0 to `to` between two times on the clock. */
function useCount(to: number, at: number, dur: number, easing: Ease = pop) {
  const { p } = useMotion();
  const [n, setN] = useState(0);
  useEffect(() => {
    const id = p.addListener(({ value }) => setN(Math.round(to * easing(Math.min(1, Math.max(0, (value - at) / dur))))));
    return () => p.removeListener(id);
  }, [p, to, at, dur, easing]);
  return n;
}
/** False until the clock passes `at` (a switch flips, a bell changes). */
function useAfter(at: number) {
  const { p } = useMotion();
  const [on, setOn] = useState(false);
  useEffect(() => {
    const id = p.addListener(({ value }) => setOn(value >= at));
    return () => p.removeListener(id);
  }, [p, at]);
  return on;
}

/** Enters at `at` ms: fades in while rising, sliding from the right, or growing. */
function Pop({ at, from = 'up', style, children }: { at: number; from?: 'up' | 'right' | 'scale'; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const { p } = useMotion();
  const move = seg(p, at, at + 600, from === 'right' ? [36, 0] : [18, 0]);
  const grow = seg(p, at, at + 600, from === 'scale' ? [0.6, 1] : [0.96, 1], back);
  return (
    <Animated.View style={[style, { opacity: seg(p, at, at + 400), transform: [{ translateX: from === 'right' ? move : 0 }, { translateY: from === 'up' ? move : 0 }, { scale: grow }] }]}>
      {children}
    </Animated.View>
  );
}
function Fade({ at, children }: { at: number; children: ReactNode }) {
  const { p } = useMotion();
  return <Animated.View style={{ opacity: seg(p, at, at + 300) }}>{children}</Animated.View>;
}
function CountText({ to, at, dur = 900, format = String, style }: { to: number; at: number; dur?: number; format?: (n: number) => string; style?: object }) {
  return <Text style={style}>{format(useCount(to, at, dur))}</Text>;
}
const commas = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** The page's icon (or the devil on the first page): pops in, and a ring spreads from it. */
function Hero({ icon }: { icon?: Icon }) {
  const { p, loop } = useMotion();
  return (
    <View style={styles.hero}>
      <Animated.View pointerEvents="none" style={[styles.heroPulse, { opacity: loop.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }), transform: [{ scale: loop.interpolate({ inputRange: [0, 1], outputRange: [1, 1.8] }) }] }]} />
      <Animated.View style={{ opacity: seg(p, 0, 250), transform: [{ scale: seg(p, 0, 600, [0.4, 1], back) }] }}>
        {icon ? <View style={styles.iconRing}><Ionicons name={icon} size={30} color={colors.hate} /></View> : <Text style={styles.bigEmoji}>😈</Text>}
      </Animated.View>
    </View>
  );
}

/** A red ring that grows round whatever it wraps while `on` (the video's highlight). */
function Lit({ on, children, style }: { on: boolean; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => { Animated.spring(v, { toValue: on ? 1 : 0, friction: 6, tension: 140, useNativeDriver: false }).start(); }, [on, v]);
  return (
    <View style={style}>
      {children}
      <Animated.View pointerEvents="none" style={[styles.lit, { opacity: v, transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] }) }] }]} />
    </View>
  );
}
/** Dims what isn't the one being talked about. */
function Dim({ on, children }: { on: boolean; children: ReactNode }) {
  const v = useRef(new Animated.Value(1)).current;
  useEffect(() => { Animated.timing(v, { toValue: on ? 1 : 0.4, duration: 250, useNativeDriver: false }).start(); }, [on, v]);
  return <Animated.View style={{ opacity: v }}>{children}</Animated.View>;
}

// ─── Pages ────────────────────────────────────────────────────────────────────────────────────
type Icon = keyof typeof Ionicons.glyphMap;
// demo is a function so it's built at render time (styles are defined at the bottom of the file).
interface Page { key: string; icon?: Icon; where?: string; title: string; body: string; demo?: () => ReactNode }

const buildPages = (t: T): Page[] => [
  {
    key: 'welcome', title: t('guide.welcome.title'),
    body: t('guide.welcome.body'),
  },
  {
    key: 'track', icon: 'search', where: t('guide.track.where'), title: t('guide.track.title'),
    body: t('guide.track.body'),
    demo: () => (
      <View style={{ gap: space(3) }}>
        <Pop at={0}><SearchBox text="Dallas Cowboys" at={350} dur={800} /></Pop>
        <Pop at={1200}>
          <DemoCard>
            <Badge text="DAL" color="#041E42" />
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={styles.demoTitle} numberOfLines={1}>Dallas Cowboys</Text>
              <View style={styles.inline}><LeagueTag league="nfl" /><Text style={styles.demoSub} numberOfLines={1}>Dallas</Text></View>
            </View>
            <TrackPill at={2300} track={t('guide.track.button')} tracking={t('ui.tracking')} />
          </DemoCard>
        </Pop>
      </View>
    ),
  },
  {
    key: 'feed', icon: 'flame', where: t('guide.feed.where'), title: t('guide.feed.title'),
    body: t('guide.feed.body'),
    demo: () => <FeedDemo t={t} />,
  },
  {
    key: 'scores', icon: 'trophy', where: t('guide.scores.where'), title: t('guide.scores.title'),
    body: t('guide.scores.body'),
    demo: () => (
      <Pop at={0}>
        <View style={styles.demoCard}>
          <View style={styles.row}>
            <Badge text="ATL" color="#A71930" />
            <Text style={[styles.demoTitle, { flex: 1 }]}>Falcons</Text>
            <CountText to={17} at={300} style={styles.demoScore} />
          </View>
          <View style={[styles.row, { marginTop: space(2) }]}>
            <Badge text="NO" color="#9F8958" />
            <Text style={[styles.demoTitle, { flex: 1, color: colors.textDim }]}>Saints</Text>
            <CountText to={24} at={300} style={[styles.demoScore, { color: colors.textDim }]} />
          </View>
          <View style={[styles.row, { marginTop: space(3), justifyContent: 'space-between' }]}>
            <Text style={styles.demoSub}>{t('guide.scores.status')}</Text>
            <Pop at={1500} from="scale"><View style={styles.downPill}><Text style={styles.downText}>{t('guide.scores.down')}</Text></View></Pop>
          </View>
          <Fade at={1000}>
            <Text style={[styles.demoFaint, { marginTop: space(2) }]}>{t('guide.scores.timeouts')}</Text>
            <Text style={styles.demoFaint}>{t('guide.scores.passing')} <Text style={styles.demoStrong}>M. Penix Jr.</Text>, 18/27, 211 YDS</Text>
          </Fade>
          <View style={[styles.row, { marginTop: space(2), justifyContent: 'space-between' }]}>
            <Text style={styles.demoSub}>{t('guide.scores.chance')}</Text>
            <CountText to={78} at={900} dur={1100} format={(n) => `${n}%`} style={[styles.demoSub, { color: colors.hateText, fontWeight: '800' }]} />
          </View>
          <ChanceBar at={900} />
        </View>
      </Pop>
    ),
  },
  {
    key: 'leaderboard', icon: 'podium', where: t('guide.leaderboard.where'), title: t('guide.leaderboard.title'),
    body: t('guide.leaderboard.body'),
    demo: () => (
      <View style={styles.demoCard}>
        {([['🥇', 'DAL', '#041E42', 'Dallas Cowboys', 'nfl', 1204], ['🥈', 'LAL', '#552583', 'Los Angeles Lakers', 'nba', 987], ['🥉', 'NYY', '#0C2340', 'New York Yankees', 'mlb', 842]] as const)
          .map(([medal, abbr, color, name, league, n], i) => (
            <Pop key={abbr} at={i * 280} from="right" style={i > 0 ? { marginTop: space(3) } : undefined}>
              <View style={styles.row}>
                <Text style={styles.medal}>{medal}</Text>
                <Badge text={abbr} color={color} />
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={styles.demoTitle} numberOfLines={1}>{name}</Text>
                  <View style={{ alignSelf: 'flex-start' }}><LeagueTag league={league} /></View>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <CountText to={n} at={i * 280 + 250} dur={1100} format={commas} style={styles.haterCount} />
                  <Text style={styles.demoFaint}>{t('guide.leaderboard.haters')}</Text>
                </View>
              </View>
            </Pop>
          ))}
      </View>
    ),
  },
  {
    key: 'global', icon: 'options', where: t('guide.global.where'), title: t('guide.global.title'),
    body: t('guide.global.body'),
    demo: () => (
      <View style={styles.demoCard}>
        <Pop at={0} from="right"><ToggleRow label={t('guide.global.row1')} flipAt={900} push /></Pop>
        <View style={styles.divider} />
        <Pop at={250} from="right"><ToggleRow label={t('guide.global.row2')} flipAt={1300} push={false} pushAt={1900} note={t('guide.global.row2note')} /></Pop>
      </View>
    ),
  },
  {
    key: 'record', icon: 'medal', where: t('guide.record.where'), title: t('guide.record.title'),
    body: t('guide.record.body'),
    demo: () => <RecordDemo t={t} />,
  },
  {
    key: 'one', icon: 'eye', where: t('guide.one.where'), title: t('guide.one.title'),
    body: t('guide.one.body'),
    demo: () => <OneDemo t={t} />,
  },
  {
    key: 'plus', icon: 'star', where: t('guide.plus.where'), title: t('guide.plus.title'),
    body: t('guide.plus.body'),
    demo: () => <PlusDemo t={t} />,
  },
  {
    key: 'done', icon: 'checkmark-circle', title: t('guide.done.title'),
    body: t('guide.done.body'),
  },
];

/** One page: runs its clock whenever it becomes the current page, and lays out the drawing. */
const GuidePage = memo(function GuidePage({ item, width, active, reduced, notify }: { item: Page; width: number; active: boolean; reduced: boolean; notify?: string }) {
  const p = useRef(new Animated.Value(0)).current;
  const loop = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (reduced) { p.setValue(END); return; }
    if (!active) return;
    p.setValue(0); // also stops a run that hadn't finished
    Animated.timing(p, { toValue: END, duration: END, easing: Easing.linear, useNativeDriver: false }).start();
  }, [active, reduced, p]); // not stopped when the page is left: it finishes while the swipe goes
  useEffect(() => {
    if (!active || reduced) return;
    loop.setValue(0);
    const run = Animated.loop(Animated.timing(loop, { toValue: 1, duration: 2200, easing: Easing.linear, useNativeDriver: false }));
    run.start();
    return () => { run.stop(); loop.setValue(1); };
  }, [active, reduced, loop]);
  useEffect(() => () => { p.stopAnimation(); }, [p]);
  const motion = useMemo(() => ({ p, loop, active, reduced }), [p, loop, active, reduced]);

  return (
    <MotionCtx.Provider value={motion}>
      {/* Each page scrolls on its own if it doesn't fit (small phones, big text sizes). */}
      <ScrollView style={{ width }} contentContainerStyle={styles.page} showsVerticalScrollIndicator={false} accessibilityLabel={`${item.title}. ${item.body}`}>
        <Hero icon={item.icon} />
        {item.where ? <Text style={styles.where}>{item.where}</Text> : null}
        <Text style={styles.title}>{item.title}</Text>
        <Text style={styles.body}>{item.body}</Text>
        {item.demo ? <View style={styles.demo}>{item.demo()}</View> : null}
        {notify ? <Text style={styles.body}>{notify}</Text> : null}
      </ScrollView>
    </MotionCtx.Provider>
  );
});

export default function GuideScreen() {
  const { first } = useLocalSearchParams<{ first?: string }>();
  const isFirstRun = first === '1';
  const windowWidth = useWindowDimensions().width;
  const [listWidth, setListWidth] = useState(0);
  const width = listWidth || windowWidth; // the web version puts the guide in a column narrower than the window
  const insets = useSafeAreaInsets();
  const t = useT();
  const PAGES = useMemo(() => buildPages(t), [t]);
  const list = useRef<FlatList<Page>>(null);
  const [index, setIndex] = useState(0);
  const last = index === PAGES.length - 1;
  const reduced = useReducedMotion();

  // The last button beats like the video's "Find someone to hate".
  const beat = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!last || reduced) return;
    const run = Animated.loop(Animated.sequence([
      Animated.timing(beat, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
      Animated.timing(beat, { toValue: 0, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
    ]));
    run.start();
    return () => { run.stop(); beat.setValue(0); };
  }, [last, reduced, beat]);

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
          <Pressable onPress={() => go(index - 1)} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('guide.previous')}>
            <Text style={styles.topLink}>{t('guide.back')}</Text>
          </Pressable>
        ) : <View />}
        {!last ? (
          <Pressable onPress={() => close()} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('guide.skipLabel')}>
            <Text style={styles.topLink}>{t('guide.skip')}</Text>
          </Pressable>
        ) : null}
      </View>

      <FlatList
        ref={list}
        data={PAGES}
        extraData={`${index}${reduced}`}
        keyExtractor={(p) => p.key}
        horizontal
        pagingEnabled
        onLayout={(e) => setListWidth(e.nativeEvent.layout.width)}
        showsHorizontalScrollIndicator={false}
        bounces={false}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        onScroll={(e) => setIndex(Math.min(PAGES.length - 1, Math.max(0, Math.round(e.nativeEvent.contentOffset.x / width))))}
        scrollEventThrottle={16}
        renderItem={({ item, index: i }) => (
          <GuidePage item={item} width={width} active={i === index} reduced={reduced} notify={i === PAGES.length - 1 && isFirstRun ? t('guide.notifyNext') : undefined} />
        )}
      />

      <View style={styles.dots} accessibilityLabel={t('guide.pageOf', { page: index + 1, total: PAGES.length })}>
        {PAGES.map((p, i) => <Dot key={p.key} on={i === index} />)}
      </View>
      <Pressable
        onPress={() => (last ? close(isFirstRun) : go(index + 1))}
        accessibilityRole="button"
      >
        {({ pressed }) => (
          <Animated.View style={[styles.primary, pressed && { opacity: 0.85 }, { transform: [{ scale: beat.interpolate({ inputRange: [0, 1], outputRange: [1, 1.04] }) }] }]}>
            <Text style={styles.primaryText}>{last ? (isFirstRun ? t('guide.findSomeone') : t('guide.done')) : t('guide.next')}</Text>
          </Animated.View>
        )}
      </Pressable>
    </View>
  );
}

// ─── Drawings of the app's controls ───────────────────────────────────────────────────────────
/** The current page's dot: the wide red pill of the video, easing between the two. */
function Dot({ on }: { on: boolean }) {
  const v = useRef(new Animated.Value(on ? 1 : 0)).current;
  useEffect(() => { Animated.timing(v, { toValue: on ? 1 : 0, duration: 250, easing: pop, useNativeDriver: false }).start(); }, [on, v]);
  return <Animated.View style={[styles.dot, { width: v.interpolate({ inputRange: [0, 1], outputRange: [7, 22] }), backgroundColor: v.interpolate({ inputRange: [0, 1], outputRange: [colors.border, colors.hate] }) }]} />;
}
function DemoCard({ children, flashAt }: { children: ReactNode; flashAt?: number }) {
  const { p } = useMotion();
  // A new alert's card lands with a red edge that settles.
  const borderColor = flashAt === undefined ? colors.border : seg(p, flashAt, flashAt + 1100, [colors.hate, colors.border] as string[], Easing.linear);
  return <Animated.View style={[styles.demoCard, styles.row, { borderColor }]}>{children}</Animated.View>;
}
function Badge({ text, color }: { text: string; color: string }) {
  return <View style={[styles.badge, { backgroundColor: color }]}><Text style={styles.badgeText}>{text}</Text></View>;
}
function RoundIcon({ name, dim }: { name: Icon; dim?: boolean }) {
  return (
    <View style={styles.round}>
      <Ionicons name={name} size={18} color={dim ? colors.textFaint : colors.text} />
    </View>
  );
}
/** The Search tab's field, typing a name with a blinking cursor. */
function SearchBox({ text, at, dur }: { text: string; at: number; dur: number }) {
  const { loop } = useMotion();
  const n = useCount(text.length, at, dur, Easing.linear);
  return (
    <View style={styles.search}>
      <Ionicons name="search" size={18} color={colors.textDim} />
      <Text style={styles.searchText}>{text.slice(0, n)}</Text>
      <Animated.View style={[styles.cursor, { opacity: loop.interpolate({ inputRange: [0, 0.5, 0.5001, 1], outputRange: [1, 1, 0, 0] }) }]} />
    </View>
  );
}
/** Track, pulsing, then Tracking: the button as the app draws it either way (ui.tsx FollowButton). */
function TrackPill({ at, track, tracking }: { at: number; track: string; tracking: string }) {
  const { p } = useMotion();
  const tint = (a: string, b: string) => seg(p, at, at + 200, [a, b] as string[], Easing.linear);
  return (
    <Animated.View style={[styles.trackPill, {
      transform: [{ scale: p.interpolate({ inputRange: [at - 450, at - 200, at], outputRange: [1, 1.12, 1], extrapolate: 'clamp' }) }],
      backgroundColor: tint(colors.hate, 'rgba(0,0,0,0)'),
    }]}>
      <Animated.Text style={[styles.trackText, { opacity: seg(p, at, at + 200, [0, 1], Easing.linear), color: colors.hate }]}>{tracking}</Animated.Text>
      <Animated.Text style={[styles.trackText, styles.trackOver, { opacity: seg(p, at, at + 200, [1, 0], Easing.linear) }]}>{track}</Animated.Text>
    </Animated.View>
  );
}
function ChanceBar({ at }: { at: number }) {
  const { p } = useMotion();
  return <View style={styles.bar}><Animated.View style={[styles.barFill, { width: seg(p, at, at + 1100, ['0%', '78%'], pop) }]} /></View>;
}
function ToggleRow({ label, flipAt, push, pushAt, note }: { label: string; flipAt: number; push: boolean; pushAt?: number; note?: string }) {
  const on = useAfter(flipAt);
  // pushAt: the bell starts on and is switched off then (push is where it ends).
  const settled = useAfter(pushAt ?? Infinity);
  const bell = push || (pushAt === undefined ? false : !settled);
  return (
    <View style={[styles.row, { paddingVertical: space(1) }]} pointerEvents="none">
      <View style={{ flex: 1 }}>
        <Text style={styles.demoTitle}>{label}</Text>
        {note ? <View style={{ marginTop: 2 }}>{pushAt === undefined ? <Text style={styles.demoSub}>{note}</Text> : <Fade at={pushAt}><Text style={styles.demoSub}>{note}</Text></Fade>}</View> : null}
      </View>
      <RoundIcon name={bell ? 'notifications' : 'notifications-off'} dim={!bell} />
      {/* Same look as SettingRow's switches (react-native-web otherwise paints the "on" thumb teal). */}
      <Switch value={on} trackColor={{ true: colors.hate, false: colors.border }} thumbColor="#fff" ios_backgroundColor={colors.border} {...({ activeThumbColor: '#fff' } as object)} />
    </View>
  );
}
function Explain({ icon, mark, text, color = colors.hate }: { icon?: Icon; mark?: string; text: string; color?: string }) {
  return (
    <View style={[styles.row, { alignItems: 'flex-start' }]}>
      {mark ? <Text style={{ fontSize: 16, lineHeight: 22, width: 18, textAlign: 'center' }}>{mark}</Text> : <Ionicons name={icon!} size={18} color={color} style={{ marginTop: 2 }} />}
      <Text style={[styles.body, { flex: 1, textAlign: 'left', marginTop: 0 }]}>{text}</Text>
    </View>
  );
}

function FeedDemo({ t }: { t: T }) {
  const { p } = useMotion();
  const others = useCount(23, 600, 1000);
  return (
    <Pop at={0}>
      <DemoCard flashAt={300}>
        <Badge text="PHI" color="#06424d" />
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={styles.demoTitle}>{t('guide.feed.demoTitle')}</Text>
          <Text style={styles.demoSub}>{t('guide.feed.demoSub')}</Text>
          <AlsoGot n={others} />
        </View>
        <Animated.View style={{ alignSelf: 'flex-start', transform: [{ scale: p.interpolate({ inputRange: [1700, 1850, 2000], outputRange: [1, 1.35, 1], extrapolate: 'clamp' }) }] }}>
          <Ionicons name={Platform.OS === 'ios' ? 'share-outline' : 'share-social-outline'} size={20} color={colors.textDim} />
        </Animated.View>
      </DemoCard>
    </Pop>
  );
}

function RecordDemo({ t }: { t: T }) {
  const { p, loop } = useMotion();
  return (
    <Pop at={0}>
      <View style={[styles.demoCard, { borderColor: colors.hateDim, gap: space(3) }]}>
        <View style={[styles.row, { gap: space(4) }]}>
          <Animated.View style={{ transform: [{ scale: p.interpolate({ inputRange: [1100, 1250, 1450], outputRange: [1, 1.18, 1], extrapolate: 'clamp' }) }] }}>
            <CountText to={12} at={200} dur={1000} style={styles.recordCount} />
          </Animated.View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.demoTitle, { fontSize: 17 }]}>{t('guide.record.demoTitle')}</Text>
            <Text style={styles.demoSub}>{t('guide.record.demoSub')}</Text>
          </View>
        </View>
        <View style={[styles.inline, { flexWrap: 'wrap' }]}>
          {([['DAL', '#041E42', 'Cowboys', 5], ['LAL', '#552583', 'Lakers', 4]] as const).map(([abbr, color, name, n], i) => (
            <Pop key={abbr} at={800 + i * 250} from="scale">
              <View style={styles.chip}>
                <View style={[styles.chipBadge, { backgroundColor: color }]}><Text style={styles.chipBadgeText}>{abbr}</Text></View>
                <Text style={styles.chipName}>{name}</Text>
                <CountText to={n} at={900 + i * 250} dur={600} style={styles.chipCount} />
              </View>
            </Pop>
          ))}
          <Pop at={1400} from="scale">
            <View style={[styles.chip, { paddingLeft: space(2.5) }]}>
              <Text style={styles.chipMore}>{t('guide.record.more')}</Text>
              <Animated.View style={{ transform: [{ translateY: loop.interpolate({ inputRange: [0, 0.25, 0.5, 1], outputRange: [0, 3, 0, 0] }) }] }}>
                <Ionicons name="chevron-down" size={14} color={colors.textDim} />
              </Animated.View>
            </View>
          </Pop>
        </View>
      </View>
    </Pop>
  );
}

/** The tracking card, with a ring walking over its controls while the line about each lights up (the video's "Tune" scene). */
function OneDemo({ t }: { t: T }) {
  const { active, reduced } = useMotion();
  const [step, setStep] = useState(-1); // -1: nothing picked out yet
  useEffect(() => {
    if (!active) return;
    setStep(-1);
    if (reduced) return;
    let tick: ReturnType<typeof setInterval> | undefined;
    const start = setTimeout(() => {
      let i = 0;
      setStep(0);
      tick = setInterval(() => { i = (i + 1) % 5; setStep(i); }, 1500);
    }, 1800);
    return () => { clearTimeout(start); if (tick) clearInterval(tick); };
  }, [active, reduced]);
  const lines = [
    <Explain key="eye" icon="eye" text={t('guide.one.eye')} />,
    <Explain key="x" mark="❌" text={t('guide.one.x')} />,
    <Explain key="bell" icon="notifications" text={t('guide.one.bell')} />,
    <Explain key="gear" icon="settings-sharp" text={t('guide.one.gear')} />,
    <Explain key="unfollow" icon="remove-circle" text={t('guide.one.unfollowHelp')} />,
  ];
  return (
    <View style={{ gap: space(4) }}>
      <Pop at={0}>
        <View style={[styles.demoCard, { padding: 0 }]}>
          <View style={styles.banner}>
            <Text style={styles.bannerLeague}>NFL</Text>
            <Lit on={step === 0} style={[styles.inline, { gap: 4 }]}><Ionicons name="eye" size={12} color="#fff" /><Text style={styles.bannerLeague}>{t('guide.one.haters')}</Text></Lit>
          </View>
          <View style={{ padding: space(3), paddingTop: 0 }}>
            <View style={styles.bannerAvatar}><Badge text="DJ" color="#002C5F" /></View>
            <Text style={[styles.demoTitle, { fontSize: 17 }]}>Daniel Jones</Text>
            <Text style={styles.demoSub}>QB</Text>
            <View style={[styles.row, { marginTop: space(3) }]}>
              <Lit on={step === 1}><RoundIcon name="close-outline" /></Lit>
              <Lit on={step === 2}><RoundIcon name="notifications" /></Lit>
              <Lit on={step === 3}><RoundIcon name="settings-sharp" /></Lit>
              <Lit on={step === 4} style={{ marginLeft: 'auto' }}><View style={styles.unfollowPill}><Text style={styles.unfollowText}>{t('guide.one.unfollow')}</Text></View></Lit>
            </View>
          </View>
        </View>
      </Pop>
      {lines.map((line, i) => <Pop key={i} at={500 + i * 140}><Dim on={step < 0 || step === i}>{line}</Dim></Pop>)}
    </View>
  );
}

function PlusDemo({ t }: { t: T }) {
  const { loop } = useMotion();
  return (
    <Pop at={0} from="scale">
      <View style={[styles.demoCard, { borderColor: GOLD, gap: space(4) }]}>
        <Animated.View pointerEvents="none" style={[styles.glow, { opacity: loop.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.15, 1, 0.15] }) }]} />
        <Pop at={300} from="right"><Explain icon="color-palette" color={GOLD} text={t('guide.plus.gold')} /></Pop>
        <Pop at={700} from="right"><Explain icon="apps" color={GOLD} text={t('guide.plus.icon')} /></Pop>
        <Pop at={1100} from="right"><Explain mark="❌" text={t('guide.plus.mostHated')} /></Pop>
        <Pop at={1500} from="right"><Explain icon="heart" color={GOLD} text={t('guide.plus.favorites')} /></Pop>
        <Pop at={1900} from="right"><Explain icon="star" color={GOLD} text={t('guide.plus.vault')} /></Pop>
        <Pop at={2300} from="right"><Explain icon="albums" color={GOLD} text={t('guide.plus.profiles')} /></Pop>
        <Pop at={2700} from="right"><Explain icon="options" color={GOLD} text={t('guide.plus.presets')} /></Pop>
      </View>
    </Pop>
  );
}


const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  topBar: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: space(5), minHeight: 28 },
  topLink: { color: colors.textDim, fontSize: 16, fontWeight: '700' },
  page: { paddingHorizontal: space(5), paddingTop: space(5), paddingBottom: space(4), alignItems: 'center' },
  bigEmoji: { fontSize: 64 },
  hero: { width: 72, height: 72, alignItems: 'center', justifyContent: 'center', marginBottom: space(1) },
  heroPulse: { position: 'absolute', width: 64, height: 64, borderRadius: 32, borderWidth: 2, borderColor: colors.hate },
  iconRing: { width: 64, height: 64, borderRadius: 32, borderWidth: 2, borderColor: colors.hateDim, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
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
  downText: { color: colors.hateText, fontSize: 12, fontWeight: '800' },
  trackPill: { borderRadius: radius.pill, borderWidth: 1.5, borderColor: colors.hate, paddingHorizontal: space(4), paddingVertical: space(2), minWidth: 92, alignItems: 'center', justifyContent: 'center' },
  trackText: { fontWeight: '800', fontSize: 13 },
  trackOver: { position: 'absolute', color: colors.onHate },
  search: { flexDirection: 'row', alignItems: 'center', gap: space(2), backgroundColor: colors.surface, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, paddingHorizontal: space(4), minHeight: 44 },
  searchText: { color: colors.text, fontSize: 16 },
  cursor: { width: 2, height: 18, backgroundColor: colors.hate, marginLeft: -space(1.5) },
  lit: { position: 'absolute', top: -5, left: -5, right: -5, bottom: -5, borderRadius: radius.pill, borderWidth: 2, borderColor: colors.hate },
  glow: { ...StyleSheet.absoluteFill, borderRadius: radius.lg, borderWidth: 2, borderColor: GOLD },
  banner: { height: 34, backgroundColor: '#002C5F', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingRight: space(3), paddingLeft: space(3) + 46 + space(3) },
  bannerLeague: { color: '#fff', fontSize: 12, fontWeight: '800', letterSpacing: 0.5 },
  bannerAvatar: { alignSelf: 'flex-start', marginTop: -20, marginBottom: space(1), padding: 3, borderRadius: radius.pill, backgroundColor: colors.surface },
  unfollowPill: { paddingHorizontal: space(3), paddingVertical: space(2), borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border },
  unfollowText: { color: colors.textDim, fontWeight: '700', fontSize: 13 },
  round: { width: 34, height: 34, borderRadius: 17, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surfaceHi, alignItems: 'center', justifyContent: 'center' },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: space(2), marginTop: space(2), marginBottom: space(4) },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.border },
  primary: { marginHorizontal: space(5), backgroundColor: colors.hate, borderRadius: radius.pill, paddingVertical: space(4), alignItems: 'center' },
  primaryText: { color: colors.onHate, fontSize: 17, fontWeight: '900' },
});
