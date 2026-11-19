/** Window styles. Figma's theme variables (`themeColors: true`) with light fallbacks. */
export const styles = `
:root {
  --bg: var(--figma-color-bg, #ffffff);
  --text: var(--figma-color-text, #1e1e1e);
  --muted: var(--figma-color-text-secondary, #6b6b6b);
  --border: var(--figma-color-border, #e6e6e6);
  --brand: var(--figma-color-bg-brand, #0d99ff);
  --on-brand: var(--figma-color-text-onbrand, #ffffff);
  --danger: var(--figma-color-text-danger, #d1293d);
  --success: var(--figma-color-text-success, #14ae5c);
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 12px/1.45 Inter, system-ui, sans-serif; }
.shell { padding: 12px 14px 16px; }
.header { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; margin-bottom: 8px; }
h1 { font-size: 13px; margin: 0; }
h2 { font-size: 13px; margin: 8px 0; }
p { margin: 6px 0; }
.muted { color: var(--muted); }
.error { color: var(--danger); }
.ok-text { color: var(--success); }
.list, .steps { list-style: none; padding: 0; margin: 8px 0; display: grid; gap: 6px; }
.row { display: grid; gap: 2px; width: 100%; text-align: left; }
.step { border: 1px solid var(--border); border-radius: 6px; padding: 8px 10px; }
.step-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.badge { border-radius: 4px; padding: 0 6px; font-size: 11px; }
.badge.ok { color: var(--success); border: 1px solid currentColor; }
.badge.bad { color: var(--danger); border: 1px solid currentColor; }
.actions { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0; }
button { font: inherit; color: var(--text); background: transparent; border: 1px solid var(--border); border-radius: 6px; padding: 6px 10px; cursor: pointer; }
button.primary { background: var(--brand); color: var(--on-brand); border-color: var(--brand); }
button.link { border: none; padding: 4px 0; color: var(--brand); }
button:focus-visible, input:focus-visible, textarea:focus-visible { outline: 2px solid var(--brand); outline-offset: 1px; }
.ask { border: 1px solid var(--brand); border-radius: 6px; padding: 8px 10px; }
.note { display: grid; gap: 4px; margin: 8px 0; }
input[type="text"] { font: inherit; padding: 6px; border: 1px solid var(--border); border-radius: 4px; background: var(--bg); color: var(--text); }
.json { width: 100%; font: 11px/1.3 ui-monospace, Menlo, monospace; border: 1px solid var(--border); border-radius: 4px; background: var(--bg); color: var(--text); }
.progress { display: flex; align-items: center; gap: 8px; }
.note-line { border-left: 3px solid var(--brand); padding-left: 8px; }
.spinner { width: 12px; height: 12px; border: 2px solid var(--border); border-top-color: var(--brand); border-radius: 50%; animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
`;
