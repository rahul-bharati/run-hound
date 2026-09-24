import { BRAND, FONT_MONO, FONT_SANS } from "../../core/brand.js";

/**
 * The app shell's stylesheet (docs/brand.md palette, docs/app-ui-spec.md layout). Colours only as tokens: the amber
 * #F5B642 appears once, as --warn.
 */
export const STYLES = `
:root { --bg:${BRAND.bg}; --bg-deep:${BRAND.bgDeep}; --surface:${BRAND.surface}; --surface-2:${BRAND.surface2}; --surface-3:${BRAND.surface3};
  --line:${BRAND.line}; --line-soft:${BRAND.lineSoft}; --line-strong:${BRAND.lineStrong}; --fg:${BRAND.fg}; --muted:${BRAND.muted}; --dim:${BRAND.dim};
  --accent:${BRAND.accent}; --accent-strong:${BRAND.accentStrong}; --accent-ink:${BRAND.accentInk}; --fail:${BRAND.fail}; --warn:${BRAND.warn};
  --accent-tint: rgb(94 230 163 / .09); --accent-edge: rgb(94 230 163 / .42); --fail-tint: rgb(255 107 107 / .08); --fail-edge: rgb(255 107 107 / .45);
  --sans:${FONT_SANS}; --mono:${FONT_MONO}; --r-lg:16px; --r-md:12px; --r-sm:8px; color-scheme: dark; }
* { box-sizing: border-box; }
html { background: var(--bg); -webkit-text-size-adjust: 100%; }
body { margin:0; background:var(--bg); color:var(--fg); font:15px/1.5 var(--sans); -webkit-font-smoothing: antialiased; }
[hidden] { display: none !important; }
.visually-hidden { position:absolute !important; width:1px; height:1px; overflow:hidden; clip-path:inset(50%); white-space:nowrap; margin:-1px; padding:0; border:0; }
a { color: var(--accent); text-underline-offset: 3px; }
a:hover { color: var(--accent-strong); }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
h1, h2, h3, h4 { margin:0; letter-spacing:-.01em; }
p { margin:0; }
ul, ol { margin:0; padding:0; }
button, input, select { font: inherit; color: inherit; }
button { cursor: pointer; }
code, pre, .mono { font-family: var(--mono); }
.ic { display:inline-flex; flex:none; line-height:0; }
.ic svg { display:block; }
.muted { color: var(--muted); }
.dim { color: var(--dim); }

/* Shell */
.shell { display:grid; grid-template-columns: 15rem minmax(0, 1fr); min-height:100vh; background: linear-gradient(90deg, var(--bg-deep) 15rem, var(--bg) 15rem); }
#sidebar { background:var(--bg-deep); border-right:1px solid var(--line-soft); padding:1.5rem .9rem 1rem; display:flex; flex-direction:column; gap:1.75rem;
  position:sticky; top:0; height:100vh; overflow-y:auto; z-index:20; }
.side-top { display:flex; align-items:center; justify-content:space-between; gap:.5rem; }
.brand { display:flex; align-items:center; gap:.6rem; padding:.1rem .55rem; color:var(--fg); text-decoration:none; }
.brand img { display:block; width:44px; height:25px; flex:none; }
.brand span { font-weight:800; font-size:1.02rem; letter-spacing:.03em; text-transform:uppercase; }
#menu-button { display:none; align-items:center; gap:.4rem; min-height:40px; padding:.4rem .7rem; border-radius:10px; border:1px solid var(--line-strong); background:var(--surface); font-weight:600; font-size:.88rem; }
#main-nav ul { list-style:none; display:grid; gap:.3rem; }
#main-nav a { display:flex; align-items:center; gap:.8rem; min-height:46px; padding:.55rem .85rem; border-radius:10px; color:var(--muted); text-decoration:none; font-weight:500; border:1px solid transparent; }
#main-nav a .ic { color: var(--dim); }
#main-nav a:hover { color:var(--fg); background:var(--surface); }
#main-nav a[aria-current="page"] { color:var(--fg); background:linear-gradient(90deg, rgb(94 230 163 / .16), rgb(94 230 163 / .05)); border-color:var(--accent-edge); box-shadow: inset 3px 0 0 var(--accent); }
#main-nav a[aria-current="page"] .ic { color: var(--accent); }
.side-foot { margin-top:auto; border:1px solid var(--line); background:var(--surface); border-radius:var(--r-md); padding:.75rem .85rem; display:flex; gap:.7rem; align-items:center; }
.side-foot .dot { width:.55rem; height:.55rem; border-radius:50%; background:var(--accent); flex:none; box-shadow:0 0 0 3px rgb(94 230 163 / .15); }
.side-foot b { display:block; font-weight:600; font-size:.88rem; }
.side-foot span { display:block; font:.74rem/1.5 var(--mono); color:var(--dim); }

main#view { min-width:0; padding: 1.75rem clamp(1rem, 2.6vw, 2.25rem) 2.5rem; }
main#view:focus { outline: none; }
.page { max-width: 62rem; }
.page-head { margin-bottom:1.5rem; }
.page-head h1, .run-title h1 { font-size:clamp(1.55rem, 2.6vw, 2rem); line-height:1.12; font-weight:800; letter-spacing:-.025em; }
.page-head p { color:var(--muted); margin-top:.4rem; max-width:44rem; }
/* Headings only take focus programmatically (after navigation), never from the keyboard: no ring. */
h1:focus, h2:focus, h1:focus-visible, h2:focus-visible { outline:none; }

.card { background:var(--surface); border:1px solid var(--line); border-radius:var(--r-lg); padding:1.25rem 1.35rem; min-width:0; }
.page .card + .card { margin-top:1rem; }
.card-title { display:flex; align-items:center; gap:.6rem; font-size:1.02rem; font-weight:650; margin-bottom:.85rem; }
.card-title .ic { color: var(--muted); }
.eyebrow { font:600 .7rem/1.4 var(--mono); letter-spacing:.14em; text-transform:uppercase; color:var(--dim); }

/* Buttons */
.btn { display:inline-flex; align-items:center; justify-content:center; gap:.55rem; min-height:44px; padding:.55rem 1.15rem; border-radius:var(--r-md);
  border:1px solid var(--line-strong); background:var(--surface-2); color:var(--fg); font-weight:600; font-size:.93rem; text-decoration:none; white-space:nowrap; }
.btn:hover { border-color:var(--dim); color:var(--fg); }
.btn.primary { background:var(--accent); border-color:var(--accent); color:var(--accent-ink); }
.btn.primary:hover { background:var(--accent-strong); border-color:var(--accent-strong); color:var(--accent-ink); }
.btn.accent-outline { background:var(--accent-tint); border-color:var(--accent-edge); color:var(--accent); }
.btn.accent-outline:hover { border-color:var(--accent); color:var(--accent-strong); }
.btn.danger { width:100%; background:var(--fail-tint); border-color:var(--fail-edge); color:var(--fail); min-height:48px; }
.btn.danger:hover { border-color:var(--fail); }
.btn.small { min-height:34px; padding:.3rem .7rem; font-size:.82rem; border-radius:var(--r-sm); }
.btn:disabled { opacity:.55; cursor:not-allowed; }
.btn.busy { cursor:progress; }
.icon-btn { display:inline-grid; place-items:center; width:34px; height:34px; border-radius:var(--r-sm); border:1px solid var(--line); background:var(--surface-2); color:var(--muted); flex:none; }
.icon-btn:hover { color:var(--fg); border-color:var(--line-strong); }

/* Status rings: Lucide circle icons coloured per status; pass and fail get a faint tinted fill. */
.ring { display:inline-grid; place-items:center; flex:none; width:24px; height:24px; }
.ring svg { width:100%; height:100%; display:block; overflow:visible; }
.ring.st-pass { color: var(--accent); }
.ring.st-pass svg circle { fill: rgb(94 230 163 / .12); }
.ring.st-fail { color: var(--fail); }
.ring.st-fail svg circle { fill: rgb(255 107 107 / .14); }
.ring.st-error { color: var(--fail); }
.ring.st-skipped { color: var(--dim); }
.ring.st-queued { color: var(--dim); }
.ring.st-running { color: var(--accent); }
.ring.st-running svg { animation: spin 1.1s linear infinite; }
.ring.big { width:64px; height:64px; }
.ring.big.st-pass svg circle { fill: rgb(94 230 163 / .06); }
.ring.big.st-fail svg circle { fill: rgb(255 107 107 / .07); }
.ring.sev-medium { color: var(--warn); }
.ring.sev-medium svg circle { fill: rgb(245 182 66 / .14); }
.ring.sev-low { color: var(--dim); }
.ring.sev-low svg circle { fill: none; }
#stop-run svg rect { fill: currentColor; }
@keyframes spin { to { transform: rotate(360deg); } }

/* Stepper */
#stepper { list-style:none; display:flex; align-items:center; gap:.5rem; margin:0 0 1.25rem; padding:.85rem 1.1rem; background:var(--surface); border:1px solid var(--line); border-radius:var(--r-lg); overflow:hidden; }
#stepper li { display:flex; align-items:center; gap:.6rem; color:var(--dim); font-weight:500; font-size:.92rem; flex:1 1 0; min-width:0; }
#stepper li:last-child { flex:0 0 auto; }
#stepper li::after { content:""; flex:1 1 auto; height:1px; background:var(--line-strong); min-width:.75rem; margin-left:.35rem; }
#stepper li:last-child::after { display:none; }
#stepper .num { display:grid; place-items:center; width:1.75rem; height:1.75rem; border-radius:50%; border:1.5px solid var(--line-strong); font:600 .78rem/1 var(--mono); flex:none; }
#stepper li.done { color:var(--muted); }
#stepper li.done .num { background:var(--accent); border-color:var(--accent); color:var(--accent-ink); }
#stepper li.done::after { background: var(--accent-edge); }
#stepper li[aria-current="step"] { color:var(--fg); font-weight:650; }
#stepper li[aria-current="step"] .num { border-color:var(--accent); color:var(--accent); background:var(--accent-tint); }

/* New run: target and plan */
.field-label { display:block; font-weight:600; margin-bottom:.45rem; }
.field-hint { color:var(--dim); font-size:.84rem; margin-top:.55rem; }
.url-row { display:flex; gap:.6rem; flex-wrap:wrap; }
.input { flex:1 1 18rem; min-width:0; min-height:46px; padding:.6rem .9rem; border-radius:var(--r-md); border:1px solid var(--line-strong); background:var(--bg-deep); color:var(--fg); font:.95rem/1.4 var(--mono); }
.input::placeholder { color: var(--dim); }
.input:focus-visible { outline-offset:0; border-color:var(--accent); }
.input[aria-invalid="true"] { border-color: var(--fail); }
.input[aria-invalid="true"]:focus-visible { outline-color: var(--fail); }
.error { color: var(--fail); margin-top:.55rem; font-size:.9rem; }
.error:empty { display:none; }
.plan-head { display:flex; flex-wrap:wrap; align-items:baseline; justify-content:space-between; gap:.35rem 1rem; margin-bottom:1rem; }
.plan-head h2 { font-size:1.15rem; font-weight:700; }
#plan-summary { color:var(--muted); font-size:.92rem; }
#plan-summary b { color:var(--fg); font-weight:600; }
.warning { border:1px solid rgb(245 182 66 / .35); background:rgb(245 182 66 / .06); border-radius:var(--r-md); padding:.6rem .9rem; margin:0 0 1rem; font-size:.9rem; }
.warning p + p { margin-top:.35rem; }
.group { border:1px solid var(--line); border-radius:var(--r-md); background:var(--bg); overflow:hidden; }
.group + .group { margin-top:.75rem; }
.group-head { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:.25rem 1rem; padding:.6rem .9rem; border-bottom:1px solid var(--line-soft); background:var(--surface-2); }
.group-head h3 { font-size:.95rem; font-weight:700; display:flex; align-items:center; gap:.5rem; }
.count { font:600 .72rem/1 var(--mono); color:var(--muted); padding:.25rem .5rem; border:1px solid var(--line-strong); border-radius:999px; }
.check-label { display:inline-flex; align-items:center; gap:.55rem; min-height:40px; cursor:pointer; color:var(--muted); font-size:.88rem; }
.scenario-rows { list-style:none; }
.scenario-row { display:flex; gap:.8rem; align-items:flex-start; padding:.7rem .9rem; border-top:1px solid var(--line-soft); }
.scenario-row:first-child { border-top:0; }
.scenario-row label { min-width:0; cursor:pointer; flex:1; }
.scenario-row .title { font-weight:550; overflow-wrap:anywhere; }
.scenario-row .desc { display:block; color:var(--muted); font-size:.86rem; margin-top:.1rem; overflow-wrap:anywhere; }
input[type=checkbox] { appearance:none; -webkit-appearance:none; flex:none; width:1.15rem; height:1.15rem; margin:.15rem 0 0; border-radius:5px; border:1.5px solid var(--dim); background:var(--bg-deep); display:inline-grid; place-items:center; cursor:pointer; }
input[type=checkbox]::before { content:""; width:.62rem; height:.62rem; clip-path: polygon(14% 44%, 0 65%, 50% 100%, 100% 16%, 80% 0%, 43% 62%); background:var(--accent-ink); transform:scale(0); }
input[type=checkbox]:checked { background:var(--accent); border-color:var(--accent); }
input[type=checkbox]:checked::before { transform:scale(1); }
input[type=checkbox]:indeterminate { background:var(--accent); border-color:var(--accent); }
input[type=checkbox]:indeterminate::before { clip-path:none; height:2px; width:.6rem; transform:scale(1); }
input[type=checkbox]:disabled { opacity:.45; cursor:not-allowed; }
.check-label input { margin:0; }
.tag { display:inline-block; font:600 .66rem/1 var(--mono); letter-spacing:.06em; text-transform:uppercase; border:1px solid var(--line-strong); border-radius:999px; padding:.22rem .45rem; margin-left:.45rem; color:var(--muted); vertical-align:.12rem; white-space:nowrap; }
.tag.danger { color:var(--fail); border-color:var(--fail-edge); }
.options { display:grid; gap:.4rem; margin-top:1.1rem; padding-top:1rem; border-top:1px solid var(--line); }
.option { display:flex; gap:.8rem; align-items:flex-start; }
.option label { cursor:pointer; min-width:0; }
.option .desc { display:block; color:var(--dim); font-size:.85rem; margin-top:.1rem; }
.option input:disabled + label { cursor:not-allowed; }
.plan-actions { display:flex; flex-wrap:wrap; align-items:center; justify-content:flex-end; gap:.75rem 1rem; margin-top:1.1rem; }
.plan-actions .error { margin:0; flex:1 1 12rem; }

/* Running view (mockup 1) */
.run-grid { display:grid; grid-template-columns: minmax(22rem, 31rem) minmax(0, 1fr); gap:1.75rem; align-items:start; max-width: 92rem; }
.run-col { display:grid; grid-template-columns: minmax(0, 1fr); gap:1rem; min-width:0; align-content:start; }
.back { display:inline-flex; align-items:center; gap:.5rem; color:var(--muted); text-decoration:none; font-size:.9rem; min-height:32px; justify-self:start; }
.back:hover { color:var(--fg); }
.run-title { display:flex; align-items:baseline; justify-content:space-between; gap:1rem; }
#counter { font-weight:700; font-size:1.3rem; line-height:1; font-variant-numeric:tabular-nums; color:var(--fg); white-space:nowrap; letter-spacing:.02em; }
.run-sub { margin-top:-.35rem; }
.run-sub .form { font-weight:600; font-size:1.02rem; overflow-wrap:anywhere; }
.run-sub .target { font:.84rem/1.5 var(--mono); color:var(--muted); overflow-wrap:anywhere; margin-top:.15rem; }
.bar { height:10px; border-radius:999px; background:var(--surface-3); overflow:hidden; }
.bar span { display:block; height:100%; width:0; background:var(--accent); border-radius:999px; transition: width .4s ease; }
.stats { display:grid; grid-template-columns: repeat(auto-fit, minmax(9.5rem, 1fr)); gap:.75rem; }
.stat { display:flex; align-items:center; gap:.8rem; background:var(--surface); border:1px solid var(--line); border-radius:var(--r-md); padding:.85rem 1rem; min-width:0; }
.stat > .ic { color:var(--accent); }
.stat .label { display:block; color:var(--muted); font-size:.8rem; }
.stat .value { display:block; font-weight:600; overflow-wrap:anywhere; min-width:0; }
#elapsed { font-weight:700; font-size:1.2rem; line-height:1.3; font-variant-numeric:tabular-nums; }
#scenario-list { list-style:none; display:grid; gap:.9rem; }
.grp-h { display:flex; align-items:baseline; justify-content:space-between; gap:.5rem; margin:0 0 .45rem .15rem; font:600 .7rem/1.4 var(--mono); letter-spacing:.14em; text-transform:uppercase; color:var(--dim); }
.grp-h span { letter-spacing:.04em; text-transform:none; }
.rows { list-style:none; display:grid; gap:.5rem; }
.srow { background:var(--surface); border:1px solid var(--line); border-radius:var(--r-md); }
.srow-main { display:flex; align-items:center; gap:.85rem; padding:.7rem .6rem .7rem 1rem; min-height:54px; }
.srow .n { font:500 .88rem/1 var(--mono); color:var(--muted); width:1.2rem; flex:none; font-variant-numeric:tabular-nums; }
.srow .t { flex:1; min-width:0; font-weight:550; overflow-wrap:anywhere; }
.srow .d { font:.8rem/1 var(--mono); color:var(--dim); font-variant-numeric:tabular-nums; white-space:nowrap; }
.srow .toggle { width:32px; height:32px; display:grid; place-items:center; border:0; background:transparent; color:var(--dim); border-radius:var(--r-sm); flex:none; }
.srow .toggle:hover { color:var(--fg); background:var(--surface-2); }
.srow .toggle[aria-expanded="true"] .ic { transform: rotate(180deg); }
.srow .toggle-gap { width:32px; flex:none; }
.srow[data-status="running"] { border-color:var(--accent-edge); box-shadow: 0 0 0 1px rgb(94 230 163 / .18), 0 10px 30px rgb(0 0 0 / .25); background:linear-gradient(180deg, rgb(94 230 163 / .05), var(--surface) 60%); }
.srow[data-status="queued"] .t { color:var(--muted); }
.srow[data-status="skipped"] .t { color:var(--muted); }
.srow[data-status="fail"] .t, .srow[data-status="error"] .t { color:var(--fg); }
.substeps { margin:0 .75rem .75rem; padding:.6rem .8rem; border:1px solid var(--line); background:var(--bg); border-radius:var(--r-sm); }
.substeps .now { color:var(--muted); font-size:.86rem; margin-bottom:.4rem; overflow-wrap:anywhere; }
.substeps ol { list-style:none; display:grid; gap:.3rem; max-height:11rem; overflow:auto; }
.substeps li { display:flex; align-items:flex-start; gap:.55rem; font-size:.86rem; color:var(--muted); min-width:0; }
.substeps li > span:last-child { overflow-wrap:anywhere; min-width:0; }
.substeps li.current { color:var(--fg); }
.substeps .ring { width:16px; height:16px; margin-top:.15rem; }
.substeps .empty { color:var(--dim); font-size:.86rem; }

.preview { padding:0; overflow:hidden; }
.preview-head, .activity-head { display:flex; align-items:center; gap:.7rem; padding:.85rem 1.1rem; }
.preview-head h2, .activity-head h2 { font-size:.98rem; font-weight:650; flex:1; }
.preview-head .ic, .activity-head .ic { color:var(--muted); }
.badge { display:inline-flex; align-items:center; gap:.45rem; font:600 .76rem/1 var(--mono); border-radius:999px; padding:.38rem .65rem; border:1px solid var(--line-strong); color:var(--muted); background:var(--bg-deep); white-space:nowrap; }
.badge.on { color:var(--accent); border-color:var(--accent-edge); background:var(--accent-tint); }
.badge.on::before { content:""; width:.45rem; height:.45rem; border-radius:50%; background:var(--accent); animation: pulse 1.6s ease-in-out infinite; }
@keyframes pulse { 50% { opacity:.35; } }
.addressbar { display:flex; align-items:center; gap:.6rem; padding:.55rem 1.1rem; border-top:1px solid var(--line-soft); border-bottom:1px solid var(--line-soft); background:var(--surface-2); }
.addressbar .ic { color:var(--dim); }
#address { flex:1; min-width:0; background:var(--bg-deep); border:1px solid var(--line); border-radius:999px; padding:.4rem .9rem; font:.84rem/1.3 var(--mono); color:var(--fg); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.viewport { position:relative; aspect-ratio: 1280 / 800; background:var(--bg-deep); margin:.6rem; border-radius:var(--r-sm); overflow:hidden; border:1px solid var(--line-soft); }
.viewport img { display:block; width:100%; height:100%; object-fit:contain; object-position:top center; background:#fff; }
.viewport .placeholder { position:absolute; inset:0; display:grid; place-items:center; color:var(--muted); text-align:center; padding:1rem; font-size:.92rem; }
.activity { padding:0; }
.activity-head { border-bottom:1px solid var(--line-soft); }
.log-scroll { max-height: 19rem; overflow:auto; padding:.5rem .6rem .6rem; }
.log { list-style:none; display:grid; }
.log li { display:grid; grid-template-columns: 4.6rem 18px minmax(0, 1fr) auto; align-items:center; gap:.75rem; padding:.36rem .5rem; border-radius:var(--r-sm); font-size:.88rem; }
.log time { font:.8rem/1 var(--mono); color:var(--dim); font-variant-numeric:tabular-nums; }
.log .ring { width:18px; height:18px; }
.log .lbl { min-width:0; overflow-wrap:anywhere; color:var(--muted); }
.log li.current .lbl { color:var(--fg); }
.log .scn { color:var(--dim); font-size:.78rem; }
.log .dur { font:.78rem/1 var(--mono); color:var(--dim); font-variant-numeric:tabular-nums; white-space:nowrap; }
.log .empty { display:block; color:var(--dim); padding:.5rem; }

/* Report view (mockup 2) */
.report { max-width: 92rem; }
.report-top { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:.5rem 1rem; margin-bottom:1.25rem; }
.crumbs ol { list-style:none; display:flex; flex-wrap:wrap; align-items:center; gap:.25rem .55rem; font-size:.88rem; color:var(--muted); min-width:0; }
.crumbs li { display:flex; align-items:center; gap:.55rem; min-width:0; overflow-wrap:anywhere; }
.crumbs li + li::before { content:"›"; color:var(--dim); }
.crumbs a { color:var(--muted); text-decoration:none; }
.crumbs a:hover { color:var(--fg); text-decoration:underline; }
.crumbs [aria-current] { color:var(--fg); }
.when { font:.84rem/1.4 var(--mono); color:var(--muted); white-space:nowrap; }
.report-head { display:flex; flex-wrap:wrap; align-items:center; gap:1rem 1.5rem; margin-bottom:1.5rem; }
.verdict { display:flex; align-items:center; gap:1.1rem; flex:1 1 24rem; min-width:0; }
.verdict h1 { font-size:clamp(1.5rem, 2.6vw, 2rem); line-height:1.1; font-weight:800; letter-spacing:-.025em; }
/* Bullets sit in each item's left padding; the clip hides the one that starts a wrapped line. */
.summary { color:var(--muted); margin:.35rem 0 0 -1.4rem; font-size:1rem; display:flex; flex-wrap:wrap; row-gap:.15rem; clip-path: inset(0 0 0 1.4rem); }
.summary span { position:relative; padding-left:1.4rem; }
.summary span::before { content:"•"; color:var(--accent); position:absolute; left:.5rem; }
.summary .n-issues { color: var(--fail); }
.fail-progress { color:var(--dim); font-size:.9rem; margin-top:.35rem; }
.head-actions { display:flex; flex-wrap:wrap; gap:.6rem; align-items:center; }
.download { position:relative; }
.download summary { list-style:none; }
.download summary::-webkit-details-marker { display:none; }
.download ul { position:absolute; right:0; top:calc(100% + .4rem); z-index:10; list-style:none; min-width:15rem; max-width:min(22rem, 86vw); background:var(--surface-2); border:1px solid var(--line-strong); border-radius:var(--r-md); padding:.35rem; box-shadow:0 18px 40px rgb(0 0 0 / .45); }
.download a { display:flex; align-items:center; gap:.6rem; padding:.55rem .7rem; border-radius:var(--r-sm); color:var(--fg); text-decoration:none; font-size:.88rem; overflow-wrap:anywhere; }
.download a:hover { background:var(--surface-3); }
.download a .ic { color:var(--dim); }
.stopped-note { border:1px solid var(--line-strong); background:var(--surface); border-radius:var(--r-md); padding:.7rem 1rem; margin:-.5rem 0 1.25rem; color:var(--muted); font-size:.92rem; }
.report-grid { display:grid; grid-template-columns: minmax(20rem, 28rem) minmax(0, 1fr); gap:1.25rem; align-items:start; }
@media (min-width: 68.01rem) { .results-panel { position:sticky; top:1rem; max-height:calc(100vh - 2rem); overflow:auto; } }
.results-panel { padding:1.1rem .9rem .9rem; }
.results-panel > h2 { font-size:1.08rem; font-weight:650; padding:0 .35rem; }
[role="tablist"] { display:flex; flex-wrap:wrap; gap:.45rem; margin:.85rem .35rem 1rem; }
[role="tab"] { min-height:38px; padding:.35rem .85rem; border-radius:10px; border:1px solid var(--line-strong); background:var(--surface-2); color:var(--muted); font-size:.88rem; font-weight:500; }
[role="tab"]:hover { color:var(--fg); }
[role="tab"][aria-selected="true"] { color:var(--fg); border-color:var(--accent); background:var(--accent-tint); box-shadow: inset 0 0 0 1px var(--accent-edge); }
.rgroup + .rgroup { margin-top:.6rem; }
.rgroup h3 { margin:.2rem .5rem .3rem; font:600 .68rem/1.4 var(--mono); letter-spacing:.14em; text-transform:uppercase; color:var(--dim); }
.rgroup ul { list-style:none; }
.rrow { width:100%; display:grid; grid-template-columns: 24px minmax(0, 1fr) auto 64px 20px; align-items:center; gap:.75rem; padding:.55rem .5rem; min-height:60px; border:1px solid transparent; border-bottom-color:var(--line-soft); background:transparent; border-radius:10px; text-align:left; }
.rrow:hover { background:var(--surface-2); }
.rrow[aria-current="true"] { background:linear-gradient(90deg, rgb(94 230 163 / .10), var(--surface-3)); border-color:var(--accent-edge); }
.rrow[aria-current="true"][data-issue] { background:linear-gradient(90deg, rgb(255 107 107 / .10), var(--surface-3)); border-color:var(--fail-edge); }
.rrow .t { flex:1; min-width:0; font-size:.93rem; overflow-wrap:anywhere; }
.rrow[data-issue] .t { color: var(--fg); }
.rrow[aria-current="true"][data-issue] .t { color: var(--fail); }
.rrow .d { font:.78rem/1 var(--mono); color:var(--dim); white-space:nowrap; }
.rrow .thumb { width:64px; height:40px; flex:none; border-radius:6px; border:1px solid var(--line-strong); object-fit:cover; object-position:top left; background:#fff; }
.rrow .thumb-gap { width:64px; flex:none; }
.rrow > .ic { color:var(--dim); }
.results-empty { color:var(--dim); padding:.75rem .5rem; font-size:.9rem; }

#detail { padding:1.35rem 1.4rem 1.4rem; display:grid; grid-template-columns: minmax(0, 1fr); gap:1.1rem; min-width:0; }
#detail:focus { outline:none; }
.detail-head { display:flex; gap:1rem; align-items:flex-start; }
.detail-head .ring { width:40px; height:40px; }
.detail-head .grow { flex:1; min-width:0; }
.detail-head h2 { font-size:1.22rem; font-weight:700; line-height:1.25; overflow-wrap:anywhere; }
.detail-head .meaning { color:var(--muted); margin-top:.35rem; overflow-wrap:anywhere; }
.detail-dur { display:inline-flex; align-items:center; gap:.4rem; font:.84rem/1 var(--mono); color:var(--muted); white-space:nowrap; }
.tags { list-style:none; display:flex; flex-wrap:wrap; gap:.4rem; margin-top:.7rem; }
.tags li { display:inline-flex; align-items:center; gap:.4rem; font-size:.8rem; padding:.28rem .65rem; border-radius:999px; border:1px solid var(--line-strong); color:var(--muted); background:var(--surface-2); }
.tags li.mono { font-family:var(--mono); font-size:.76rem; }
.tags .sw { width:.5rem; height:.5rem; border-radius:50%; background:currentColor; }
.tags .sev-critical, .tags .sev-high { color:var(--fail); border-color:var(--fail-edge); background:var(--fail-tint); }
.tags .sev-medium { color:var(--warn); border-color:rgb(245 182 66 / .4); }
.tags .sev-low { color:var(--muted); }
.switcher { display:grid; gap:.4rem; font-size:.84rem; color:var(--muted); }
.switcher select { width:100%; min-width:0; text-overflow:ellipsis; min-height:38px; padding:.35rem .7rem; border-radius:var(--r-sm); border:1px solid var(--line-strong); background:var(--surface-2); color:var(--fg); font-size:.88rem; }
.switcher button { min-height:32px; padding:.2rem .7rem; border-radius:var(--r-sm); border:1px solid var(--line-strong); background:var(--surface-2); color:var(--muted); font-size:.82rem; max-width:18rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.switcher button[aria-pressed="true"] { color:var(--fg); border-color:var(--accent); }
.evidence-viewer { display:grid; grid-template-columns: minmax(0, 1fr) 7.5rem; gap:.75rem; }
.evidence-viewer.single { grid-template-columns: minmax(0, 1fr); }
.evidence-main { margin:0; border:1px solid var(--line); border-radius:var(--r-md); overflow:hidden; background:var(--bg-deep); min-width:0; }
.evidence-main a { display:block; background:#0d1418; }
.evidence-main img { display:block; width:100%; height:auto; max-height:26rem; object-fit:contain; object-position:center top; }
.evidence-main figcaption { padding:.5rem .75rem; font-size:.8rem; color:var(--muted); border-top:1px solid var(--line-soft); overflow-wrap:anywhere; }
.evidence-main figcaption b { color:var(--fg); font-weight:600; }
.evidence-main figcaption .meta { font-family:var(--mono); font-size:.74rem; color:var(--dim); display:block; margin-top:.15rem; }
.strip { list-style:none; display:grid; gap:.5rem; align-content:start; max-height:32rem; overflow:auto; padding:2px; }
.strip button { display:block; width:100%; padding:0; border:1px solid var(--line-strong); border-radius:var(--r-sm); background:var(--bg-deep); overflow:hidden; }
.strip button[aria-pressed="true"] { border-color:var(--accent); box-shadow:0 0 0 2px var(--accent-edge); }
.strip img { display:block; width:100%; aspect-ratio: 4 / 3; object-fit:cover; object-position:top left; background:#fff; }
.two { display:grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap:.9rem; }
.panel { border:1px solid var(--line); border-radius:var(--r-md); background:var(--bg); padding:.95rem 1rem; min-width:0; }
.panel h3 { display:flex; align-items:center; gap:.55rem; font-size:.95rem; font-weight:650; margin-bottom:.7rem; }
.panel h3 .ic { color:var(--muted); }
.panel h3 .grow { flex:1; }
.panel p { color:var(--muted); font-size:.92rem; overflow-wrap:anywhere; }
.panel p + p { margin-top:.4rem; }
.repro { list-style:none; counter-reset: rs; display:grid; gap:.5rem; }
.repro li { counter-increment: rs; display:grid; grid-template-columns: 1.5rem minmax(0, 1fr); gap:.6rem; font-size:.88rem; color:var(--fg); }
.repro li::before { content: counter(rs); display:grid; place-items:center; width:1.4rem; height:1.4rem; border-radius:50%; border:1px solid var(--line-strong); font:600 .7rem/1 var(--mono); color:var(--muted); }
.repro .u { display:block; font:.74rem/1.4 var(--mono); color:var(--dim); overflow-wrap:anywhere; }
.facts { display:grid; grid-template-columns: 6.5rem minmax(0, 1fr); gap:.45rem .8rem; margin:0; font-size:.86rem; }
.facts dt { color:var(--muted); }
.facts dd { margin:0; min-width:0; overflow-wrap:anywhere; }
.facts .wide { grid-column: 1 / -1; }
.facts dd.wide { margin-top:-.25rem; margin-bottom:.2rem; }
.facts .code { display:flex; align-items:center; gap:.4rem; }
.facts .code code { flex:1; min-width:0; background:var(--surface-2); border:1px solid var(--line); border-radius:6px; padding:.25rem .5rem; font-size:.78rem; overflow-wrap:anywhere; }
.facts .icon-btn { width:30px; height:30px; }
.facts ul { list-style:none; display:grid; gap:.25rem; }
.facts ul code { display:inline-block; max-width:100%; background:var(--surface-2); border:1px solid var(--line); border-radius:6px; padding:.2rem .5rem; font-size:.78rem; overflow-wrap:anywhere; }
.ask { display:flex; gap:.75rem; align-items:flex-start; }
.ask p { flex:1; color:var(--fg); }
.spec-panel { padding:0; overflow:hidden; }
.spec-panel .spec-head { display:flex; flex-wrap:wrap; align-items:center; gap:.6rem; padding:.75rem 1rem; border-bottom:1px solid var(--line-soft); }
.spec-panel h3 { margin:0; flex:1; }
.lang { font:600 .74rem/1 var(--mono); color:var(--accent); border:1px solid var(--accent-edge); background:var(--accent-tint); border-radius:6px; padding:.35rem .55rem; }
.spec-panel pre { margin:0; padding:.8rem 0; overflow:auto; max-height:26rem; font-size:.8rem; line-height:1.6; background:var(--bg-deep); counter-reset: ln; }
.spec-panel code { display:block; min-width:max-content; }
.spec-panel .line { display:block; padding-right:1rem; white-space:pre; }
.spec-panel .line::before { counter-increment: ln; content: counter(ln); display:inline-block; width:3rem; padding-right:1rem; margin-right:.25rem; text-align:right; color:var(--dim); user-select:none; }
.spec-file { font:.76rem/1.4 var(--mono); color:var(--dim); padding:.5rem 1rem; border-top:1px solid var(--line-soft); overflow-wrap:anywhere; }
.report-extra { display:grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr) minmax(0, 1fr); gap:1.25rem; margin-top:1.25rem; align-items:start; }
.report-extra h2 { font-size:1rem; font-weight:650; margin-bottom:.75rem; }
.table-scroll { overflow-x:auto; }
table.groups { border-collapse:collapse; width:100%; font-size:.86rem; font-variant-numeric:tabular-nums; }
table.groups th, table.groups td { padding:.45rem .4rem; border-bottom:1px solid var(--line-soft); text-align:right; white-space:nowrap; }
table.groups th:first-child { text-align:left; }
table.groups thead th { color:var(--dim); font-weight:500; font-size:.76rem; }
table.groups tbody th { font-weight:600; }
table.groups td.bad { color:var(--fail); font-weight:700; }
table.groups td.good { color:var(--accent); }
.plain-list { list-style:none; display:grid; gap:.45rem; font-size:.88rem; color:var(--muted); }
.plain-list li { overflow-wrap:anywhere; padding-left:1rem; position:relative; }
.plain-list li::before { content:""; position:absolute; left:0; top:.55rem; width:.4rem; height:.4rem; border-radius:50%; background:var(--line-strong); }
.plain-list .mono { font-size:.8rem; color:var(--fg); }
.note { color:var(--muted); font-size:.88rem; margin-top:.75rem; }
.fail-card { border-color: var(--fail-edge); }
.fail-card p { color: var(--muted); margin-top:.5rem; overflow-wrap:anywhere; }

/* Runs list */
#runs-list { list-style:none; padding:.4rem; }
#runs-list li + li { border-top:1px solid var(--line-soft); }
.run-row { display:grid; grid-template-columns: 28px minmax(0, 1.6fr) minmax(0, 1fr) auto 1rem; align-items:center; gap:.9rem 1.1rem; padding:.85rem .8rem; border-radius:10px; color:var(--fg); text-decoration:none; }
.run-row:hover { background:var(--surface-2); color:var(--fg); }
.run-row .what { min-width:0; }
.run-row .target { display:block; font:.88rem/1.4 var(--mono); overflow-wrap:anywhere; }
.run-row .form { display:block; font-size:.84rem; color:var(--muted); overflow-wrap:anywhere; }
.run-row .when { font-size:.8rem; }
.run-row .counts { font-size:.84rem; color:var(--muted); text-align:right; white-space:nowrap; }
.run-row .counts .bad { color: var(--fail); }
.run-row .counts .dur { display:block; font:.78rem/1.4 var(--mono); color:var(--dim); }
.run-row > .ic { color: var(--dim); }
.empty-state { padding:2rem 1rem; text-align:center; color:var(--muted); }
.empty-state .btn { margin-top:1rem; }

/* Settings */
.settings-list { display:grid; grid-template-columns: minmax(10rem, max-content) minmax(0, 1fr); gap:.7rem 1.25rem; margin:0; font-size:.92rem; }
.settings-list dt { color:var(--muted); }
.settings-list dd { margin:0; min-width:0; overflow-wrap:anywhere; }
.settings-list code { font-size:.84rem; }
.saved { color:var(--dim); font-size:.84rem; margin-top:.75rem; }
.links { list-style:none; display:flex; flex-wrap:wrap; gap:.6rem; }
.loading { color:var(--muted); padding:1rem 0; }

@media (max-width: 80rem) {
  .run-grid, .report-grid, .report-extra { grid-template-columns: minmax(0, 1fr); }
  .run-grid > .run-col:first-child { max-width: 44rem; }
}
@media (max-width: 900px) {
  .shell { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto 1fr; background: var(--bg); }
  #sidebar { position:sticky; top:0; height:auto; flex-direction:row; align-items:center; gap:.5rem; padding:.6rem 1rem; border-right:0; border-bottom:1px solid var(--line); overflow:visible; }
  .side-top { flex:1; }
  #menu-button { display:inline-flex; }
  #main-nav { display:none; position:absolute; left:0; right:0; top:100%; background:var(--bg-deep); border-bottom:1px solid var(--line); padding:.6rem 1rem 1rem; box-shadow:0 20px 40px rgb(0 0 0 / .4); }
  #sidebar.open #main-nav { display:block; }
  .side-foot { display:none; }
  main#view { padding: 1.25rem 1rem 2rem; }
  .two { grid-template-columns: minmax(0, 1fr); }
  .evidence-viewer { grid-template-columns: minmax(0, 1fr); }
  .strip { grid-template-columns: repeat(auto-fill, minmax(5.5rem, 1fr)); max-height:none; }
  .run-row { grid-template-columns: 28px minmax(0, 1fr) auto; }
  .run-row .when { grid-column: 2; grid-row: 2; }
  .run-row .counts { grid-column: 3; grid-row: 1 / span 2; }
  .run-row > .ic { display:none; }
}
@media (max-width: 560px) {
  .card { padding:1rem; border-radius:14px; }
  #stepper { padding:.7rem .75rem; gap:.3rem; }
  #stepper li { font-size:.8rem; gap:.35rem; }
  #stepper li::after { min-width:.3rem; margin-left:.15rem; }
  #stepper .num { width:1.5rem; height:1.5rem; font-size:.72rem; }
  .srow-main { padding-left:.75rem; gap:.6rem; }
  .log li { grid-template-columns: 4.3rem 16px minmax(0, 1fr); }
  .log .dur { grid-column: 3; }
  .rrow { grid-template-columns: 24px minmax(0, 1fr) 48px 16px; gap:.2rem .7rem; }
  .rrow > .ring { grid-row: span 2; }
  .rrow .t { grid-column: 2; }
  .rrow .d { grid-column: 2; grid-row: 2; }
  .rrow .thumb, .rrow .thumb-gap { grid-column: 3; grid-row: 1 / span 2; width:48px; height:32px; }
  .rrow > .ic { grid-column: 4; grid-row: 1 / span 2; }
  .report-head { gap:.75rem; }
  .verdict { flex-basis: 100%; }
  .ring.big { width:48px; height:48px; }
  .head-actions { width:100%; }
  .head-actions > * { flex:1 1 auto; }
  .download ul { left:0; right:auto; }
  .facts, .settings-list { grid-template-columns: minmax(0, 1fr); gap:.15rem; }
  .facts dd, .settings-list dd { margin-bottom:.5rem; }
  #detail { padding:1rem; }
  .detail-head { flex-wrap:wrap; column-gap:.75rem; row-gap:.5rem; }
  .detail-head .ring { width:32px; height:32px; }
  .detail-head .grow { flex:1 1 calc(100% - 32px - .75rem); }
  .detail-dur { margin-left: calc(32px + .75rem); }
  .plan-actions .btn { width:100%; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; }
}
`;
