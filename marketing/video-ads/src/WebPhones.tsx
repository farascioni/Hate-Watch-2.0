// The landing page's phone screens (app/public/about/index.html), drawn like the app instead of screenshotted: the Feed with alerts
// arriving and a push on top, Search typing "Boston" and tracking the Celtics, a live game on Scores, the Tracking list, and one team's
// alert switches. Each is one phone screen at 700x1522 (the size of the simulator captures it replaces), a seamless loop, shown inside
// the page's CSS phone frame. Layout numbers come from the app captures (app/public/about/app-*.jpg). Nothing here comes from ESPN: no
// photos or logos, teams are the app's own badge (colour and code), and the Scores card leaves out the odds-based win-chance bar.
import React from 'react';
import {AbsoluteFill, Easing, interpolate, useCurrentFrame} from 'remotion';
import {C, FONT, LEAGUE, pop} from './theme';

export const WEB_W = 700;
export const WEB_H = 1522;
export const WEB_LOOP_FRAMES = 12 * 30;

const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
const ramp = (f: number, a: number, b: number, easing: (t: number) => number = pop) => interpolate(f, [a, b], [0, 1], {...clamp, easing});
const LINE = '#2a2a31';
const PANEL = '#141417';
const GRAY = '#9a9aa2';

// ---------- icons ----------
type IconProps = {size?: number; color?: string};
const Svg: React.FC<IconProps & {fill?: string; w?: number; children: React.ReactNode}> = ({size = 28, color = '#fff', fill = 'none', w = 2, children}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={color} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round">{children}</svg>
);
const IconStar = (p: IconProps) => <Svg {...p} color={p.color ?? GRAY}><path d="M12 2.8l2.8 6 6.5.8-4.8 4.5 1.3 6.5-5.8-3.3-5.8 3.3 1.3-6.5L2.7 9.6l6.5-.8z" /></Svg>;
const IconShare = (p: IconProps) => <Svg {...p} color={p.color ?? GRAY}><path d="M12 15V3M8 7l4-4 4 4M7 11H5v10h14V11h-2" /></Svg>;
const IconFlame = (p: IconProps) => <Svg {...p} fill={p.color ?? '#fff'} w={1}><path d="M12 2c1 4 6 6 6 12a6 6 0 0 1-12 0c0-3 2-4.500 3-7 1 1.200 1.400 2 2 2 1.200-2.600.400-4.800 1-7z" /></Svg>;
const IconTrophy = (p: IconProps) => <Svg {...p} w={2}><path d="M7 3h10v6a5 5 0 0 1-10 0zM7 5H3v2a4 4 0 0 0 4 4M17 5h4v2a4 4 0 0 1-4 4M12 14v4M8 21h8" /></Svg>;
const IconSearch = (p: IconProps) => <Svg {...p} w={2.400}><circle cx="11" cy="11" r="7" /><path d="M16.500 16.500L21 21" /></Svg>;
const IconEye = (p: IconProps) => <Svg {...p} w={2}><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" fill={p.color ?? '#fff'} /></Svg>;
const IconSliders = (p: IconProps) => <Svg {...p} w={1.800}><path d="M3 7h18M3 12h18M3 17h18" /><circle cx="15" cy="7" r="2.200" fill="#0B0B0D" /><circle cx="8" cy="12" r="2.200" fill="#0B0B0D" /><circle cx="14" cy="17" r="2.200" fill="#0B0B0D" /></Svg>;
const IconBell = ({muted, ...p}: IconProps & {muted?: boolean}) => (
  <Svg {...p} fill={p.color ?? '#fff'} w={1}>
    <path d="M12 3a6 6 0 0 0-6 6v4l-2 3h16l-2-3V9a6 6 0 0 0-6-6zM10 19a2 2 0 0 0 4 0z" />
    {muted && <path d="M4 3l17 17" stroke={p.color ?? '#fff'} strokeWidth={2.200} />}
  </Svg>
);
const IconGear = (p: IconProps) => (
  <Svg {...p} w={0}>
    <circle cx="12" cy="12" r="8.500" fill="none" stroke={p.color ?? '#fff'} strokeWidth={3.400} strokeDasharray="3.300 3.300" />
    <circle cx="12" cy="12" r="6.500" fill={p.color ?? '#fff'} />
    <circle cx="12" cy="12" r="2.600" fill="#17171B" />
  </Svg>
);
const IconHeart = (p: IconProps) => <Svg {...p} w={2}><path d="M12 21s-8-5-8-11a4.500 4.500 0 0 1 8-2.600A4.500 4.500 0 0 1 20 10c0 6-8 11-8 11z" /></Svg>;
const IconX = ({size = 28, color = '#7f1d1d'}: IconProps) => <Svg size={size} color={color} w={3.200}><path d="M5 5l14 14M19 5L5 19" /></Svg>;
const IconBack = (p: IconProps) => <Svg {...p} w={2.800}><path d="M15 5l-7 7 7 7" /></Svg>;
const IconBars = () => (
  <svg width={38} height={34} viewBox="0 0 38 34" fill="#fff">
    <rect x="0" y="12" width="10" height="22" rx="3" /><rect x="14" y="0" width="10" height="34" rx="3" /><rect x="28" y="8" width="10" height="26" rx="3" />
  </svg>
);

