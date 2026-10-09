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
    id, style: {}, _l: {}, textContent: "", innerHTML: "", children: [],
    firstChild: null,
    classList: { add(){}, remove(){}, toggle(){}, contains(){ return false; } },
    addEventListener(t, fn) { (this._l[t] = this._l[t] || []).push(fn); },
    removeEventListener() {},
    setAttribute() {}, getAttribute() { return null; },
    appendChild(c) { this.children.push(c); this.firstChild = this.children[0]; return c; },
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); this.firstChild = this.children[0] || null; return c; },
    querySelector() { return makeEl("q"); },
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
  const S = sb.__SNAKE__ || sb.window.__SNAKE__;
  // 机制① 开局分散：这一刻刚 spawn 完，蛇头之间就该互相离得开
  const minD0 = S.minHeadDist();
  if (!(minD0 >= 4)) {
    console.error("FAIL [" + theme + "] spawn min head distance " + minD0.toFixed(2) + " < 4 (snakes spawn on top of each other)");
    ok = false;
  }
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
  // 机制① 运行中的拥挤度：不再要求「互不接触」（那不现实），而是看豆子是否铺开
  // 豆子分区均衡：不能全堆在少数分区里（那会把所有蛇吸到同一片）
  const zones = S.zoneCounts();
  const nonEmpty = zones.filter(v => v > 0).length;
  const maxZone = Math.max(...zones);
  if (!(nonEmpty >= 24)) {
    console.error("FAIL [" + theme + "] only " + nonEmpty + "/64 zones have food (should spread map-wide)");
    ok = false;
  }
  if (!(maxZone <= 9)) {
    console.error("FAIL [" + theme + "] a zone holds " + maxZone + " beans (cap is 5 + kills/boost spill)");
    ok = false;
  }

  // 机制② 打卡卡：同一个站吃到第 3 次必须出卡（精选 / 兜底两条路径都验）
  if (T.kind === "metro") {
    const curated = S.curated();
    if (!(curated.length >= 40)) {
      console.error("FAIL [" + theme + "] curated station cards only " + curated.length + " (expected >=40)");
      ok = false;
    }
    const cd = S.cardData();
    const bad = curated.filter(k => !((cd[k].sights && cd[k].sights.length) || (cd[k].food && cd[k].food.length)));
    if (bad.length) {
      console.error("FAIL [" + theme + "] cards with neither sights nor food: " + bad.slice(0, 5).join(","));
      ok = false;
    }
    // 精选站：吃满 3 次 → 出卡
    const r1 = S.simulateEat("天安门东", 3);
    if (!(r1.hits >= 3 && r1.cards >= 1)) {
      console.error("FAIL [" + theme + "] curated station card not unlocked after 3 eats: " + JSON.stringify(r1));
      ok = false;
    }
    // 没写卡片的站：也应出兜底模板卡（任何站都有内容）
    const r2 = S.simulateEat("苏州桥", 3);
    if (!(r2.cards >= 2)) {
      console.error("FAIL [" + theme + "] fallback card missing for un-curated station: " + JSON.stringify(r2));
      ok = false;
    }
    // 图鉴里能看到这两张
    const gh = String(S.galleryHtml() || "");
    if (gh.indexOf("天安门东") < 0 || gh.indexOf("苏州桥") < 0) {
      console.error("FAIL [" + theme + "] gallery is missing unlocked cards");
      ok = false;
    }
    // 未满 3 次不该出卡
    const r3 = S.simulateEat("王府井", 2);
    if (!(r3.cards === r2.cards)) {
      console.error("FAIL [" + theme + "] card fired before the 3rd eat: " + JSON.stringify(r3));
      ok = false;
    }
    console.log("  [" + theme + "] spread: spawnMinD=" + minD0.toFixed(1) + " zones=" + nonEmpty + "/64 maxZone=" + maxZone +
      " · cards=" + r3.count + " (curated " + curated.length + ")");
  }
  // 机制③ 成就大图：布局必须有效（无 NaN、站点齐全、点开不炸），且点亮口径正确
  if (T.kind === "metro") {
    const net = S.net();
    if (net.nan !== 0) { console.error("FAIL [" + theme + "] 线路图有 " + net.nan + " 个坐标异常"); ok = false; }
    // 唯一站数必须等于所有线路站名去重后的数量（漏一个就说明建图有 bug）
    const uniq = new Set();
    for (const L of T.lines) for (const st of L.stations) uniq.add(st);
    if (net.nodes !== uniq.size) {
      console.error("FAIL [" + theme + "] 线路图节点 " + net.nodes + " ≠ 唯一站数 " + uniq.size);
      ok = false;
    }
    // 最近两点间距：不能小于两倍最小半径（会叠在一起糊成一团）
    if (!(net.minSep >= 1.5)) {
      console.error("FAIL [" + theme + "] 线路图最小间距 " + (net.minSep || 0).toFixed(2) + " 过小（站点重叠）");
      ok = false;
    }
    const hud0 = S.openAchieve();                 // 打开大图不应抛异常
    if (!(hud0 && hud0.total === net.nodes)) {
      console.error("FAIL [" + theme + "] 成就面板统计异常: " + JSON.stringify(hud0));
      ok = false;
    }
    if (!S.drawAchieve()) { console.error("FAIL [" + theme + "] drawAchieve 未建立视图变换"); ok = false; }
    // 点亮口径：吃过 3 次 = 已点亮；吃过 1 次 = 吃过待读卡
    const lit0 = S.net().lit;
    S.simulateEat("奥体中心", 1);
    if (S.net().eat < 1) { console.error("FAIL [" + theme + "] 吃过 1 次没记进「吃过待读卡」"); ok = false; }
    if (S.net().lit !== lit0) { console.error("FAIL [" + theme + "] 只吃 1 次就点亮亮了（口径错）"); ok = false; }
    S.simulateEat("奥体中心", 2);
    if (S.net().lit !== lit0 + 1) { console.error("FAIL [" + theme + "] 吃满 3 次没点亮"); ok = false; }
    console.log("  [" + theme + "] 成就大图: " + net.nodes + " 站 / " + net.edges + " 段 · 最近间距 " +
      net.minSep.toFixed(2) + " · 换乘 " + net.hub + " · 点亮 " + S.net().lit);
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
