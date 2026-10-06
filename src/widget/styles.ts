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
  --ss-radius-control: 14px;
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
button, input { font: inherit; }
button { cursor: pointer; }
label { display: grid; gap: 7px; color: var(--ss-muted); font-size: 13px; font-weight: 700; }
input { width: 100%; border: 1px solid var(--ss-line); border-radius: var(--ss-radius-control); padding: 13px 14px; color: var(--ss-ink); background: var(--ss-surface-strong); }
input:focus-visible { outline: 3px solid #d6a72c; outline-offset: 2px; }
.launcher { display: inline-flex; align-items: center; gap: 11px; min-height: 54px; padding: 0 19px; border: 1px solid color-mix(in srgb, var(--ss-primary) 78%, white); border-radius: 999px; color: #fff; background: var(--ss-primary); box-shadow: 0 12px 30px rgba(24, 55, 40, .23), inset 0 1px 0 rgba(255,255,255,.18); font-size: 14px; font-weight: 750; letter-spacing: -.01em; transition: transform var(--ss-duration) ease, box-shadow var(--ss-duration) ease; }
.launcher:hover { transform: translateY(-2px); box-shadow: 0 16px 36px rgba(24, 55, 40, .28), inset 0 1px 0 rgba(255,255,255,.18); }
.launcher:active { transform: translateY(0); }
.launcher-mark { display: grid; width: 25px; height: 25px; place-items: center; border: 1px solid rgba(255,255,255,.42); border-radius: 50%; background: rgba(255,255,255,.09); }
.launcher:focus-visible, .icon-button:focus-visible, .button:focus-visible { outline: 3px solid #d6a72c; outline-offset: 3px; }
.panel { display: flex; flex-direction: column; width: min(620px, calc(100vw - 32px)); max-height: min(760px, calc(100dvh - 32px)); overflow: hidden; border: 1px solid rgba(255,255,255,.88); border-radius: var(--ss-radius-panel); background: var(--ss-surface); box-shadow: var(--ss-shadow); animation: panel-enter 240ms cubic-bezier(.2,.8,.2,1) both; }
.panel-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; padding: 24px 28px 20px; border-bottom: 1px solid color-mix(in srgb, var(--ss-line) 82%, transparent); background: linear-gradient(135deg, color-mix(in srgb, var(--ss-secondary) 70%, white), var(--ss-surface)); }
.panel-branding { min-width: 0; }
.publisher-logo { display: block; width: auto; max-width: 170px; height: 28px; margin: 0 0 10px; object-fit: contain; object-position: left center; }
.eyebrow, .intro-kicker { margin: 0 0 8px; color: var(--ss-primary); font-size: 10px; font-weight: 850; letter-spacing: .16em; text-transform: uppercase; }
.panel-title { margin: 0; color: var(--ss-ink); font-family: Georgia, "Times New Roman", serif; font-size: clamp(25px, 4vw, 35px); font-weight: 500; letter-spacing: -.05em; line-height: 1.03; }
.icon-button { display: grid; flex: 0 0 auto; width: 38px; height: 38px; place-items: center; border: 1px solid var(--ss-line); border-radius: 50%; color: var(--ss-muted); background: rgba(255,255,255,.72); font-size: 22px; line-height: 1; }
.icon-button:hover { color: var(--ss-ink); background: #fff; }
.content { min-height: 0; overflow-y: auto; padding: 28px 28px 30px; overscroll-behavior: contain; }
.intro { display: grid; justify-items: start; max-width: 570px; padding: 13px 10px 8px; }
.intro-heading { max-width: 510px; margin: 0 0 14px; font-family: Georgia, "Times New Roman", serif; font-size: clamp(33px, 6vw, 54px); font-weight: 500; letter-spacing: -.065em; line-height: .98; }
.intro-copy { max-width: 480px; margin: 0; color: var(--ss-muted); font-size: 15px; line-height: 1.6; }
.profile-form { display: grid; width: min(100%, 460px); gap: 14px; margin-top: 22px; }
.profile-error { min-height: 1.3em; margin: 0; color: #9a3c34; font-size: 13px; }
.button { display: inline-flex; align-items: center; justify-content: center; min-height: 45px; width: fit-content; padding: 0 19px; border: 1px solid var(--ss-primary); border-radius: 999px; color: #fff; background: var(--ss-primary); font-size: 13px; font-weight: 800; transition: opacity var(--ss-duration) ease, transform var(--ss-duration) ease, box-shadow var(--ss-duration) ease; }
.button:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 8px 18px color-mix(in srgb, var(--ss-primary) 20%, transparent); }
.button:disabled { cursor: not-allowed; opacity: .4; }
.button-wide { min-width: 164px; }
.error { max-width: 440px; margin: 26px auto; padding: 35px 12px; text-align: center; }
.error h2 { margin: 0 0 10px; font-family: Georgia, serif; font-size: 30px; font-weight: 500; letter-spacing: -.05em; line-height: 1.05; }
.error p { margin: 0 auto 22px; color: var(--ss-muted); font-size: 14px; line-height: 1.55; }
@keyframes panel-enter { from { opacity: 0; transform: translateY(12px) scale(.985); } to { opacity: 1; transform: none; } }
@media (max-width: 560px) {
  :host, :host([data-position="bottom-left"]) { right: 12px; left: auto; bottom: max(12px, env(safe-area-inset-bottom)); }
  .launcher { min-height: 50px; padding: 0 16px; font-size: 13px; }
  .panel { position: fixed; right: 0; bottom: 0; width: 100vw; max-height: 100dvh; min-height: min(100dvh, 520px); border-right: 0; border-bottom: 0; border-left: 0; border-radius: var(--ss-radius-panel) var(--ss-radius-panel) 0 0; }
  .panel-head { padding: 20px 19px 17px; }
  .content { padding: 22px 19px max(25px, env(safe-area-inset-bottom)); }
  .intro { min-height: min(calc(100dvh - 140px), 560px); justify-content: center; padding: 10px 4px 28px; }
  .intro-heading { font-size: clamp(36px, 11vw, 50px); }
}
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; } }
`;
