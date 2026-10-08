/* Headless smoke test for play.html
   - Stubs DOM + canvas (Proxy) + rAF driver
   - Runs each theme (?theme=su/cc/beijing): init, start, 600 frames (incl. autopilot), landscape resize
   - Asserts: no exceptions, theme title applied, snake grows in open mode, landscape bitmap == CSS*dpr
*/
const fs = require("fs");
const vm = require("vm");

const html = fs.readFileSync(__dirname + "/play.html", "utf8");
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.error("FAIL: no <script> found"); process.exit(1); }
const src = m[1];

/* parse the THEMES literal out of the page so tests can assert against the real data */
const tm = html.match(/const THEMES = (\{[\s\S]*?\n\});[\s\S]*?function pickTheme/);
if (!tm) { console.error("FAIL: could not locate THEMES literal"); process.exit(1); }
const THEMES = vm.runInNewContext("(" + tm[1] + ")", {});

function ctxProxy() {
  const grad = { addColorStop() {} };
  return new Proxy({}, {
    get(_, p) {
      if (p === "createRadialGradient" || p === "createLinearGradient") return () => grad;
      if (p === "measureText") return () => ({ width: 10 });
      return () => {};
    },
    set() { return true; }
  });
}

function makeEl(id) {
  const el = {
    id, style: {}, _l: {}, textContent: "", innerHTML: "",
    classList: { add(){}, remove(){}, toggle(){}, contains(){ return false; } },
    addEventListener(t, fn) { (this._l[t] = this._l[t] || []).push(fn); },
    removeEventListener() {},
    setAttribute() {}, getAttribute() { return null; },
    appendChild() {}, querySelector() { return makeEl("q"); },
    querySelectorAll() { return []; },
    getBoundingClientRect() { return { left: 0, top: 0, width: this.clientWidth || 800, height: this.clientHeight || 400 }; },
    getContext() { return ctxProxy(); },
    clientWidth: 800, clientHeight: 800, width: 0, height: 0
  };
  return el;
}

function makeSandbox(theme) {
  const els = {};
  const getEl = (id) => (els[id] = els[id] || makeEl(id));
  const winL = {};
  const docL = {};
  const win = {
    addEventListener(t, fn) { (winL[t] = winL[t] || []).push(fn); },
    innerWidth: 800, innerHeight: 400, devicePixelRatio: 2,
    screen: {}, ResizeObserver: class { observe() {} },
    visualViewport: undefined, location: { search: "?theme=" + theme },
    localStorage: { getItem() { return null; }, setItem() {} }
  };
  const doc = {
    getElementById: getEl,
    querySelector(sel) { return getEl("sel:" + sel); },
    querySelectorAll(sel) {
      if (sel.indexOf("data-dir") >= 0) return [makeEl("d0"), makeEl("d1"), makeEl("d2"), makeEl("d3")];
      return [];
    },
    createElement() { return makeEl("new"); },
    addEventListener(t, fn) { (docL[t] = docL[t] || []).push(fn); },
    body: makeEl("body"),
    documentElement: { requestFullscreen() {} },
    fullscreenElement: null,
    title: ""
  };
  const sandbox = {
    window: win, document: doc,
    navigator: { maxTouchPoints: 0 },
    location: win.location,
    localStorage: win.localStorage,
    performance: { now: () => sandbox.__clock },
    requestAnimationFrame: (cb) => { sandbox.__raf = cb; },
    setTimeout: () => 0,
    setInterval: () => 0, clearInterval: () => {},
    URLSearchParams,
    console,
    __els: els, __winL: winL, __clock: 1000, __raf: null
  };
  return sandbox;
}

function drive(sandbox, frames) {
  let now = sandbox.__clock;
  for (let n = 0; n < frames; n++) {
    now += 16;
    sandbox.__clock = now;
    const cb = sandbox.__raf; sandbox.__raf = null;
    if (cb) cb(now);
  }
}

const expect = {
  su: "苏络贪吃蛇 · 开放世界",
  "77": "77 贪吃蛇 · 开放世界",
  cc: "77 贪吃蛇 · 开放世界",   // 旧链接 ?theme=cc 兼容指向 77
  beijing: "北京地铁贪吃蛇 · 开放世界",
  nanjing: "南京地铁贪吃蛇 · 开放世界"
};

let ok = true;
for (const theme of ["su", "77", "cc", "beijing", "nanjing"]) {
  const sb = makeSandbox(theme);
  try {
    vm.runInNewContext(src, sb, { filename: "play.html" });
  } catch (e) {
    console.error("FAIL [" + theme + "] eval threw:", e && e.stack || e);
    ok = false; continue;
  }
  // title reflects theme
  if (sb.document.title !== expect[theme]) {
    console.error("FAIL [" + theme + "] title=" + JSON.stringify(sb.document.title) + " expected " + JSON.stringify(expect[theme]));
    ok = false;
  }
  // (transfer-station detection is verified post-loop against the parsed THEMES data)

  // start game
  (sb.__els["startBtn"]._l.click || []).forEach(fn => fn());
  drive(sb, 300);
  // enable autopilot (托管) and run more
  (sb.__els["autoBtn"]._l.click || []).forEach(fn => fn());
  drive(sb, 300);
  const score = parseInt(sb.__els["score"].textContent || "0", 10);
  if (!(score >= 8)) {
    console.error("FAIL [" + theme + "] player score " + score + " < 8 (did not survive/grow in open mode)");
    ok = false;
  }
  // metro: every line must have its own snake (全线网出战), text modes = player + 6 bots
  const T = THEMES[theme] || THEMES["77"];
  const wantSnakes = T.kind === "metro" ? T.lines.length : 7;
  const rankTxt = String(sb.__els["rank"].textContent || "");
  const total = parseInt(rankTxt.split("/")[1], 10);
  if (total !== wantSnakes) {
    console.error("FAIL [" + theme + "] snakes=" + total + " expected " + wantSnakes + " (rank=" + rankTxt + ")");
    ok = false;
  } else {
    console.log("  [" + theme + "] snakes on board: " + total + (T.kind === "metro" ? " (one per line)" : ""));
  }
  // landscape bitmap ratio (the stretch-bug guard)
  const g = sb.__els["game"];
  g.clientWidth = 800; g.clientHeight = 400;
  (sb.__winL.resize || []).forEach(fn => fn());
  if (!(g.width === 1600 && g.height === 800)) {
    console.error("FAIL [" + theme + "] landscape bitmap " + g.width + "x" + g.height + " expected 1600x800");
    ok = false;
  }
  console.log("PASS [" + theme + "] title ok · score=" + score + " · bitmap=" + g.width + "x" + g.height);
}

console.log(ok ? "\nALL PASS" : "\nSOME FAILED");

/* verify metro data yields transfer hubs — the engine derives TRANSFER (gold hubs) from this */
for (const id of ["beijing", "nanjing"]) {
  const T = THEMES[id];
  const seen = {};
  for (const L of T.lines) for (const s of L.stations) (seen[s] = seen[s] || new Set()).add(L.name);
  let c = 0; const ex = [];
  for (const s in seen) if (seen[s].size > 1) { c++; if (ex.length < 3) ex.push(s + "(" + [...seen[s]].join("/") + ")"); }
  if (c === 0) { console.error("FAIL [" + id + "] no transfer hubs in data"); ok = false; }
  else console.log("  [" + id + "] data transfer hubs: " + c + " (e.g. " + ex.join(" / ") + ")");
}

process.exit(ok ? 0 : 1);
