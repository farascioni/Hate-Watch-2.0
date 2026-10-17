import { Capsule, HStack, Image, Spacer, Text, VStack, ZStack } from '@expo/ui/swift-ui';
import { font, foregroundStyle, frame, offset, padding } from '@expo/ui/swift-ui/modifiers';
import { createLiveActivity } from 'expo-widgets';

/**
 * The lock screen scoreboard (lib/liveScoreboard.ts, docs/live-activity.md): one line per game, favorites first, then most
 * hated, then tracked. The server builds the props (server/src/live-activity.ts BoardProps) and pushes them to Apple, so
 * this only draws them. Runs in the widget extension's own runtime: no hooks, no imports of ours, nothing declared outside
 * the function. This code is baked into each build (it can't be updated over the air), so it draws what the server wrote
 * (`l`, `r`, `lc`, `rc`, `mt`: text and colors, changed by a server deploy) and falls back to its own wording when a field is
 * missing. Every region is defined here for the same reason. Props only ever gain fields (`v`).
 *
 * Two layouts, chosen per device in Settings and sent as `lay`: 0 (or missing) is the compact one above, one line a game; 1 is
 * the detailed one: a second line per game (`sub`, in `sc`), a base diamond from `bs` ("101": first, second, third) and a win
 * chance bar from `wp` (0-100) labelled `wl`, and a fuller long-pressed Dynamic Island. The compact layout draws exactly as it
 * did before `lay` existed.
 */
type Game = { k: string; a: string; as: number | null; h: string; hs: number | null; st: string; live: boolean; t: 0 | 1 | 2; l?: string; r?: string; lc?: string; rc?: string; sub?: string; sc?: string; bs?: string; wp?: number; wl?: string };
type Props = { v?: number; lay?: number; games: Game[]; more: number; mt?: string };

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
  // Detailed layout pieces. The diamond is three small diamonds placed like the bases; the bar is a track with a fill.
  const diamond = (bs: string) => (
    <ZStack modifiers={[frame({ width: 24, height: 16 })]}>
      <Image systemName={bs[1] === '1' ? 'diamond.fill' : 'diamond'} size={8} color={bs[1] === '1' ? '#F5C451' : '#6A6A72'} modifiers={[offset({ x: 0, y: -4 })]} />
      <Image systemName={bs[2] === '1' ? 'diamond.fill' : 'diamond'} size={8} color={bs[2] === '1' ? '#F5C451' : '#6A6A72'} modifiers={[offset({ x: -7, y: 3 })]} />
      <Image systemName={bs[0] === '1' ? 'diamond.fill' : 'diamond'} size={8} color={bs[0] === '1' ? '#F5C451' : '#6A6A72'} modifiers={[offset({ x: 7, y: 3 })]} />
    </ZStack>
  );
  const bar = (g: Game) =>
    g.wp === undefined ? null : (
      <HStack spacing={6}>
        <Text modifiers={[font({ size: 11 }), foregroundStyle('#9A9AA2')]}>{g.wl ?? ''}</Text>
        <ZStack alignment="leading" modifiers={[frame({ width: 56, height: 4 })]}>
          <Capsule modifiers={[frame({ width: 56, height: 4 }), foregroundStyle('#3A3A40')]} />
          <Capsule modifiers={[frame({ width: Math.max(2, Math.round((56 * g.wp) / 100)), height: 4 }), foregroundStyle(g.lc ?? '#F5C451')]} />
        </ZStack>
      </HStack>
    );
  const detailRow = (g: Game) => (
    <VStack key={g.k} alignment="leading" spacing={2}>
      <HStack>
        <Text modifiers={[font({ size: 15, weight: 'semibold' }), foregroundStyle(g.lc ?? (g.t === 2 ? '#FFFFFF' : '#F5C451'))]}>
          {g.l ?? `${mark(g.t)}${g.a} ${score(g.as)}  ${g.h} ${score(g.hs)}`}
        </Text>
        <Spacer />
        <Text modifiers={[font({ size: 13 }), foregroundStyle(g.rc ?? (g.live ? '#E5232B' : '#9A9AA2'))]}>{g.r ?? g.st}</Text>
      </HStack>
      <HStack spacing={6}>
        {g.bs ? diamond(g.bs) : null}
        <Text modifiers={[font({ size: 12 }), foregroundStyle(g.sc ?? '#9A9AA2')]}>{g.sub ?? ''}</Text>
        <Spacer />
        {bar(g)}
      </HStack>
    </VStack>
  );
  if (props.lay === 1) {
    return {
      banner: (
        <VStack alignment="leading" spacing={6} modifiers={[padding({ all: 12 })]}>
          {props.games.map(detailRow)}
          {moreLine}
        </VStack>
      ),
      bannerSmall: (
        <VStack alignment="leading" spacing={2} modifiers={[padding({ all: 8 })]}>
          {props.games.slice(0, 2).map(row)}
        </VStack>
      ),
      compactLeading: <Text>{lead ? lead.a : ''}</Text>,
      compactTrailing: <Text>{lead ? `${score(lead.as)}-${score(lead.hs)}` : ''}</Text>,
      minimal: <Text>{lead ? score(lead.as) : ''}</Text>,
      // Long-pressed Dynamic Island: the top game's scores either side, its clock and bases in the middle, its sub line and
      // win chance under them, then the other games as one-line rows.
      expandedLeading: <Text modifiers={[font({ size: 17, weight: 'semibold' })]}>{lead ? `${lead.a} ${score(lead.as)}` : ''}</Text>,
      expandedTrailing: <Text modifiers={[font({ size: 17, weight: 'semibold' })]}>{lead ? `${score(lead.hs)} ${lead.h}` : ''}</Text>,
      expandedCenter: lead ? (
        <VStack spacing={2}>
          <Text modifiers={[font({ size: 13 }), foregroundStyle(lead.rc ?? (lead.live ? '#E5232B' : '#9A9AA2'))]}>{lead.r ?? lead.st}</Text>
          {lead.bs ? diamond(lead.bs) : null}
        </VStack>
      ) : (
        <Text>{''}</Text>
      ),
      expandedBottom: (
        <VStack alignment="leading" spacing={4}>
          {lead ? (
            <HStack spacing={6}>
              <Text modifiers={[font({ size: 12 }), foregroundStyle(lead.sc ?? '#9A9AA2')]}>{lead.sub ?? ''}</Text>
              <Spacer />
              {bar(lead)}
            </HStack>
          ) : null}
          {props.games.slice(1).map(row)}
          {moreLine}
        </VStack>
      ),
    };
  }
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
