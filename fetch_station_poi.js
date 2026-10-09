/* fetch_station_poi.js —— 批量生产「地铁站附近有什么」结构化数据
 *
 * 用法：node fetch_station_poi.js [beijing|nanjing]
 *
 * 思路：
 *   A 坐标：OSM 直接匹配 → 匹配不上的用「同线相邻已知站插值」补（地铁站间距均匀）
 *   B 抓 POI：按【线路】分组（不是网格分片）——一条线的站围出的 bbox 小、贴合实际分布，
 *             Overpass 不容易超时；线太长就再按段切。每片结果落盘缓存，失败可单线重跑。
 *   C 匹配：800m 半径内，按距离排序，降噪去重
 *   D 输出：station_poi_<city>.json + 覆盖率报告
 */
["HTTPS_PROXY","HTTP_PROXY","https_proxy","http_proxy","ALL_PROXY","all_proxy"].forEach(k=>delete process.env[k]);
const https = require("https"), fs = require("fs"), vm = require("vm"), path = require("path");

const CITY = process.argv[2] || "beijing";
const CACHE = path.join(__dirname, "poi_cache");
fs.mkdirSync(CACHE, { recursive: true });

const MIRRORS = ["https://overpass-api.de/api/interpreter",
                 "https://overpass.kumi.systems/api/interpreter",
                 "https://overpass.private.coffee/api/interpreter"];
const UA = "station-card-builder/1.0 (open data research)";

function postForm(url, body, timeout) {
  return new Promise((res) => {
    const u = new URL(url);
    const t = setTimeout(() => res({ err: "TIMEOUT" }), timeout || 90000);
    const req = https.request({ hostname: u.hostname, path: u.pathname, method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded",
                 "Content-Length": Buffer.byteLength(body), "User-Agent": UA } },
      (r) => { let d = ""; r.on("data", c => d += c);
        r.on("end", () => { clearTimeout(t); res({ status: r.statusCode, body: d }); }); });
    req.on("error", e => { clearTimeout(t); res({ err: e.message }); });
    req.end(body);
  });
}
const sleep = ms => new Promise(s => setTimeout(s, ms));
async function ov(q, tag) {
  for (let i = 0; i < MIRRORS.length; i++) {
    const r = await postForm(MIRRORS[i], "data=" + encodeURIComponent(q));
    if (!r.err && r.status === 200) {
      try { const j = JSON.parse(r.body); return j; } catch (e) {}
    }
    await sleep(1500);
  }
  console.log("   ✗ 失败: " + tag);
  return null;
}

/* ---------- A. 站名与坐标 ---------- */
function loadTheme() {
  const s = fs.readFileSync("play.html", "utf8");
  const a = s.indexOf("const THEMES");            // 注意：是 const，且带空格
  const b = s.indexOf("THEMES.cc=", a);
  const seg = s.slice(a, b);
  const ctx = {}; vm.createContext(ctx);
  vm.runInContext(seg + "\nvar __out = THEMES;", ctx);
  return ctx.__out;
}
function loadOsm() {
  return JSON.parse(fs.readFileSync("osm_stations_" + CITY + ".json", "utf8"));
}
const R = 6371000, P = Math.PI / 180;
function dist(a, b, c, d) {
  const dLat = (c - a) * P, dLon = (d - b) * P;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a * P) * Math.cos(c * P) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

