## verdict
1. resolved — Intro contrast: the same screenshot paths now show an opaque light surface behind the complete intro/model-switch region on desktop and mobile, including both Spa locations and cars; text remains legible and the car framing is preserved.
2. resolved — Eyebrows: era/year metadata visibly follows the model heading, and credits.png begins with the dialog title without the ASSET CREDITS eyebrow. Supplied runtime evidence reports no eyebrow DOM.
3. resolved — Font loading: recaptures show the intended Inter lettering; index.html preloads the local WOFF2, CSS declares the variable face, and supplied runtime evidence records Inter as loaded.
4. resolved — Icons: recaptures show consistent stroke icons for credits, DRS, reset and dialog close; sampled source uses authored SVG and supplied runtime evidence reports no four banned glyphs.
5. resolved — Error copy: error.png visibly reads “气流暂不可用 · 数据加载失败，请检查网络后重试” with a separate retry action; raw error details remain in diagnostics.

## remaining
clear — All eleven supplied recaptures are valid. No regressions introduced by this fix batch were identified. This ship verdict covers the five scored fixes only; it is not a new whole-surface review or fresh runtime verification.

disposition: ship
