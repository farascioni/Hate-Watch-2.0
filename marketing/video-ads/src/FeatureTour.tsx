// Ad 2, "Feature Tour" (22 s, 1080x1920): pick who you hate, get the alert the second it happens, tune it per player,
// watch the clip and see the other hate watchers, then the end card. Real teams and players, real 2026 results (text only, no logos or photos).
import React from 'react';
import {AbsoluteFill, Sequence, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import {AlertCard, AlertData, Bg, C, Count, EndCard, Eye, FONT, LEAGUE, LeagueTag, TeamBadge, useProgress, useSpring} from './theme';

const Title: React.FC<{n: string; line1: string; line2: string}> = ({n, line1, line2}) => {
  const p = useSpring(0, 14, 130);
  return (
    <div style={{position: 'absolute', top: 150, left: 70, right: 70, fontFamily: FONT, opacity: p, transform: `translateY(${(1 - p) * 40}px)`}}>
      <div style={{fontSize: 34, fontWeight: 700, color: C.red, letterSpacing: 2}}>{n}</div>
      <div style={{fontSize: 96, fontWeight: 800, color: C.white, lineHeight: 1.02, letterSpacing: -3.5, marginTop: 8}}>
        {line1}
        <br />
        <span style={{color: C.red}}>{line2}</span>
      </div>
    </div>
  );
};

/** Scene 1: search, type a name, track it. */
const Pick: React.FC = () => {
  const frame = useCurrentFrame();
  const typed = 'Dodgers'.slice(0, Math.max(0, Math.floor((frame - 18) / 4)));
  const rows = [
    {name: 'Los Angeles Dodgers', sub: 'Team · MLB', code: 'LAD', color: '#005A9C', league: 'MLB'},
    {name: 'Tyler Glasnow', sub: 'Dodgers · MLB', code: 'LAD', color: '#005A9C', league: 'MLB'},
  ];
  const tapped = useProgress(70, 78);
  return (
    <AbsoluteFill style={{fontFamily: FONT}}>
      <Title n="01" line1="Pick who" line2="you can't stand." />
      <div style={{position: 'absolute', top: 560, left: 60, right: 60}}>
        <div style={{background: C.card, border: `3px solid ${C.line}`, borderRadius: 30, padding: '30px 38px', fontSize: 44, color: typed ? C.white : C.dim, display: 'flex', alignItems: 'center'}}>
          <span style={{marginRight: 20, color: C.gray}}>⌕</span>
          {typed || 'Search players and teams'}
          <span style={{width: 4, height: 50, background: C.red, marginLeft: 6, opacity: Math.floor(frame / 8) % 2}} />
        </div>
        {rows.map((r, i) => {
          const p = useSpring(38 + i * 6, 15, 150);
          const on = i === 0 ? tapped : 0;
          return (
            <div key={i} style={{marginTop: 22, background: C.card, border: `3px solid ${on > 0.5 ? C.red : C.line}`, borderRadius: 30, padding: '26px 34px', display: 'flex', alignItems: 'center', gap: 28, opacity: p, transform: `translateY(${(1 - p) * 50}px)`}}>
              <TeamBadge code={r.code} color={r.color} size={96} />
              <div style={{flex: 1}}>
                <div style={{fontSize: 42, fontWeight: 700, color: C.white}}>{r.name}</div>
                <div style={{fontSize: 28, color: C.gray, marginTop: 4}}>{r.sub}</div>
              </div>
              <div style={{background: on > 0.5 ? C.red : C.card2, color: '#fff', fontSize: 30, fontWeight: 700, padding: '16px 34px', borderRadius: 100, transform: `scale(${1 + (i === 0 ? Math.sin(on * Math.PI) * 0.15 : 0)})`}}>
                {on > 0.5 ? 'Tracking' : 'Track'}
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

/** Scene 2: push notifications from every league land one after another. */
const PUSHES = [
  {league: 'MLB', color: LEAGUE.MLB, title: 'Dodgers swept out of the NLCS', body: 'Dodgers vs Brewers · NLCS Game 4, 6-4'},
  {league: 'NBA', color: LEAGUE.NBA, title: 'Spurs blow a 29-point halftime lead', body: 'Spurs vs Knicks · NBA Finals, Game 4'},
  {league: 'NFL', color: LEAGUE.NFL, title: 'Seahawks lose in OT, two Darnold picks', body: 'Seahawks vs Broncos · Broncos win 17-14'},
  {league: 'NHL', color: LEAGUE.NHL, title: 'Penguins blow a 5-1 lead to the Canadiens', body: 'Penguins vs Canadiens · 6-5 in OT'},
];
const Push: React.FC<{i: number}> = ({i}) => {
  const p = useSpring(10 + i * 22, 13, 160);
  const y = 600 + i * 215 + (1 - p) * -260;
  const tag = PUSHES[i];
  return (
    <div style={{position: 'absolute', top: y, left: 50, right: 50, opacity: Math.min(1, p * 1.4), background: 'rgba(36,36,42,.92)', border: `2px solid ${C.line}`, borderRadius: 44, padding: '28px 32px', display: 'flex', gap: 26, alignItems: 'center', boxShadow: '0 20px 60px rgba(0,0,0,.5)'}}>
      <div style={{width: 96, height: 96, borderRadius: 24, background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0}}>
        <Eye size={74} id={`push${i}`} />
      </div>
      <div style={{flex: 1, minWidth: 0}}>
        <div style={{display: 'flex', alignItems: 'center', gap: 14}}>
          <span style={{fontSize: 28, color: C.gray, fontWeight: 600}}>HATE WATCH</span>
          <LeagueTag league={tag.league} size={22} />
          <span style={{marginLeft: 'auto', fontSize: 26, color: C.dim}}>now</span>
        </div>
        <div style={{fontSize: 38, fontWeight: 700, color: C.white, marginTop: 8}}>{tag.title}</div>
        <div style={{fontSize: 28, color: C.gray, marginTop: 4}}>{tag.body}</div>
      </div>
    </div>
  );
};
const Alerts: React.FC = () => (
  <AbsoluteFill style={{fontFamily: FONT}}>
    <Title n="02" line1="Know the second" line2="it goes wrong." />
    {PUSHES.map((_, i) => (
      <Push key={i} i={i} />
    ))}
    <div style={{position: 'absolute', bottom: 150, left: 0, right: 0, textAlign: 'center', fontSize: 44, color: C.white, fontWeight: 600, opacity: useProgress(100, 112)}}>
      9 leagues. One feed.
    </div>
  </AbsoluteFill>
);

/** Scene 3: per-player alert settings, toggles flipping on. */
const Toggle: React.FC<{on: number}> = ({on}) => (
  <div style={{width: 120, height: 68, borderRadius: 34, background: on > 0.5 ? C.red : '#3A3A42', position: 'relative', flexShrink: 0}}>
    <div style={{position: 'absolute', top: 6, left: 6 + on * 52, width: 56, height: 56, borderRadius: 28, background: '#fff'}} />
  </div>
);
const SETTINGS = ['Home runs allowed', 'Walks', 'Pulled early', 'Ejected', 'Blown leads', 'Errors'];
const Tune: React.FC = () => (
  <AbsoluteFill style={{fontFamily: FONT}}>
    <Title n="03" line1="Choose exactly" line2="what you hate." />
    <div style={{position: 'absolute', top: 560, left: 60, right: 60}}>
      <div style={{display: 'flex', alignItems: 'center', gap: 24, marginBottom: 26}}>
        <TeamBadge code="LAD" color="#005A9C" size={90} />
        <div style={{fontSize: 46, fontWeight: 700, color: C.white}}>Tyler Glasnow</div>
        <LeagueTag league="MLB" />
      </div>
      {SETTINGS.map((s, i) => {
        const p = useSpring(14 + i * 7, 15, 150);
        const on = useProgress(40 + i * 12, 48 + i * 12);
        const flipped = i === 3 || i === 5 ? 0 : on; // two stay off: the point is that you choose
        return (
          <div key={s} style={{marginTop: 16, background: C.card, border: `3px solid ${C.line}`, borderRadius: 28, padding: '24px 34px', display: 'flex', alignItems: 'center', opacity: p, transform: `translateX(${(1 - p) * 80}px)`}}>
            <div style={{fontSize: 40, color: C.white, fontWeight: 600, flex: 1}}>{s}</div>
            <Toggle on={flipped} />
          </div>
        );
      })}
    </div>
  </AbsoluteFill>
);

/** Scene 4: a card with the clip button, the other hate watchers and the share button. */
const DEMO: AlertData = {league: 'MLB', code: 'LAD', color: '#005A9C', title: 'Dodgers blow a 4-0 lead in an elimination game', body: 'Dodgers vs Brewers · NLCS Game 4, 6-4', tag: 'Dodgers', time: 'Oct 15', haters: 48213};
const Watch: React.FC = () => {
  const frame = useCurrentFrame();
  const p = useSpring(8, 14, 140);
  const btn = useSpring(34, 12, 170);
  const pulse = 1 + Math.sin(frame / 5) * 0.02;
  const share = useSpring(52);
  return (
    <AbsoluteFill style={{fontFamily: FONT}}>
      <Title n="04" line1="Watch it." line2="Share the pain." />
      <div style={{position: 'absolute', top: 570, left: 60, opacity: p, transform: `translateY(${(1 - p) * 80}px)`}}>
        <AlertCard a={DEMO} countStart={52} hot />
      </div>
      <div style={{position: 'absolute', top: 1000, left: 60, right: 60, display: 'flex', gap: 24, opacity: btn, transform: `scale(${0.8 + btn * 0.2})`}}>
        <div style={{flex: 1, background: C.red, color: '#fff', fontSize: 44, fontWeight: 800, borderRadius: 100, textAlign: 'center', padding: '34px 0', transform: `scale(${pulse})`}}>▶ Watch it</div>
        <div style={{width: 200, background: C.card, border: `3px solid ${C.line}`, color: C.white, fontSize: 38, fontWeight: 700, borderRadius: 100, textAlign: 'center', padding: '34px 0', opacity: share}}>Share</div>
      </div>
      <div style={{position: 'absolute', top: 1220, left: 0, right: 0, textAlign: 'center', opacity: share}}>
        <div style={{fontSize: 150, fontWeight: 800, color: C.red, letterSpacing: -5}}>
          <Count to={48213} start={52} dur={22} />
        </div>
        <div style={{fontSize: 40, color: C.gray, fontWeight: 500}}>other hate watchers</div>
      </div>
    </AbsoluteFill>
  );
};

const Intro: React.FC = () => {
  const frame = useCurrentFrame();
  const t = useSpring(2);
  const blink = interpolate(frame, [20, 24, 28], [1, 0.05, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  return (
    <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', fontFamily: FONT}}>
      <Eye size={260} id="intro" open={blink} glow />
      <div style={{fontSize: 100, fontWeight: 800, color: C.white, textAlign: 'center', lineHeight: 1.03, letterSpacing: -3.2, marginTop: 50, opacity: t, transform: `scale(${0.88 + t * 0.12})`}}>
        Sports are better
        <br />
        when you <span style={{color: C.red}}>hate</span> someone.
      </div>
    </AbsoluteFill>
  );
};

/** Fades a scene out over its last 8 frames (a Sequence reports its own length). */
const Fade: React.FC<{children: React.ReactNode}> = ({children}) => {
  const frame = useCurrentFrame();
  const {durationInFrames} = useVideoConfig();
  const o = interpolate(frame, [durationInFrames - 8, durationInFrames], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  return <AbsoluteFill style={{opacity: o}}>{children}</AbsoluteFill>;
};

export const FEATURE_TOUR_FRAMES = 660;
export const FeatureTour: React.FC = () => (
  <AbsoluteFill>
    <Bg />
    <Sequence from={0} durationInFrames={78}>
      <Fade><Intro /></Fade>
    </Sequence>
    <Sequence from={72} durationInFrames={118}>
      <Fade><Pick /></Fade>
    </Sequence>
    <Sequence from={184} durationInFrames={130}>
      <Fade><Alerts /></Fade>
    </Sequence>
    <Sequence from={308} durationInFrames={118}>
      <Fade><Tune /></Fade>
    </Sequence>
    <Sequence from={420} durationInFrames={120}>
      <Fade><Watch /></Fade>
    </Sequence>
    <Sequence from={534} durationInFrames={126}>
      <EndCard line="The app for everyone you love to hate." />
    </Sequence>
  </AbsoluteFill>
);
