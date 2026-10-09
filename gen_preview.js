/* gen_preview.js —— 把 station_cards_*.json 变成可浏览的抽查页
 * 用法：node gen_preview.js
 * 产出：station-cards-preview.html（单文件，可离线打开）
 * 为什么要这个页：676 站的数据，质量好不好必须人工抽查，JSON 看不出来。
 */
const fs = require("fs");

const CITIES = ["beijing", "nanjing"];
const LABEL = { beijing: "北京", nanjing: "南京" };
const data = {};
CITIES.forEach(c => {
  try { data[c] = JSON.parse(fs.readFileSync("station_cards_" + c + ".json", "utf8")); }
  catch (e) { console.log("缺 station_cards_" + c + ".json"); }
});

// 线路归属（用于左侧列表分组）
function loadLines(city) {
  const s = fs.readFileSync("play.html", "utf8");
  const a = s.indexOf("const THEMES"), b = s.indexOf("THEMES.cc=", a);
  const vm = require("vm"), ctx = {}; vm.createContext(ctx);
  vm.runInContext(s.slice(a, b) + "\nvar __o=THEMES;", ctx);
  return ctx.__o[city].lines;
}
const lines = {};
CITIES.forEach(c => { try { lines[c] = loadLines(c); } catch (e) { lines[c] = []; } });

const payload = {};
CITIES.forEach(c => {
  if (!data[c]) return;
  payload[c] = { lines: lines[c].map(L => ({ name: L.name, color: L.color, stations: L.stations })), cards: data[c] };
});

const JSONSTR = JSON.stringify(payload).replace(/</g, "\\u003c");

