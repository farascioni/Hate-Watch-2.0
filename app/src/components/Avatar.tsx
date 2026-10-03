import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { sizedImage } from '../lib/images';
import { colors } from '../theme';
import type { Target } from '../lib/types';

/**
 * Circular avatar for any player or team.
 * - Headshots (600×436 landscape) fill the circle with cover + top anchoring so faces are never cropped.
 * - Logos are drawn with contain + padding so the whole mark is visible.
 * - Players with no ESPN photo show their team logo plus a jersey-number badge, never a wrong face.
 */
export function Avatar({ target, size = 48 }: { target: Target; size?: number }) {
  const ring = (target.kind === 'team' ? target.color : target.teamColor) ?? colors.border;
  const isHeadshot = target.kind === 'player' && target.imageKind === 'headshot';

  let uri: string, w: number, h: number;
  if (target.kind === 'team') {
    uri = target.logoDark ?? target.logo; w = target.logoW; h = target.logoH;
  } else {
    uri = target.image; w = target.imageW; h = target.imageH;
  }
  const inner = isHeadshot ? size - 4 : Math.round(size * 0.68);
  const src = sizedImage(uri, w, h, inner, isHeadshot ? 'cover' : 'contain');

  return (
    <View style={[styles.wrap, { width: size, height: size, borderRadius: size / 2, borderColor: ring }]}>
      <Image
        source={{ uri: src }}
        style={isHeadshot ? { width: inner, height: inner, borderRadius: inner / 2 } : { width: inner, height: inner }}
        contentFit={isHeadshot ? 'cover' : 'contain'}
        contentPosition={isHeadshot ? 'top' : 'center'}
        cachePolicy="memory-disk"
        recyclingKey={target.key}
        transition={120}
        accessibilityLabel={target.name}
      />
      {target.kind === 'player' && target.imageKind === 'team_logo' && target.jersey ? (
        <View style={[styles.badge, { backgroundColor: ring }]}>
          <Text style={styles.badgeText}>{target.jersey}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderWidth: 2, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceHi, overflow: 'visible' },
  badge: { position: 'absolute', right: -4, bottom: -4, minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.bg },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },
});