(async () => {
  const T = loadTheme()[CITY];
  const osm = loadOsm();
  const lines = T.lines;                   // [{name, color, stations:[...]}]
  const map = osm.map;                     // OSM 站名 → 坐标
  const norm = n => n.replace(/\s/g, "");

  // A1 直接命中
  const coord = {}, src = {};
  lines.forEach(L => L.stations.forEach(n => {
    const c = map[norm(n)];
    if (c) { coord[n] = [c.lat, c.lon]; src[n] = "osm"; }
  }));

  // A2 同线相邻已知站插值（地铁相邻站间距大致均匀，误差可接受）
  lines.forEach(L => {
    const st = L.stations, known = st.map(n => coord[n] ? true : false);
    st.forEach((n, i) => {
      if (coord[n]) return;
      let p = null, q = null, gap = 1;
      for (let j = i - 1; j >= 0; j--) if (coord[st[j]]) { p = { c: coord[st[j]], k: j }; break; }
      for (let j = i + 1; j < st.length; j++) if (coord[st[j]]) { q = { c: coord[st[j]], k: j }; break; }
      if (p && q) {
        const t = (i - p.k) / (q.k - p.k);
        coord[n] = [p.c[0] + (q.c[0] - p.c[0]) * t, p.c[1] + (q.c[1] - p.c[1]) * t];
        src[n] = "interp";
      } else if (p || q) {
        const base = (q || p).c;
        coord[n] = [base[0], base[1]];      // 端点外推退化为重合，标记出来
        src[n] = "edge";
      }
    });
  });

  const all = [];
  lines.forEach(L => L.stations.forEach(n => { if (all.indexOf(n) < 0) all.push(n); }));
  const noCoord = all.filter(n => !coord[n]);
  console.log("=== " + CITY + " 坐标 ===");
  console.log("  站点 " + all.length + " · OSM 直接 " + Object.values(src).filter(x => x === "osm").length +
    " · 插值 " + Object.values(src).filter(x => x === "interp").length +
    " · 端点退化 " + Object.values(src).filter(x => x === "edge").length +
    " · 仍无坐标 " + noCoord.length);
  if (noCoord.length) console.log("  无坐标:", noCoord.join(" "));

  /* ---------- B. 按线路抓 POI ---------- */
  const CATS = `nwr["historic"](%B%);
  nwr["tourism"~"^(museum|attraction|artwork|gallery|viewpoint)$"](%B%);
  nwr["amenity"="place_of_worship"](%B%);
  nwr["leisure"~"^(park|garden)$"](%B%);`;

  const MAXSEG = 6;        // 每条线最多切成几段
  const BUF = 0.012;       // bbox 缓冲约 1km
  let raw = [], fail = 0;

  for (const L of lines) {
    const cs = L.stations.map(n => coord[n]).filter(Boolean);
    if (!cs.length) { console.log("  ✗ " + L.name + " 无坐标，跳过"); fail++; continue; }
    // 按段切：把该线的站按数量均分，避免长线 bbox 过大
    const nSeg = Math.min(MAXSEG, Math.max(1, Math.ceil(cs.length / 8)));
    for (let s = 0; s < nSeg; s++) {
      const part = cs.slice(Math.floor(cs.length * s / nSeg), Math.floor(cs.length * (s + 1) / nSeg));
      if (!part.length) continue;
      const la = part.map(c => c[0]), lo = part.map(c => c[1]);
      const box = [Math.min(...la) - BUF, Math.min(...lo) - BUF,
                   Math.max(...la) + BUF, Math.max(...lo) + BUF].map(x => x.toFixed(4)).join(",");
      const key = (CITY + "_" + L.name + "_" + s).replace(/[^\w\u4e00-\u9fa5-]/g, "_");
      const cf = path.join(CACHE, key + ".json");
      let j = null;
      if (fs.existsSync(cf)) { try { j = JSON.parse(fs.readFileSync(cf, "utf8")); } catch (e) {} }
      if (!j) {
        j = await ov(`[out:json][timeout:60];(\n${CATS.split("%B%").join(box)}\n);\nout center tags;`, key);
        if (j) fs.writeFileSync(cf, JSON.stringify(j)); else { fail++; continue; }
        await sleep(1200);
      }
      (j.elements || []).forEach(e => raw.push(e));
      process.stdout.write("   " + L.name + " 段" + (s + 1) + "/" + nSeg + " ok(" + (j.elements || []).length + ")\n");
    }
  }

  /* ---------- C. 清洗 ---------- */
  const seen = new Set(), pois = [];
  raw.forEach(e => {
    const t = e.tags || {};
    const lat = e.lat != null ? e.lat : (e.center && e.center.lat);
    const lon = e.lon != null ? e.lon : (e.center && e.center.lon);
    if (!t.name || lat == null) return;
    const k = t.name + "@" + lat.toFixed(4) + "," + lon.toFixed(4);
    if (seen.has(k)) return; seen.add(k);
    // 降噪：微缩景观/仿建类（一批外文名胜挤在一起）
    if (/^(Abu Simbel|Arc de Triomphe|Coliseum|Egyptian|Eiffel|Taj Mahal|Statue of Liberty)/i.test(t.name)) return;
    pois.push({ n: t.name, lat, lon,
      cat: t.historic ? "historic/" + t.historic : (t.tourism || t.amenity || t.leisure || ""),
      heritage: !!t.heritage, wiki: !!(t.wikipedia || t.wikidata) });
  });
  console.log("\n  POI 去重后 " + pois.length + " 条 · 抓取出错分片 " + fail);

  /* ---------- D. 匹配到站 ---------- */
  const RANGE = 800, out = {};
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0;
  all.forEach(n => {
    const c = coord[n];
    const near = c ? pois.map(p => ({ p, d: dist(c[0], c[1], p.lat, p.lon) }))
                        .filter(x => x.d <= RANGE).sort((a, b) => a.d - b.d) : [];
    out[n] = { coord: c || null, coordSrc: src[n] || "none", poi: near.slice(0, 12).map(x => ({
      n: x.p.n, cat: x.p.cat, d: Math.round(x.d), heritage: x.p.heritage, wiki: x.p.wiki })) };
    const k = near.length;
    if (!c) b0++; else if (k === 0) b0++; else if (k <= 2) b1++; else if (k <= 5) b2++; else b3++;
  });
  fs.writeFileSync("station_poi_" + CITY + ".json", JSON.stringify(out, null, 1));

  console.log("\n=== " + CITY + " 覆盖率（半径 " + RANGE + "m）===");
  console.log("  空白(无坐标或无 POI) : " + b0);
  console.log("  1-2 条              : " + b1);
  console.log("  3-5 条              : " + b2);
  console.log("  6 条以上            : " + b3);
  console.log("  有内容              : " + (all.length - b0) + "/" + all.length +
    " = " + ((all.length - b0) / all.length * 100).toFixed(1) + "%");
  const rich = all.map(n => ({ n, k: out[n].poi.length })).sort((a, b) => b.k - a.k);
  console.log("\n  最丰富 6 站:");
  rich.slice(0, 6).forEach(x => console.log("   " + x.n + " (" + x.k + ") " + out[x.n].poi.slice(0, 4).map(p => p.n).join(" / ")));
  const empty = all.filter(n => out[n].poi.length === 0);
  console.log("\n  空白站 " + b0 + " 个，抽样 15: " + empty.slice(0, 15).join(" "));
})();
