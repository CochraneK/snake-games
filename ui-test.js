/* ui-test.js —— 浏览器端 UI 自检（真实布局 / 抽屉 / FAB / 图鉴）
   用法：node ui-test.js
   为什么单独一份：smoke-test.js 是 vm + DOM 打桩，量不到真实几何（抽屉滑出位置、
   底部弹层高度、位图是否等于 CSS 盒子）。这些只能在真浏览器里验。
   产出：临时生成 _ui_probe.html（由 play.html 注入探针而来），跑完自动删掉。 */
const fs = require("fs");
const cp = require("child_process");
const path = require("path");

const DIR = __dirname;
const SRC = path.join(DIR, "play.html");
const OUT = path.join(DIR, "_ui_probe.html");
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";

const s = fs.readFileSync(SRC, "utf8");

const probe = `
<script>
(function(){
  var out={};
  function P(k,v){ out[k]=v; }
  function vis(el){ if(!el) return "null"; var r=el.getBoundingClientRect();
    return Math.round(r.width)+"x"+Math.round(r.height)+"@"+Math.round(r.left)+","+Math.round(r.top); }
  function clk(id){ var e=document.getElementById(id); if(!e){ P("MISSING_"+id,1); return false;} e.click(); return true; }
  try{
    var st=document.createElement("style");
    st.textContent="#drawer,#drawerMask,.fab,#drawer *{transition:none!important}";
    document.head.appendChild(st);
    P("vp", window.innerWidth+"x"+window.innerHeight);
    clk("startBtn");                      // 不点开始，running=false，测不到抽屉自动暂停
    P("startOverlay", document.getElementById("startOverlay").className);

    P("fabBtns", document.querySelectorAll(".fab button").length);
    P("canvasCss", vis(document.getElementById("game")));
    var cv=document.getElementById("game");
    P("canvasBmp", cv.width+"x"+cv.height);

    /* 设置抽屉 */
    clk("fabSet");
    var d=document.getElementById("drawer");
    P("set_cls", d.className);
    P("set_title", document.getElementById("drawerTitle").textContent);
    P("set_btns", document.querySelectorAll("#drawer .dr-btn").length);
    P("set_box", vis(d));
    P("set_fabOn", document.getElementById("fabSet").className);
    clk("drawerX");
    P("closed_cls", d.className);

    /* 排行榜：board 收进抽屉，关掉要还回去 */
    clk("fabRank");
    P("rank_title", document.getElementById("drawerTitle").textContent);
    P("rank_boardIn", document.getElementById("board").closest("#drawer")?1:0);
    P("rank_chips", document.querySelectorAll("#drawer #board .chip").length);
    clk("drawerMask");
    P("rank_boardBackInDrawer", document.getElementById("board").closest("#drawer")?1:0);

    /* 说明：hint 收进抽屉 */
    clk("fabHelp");
    var hn=document.querySelector(".hint");
    P("help_hintIn", hn&&hn.closest&&hn.closest("#drawer")?1:0);
    clk("drawerX");
    P("help_hintBack", document.querySelector(".hint").closest("#drawer")?1:0);

    /* 图鉴 / 成就 */
    var cg=document.getElementById("cardGallery"), ae=document.getElementById("achieve");
    clk("fabGal");
    P("gal_cls", cg.className);
    P("gal_filters", document.querySelectorAll(".gal-f").length);
    clk("galClose"); P("gal_closed", cg.className.indexOf("hidden")>=0?1:0);
    clk("fabAch");   P("ach_cls", ae.className.indexOf("hidden")<0?1:0);
    clk("achClose"); P("ach_closed", ae.className.indexOf("hidden")>=0?1:0);

    /* 抽屉 = 自动暂停，关闭恢复 */
    var pb=document.getElementById("pauseBtn");
    P("pause_before", pb.textContent);
    clk("fabSet");   P("pause_opened", pb.textContent);
    clk("drawerX");  P("pause_closed", pb.textContent);

    /* 布局双向切换 + 持久化 */
    clk("fabSet");
    var bs=document.querySelectorAll("#drawer .dr-btn"), cl=null;
    for(var i=0;i<bs.length;i++){ if(bs[i].textContent.indexOf("经典布局")>=0) cl=bs[i]; }
    P("classicBtnFound", cl?1:0);
    if(cl) cl.click();
    P("classic_cpt", document.body.classList.contains("cpt")?1:0);
    P("classic_toolbar", vis(document.querySelector(".toolbar")));
    P("classic_fab", vis(document.querySelector(".fab")));
    P("classic_ls", (function(){ try{ return localStorage.getItem("snake_cpt"); }catch(e){ return "err"; } })());
    var bs2=document.querySelectorAll("#drawer .dr-btn");
    for(var j=0;j<bs2.length;j++){ if(bs2[j].textContent.indexOf("紧凑布局")>=0) bs2[j].click(); }
    P("back_cpt", document.body.classList.contains("cpt")?1:0);
    P("back_ls", (function(){ try{ return localStorage.getItem("snake_cpt"); }catch(e){ return "err"; } })());
    clk("drawerX");
  }catch(e){ P("ERR", e.message); }
  var el=document.createElement("div"); el.id="__probe";
  el.textContent=JSON.stringify(out);
  document.body.appendChild(el);
})();
<\/script>
`;