// ---------- shared screen furniture ----------
const abs = (left: number, top: number, extra: React.CSSProperties = {}): React.CSSProperties => ({position: 'absolute', left, top, ...extra});

const StatusBar: React.FC = () => (
  <>
    <div style={abs(268, 25, {width: 164, height: 63, borderRadius: 32, background: '#000'})} />
    <div style={abs(110, 36, {fontSize: 30, fontWeight: 600, color: '#fff', letterSpacing: -0.5})}>9:41</div>
    <svg style={abs(480, 44)} width={150} height={26} viewBox="0 0 150 26">
      <g fill="#fff"><rect x="0" y="16" width="6" height="8" rx="1.500" /><rect x="10" y="11" width="6" height="13" rx="1.500" /><rect x="20" y="6" width="6" height="18" rx="1.500" /><rect x="30" y="0" width="6" height="24" rx="1.500" /></g>
      <path d="M52 9a22 22 0 0 1 30 0M57 14.500a14 14 0 0 1 20 0M62 20a6 6 0 0 1 10 0" stroke="#fff" strokeWidth="3.600" fill="none" strokeLinecap="round" />
      <rect x="100" y="1" width="48" height="24" rx="7" fill="#30d158" />
      <path d="M126 4l-9 11h7l-2 7 9-11h-7z" fill="#0B0B0D" />
    </svg>
  </>
);

const Header: React.FC<{title?: string; right?: React.ReactNode; back?: string; backTitle?: string}> = ({title, right, back, backTitle}) => (
  <>
    {back ? (
      <>
        <div style={abs(28, 108, {width: 156, height: 76, borderRadius: 38, background: '#2a2a2e', display: 'flex', alignItems: 'center', gap: 6, paddingLeft: 12, boxSizing: 'border-box'})}>
          <IconBack size={34} /><span style={{fontSize: 28, fontWeight: 500, color: '#fff'}}>{back}</span>
        </div>
        <div style={abs(207, 128, {fontSize: 28, fontWeight: 700, color: '#fff'})}>{backTitle}</div>
      </>
    ) : (
      <>
        <div style={abs(32, 125)}><IconBars /></div>
        <div style={abs(0, 120, {width: WEB_W, textAlign: 'center', fontSize: 28, fontWeight: 700, color: '#fff', lineHeight: '44px', letterSpacing: -0.3})}>{title}</div>
      </>
    )}
    {right}
    <div style={abs(0, 176, {width: WEB_W, height: 1, background: '#1d1d22'})} />
  </>
);

const Live: React.FC = () => (
  <div style={abs(592, 130, {display: 'flex', alignItems: 'center', gap: 9, fontSize: 20, fontWeight: 800, letterSpacing: 2.500, color: C.green})}>
    <span style={{width: 13, height: 13, borderRadius: 7, background: C.green}} />LIVE
  </div>
);

const Segment: React.FC<{top: number; options: string[]; active: number}> = ({top, options, active}) => {
  const inner = (656 - 12) / options.length;
  return (
    <div style={abs(22, top, {width: 656, height: 70, borderRadius: 20, border: `2px solid ${LINE}`, background: PANEL, boxSizing: 'border-box'})}>
      <div style={abs(5 + active * inner, 5, {width: inner - 2, height: 56, borderRadius: 15, background: '#26262c'})} />
      {options.map((o, i) => (
        <div key={o} style={abs(5 + i * inner, 5, {width: inner, height: 56, lineHeight: '56px', textAlign: 'center', fontSize: 24, fontWeight: 600, color: i === active ? '#fff' : GRAY})}>{o}</div>
      ))}
    </div>
  );
};

const Chips: React.FC<{top: number; items: [string, number][]; active?: number}> = ({top, items, active = 0}) => {
  let x = 22;
  return (
    <>
      {items.map(([label, w], i) => {
        const left = x;
        x += w + 8;
        const on = i === active;
        return (
          <div key={label} style={abs(left, top, {width: w, height: 51, borderRadius: 26, boxSizing: 'border-box', textAlign: 'center', lineHeight: '47px', fontSize: 22, fontWeight: 600, background: on ? C.red : PANEL, border: `2px solid ${on ? C.red : LINE}`, color: on ? '#fff' : GRAY, whiteSpace: 'nowrap'})}>{label}</div>
        );
      })}
    </>
  );
};
const LEAGUE_CHIPS: [string, number][] = [['All', 110], ['NBA', 128], ['MLB', 128], ['NFL', 122], ['More', 136]];

