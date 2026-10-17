import { HStack, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import { font, foregroundStyle, padding } from '@expo/ui/swift-ui/modifiers';
import { createLiveActivity } from 'expo-widgets';

/**
 * The lock screen scoreboard (lib/liveScoreboard.ts, docs/live-activity.md): one line per game, favorites first, then most
 * hated, then tracked. The server builds the props (server/src/live-activity.ts BoardProps) and pushes them to Apple, so
 * this only draws them. Runs in the widget extension's own runtime: no hooks, no imports of ours, nothing declared outside
 * the function. This code is baked into each build (it can't be updated over the air), so it draws what the server wrote
 * (`l`, `r`, `lc`, `rc`, `mt`: text and colors, changed by a server deploy) and falls back to its own wording when a field is
 * missing. Every region is defined here for the same reason. Props only ever gain fields (`v`).
 */
type Game = { k: string; a: string; as: number | null; h: string; hs: number | null; st: string; live: boolean; t: 0 | 1 | 2; l?: string; r?: string; lc?: string; rc?: string };
type Props = { v?: number; games: Game[]; more: number; mt?: string };

const ScoreboardActivity = (props: Props) => {
  'widget';
  const mark = (t: number) => (t === 0 ? '♥ ' : t === 1 ? '★ ' : '');
  const score = (n: number | null) => (n === null ? '-' : String(n));
  const row = (g: Game) => (
    <HStack key={g.k}>
      <Text modifiers={[font({ size: 15, weight: 'semibold' }), foregroundStyle(g.lc ?? (g.t === 2 ? '#FFFFFF' : '#F5C451'))]}>
        {g.l ?? `${mark(g.t)}${g.a} ${score(g.as)}  ${g.h} ${score(g.hs)}`}
      </Text>
      <Spacer />
      <Text modifiers={[font({ size: 13 }), foregroundStyle(g.rc ?? (g.live ? '#E5232B' : '#9A9AA2'))]}>{g.r ?? g.st}</Text>
    </HStack>
  );
  const more = props.mt ?? (props.more > 0 ? `+${props.more} more` : '');
  const moreLine = more ? <Text modifiers={[font({ size: 12 }), foregroundStyle('#9A9AA2')]}>{more}</Text> : null;
  const lead = props.games[0];
  return {
    banner: (
      <VStack alignment="leading" spacing={4} modifiers={[padding({ all: 12 })]}>
        {props.games.map(row)}
        {moreLine}
      </VStack>
    ),
    // CarPlay and the watch: the top two games.
    bannerSmall: (
      <VStack alignment="leading" spacing={2} modifiers={[padding({ all: 8 })]}>
        {props.games.slice(0, 2).map(row)}
      </VStack>
    ),
    compactLeading: <Text>{lead ? lead.a : ''}</Text>,
    compactTrailing: <Text>{lead ? `${score(lead.as)}-${score(lead.hs)}` : ''}</Text>,
    minimal: <Text>{lead ? score(lead.as) : ''}</Text>,
    // Long-pressed Dynamic Island: the top game across the middle, the rest below.
    expandedCenter: lead ? row(lead) : <Text>{''}</Text>,
    expandedBottom: (
      <VStack alignment="leading" spacing={4}>
        {props.games.slice(1).map(row)}
        {moreLine}
      </VStack>
    ),
  };
};

export default createLiveActivity('ScoreboardActivity', ScoreboardActivity);
