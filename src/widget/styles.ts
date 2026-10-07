import { DEFAULT_THEME } from '../core/theme';

export const widgetStyles = `
:host {
  --ss-font: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --ss-primary: ${DEFAULT_THEME.indigo};
  --ss-ink: #24252b;
  --ss-muted: #5d5e66;
  --ss-line: #dedfe4;
  --ss-surface: rgba(247,248,250,.96);
  --ss-radius-panel: 38px;
  --ss-radius-control: 23px;
  --ss-ai-purple: #6751d9;
  --ss-ai-blue: #28208b;
  --ss-ai-cyan: #079ca7;
  --ss-shadow: 0 10px 26px rgba(45,45,68,.13);
  --ss-duration: 180ms;
  all: initial;
  display: block;
  position: fixed;
  z-index: 2147483000;
  right: 50%;
  bottom: max(24px, env(safe-area-inset-bottom));
  color: var(--ss-ink);
  font-family: var(--ss-font);
  transform: translateX(50%);
}
:host([data-position="bottom-left"]) { right: auto; left: 22px; transform: none; }
*,*::before,*::after { box-sizing: border-box; }
button,input { font: inherit; }
button { cursor: pointer; }
button:focus-visible,input:focus-visible { outline: 3px solid color-mix(in srgb,var(--ss-ai-purple) 56%,var(--ss-ai-cyan)); outline-offset: 3px; }

/* The expanded runtime is a single form capsule; there is no panel/header/content hierarchy. */
.briefing-bar { position:relative; display:grid; grid-template-columns:auto minmax(170px,1fr) auto minmax(188px,1.08fr) auto minmax(194px,1.1fr); align-items:center; gap:8px; width:min(740px,calc(100vw - 32px)); min-height:72px; padding:11px 10px 11px 16px; border:1px solid transparent; border-radius:var(--ss-radius-panel); background:linear-gradient(rgba(255,255,255,.96),rgba(250,251,252,.93)) padding-box,linear-gradient(105deg,rgba(103,81,217,.5),rgba(187,180,239,.3) 42%,rgba(7,156,167,.42)) border-box; box-shadow:0 0 0 1px rgba(255,255,255,.72),0 0 18px rgba(103,81,217,.08),var(--ss-shadow); backdrop-filter:blur(18px); animation:briefing-enter 220ms cubic-bezier(.2,.8,.2,1) both; }
.briefing-label { color:#393a40; font-size:15px; font-weight:650; line-height:1; white-space:nowrap; }
.briefing-field { display:flex; align-items:center; min-width:0; min-height:48px; gap:7px; padding:4px 11px 4px 13px; border:1px solid rgba(207,208,214,.9); border-radius:var(--ss-radius-control); background:rgba(248,249,250,.88); box-shadow:inset 0 1px 2px rgba(35,35,50,.035),0 2px 6px rgba(35,35,50,.035); transition:border-color var(--ss-duration) ease,box-shadow var(--ss-duration) ease,background var(--ss-duration) ease; }
.briefing-field:focus-within { border-color:color-mix(in srgb,var(--ss-ai-purple) 52%,var(--ss-ai-cyan)); background:#fff; box-shadow:0 0 0 3px rgba(103,81,217,.09),inset 0 1px 2px rgba(35,35,50,.035),0 4px 10px rgba(65,72,102,.08); }
.field-icon { display:block; flex:0 0 auto; width:17px; height:17px; fill:none; stroke:#85868d; stroke-linecap:round; stroke-linejoin:round; stroke-width:1.45; }
.briefing-field input { width:100%; min-width:0; min-height:37px; border:0; padding:0; color:#2f3036; outline:0; background:transparent; font-size:15px; font-weight:500; }
.briefing-field input::placeholder { color:#878990; opacity:1; }
.briefing-arrow { display:grid; width:20px; height:24px; place-items:center; color:#32333a; font-size:20px; font-weight:500; line-height:1; }
.briefing-submit { display:inline-flex; align-items:center; justify-content:center; width:194px; min-height:48px; padding:0 14px; border:1px solid rgba(255,255,255,.35); border-radius:25px; color:#fff; background:linear-gradient(105deg,#18156f,#28208b 42%,#079ca7); box-shadow:0 5px 11px rgba(31,29,113,.18),inset 0 1px 1px rgba(255,255,255,.2); font-size:15px; font-weight:700; line-height:1; white-space:nowrap; transition:filter var(--ss-duration) ease,transform var(--ss-duration) ease,box-shadow var(--ss-duration) ease; }
.briefing-submit:hover:not(:disabled) { filter:brightness(1.07) saturate(1.04); transform:translateY(-1px); box-shadow:0 7px 14px rgba(31,29,113,.22),inset 0 1px 1px rgba(255,255,255,.25); }
.briefing-submit:active:not(:disabled) { transform:translateY(0); }
.briefing-submit:disabled { cursor:not-allowed; opacity:.45; }
.briefing-spark { margin-right:7px; color:rgba(255,255,255,.9); font-size:13px; }
.profile-error { grid-column:1 / -1; min-height:1.2em; margin:-4px 0 0; color:#9a3c34; font-size:11px; }
.profile-error:empty { display:none; }
.close-control { position:absolute; z-index:4; top:-19px; right:7px; display:grid; width:18px; height:18px; place-items:center; padding:0; border:0; border-radius:50%; color:#777881; background:transparent; font-size:15px; line-height:1; opacity:.6; }
.close-control:hover { color:#2d2e34; background:rgba(235,236,239,.8); opacity:1; }
.error-state { display:grid; justify-items:center; gap:8px; width:min(740px,calc(100vw - 32px)); padding:25px; border-radius:var(--ss-radius-panel); background:var(--ss-surface); box-shadow:var(--ss-shadow); }
.error-state h2 { margin:0; font-family:Georgia,serif; font-size:24px; font-weight:500; letter-spacing:-.04em; }
.error-state p { max-width:390px; margin:0 0 8px; color:var(--ss-muted); font-size:13px; line-height:1.45; }
@keyframes briefing-enter { from { opacity:0; transform:translateY(7px) scale(.99); } to { opacity:1; transform:none; } }

@media (max-width:760px) and (min-width:621px) {
  .briefing-bar { grid-template-columns:auto minmax(135px,1fr) auto minmax(150px,1fr) auto minmax(165px,1fr); gap:6px; padding-left:11px; padding-right:7px; }
  .briefing-label { font-size:13px; }
  .briefing-field input { font-size:13px; }
  .briefing-submit { width:165px; font-size:13px; }
}
@media (max-width:620px) {
  :host, :host([data-position="bottom-left"]) { right:12px; left:12px; bottom:max(12px,env(safe-area-inset-bottom)); transform:none; }
  :host([data-position="bottom-left"]) { right:auto; left:12px; }
  .briefing-bar { grid-template-columns:1fr; gap:10px; width:100%; min-height:0; padding:16px; border-radius:var(--ss-radius-panel) var(--ss-radius-panel) 18px 18px; }
  .briefing-field { min-height:50px; }
  .briefing-arrow { display:none; }
  .briefing-submit { width:100%; min-height:50px; }
  .profile-error { grid-column:auto; }
}
@media (prefers-reduced-motion:reduce) {
  *,*::before,*::after { animation-duration:.01ms !important; animation-iteration-count:1 !important; transition-duration:.01ms !important; }
}
`;
