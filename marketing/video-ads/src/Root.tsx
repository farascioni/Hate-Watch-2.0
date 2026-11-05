import React from 'react';
import {Composition} from 'remotion';
import {FAIL_FEED_FRAMES, FailFeed} from './FailFeed';
import {FEATURE_TOUR_FRAMES, FeatureTour} from './FeatureTour';
import {AD3_FRAMES, Ad3} from './Ad3';
import {GUIDE_FRAMES, GuideVideo} from './GuideVideo';
import {HEADER_PREVIEW_FRAMES, HeaderPreview} from './HeaderPreview';
import {SEARCH_PREVIEW_FRAMES, SearchPreview} from './SearchPreview';
import {WEB_H, WEB_LOOP_FRAMES, WEB_W, WebAlerts, WebFeed, WebScores, WebSearch, WebTracking} from './WebPhones';

const common = {width: 1080, height: 1920, fps: 30} as const;

export const Root: React.FC = () => (
  <>
    <Composition id="FailFeed" component={FailFeed} durationInFrames={FAIL_FEED_FRAMES} {...common} />
    <Composition id="FeatureTour" component={FeatureTour} durationInFrames={FEATURE_TOUR_FRAMES} {...common} />
    <Composition id="Ad3" component={Ad3} durationInFrames={AD3_FRAMES} {...common} />
    <Composition id="GuideVideo" component={GuideVideo} durationInFrames={GUIDE_FRAMES} {...common} />
    <Composition id="HeaderPreview" component={HeaderPreview} durationInFrames={HEADER_PREVIEW_FRAMES} width={3840} height={1646} fps={30} />
    <Composition id="SearchPreview" component={SearchPreview} durationInFrames={SEARCH_PREVIEW_FRAMES} width={3840} height={2560} fps={30} />
    <Composition id="WebFeed" component={WebFeed} durationInFrames={WEB_LOOP_FRAMES} width={WEB_W} height={WEB_H} fps={30} />
    <Composition id="WebSearch" component={WebSearch} durationInFrames={WEB_LOOP_FRAMES} width={WEB_W} height={WEB_H} fps={30} />
    <Composition id="WebScores" component={WebScores} durationInFrames={WEB_LOOP_FRAMES} width={WEB_W} height={WEB_H} fps={30} />
    <Composition id="WebTracking" component={WebTracking} durationInFrames={WEB_LOOP_FRAMES} width={WEB_W} height={WEB_H} fps={30} />
    <Composition id="WebAlerts" component={WebAlerts} durationInFrames={WEB_LOOP_FRAMES} width={WEB_W} height={WEB_H} fps={30} />
  </>
);
