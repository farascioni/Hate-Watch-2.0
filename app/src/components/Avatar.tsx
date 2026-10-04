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

  // F1 constructors have no logo on ESPN: the server marks them "badge://" and we draw a badge in the
  // team's official colour with its code (FER, MCL…). Crisp at any size, and clearly not a fake logo.
  if (uri.startsWith('badge://')) {
    const code = (target.kind === 'team' ? target.abbrev : target.teamAbbrev) ?? '?';
    const fill = ring;
    return (
      <View style={[styles.wrap, { width: size, height: size, borderRadius: size / 2, borderColor: fill, backgroundColor: fill }]} accessibilityLabel={target.name}>
        <Text style={{ color: readableOn(fill), fontSize: Math.round(size * (code.length > 2 ? 0.28 : 0.34)), fontWeight: '900', letterSpacing: 0.5 }} numberOfLines={1}>{code}</Text>
        {target.kind === 'player' && target.jersey ? (
          <View style={[styles.badge, { backgroundColor: colors.surfaceHi }]}>
            <Text style={styles.badgeText}>{target.jersey}</Text>
          </View>
        ) : null}
      </View>
    );
  }

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

/** Black or white text, whichever reads better on a hex background (Alpine yellow, Williams white…). */
function readableOn(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return '#fff';
  const n = parseInt(m[1], 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.6 ? '#111' : '#fff';
}

const styles = StyleSheet.create({
  wrap: { borderWidth: 2, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceHi, overflow: 'visible' },
  badge: { position: 'absolute', right: -4, bottom: -4, minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.bg },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },
});
