import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Avatar } from './Avatar';
import { LeagueTag, ago } from './ui';
import { colors, radius, space } from '../theme';
import type { FeedItem } from '../lib/types';

export const FeedCard = memo(function FeedCard({ item, now, fresh }: { item: FeedItem; now: number; fresh?: boolean }) {
  return (
    <Pressable
      onPress={() => router.push(`/target/${encodeURIComponent(item.target.key)}`)}
      style={({ pressed }) => [styles.card, fresh && styles.fresh, pressed && { backgroundColor: colors.surfaceHi }]}
    >
      <View>
        <Avatar target={item.target} size={52} />
        <Text style={styles.emoji}>{item.emoji}</Text>
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={styles.title}>{item.title}</Text>
        <Text style={styles.body} numberOfLines={3}>{item.body}</Text>
        <View style={styles.meta}>
          <LeagueTag league={item.league} />
          <Text style={styles.metaText}>{item.typeLabel}</Text>
          <Text style={styles.metaDot}>•</Text>
          <Text style={styles.metaText}>{ago(item.occurredAt, now)}</Text>
        </View>
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  card: { flexDirection: 'row', gap: space(3), padding: space(4), marginHorizontal: space(3), marginBottom: space(2), backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border },
  fresh: { borderColor: colors.hate, shadowColor: colors.hate, shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 0 } },
  emoji: { position: 'absolute', right: -6, bottom: -6, fontSize: 20 },
  title: { color: colors.text, fontSize: 16, fontWeight: '800', lineHeight: 21 },
  body: { color: colors.textDim, fontSize: 14, lineHeight: 19 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: space(1.5), marginTop: 2, flexWrap: 'wrap' },
  metaText: { color: colors.textFaint, fontSize: 12, fontWeight: '600' },
  metaDot: { color: colors.textFaint, fontSize: 12 },
});
