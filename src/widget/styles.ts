export const widgetStyles = `
:host {
  --ss-font: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --ss-primary: #244d3b;
  --ss-secondary: #e8efe6;
  --ss-ink: #18231d;
  --ss-muted: #667169;
  --ss-soft-muted: #89958c;
  --ss-line: #dce5dc;
  --ss-surface: #fbfcf9;
  --ss-surface-strong: #ffffff;
  --ss-shadow: 0 28px 100px rgba(19, 39, 28, .22);
  --ss-radius-panel: 25px;
  --ss-radius-card: 18px;
  --ss-radius-control: 14px;
  --ss-space-1: 4px;
  --ss-space-2: 8px;
  --ss-space-3: 12px;
  --ss-space-4: 16px;
  --ss-space-5: 20px;
  --ss-space-6: 24px;
  --ss-space-7: 32px;
  --ss-duration: 180ms;
  all: initial;
  display: block;
  position: fixed;
  z-index: 2147483000;
  right: 22px;
  bottom: max(22px, env(safe-area-inset-bottom));
  color: var(--ss-ink);
  font-family: var(--ss-font);
}
:host([data-position="bottom-left"]) { right: auto; left: 22px; }
*, *::before, *::after { box-sizing: border-box; }
button, textarea { font: inherit; }
button { cursor: pointer; }
.launcher { display: inline-flex; align-items: center; gap: 11px; min-height: 54px; padding: 0 19px; border: 1px solid color-mix(in srgb, var(--ss-primary) 78%, white); border-radius: 999px; color: #fff; background: var(--ss-primary); box-shadow: 0 12px 30px rgba(24, 55, 40, .23), inset 0 1px 0 rgba(255,255,255,.18); font-size: 14px; font-weight: 750; letter-spacing: -.01em; transition: transform var(--ss-duration) ease, box-shadow var(--ss-duration) ease; }
.launcher:hover { transform: translateY(-2px); box-shadow: 0 16px 36px rgba(24, 55, 40, .28), inset 0 1px 0 rgba(255,255,255,.18); }
.launcher:active { transform: translateY(0); }
.launcher-mark { display: grid; width: 25px; height: 25px; place-items: center; border: 1px solid rgba(255,255,255,.42); border-radius: 50%; background: rgba(255,255,255,.09); }
.launcher-mark svg { width: 14px; height: 14px; }
.launcher:focus-visible, .icon-button:focus-visible, .button:focus-visible, .option:has(input:focus-visible), .article-card a:focus-visible, .featured-card a:focus-visible { outline: 3px solid #d6a72c; outline-offset: 3px; }
.panel { display: flex; flex-direction: column; width: min(710px, calc(100vw - 32px)); max-height: min(820px, calc(100dvh - 32px)); overflow: hidden; border: 1px solid rgba(255,255,255,.88); border-radius: var(--ss-radius-panel); background: var(--ss-surface); box-shadow: var(--ss-shadow); animation: panel-enter 240ms cubic-bezier(.2,.8,.2,1) both; }
.panel--results { width: min(920px, calc(100vw - 32px)); max-height: min(900px, calc(100dvh - 28px)); }
.panel--glass { background: color-mix(in srgb, var(--ss-surface) 90%, transparent); backdrop-filter: blur(18px); }
.panel--plain { background: var(--ss-surface-strong); }
.panel-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--ss-space-5); padding: 24px 28px 20px; border-bottom: 1px solid color-mix(in srgb, var(--ss-line) 82%, transparent); background: linear-gradient(135deg, color-mix(in srgb, var(--ss-secondary) 70%, white), var(--ss-surface)); }
.panel-branding { min-width: 0; }
.publisher-logo { display: block; width: auto; max-width: 170px; height: 28px; margin: 0 0 10px; object-fit: contain; object-position: left center; }
.eyebrow, .intro-kicker, .results-kicker { margin: 0 0 8px; color: var(--ss-primary); font-size: 10px; font-weight: 850; letter-spacing: .16em; text-transform: uppercase; }
.panel-title { margin: 0; color: var(--ss-ink); font-family: Georgia, "Times New Roman", serif; font-size: clamp(25px, 4vw, 35px); font-weight: 500; letter-spacing: -.05em; line-height: 1.03; }
.panel-copy { max-width: 560px; margin: 10px 0 0; color: var(--ss-muted); font-size: 14px; line-height: 1.55; }
.icon-button { display: grid; flex: 0 0 auto; width: 38px; height: 38px; place-items: center; border: 1px solid var(--ss-line); border-radius: 50%; color: var(--ss-muted); background: rgba(255,255,255,.72); font-size: 22px; line-height: 1; transition: background var(--ss-duration) ease, color var(--ss-duration) ease; }
.icon-button:hover { color: var(--ss-ink); background: #fff; }
.content { min-height: 0; overflow-y: auto; padding: 28px 28px 30px; overscroll-behavior: contain; scrollbar-color: color-mix(in srgb, var(--ss-primary) 32%, transparent) transparent; }
.view-transition { animation: view-enter 220ms cubic-bezier(.2,.8,.2,1) both; }
.intro { display: grid; justify-items: start; max-width: 570px; padding: 13px 10px 8px; }
.intro-visual { display: grid; width: 74px; height: 74px; place-items: center; margin-bottom: 28px; border: 1px solid color-mix(in srgb, var(--ss-primary) 20%, var(--ss-line)); border-radius: 24px; color: var(--ss-primary); background: var(--ss-secondary); box-shadow: inset 0 0 0 8px color-mix(in srgb, var(--ss-secondary) 55%, white); }
.intro-visual svg { width: 32px; height: 32px; }
.intro-heading { max-width: 510px; margin: 0 0 14px; font-family: Georgia, "Times New Roman", serif; font-size: clamp(33px, 6vw, 54px); font-weight: 500; letter-spacing: -.065em; line-height: .98; }
.intro-copy { max-width: 480px; margin: 0; color: var(--ss-muted); font-size: 15px; line-height: 1.6; }
.intro-points { display: flex; flex-wrap: wrap; gap: 10px 18px; margin: 23px 0 28px; color: var(--ss-muted); font-size: 12px; }
.intro-point { display: inline-flex; align-items: center; gap: 8px; }
.intro-point::before { width: 7px; height: 7px; border-radius: 50%; background: var(--ss-primary); box-shadow: 0 0 0 4px var(--ss-secondary); content: ''; }
.progress-meta { display: flex; align-items: center; justify-content: space-between; margin-bottom: 11px; color: var(--ss-muted); font-size: 12px; font-weight: 750; }
.progress-track { height: 4px; overflow: hidden; border-radius: 10px; background: color-mix(in srgb, var(--ss-line) 72%, white); }
.progress-value { height: 100%; border-radius: inherit; background: var(--ss-primary); transition: width 300ms ease; }
.question-kicker { margin: 28px 0 10px; color: var(--ss-primary); font-size: 11px; font-weight: 850; letter-spacing: .13em; text-transform: uppercase; }
.question-heading { max-width: 560px; margin: 0 0 9px; font-family: Georgia, "Times New Roman", serif; font-size: clamp(28px, 5vw, 40px); font-weight: 500; letter-spacing: -.055em; line-height: 1.03; }
.question-support { max-width: 520px; margin: 0 0 21px; color: var(--ss-muted); font-size: 14px; line-height: 1.52; }
.options { display: grid; gap: 10px; }
.option { position: relative; display: flex; align-items: flex-start; gap: 13px; min-height: 58px; padding: 16px 17px; border: 1px solid var(--ss-line); border-radius: var(--ss-radius-control); color: var(--ss-ink); background: color-mix(in srgb, var(--ss-surface-strong) 78%, transparent); transition: border-color var(--ss-duration) ease, background var(--ss-duration) ease, transform var(--ss-duration) ease, box-shadow var(--ss-duration) ease; }
.option:hover { border-color: color-mix(in srgb, var(--ss-primary) 45%, var(--ss-line)); transform: translateY(-1px); }
.option:has(input:checked) { border-color: var(--ss-primary); background: color-mix(in srgb, var(--ss-secondary) 78%, white); box-shadow: inset 0 0 0 1px var(--ss-primary); }
.option input { position: absolute; width: 1px; height: 1px; overflow: hidden; opacity: 0; pointer-events: none; }
.option::before { display: grid; flex: 0 0 auto; width: 19px; height: 19px; place-items: center; margin-top: 1px; border: 1px solid var(--ss-line); border-radius: 50%; color: #fff; background: var(--ss-surface-strong); content: ''; transition: background var(--ss-duration) ease, border-color var(--ss-duration) ease; }
.option:has(input[type="checkbox"])::before { border-radius: 6px; }
.option:has(input:checked)::before { border-color: var(--ss-primary); background: var(--ss-primary); box-shadow: inset 0 0 0 4px var(--ss-secondary); }
.option-main { display: grid; gap: 4px; }
.option-label { font-size: 14px; font-weight: 760; line-height: 1.35; }
.option-description { color: var(--ss-muted); font-size: 12px; line-height: 1.4; }
.free-text { width: 100%; min-height: 155px; resize: vertical; padding: 16px; border: 1px solid var(--ss-line); border-radius: var(--ss-radius-control); outline: none; color: var(--ss-ink); background: var(--ss-surface-strong); font-size: 15px; line-height: 1.55; }
.free-text:focus { border-color: var(--ss-primary); box-shadow: 0 0 0 4px color-mix(in srgb, var(--ss-primary) 15%, transparent); }
.actions { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-top: 28px; }
.button { display: inline-flex; align-items: center; justify-content: center; min-height: 45px; padding: 0 19px; border: 1px solid var(--ss-primary); border-radius: 999px; color: #fff; background: var(--ss-primary); font-size: 13px; font-weight: 800; transition: opacity var(--ss-duration) ease, transform var(--ss-duration) ease, box-shadow var(--ss-duration) ease; }
.button:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 8px 18px color-mix(in srgb, var(--ss-primary) 20%, transparent); }
.button:disabled { cursor: not-allowed; opacity: .4; }
.button.secondary { border-color: var(--ss-line); color: var(--ss-muted); background: transparent; }
.button.secondary:hover { color: var(--ss-ink); background: var(--ss-surface-strong); box-shadow: none; }
.button-wide { min-width: 164px; }
.analysis-content { display: grid; place-items: center; min-height: 450px; }
.analysis { width: min(440px, 100%); padding: 10px 6px; }
.analysis-heading { display: flex; align-items: center; gap: 16px; margin-bottom: 29px; }
.analysis-orbit { display: grid; flex: 0 0 auto; width: 60px; height: 60px; place-items: center; border: 1px solid color-mix(in srgb, var(--ss-primary) 30%, var(--ss-line)); border-radius: 20px; background: var(--ss-secondary); animation: breathe 2s ease-in-out infinite; }
.analysis-orbit svg { width: 26px; height: 26px; color: var(--ss-primary); }
.analysis-heading h2 { margin: 0 0 5px; font-family: Georgia, serif; font-size: 29px; font-weight: 500; letter-spacing: -.045em; line-height: 1.02; }
.analysis-heading p { margin: 0; color: var(--ss-muted); font-size: 13px; line-height: 1.45; }
.analysis-stages { display: grid; gap: 13px; margin: 0; padding: 0; list-style: none; }
.analysis-stage { display: grid; grid-template-columns: 25px minmax(0, 1fr) auto; align-items: center; gap: 11px; color: var(--ss-soft-muted); font-size: 13px; }
.stage-icon { display: grid; width: 25px; height: 25px; place-items: center; border: 1px solid var(--ss-line); border-radius: 50%; color: var(--ss-soft-muted); font-size: 12px; }
.analysis-stage.complete { color: var(--ss-muted); }
.analysis-stage.complete .stage-icon { border-color: color-mix(in srgb, var(--ss-primary) 42%, var(--ss-line)); color: #fff; background: var(--ss-primary); }
.analysis-stage.active { color: var(--ss-ink); font-weight: 750; }
.analysis-stage.active .stage-icon { border-color: var(--ss-primary); color: var(--ss-primary); background: var(--ss-secondary); box-shadow: 0 0 0 4px color-mix(in srgb, var(--ss-secondary) 70%, transparent); }
.stage-status { font-size: 11px; font-weight: 650; }
.analysis-bar { height: 5px; margin-top: 29px; overflow: hidden; border-radius: 10px; background: color-mix(in srgb, var(--ss-line) 72%, white); }
.analysis-bar span { display: block; height: 100%; border-radius: inherit; background: var(--ss-primary); transition: width 350ms ease; }
.results-content { padding-top: 28px; }
.results-intro { display: grid; gap: 9px; margin-bottom: 26px; }
.results-kicker { margin-bottom: 0; }
.results-summary { max-width: 680px; margin: 0; color: var(--ss-muted); font-size: 15px; line-height: 1.55; }
.section-label { margin: 26px 0 12px; color: var(--ss-primary); font-size: 10px; font-weight: 850; letter-spacing: .15em; text-transform: uppercase; }
.featured-card { display: grid; grid-template-columns: minmax(260px, 1.05fr) minmax(0, .95fr); overflow: hidden; border: 1px solid var(--ss-line); border-radius: var(--ss-radius-card); background: var(--ss-surface-strong); box-shadow: 0 10px 30px rgba(24, 49, 35, .06); }
.featured-image { min-height: 310px; overflow: hidden; background: var(--ss-secondary); }
.featured-image img, .article-image img { width: 100%; height: 100%; object-fit: cover; }
.image-fallback { display: grid; width: 100%; height: 100%; min-height: inherit; place-items: center; color: color-mix(in srgb, var(--ss-primary) 60%, white); background: linear-gradient(135deg, var(--ss-secondary), color-mix(in srgb, var(--ss-secondary) 55%, white)); }
.image-fallback svg { width: 48px; height: 48px; }
.featured-body { display: flex; flex-direction: column; justify-content: center; min-width: 0; padding: 28px; }
.article-meta { display: flex; flex-wrap: wrap; gap: 7px 12px; margin-bottom: 10px; color: var(--ss-muted); font-size: 10px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
.best-badge { display: inline-flex; align-items: center; width: fit-content; margin-bottom: 14px; padding: 6px 9px; border-radius: 999px; color: var(--ss-primary); background: var(--ss-secondary); font-size: 10px; font-weight: 850; letter-spacing: .12em; text-transform: uppercase; }
.featured-card h3 { margin: 0 0 10px; font-family: Georgia, serif; font-size: clamp(27px, 4vw, 39px); font-weight: 500; letter-spacing: -.055em; line-height: .99; }
.article-description { margin: 0 0 15px; color: var(--ss-muted); font-size: 13px; line-height: 1.5; }
.why { margin: 0 0 17px; padding: 12px 13px; border-left: 2px solid var(--ss-primary); color: #435046; background: var(--ss-secondary); font-size: 12px; line-height: 1.48; }
.why strong { display: block; margin-bottom: 4px; color: var(--ss-primary); font-size: 10px; letter-spacing: .1em; text-transform: uppercase; }
.featured-card a, .article-card a { display: inline-flex; align-items: center; gap: 6px; width: fit-content; color: var(--ss-primary); font-size: 12px; font-weight: 850; text-decoration: none; }
.featured-card a:hover, .article-card a:hover { text-decoration: underline; }
.article-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 13px; }
.article-card { display: grid; grid-template-columns: 120px minmax(0, 1fr); gap: 15px; padding: 11px; border: 1px solid var(--ss-line); border-radius: var(--ss-radius-card); background: var(--ss-surface-strong); }
.article-image { width: 120px; height: 143px; overflow: hidden; border-radius: 11px; background: var(--ss-secondary); }
.article-body { min-width: 0; padding: 3px 5px 3px 0; }
.article-card h3 { margin: 0 0 8px; font-family: Georgia, serif; font-size: 21px; font-weight: 500; letter-spacing: -.04em; line-height: 1.08; }
.result-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 25px; }
.empty, .error { max-width: 440px; margin: 26px auto; padding: 35px 12px; text-align: center; }
.empty h2, .error h2 { margin: 0 0 10px; font-family: Georgia, serif; font-size: 30px; font-weight: 500; letter-spacing: -.05em; line-height: 1.05; }
.empty p, .error p { margin: 0 auto 22px; color: var(--ss-muted); font-size: 14px; line-height: 1.55; }
@keyframes panel-enter { from { opacity: 0; transform: translateY(12px) scale(.985); } to { opacity: 1; transform: none; } }
@keyframes view-enter { from { opacity: 0; transform: translateX(8px); } to { opacity: 1; transform: none; } }
@keyframes breathe { 0%, 100% { transform: scale(.96); } 50% { transform: scale(1.04); } }
@media (max-width: 760px) { .panel--results { width: min(710px, calc(100vw - 24px)); } .article-grid { grid-template-columns: 1fr; } }
@media (max-width: 560px) {
  :host, :host([data-position="bottom-left"]) { right: 12px; left: auto; bottom: max(12px, env(safe-area-inset-bottom)); }
  .launcher { min-height: 50px; padding: 0 16px; font-size: 13px; }
  .panel, .panel--results { position: fixed; right: 0; bottom: 0; width: 100vw; max-height: 100dvh; min-height: 100dvh; border-right: 0; border-bottom: 0; border-left: 0; border-radius: var(--ss-radius-panel) var(--ss-radius-panel) 0 0; }
  .panel--results { border-radius: 0; }
  .panel-head { padding: 20px 19px 17px; }
  .content { padding: 22px 19px max(25px, env(safe-area-inset-bottom)); }
  .intro { min-height: calc(100dvh - 140px); justify-content: center; padding: 10px 4px 28px; }
  .intro-heading { font-size: clamp(36px, 11vw, 50px); }
  .question-heading { font-size: 32px; }
  .option { min-height: 60px; padding: 16px 14px; }
  .analysis-content { min-height: calc(100dvh - 145px); }
  .featured-card { display: block; }
  .featured-image { min-height: 210px; max-height: 240px; }
  .featured-body { padding: 22px 19px 23px; }
  .featured-card h3 { font-size: 29px; }
  .article-card { grid-template-columns: 95px minmax(0, 1fr); gap: 12px; }
  .article-image { width: 95px; height: 112px; }
  .article-card h3 { font-size: 19px; }
  .article-description { display: none; }
  .result-actions { justify-content: stretch; }
  .result-actions .button { flex: 1; padding: 0 10px; }
}
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; scroll-behavior: auto !important; transition-duration: .01ms !important; } }
`;