const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>地铁站卡片数据 · 抽查页</title>
<style>
:root{--bg:#fbf7ee;--paper:#fffdf8;--ink:#2c2822;--soft:#6b6255;--line:#e3dbc9;
--teal:#2f9b95;--amber:#c9772e;--red:#b4453a;--green:#3f7d4e;--blue:#3a6ea5}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:"PingFang SC","Microsoft YaHei",system-ui,sans-serif;font-size:14px;line-height:1.7}
.top{background:var(--paper);border-bottom:1px solid var(--line);padding:14px 18px;position:sticky;top:0;z-index:10}
.top h1{margin:0;font-size:17px;letter-spacing:.5px}
.stat{font-size:12.5px;color:var(--soft);margin-top:4px}
.stat b{color:var(--teal)}
.wrap{display:flex;height:calc(100vh - 74px)}
.side{width:290px;flex:none;border-right:1px solid var(--line);overflow-y:auto;background:var(--paper)}
.citytab{display:flex;border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--paper);z-index:2}
.citytab div{flex:1;text-align:center;padding:9px 0;cursor:pointer;font-size:13px;border-bottom:2px solid transparent}
.citytab div.on{border-bottom-color:var(--teal);color:var(--teal);font-weight:600}
.ln{padding:8px 12px;border-bottom:1px solid #f0e9da}
.ln h4{margin:0 0 5px;font-size:12.5px;display:flex;align-items:center;gap:6px}
.dot{width:9px;height:9px;border-radius:50%;display:inline-block}
.chips{display:flex;flex-wrap:wrap;gap:3px}
.chip{font-size:11px;padding:2px 6px;border:1px solid var(--line);border-radius:5px;cursor:pointer;background:#fff}
.chip:hover{background:#f3ecdd}
.chip.has{border-color:var(--teal);color:var(--teal)}
.chip.her{border-color:var(--amber);color:var(--amber);font-weight:600}
.chip.empty{opacity:.45}
.main{flex:1;overflow-y:auto;padding:18px 22px}
.card{background:var(--paper);border:1px solid var(--line);border-radius:12px;padding:16px 18px;max-width:720px}
.card h2{margin:0 0 4px;font-size:20px}
.meta{font-size:12px;color:var(--soft);margin-bottom:14px}
.sec{margin:12px 0}
.sec h3{margin:0 0 6px;font-size:13px;color:var(--teal)}
.sec.her h3{color:var(--amber)}
.row{padding:5px 9px;border-left:3px solid var(--line);margin-bottom:5px;background:#fcf9f2;border-radius:0 6px 6px 0}
.row.her{border-left-color:var(--amber);background:#fdf6ec}
.row .n{font-weight:600}
.row .d{font-size:11.5px;color:var(--soft);margin-left:6px}
.row .lv{font-size:11px;background:#f3ecdd;border-radius:4px;padding:1px 6px;margin-left:6px;color:var(--amber)}
.src{font-size:10.5px;padding:1px 5px;border-radius:4px;margin-left:6px;border:1px solid}
.src-osm{color:var(--blue);border-color:#b9cbe4;background:#eaf0f8}
.src-wikidata{color:var(--green);border-color:#b3d4bb;background:#eaf3ec}
.none{color:var(--soft);font-size:13px;padding:10px;background:#f6f1e6;border-radius:8px}
.hintbox{background:#eaf0f8;border:1px solid #b9cbe4;border-radius:10px;padding:12px 14px;margin-bottom:16px;font-size:13px;max-width:720px}
.hintbox b{color:var(--blue)}
</style></head><body>
<div class="top">
  <h1>地铁站卡片数据 · 抽查页</h1>
  <div class="stat" id="stat"></div>
</div>
<div class="wrap">
  <div class="side">
    <div class="citytab" id="tabs"></div>
    <div id="list"></div>
  </div>
  <div class="main" id="main"></div>
</div>
<script>
var DATA = ${JSONSTR};
var CITY = "beijing", CUR = null;
var LABEL = ${JSON.stringify(LABEL)};

function esc(s){ return String(s||"").replace(/[&<>]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c];}); }

function stat(){
  var d = DATA[CITY], n = 0, her = 0, any = 0, poi = 0;
  if(d) for(var k in d.cards){ n++; var c = d.cards[k];
    var np = 0; for(var b in c.osm) np += c.osm[b].length;
    if(c.heritage.length) her++;
    if(np) poi++;
    if(np || c.heritage.length) any++; }
  document.getElementById("stat").innerHTML =
    LABEL[CITY]+" 共 <b>"+n+"</b> 站 · 有内容 <b>"+any+"</b>（"+(any/n*100).toFixed(1)+"%）· "+
    "有文保 <b>"+her+"</b> · 有 OSM POI <b>"+poi+"</b> · 空白 <b>"+(n-any)+"</b>　｜　"+
    "点击左侧站名查看。<span style=\"color:var(--amber)\">金色</span>=有文保单位，<span style=\"color:var(--teal)\">青色</span>=有 OSM 内容，灰色=空白";
}

function renderList(){
  var d = DATA[CITY]; if(!d) return;
  var h = "";
  d.lines.forEach(function(L){
    h += '<div class="ln"><h4><span class="dot" style="background:'+L.color+'"></span>'+esc(L.name)+'</h4><div class="chips">';
    L.stations.forEach(function(n){
      var c = d.cards[n], np = 0;
      if(c) for(var b in c.osm) np += c.osm[b].length;
      var cls = !c || (!c.heritage.length && !np) ? "empty" : (c.heritage.length ? "her" : "has");
      h += '<span class="chip '+cls+'" data-s="'+esc(n)+'">'+esc(n)+'</span>';
    });
    h += '</div></div>';
  });
  document.getElementById("list").innerHTML = h;
  var el = document.getElementById("list").querySelectorAll(".chip");
  for(var i=0;i<el.length;i++) el[i].onclick = function(){ show(this.getAttribute("data-s")); };
}

function show(n){
  var d = DATA[CITY]; if(!d) return;
  var c = d.cards[n]; CUR = n;
  if(!c){ document.getElementById("main").innerHTML = '<div class="none">无数据</div>'; return; }
  var h = '<div class="hintbox"><b>来源纪律</b>：金色 = Wikidata 文保单位（权威，含级别）；蓝色 = OSM（开放地图数据，可能含现代雕塑等噪声）。两者都不等于人工核实，入卡前需抽查。</div>';
  h += '<div class="card"><h2>'+esc(n)+'</h2>';
  var cs = {osm:"OSM 直接命中", interp:"同线相邻站插值", edge:"线路端点（精度低）", none:"无坐标"};
  h += '<div class="meta">坐标 '+(c.coord ? c.coord[0].toFixed(4)+", "+c.coord[1].toFixed(4) : "—")+
       ' · 来源 '+(cs[c.coordSrc]||c.coordSrc)+'</div>';

  if(c.heritage.length){
    h += '<div class="sec her"><h3>文物保护单位（Wikidata · 权威）</h3>';
    c.heritage.forEach(function(x){
      h += '<div class="row her"><span class="n">'+esc(x.n)+'</span>'+
           (x.level?'<span class="lv">'+esc(x.level.replace("文物保护单位",""))+'</span>':'')+
           '<span class="d">约 '+x.d+'m</span><span class="src src-wikidata">wikidata</span></div>';
    });
    h += '</div>';
  }
  var order = [["sight","景点 / 博物馆"],["heritage","历史古迹"],["worship","宗教场所"],["park","公园 / 绿地"],["other","其他"]];
  var anyOsm = false;
  order.forEach(function(o){
    var arr = c.osm[o[0]] || [];
    if(!arr.length) return; anyOsm = true;
    h += '<div class="sec"><h3>'+o[1]+'（OSM）</h3>';
    arr.forEach(function(p){
      h += '<div class="row"><span class="n">'+esc(p.n)+'</span>'+
           '<span class="d">约 '+p.d+'m · '+esc(p.cat)+'</span>'+
           (p.wiki?'<span class="src src-osm">有百科</span>':'')+'</div>';
    });
    h += '</div>';
  });
  if(!c.heritage.length && !anyOsm)
    h += '<div class="none">这一站周边 1200m 内，两个公开数据源都没有内容 —— 需要靠 UGC 或人工补充。</div>';
  h += '</div>';
  document.getElementById("main").innerHTML = h;
}

document.getElementById("tabs").innerHTML = Object.keys(DATA).map(function(c){
  return '<div data-c="'+c+'"'+(c===CITY?' class="on"':'')+'>'+LABEL[c]+'</div>'; }).join("");
var tb = document.getElementById("tabs").querySelectorAll("div");
for(var i=0;i<tb.length;i++) tb[i].onclick = function(){
  CITY = this.getAttribute("data-c");
  var a = document.getElementById("tabs").querySelectorAll("div");
  for(var j=0;j<a.length;j++) a[j].className = "";
  this.className = "on";
  stat(); renderList(); document.getElementById("main").innerHTML = "";
};
stat(); renderList();
</script></body></html>`;

fs.writeFileSync("station-cards-preview.html", html);
console.log("已生成 station-cards-preview.html");
Object.keys(data).forEach(c => {
  const cards = data[c], n = Object.keys(cards).length;
  let her = 0, any = 0;
  Object.keys(cards).forEach(k => {
    let np = 0; for (const b in cards[k].osm) np += cards[k].osm[b].length;
    if (cards[k].heritage.length) her++;
    if (np || cards[k].heritage.length) any++;
  });
  console.log("  " + c + ": " + n + " 站 · 有内容 " + any + " (" + (any / n * 100).toFixed(1) + "%) · 有文保 " + her);
});
