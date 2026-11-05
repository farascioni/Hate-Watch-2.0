// The animated App Store search result video (app-store/search-animated/search-c.html) at Apple's 3:2 size, 3840x2560: the static search
// graphic's layout (app-store/build-store-images.mjs `search`). The last headline word rolls through fail, choke, fold, melt down, blow it,
// fail and the feed steps to one alert per word, each from a different sport. 12 s is one loop; the 7-card strip shows card 0 again at the
// end, so the last frame equals the first (Apple loops the video). The cards mirror CARDS in search-c.html.
import React from 'react';
import {AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame} from 'remotion';
import {C, FONT} from './theme';
import {WORDS, rollStep} from './HeaderPreview';

export const SEARCH_PREVIEW_FRAMES = 12 * 30;

const LINE = 260; // px between the two headline baselines
const PITCH = 438; // px from one alert to the next (11.4cqw of the HTML, rounded: a fractional pitch put the looped card 1px off frame 0)
const HEADLINE = 250;

type Card = {code: string; bg: string; fg: string; emoji: string; title: string; body: string; lg: string; kind: string; ago: string; also?: string};
const CARDS: Card[] = [
  {code: 'KC', bg: '#E31837', fg: '#fff', emoji: '🤦', title: 'Patrick Mahomes threw an interception', body: 'Picked off at the KC 38, 2:11 left.', lg: 'NFL', kind: 'Offense', ago: 'now'},
  {code: 'HOU', bg: '#CE1141', fg: '#fff', emoji: '😬', title: 'Rockets lost to the Pelicans as 77% favorites', body: 'Final: Pelicans 112, Rockets 104.', lg: 'NBA', kind: 'Final', ago: '2m ago', also: '4,812 hate watchers'},
  {code: 'UGA', bg: '#BA0C2F', fg: '#fff', emoji: '😱', title: 'No. 2 Georgia lost to unranked Vanderbilt', body: 'Final: Vanderbilt 31, Georgia 24.', lg: 'CFB', kind: 'Final', ago: '4m ago'},
  {code: 'COV', bg: '#5CBFEB', fg: '#0B0B0D', emoji: '🔥', title: 'Coventry were thrashed 5-0 by Brighton', body: 'Final Score: 5 to 0', lg: 'EPL', kind: 'Final', ago: '6m ago', also: '1,926 hate watchers'},
  {code: 'PHI', bg: '#E81828', fg: '#fff', emoji: '💥', title: 'Phillies closer blew the save in the 9th', body: '0.2 IP, 3 H, 2 ER · WSH 5, PHI 4', lg: 'MLB', kind: 'Pitching', ago: '9m ago'},
];
const FEED = [...CARDS, CARDS[0], CARDS[1]];

// Word widths in px at the headline size, measured once after Inter has loaded (theme.tsx holds the render until it has).
let widths: number[] | null = null;
const wordWidths = () => {
  if (!widths) {
    const ctx = document.createElement('canvas').getContext('2d')!;
    ctx.font = `700 ${HEADLINE}px Inter`;
    ctx.letterSpacing = `${-0.01 * HEADLINE}px`;
    widths = WORDS.map((w) => ctx.measureText(w).width);
  }
  return widths;
};

const AlertRow: React.FC<{c: Card}> = ({c}) => (
  <div style={{display: 'flex', gap: 50, height: PITCH - 23, marginBottom: 23, padding: 50, boxSizing: 'border-box', border: '3.84px solid #26262c', borderRadius: 65, background: '#141417', overflow: 'hidden'}}>
    <div style={{position: 'relative', flex: 'none', width: 196, height: 196, borderRadius: '50%', background: c.bg, color: c.fg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 59.5}}>
      {c.code}
      <div style={{position: 'absolute', right: -23, bottom: -23, width: 84, height: 84, borderRadius: '50%', background: '#141417', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 50}}>{c.emoji}</div>
    </div>
    <div style={{minWidth: 0, flex: 1}}>
      <div style={{fontWeight: 700, fontSize: 62.2, lineHeight: '76.8px'}}>{c.title}</div>
      <div style={{marginTop: 11.5, fontWeight: 500, fontSize: 49, lineHeight: '65px', color: '#9a9aa2'}}>{c.body}</div>
      <div style={{display: 'flex', alignItems: 'center', gap: 27, marginTop: 27, fontWeight: 500, fontSize: 44, lineHeight: '57.6px', color: '#9a9aa2', whiteSpace: 'nowrap'}}>
        <span style={{fontWeight: 700, fontSize: 40, lineHeight: '53.8px', padding: '0 23px', borderRadius: 19, background: C.red, color: '#fff'}}>{c.lg}</span>
        <span>{c.kind}</span>
        <span>· {c.ago}</span>
        {c.also && <span style={{fontWeight: 700, fontSize: 40, lineHeight: '53.8px', padding: '0 27px', borderRadius: 31, background: '#12331f', color: '#4ade80'}}>{c.also}</span>}
      </div>
    </div>
  </div>
);