fs.writeFileSync(OUT, s.replace(/<\/body>/i, probe + "</body>"));

function run(name, w, h) {
  const r = cp.spawnSync(CHROME, [
    "--headless=new", "--disable-gpu", "--no-sandbox",
    "--window-size=" + w + "," + h,
    "--virtual-time-budget=4000",
    "--dump-dom",
    "file:///" + OUT.replace(/\\/g, "/") + "?theme=beijing"
  ], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const dom = r.stdout || "";
  const i = dom.indexOf('<div id="__probe">');   // 不能用 id="__probe"：注入脚本里的 el.id="__probe" 会先命中
  if (i < 0) { console.log("NO PROBE in " + name); return null; }
  const a = i + '<div id="__probe">'.length;
  const b = dom.indexOf("</div>", a);
  let txt = dom.slice(a, b)
    .replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  let o; try { o = JSON.parse(txt); } catch (e) { console.log("BAD JSON " + name + ": " + txt.slice(0, 300)); return null; }

  let fail = 0;
  function ck(k, cond, detail) {
    if (!cond) { fail++; console.log("  FAIL [" + name + "] " + k + (detail !== undefined ? " → " + detail : "")); }
  }
  // 抽屉几何：桌面右侧整条、手机底部整宽
  const vp = (o.vp || "").split("x").map(Number);
  const box = (o.set_box || "").split("@")[0].split("x").map(Number);
  const pos = (o.set_box || "").split("@")[1].split(",").map(Number);
  const mobile = w < 620;
  if (mobile) {
    ck("抽屉=底部弹层整宽", Math.abs(box[0] - vp[0]) <= 2, o.set_box + " vp=" + o.vp);
    ck("抽屉贴底", Math.abs(pos[1] + box[1] - vp[1]) <= 2, o.set_box);
  } else {
    ck("抽屉贴右", Math.abs(pos[0] + box[0] - vp[0]) <= 20, o.set_box + " vp=" + o.vp);
    ck("抽屉满高", Math.abs(box[1] - vp[1]) <= 4, o.set_box);
  }
  ck("FAB 5 个圆钮", o.fabBtns === 5, o.fabBtns);
  ck("设置抽屉打开", (o.set_cls || "").indexOf("on") >= 0, o.set_cls);
  ck("设置项 >=5", o.set_btns >= 5, o.set_btns);
  ck("圆钮高亮", (o.set_fabOn || "").indexOf("on") >= 0, o.set_fabOn);
  ck("关闭后清空状态", (o.closed_cls || "x").indexOf("on") < 0, o.closed_cls);
  ck("排行榜收进抽屉", o.rank_boardIn === 1, o.rank_boardIn);
  ck("排行榜有条目", o.rank_chips > 0, o.rank_chips);
  ck("关闭后 board 归还", o.rank_boardBackInDrawer === 0, o.rank_boardBackInDrawer);
  ck("说明收进抽屉", o.help_hintIn === 1, o.help_hintIn);
  ck("关闭后 hint 归还", o.help_hintBack === 0, o.help_hintBack);
  ck("图鉴 4 个筛选", o.gal_filters === 4, o.gal_filters);
  ck("图鉴可关", o.gal_closed === 1, o.gal_closed);
  ck("成就可开", o.ach_cls === 1, o.ach_cls);
  ck("成就可关", o.ach_closed === 1, o.ach_closed);
  ck("开抽屉自动暂停", o.pause_opened === "继续", o.pause_before + "/" + o.pause_opened + "/" + o.pause_closed);
  ck("关抽屉恢复运行", o.pause_closed === "暂停", o.pause_closed);
  ck("有经典布局入口", o.classicBtnFound === 1, o.classicBtnFound);
  ck("切到经典（无 cpt）", o.classic_cpt === 0, o.classic_cpt);
  ck("经典态工具栏可见", /\d+x\d+/.test(o.classic_toolbar || "") && parseInt(o.classic_toolbar) > 0, o.classic_toolbar);
  ck("经典态圆钮仍在（不会切不回来）", parseInt(o.classic_fab) > 0, o.classic_fab);
  ck("切回紧凑", o.back_cpt === 1, o.back_cpt);
  ck("布局持久化", o.classic_ls === "0" && o.back_ls === "1", o.classic_ls + "/" + o.back_ls);
  ck("画布位图=CSS 盒子", (function () {
    var c = (o.canvasCss || "").split("@")[0].split("x").map(Number);
    var b = (o.canvasBmp || "").split("x").map(Number);
    return Math.abs(c[0] - b[0]) <= 6 && Math.abs(c[1] - b[1]) <= 6;
  })(), o.canvasCss + " vs " + o.canvasBmp);
  ck("无运行时异常", !o.ERR, o.ERR);

  console.log((fail ? "FAIL" : "PASS") + " [" + name + "] " + (mobile ? "手机" : "桌面") +
    " " + w + "x" + h + " · 抽屉" + o.set_box + " · 画布" + o.canvasBmp +
    (fail ? " · " + fail + " 项未过" : ""));
  return fail;
}

let total = 0;
total += run("desktop", 1280, 860) || 0;
total += run("mobile", 390, 844) || 0;
try { fs.unlinkSync(OUT); } catch (e) {}
console.log(total ? "UI 有 " + total + " 项未通过" : "UI ALL PASS");
process.exit(total ? 1 : 0);
