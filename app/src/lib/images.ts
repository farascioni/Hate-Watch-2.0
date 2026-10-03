import { PixelRatio } from 'react-native';

const ESPN_CDN = 'https://a.espncdn.com';

/**
 * ESPN's image combiner resizes server-side. We request exactly the pixels we draw
 * (display points × screen density) at the image's *native* aspect ratio, so nothing is
 * stretched and phones never download a 600px headshot (or a 4096px logo) for a 44pt avatar.
 */
export function sizedImage(url: string, nativeW: number, nativeH: number, boxPt: number, mode: 'cover' | 'contain') {
  if (!url.startsWith(ESPN_CDN) || !nativeW || !nativeH) return url;
  const px = PixelRatio.getPixelSizeForLayoutSize(boxPt);
  const aspect = nativeW / nativeH;
  // cover: shorter side fills the box; contain: longer side fits the box.
  const fillByHeight = mode === 'cover' ? aspect >= 1 : aspect < 1;
  let w = fillByHeight ? Math.round(px * aspect) : px;
  let h = fillByHeight ? px : Math.round(px / aspect);
  // Never upscale beyond the source.
  if (w > nativeW) { h = Math.round((h * nativeW) / w); w = nativeW; }
  const path = url.slice(ESPN_CDN.length);
  return `${ESPN_CDN}/combiner/i?img=${encodeURIComponent(path)}&w=${w}&h=${h}`;
}
