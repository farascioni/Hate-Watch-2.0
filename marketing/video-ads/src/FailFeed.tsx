// Ad 1, "Fail Feed" (15 s, 1080x1920): a hook, then alerts from six leagues slam into the feed with their hater counts
// climbing, a Successful Hate Watch counter ticking up, and the end card. Real teams and players, real 2026 results (text only, no logos or photos).
import React from 'react';
import {AbsoluteFill, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {AlertCard, AlertData, Bg, C, EndCard, Eye, FONT, LEAGUE, useProgress, useSpring} from './theme';

const ALERTS: AlertData[] = [
  {league: 'MLB', code: 'LAD', color: '#005A9C', title: 'Dodgers swept out of the NLCS, three-peat over', body: 'Dodgers vs Brewers · NLCS Game 4, 6-4', tag: 'Dodgers', time: 'Oct 15', haters: 41306},
  {league: 'NBA', code: 'SAS', color: '#6B7780', title: 'Spurs blow a 29-point halftime lead in the Finals', body: 'Spurs vs Knicks · Knicks win the Finals 4-1', tag: 'Spurs', time: 'Jun 2026', haters: 29874},
  {league: 'NFL', code: 'SEA', color: '#0A3A78', title: 'Seahawks lose in OT after two Darnold picks', body: 'Seahawks vs Broncos · Broncos win 17-14', tag: 'Seahawks', time: 'Oct 15', haters: 36512},
  {league: 'NHL', code: 'PIT', color: '#B8860B', title: 'Penguins blow a 5-1 lead to the Canadiens', body: 'Penguins vs Canadiens · 6-5 in OT', tag: 'Penguins', time: 'Oct 3', haters: 11940},
  {league: 'EPL', code: 'MUN', color: '#DA291C', title: 'Manchester United held 1-1 at Leeds', body: 'Leeds vs Man United · Premier League', tag: 'Man United', time: 'Oct 18', haters: 22975},
  {league: 'F1', code: 'MER', color: '#00A39B', title: 'Russell crashes out of the Sprint lead on lap 1', body: 'Mercedes · Singapore Grand Prix Sprint', tag: 'Russell', time: 'Oct 2026', haters: 17610},
];

const FIRST = 78; // frame of the first card
const GAP = 46; // frames between cards
const START = (i: number) => FIRST + i * GAP;

const Slot: React.FC<{i: number}> = ({i}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const at = (delay: number) => spring({frame: frame - delay, fps, config: {damping: 14, stiffness: 150, mass: 0.8}});
  const p = at(START(i));
  // How far the cards after this one have pushed it up the screen.
  const shift = ALERTS.slice(i + 1).reduce((s, _, k) => s + Math.min(Math.max(at(START(i + 1 + k)), 0), 1), 0);
  const y = 1130 - shift * 300 + (1 - p) * 700;
  const fade = interpolate(shift, [2.3, 3.0], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const scale = 1 - Math.min(shift, 3) * 0.03;
  const shake = frame - START(i) > 0 && frame - START(i) < 8 ? Math.sin(frame * 3) * 6 : 0;
  return (
    <div style={{position: 'absolute', top: y, left: 60 + shake, opacity: p * fade, transform: `scale(${scale})`, transformOrigin: 'top center'}}>
      <AlertCard a={ALERTS[i]} countStart={START(i) + 6} hot={shift < 0.5} />
    </div>
  );
};

const Hook: React.FC = () => {
  const frame = useCurrentFrame();
  const t = useSpring(4);
  const out = interpolate(frame, [52, 74], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const blink = interpolate(frame, [26, 30, 34], [1, 0.05, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  return (
    <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', opacity: out, fontFamily: FONT}}>
      <Eye size={300} id="hook" open={blink} glow />
      <div style={{fontSize: 108, fontWeight: 800, color: C.white, textAlign: 'center', lineHeight: 1.02, letterSpacing: -3.5, marginTop: 60, transform: `scale(${0.85 + t * 0.15})`, opacity: t}}>
        Your rival
        <br />
        just <span style={{color: C.red}}>choked.</span>
      </div>
    </AbsoluteFill>
  );
};

const Header: React.FC = () => {
  const p = useProgress(FIRST - 16, FIRST + 6);
  const frame = useCurrentFrame();
  const watches = Math.max(0, Math.floor((frame - FIRST) / GAP) + 1);
  return (
    <AbsoluteFill style={{fontFamily: FONT, opacity: p}}>
      <div style={{position: 'absolute', top: 120, left: 60, right: 60, display: 'flex', alignItems: 'center', gap: 22}}>
        <Eye size={96} id="hdr" />
        <div style={{fontSize: 58, fontWeight: 800, color: C.white, letterSpacing: -2}}>
          Hate <span style={{color: C.red}}>Watch</span>
        </div>
        <div style={{marginLeft: 'auto', background: C.card, border: `2px solid ${C.line}`, borderRadius: 100, padding: '14px 30px', fontSize: 28, color: C.gray, fontWeight: 500}}>
          Successful Hate Watches <span style={{color: C.white, fontWeight: 700}}>{(1284 + watches).toLocaleString('en-US')}</span>
        </div>
      </div>
      <div style={{position: 'absolute', top: 250, left: 60, fontSize: 34, color: C.gray, fontWeight: 500}}>
        <span style={{color: C.red, fontWeight: 700}}>RECENT</span> · alerts from 9 leagues
      </div>
    </AbsoluteFill>
  );
};

const Caption: React.FC = () => {
  const frame = useCurrentFrame();
  const lines = [
    {t: 'MLB. NBA. NFL. NHL. EPL. F1.', from: FIRST + 20},
    {t: 'See the exact second it goes wrong.', from: START(3)},
  ];
  const cur = [...lines].reverse().find((l) => frame >= l.from);
  const a = cur ? Math.min(1, (frame - cur.from) / 10) : 0;
  return (
    <div style={{position: 'absolute', bottom: 420, left: 0, right: 0, textAlign: 'center', fontFamily: FONT, fontSize: 52, fontWeight: 700, color: C.white, opacity: a, letterSpacing: -1}}>
      {cur?.t}
    </div>
  );
};

export const FailFeed: React.FC = () => (
  <AbsoluteFill>
    <Bg />
    <Sequence from={0} durationInFrames={80}>
      <Hook />
    </Sequence>
    <Sequence from={0} durationInFrames={350}>
      <Header />
      {ALERTS.map((_, i) => (
        <Slot key={i} i={i} />
      ))}
      <Caption />
    </Sequence>
    <Sequence from={348} durationInFrames={102}>
      <EndCard line="Alerts for every player and team you can't stand." />
    </Sequence>
  </AbsoluteFill>
);

export const FAIL_FEED_FRAMES = 450;
