import { useEffect, useMemo, useRef, useState, type ComponentProps, type ComponentType, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router, usePathname } from 'expo-router';
import { NavigationContext } from 'expo-router/react-navigation';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useStore } from '../lib/store';
import { LIST_PANE, RAIL, SIDEBAR, WEB_LAYOUTS, setWebLayout, useWebLayout } from '../lib/webLayout';
import FeedScreen from '../app/(tabs)/index';
import ScoresScreen from '../app/(tabs)/scores';
import SearchScreen from '../app/(tabs)/search';
import FollowingScreen from '../app/(tabs)/following';
import SettingsScreen from '../app/(tabs)/settings';
import { colors, radius, space } from '../theme';

type TabId = 'feed' | 'scores' | 'search' | 'following' | 'settings';
const TABS: { id: TabId; path: string; title: string; icon: ComponentProps<typeof Ionicons>['name']; screen: ComponentType }[] = [
  { id: 'feed', path: '/', title: 'Feed', icon: 'flame', screen: FeedScreen },
  { id: 'scores', path: '/scores', title: 'Scores', icon: 'trophy', screen: ScoresScreen },
  { id: 'search', path: '/search', title: 'Search', icon: 'search', screen: SearchScreen },
  { id: 'following', path: '/following', title: 'Tracking', icon: 'eye', screen: FollowingScreen },
  { id: 'settings', path: '/settings', title: 'Settings', icon: 'options', screen: SettingsScreen },
];

/**
 * The web version's frame. Under 700 px: the phone layout in a centred column. Wider: a sidebar (the tabs, the
 * leaderboard and the layout buttons) beside the content, laid out as webLayout says. In panes the tab is drawn
 * here, outside the router (ListPane), and the router's own stack is the right-hand pane.
 */
export function WebShell({ children }: { children: ReactNode }) {
  const { wide, layout, panes } = useWebLayout();
  const path = usePathname();
  const pathTab = TABS.find((t) => t.path === path)?.id;
  const [paneTab, setPaneTab] = useState<TabId>(pathTab ?? 'feed');
  // A link to a tab (Find someone to hate) switches the pane's. In panes the router's tabs are gone and the path falls back to '/', which isn't a link.
  useEffect(() => { if (pathTab && (!panes || path !== '/')) setPaneTab(pathTab); }, [pathTab, panes, path]);
  // Leaving panes: the router's tabs come back on the tab the pane showed.
  const wasPanes = useRef(panes);
  useEffect(() => { if (wasPanes.current && !panes) router.navigate(TABS.find((t) => t.id === paneTab)!.path as '/'); wasPanes.current = panes; }, [panes]); // eslint-disable-line react-hooks/exhaustive-deps
  const chrome = wide && !path.startsWith('/guide'); // the startup guide has the window to itself

  // One tree in every mode, so the router's stack isn't remounted when the layout or the window changes.
  return (
    <View style={chrome ? styles.shell : styles.phone}>
      {chrome ? <Sidebar active={panes ? paneTab : pathTab} onTab={(t) => (panes ? setPaneTab(t.id) : router.navigate(t.path as '/'))} /> : null}
      {chrome && panes ? <ListPane key={paneTab} tab={paneTab} /> : null}
      <View style={chrome ? [styles.main, layout === 'column' && styles.column, layout === 'grid' && styles.grid] : styles.fill}>{children}</View>
    </View>
  );
}

type NavProps = { icon: ComponentProps<typeof Ionicons>['name']; label: string; active?: boolean; onPress: () => void; rail: boolean; badge?: string };
function NavItem({ icon, label, active, onPress, rail, badge }: NavProps) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: !!active }}
      style={({ pressed }) => [styles.item, rail && styles.itemRail, active && styles.itemOn, pressed && { opacity: 0.6 }]}>
      <View>
        <Ionicons name={icon} size={20} color={active ? colors.hate : colors.textDim} />
        {badge ? <View style={styles.badge}><Text style={styles.badgeText}>{badge}</Text></View> : null}
      </View>
      {rail ? null : <Text style={[styles.label, active && { color: colors.text }]} numberOfLines={1}>{label}</Text>}
    </Pressable>
  );
}

