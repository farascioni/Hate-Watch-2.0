import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useStore } from '../../lib/store';
import { openedAlert, targetHref } from '../../lib/alerts';
import { shareAlert } from '../../lib/share';
import { Avatar } from '../../components/Avatar';
import { AlertClip } from '../../components/FeedCard';
import { AlsoGot, LeagueTag, ago, subtitle, useNow } from '../../components/ui';
import { colors, radius, space } from '../../theme';

const DAY = 24 * 3600_000;

/** The id from the path (openAlert encodes it), as is if the router already decoded it and it holds a lone "%". */
const decoded = (id: string) => { try { return decodeURIComponent(id); } catch { return id; } };

/** An alert on its own, opened from a list (lib/alerts.ts openAlert): all of its text, its clip, when, and who it's about. */
export default function AlertScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const alertId = decoded(id);
  const { feed, ready } = useStore();
  const now = useNow();
  const [copied, setCopied] = useState(false);
  // The feed's copy when it has one (a fact that comes later is added to it live), else the one tapped.
  const item = feed.find((f) => f.id === alertId) ?? openedAlert(alertId);
  const header = <Stack.Screen options={{ title: 'Alert', headerBackTitle: 'Back' }} />;

  if (!item) {
    return (
      <View style={styles.center}>
        {header}
        {ready ? (
          <>
            <Text style={styles.gone}>This alert isn't in your feed anymore.</Text>
            <Pressable onPress={() => router.replace('/')} hitSlop={8}><Text style={styles.link}>Go to your feed</Text></Pressable>
          </>
        ) : <ActivityIndicator color={colors.hate} />}
      </View>
    );
  }
  // The server sends a bare { kind, key } if the team or player has left the catalog.
  const target = 'name' in item.target ? item.target : null;
  const share = async () => {
    if ((await shareAlert(item)) === 'copied') {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };
  const when = new Date(item.occurredAt).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {header}
      {target ? (
        <Pressable onPress={() => router.push(targetHref(target))} style={({ pressed }) => [styles.who, pressed && { backgroundColor: colors.surfaceHi }]}
          accessibilityRole="button" accessibilityLabel={`${target.name}'s page`}>
          <Avatar target={target} size={48} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.name} numberOfLines={1}>{target.name}</Text>
            <Text style={styles.sub} numberOfLines={1}>{subtitle(target)}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
        </Pressable>
      ) : null}
      <Text style={styles.title} selectable>{item.emoji} {item.title}</Text>
      <Text style={styles.body} selectable>{item.body}</Text>
      {item.alsoGot != null ? <AlsoGot n={item.alsoGot} /> : null}
      <View style={styles.meta}>
        <LeagueTag league={item.league} />
        <Text style={styles.metaText}>{item.typeLabel}</Text>
        <Text style={styles.metaText}>•</Text>
        <Text style={styles.metaText}>{when}{now - item.occurredAt < DAY ? ` (${ago(item.occurredAt, now)})` : ''}</Text>
      </View>
      {item.clip ? <AlertClip clip={item.clip} style={styles.clip} /> : null}
      <Pressable onPress={share} style={({ pressed }) => [styles.share, pressed && { opacity: 0.7 }]} accessibilityRole="button"
        accessibilityLabel={copied ? 'Copied to clipboard' : 'Share this alert'}>
        <Ionicons name={copied ? 'checkmark' : Platform.OS === 'ios' ? 'share-outline' : 'share-social-outline'} size={18} color={copied ? colors.live : colors.text} />
        <Text style={[styles.shareText, copied && { color: colors.live }]}>{copied ? 'Copied' : 'Share this alert'}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space(4), gap: space(3), paddingBottom: space(10) },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space(3), backgroundColor: colors.bg, padding: space(6) },
  gone: { color: colors.textDim, fontSize: 16, textAlign: 'center' },
  link: { color: colors.hate, fontSize: 16, fontWeight: '800' },
  who: { flexDirection: 'row', alignItems: 'center', gap: space(3), padding: space(3), backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border },
  name: { color: colors.text, fontSize: 16, fontWeight: '800' },
  sub: { color: colors.textDim, fontSize: 13 },
  title: { color: colors.text, fontSize: 21, fontWeight: '800', lineHeight: 27, marginTop: space(1) },
  body: { color: colors.text, fontSize: 16, lineHeight: 23 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: space(1.5), flexWrap: 'wrap' },
  metaText: { color: colors.textFaint, fontSize: 13, fontWeight: '600' },
  clip: { marginTop: 0, marginLeft: 0 },
  share: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space(2), alignSelf: 'flex-start', marginTop: space(2), paddingHorizontal: space(4), paddingVertical: space(2.5), borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  shareText: { color: colors.text, fontSize: 14, fontWeight: '800' },
});