export const SearchPreview: React.FC = () => {
  const step = rollStep(useCurrentFrame());
  const w = interpolate(step, WORDS.map((_, i) => i), wordWidths());
  const text = {fontFamily: FONT, fontWeight: 700, color: C.white, letterSpacing: '-0.01em', whiteSpace: 'nowrap'} as const;
  return (
    <AbsoluteFill style={{background: `radial-gradient(70% 70% at 50% 50%, #3B0D12 0, #170A0C 55%, ${C.bg} 100%)`}}>
      <svg style={{position: 'absolute', left: 1697, top: 150, width: 445, height: 383}} viewBox="-360 -290 720 620">
        <clipPath id="eye"><path d="M -340 40 Q 0 -230 340 40 Q 0 310 -340 40 Z" /></clipPath>
        <path d="M -306.4 -256.7 L 272.8 -187.4 L 257.2 -92.6 L -313.6 -213.3 Z" fill={C.red} />
        <circle cx={-310} cy={-235} r={22} fill={C.red} />
        <circle cx={265} cy={-140} r={48} fill={C.red} />
        <path d="M -340 40 Q 0 -230 340 40 Q 0 310 -340 40 Z" fill={C.white} />
        <g clipPath="url(#eye)">
          <circle cx={0} cy={40} r={125} fill={C.red} />
          <circle cx={0} cy={40} r={125} fill="none" stroke={C.redDeep} strokeWidth={14} />
          <circle cx={0} cy={40} r={58} fill={C.bg} />
          <circle cx={36} cy={6} r={22} fill="#fff" opacity={0.92} />
        </g>
      </svg>
      <div style={{...text, position: 'absolute', left: 0, right: 0, top: 549, textAlign: 'center', fontSize: HEADLINE, lineHeight: `${LINE}px`}}>Know the second</div>
      <div style={{...text, position: 'absolute', left: 0, right: 0, top: 549 + LINE, fontSize: HEADLINE, lineHeight: `${LINE}px`, display: 'flex', justifyContent: 'center'}}>
        <span>your rivals&nbsp;</span>
        <span style={{display: 'inline-block', height: LINE, width: w, overflow: 'hidden', color: C.red}}>
          <span style={{display: 'block', transform: `translateY(${-step * LINE}px)`}}>
            {WORDS.map((word, i) => <span key={i} style={{display: 'block', height: LINE}}>{word}</span>)}
          </span>
        </span>
      </div>
      <div style={{position: 'absolute', left: 0, right: 0, top: 1144, textAlign: 'center', fontFamily: FONT, fontWeight: 500, fontSize: 92, lineHeight: '115px', color: '#9a9aa2', whiteSpace: 'nowrap'}}>
        Real-time alerts when the players and teams you can’t stand mess up
      </div>
      <div style={{position: 'absolute', left: 1190, top: 1390, width: 1300, height: 1190, boxSizing: 'border-box', border: '4.6px solid #2a2a30', borderRadius: '110px 110px 0 0', overflow: 'hidden', background: C.bg, fontFamily: FONT, color: C.white}}>
        <Img src={staticFile('search-header.jpg')} style={{display: 'block', width: '100%', height: 494, objectFit: 'cover', objectPosition: 'top'}} />
        <div style={{position: 'absolute', left: 0, right: 0, top: 494, bottom: 0, overflow: 'hidden'}}>
          <div style={{padding: '11.5px 46px 0', transform: `translateY(${-step * PITCH}px)`}}>
            {FEED.map((c, i) => <AlertRow key={i} c={c} />)}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