function Sidebar({ active, onTab }: { active?: TabId; onTab: (t: (typeof TABS)[number]) => void }) {
  const { rail, layout } = useWebLayout();
  const { unseen, follows } = useStore();
  const badge = (id: TabId) => (id === 'feed' && unseen > 0 ? (unseen > 99 ? '99+' : String(unseen)) : undefined);
  return (
    <View style={[styles.side, { width: rail ? RAIL : SIDEBAR }]} role="navigation">
      <View style={[styles.brand, rail && { justifyContent: 'center' }]}>
        <Ionicons name="flame" size={22} color={colors.hate} />
        {rail ? null : <Text style={styles.brandText}>Hate Watch</Text>}
      </View>
      {TABS.map((t) => <NavItem key={t.id} icon={t.icon} label={t.id === 'following' ? `${t.title} (${follows.size})` : t.title} active={active === t.id} onPress={() => onTab(t)} rail={rail} badge={badge(t.id)} />)}
      <NavItem icon="podium" label="Leaderboard" onPress={() => router.push('/leaderboard')} rail={rail} />
      <View style={{ flex: 1 }} />
      {rail ? null : <Text style={styles.caption}>Layout</Text>}
      {WEB_LAYOUTS.map((l) => <NavItem key={l.id} icon={l.icon} label={l.name} active={layout === l.id} onPress={() => setWebLayout(l.id)} rail={rail} />)}
    </View>
  );
}

/**
 * Panes: the tab on the left. Its screen is the same one the router would show, drawn here without the router's
 * tab navigator, so it gets a stand-in for the navigation object: always focused, and the header's right button
 * (the LIVE badge, Tracking's Layout menu) is whatever the screen sets with setOptions.
 */
function ListPane({ tab }: { tab: TabId }) {
  const { follows } = useStore();
  const [right, setRight] = useState<(() => ReactNode) | undefined>();
  const nav = useMemo(() => ({
    isFocused: () => true,
    addListener: () => () => {},
    getParent: () => undefined,
    getId: () => undefined,
    setOptions: (o: { headerRight?: () => ReactNode }) => setRight(() => o.headerRight),
  }), []);
  const t = TABS.find((x) => x.id === tab)!;
  const Screen = t.screen;
  return (
    <View style={styles.list}>
      <View style={styles.listHead}>
        <Text style={styles.listTitle} numberOfLines={1}>{tab === 'feed' ? 'Hate Watch' : tab === 'following' ? `Tracking (${follows.size})` : t.title}</Text>
        {right?.()}
      </View>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <NavigationContext.Provider value={nav as any}><Screen /></NavigationContext.Provider>
    </View>
  );
}

/** The right-hand pane before anything is opened: what the (tabs) route draws in panes. */
export function DetailPlaceholder() {
  return (
    <View style={styles.empty}>
      <Ionicons name="browsers-outline" size={40} color={colors.textFaint} />
      <Text style={styles.emptyTitle}>Pick something</Text>
      <Text style={styles.emptyBody}>A game, a player or an alert opens here.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  phone: { flex: 1, width: '100%', maxWidth: 600, alignSelf: 'center' },
  fill: { flex: 1 },
  shell: { flex: 1, flexDirection: 'row', backgroundColor: colors.bg },
  main: { flex: 1, minWidth: 0 },
  // Auto side margins centre what's capped (flex-grow runs out at the max width first).
  column: { maxWidth: 640, marginHorizontal: 'auto' as unknown as number },
  grid: { maxWidth: 1600, marginHorizontal: 'auto' as unknown as number },
  side: { borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.border, paddingHorizontal: space(2), paddingVertical: space(3), gap: space(1) },
  brand: { flexDirection: 'row', alignItems: 'center', gap: space(2), paddingHorizontal: space(2), paddingBottom: space(3) },
  brandText: { color: colors.text, fontSize: 17, fontWeight: '900' },
  item: { flexDirection: 'row', alignItems: 'center', gap: space(3), paddingHorizontal: space(3), paddingVertical: space(2.5), borderRadius: radius.md },
  itemRail: { justifyContent: 'center', paddingHorizontal: 0 },
  itemOn: { backgroundColor: colors.surfaceHi },
  label: { color: colors.textDim, fontSize: 14, fontWeight: '700', flexShrink: 1 },
  caption: { color: colors.textFaint, fontSize: 11, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', paddingHorizontal: space(3), paddingTop: space(2) },
  badge: { position: 'absolute', top: -6, right: -10, minWidth: 16, height: 16, paddingHorizontal: 4, borderRadius: 8, backgroundColor: colors.hate, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: colors.onHate, fontSize: 10, fontWeight: '800' },
  list: { width: LIST_PANE, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.border },
  listHead: { height: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: space(4), borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  listTitle: { color: colors.text, fontSize: 17, fontWeight: '900', flexShrink: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space(2), backgroundColor: colors.bg },
  emptyTitle: { color: colors.text, fontSize: 17, fontWeight: '800' },
  emptyBody: { color: colors.textFaint, fontSize: 14 },
});
