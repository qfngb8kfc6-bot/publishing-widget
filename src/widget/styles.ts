export const widgetStyles = `
:host {
  --ss-font: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --ss-primary: #244d3b;
  --ss-secondary: #e8efe6;
  --ss-ink: #18231d;
  --ss-muted: #667169;
  --ss-soft-muted: #89958c;
  --ss-line: #dce5dc;
  --ss-surface: rgba(251, 253, 250, .94);
  --ss-surface-strong: #ffffff;
  --ss-shadow: 0 24px 90px rgba(19, 39, 28, .24), 0 4px 18px rgba(19, 39, 28, .08);
  --ss-radius-panel: 25px;
  --ss-radius-control: 14px;
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
button:focus-visible, input:focus-visible { outline: 3px solid color-mix(in srgb, var(--ss-primary) 62%, #d6a72c); outline-offset: 3px; }
.launcher {
  display: inline-flex;
  align-items: center;
  gap: 13px;
  min-width: min(390px, calc(100vw - 28px));
  min-height: 66px;
  padding: 9px 13px 9px 16px;
  border: 1px solid color-mix(in srgb, var(--ss-primary) 46%, white);
  border-radius: 999px;
  color: #fff;
  background: color-mix(in srgb, var(--ss-primary) 92%, #10291c);
  box-shadow: 0 16px 42px rgba(17, 53, 31, .25), inset 0 1px 0 rgba(255,255,255,.2);
  text-align: left;
  transition: transform var(--ss-duration) ease, box-shadow var(--ss-duration) ease;
}
.launcher:hover { transform: translateY(-3px); box-shadow: 0 21px 48px rgba(17, 53, 31, .31), inset 0 1px 0 rgba(255,255,255,.2); }
.launcher:active { transform: translateY(0); }
.launcher-mark { display: grid; flex: 0 0 auto; width: 38px; height: 38px; place-items: center; border: 1px solid rgba(255,255,255,.42); border-radius: 50%; color: var(--ss-primary); background: #f4fbf2; font-size: 17px; font-weight: 900; }
.launcher-copy { display: grid; min-width: 0; gap: 2px; }
.launcher-copy small { overflow: hidden; color: rgba(255,255,255,.67); font-size: 9px; font-weight: 850; letter-spacing: .14em; text-overflow: ellipsis; text-transform: uppercase; white-space: nowrap; }
.launcher-copy strong { overflow: hidden; font-size: 14px; font-weight: 760; letter-spacing: -.01em; text-overflow: ellipsis; white-space: nowrap; }
.launcher-arrow { display: grid; flex: 0 0 auto; width: 35px; height: 35px; margin-left: auto; place-items: center; border-radius: 50%; color: var(--ss-primary); background: #fff; font-size: 17px; font-weight: 900; }
.panel { display: flex; flex-direction: column; width: min(960px, calc(100vw - 28px)); max-height: min(330px, calc(100dvh - 28px)); overflow: hidden; border: 1px solid rgba(255,255,255,.83); border-radius: var(--ss-radius-panel); background: var(--ss-surface); box-shadow: var(--ss-shadow); backdrop-filter: blur(24px); animation: panel-enter 240ms cubic-bezier(.2,.8,.2,1) both; }
.panel-head { display: flex; align-items: center; justify-content: space-between; gap: 24px; padding: 19px 23px 15px; border-bottom: 1px solid color-mix(in srgb, var(--ss-line) 82%, transparent); background: linear-gradient(110deg, color-mix(in srgb, var(--ss-secondary) 75%, white), rgba(255,255,255,.64)); }
.panel-branding { display: flex; align-items: center; gap: 12px; min-width: 0; }
.publisher-mark { display: grid; flex: 0 0 auto; width: 36px; height: 36px; place-items: center; border-radius: 12px; color: var(--ss-primary); background: #fff; box-shadow: 0 4px 12px rgba(25, 58, 35, .1); font-size: 14px; font-weight: 900; }
.publisher-logo { display: block; width: auto; max-width: 150px; height: 31px; object-fit: contain; object-position: left center; }
.panel-branding > div { min-width: 0; }
.eyebrow, .intro-kicker { margin: 0 0 4px; color: var(--ss-primary); font-size: 9px; font-weight: 850; letter-spacing: .16em; text-transform: uppercase; }
.panel-title { overflow: hidden; margin: 0; color: var(--ss-ink); font-family: Georgia, "Times New Roman", serif; font-size: clamp(21px, 3vw, 30px); font-weight: 500; letter-spacing: -.05em; line-height: 1.02; text-overflow: ellipsis; white-space: nowrap; }
.icon-button { display: grid; flex: 0 0 auto; width: 38px; height: 38px; place-items: center; border: 1px solid var(--ss-line); border-radius: 50%; color: var(--ss-muted); background: rgba(255,255,255,.72); font-size: 22px; line-height: 1; }
.icon-button:hover { color: var(--ss-ink); background: #fff; }
.content { display: grid; grid-template-columns: minmax(210px, .82fr) minmax(0, 1.65fr); align-items: center; gap: clamp(22px, 4vw, 58px); padding: 22px 24px 24px; }
.intro { min-width: 0; }
.intro-heading { max-width: 360px; margin: 0 0 8px; font-family: Georgia, "Times New Roman", serif; font-size: clamp(27px, 4vw, 42px); font-weight: 500; letter-spacing: -.06em; line-height: .96; }
.intro-copy { max-width: 350px; margin: 0; color: var(--ss-muted); font-size: 12px; line-height: 1.5; }
.profile-form { display: grid; grid-template-columns: minmax(140px, 1fr) minmax(140px, 1fr) auto; align-items: end; gap: 10px; min-width: 0; }
.profile-field { display: grid; gap: 6px; min-width: 0; color: var(--ss-muted); font-size: 11px; font-weight: 800; }
.profile-field span { padding-left: 3px; color: var(--ss-primary); font-size: 11px; }
input { width: 100%; min-height: 47px; border: 1px solid var(--ss-line); border-radius: var(--ss-radius-control); padding: 0 13px; color: var(--ss-ink); background: rgba(255,255,255,.88); box-shadow: inset 0 1px 2px rgba(21, 52, 30, .03); }
input::placeholder { color: #9aa59d; }
input:focus-visible { border-color: var(--ss-primary); outline-color: color-mix(in srgb, var(--ss-primary) 42%, #d6a72c); }
.button { display: inline-flex; align-items: center; justify-content: center; min-height: 47px; width: fit-content; padding: 0 18px; border: 1px solid var(--ss-primary); border-radius: 999px; color: #fff; background: var(--ss-primary); font-size: 12px; font-weight: 850; white-space: nowrap; transition: opacity var(--ss-duration) ease, transform var(--ss-duration) ease, box-shadow var(--ss-duration) ease; }
.button:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 8px 18px color-mix(in srgb, var(--ss-primary) 22%, transparent); }
.button:disabled { cursor: not-allowed; opacity: .45; }
.button-wide { min-width: 151px; }
.profile-error { grid-column: 1 / -1; min-height: 1.2em; margin: 0; color: #9a3c34; font-size: 11px; }
.content-note { grid-column: 2; margin: -4px 0 0; color: var(--ss-soft-muted); font-size: 10px; }
.error-state { display: block; padding: 34px 26px 38px; text-align: center; }
.error-state h2 { margin: 0 0 8px; font-family: Georgia, serif; font-size: 27px; font-weight: 500; letter-spacing: -.05em; }
.error-state p:not(.intro-kicker) { max-width: 400px; margin: 0 auto 20px; color: var(--ss-muted); font-size: 13px; line-height: 1.5; }
@keyframes panel-enter { from { opacity: 0; transform: translateY(12px) scale(.985); } to { opacity: 1; transform: none; } }
@media (max-width: 700px) {
  :host, :host([data-position="bottom-left"]) { right: 12px; left: 12px; bottom: max(12px, env(safe-area-inset-bottom)); transform: none; }
  .launcher { width: 100%; min-width: 0; min-height: 61px; }
  .panel { width: 100%; max-height: min(650px, calc(100dvh - 24px)); border-radius: var(--ss-radius-panel) var(--ss-radius-panel) 18px 18px; }
  .panel-head { padding: 17px 18px 14px; }
  .content { display: block; overflow-y: auto; padding: 20px 18px max(20px, env(safe-area-inset-bottom)); }
  .intro { margin-bottom: 21px; }
  .intro-heading { max-width: 490px; font-size: clamp(32px, 10vw, 48px); }
  .intro-copy { max-width: 500px; font-size: 13px; }
  .profile-form { grid-template-columns: 1fr 1fr; gap: 11px; }
  .profile-form .button { grid-column: 1 / -1; width: 100%; }
   .content-note { margin-top: 13px; text-align: center; }
   :host([data-position="bottom-left"]) { right: auto; left: 12px; }
 }
@media (max-width: 430px) {
  .panel-title { max-width: 245px; }
  .profile-form { grid-template-columns: 1fr; }
  .profile-error, .profile-form .button { grid-column: auto; }
  .profile-form .button { width: 100%; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; }
}
`;
