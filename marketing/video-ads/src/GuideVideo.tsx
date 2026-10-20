// Guide video (50 s, 1080x1920): the app's ten-page startup guide (docs/startup-guide.md, app/src/app/guide.tsx) as a video.
// One scene per page, same order and wording, with the guide's own drawings of the controls redrawn here. Nothing is a live screen.
import React from 'react';
import {AbsoluteFill, Sequence, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import {AlertCard, AlertData, Bg, C, Count, EndCard, Eye, FONT, LEAGUE, LeagueTag, TeamBadge, useProgress, useSpring} from './theme';

const STEP = 140; // frames per scene
const SCENE = 146; // a scene runs a little past its slot so it can fade under the next one
const GOLD = C.gold;

/** Page label, big title, and the guide's sentence for the page. */
const Frame: React.FC<{n: number; where: string; line1: string; line2: string; text: string; children?: React.ReactNode}> = ({n, where, line1, line2, text, children}) => {
  const {durationInFrames} = useVideoConfig();
  const frame = useCurrentFrame();
  const t = useSpring(2);
  const b = useSpring(10);
  const out = interpolate(frame, [durationInFrames - 8, durationInFrames], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  return (
    <AbsoluteFill style={{fontFamily: FONT, opacity: out}}>
      <div style={{position: 'absolute', top: 130, left: 70, right: 70, opacity: t, transform: `translateY(${(1 - t) * 40}px)`}}>
        <div style={{fontSize: 34, fontWeight: 700, color: C.red, letterSpacing: 1}}>
          {String(n).padStart(2, '0')} <span style={{color: C.gray, fontWeight: 600}}>· {where}</span>
        </div>
        <div style={{fontSize: 100, fontWeight: 800, color: C.white, lineHeight: 1.02, letterSpacing: -3.2, marginTop: 14}}>{line1}</div>
        <div style={{fontSize: 100, fontWeight: 800, color: C.red, lineHeight: 1.02, letterSpacing: -3.2}}>{line2}</div>
      </div>
      {children}
      <div style={{position: 'absolute', bottom: 250, left: 70, right: 70, fontSize: 42, color: C.white, fontWeight: 500, lineHeight: 1.3, opacity: b, textAlign: 'center'}}>{text}</div>
    </AbsoluteFill>
  );
};

const Dots: React.FC = () => {
  const frame = useCurrentFrame();
  const cur = Math.min(9, Math.floor((frame + 12) / STEP));
  return (
    <div style={{position: 'absolute', bottom: 150, left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: 14}}>
      {Array.from({length: 10}, (_, i) => (
        <div key={i} style={{width: i === cur ? 48 : 16, height: 16, borderRadius: 8, background: i === cur ? C.red : C.line}} />
      ))}
    </div>
  );
};

const Toggle: React.FC<{on: number}> = ({on}) => (
  <div style={{width: 110, height: 62, borderRadius: 31, background: on > 0.5 ? C.red : '#3A3A42', position: 'relative', flexShrink: 0}}>
    <div style={{position: 'absolute', top: 6, left: 6 + on * 48, width: 50, height: 50, borderRadius: 25, background: '#fff'}} />
  </div>
);

const Bell: React.FC<{size?: number; color?: string; slash?: boolean}> = ({size = 44, color = C.white, slash}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    {slash && <path d="M3 3l18 18" />}
  </svg>
);

const Panel: React.FC<{style?: React.CSSProperties; children: React.ReactNode}> = ({style, children}) => (
  <div style={{position: 'absolute', left: 60, right: 60, background: C.card, border: `3px solid ${C.line}`, borderRadius: 38, ...style}}>{children}</div>
);

/** 1. Welcome */
const Welcome: React.FC = () => {
  const frame = useCurrentFrame();
  const e = useSpring(0, 12, 120);
  const t = useSpring(10);
  const s = useSpring(24);
  const blink = interpolate(frame, [50, 54, 58], [1, 0.05, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const out = interpolate(frame, [SCENE - 8, SCENE], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  return (
    <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', fontFamily: FONT, opacity: out}}>
      <div style={{transform: `scale(${e})`, opacity: e}}>
        <Eye size={380} id="welcome" open={blink} glow />
      </div>
      <div style={{fontSize: 52, color: C.red, fontWeight: 700, marginTop: 40, opacity: t, letterSpacing: 1}}>01 · THE GUIDE</div>
      <div style={{fontSize: 112, fontWeight: 800, color: C.white, textAlign: 'center', lineHeight: 1.02, letterSpacing: -3.6, marginTop: 14, opacity: t, transform: `translateY(${(1 - t) * 40}px)`}}>
        Welcome to
        <br />
        Hate <span style={{color: C.red}}>Watch</span>
      </div>
      <div style={{fontSize: 42, color: C.white, textAlign: 'center', width: 850, lineHeight: 1.3, marginTop: 40, opacity: s}}>
        Track the players and teams you can't stand, and know within seconds when something goes wrong for them.
      </div>
    </AbsoluteFill>
  );
};

/** 2. Search tab: type a name, tap Track */
const Pick: React.FC = () => {
  const frame = useCurrentFrame();
  const typed = 'Daniel Jones'.slice(0, Math.max(0, Math.floor((frame - 20) / 4)));
  const row = useSpring(62, 15, 150);
  const tapped = useProgress(96, 104);
  return (
    <Frame n={2} where="SEARCH TAB" line1="Pick who" line2="to hate." text="Type a player or team and tap Track. NBA, MLB, NFL, NHL, F1, Premier League and WNBA. Track as many as you like.">
      <Panel style={{top: 650, padding: '30px 38px', fontSize: 46, color: typed ? C.white : C.dim, display: 'flex', alignItems: 'center'}}>
        <span style={{marginRight: 20, color: C.gray}}>⌕</span>
        {typed || 'Search players and teams'}
        <span style={{width: 4, height: 52, background: C.red, marginLeft: 6, opacity: Math.floor(frame / 8) % 2}} />
      </Panel>
      <Panel style={{top: 810, padding: '28px 34px', display: 'flex', alignItems: 'center', gap: 28, opacity: row, transform: `translateY(${(1 - row) * 50}px)`, borderColor: tapped > 0.5 ? C.red : C.line}}>
        <TeamBadge code="DJ" color={LEAGUE.NFL} size={104} />
        <div style={{flex: 1}}>
          <div style={{fontSize: 46, fontWeight: 700, color: C.white}}>Daniel Jones</div>
          <div style={{fontSize: 29, color: C.gray, marginTop: 4}}>Player · NFL</div>
        </div>
        <div style={{background: tapped > 0.5 ? C.red : C.card2, color: '#fff', fontSize: 32, fontWeight: 700, padding: '18px 36px', borderRadius: 100, transform: `scale(${1 + Math.sin(tapped * Math.PI) * 0.15})`}}>
          {tapped > 0.5 ? 'Tracking' : 'Track'}
        </div>
      </Panel>
    </Frame>
  );
};

/** 3. Feed tab */
const FEED: AlertData[] = [
  {league: 'MLB', code: 'TB', color: '#092C5C', title: 'Rays blow a 2-0 lead at home in ALCS Game 1', body: 'Guardians win 7-3', tag: 'Rays', time: 'Oct 12', haters: 23},
  {league: 'CFB', code: 'TEX', color: '#BF5700', title: 'Texas loses at No. 1 after two Manning picks', body: 'Oklahoma wins 27-24 on a field goal', tag: 'Texas', time: 'Oct 10', haters: 23},
];
const Feed: React.FC = () => {
  const a = useSpring(14, 14, 140);
  const b = useSpring(34, 14, 140);
  const share = useSpring(64);
  return (
    <Frame n={3} where="FEED TAB" line1="Every bad moment," line2="live." text="Alerts land newest first and arrive as notifications. A Successful Hate Watch shows how many other hate watchers got it. Tap share to send one to a friend.">
      <div style={{position: 'absolute', top: 640, left: 60, opacity: a, transform: `translateY(${(1 - a) * 80}px)`}}>
        <AlertCard a={FEED[0]} countStart={30} hot />
      </div>
      <div style={{position: 'absolute', top: 920, left: 60, opacity: b, transform: `translateY(${(1 - b) * 80}px)`}}>
        <AlertCard a={FEED[1]} countStart={50} />
      </div>
      <div style={{position: 'absolute', top: 1230, left: 0, right: 0, display: 'flex', justifyContent: 'center', opacity: share, transform: `scale(${0.8 + share * 0.2})`}}>
        <div style={{background: C.card, border: `3px solid ${C.line}`, borderRadius: 100, padding: '22px 46px', fontSize: 40, fontWeight: 700, color: C.white}}>Share ↗</div>
      </div>
    </Frame>
  );
};

/** 4. Scores tab */
const Scores: React.FC = () => {
  const p = useSpring(12, 14, 140);
  const bar = useProgress(34, 70);
  const fin = useSpring(48, 14, 140);
  return (
    <Frame n={4} where="SCORES TAB" line1="Every game," line2="live." text="The score, how badly it's going for them, who has the ball or who's pitching, and the chance they lose. Finals stay for a day. Tap one for the play-by-play.">
      <Panel style={{top: 650, padding: '34px 40px', opacity: p, transform: `translateY(${(1 - p) * 70}px)`, borderColor: C.red}}>
        <div style={{display: 'flex', alignItems: 'center', gap: 16}}>
          <LeagueTag league="MLB" />
          <span style={{fontSize: 28, color: C.red, fontWeight: 700}}>● LIVE · Top 6</span>
        </div>
        {[{c: 'AWY', col: '#3A3A42', n: 'Away team', s: 2}, {c: 'HME', col: '#6B7780', n: 'Home team', s: 5}].map((t) => (
          <div key={t.c} style={{display: 'flex', alignItems: 'center', gap: 24, marginTop: 22}}>
            <TeamBadge code={t.c} color={t.col} size={84} />
            <div style={{fontSize: 44, fontWeight: 700, color: C.white, flex: 1}}>{t.n}</div>
            <div style={{fontSize: 70, fontWeight: 800, color: C.white}}>{t.s}</div>
          </div>
        ))}
        <div style={{marginTop: 28, fontSize: 28, color: C.gray, display: 'flex', justifyContent: 'space-between'}}>
          <span>Chance they lose</span>
          <span style={{color: C.red, fontWeight: 700}}>{Math.round(bar * 78)}%</span>
        </div>
        <div style={{height: 18, borderRadius: 9, background: C.card2, marginTop: 10, overflow: 'hidden'}}>
          <div style={{width: `${bar * 78}%`, height: '100%', background: C.red, borderRadius: 9}} />
        </div>
      </Panel>
      <Panel style={{top: 1070, padding: '26px 40px', opacity: fin, transform: `translateY(${(1 - fin) * 60}px)`, display: 'flex', alignItems: 'center', gap: 20}}>
        <LeagueTag league="CFB" />
        <span style={{fontSize: 36, color: C.white, fontWeight: 600, flex: 1}}>Texas 24, Oklahoma 27</span>
        <span style={{fontSize: 28, color: C.gray}}>Final · stays a day</span>
      </Panel>
    </Frame>
  );
};

/** 5. Leaderboard */
const BOARD = [
  {code: 'DAL', color: '#003594', name: 'Dallas Cowboys', n: 52880},
  {code: 'LAD', color: '#005A9C', name: 'Los Angeles Dodgers', n: 48213},
  {code: 'NYY', color: '#0C2340', name: 'New York Yankees', n: 41975},
];
const Board: React.FC = () => {
  const tabs = useSpring(8);
  return (
    <Frame n={5} where="TOP LEFT OF EVERY TAB" line1="See who's" line2="most hated." text="The leaderboard ranks athletes and teams by how many people hate them, filtered like the feed. Drivers in F1, fighters in the UFC.">
      <div style={{position: 'absolute', top: 640, left: 60, right: 60, display: 'flex', gap: 16, opacity: tabs}}>
        {['Athletes', 'Teams'].map((t, i) => (
          <div key={t} style={{background: i === 1 ? C.red : C.card, border: `3px solid ${i === 1 ? C.red : C.line}`, color: '#fff', fontSize: 34, fontWeight: 700, padding: '16px 40px', borderRadius: 100}}>{t}</div>
        ))}
      </div>
      {BOARD.map((r, i) => {
        const p = useSpring(24 + i * 14, 15, 150);
        return (
          <Panel key={r.name} style={{top: 760 + i * 190, padding: '26px 34px', display: 'flex', alignItems: 'center', gap: 26, opacity: p, transform: `translateX(${(1 - p) * 120}px)`}}>
            <div style={{fontSize: 56, fontWeight: 800, color: i === 0 ? C.red : C.dim, width: 54}}>{i + 1}</div>
            <TeamBadge code={r.code} color={r.color} size={100} />
            <div style={{fontSize: 42, fontWeight: 700, color: C.white, flex: 1}}>{r.name}</div>
            <div style={{textAlign: 'right'}}>
              <div style={{fontSize: 46, fontWeight: 800, color: C.red}}><Count to={r.n} start={30 + i * 14} dur={26} /></div>
              <div style={{fontSize: 24, color: C.gray}}>haters</div>
            </div>
          </Panel>
        );
      })}
    </Frame>
  );
};

/** 6. Alert settings */
const KINDS = ['Blown leads', 'Errors', 'Pulled early', 'Ejections'];
const Alerts: React.FC = () => (
  <Frame n={6} where="SETTINGS TAB" line1="Choose" line2="your alerts." text="Turn each kind of alert on or off for every league. The bell decides between a notification and the feed only.">
    <div style={{position: 'absolute', top: 640, left: 60, right: 60, display: 'flex', gap: 12, flexWrap: 'wrap'}}>
      {['NBA', 'MLB', 'NFL', 'NHL', 'F1', 'EPL', 'WNBA'].map((l) => (
        <LeagueTag key={l} league={l} size={30} />
      ))}
    </div>
    {KINDS.map((k, i) => {
      const p = useSpring(14 + i * 8, 15, 150);
      const on = useProgress(44 + i * 12, 52 + i * 12);
      const flipped = i === 3 ? 0 : on;
      return (
        <Panel key={k} style={{top: 740 + i * 150, padding: '22px 34px', display: 'flex', alignItems: 'center', gap: 24, opacity: p, transform: `translateX(${(1 - p) * 80}px)`}}>
          <div style={{fontSize: 42, color: C.white, fontWeight: 600, flex: 1}}>{k}</div>
          <Bell size={48} color={flipped > 0.5 ? C.white : C.dim} />
          <Toggle on={flipped} />
        </Panel>
      );
    })}
  </Frame>
);

/** 7. Counter */
const Score: React.FC = () => {
  const p = useSpring(12, 14, 140);
  const chips = useSpring(60);
  return (
    <Frame n={7} where="SETTINGS TAB" line1="Keep" line2="score." text="The Successful Hate Watch counter at the top of Settings counts every time a team you track loses, or the team of a player you track. Tap +3 more to see every team.">
      <div style={{position: 'absolute', top: 700, left: 60, right: 60, textAlign: 'center', opacity: p, transform: `scale(${0.85 + p * 0.15})`}}>
        <div style={{fontSize: 34, color: C.gray, fontWeight: 600}}>Successful Hate Watches</div>
        <div style={{fontSize: 230, fontWeight: 800, color: C.white, letterSpacing: -8, lineHeight: 1.05}}>
          <Count to={1284} start={14} dur={40} />
        </div>
      </div>
      <div style={{position: 'absolute', top: 1060, left: 60, right: 60, display: 'flex', justifyContent: 'center', gap: 18, flexWrap: 'wrap', opacity: chips, transform: `translateY(${(1 - chips) * 40}px)`}}>
        {[{c: 'TB', col: '#092C5C'}, {c: 'TEX', col: '#BF5700'}, {c: 'LSU', col: '#461D7C'}].map((t) => (
          <TeamBadge key={t.c} code={t.c} color={t.col} size={110} />
        ))}
        <div style={{height: 110, borderRadius: 55, background: C.card, border: `3px solid ${C.line}`, color: C.gray, fontSize: 34, fontWeight: 700, padding: '0 36px', display: 'flex', alignItems: 'center'}}>+3 more</div>
      </div>
    </Frame>
  );
};

/** 8. Tracking tab: one player's card, and what each control does */
const CONTROLS = [
  {label: 'Haters', text: '214 haters: how many people hate them, you included.'},
  {label: 'Most hated', text: 'The red X marks your most hated. With Plus, their alerts get a red border in the Feed.'},
  {label: 'Bell', text: 'The bell: no notifications about just them. Their alerts still reach the feed.'},
  {label: 'Gear', text: 'The gear: pick exactly which alerts you get about them. It beats the global settings.'},
  {label: 'Unfollow', text: 'Unfollow: stop tracking them entirely.'},
];
const Tune: React.FC = () => {
  const frame = useCurrentFrame();
  const p = useSpring(10, 14, 140);
  const cur = Math.min(CONTROLS.length - 1, Math.max(0, Math.floor((frame - 30) / 20)));
  const hot = (i: number) => (frame >= 30 ? cur === i : false);
  const ring = (i: number): React.CSSProperties => ({boxShadow: hot(i) ? `0 0 0 5px ${C.red}, 0 0 40px ${C.red}88` : 'none'});
  const btn: React.CSSProperties = {width: 110, height: 110, borderRadius: 55, background: C.card2, display: 'flex', alignItems: 'center', justifyContent: 'center'};
  return (
    <Frame n={8} where="TRACKING TAB" line1="Fine-tune one" line2="player or team." text={CONTROLS[frame < 30 ? 0 : cur].text}>
      <div style={{position: 'absolute', top: 640, left: 60, width: 960, opacity: p, transform: `translateY(${(1 - p) * 70}px)`}}>
        <div style={{height: 230, borderRadius: '38px 38px 0 0', background: 'linear-gradient(135deg,#1D4E9E,#0F2A5A)', padding: '30px 38px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start'}}>
          <LeagueTag league="NFL" size={30} />
          <div style={{background: 'rgba(0,0,0,.4)', color: '#fff', fontSize: 32, fontWeight: 700, padding: '10px 26px', borderRadius: 100, ...ring(0)}}>214 haters</div>
        </div>
        <div style={{background: C.card, border: `3px solid ${C.line}`, borderTop: 'none', borderRadius: '0 0 38px 38px', padding: '0 38px 36px'}}>
          <div style={{marginTop: -80}}>
            <TeamBadge code="DJ" color="#1D4E9E" size={160} />
          </div>
          <div style={{fontSize: 58, fontWeight: 800, color: C.white, marginTop: 18}}>Daniel Jones</div>
          <div style={{display: 'flex', gap: 22, alignItems: 'center', marginTop: 28}}>
            <div style={{...btn, background: C.red, ...ring(1)}}><span style={{color: '#fff', fontSize: 54, fontWeight: 800}}>✕</span></div>
            <div style={{...btn, ...ring(2)}}><Bell /></div>
            <div style={{...btn, ...ring(3)}}><span style={{color: C.white, fontSize: 54}}>⚙</span></div>
            <div style={{flex: 1, height: 110, borderRadius: 55, background: C.card2, color: C.white, fontSize: 38, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', ...ring(4)}}>Unfollow</div>
          </div>
        </div>
      </div>
    </Frame>
  );
};

/** 9. Hate Watch Plus */
const EXTRAS = [
  {t: 'Gold accents', s: 'The app in gold'},
  {t: 'Gold app icon', s: 'On your home screen'},
  {t: 'Most hated', s: 'Red X on Tracking, red border in the Feed and on Scores'},
  {t: 'Favorite teams', s: 'Heart on Search, gold border on their games'},
];
const Plus: React.FC = () => {
  const p = useSpring(10, 14, 140);
  return (
    <Frame n={9} where="SETTINGS TAB" line1="Hate Watch" line2="Plus." text="A monthly subscription that keeps the servers running and the app ad free. The store shows the price.">
      <div style={{position: 'absolute', top: 640, left: 60, right: 60, borderRadius: 40, border: `4px solid ${GOLD}`, background: C.card, padding: '30px 38px', boxShadow: `0 0 80px ${GOLD}33`, opacity: p, transform: `translateY(${(1 - p) * 70}px)`}}>
        <div style={{fontSize: 40, fontWeight: 800, color: GOLD, marginBottom: 8}}>Support Hate Watch</div>
        {EXTRAS.map((x, i) => {
          const r = useSpring(26 + i * 12, 15, 150);
          return (
            <div key={x.t} style={{display: 'flex', alignItems: 'center', gap: 24, marginTop: 24, opacity: r, transform: `translateX(${(1 - r) * 80}px)`}}>
              <div style={{width: 58, height: 58, borderRadius: 29, background: GOLD, color: C.bg, fontSize: 36, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0}}>✓</div>
              <div>
                <div style={{fontSize: 42, fontWeight: 700, color: C.white}}>{x.t}</div>
                <div style={{fontSize: 27, color: C.gray, marginTop: 2}}>{x.s}</div>
              </div>
            </div>
          );
        })}
      </div>
    </Frame>
  );
};

/** 10. All set */
const AllSet: React.FC = () => {
  const frame = useCurrentFrame();
  const e = useSpring(0, 12, 120);
  const t = useSpring(8);
  const btn = useSpring(26);
  const pulse = 1 + Math.sin(frame / 6) * 0.02;
  const out = interpolate(frame, [SCENE - 8, SCENE], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  return (
    <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', fontFamily: FONT, opacity: out}}>
      <div style={{transform: `scale(${e})`, opacity: e}}>
        <Eye size={300} id="allset" glow />
      </div>
      <div style={{fontSize: 36, color: C.red, fontWeight: 700, marginTop: 36, opacity: t}}>10 · LAST PAGE</div>
      <div style={{fontSize: 120, fontWeight: 800, color: C.white, letterSpacing: -4, marginTop: 8, opacity: t, transform: `translateY(${(1 - t) * 40}px)`}}>
        You're <span style={{color: C.red}}>all set.</span>
      </div>
      <div style={{fontSize: 40, color: C.white, textAlign: 'center', width: 850, lineHeight: 1.3, marginTop: 28, opacity: t}}>
        Watch this guide again any time from Settings. Allow notifications so alerts reach you even when the app is closed.
      </div>
      <div style={{marginTop: 60, background: C.red, color: '#fff', fontSize: 46, fontWeight: 800, padding: '30px 80px', borderRadius: 100, opacity: btn, transform: `scale(${(0.85 + btn * 0.15) * pulse})`}}>
        Find someone to hate
      </div>
    </AbsoluteFill>
  );
};

const SCENES: React.FC[] = [Welcome, Pick, Feed, Scores, Board, Alerts, Score, Tune, Plus, AllSet];

export const GUIDE_FRAMES = 9 * STEP + SCENE + 108;
export const GuideVideo: React.FC = () => (
  <AbsoluteFill>
    <Bg />
    {SCENES.map((S, i) => (
      <Sequence key={i} from={i * STEP} durationInFrames={SCENE}>
        <S />
      </Sequence>
    ))}
    <Sequence from={0} durationInFrames={9 * STEP + SCENE - 4}>
      <Dots />
    </Sequence>
    <Sequence from={9 * STEP + SCENE - 6} durationInFrames={114}>
      <EndCard line="Find someone to hate." />
    </Sequence>
  </AbsoluteFill>
);
