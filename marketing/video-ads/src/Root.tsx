import React from 'react';
import {Composition} from 'remotion';
import {FAIL_FEED_FRAMES, FailFeed} from './FailFeed';
import {FEATURE_TOUR_FRAMES, FeatureTour} from './FeatureTour';
import {AD3_FRAMES, Ad3} from './Ad3';
import {GUIDE_FRAMES, GuideVideo} from './GuideVideo';

const common = {width: 1080, height: 1920, fps: 30} as const;

export const Root: React.FC = () => (
  <>
    <Composition id="FailFeed" component={FailFeed} durationInFrames={FAIL_FEED_FRAMES} {...common} />
    <Composition id="FeatureTour" component={FeatureTour} durationInFrames={FEATURE_TOUR_FRAMES} {...common} />
    <Composition id="Ad3" component={Ad3} durationInFrames={AD3_FRAMES} {...common} />
    <Composition id="GuideVideo" component={GuideVideo} durationInFrames={GUIDE_FRAMES} {...common} />
  </>
);
