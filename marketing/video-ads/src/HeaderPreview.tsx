// The animated App Store header (app-store/header-animated/header-b.html) as the product page's header video: the store header's
// layout (app-store/build-store-images.mjs `header`) drawn at Apple's 21:9 header size, 3840x1646. The eye and brow stay still; the
// last word of the headline rolls through fail, choke, fold, melt down, blow it, fail. 12 s is one loop (Apple loops it, and the
// last word is the first), inside the header video's 5-30 s.
import React from 'react';
import {AbsoluteFill, Easing, interpolate, useCurrentFrame} from 'remotion';
import {C, FONT} from './theme';

export const HEADER_PREVIEW_FRAMES = 12 * 30;

export const WORDS = ['fail', 'choke', 'fold', 'melt down', 'blow it', 'fail'];
const LINE = 210; // header px between the two headline baselines
const LOOP = 12 * 30; // frames per roll
// frame within a loop where each word starts to roll in (same beats as the HTML: 12%, 29%, 46%, 63%, 80% of 12 s)
const BEATS = [0.12, 0.29, 0.46, 0.63, 0.8].map((p) => p * LOOP);
const ROLL = 0.06 * LOOP;

/** Where the roll is, in words: 0 on "fail", 1 on "choke", ... 5 on the last "fail". Also drives SearchPreview's feed. */
export const rollStep = (frame: number) => {
  const f = frame % LOOP;
  let step = 0;
  for (const b of BEATS) {
    if (f >= b) step += interpolate(f, [b, b + ROLL], [0, 1], {extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic)});
  }
  return step;
};
const rollOffset = (frame: number) => rollStep(frame) * LINE;

export const HeaderPreview: React.FC = () => {
  const frame = useCurrentFrame();
  const text = {fontFamily: FONT, fontWeight: 700, color: C.white, letterSpacing: '-0.01em', whiteSpace: 'nowrap'} as const;
  return (
    <AbsoluteFill style={{background: `radial-gradient(70% 70% at 50% 50%, #3B0D12 0, #170A0C 55%, ${C.bg} 100%)`}}>
      <div style={{position: 'absolute', left: 0, top: 0, width: 3840, height: 1646}}>
        <svg style={{position: 'absolute', left: 0, top: 0}} width={3840} height={1646} viewBox="0 0 3840 1646">
          <clipPath id="eye"><path d="M -340 40 Q 0 -230 340 40 Q 0 310 -340 40 Z" /></clipPath>
          <g transform="translate(1060 803) scale(1.35)">
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
          </g>
        </svg>
        <div style={{...text, position: 'absolute', left: 1640, top: 516, fontSize: 190, lineHeight: `${LINE}px`}}>Know the second</div>
        <div style={{...text, position: 'absolute', left: 1640, top: 516 + LINE, fontSize: 190, lineHeight: `${LINE}px`, display: 'flex'}}>
          <span>your rivals&nbsp;</span>
          <span style={{display: 'inline-block', height: LINE, overflow: 'hidden', color: C.red}}>
            <span style={{display: 'block', transform: `translateY(${-rollOffset(frame)}px)`}}>
              {WORDS.map((w, i) => <span key={i} style={{display: 'block', height: LINE}}>{w}</span>)}
            </span>
          </span>
        </div>
        <div style={{position: 'absolute', left: 1640, top: 962, fontFamily: FONT, fontWeight: 500, fontSize: 76, lineHeight: '100px', color: '#9a9aa2', whiteSpace: 'nowrap'}}>
          Real-time alerts for the rivals you can’t stand
        </div>
      </div>
    </AbsoluteFill>
  );
};
