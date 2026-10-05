import { Tabs } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useStore } from '../../lib/store';
import { colors } from '../../theme';

export default function TabLayout() {
  const { unseen, follows } = useStore();
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg, borderBottomColor: colors.border },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: '900' },
        tabBarStyle: { backgroundColor: colors.bg, borderTopColor: colors.border },
        tabBarActiveTintColor: colors.hate,
        tabBarInactiveTintColor: colors.textFaint,
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Feed',
          headerTitle: 'Hate Watch',
          tabBarIcon: ({ color, size }) => <Ionicons name="flame" color={color} size={size} />,
          tabBarBadge: unseen > 0 ? (unseen > 99 ? '99+' : unseen) : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.hate },
        }}
      />
      <Tabs.Screen
        name="scores"
        options={{ title: 'Scores', tabBarIcon: ({ color, size }) => <Ionicons name="trophy" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="search"
        options={{ title: 'Search', tabBarIcon: ({ color, size }) => <Ionicons name="search" color={color} size={size} /> }}
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
        options={{ title: 'Settings', tabBarIcon: ({ color, size }) => <Ionicons name="options" color={color} size={size} /> }}
      />
    </Tabs>
  );
}
