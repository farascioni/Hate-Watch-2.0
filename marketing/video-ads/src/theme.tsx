// Shared look for the Hate Watch ads: the app's colours and Inter, the eye mark, the feed's alert card and a count-up.
// Everything is drawn here (no team logos, no player photos): teams show as a coloured badge with their code, like the
// app's own fallback.
import React from 'react';
import {
  AbsoluteFill,
  Easing,
  continueRender,
  delayRender,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

export const C = {
  bg: '#0B0B0D', red: '#E5232B', redDeep: '#7A0D12', white: '#F4F4F5', card: '#17171B', card2: '#1F1F25',
  line: '#2A2A31', gray: '#A1A1AA', dim: '#71717A', green: '#22C55E', gold: '#F5B544',
};
export const LEAGUE: Record<string, string> = {
  NBA: '#C9082A', MLB: '#1D6FD8', NFL: '#2E7D32', NHL: '#8A93A0', F1: '#E10600', EPL: '#7B2FBE', UFC: '#D4A017',
  CFB: '#B45309', WNBA: '#E8590C',
};

const FONT_FILES = [['regular', 400], ['medium', 500], ['semibold', 600], ['bold', 700]] as const;
const fontsHandle = delayRender('Loading Inter');
Promise.all(
  FONT_FILES.map(([file, weight]) =>
    new FontFace('Inter', `url(${staticFile(`fonts/inter_${file}.ttf`)})`, {weight: String(weight)})
      .load()
      .then((f) => document.fonts.add(f)),
  ),
)
  .then(() => continueRender(fontsHandle))
  .catch((e) => {
    console.error(e);
    continueRender(fontsHandle);
  });

export const FONT = "Inter, -apple-system, 'Helvetica Neue', Arial, sans-serif";
export const pop = Easing.bezier(0.22, 1, 0.36, 1);

/** A spring that starts at `delay` frames and settles at 1. */
export const useSpring = (delay = 0, damping = 16, stiffness = 140) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  return spring({frame: frame - delay, fps, config: {damping, stiffness, mass: 0.8}});
};

/** 0 -> 1 between two frames, eased. */
export const useProgress = (from: number, to: number, easing: (t: number) => number = pop) => {
  const frame = useCurrentFrame();
  return interpolate(frame, [from, to], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing});
};

export const Bg: React.FC<{glow?: number}> = ({glow = 1}) => {
  const f = useCurrentFrame();
  const dx = Math.sin(f / 46) * 70;
  const dy = Math.cos(f / 61) * 90;
  return (
    <AbsoluteFill style={{background: C.bg}}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(1000px 1000px at ${540 + dx}px ${760 + dy}px, rgba(88,16,24,${0.95 * glow}) 0%, rgba(30,10,13,${glow}) 45%, ${C.bg} 78%)`,
        }}
      />
      <AbsoluteFill style={{background: 'radial-gradient(120% 90% at 50% 50%, transparent 52%, rgba(0,0,0,.6) 100%)'}} />
    </AbsoluteFill>
  );
};

const EYE = 'M -340 40 Q 0 -230 340 40 Q 0 310 -340 40 Z';
/** The app icon's eye. `open` 0..1 blinks it; `id` keeps the clip path unique when two are on screen. */
export const Eye: React.FC<{size: number; open?: number; id: string; glow?: boolean}> = ({size, open = 1, id, glow}) => (
  <svg width={size} height={(size * 600) / 720} viewBox="-360 -280 720 600" style={{overflow: 'visible', filter: glow ? `drop-shadow(0 0 40px ${C.red}99)` : undefined}}>
    <defs>
      <clipPath id={`eye-${id}`}>
        <path d={EYE} />
      </clipPath>
    </defs>
    <path d="M -306.4 -256.7 L 272.8 -187.4 L 257.2 -92.6 L -313.6 -213.3 Z" fill={C.red} />
    <circle cx={-310} cy={-235} r={22} fill={C.red} />
    <circle cx={265} cy={-140} r={48} fill={C.red} />
    <g transform={`translate(0 40) scale(1 ${Math.max(open, 0.04)}) translate(0 -40)`}>
      <path d={EYE} fill={C.white} />
      <g clipPath={`url(#eye-${id})`}>
        <circle cx={0} cy={40} r={125} fill={C.red} />
        <circle cx={0} cy={40} r={125} fill="none" stroke={C.redDeep} strokeWidth={14} />
        <circle cx={0} cy={40} r={58} fill={C.bg} />
        <circle cx={36} cy={6} r={22} fill="#fff" opacity={0.92} />
      </g>
    </g>
  </svg>
);

/** A number that counts up between two frames, with thousands separators. */
export const Count: React.FC<{to: number; start: number; dur: number; from?: number}> = ({to, start, dur, from = 0}) => {
  const frame = useCurrentFrame();
  const v = interpolate(frame, [start, start + dur], [from, to], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic),
  });
  return <>{Math.round(v).toLocaleString('en-US')}</>;
};

