// Ad 3, "Rough Week" (17 s, 1080x1920): one big alert at a time, each slamming in with its hater count climbing, across college
// football, MLB, the NHL and the UFC. Real 2026 results (text only, no logos or photos); none of these repeat Ads 1 and 2.
import React from 'react';
import {AbsoluteFill, Sequence, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import {AlertData, Bg, C, Count, EndCard, Eye, FONT, LeagueTag, TeamBadge, useProgress, useSpring} from './theme';

const ALERTS: AlertData[] = [
  {league: 'CFB', code: 'TEX', color: '#BF5700', title: 'Texas loses at No. 1 after two Manning picks', body: 'Oklahoma wins 27-24 on a game-ending 47-yard field goal', tag: 'Texas', time: 'Oct 10', haters: 38420},
  {league: 'MLB', code: 'TB', color: '#092C5C', title: 'Rays blow a 2-0 lead in ALCS Game 1', body: 'Guardians win 7-3', tag: 'Rays', time: 'Oct 12', haters: 19340},
  {league: 'UFC', code: 'TOP', color: '#8B1A1A', title: 'Topuria loses the lightweight title to Gaethje', body: 'Corner stops it after round 4 · UFC Freedom 250', tag: 'Topuria', time: 'Jun 14', haters: 33118},
  {league: 'CFB', code: 'LSU', color: '#461D7C', title: 'No. 10 LSU loses to Kentucky on an overtime 2-pointer', body: 'Kentucky wins 35-34 in OT', tag: 'LSU', time: 'Oct 10', haters: 27905},
  {league: 'NHL', code: 'MIN', color: '#154734', title: 'Wild lose in OT after Buffalo rallies from two goals down', body: 'Sabres win 3-2 on Owen Power\'s overtime goal', tag: 'Wild', time: 'Oct 6', haters: 14660},
  {league: 'UFC', code: 'CHI', color: '#3F4A5A', title: 'Chimaev\'s undefeated run ends against Strickland', body: 'Strickland wins by split decision · UFC 328', tag: 'Chimaev', time: 'May 9', haters: 25740},
];

const FIRST = 54;
const STEP = 58;
const at = (i: number) => FIRST + i * STEP;

const Hook: React.FC = () => {
  const frame = useCurrentFrame();
  const t = useSpring(4);
  const out = interpolate(frame, [38, 56], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const blink = interpolate(frame, [22, 26, 30], [1, 0.05, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  return (
    <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', opacity: out, fontFamily: FONT}}>
      <Eye size={280} id="hook3" open={blink} glow />
      <div style={{fontSize: 104, fontWeight: 800, color: C.white, textAlign: 'center', lineHeight: 1.03, letterSpacing: -3.4, marginTop: 56, transform: `scale(${0.85 + t * 0.15})`, opacity: t}}>
        Somebody else
        <br />
        had it <span style={{color: C.red}}>worse</span>.
      </div>
    </AbsoluteFill>
  );
};

/** One alert, full screen: badge, headline, and the count climbing. */
const Scene: React.FC<{a: AlertData}> = ({a}) => {
  const frame = useCurrentFrame();
  const {durationInFrames} = useVideoConfig();
  const p = useSpring(0, 13, 160);
  const out = interpolate(frame, [durationInFrames - 5, durationInFrames], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const shake = frame > 0 && frame < 8 ? Math.sin(frame * 3) * 7 : 0;
  return (
    <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', fontFamily: FONT, opacity: out * Math.min(1, p * 1.5)}}>
      <div style={{transform: `translateX(${shake}px) scale(${0.9 + p * 0.1})`, display: 'flex', flexDirection: 'column', alignItems: 'center', width: 940}}>
        <div style={{display: 'flex', alignItems: 'center', gap: 18, marginBottom: 34}}>
          <LeagueTag league={a.league} size={38} />
          <span style={{fontSize: 34, color: C.gray, fontWeight: 500}}>{a.tag} · {a.time}</span>
        </div>
        <TeamBadge code={a.code} color={a.color} size={210} />
        <div style={{fontSize: 80, fontWeight: 800, color: C.white, textAlign: 'center', lineHeight: 1.06, letterSpacing: -2.4, marginTop: 44}}>{a.title}</div>
        <div style={{fontSize: 34, color: C.gray, textAlign: 'center', marginTop: 22, lineHeight: 1.3}}>{a.body}</div>
        <div style={{marginTop: 54, textAlign: 'center'}}>
          <div style={{fontSize: 140, fontWeight: 800, color: C.red, letterSpacing: -4, lineHeight: 1}}>
            <Count to={a.haters} start={8} dur={24} />
          </div>
          <div style={{fontSize: 36, color: C.gray, fontWeight: 500, marginTop: 6}}>other hate watchers</div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

const Header: React.FC = () => {
  const frame = useCurrentFrame();
  const p = useProgress(FIRST - 10, FIRST + 4);
  const n = Math.max(0, Math.floor((frame - FIRST) / STEP) + 1);
  return (
    <AbsoluteFill style={{fontFamily: FONT, opacity: p}}>
      <div style={{position: 'absolute', top: 110, left: 60, right: 60, display: 'flex', alignItems: 'center', gap: 22}}>
        <Eye size={90} id="hdr3" />
        <div style={{fontSize: 54, fontWeight: 800, color: C.white, letterSpacing: -2}}>
          Hate <span style={{color: C.red}}>Watch</span>
        </div>
        <div style={{marginLeft: 'auto', background: C.card, border: `2px solid ${C.line}`, borderRadius: 100, padding: '14px 28px', fontSize: 27, color: C.gray, fontWeight: 500}}>
          Successful Hate Watches <span style={{color: C.white, fontWeight: 700}}>{(2410 + n).toLocaleString('en-US')}</span>
        </div>
      </div>
      <div style={{position: 'absolute', bottom: 150, left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: 16}}>
        {ALERTS.map((_, i) => (
          <div key={i} style={{width: i === n - 1 ? 54 : 18, height: 18, borderRadius: 9, background: i < n ? C.red : C.line}} />
        ))}
      </div>
    </AbsoluteFill>
  );
};

export const AD3_FRAMES = at(ALERTS.length) + 110;
export const Ad3: React.FC = () => (
  <AbsoluteFill>
    <Bg />
    <Sequence from={0} durationInFrames={60}>
      <Hook />
    </Sequence>
    <Sequence from={0} durationInFrames={at(ALERTS.length) + 4}>
      <Header />
    </Sequence>
    {ALERTS.map((a, i) => (
      <Sequence key={i} from={at(i)} durationInFrames={STEP}>
        <Scene a={a} />
      </Sequence>
    ))}
    <Sequence from={at(ALERTS.length) - 4} durationInFrames={114}>
      <EndCard line="Every league. Every loss. Every hater." />
    </Sequence>
  </AbsoluteFill>
);
