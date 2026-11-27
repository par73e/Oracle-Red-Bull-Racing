// Unified physical velocity colormaps shared by CFD streamlines, 60-FPS preview, and PIV slices.
// Normalized by freestream speed (ratio = |U| / U_inf) so freestream recedes to cool neutral white
// while wake stagnation (ratio < 1) and suction acceleration (ratio > 1) stand out clearly.

const DIVERGING_STOPS = [
  [0.55, 0x2b / 255, 0x4c / 255, 0xe0 / 255], // #2b4ce0 cobalt blue (strong wake / stagnation)
  [0.85, 0x34 / 255, 0x98 / 255, 0xe8 / 255], // #3498e8 vivid sky blue (decelerated zone)
  [1.00, 0xc4 / 255, 0xdc / 255, 0xe6 / 255], // #c4dce6 calm cool ice (freestream)
  [1.08, 0xf5 / 255, 0x9e / 255, 0x3d / 255], // #f59e3d vivid warm amber (acceleration)
  [1.22, 0xeb / 255, 0x3b / 255, 0x26 / 255], // #eb3b26 vermilion red (peak suction)
];

export function sampleFlowSpeedRgb(ratio, out, offset = 0) {
  const r = Number.isFinite(ratio) ? ratio : 1;
  const first = DIVERGING_STOPS[0];
  if (r <= first[0]) {
    out[offset] = first[1];
    out[offset + 1] = first[2];
    out[offset + 2] = first[3];
    return;
  }
  const last = DIVERGING_STOPS[DIVERGING_STOPS.length - 1];
  if (r >= last[0]) {
    out[offset] = last[1];
    out[offset + 1] = last[2];
    out[offset + 2] = last[3];
    return;
  }
  for (let i = 0; i < DIVERGING_STOPS.length - 1; i++) {
    const a = DIVERGING_STOPS[i];
    const b = DIVERGING_STOPS[i + 1];
    if (r <= b[0]) {
      const k = (r - a[0]) / (b[0] - a[0]);
      out[offset] = a[1] + (b[1] - a[1]) * k;
      out[offset + 1] = a[2] + (b[2] - a[2]) * k;
      out[offset + 2] = a[3] + (b[3] - a[3]) * k;
      return;
    }
  }
}

// Standard Anton Mikhailov Turbo colormap polynomial (output 0..255 uint8)
export function sampleTurboRgb(t, out, offset = 0) {
  const x = Math.max(0, Math.min(1, t));
  const x2 = x * x;
  const x3 = x2 * x;
  const x4 = x3 * x;
  const x5 = x4 * x;
  const r = 0.13572138 + 4.61539260 * x - 42.66032258 * x2 + 132.13108234 * x3 - 152.94239396 * x4 + 59.28637943 * x5;
  const g = 0.09140261 + 2.19418839 * x + 4.84296658 * x2 - 14.18503333 * x3 + 4.27729857 * x4 + 2.82956604 * x5;
  const b = 0.10667330 + 12.64194608 * x - 60.58204836 * x2 + 110.36276771 * x3 - 89.90310912 * x4 + 27.34824973 * x5;
  out[offset] = Math.round(Math.max(0, Math.min(1, r)) * 255);
  out[offset + 1] = Math.round(Math.max(0, Math.min(1, g)) * 255);
  out[offset + 2] = Math.round(Math.max(0, Math.min(1, b)) * 255);
}