const TABS: [string, React.FC<IconProps>][] = [['Feed', IconFlame], ['Scores', IconTrophy], ['Search', IconSearch], ['Tracking', IconEye], ['Settings', IconSliders]];
const TabBar: React.FC<{active: number}> = ({active}) => (
  <>
    <div style={abs(0, 1338, {width: WEB_W, height: WEB_H - 1338, background: C.bg})} />
    <div style={abs(30, 1356, {width: 640, height: 104, borderRadius: 52, border: `2px solid ${LINE}`, boxSizing: 'border-box', background: C.bg})} />
    <div style={abs(37 + active * 125.3, 1364, {width: 125, height: 88, borderRadius: 44, background: '#f4f4f5'})} />
    {TABS.map(([label, Icon], i) => {
      const on = i === active;
      return (
        <div key={label} style={abs(37 + i * 125.3, 1380, {width: 125, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4})}>
          <Icon size={34} color={on ? '#0B0B0D' : GRAY} />
          <span style={{fontSize: 19, fontWeight: 600, color: on ? '#0B0B0D' : GRAY}}>{label}</span>
        </div>
      );
    })}
  </>
);

/** Content is drawn first, then the status bar, header and tab bar on top so scrolling content slides under them like the app. */
const Shell: React.FC<{tab: number; children: React.ReactNode; header: React.ReactNode}> = ({tab, children, header}) => (
  <AbsoluteFill style={{background: C.bg, fontFamily: FONT, color: C.white, overflow: 'hidden'}}>
    {children}
    <div style={abs(0, 0, {width: WEB_W, height: 177, background: C.bg})} />
    <StatusBar />
    {header}
    <TabBar active={tab} />
  </AbsoluteFill>
);

/** The app's team badge: the team's colour with its code and a darker band along the bottom. */
const Badge: React.FC<{code: string; color: string; size: number; text?: string}> = ({code, color, size, text = '#fff'}) => (
  <div style={{width: size, height: size, borderRadius: size / 2, flex: 'none', background: `linear-gradient(to bottom, ${color} 74%, rgba(0,0,0,.28) 74%), ${color}`, boxShadow: `0 0 0 3px #0B0B0D, 0 0 0 5px ${color}66`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: text, fontWeight: 800, fontSize: size * (code.length > 3 ? 0.27 : 0.31), letterSpacing: 0.5}}>{code}</div>
);
/** A player: a jersey plate, number over team code. */
const Plate: React.FC<{num: string; code: string; color: string; size: number}> = ({num, code, color, size}) => (
  <div style={{width: size, height: size, borderRadius: size * 0.24, flex: 'none', background: color, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800}}>
    <span style={{fontSize: size * 0.5, lineHeight: 1}}>{num}</span><span style={{fontSize: size * 0.19, lineHeight: 1.3}}>{code}</span>
  </div>
);

const LeaguePill: React.FC<{league: string; size?: number}> = ({league, size = 17}) => (
  <span style={{background: LEAGUE[league] ?? C.red, color: '#fff', fontWeight: 800, fontSize: size, letterSpacing: 0.6, padding: '3px 11px', borderRadius: 8, lineHeight: 1.2}}>{league}</span>
);

const Caps: React.FC<{top: number; children: React.ReactNode}> = ({top, children}) => (
  <div style={abs(29, top, {fontSize: 19, fontWeight: 800, letterSpacing: 2.500, color: C.dim})}>{children}</div>
);
const Rule: React.FC<{top: number}> = ({top}) => <div style={abs(0, top, {width: WEB_W, height: 1, background: '#1d1d22'})} />;

// ---------- Feed ----------
type Alert = {badge: React.ReactNode; title: string; body: string; league: string; kind: string; emoji: string};
const ALERTS: Alert[] = [
  {badge: <Badge code="BOS" color="#007A33" size={90} />, title: 'Celtics blew a 22-point lead to the Bucks', body: 'Nate Ament makes free throw 2 of 2 — MIL 92, BOS 91', league: 'NBA', kind: 'Blows a big lead', emoji: '🫠'},
  {badge: <Plate num="15" code="KC" color="#E31837" size={90} />, title: 'Patrick Mahomes threw an interception', body: 'Picked off at the KC 38, 2:11 left in the 4th.', league: 'NFL', kind: 'Interception', emoji: '🤦'},
  {badge: <Badge code="LIV" color="#C8102E" size={90} />, title: 'Liverpool scored an own goal', body: 'Virgil van Dijk turns it into his own net, 62nd minute.', league: 'EPL', kind: 'Own goal', emoji: '😬'},
  {badge: <Badge code="MIA" color="#00A3E0" size={90} />, title: 'Marlins lost to the Mets as favorites', body: 'Final: Mets 6, Marlins 4.', league: 'MLB', kind: 'Loses as the favorite', emoji: '🎰'},
  {badge: <Plate num="27" code="TOR" color="#134A8E" size={90} />, title: 'Vladimir Guerrero Jr. struck out', body: 'Struck out swinging, bases loaded — TOR 3, NYY 3.', league: 'MLB', kind: 'Strikeout', emoji: '💨'},
];
const PITCH = 255;
const CARD_H = 240;
const ARRIVAL = 72; // frames per new alert; 5 arrivals walk the 5-card ring all the way round, so the loop is seamless
const AGES = ['just now', '3m ago', '10m ago', '17m ago', '24m ago', '31m ago'];

