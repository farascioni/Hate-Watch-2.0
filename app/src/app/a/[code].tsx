import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { api } from '../../lib/api';
import { FeedCard } from '../../components/FeedCard';
import { FollowButton, useNow } from '../../components/ui';
import { colors, space } from '../../theme';
import type { FeedItem } from '../../lib/types';

/**
 * Where a shared alert's link (https://…/a/<code>) lands when Hate Watch is installed: iOS opens the
 * app instead of the web page (a universal link). Shows the alert and a way to track who it's about.
 */
export default function SharedAlertScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const [item, setItem] = useState<FeedItem | null>();  // undefined while loading, null if it's gone
  const now = useNow();

  useEffect(() => { api.shared(code).then((r) => setItem(r.item)).catch(() => setItem(null)); }, [code]);

  if (item === undefined) return <View style={styles.center}><ActivityIndicator color={colors.hate} /></View>;
  if (item === null) {
    return (
      <View style={styles.center}>
        <Text style={styles.gone}>This alert isn't available anymore.</Text>
        <Pressable onPress={() => router.replace('/')} hitSlop={8}><Text style={styles.link}>Go to your feed</Text></Pressable>
      </View>
    );
  }
  // The server sends a bare { kind, key } if the team or player has left the catalog.
  const target = 'name' in item.target ? item.target : null;
  return (
    <View style={styles.screen}>
      <FeedCard item={item} now={now} />
      {target ? (
        <View style={styles.track}>
          <Text style={styles.prompt}>Get alerts like this about {target.name}</Text>
          <FollowButton target={target} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, paddingTop: space(4) },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space(3), backgroundColor: colors.bg, padding: space(6) },
  gone: { color: colors.textDim, fontSize: 16, textAlign: 'center' },
  link: { color: colors.hate, fontSize: 16, fontWeight: '800' },
  track: { alignItems: 'center', gap: space(3), marginTop: space(6), paddingHorizontal: space(6) },
  prompt: { color: colors.text, fontSize: 16, fontWeight: '700', textAlign: 'center' },
});
