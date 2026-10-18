import { Pressable } from 'react-native';
import { Tabs, router } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useStore } from '../../lib/store';
import { DetailPlaceholder } from '../../components/WebShell';
import { useWebLayout } from '../../lib/webLayout';
import { colors, space } from '../../theme';

/** Top left of every tab: the leaderboard (the most hated athletes and teams), instead of a sixth tab. */
function LeaderboardButton() {
  return (
    <Pressable onPress={() => router.push('/leaderboard')} hitSlop={10} style={({ pressed }) => [{ marginLeft: space(4), marginRight: space(2), padding: 2 }, pressed && { opacity: 0.6 }]}
      accessibilityRole="button" accessibilityLabel="Leaderboard: the most hated athletes and teams">
      <Ionicons name="podium" size={22} color={colors.text} />
    </Pressable>
  );
}

export default function TabLayout() {
  const { unseen, follows } = useStore();
  const { wide, panes } = useWebLayout();
  // Panes draw the tab beside the router's stack (WebShell's ListPane), so the router's own tab screens would be a second copy.
  if (panes) return <DetailPlaceholder />;
  // A sidebar (WebShell) replaces the tab bar and the leaderboard button; Search and Settings stay a column.
  const narrow = { backgroundColor: colors.bg, ...(wide && { width: '100%' as const, maxWidth: 640, marginHorizontal: 'auto' as unknown as number }) };
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg, borderBottomColor: colors.border },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: '900' },
        tabBarStyle: wide ? { display: 'none' } : { backgroundColor: colors.bg, borderTopColor: colors.border },
        tabBarActiveTintColor: colors.hate,
        tabBarInactiveTintColor: colors.textFaint,
        sceneStyle: { backgroundColor: colors.bg },
        headerLeft: wide ? undefined : () => <LeaderboardButton />,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Feed',
          headerTitle: 'Hate Watch',
          tabBarIcon: ({ color, size }) => <Ionicons name="flame" color={color} size={size} />,
          tabBarBadge: unseen > 0 ? (unseen > 99 ? '99+' : unseen) : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.hate, color: colors.onHate },
        }}
      />
      <Tabs.Screen
        name="scores"
        options={{ title: 'Scores', tabBarIcon: ({ color, size }) => <Ionicons name="trophy" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="search"
        options={{ title: 'Search', sceneStyle: narrow, tabBarIcon: ({ color, size }) => <Ionicons name="search" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="following"
        options={{
          title: 'Tracking',
          headerTitle: `Tracking (${follows.size})`,
          tabBarIcon: ({ color, size }) => <Ionicons name="eye" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: 'Settings', sceneStyle: narrow, tabBarIcon: ({ color, size }) => <Ionicons name="options" color={color} size={size} /> }}
      />
    </Tabs>
  );
}