export const LeagueTag: React.FC<{league: string; size?: number}> = ({league, size = 26}) => (
  <span
    style={{
      background: LEAGUE[league] ?? C.red, color: '#fff', fontWeight: 700, fontSize: size, letterSpacing: 0.5,
      padding: `${size * 0.16}px ${size * 0.45}px`, borderRadius: size * 0.3, lineHeight: 1.1, display: 'inline-block',
    }}
  >
    {league}
  </span>
);

/** The app's fallback for a team: a badge in its colour with its code. */
export const TeamBadge: React.FC<{code: string; color: string; size?: number}> = ({code, color, size = 112}) => (
  <div
    style={{
      width: size, height: size, borderRadius: size / 2, background: color, border: `4px solid ${C.bg}55`,
      boxShadow: `0 0 0 4px ${color}55`, display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#fff', fontWeight: 800, fontSize: size * (code.length > 3 ? 0.26 : 0.32), letterSpacing: -0.5, flexShrink: 0,
    }}
  >
    {code}
  </div>
);

export type AlertData = {
  league: string; code: string; color: string; title: string; body: string; tag: string; haters: number; time?: string;
};

/** One feed card, as the app draws it, with the "other hate watchers" line the alert screen shows. */
export const AlertCard: React.FC<{a: AlertData; countStart: number; width?: number; hot?: boolean}> = ({a, countStart, width = 960, hot}) => (
  <div
    style={{
      width, background: C.card, borderRadius: 40, border: `3px solid ${hot ? C.red : C.line}`, padding: '34px 38px',
      boxShadow: hot ? `0 0 70px ${C.red}44` : '0 20px 60px rgba(0,0,0,.45)', fontFamily: FONT,
    }}
  >
    <div style={{display: 'flex', gap: 30, alignItems: 'center'}}>
      <TeamBadge code={a.code} color={a.color} size={116} />
      <div style={{flex: 1, minWidth: 0}}>
        <div style={{fontSize: 44, fontWeight: 700, color: C.white, lineHeight: 1.16, letterSpacing: -0.8}}>{a.title}</div>
        <div style={{fontSize: 29, color: C.gray, marginTop: 10, lineHeight: 1.3, fontWeight: 400}}>{a.body}</div>
      </div>
    </div>
    <div style={{display: 'flex', alignItems: 'center', gap: 14, marginTop: 24, paddingLeft: 146}}>
      <LeagueTag league={a.league} />
      <span style={{fontSize: 25, color: C.gray, fontWeight: 500, whiteSpace: 'nowrap'}}>{a.tag}</span>
      <span style={{fontSize: 25, color: C.dim, whiteSpace: 'nowrap'}}>· {a.time ?? 'just now'}</span>
      <span style={{marginLeft: 'auto', fontSize: 27, fontWeight: 700, color: C.red, whiteSpace: 'nowrap'}}>
        <Count to={a.haters} start={countStart} dur={22} />
        <span style={{color: C.gray, fontWeight: 500}}> other hate watchers</span>
      </span>
    </div>
  </div>
);

export const Fine: React.FC<{text: string}> = ({text}) => (
  <div style={{position: 'absolute', bottom: 70, left: 0, right: 0, textAlign: 'center', color: C.dim, fontFamily: FONT, fontSize: 24}}>
    {text}
  </div>
);

/** Closing frame shared by both ads: the eye, the name, the line, the download pills. */
export const EndCard: React.FC<{line: string; start?: number}> = ({line, start = 0}) => {
  const eye = useSpring(start, 12, 120);
  const t1 = useSpring(start + 8);
  const t2 = useSpring(start + 16);
  const t3 = useSpring(start + 26);
  const frame = useCurrentFrame();
  const pulse = 1 + Math.sin((frame - start) / 6) * 0.015;
  return (
    <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', fontFamily: FONT}}>
      <div style={{transform: `scale(${eye})`, opacity: eye}}>
        <Eye size={440} id="end" glow />
      </div>
      <div style={{fontSize: 120, fontWeight: 800, color: C.white, letterSpacing: -4, marginTop: 30, opacity: t1, transform: `translateY(${(1 - t1) * 40}px)`}}>
        Hate <span style={{color: C.red}}>Watch</span>
      </div>
      <div style={{fontSize: 44, color: C.gray, textAlign: 'center', width: 800, lineHeight: 1.3, marginTop: 18, opacity: t2, transform: `translateY(${(1 - t2) * 30}px)`}}>
        {line}
      </div>
      <div style={{display: 'flex', gap: 24, marginTop: 70, opacity: t3, transform: `translateY(${(1 - t3) * 30}px) scale(${pulse})`}}>
        {['App Store', 'Google Play'].map((s) => (
          <div key={s} style={{background: C.red, color: '#fff', fontWeight: 700, fontSize: 40, padding: '28px 54px', borderRadius: 100}}>{s}</div>
        ))}
      </div>
      <div style={{color: C.white, fontSize: 38, fontWeight: 600, marginTop: 34, opacity: t3}}>Free to download. Track who you can't stand.</div>
      <Fine text="Sample alerts based on 2026 results. Hater counts shown for illustration." />
    </AbsoluteFill>
  );
};
