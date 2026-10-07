export const widgetStyles = `
:host {
  --ss-font: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --ss-primary: #244d3b;
  --ss-secondary: #e8efe6;
  --ss-ink: #24252b;
  --ss-muted: #4d4e55;
  --ss-line: #dedfe4;
  --ss-surface: rgba(255, 255, 255, .94);
  --ss-shadow: 0 10px 26px rgba(45, 45, 68, .13);
  --ss-radius-panel: 38px;
  --ss-radius-control: 23px;
  --ss-ai-purple: #6751d9;
  --ss-ai-blue: #28208b;
  --ss-ai-cyan: #079ca7;
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
*, *::before, *::after { box-sizing: border-box; }
button, input { font: inherit; }
button { cursor: pointer; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
button:focus-visible, input:focus-visible { outline: 3px solid color-mix(in srgb, var(--ss-ai-purple) 56%, var(--ss-ai-cyan)); outline-offset: 3px; }

/* Idle state: the same quiet white capsule language as the expanded control. */
.launcher {
  display: inline-flex;
  align-items: center;
  gap: 11px;
  min-width: min(320px, calc(100vw - 32px));
  min-height: 54px;
  padding: 7px 10px 7px 13px;
  border: 1px solid rgba(255,255,255,.92);
  border-radius: 999px;
  color: var(--ss-ink);
  background: rgba(255,255,255,.89);
  box-shadow: 0 0 0 1px rgba(103,81,217,.08), 0 10px 26px rgba(45,45,68,.13);
  backdrop-filter: blur(16px);
  text-align: left;
  transition: transform var(--ss-duration) ease, box-shadow var(--ss-duration) ease;
}
.launcher:hover { transform: translateY(-2px); box-shadow: 0 0 0 1px rgba(103,81,217,.13), 0 14px 31px rgba(45,45,68,.17); }
.launcher:active { transform: translateY(0); }
.launcher-mark { display: grid; flex: 0 0 auto; width: 32px; height: 32px; place-items: center; border: 1px solid rgba(255,255,255,.9); border-radius: 50%; color: #fff; background: linear-gradient(135deg, var(--ss-ai-purple), var(--ss-ai-cyan)); box-shadow: 0 3px 8px rgba(103,81,217,.18); font-size: 14px; font-weight: 900; }
.launcher-copy { display: grid; min-width: 0; gap: 1px; }
.launcher-copy small { overflow: hidden; color: #7c7d84; font-size: 8px; font-weight: 800; letter-spacing: .12em; text-overflow: ellipsis; text-transform: uppercase; white-space: nowrap; }
.launcher-copy strong { overflow: hidden; color: var(--ss-ink); font-size: 13px; font-weight: 700; letter-spacing: -.01em; text-overflow: ellipsis; white-space: nowrap; }
.launcher-arrow { display: grid; flex: 0 0 auto; width: 30px; height: 30px; margin-left: auto; place-items: center; border-radius: 50%; color: #fff; background: linear-gradient(110deg, var(--ss-ai-blue), var(--ss-ai-cyan)); font-size: 15px; font-weight: 900; }

/* Expanded state: one uninterrupted reference-style horizontal capsule. */
.panel { width: min(740px, calc(100vw - 32px)); padding: 1px; border: 0; border-radius: calc(var(--ss-radius-panel) + 1px); background: linear-gradient(105deg, rgba(103,81,217,.5), rgba(187,180,239,.3) 42%, rgba(7,156,167,.42)); box-shadow: 0 0 0 1px rgba(255,255,255,.72), 0 0 18px rgba(103,81,217,.08), var(--ss-shadow); animation: panel-enter 220ms cubic-bezier(.2,.8,.2,1) both; }
.panel-inner { position: relative; overflow: hidden; border-radius: var(--ss-radius-panel); background: var(--ss-surface); backdrop-filter: blur(18px); }
.panel-inner::before { position: absolute; z-index: 0; top: 0; right: 16%; left: 16%; height: 1px; content: ""; background: rgba(255,255,255,.95); }
.profile-form { position: relative; z-index: 1; display: grid; grid-template-columns: auto minmax(170px, 1fr) auto minmax(188px, 1.08fr) auto minmax(194px, 1.1fr); align-items: center; gap: 8px; min-height: 72px; padding: 11px 10px 11px 16px; }
.profile-field { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 8px; min-width: 0; min-height: 47px; padding: 4px 11px 4px 13px; border: 1px solid rgba(207,208,214,.9); border-radius: var(--ss-radius-control); background: rgba(248,249,250,.88); box-shadow: inset 0 1px 2px rgba(35,35,50,.035), 0 2px 6px rgba(35,35,50,.035); transition: border-color var(--ss-duration) ease, box-shadow var(--ss-duration) ease, background var(--ss-duration) ease; }
.profile-field:focus-within { border-color: color-mix(in srgb, var(--ss-ai-purple) 52%, var(--ss-ai-cyan)); background: #fff; box-shadow: 0 0 0 3px rgba(103,81,217,.09), inset 0 1px 2px rgba(35,35,50,.035), 0 4px 10px rgba(65,72,102,.08); }
.profile-field > span:first-child { color: #393a40; font-size: 15px; font-weight: 650; line-height: 1; white-space: nowrap; }
.input-shell { display: flex; align-items: center; min-width: 0; gap: 6px; }
.field-icon { display: block; flex: 0 0 auto; width: 17px; height: 17px; fill: none; stroke: #85868d; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.45; }
input { width: 100%; min-width: 0; min-height: 37px; border: 0; padding: 0; color: #2f3036; outline: 0; background: transparent; font-size: 15px; font-weight: 500; }
input::placeholder { color: #878990; opacity: 1; }
.field-flow { color: #3d3e44; font-size: 15px; font-weight: 650; line-height: 1; white-space: nowrap; }
.field-arrow { display: grid; width: 20px; height: 24px; place-items: center; color: #32333a; font-size: 20px; font-weight: 500; line-height: 1; }
.button { display: inline-flex; align-items: center; justify-content: center; min-height: 48px; width: 100%; padding: 0 14px; border: 1px solid rgba(255,255,255,.35); border-radius: 25px; color: #fff; background: linear-gradient(105deg, #18156f, #28208b 42%, #079ca7); box-shadow: 0 5px 11px rgba(31,29,113,.18), inset 0 1px 1px rgba(255,255,255,.2); font-size: 15px; font-weight: 700; line-height: 1; white-space: nowrap; transition: filter var(--ss-duration) ease, transform var(--ss-duration) ease, box-shadow var(--ss-duration) ease; }
.button:hover:not(:disabled) { filter: brightness(1.07) saturate(1.04); transform: translateY(-1px); box-shadow: 0 7px 14px rgba(31,29,113,.22), inset 0 1px 1px rgba(255,255,255,.25); }
.button:active:not(:disabled) { transform: translateY(0); }
.button:disabled { cursor: not-allowed; opacity: .45; }
.button-wide { min-width: 194px; }
.button-spark { margin-right: 7px; order: -1; color: rgba(255,255,255,.9); font-size: 13px; }
.profile-error { grid-column: 1 / -1; min-height: 1.2em; margin: -4px 0 0; color: #9a3c34; font-size: 11px; }
.profile-error:empty { display: none; }
.icon-button { position: absolute; z-index: 3; top: 7px; right: 7px; display: grid; width: 20px; height: 20px; place-items: center; padding: 0; border: 0; border-radius: 50%; color: #777881; background: transparent; font-size: 16px; line-height: 1; opacity: .62; }
.icon-button:hover { color: #2d2e34; background: rgba(235,236,239,.7); opacity: 1; }
.error-state { display: grid; justify-items: center; gap: 8px; padding: 25px; text-align: center; }
.error-state h2 { margin: 0; font-family: Georgia, serif; font-size: 24px; font-weight: 500; letter-spacing: -.04em; }
.error-state p { max-width: 390px; margin: 0 0 8px; color: var(--ss-muted); font-size: 13px; line-height: 1.45; }
@keyframes panel-enter { from { opacity: 0; transform: translateY(7px) scale(.99); } to { opacity: 1; transform: none; } }

@media (max-width: 760px) and (min-width: 621px) {
  .profile-form { grid-template-columns: auto minmax(135px, 1fr) auto minmax(150px, 1fr) auto minmax(165px, 1fr); gap: 6px; padding-left: 11px; padding-right: 7px; }
  .profile-field > span:first-child, .field-flow { font-size: 13px; }
  input { font-size: 13px; }
  .button { font-size: 13px; }
  .button-wide { min-width: 165px; }
}
@media (max-width: 620px) {
  :host, :host([data-position="bottom-left"]) { right: 12px; left: 12px; bottom: max(12px, env(safe-area-inset-bottom)); transform: none; }
  :host([data-position="bottom-left"]) { right: auto; left: 12px; }
  .launcher { width: 100%; min-width: 0; }
  .panel { width: 100%; border-radius: var(--ss-radius-panel) var(--ss-radius-panel) 18px 18px; }
  .profile-form { grid-template-columns: 1fr; gap: 10px; min-height: 0; padding: 16px; }
  .profile-field { min-height: 50px; }
  .field-flow { display: none; }
  .field-arrow { display: none; }
  .profile-form .button { min-height: 50px; }
  .profile-error { grid-column: auto; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; }
}
`;
