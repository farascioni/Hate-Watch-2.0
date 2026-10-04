import type { ReactNode } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { colors, space } from '../theme';

/** One labelled switch row, shared by the global Settings tab and the per-player/team alert screen. */
export function SettingRow({ title, desc, value, onChange, emoji, disabled, footer }: {
  title: string; desc?: string; value: boolean; onChange: (v: boolean) => void; emoji?: string; disabled?: boolean;
  /** Extra line under the description, e.g. "Custom for Daniel Jones · Reset". */
  footer?: ReactNode;
}) {
  return (
    <View style={[styles.row, disabled && { opacity: 0.45 }]}>
      {emoji ? <Text style={styles.emoji}>{emoji}</Text> : null}
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>{title}</Text>
        {desc ? <Text style={styles.desc}>{desc}</Text> : null}
        {footer}
      </View>
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

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space(3), paddingHorizontal: space(4), paddingVertical: space(3), borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  emoji: { fontSize: 20, width: 26, textAlign: 'center' },
  title: { color: colors.text, fontSize: 15, fontWeight: '700' },
  desc: { color: colors.textDim, fontSize: 13, marginTop: 2, lineHeight: 17 },
});
