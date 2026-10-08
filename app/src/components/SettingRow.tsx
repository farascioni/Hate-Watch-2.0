import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, radius, space } from '../theme';

/** One labelled switch row, shared by the global Settings tab and the per-player/team alert screen. */
export function SettingRow({ title, desc, value, onChange, emoji, disabled, footer, push }: {
  title: string; desc?: string; value: boolean; onChange: (v: boolean) => void; emoji?: string; disabled?: boolean;
  /** Extra line under the description, e.g. "Custom for Daniel Jones · Reset". */
  footer?: ReactNode;
  /**
   * The alert's 🔔: notify me, or keep it in the feed without a notification (the same meaning as the
   * bell on the Tracking tab). Usable only while the alert itself is switched on.
   */
  push?: { on: boolean; onChange: (on: boolean) => void };
}) {
  const bellUsable = !!push && value && !disabled;
  return (
    <View style={[styles.row, disabled && { opacity: 0.45 }]}>
      {emoji ? <Text style={styles.emoji}>{emoji}</Text> : null}
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>{title}</Text>
        {desc ? <Text style={styles.desc}>{desc}</Text> : null}
        {push && value && !push.on ? <Text style={styles.feedOnly}>Feed only: no notification</Text> : null}
        {footer}
      </View>
      {push ? (
        <Pressable
          onPress={() => push.onChange(!push.on)}
          disabled={!bellUsable}
          hitSlop={6}
          style={({ pressed }) => [styles.bell, !value && { opacity: 0.35 }, pressed && { opacity: 0.6 }]}
          accessibilityRole="switch"
          // aria-* rather than accessibilityState: react-native-web only passes these on to screen readers.
          aria-checked={push.on}
          aria-disabled={!bellUsable}
          accessibilityLabel={`Notifications for ${title}`}
          accessibilityHint={push.on ? 'Turn off to keep this alert in your feed without a notification' : 'Turn on to also get a notification'}
        >
          <Ionicons name={push.on ? 'notifications' : 'notifications-off'} size={18} color={push.on && value ? colors.text : colors.textFaint} />
        </Pressable>
      ) : null}
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ true: colors.hate, false: colors.border }}
        thumbColor="#fff"
        ios_backgroundColor={colors.border}
        // react-native-web otherwise paints the "on" thumb Material teal
        {...({ activeThumbColor: '#fff' } as object)}
        accessibilityLabel={title}
      />
    </View>
  );
}

/** A heading inside a card of alerts: "Offense", "Pitching", "Team". Nothing for an alert without one (older servers). */
export function SettingSection({ title }: { title: string }) {
  if (!title) return null;
  return <Text style={styles.section} accessibilityRole="header">{title}</Text>;
}

const styles = StyleSheet.create({
  section: { color: colors.textDim, fontSize: 11, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', paddingHorizontal: space(4), paddingTop: space(3), paddingBottom: space(2), backgroundColor: colors.surfaceHi, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  row: { flexDirection: 'row', alignItems: 'center', gap: space(3), paddingHorizontal: space(4), paddingVertical: space(3), borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  emoji: { fontSize: 20, width: 26, textAlign: 'center' },
  title: { color: colors.text, fontSize: 15, fontWeight: '700' },
  desc: { color: colors.textDim, fontSize: 13, marginTop: 2, lineHeight: 17 },
  feedOnly: { color: colors.textFaint, fontSize: 12, fontWeight: '700', marginTop: 4 },
  bell: { padding: space(2), borderRadius: radius.pill, backgroundColor: colors.surfaceHi },
});
