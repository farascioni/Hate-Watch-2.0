import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Chip } from './ui';
import { leagueColor, leagueUi, sportOf } from '../lib/leagueUi';
import { colors, radius, space } from '../theme';
import type { League, LeagueInfo } from '../lib/types';

/**
 * Every league, from the filter's More chip (FilterBar): yours first, then the rest under their sport ("Basketball",
 * "Combat sports"), sports in the order of their first league in the server's list, with a search by a league's
 * name, full name or sport. Picking one filters to it and closes; picking the one picked goes back to All.
 */
export function LeagueSheet({ open, onClose, leagues, yours, picked, onPick }: {
  open: boolean; onClose: () => void; leagues: LeagueInfo[]; yours: League[]; picked?: League; onPick: (league: League | undefined) => void;
}) {
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState('');
  const groups = useMemo(() => {
    const words = q.trim().toLowerCase();
    const match = (l: LeagueInfo) => !words || [l.name, leagueUi(l.id).fullName, sportOf(l)].some((w) => w?.toLowerCase().includes(words));
    const mine = new Set(yours);
    // Each sport where its first league is in the whole list (Football after Baseball, though the NFL is yours).
    const sports = new Map<string, LeagueInfo[]>(leagues.map((l) => [sportOf(l), []]));
    for (const l of leagues) if (!mine.has(l.id) && match(l)) sports.get(sportOf(l))!.push(l);
    const ofYours = leagues.filter((l) => mine.has(l.id) && match(l));
    return [...(ofYours.length ? [{ title: 'Yours', leagues: ofYours }] : []), ...[...sports].filter(([, list]) => list.length).map(([title, list]) => ({ title, leagues: list }))];
  }, [leagues, yours, q]);
  const close = () => { setQ(''); onClose(); };

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={close} statusBarTranslucent>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityRole="button" accessibilityLabel="Close the list of leagues" />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + space(4) }]} accessibilityViewIsModal>
          <View style={styles.grab} />
          <View style={styles.head}>
            <Text style={styles.title} accessibilityRole="header">All leagues</Text>
            <Pressable onPress={close} hitSlop={10} accessibilityRole="button"><Text style={styles.done}>Done</Text></Pressable>
          </View>
          <View style={styles.searchBox}>
            <Ionicons name="search" size={16} color={colors.textFaint} />
            <TextInput value={q} onChangeText={setQ} placeholder="Find a league" placeholderTextColor={colors.textFaint} style={styles.input}
              autoCorrect={false} autoCapitalize="none" returnKeyType="search" clearButtonMode="while-editing" accessibilityLabel="Find a league" />
          </View>
          {/* A tap on a league while the keyboard is up picks it (not just closing the keyboard). */}
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.groups} style={{ flexShrink: 1 }}>
            {groups.map((g) => (
              <View key={g.title} style={{ gap: space(1.5) }}>
                <Text style={styles.group}>{g.title}</Text>
                <View style={styles.chips}>
                  {g.leagues.map((l) => (
                    <Chip key={l.id} label={l.name} active={picked === l.id} color={leagueColor(l.id)}
                      onPress={() => { onPick(picked === l.id ? undefined : l.id); close(); }} />
                  ))}
                </View>
              </View>
            ))}
            {!groups.length ? <Text style={styles.none}>No league matches “{q.trim()}”.</Text> : null}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: { maxHeight: '85%', backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderTopWidth: 1, borderColor: colors.border, paddingHorizontal: space(4), paddingTop: space(2) },
  grab: { alignSelf: 'center', width: 36, height: 5, borderRadius: 3, backgroundColor: colors.border, marginBottom: space(3) },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space(3) },
  title: { color: colors.text, fontSize: 17, fontWeight: '800' },
  done: { color: colors.hate, fontSize: 15, fontWeight: '800' },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: space(2), paddingHorizontal: space(3), backgroundColor: colors.surfaceHi, borderRadius: radius.md, marginBottom: space(3) },
  input: { flex: 1, color: colors.text, fontSize: 15, paddingVertical: space(2.5), ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null) },
  groups: { gap: space(3), paddingBottom: space(2) },
  group: { color: colors.textFaint, fontSize: 11, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space(1.5) },
  none: { color: colors.textDim, fontSize: 14, paddingVertical: space(4), textAlign: 'center' },
});
