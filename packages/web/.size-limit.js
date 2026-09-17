/**
 * What the office costs to open.
 *
 * Measured 2026-09-17, with React in its own chunk to see the split:
 *
 *   react + react-dom + scheduler   70.6 kB gz
 *   our own code                    19.4 kB gz
 *   CSS                              6.9 kB gz
 *
 * So React is three quarters of the first-load budget and is not going
 * anywhere. The number worth watching is our 19.4 kB, and 105 leaves about
 * 12 kB of headroom — roughly 60% growth on what we have written, which trips
 * on real bloat without tripping on every ticket.
 *
 * Splitting React into its own file was measured rather than assumed, and it
 * makes first load 4 kB WORSE (97.3 against 93.2): the browser downloads React
 * either way, so the split only moves the number out of a budget named
 * "everyone pays this", and costs a module runtime and some cross-chunk
 * minification on the way. Not done.
 */
export default [
  {
    name: "first load (everyone pays this)",
    path: ["dist/assets/index-*.js", "dist/assets/*.css"],
    limit: "105 kB",
    gzip: true,
  },
  {
    name: "the 3D office (only when it draws)",
    path: "dist/assets/Scene-*.js",
    limit: "260 kB",
    gzip: true,
  },
];
