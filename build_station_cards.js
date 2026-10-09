/* build_station_cards.js —— 把 OSM POI + Wikidata 文保 合并成「每站有什么」的结构化数据
 *
 * 用法：node build_station_cards.js beijing
 *
 * 输出：
 *   station_cards_<city>.json   每站：坐标 + 分层内容（文保 / 景点 / 宗教 / 公园 / 其他）+ 来源标记
 *   stdout                      覆盖率报告（分源统计，重点看「有文保的站」有多少）
 *
 * 纪律：每条内容都带 src 标记（osm / wikidata-heritage），绝不混淆来源。
 */
const fs = require("fs");
const CITY = process.argv[2] || "beijing";
const R = 6371000, P = Math.PI / 180;
function dist(a, b, c, d) {
  const dLat = (c - a) * P, dLon = (d - b) * P;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a * P) * Math.cos(c * P) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
// 只保留落在城市范围内的文保（Wikidata 会串到别的省）
const BBOX = { beijing: [39.4, 41.1, 115.7, 117.5], nanjing: [31.1, 32.7, 118.3, 119.4] }[CITY];

const poi = JSON.parse(fs.readFileSync("station_poi_" + CITY + ".json", "utf8"));
const wh = JSON.parse(fs.readFileSync("wikidata_heritage.json", "utf8"))[CITY] || [];

const inBox = wh.filter(x => x.lat >= BBOX[0] && x.lat <= BBOX[1] && x.lon >= BBOX[2] && x.lon <= BBOX[3]);
console.log("文保单位 " + wh.length + " 条 → 落在 " + CITY + " 范围内 " + inBox.length + " 条");

// 文保半径放宽到 1200m：值得走一段的才算，也避免"最近地铁站"误判
const HER_R = 1200;
const out = {};
let stHer = 0, stPoi = 0, stAny = 0, stNone = 0;
const herUsed = new Set();

Object.keys(poi).forEach(name => {
  const s = poi[name];
  const c = s.coord;
  const heritage = c ? inBox.map(h => ({ h, d: dist(c[0], c[1], h.lat, h.lon) }))
      .filter(x => x.d <= HER_R).sort((a, b) => a.d - b.d) : [];
  heritage.forEach(x => herUsed.add(x.h.n + "@" + x.h.lat.toFixed(3)));

  // OSM POI 按类别分桶
  const bucket = { heritage: [], sight: [], worship: [], park: [], other: [] };
  (s.poi || []).forEach(p => {
    const item = { n: p.n, d: p.d, cat: p.cat, wiki: p.wiki };
    if (/^historic/.test(p.cat) || p.heritage) bucket.heritage.push(item);
    else if (/^(museum|attraction|artwork|gallery|viewpoint)/.test(p.cat)) bucket.sight.push(item);
    else if (/place_of_worship/.test(p.cat)) bucket.worship.push(item);
    else if (/^(park|garden)/.test(p.cat)) bucket.park.push(item);
    else bucket.other.push(item);
  });

  out[name] = {
    coord: c, coordSrc: s.coordSrc,
    heritage: heritage.slice(0, 6).map(x => ({ n: x.h.n, level: x.h.desig, d: Math.round(x.d), src: "wikidata" })),
    osm: bucket
  };
  const nHer = heritage.length, nPoi = (s.poi || []).length;
  if (nHer) stHer++;
  if (nPoi) stPoi++;
  if (nHer || nPoi) stAny++; else stNone++;
});

fs.writeFileSync("station_cards_" + CITY + ".json", JSON.stringify(out, null, 1));

const all = Object.keys(out);
console.log("\n=== " + CITY + " 合并结果（" + all.length + " 站）===");
console.log("  有文保单位     : " + stHer + " 站");
console.log("  有 OSM POI    : " + stPoi + " 站");
console.log("  至少有一类内容 : " + stAny + " 站  (" + (stAny / all.length * 100).toFixed(1) + "%)");
console.log("  完全空白       : " + stNone + " 站");
console.log("  文保被匹配上的 : " + herUsed.size + " / " + inBox.length + " 条");

const cnt = all.map(n => ({
  n, h: out[n].heritage.length,
  o: Object.keys(out[n].osm).reduce((a, k) => a + out[n].osm[k].length, 0) }))
  .sort((a, b) => (b.h * 3 + b.o) - (a.h * 3 + a.o));
console.log("\n  最丰富 8 站:");
cnt.slice(0, 8).forEach(x => console.log("   " + x.n + " 文保" + x.h + " / POI" + x.o +
  " → " + out[x.n].heritage.slice(0, 2).map(h => h.n).concat(out[x.n].osm.sight.slice(0, 2).map(p => p.n)).join(" / ")));
const onlyHer = cnt.filter(x => x.h > 0 && x.o === 0);
console.log("\n  只有文保、OSM 空白（说明文保补上了冷站）: " + onlyHer.length + " 站");
onlyHer.slice(0, 10).forEach(x => console.log("   " + x.n + " → " + out[x.n].heritage.slice(0, 3).map(h => h.n + "(" + h.level.replace("文物保护单位", "") + ")").join(" / ")));
const none = cnt.filter(x => x.h === 0 && x.o === 0);
console.log("\n  仍空白 " + none.length + " 站: " + none.slice(0, 20).map(x => x.n).join(" "));
