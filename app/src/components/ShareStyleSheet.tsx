import { useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { shareAlert } from '../lib/share';
import { colors, radius, space } from '../theme';
import type { FeedItem } from '../lib/types';
import { useT } from '../lib/i18n';

type ShareStyle = NonNullable<FeedItem['shareStyles']>[number];

/**
 * The share button of an alert (FeedCard, the alert screen). An alert with one look shares straight away; one with
 * several (item.shareStyles: classic, ticket stub, boarding pass...) first shows ShareStyleSheet to pick from. Render
 * `sheet` outside any Pressable (a Modal's taps would reach it). `copied` is true for 2 seconds after a copy.
 */
export function useShare(item: FeedItem | undefined) {
  const [copied, setCopied] = useState(false);
  const [picking, setPicking] = useState(false);
  const go = async (url?: string) => {
    if (item && (await shareAlert(item, url)) === 'copied') {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };
  const share = () => (item?.shareStyles ? setPicking(true) : go());
  // iOS can't present its share sheet while a Modal is still leaving, so there the share waits for the fade. The web needs the tap's user gesture, so it shares at once.
  const pick = (s: ShareStyle) => { setPicking(false); if (Platform.OS === 'ios') setTimeout(() => go(s.url), 350); else go(s.url); };
  const sheet = picking && item?.shareStyles ? <ShareStyleSheet styles={item.shareStyles} onPick={pick} onClose={() => setPicking(false)} /> : null;
  return { share, copied, sheet };
}

/** "Share as": each look as the picture a link preview will show (the server's card, small), two to a row. */
function ShareStyleSheet({ styles: options, onPick, onClose }: { styles: ShareStyle[]; onPick: (s: ShareStyle) => void; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const t = useT();
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={s.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel={t('feedCard.close')} />
        <View style={[s.sheet, { paddingBottom: insets.bottom + space(4) }]} accessibilityViewIsModal>
          <View style={s.grab} />
          <View style={s.head}>
            <Text style={s.title} accessibilityRole="header">{t('share.as')}</Text>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button"><Text style={s.done}>{t('settings.cancel')}</Text></Pressable>
          </View>
          <ScrollView contentContainerStyle={s.grid} style={{ flexShrink: 1 }}>
            {options.map((o) => (
              <Pressable key={o.id} onPress={() => onPick(o)} style={({ pressed }) => [s.option, pressed && { opacity: 0.6 }]} accessibilityRole="button" accessibilityLabel={`${t('share.as')} ${o.label}`}>
                <Image source={{ uri: o.image }} style={s.thumb} contentFit="cover" transition={150} />
                <Text style={s.label}>{o.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: { maxHeight: '85%', backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderTopWidth: 1, borderColor: colors.border, paddingHorizontal: space(4), paddingTop: space(2) },
  grab: { alignSelf: 'center', width: 36, height: 5, borderRadius: 3, backgroundColor: colors.border, marginBottom: space(3) },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space(3) },
  title: { color: colors.text, fontSize: 17, fontWeight: '800' },
  done: { color: colors.hate, fontSize: 15, fontWeight: '800' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space(3), paddingBottom: space(2) },
  option: { width: '48%', gap: space(1.5) },
  thumb: { width: '100%', aspectRatio: 1200 / 630, borderRadius: radius.md, backgroundColor: colors.surfaceHi },
  label: { color: colors.text, fontSize: 13, fontWeight: '800', textAlign: 'center' },
});
