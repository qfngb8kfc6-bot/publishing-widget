export const widgetStyles = `
:host {
  --ss-font: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --ss-primary: #244d3b;
  --ss-secondary: #e8efe6;
  --ss-ink: #18231d;
  --ss-muted: #667169;
  --ss-soft-muted: #89958c;
  --ss-line: #dce5dc;
  --ss-surface: rgba(252, 254, 252, .84);
  --ss-surface-strong: rgba(255, 255, 255, .92);
  --ss-shadow: 0 24px 80px rgba(19, 39, 28, .22), 0 4px 18px rgba(19, 39, 28, .08);
  --ss-radius-panel: 25px;
  --ss-radius-control: 14px;
  --ss-ai-blue: #4d7cff;
  --ss-ai-cyan: #49d8dd;
  --ss-duration: 180ms;
  all: initial;
  display: block;
  position: fixed;
  z-index: 2147483000;
  right: 50%;
  bottom: max(22px, env(safe-area-inset-bottom));
  color: var(--ss-ink);
  font-family: var(--ss-font);
  transform: translateX(50%);
}
:host([data-position="bottom-left"]) { right: auto; left: 22px; transform: none; }
*, *::before, *::after { box-sizing: border-box; }
button, input { font: inherit; }
button { cursor: pointer; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
button:focus-visible, input:focus-visible { outline: 3px solid color-mix(in srgb, var(--ss-ai-blue) 64%, var(--ss-ai-cyan)); outline-offset: 3px; }

.launcher {
  display: inline-flex;
  align-items: center;
  gap: 13px;
  min-width: min(390px, calc(100vw - 28px));
  min-height: 62px;
  padding: 8px 11px 8px 14px;
  border: 1px solid rgba(255,255,255,.86);
  border-radius: 999px;
  color: var(--ss-ink);
  background: linear-gradient(rgba(255,255,255,.88),rgba(247,251,249,.76)) padding-box, linear-gradient(105deg, rgba(77,124,255,.42), rgba(73,216,221,.36), color-mix(in srgb, var(--ss-primary) 28%, white)) border-box;
  box-shadow: 0 0 0 1px rgba(255,255,255,.4), 0 16px 42px rgba(27, 49, 73, .2), 0 0 26px rgba(77,124,255,.1);
  backdrop-filter: blur(22px) saturate(1.15);
  text-align: left;
  transition: transform var(--ss-duration) ease, box-shadow var(--ss-duration) ease;
}
.launcher:hover { transform: translateY(-3px); box-shadow: 0 0 0 1px rgba(255,255,255,.5), 0 21px 48px rgba(27, 49, 73, .25), 0 0 32px rgba(77,124,255,.16); }
.launcher:active { transform: translateY(0); }
.launcher-mark { display: grid; flex: 0 0 auto; width: 36px; height: 36px; place-items: center; border: 1px solid rgba(255,255,255,.92); border-radius: 50%; color: #fff; background: linear-gradient(135deg, var(--ss-ai-blue), var(--ss-ai-cyan)); box-shadow: 0 4px 12px rgba(77,124,255,.22), inset 0 1px 1px rgba(255,255,255,.65); font-size: 16px; font-weight: 900; }
.launcher-copy { display: grid; min-width: 0; gap: 2px; }
.launcher-copy small { overflow: hidden; color: var(--ss-muted); font-size: 9px; font-weight: 850; letter-spacing: .14em; text-overflow: ellipsis; text-transform: uppercase; white-space: nowrap; }
.launcher-copy strong { overflow: hidden; color: var(--ss-ink); font-size: 14px; font-weight: 760; letter-spacing: -.015em; text-overflow: ellipsis; white-space: nowrap; }
.launcher-arrow { display: grid; flex: 0 0 auto; width: 34px; height: 34px; margin-left: auto; place-items: center; border-radius: 50%; color: #fff; background: linear-gradient(135deg, var(--ss-ai-blue), var(--ss-ai-cyan)); box-shadow: inset 0 1px 1px rgba(255,255,255,.55); font-size: 17px; font-weight: 900; }

.panel { width: min(970px, calc(100vw - 28px)); overflow: visible; padding: 1px; border: 0; border-radius: calc(var(--ss-radius-panel) + 1px); background: linear-gradient(105deg, rgba(77,124,255,.65), rgba(73,216,221,.5) 42%, color-mix(in srgb, var(--ss-primary) 34%, white)); box-shadow: 0 0 0 1px rgba(255,255,255,.76), 0 0 30px rgba(77,124,255,.12), var(--ss-shadow); animation: panel-enter 260ms cubic-bezier(.2,.8,.2,1) both; }
.panel-inner { position: relative; overflow: hidden; border-radius: var(--ss-radius-panel); background: linear-gradient(110deg, color-mix(in srgb, var(--ss-secondary) 25%, var(--ss-surface-strong)), var(--ss-surface)); backdrop-filter: blur(25px) saturate(1.15); }
.panel-inner::before { position: absolute; top: 0; right: 12%; left: 12%; height: 1px; content: ""; background: linear-gradient(90deg, transparent, rgba(255,255,255,.95), transparent); }
.icon-button { position: absolute; z-index: 2; top: 13px; right: 15px; display: grid; width: 30px; height: 30px; place-items: center; border: 1px solid rgba(178,191,202,.6); border-radius: 50%; color: var(--ss-muted); background: rgba(255,255,255,.5); font-size: 18px; line-height: 1; }
.icon-button:hover { color: var(--ss-ink); background: #fff; }
.profile-form { display: grid; grid-template-columns: minmax(150px, .85fr) minmax(175px, 1fr) auto minmax(175px, 1fr) auto minmax(140px, .85fr); align-items: center; gap: 10px; min-width: 0; padding: 13px 16px 13px 19px; }
.capsule-brand { display: flex; align-items: center; gap: 9px; min-width: 0; padding-right: 12px; }
.capsule-brand-mark { display: grid; flex: 0 0 auto; width: 30px; height: 30px; place-items: center; border-radius: 10px; color: var(--ss-primary); background: rgba(255,255,255,.8); box-shadow: 0 4px 12px rgba(23, 57, 37, .08); }
.capsule-brand-mark .publisher-mark { width: 30px; height: 30px; border-radius: 10px; box-shadow: none; font-size: 12px; }
.capsule-brand-mark .publisher-logo { max-width: 78px; height: 24px; }
.capsule-brand-copy { display: grid; min-width: 0; gap: 2px; }
.capsule-brand-copy > span { overflow: hidden; color: var(--ss-muted); font-size: 8px; font-weight: 850; letter-spacing: .11em; text-overflow: ellipsis; text-transform: uppercase; white-space: nowrap; }
.capsule-brand-copy h1 { overflow: hidden; max-width: 145px; margin: 0; color: var(--ss-ink); font-family: Georgia, "Times New Roman", serif; font-size: 15px; font-weight: 500; letter-spacing: -.04em; line-height: 1.05; text-overflow: ellipsis; white-space: nowrap; }
.profile-field { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 8px; min-width: 0; min-height: 49px; padding: 5px 10px 5px 12px; border: 1px solid rgba(202,213,216,.78); border-radius: var(--ss-radius-control); background: rgba(255,255,255,.73); box-shadow: inset 0 1px 2px rgba(26,52,67,.035), 0 2px 8px rgba(35,56,67,.035); transition: border-color var(--ss-duration) ease, box-shadow var(--ss-duration) ease, background var(--ss-duration) ease; }
.profile-field:focus-within { border-color: color-mix(in srgb, var(--ss-ai-blue) 62%, var(--ss-ai-cyan)); background: rgba(255,255,255,.95); box-shadow: 0 0 0 3px rgba(77,124,255,.1), 0 5px 15px rgba(58,110,153,.1), inset 0 1px 2px rgba(26,52,67,.03); }
.profile-field > span:first-child:not(.input-shell) { color: var(--ss-muted); font-size: 10px; font-weight: 800; white-space: nowrap; }
.mobile-role-label { display: none; }
.input-shell { display: flex; align-items: center; min-width: 0; gap: 5px; }
.field-icon { display: grid; flex: 0 0 auto; width: 20px; height: 20px; place-items: center; color: color-mix(in srgb, var(--ss-primary) 58%, var(--ss-ai-blue)); font-size: 14px; font-weight: 700; }
input { width: 100%; min-width: 0; min-height: 37px; border: 0; padding: 0; color: var(--ss-ink); outline: 0; background: transparent; font-size: 13px; }
input::placeholder { color: #9aa5a8; opacity: 1; }
.field-flow { color: var(--ss-soft-muted); font-size: 11px; font-weight: 750; white-space: nowrap; }
.field-arrow { display: grid; width: 26px; height: 26px; place-items: center; color: var(--ss-ai-blue); font-size: 17px; font-weight: 800; }
.button { display: inline-flex; align-items: center; justify-content: center; min-height: 49px; width: fit-content; padding: 0 17px; border: 1px solid rgba(255,255,255,.72); border-radius: 999px; color: #fff; background: linear-gradient(110deg, #4d70ff, #4b9df7 52%, #45d3d1); box-shadow: 0 7px 17px rgba(69,126,237,.24), inset 0 1px 1px rgba(255,255,255,.6); font-size: 12px; font-weight: 850; white-space: nowrap; transition: transform var(--ss-duration) ease, filter var(--ss-duration) ease, box-shadow var(--ss-duration) ease; }
.button:hover:not(:disabled) { filter: saturate(1.08) brightness(1.04); transform: translateY(-2px); box-shadow: 0 10px 21px rgba(69,126,237,.29), inset 0 1px 1px rgba(255,255,255,.72); }
.button:active:not(:disabled) { transform: translateY(0); }
.button:disabled { cursor: not-allowed; opacity: .45; }
.button-wide { min-width: 155px; }
.button-spark { margin-left: 8px; color: rgba(255,255,255,.88); font-size: 13px; }
.profile-error { grid-column: 2 / -1; min-height: 1.2em; margin: -4px 0 0; color: #9a3c34; font-size: 10px; }
.content-note { grid-column: 2 / -1; margin: -4px 0 0; color: var(--ss-soft-muted); font-size: 10px; line-height: 1.3; }
.error-state { display: grid; justify-items: center; padding: 35px 28px 38px; text-align: center; }
.error-state h2 { margin: 0 0 8px; font-family: Georgia, serif; font-size: 27px; font-weight: 500; letter-spacing: -.05em; }
.error-state p:not(.intro-kicker) { max-width: 400px; margin: 0 auto 20px; color: var(--ss-muted); font-size: 13px; line-height: 1.5; }
@keyframes panel-enter { from { opacity: 0; transform: translateY(10px) scale(.985); } to { opacity: 1; transform: none; } }
@media (max-width: 820px) {
  :host, :host([data-position="bottom-left"]) { right: 12px; left: 12px; bottom: max(12px, env(safe-area-inset-bottom)); transform: none; }
  :host([data-position="bottom-left"]) { right: auto; left: 12px; }
  .launcher { width: 100%; min-width: 0; }
  .panel { width: 100%; }
   .profile-form { grid-template-columns: minmax(140px, 1fr) auto minmax(140px, 1fr) auto minmax(130px, .9fr); }
  .capsule-brand { display: none; }
  .profile-error, .content-note { grid-column: 1 / -1; }
}
@media (max-width: 620px) {
  .panel { border-radius: var(--ss-radius-panel) var(--ss-radius-panel) 18px 18px; }
  .profile-form { grid-template-columns: 1fr 1fr; gap: 11px; padding: 19px 17px max(19px, env(safe-area-inset-bottom)); }
  .profile-field { min-height: 52px; }
   .field-flow { display: none; }
   .field-arrow { display: none; }
   .mobile-role-label { display: inline; }
  .profile-form .button { grid-column: 1 / -1; width: 100%; min-height: 50px; }
  .profile-error, .content-note { grid-column: 1 / -1; }
}
@media (max-width: 430px) {
  .profile-form { grid-template-columns: 1fr; }
  .profile-form .button, .profile-error, .content-note { grid-column: auto; }
  .profile-form .button { width: 100%; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; }
}
`;