const FeedCard: React.FC<{a: Alert; top: number; opacity?: number; age: string}> = ({a, top, opacity = 1, age}) => (
  <div style={abs(22, top, {width: 656, height: CARD_H, borderRadius: 22, border: `2px solid ${LINE}`, background: PANEL, boxSizing: 'border-box', opacity})}>
    <div style={abs(27, 22)}>{a.badge}</div>
    <div style={abs(139, 28, {width: 440, fontSize: 27, fontWeight: 700, lineHeight: '36px', letterSpacing: -0.3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden'})}>{a.title}</div>
    <div style={abs(139, 108, {width: 410, fontSize: 24, fontWeight: 400, lineHeight: '33px', color: GRAY, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden'})}>{a.body}</div>
    <div style={abs(86, 90, {fontSize: 36, lineHeight: '38px'})}>{a.emoji}</div>
    <div style={abs(139, 183, {display: 'flex', alignItems: 'center', gap: 12, fontSize: 20, fontWeight: 500, color: GRAY, whiteSpace: 'nowrap'})}>
      <LeaguePill league={a.league} />
      <span>{a.kind}</span><span style={{color: C.dim}}>· {age}</span>
    </div>
    <div style={abs(590, 28)}><IconStar size={38} /></div>
    <div style={abs(592, 80)}><IconShare size={34} /></div>
  </div>
);

const Toast: React.FC<{a: Alert; y: number}> = ({a, y}) => (
  <div style={abs(14, y, {width: 672, height: 124, borderRadius: 40, background: 'rgba(52,52,58,.96)', boxShadow: '0 18px 50px rgba(0,0,0,.6)', boxSizing: 'border-box', padding: '20px 26px', display: 'flex', gap: 20})}>
    <div style={{width: 62, height: 62, borderRadius: 15, background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none'}}>
      <svg width={48} height={40} viewBox="-360 -280 720 600"><path d="M -306.4 -256.7 L 272.8 -187.4 L 257.2 -92.6 L -313.6 -213.3 Z" fill={C.red} /><path d="M -340 40 Q 0 -230 340 40 Q 0 310 -340 40 Z" fill="#fff" /><circle cx={0} cy={40} r={125} fill={C.red} /><circle cx={0} cy={40} r={58} fill={C.bg} /></svg>
    </div>
    <div style={{minWidth: 0}}>
      <div style={{display: 'flex', justifyContent: 'space-between', fontSize: 19, fontWeight: 600, color: '#c4c4cc', letterSpacing: 0.5}}><span>HATE WATCH</span><span>now</span></div>
      <div style={{fontSize: 24, fontWeight: 700, color: '#fff', marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', width: 540}}>{a.emoji} {a.title}</div>
      <div style={{fontSize: 21, color: '#d4d4d8', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', width: 540}}>{a.body}</div>
    </div>
  </div>
);

export const WebFeed: React.FC = () => {
  const f = useCurrentFrame();
  const m = Math.floor(f / ARRIVAL);
  const local = f % ARRIVAL;
  // a thumb flick: one card pitch up, fast then slowing; 5 flicks walk the 5-card ring round, so the loop is seamless
  const s = m + ramp(local, 6, 46, Easing.out(Easing.cubic));
  const toastY = interpolate(local, [38, 50, 64, 72], [-150, 22, 22, -150], {...clamp, easing: pop});
  return (
    <Shell tab={0} header={<Header title="Hate Watch" right={<Live />} />}>
      <Segment top={197} options={['Everything', 'Teams', 'Athletes']} active={0} />
      <Chips top={282} items={LEAGUE_CHIPS} />
      <Rule top={346} />
      <Caps top={380}>TODAY</Caps>
      <div style={abs(0, 420, {width: WEB_W, height: 920, overflow: 'hidden'})}>
        {ALERTS.map((a, j) => {
          const p = ((((j - s + 1) % 5) + 5) % 5) - 1; // slot in [-1, 4): -1 is just off the top
          return <FeedCard key={j} a={a} top={11 + p * PITCH} age={AGES[j]} />;
        })}
      </div>
      <Toast a={ALERTS[(m + 4) % 5]} y={toastY} />
    </Shell>
  );
};

// ---------- Search ----------
type Team = {code: string; color: string; name: string; league: string; city: string; haters: number};
const TEAMS: Team[] = [
  {code: 'BOS', color: '#2a2a2e', name: 'Boston Bruins', league: 'NHL', city: 'Boston', haters: 1},
  {code: 'BOS', color: '#007A33', name: 'Boston Celtics', league: 'NBA', city: 'Boston', haters: 7},
  {code: 'BC', color: '#9E1B32', name: 'Boston College Eagles', league: 'CFB', city: 'Boston College', haters: 3},
  {code: 'BOS', color: '#0C2340', name: 'Boston Red Sox', league: 'MLB', city: 'Boston', haters: 2},
];
const TYPED = 'Boston';
const SEARCH_RESET = 224;

export const WebSearch: React.FC = () => {
  const f = useCurrentFrame();
  const typed = f >= SEARCH_RESET ? 0 : Math.min(TYPED.length, Math.max(0, Math.floor((f - 18) / 7) + 1));
  const tapAt = 128;
  const tracked = f >= tapAt + 4 && f < SEARCH_RESET;
  const press = interpolate(f, [tapAt, tapAt + 4, tapAt + 10], [1, 0.93, 1], clamp);
  const fade = interpolate(f, [210, SEARCH_RESET], [1, 0], clamp);
  return (
    <Shell tab={2} header={<Header title="Search" />}>
      <div style={abs(22, 197, {width: 656, height: 77, borderRadius: 21, border: `2px solid ${C.red}`, background: PANEL, boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 18, paddingLeft: 22})}>
        <IconSearch size={32} color={GRAY} />
        <span style={{fontSize: 29, color: typed ? '#fff' : C.dim, whiteSpace: 'pre'}}>{typed ? TYPED.slice(0, typed) : 'Search teams and athletes'}</span>
        {f % 30 < 15 && typed > 0 && <span style={{width: 3, height: 34, background: '#4f6df5', marginLeft: -16}} />}
      </div>
      <Segment top={290} options={['Teams', 'Athletes']} active={0} />
      <Chips top={375} items={LEAGUE_CHIPS} />
      <div style={abs(0, 440, {opacity: fade})}>
        {TEAMS.map((t, i) => {
          const a = ramp(f, 34 + i * 4, 48 + i * 4);
          const celtics = i === 1;
          const on = celtics && tracked;
          const haters = on ? t.haters + 1 : t.haters;
          return (
            <div key={t.name} style={abs(0, 4 + i * 134.5, {width: WEB_W, height: 134, opacity: a, transform: `translateY(${(1 - a) * 24}px)`})}>
              <div style={abs(28, 25)}><Badge code={t.code} color={t.color} size={84} /></div>
              <div style={abs(133, 20, {width: 300, fontSize: 27, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', letterSpacing: -0.3})}>{t.name}</div>
              <div style={abs(133, 58, {display: 'flex', alignItems: 'center', gap: 12, fontSize: 22, color: GRAY})}><LeaguePill league={t.league} size={18} />{t.city}</div>
              <div style={abs(133, 92, {display: 'flex', alignItems: 'center', gap: 9, fontSize: 21, color: GRAY})}>
                <IconEye size={24} color={GRAY} />{haters} {haters === 1 ? 'hater' : 'haters'}
              </div>
              <div style={abs(435, 38, {width: 62, height: 62, borderRadius: 31, background: '#1c1c20', display: 'flex', alignItems: 'center', justifyContent: 'center'})}><IconHeart size={30} /></div>
              <div style={abs(512, 38, {width: 160, height: 62, borderRadius: 31, boxSizing: 'border-box', textAlign: 'center', lineHeight: '56px', fontSize: 24, fontWeight: 800, background: on ? 'transparent' : C.red, border: `3px solid ${C.red}`, color: on ? C.red : '#fff', transform: celtics ? `scale(${press})` : undefined})}>{on ? 'Tracking' : 'Track'}</div>
            </div>
          );
        })}
      </div>
    </Shell>
  );
};

// ---------- Scores ----------
// Scores at each stage of the loop (stage starts in SCORE_AT): Bucks 96-95, Celtics take the lead, Bucks hit a three, then back to the top.
const SCORE_AT = [0, 90, 160, 232];
const BUCKS = [96, 96, 99, 96];
const CELTS = [95, 97, 97, 95];
const PILL = ['Down 1', 'Up 1', 'Down 2', 'Down 1'];
const CLOCK = ['5:00', '4:41', '4:22', '5:00'];
const LAST = [
  'Brayden Burries makes 14-foot shot',
  'Jayson Tatum makes 2-foot layup',
  'Damian Lillard makes 27-foot three',
  'Brayden Burries makes 14-foot shot',
];
const EVENT = ['⬇️ Bucks scored 2 to take the lead over the Celtics', '⬆️ Celtics scored 2 to take the lead over the Bucks', '⬇️ Bucks scored 3 to take the lead over the Celtics', '⬇️ Bucks scored 2 to take the lead over the Celtics'];

const stageOf = (f: number) => SCORE_AT.reduce((s, t, i) => (f >= t ? i : s), 0);

/** A number that rolls up into place for 9 frames after its stage starts; stage 3 is the reset back to stage 0's numbers, so it just cuts. */
const RollNum: React.FC<{values: number[]; f: number; style: React.CSSProperties}> = ({values, f, style}) => {
  const s = stageOf(f);
  const t = s > 0 && s < 3 ? ramp(f, SCORE_AT[s], SCORE_AT[s] + 9) : 1;
  const prev = values[Math.max(s - 1, 0)];
  return (
    <div style={{...style, overflow: 'hidden', height: 50, lineHeight: '50px'}}>
      <div style={{position: 'absolute', right: 0, top: -t * 50}}>{prev}</div>
      <div style={{position: 'absolute', right: 0, top: (1 - t) * 50}}>{values[s]}</div>
    </div>
  );
};

const UpNext: React.FC<{y: number; badge: React.ReactNode; title: string; league: string; sub: string; day: string; time: string}> = ({y, badge, title, league, sub, day, time}) => (
  <div style={abs(0, y, {width: WEB_W})}>
    <div style={abs(28, 0)}>{badge}</div>
    <div style={abs(112, 0, {fontSize: 27, fontWeight: 700, letterSpacing: -0.3})}>{title}</div>
    <div style={abs(112, 40, {display: 'flex', alignItems: 'center', gap: 12, fontSize: 22, color: GRAY})}><LeaguePill league={league} size={18} />{sub}</div>
    <div style={abs(500, 0, {width: 172, textAlign: 'right', fontSize: 25, fontWeight: 700})}>{day}</div>
    <div style={abs(500, 34, {width: 172, textAlign: 'right', fontSize: 24, fontWeight: 500, color: GRAY})}>{time}</div>
  </div>
);

export const WebScores: React.FC = () => {
  const f = useCurrentFrame();
  const s = stageOf(f);
  const flash = s > 0 && s < 3 ? 1 - ramp(f, SCORE_AT[s], SCORE_AT[s] + 26, Easing.out(Easing.quad)) : 0;
  const up = PILL[s].startsWith('Up');
  const pulse = 0.6 + 0.4 * Math.sin((f * Math.PI) / 18); // 36-frame period divides the 360-frame loop
  const dim = '#7a7a82';
  return (
    <Shell tab={1} header={<Header title="Scores" right={<Live />} />}>
      <Segment top={197} options={['My Events', 'All Events']} active={0} />
      <Chips top={282} items={LEAGUE_CHIPS} />
      <Rule top={346} />
      <Caps top={392}>LIVE NOW · 1</Caps>
      <div style={abs(22, 430, {width: 656, height: 335, borderRadius: 22, border: `2px solid ${flash > 0.05 ? `rgba(229,35,43,${0.25 + flash * 0.75})` : LINE}`, boxShadow: `0 0 ${flash * 50}px rgba(229,35,43,${flash * 0.5})`, background: PANEL, boxSizing: 'border-box'})}>
        <div style={abs(20, 20)}><Badge code="MIL" color="#00471B" size={52} /></div>
        <div style={abs(92, 28, {fontSize: 26, fontWeight: 700, color: GRAY})}>Bucks</div>
        <RollNum values={BUCKS} f={f} style={abs(480, 20, {width: 154, fontSize: 40, fontWeight: 800, color: s === 1 ? dim : '#fff', textAlign: 'right'})} />
        <div style={abs(20, 88)}><Badge code="BOS" color="#007A33" size={52} /></div>
        <div style={abs(92, 96, {display: 'flex', alignItems: 'center', gap: 14, fontSize: 26, fontWeight: 700})}>
          Celtics
          <span style={{fontSize: 20, fontWeight: 700, color: C.red, border: `2px solid ${C.red}`, borderRadius: 14, padding: '1px 12px'}}>Tracking</span>
        </div>
        <RollNum values={CELTS} f={f} style={abs(480, 88, {width: 154, fontSize: 40, fontWeight: 800, color: s === 2 ? dim : '#fff', textAlign: 'right'})} />
        <div style={abs(20, 160, {display: 'flex', alignItems: 'center', gap: 12, fontSize: 22, fontWeight: 500, color: GRAY})}>
          <span style={{width: 34, height: 34, borderRadius: 17, background: 'rgba(34,197,94,.22)', display: 'flex', alignItems: 'center', justifyContent: 'center'}}><span style={{width: 20, height: 20, borderRadius: 10, background: C.green, opacity: pulse}} /></span>
          {CLOCK[s]} - 4th
        </div>
        <div style={abs(438, 152, {padding: '0 20px', height: 38, lineHeight: '38px', borderRadius: 19, fontSize: 21, fontWeight: 800, background: up ? '#12331f' : '#5a1218', color: up ? '#4ade80' : '#ff8a8a'})}>{PILL[s]}</div>
        <div style={abs(557, 152)}><IconEye size={36} color={C.green} /></div>
        <div style={abs(20, 206, {fontSize: 20, color: GRAY, whiteSpace: 'nowrap'})}>Top scorers: <b style={{color: '#c4c4cc'}}>T. Herro</b> 23 pts · <b style={{color: '#c4c4cc'}}>P. George</b> 20 pts</div>
        <div style={abs(20, 236, {fontSize: 20, color: GRAY, whiteSpace: 'nowrap'})}>Last play: <b style={{color: '#c4c4cc'}}>{LAST[s]}</b></div>
        <div style={abs(20, 280, {width: 612, height: 1, background: LINE})} />
        <div style={abs(20, 292, {fontSize: 20, color: GRAY, whiteSpace: 'nowrap'})}>{EVENT[s]} · just now</div>
      </div>
      <Caps top={826}>UP NEXT · 3</Caps>
      <UpNext y={880} badge={<Badge code="BOS" color="#007A33" size={62} />} title="Celtics at Hornets" league="NBA" sub="NBA Cup Group Play" day="Fri" time="7:00 PM" />
      <UpNext y={980} badge={<Badge code="KC" color="#E31837" size={62} />} title="Chiefs vs Jets" league="NFL" sub="CBS" day="Sun" time="1:00 PM" />
      <UpNext y={1080} badge={<Badge code="DAL" color="#0C2340" size={62} />} title="Cowboys at Colts" league="NFL" sub="Fox" day="Sun" time="1:00 PM" />
    </Shell>
  );
};

// ---------- Tracking ----------
type Tracked = {code: string; color: string; league: string; name: string; sub: string; haters: number; num?: string};
const TRACKED: Tracked[] = [
  {code: 'BOS', color: '#007A33', league: 'NBA', name: 'Boston Celtics', sub: 'Boston · East · Atlantic', haters: 7},
  {code: 'DAL', color: '#003594', league: 'NFL', name: 'Dallas Cowboys', sub: 'Dallas · NFC East', haters: 5},
  {code: 'KC', color: '#E31837', league: 'NFL', name: 'Kansas City Chiefs', sub: 'Kansas City · AFC West', haters: 4},
  {code: 'NYY', color: '#14284b', league: 'MLB', name: 'New York Yankees', sub: 'New York · AL East', haters: 13},
  {code: 'LAL', color: '#552583', league: 'NBA', name: 'Los Angeles Lakers', sub: 'Los Angeles · West', haters: 11},
  {code: 'PHI', color: '#004C54', league: 'NFL', name: 'Philadelphia Eagles', sub: 'Philadelphia · NFC East', haters: 6},
  {code: 'LAD', color: '#005A9C', league: 'MLB', name: 'Los Angeles Dodgers', sub: 'Los Angeles · NL West', haters: 9},
  {code: 'LIV', color: '#C8102E', league: 'EPL', name: 'Liverpool', sub: 'Liverpool · Merseyside', haters: 8},
];
const ATHLETES: Tracked[] = [
  {num: '15', code: 'KC', color: '#E31837', league: 'NFL', name: 'Patrick Mahomes', sub: 'QB · Chiefs', haters: 9},
  {num: '0', code: 'BOS', color: '#007A33', league: 'NBA', name: 'Jayson Tatum', sub: 'F · Celtics', haters: 5},
  {num: '4', code: 'DAL', color: '#003594', league: 'NFL', name: 'Dak Prescott', sub: 'QB · Cowboys', haters: 7},
  {num: '99', code: 'NYY', color: '#14284b', league: 'MLB', name: 'Aaron Judge', sub: 'OF · Yankees', haters: 12},
];
const TR_PITCH = 180;
const TR_H = 168;
const ATH_CAPS = 56 + TRACKED.length * TR_PITCH + 14;
const ATH_TOP = ATH_CAPS + 42;
const TR_TOTAL = ATH_TOP + ATHLETES.length * TR_PITCH + 20;

const TrackCard: React.FC<{t: Tracked; top: number; muted: boolean}> = ({t, top, muted}) => (
  <div style={abs(22, top, {width: 656, height: TR_H, borderRadius: 22, border: `2px solid ${LINE}`, background: PANEL, boxSizing: 'border-box', overflow: 'hidden'})}>
    <div style={abs(0, 0, {width: 656, height: 40, background: t.color})} />
    <div style={abs(128, 2, {fontSize: 19, fontWeight: 800, letterSpacing: 1.500, color: '#fff', lineHeight: '34px'})}>{t.league}</div>
    <div style={abs(380, 2, {width: 250, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8, fontSize: 20, fontWeight: 700, lineHeight: '34px'})}><IconEye size={24} />{t.haters} haters</div>
    <div style={abs(24, 6)}>{t.num ? <Plate num={t.num} code={t.code} color={t.color} size={78} /> : <Badge code={t.code} color={t.color} size={78} />}</div>
    <div style={abs(128, 46, {width: 250, fontSize: 31, fontWeight: 700, lineHeight: '38px', letterSpacing: -0.4})}>{t.name}</div>
    <div style={abs(128, 124, {width: 250, fontSize: 21, color: GRAY, whiteSpace: 'nowrap'})}>{t.sub}</div>
    <div style={abs(386, 62)}><IconX size={34} /></div>
    <div style={abs(449, 62, {opacity: muted ? 0.45 : 1})}><IconBell size={34} muted={muted} /></div>
    <div style={abs(511, 62)}><IconGear size={34} /></div>
    <div style={abs(575, 62, {width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center'})}><span style={{width: 22, height: 3, background: '#fff', borderRadius: 2}} /></div>
  </div>
);

export const WebTracking: React.FC = () => {
  const f = useCurrentFrame();
  const ease = Easing.inOut(Easing.cubic);
  // down the teams to the players, a beat there (a player's bell is muted), then back up: starts and ends at the top
  const scroll = (TR_TOTAL - 925) * (ramp(f, 20, 170, ease) - ramp(f, 262, 350, ease));
  const muted = f >= 184 && f < 232;
  return (
    <Shell tab={3} header={<Header title={`Tracking (${TRACKED.length + ATHLETES.length})`} right={<div style={abs(526, 110, {width: 146, height: 64, borderRadius: 32, border: `2px solid ${LINE}`, boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, fontSize: 24, fontWeight: 600, color: '#d4d4d8'})}><svg width={26} height={26} viewBox="0 0 26 26" fill="none" stroke="#d4d4d8" strokeWidth={2.400}><rect x="2" y="2" width="9" height="9" rx="2" /><rect x="15" y="2" width="9" height="9" rx="2" /><rect x="2" y="15" width="9" height="9" rx="2" /><rect x="15" y="15" width="9" height="9" rx="2" /></svg>Layout</div>} />}>
      <div style={abs(0, 415, {width: WEB_W, height: 925, overflow: 'hidden'})}>
        <div style={{transform: `translateY(${-scroll}px)`}}>
          <Caps top={14}>TEAMS · {TRACKED.length}</Caps>
          {TRACKED.map((t, i) => <TrackCard key={t.name} t={t} top={56 + i * TR_PITCH} muted={false} />)}
          <Caps top={ATH_CAPS}>ATHLETES · {ATHLETES.length}</Caps>
          {ATHLETES.map((t, i) => <TrackCard key={t.name} t={t} top={ATH_TOP + i * TR_PITCH} muted={muted && i === 1} />)}        </div>
      </div>
      <Segment top={197} options={['Everything', 'Teams', 'Athletes']} active={0} />
      <Chips top={282} items={LEAGUE_CHIPS} />
      <Chips top={348} items={[['❌ Most Hated', 212], ['+', 58]]} active={-1} />
      <Rule top={414} />
    </Shell>
  );
};

// ---------- One team's alert switches ----------
const SWITCHES: {emoji: string; title: string; feedOnly?: boolean}[] = [
  {emoji: '🪦', title: 'Loses a game'},
  {emoji: '⏱️', title: 'Loses at the last second'},
  {emoji: '🫠', title: 'Blows a big lead'},
  {emoji: '🎰', title: 'Loses as the favorite'},
  {emoji: '🧹', title: 'Gets swept'},
  {emoji: '🤡', title: 'Loses to a worse team'},
  {emoji: '⚖️', title: 'Falls below .500'},
  {emoji: '🍿', title: 'Game starts'},
  {emoji: '⬇️', title: 'Falls behind', feedOnly: true},
];
// frames at which a row's switch goes off and comes back on
const FLIPS: Record<number, [number, number]> = {0: [24, 200], 2: [48, 224], 4: [72, 248], 3: [96, 272], 5: [120, 296], 1: [144, 320]};
const ROW = 105;

const Switch: React.FC<{on: number}> = ({on}) => (
  <div style={{width: 112, height: 54, borderRadius: 27, boxSizing: 'border-box', background: on > 0.5 ? C.red : '#3a3a40', border: `2px solid ${on > 0.5 ? '#ff5a60' : '#4a4a52'}`, position: 'relative'}}>
    <div style={{position: 'absolute', top: 3, left: 4 + on * 56, width: 48, height: 44, borderRadius: 22, background: '#fff'}} />
  </div>
);

export const WebAlerts: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <Shell tab={3} header={<Header back="Back" backTitle="Boston Celtics alerts" />}>
      <div style={abs(22, 200, {width: 4, height: 1140, background: C.red})} />
      <div style={abs(26, 200, {width: 652, height: 1140, overflow: 'hidden', background: PANEL})}>
        <div style={abs(0, 0, {width: 652, height: 60, background: '#1b1b20', fontSize: 20, fontWeight: 800, letterSpacing: 2.500, color: GRAY, lineHeight: '60px', paddingLeft: 28, boxSizing: 'border-box'})}>GAME</div>
        {SWITCHES.map((s, i) => {
          const flip = FLIPS[i];
          const on = flip ? 1 - ramp(f, flip[0], flip[0] + 8, Easing.out(Easing.quad)) + ramp(f, flip[1], flip[1] + 8, Easing.out(Easing.quad)) : 1;
          return (
            <div key={s.title} style={abs(0, 60 + i * ROW, {width: 652, height: ROW, borderBottom: '1px solid #26262c', boxSizing: 'border-box'})}>
              <div style={abs(24, 0, {opacity: 0.35 + 0.65 * on, width: 400, height: ROW})}>
                <div style={abs(5, 28, {fontSize: 38, lineHeight: '44px'})}>{s.emoji}</div>
                <div style={abs(71, s.feedOnly ? 10 : 18, {fontSize: 25, fontWeight: 700})}>{s.title}</div>
                {s.feedOnly && <div style={abs(71, 44, {fontSize: 20, fontWeight: 700, color: C.dim})}>Feed only: no notification</div>}
                <div style={abs(71, s.feedOnly ? 70 : 52, {fontSize: 20, color: C.dim})}>{s.feedOnly ? 'Global setting (on, feed only)' : 'Global setting (on)'}</div>
              </div>
              <div style={abs(432, 24, {width: 58, height: 58, borderRadius: 29, background: '#1f1f25', display: 'flex', alignItems: 'center', justifyContent: 'center'})}><IconBell size={28} muted={s.feedOnly} color={s.feedOnly ? '#6a6a72' : '#fff'} /></div>
              <div style={abs(512, 26)}><Switch on={on} /></div>
            </div>
          );
        })}
      </div>
    </Shell>
  );
};
