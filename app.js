/* 필투두 — 사장님 할 일·한 일, 클실장 할 일·한 일을 한곳에서.
   데이터: Supabase pt_items(행 하나 = 할 일 하나, 내용은 data). 클실장 몫 칸과 사장님 몫 칸(체크·메모·주소·답·미루기)을 나눠
   서로 덮어쓰지 않게 합친다. 이 기기에는 열린 일 + 최근 60일만 두고, 지난 일은 검색할 때 서버에서 가져온다(용량 차지 없음). */
(function () {
  "use strict";
  var CFG = window.PT_CONFIG || {}, SB = !!(CFG.url && CFG.key && window.fetch);
  var CATS = [["올리기", "콘텐츠 올리기", "#e8590c"], ["수정", "올린 글 고치기", "#1c7ed6"], ["판단", "결정해 주실 것", "#7048e8"],
    ["설정", "카페·사이트 설정", "#0ca678"], ["연락", "업체 연락·확인", "#d6336c"], ["확인", "확인·점검", "#5c677d"], ["기타", "기타", "#868e96"]];
  var CAT = {}; CATS.forEach(function (c) { CAT[c[0]] = { label: c[1], color: c[2] }; });
  var KEEP_DAYS = 60;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  var LS = {
    get: function (k, d) { try { var v = localStorage.getItem("pt_" + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem("pt_" + k, JSON.stringify(v)); return true; } catch (e) { return false; } },   // 저장 공간이 차면 false(PT-07)
    full: false, lost: false
  };
  var S = {
    items: LS.get("items", {}), dirty: LS.get("dirty", {}), since: LS.get("since", ""), view: LS.get("view", "todo"),
    cat: LS.get("cat", "전체"), mode: LS.get("mode", "all") === "prog" ? "all" : LS.get("mode", "all"), open: LS.get("open", {}), drafts: LS.get("drafts", {}), msg: "", busy: false, local: false,
    dq: "", dmonth: "", karea: "전체", kq: "", kmonth: "", remote: { done: null, log: null }, rbusy: false,
    fq: "", fk: "전체", fprev: "todo", fr: null, fbusy: false
  };
  var sess = LS.get("sess", null);
  /* 이 기기 저장(2026-11-24 고침 PT-04·07): 아직 서버에 안 올라간 할 일(dirty)은 큰 목록과 따로 'pend'(계정별)에도 남긴다 —
     저장 공간이 차서 큰 목록을 못 써도, 로그아웃해도, 같은 계정으로 다시 열면 그대로 올라간다. */
  function uidNow() { return sess && sess.user ? sess.user.id : ""; }
  function pendAll() { var P = LS.get("pend", {}); return isObj(P) ? P : {}; }
  function freeSpace() {   // 서버에 이미 있는 지난 기록(클실장 한 일·끝난 일)부터 이 기기에서 비운다 — 서버는 그대로
    var cut = addDays(today(), -14);
    Object.keys(S.items).forEach(function (id) {
      var x = S.items[id]; if (S.dirty[id]) return;
      if (x.kind === "log" || ((x.status === "done" || x.status === "cancel") && (x.doneAt || "").slice(0, 10) < cut)) delete S.items[id];
    });
  }
  function save() {
    var uid = uidNow(), P = pendAll(), mine = {};
    Object.keys(S.dirty).forEach(function (id) { if (S.items[id]) mine[id] = S.items[id]; });
    if (uid) { if (Object.keys(mine).length) P[uid] = mine; else delete P[uid]; }
    var small = function () { return LS.set("pend", P) && LS.set("dirty", S.dirty); };
    var ok = small() && LS.set("since", S.since) && LS.set("items", S.items), cut = false;
    if (!ok) { freeSpace(); ok = small() && LS.set("since", S.since) && LS.set("items", S.items); }
    if (!ok) { try { localStorage.removeItem("pt_items"); } catch (e) { } ok = small() && LS.set("since", ""); cut = true; }   // 큰 목록은 다음에 서버에서 다시 받는다
    var was = LS.lost; LS.lost = !ok; LS.full = cut || !ok;
    if (LS.lost && !was) { toast(FULL_MSG); if (SB && sess) syncSoon(); }
    return ok;
  }
  var FULL_MSG = "⚠ 이 기기 저장 공간이 꽉 차 방금 고친 것을 이 기기에 남기지 못했습니다. 인터넷이 되면 바로 서버에 올립니다 — 이 화면을 닫지 말고 맨 위 [💾 저장]을 눌러 주세요.";
  function savedToast(m) { toast(LS.lost ? FULL_MSG : m + (LS.full ? " (이 기기 저장 공간이 거의 차서 지난 기록 일부는 서버에만 둡니다)" : "")); }
  function restorePend() {   // 지난번에 못 올린 것(저장 공간 부족·로그아웃)을 되살려 다시 올린다
    var uid = uidNow(), P = pendAll(), mine = uid && isObj(P[uid]) ? P[uid] : null;
    if (!mine) return 0;
    Object.keys(mine).forEach(function (id) { S.items[id] = merge(mine[id], S.items[id]); S.dirty[id] = 1; });
    return Object.keys(mine).length;
  }
  /* ---------- 💾 저장(2026-11-19 사장님, 원장 261119-110): 하다 만 입력·펼친 카드·보던 자리를 그대로 남겨 언제 다시 열어도 이어서 ---------- */
  function dk(act, id, k) { return act + "|" + id + "|" + (k || ""); }
  function draftOf(act, id, k, saved) { var v = S.drafts[dk(act, id, k)]; return v != null ? v : saved; }
  function saveUi() { LS.set("open", S.open); LS.set("cat", S.cat); LS.set("view", S.view === "find" ? (S.fprev || "todo") : S.view); LS.set("mode", S.mode); LS.set("scroll", window.scrollY || 0); LS.set("drafts", S.drafts); }
  function markSave() {
    var b = document.getElementById("saveBtn"); if (!b) return;
    var n = Object.keys(S.drafts).length + Object.keys(S.dirty).length;   // 치는 중인 글 + 아직 서버에 안 올라간 할 일(PT-18)
    b.classList.toggle("dirty", n > 0);
    b.textContent = n ? "💾 저장 (" + n + ")" : "💾 저장";
    b.title = n ? "아직 서버에 안 올라간 것 " + n + "개 — 누르면 저장" : "지금 화면(체크·입력·펼친 카드·보던 자리) 저장";
  }
  function saveAll() {
    var n = 0;
    Object.keys(S.drafts).forEach(function (key) {
      var p = key.split("|"), act = p[0], id = p[1], k = p[2], x = S.items[id], v = S.drafts[key];
      if (!x) { delete S.drafts[key]; return; }
      if (act === "url") { var u = Object.assign({}, x.urls || {}); u[k] = String(v).trim(); setUser(id, { urls: u }, true); delete S.drafts[key]; n++; }
      else if (act === "note") { setUser(id, { note: v }, true); delete S.drafts[key]; n++; }
      // ans(직접 답하기)는 보내는 순간 '답함·완료'가 되므로 저장 때는 이 기기에 쓰던 글로만 남긴다
    });
    saveUi(); save(); render(); markSave();
    var keep = Object.keys(S.drafts).length;
    var m = "저장했습니다 — 언제 다시 열어도 지금 화면 그대로 이어집니다" + (keep ? " (쓰다 만 답 " + keep + "개는 이 기기에 보관)" : "");
    if (SB && sess) doSync().then(function () { toast(m); }, function () { toast("이 기기에 저장했습니다 — 인터넷이 되면 서버에도 올라갑니다"); });
    else toast(sess ? m : "이 기기에 저장했습니다 (로그인하면 PC·폰에 같이 보입니다)");
    return n;
  }

  /* ---------- 날짜 ---------- */
  function ymd(d) { d = d || new Date(); return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2); }
  function today() { return ymd(new Date()); }
  function addDays(s, n) { var p = s.split("-"), d = new Date(+p[0], +p[1] - 1, +p[2]); d.setDate(d.getDate() + n); return ymd(d); }
  var WD = "일월화수목금토";
  function md(s) { if (!s) return ""; var p = s.slice(0, 10).split("-"), d = new Date(+p[0], +p[1] - 1, +p[2]); return (+p[1]) + "/" + (+p[2]) + "(" + WD[d.getDay()] + ")"; }
  function nowIso() { return new Date().toISOString(); }

  /* ---------- 분류 ---------- */
  function isOpen(x) { return x.kind === "task" && x.status !== "done" && x.status !== "cancel"; }
  function bucket(x) {
    var td = today();
    if (x.snoozeTo && x.snoozeTo > td) return "snooze";
    if (x.due && x.due < td) return "late";
    if (x.due === td) return "today";
    if (x.due && x.due <= addDays(td, 7)) return x.pri === 1 && x.due <= addDays(td, 1) ? "today" : "week";
    if (x.due) return "later";
    return x.pri === 1 ? "today" : x.pri === 2 ? "week" : "free";
  }
  var BUCKETS = [["late", "늦은 일", "기한이 지났습니다"], ["today", "오늘 꼭", "시간이 없어도 이것만은"], ["week", "이번 주", "날짜가 다가오는 일"],
    ["free", "여유 있을 때", "시간 날 때 하나씩"], ["later", "예정", "날짜가 되면 위로 올라옵니다"], ["snooze", "미룬 일", "미룬 날짜가 되면 다시 올라옵니다"]];

  /* ==== MERGE BEGIN — 합치기(동기화). 2026-11-24 고침(전수조사 PT-01~06·28, 원장 261124-42 — 사장님: "필투두에 있는 내 할일들이 지워지거나 그러면 절대 안되고")
     할 일 하나 = 클실장 몫(제목·순서·설명…, 시각 u) + 사장님 몫(상태·메모·미루기·답·주소·순서 체크·💡반응).
     예전엔 사장님 몫을 통째로 '마지막에 손댄 기기' 것으로 골라, 다른 기기에서 다른 칸을 고친 것이 지워졌다.
     이제 사장님 몫은 칸마다(주소·체크·반응은 한 줄마다) 손댄 시각(uut)을 따로 두고 칸별로 더 새것을 고른다.
     서버도 똑같은 규칙(Supabase public.pt_merge · 트리거 pt_items_merge)으로 합쳐서, 어느 기기가 옛 자료를 올려도 새 칸을 덮지 못한다.
     옛 자료(uut 없음)는 옮기지 않고 그대로 읽는다 — uu(마지막 손댄 시각)가 칸별 시각보다 새것이면 그 기기의 '있는 칸'은 모두 uu 에 고친 것으로 본다(예전 방식).
     없는 칸은 '모름'(-1)이라 있는 값을 지우지 못한다. 순서 체크는 순서 번호 그대로 두되, 클실장이 순서를 바꿔 올리면 그 전 순서 문장('t:문장')으로 옮겨 붙인다(PT-05).
     이 블록은 tools/test_merge.py 가 꺼내(node) 파이썬 판(tools/ptmerge.py)과 같은 답을 내는지 시험한다(서버 SQL 대조는 그 파일 머리 설명) — 규칙을 바꾸면 SQL(public.pt_merge 등)도 같이 바꾼다. */
  var UGRP = { st: ["status", "doneAt", "doneBy"], note: ["note"], snoozeTo: ["snoozeTo"], answer: ["answer"] };
  var UMAP = ["urls", "checks", "react"];
  var GOF = {}; Object.keys(UGRP).forEach(function (g) { UGRP[g].forEach(function (k) { GOF[k] = g; }); });
  var META = ["u", "uu", "uut", "t0"];
  function isObj(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }
  function own(o, k) { return isObj(o) && Object.prototype.hasOwnProperty.call(o, k) && o[k] !== undefined; }
  function num(v) { return typeof v === "number" && isFinite(v) ? v : null; }
  function same(a, b) {
    if (a === b) return true;
    if (a === null || b === null || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) return false;
    var ka = Object.keys(a).filter(function (k) { return a[k] !== undefined; }), kb = Object.keys(b).filter(function (k) { return b[k] !== undefined; });
    return ka.length === kb.length && ka.every(function (k) { return Object.prototype.hasOwnProperty.call(b, k) && same(a[k], b[k]); });
  }
  function keysOf(o) { return isObj(o) ? Object.keys(o).filter(function (k) { return o[k] !== undefined; }) : []; }
  function isUserKey(k) { return GOF[k] !== undefined || UMAP.indexOf(k) >= 0; }
  function maxUt(x) {
    var m = 0, t = isObj(x.uut) ? x.uut : {};
    Object.keys(t).forEach(function (g) { var v = t[g]; if (num(v) !== null) m = Math.max(m, v); else if (isObj(v)) Object.keys(v).forEach(function (k) { if (num(v[k]) !== null) m = Math.max(m, v[k]); }); });
    return m;
  }
  function legacy(x) { return (num(x.uu) || 0) > maxUt(x); }   // 옛 기기(칸별 시각을 모르는 앱)가 마지막으로 손댄 자료
  function utOf(x, g) { var t = isObj(x.uut) ? x.uut[g] : undefined; return t; }
  function gTime(x, g, lg) {
    var t = num(utOf(x, g)), pres = UGRP[g].some(function (k) { return own(x, k); });
    if (lg) return pres ? x.uu : (t !== null ? t : -1);
    return t !== null ? t : pres ? 0 : -1;
  }
  function mTime(x, m, k, lg) {
    var tm = utOf(x, m), t = isObj(tm) ? num(tm[k]) : null, pres = own(x[m], k);
    if (lg) return pres ? x.uu : (t !== null ? t : -1);
    return t !== null ? t : pres ? 0 : -1;
  }
  function stepKey(s) { return "t:" + s; }
  /* 순서 체크(번호)를 순서 문장으로 옮겨 붙인다 — 그 사본의 순서가 합친 결과의 순서와 다를 때만(클실장이 순서를 바꿔 올린 때) */
  function anchor(x, steps) {
    var c = x.checks; if (!isObj(c)) return x;
    var ut = isObj(x.uut) ? x.uut : {}, tc = isObj(ut.checks) ? ut.checks : null, isn = function (k) { return /^[0-9]+$/.test(k); };
    var nums = keysOf(c).filter(isn); if (tc) keysOf(tc).filter(isn).forEach(function (k) { if (nums.indexOf(k) < 0) nums.push(k); });
    if (!nums.length || same(x.steps === undefined ? null : x.steps, steps === undefined ? null : steps)) return x;
    nums.sort(function (a, b) { return +a - +b; });
    var st = Array.isArray(x.steps) ? x.steps : [], c2 = Object.assign({}, c), tc2 = tc ? Object.assign({}, tc) : null;
    nums.forEach(function (k) {
      var i = +k, nk = i < st.length && typeof st[i] === "string" ? stepKey(st[i]) : "o:" + k;
      if (own(c, k) && !own(c2, nk)) { c2[nk] = c2[k]; if (tc2 && own(tc2, k)) tc2[nk] = tc2[k]; }
      else if (!own(c, k) && tc2 && own(tc2, k) && !own(tc2, nk)) tc2[nk] = tc2[k];
      delete c2[k]; if (tc2) delete tc2[k];
    });
    var y = Object.assign({}, x); y.checks = c2;
    if (tc2) { y.uut = Object.assign({}, ut); y.uut.checks = tc2; }
    return y;
  }
  /* a·b 를 합친다. 시각이 같으면 a 가 이긴다(앱: 이 기기 쪽 / 서버: 새로 올라온 쪽) */
  function merge(a, b) {
    if (!a) return b; if (!b) return a;
    var ua = num(a.u) || 0, ub = num(b.u) || 0, base = ua >= ub ? a : b, o = {}, ut = {};
    Object.keys(base).forEach(function (k) { if (base[k] !== undefined && !isUserKey(k) && META.indexOf(k) < 0) o[k] = base[k]; });
    var A = anchor(a, o.steps), B = anchor(b, o.steps), la = legacy(a), lb = legacy(b);
    Object.keys(UGRP).forEach(function (g) {
      var ta = gTime(A, g, la), tb = gTime(B, g, lb), w = ta >= tb ? A : B, t = Math.max(ta, tb);
      UGRP[g].forEach(function (k) { if (own(w, k)) o[k] = w[k]; });
      if (t > 0) ut[g] = t;
    });
    UMAP.forEach(function (m) {
      var ma = isObj(A[m]) ? A[m] : null, mb = isObj(B[m]) ? B[m] : null, out = {}, tm = {}, ks = [];
      [keysOf(ma), keysOf(mb), keysOf(utOf(A, m)), keysOf(utOf(B, m))].forEach(function (l) { l.forEach(function (k) { if (ks.indexOf(k) < 0) ks.push(k); }); });
      ks.forEach(function (k) {
        var ta = mTime(A, m, k, la), tb = mTime(B, m, k, lb), w = ta >= tb ? ma : mb, t = Math.max(ta, tb);
        if (own(w, k)) out[k] = w[k];
        if (t > 0) tm[k] = t;
      });
      if (ma || mb) o[m] = out; else if (own(a, m)) o[m] = a[m]; else if (own(b, m)) o[m] = b[m];
      if (Object.keys(tm).length) ut[m] = tm;
    });
    if (own(a, "u") || own(b, "u")) o.u = Math.max(ua, ub);
    var uu = Math.max(num(a.uu) || 0, num(b.uu) || 0); if (uu > 0) o.uu = uu;
    var t0a = num(a.t0), t0b = num(b.t0);
    if (t0a !== null || t0b !== null) o.t0 = t0a === null ? t0b : t0b === null ? t0a : Math.min(t0a, t0b);
    else if (own(a, "t0")) o.t0 = a.t0; else if (own(b, "t0")) o.t0 = b.t0;
    if (Object.keys(ut).length) o.uut = ut;
    return o;
  }
  /* 옛 기기가 마지막으로 손댄 자료면 지금 있는 칸마다 그 시각(uu)을 먼저 박아 둔다 — 새 고침이 다른 칸의 시각을 없애지 않게 */
  function stamp(x) {
    if (!legacy(x)) return x;
    var y = Object.assign({}, x), uu = x.uu, ut = y.uut = Object.assign({}, isObj(x.uut) ? x.uut : {});
    Object.keys(UGRP).forEach(function (g) { if (UGRP[g].some(function (k) { return own(x, k); })) ut[g] = uu; });
    UMAP.forEach(function (m) { if (isObj(x[m])) { var tm = ut[m] = Object.assign({}, isObj(ut[m]) ? ut[m] : {}); keysOf(x[m]).forEach(function (k) { tm[k] = uu; }); } });
    return y;
  }
  /* 사장님 몫 칸 고치기(이 기기·클실장 완료 둘 다). 바뀐 칸만 그 시각을 새로 박는다 — 값이 같으면 시각도 그대로(다른 기기의 새 값을 덮지 않게).
     시각은 그 칸의 이전 시각보다 반드시 크게(기기 시계가 늦어도 이번 고침이 이기게) */
  function applyUser(x, patch, now) {
    var y = Object.assign({}, stamp(x)), ut = y.uut = Object.assign({}, isObj(y.uut) ? y.uut : {}), changed = false;
    Object.keys(patch).forEach(function (k) {
      var v = patch[k];
      if (UMAP.indexOf(k) >= 0) {   // 주소·체크·반응은 통째로 새 묶음을 받아 줄마다 바뀐 것만 시각을 박는다(빠진 줄 = 지운 줄)
        if (!isObj(v)) return;
        var om = isObj(y[k]) ? y[k] : {}, tm = Object.assign({}, isObj(ut[k]) ? ut[k] : {}), any = false, seen = {};
        keysOf(om).concat(keysOf(v)).forEach(function (s) {
          if (seen[s]) return; seen[s] = 1;
          if (own(v, s) === own(om, s) && (!own(v, s) || same(om[s], v[s]))) return;
          tm[s] = Math.max(now, (num(tm[s]) || 0) + 1); any = true;
        });
        if (!any) return;
        var nm = {}; keysOf(v).forEach(function (s) { nm[s] = v[s]; });
        ut[k] = tm; y[k] = nm; changed = true;
      } else if (GOF[k]) {
        var had = own(y, k), nv = v === null || v === undefined ? undefined : v;
        if (had ? (nv !== undefined && same(y[k], nv)) : nv === undefined) return;
        var g = GOF[k];
        ut[g] = Math.max(now, (num(ut[g]) || 0) + 1);
        if (nv === undefined) delete y[k]; else y[k] = nv;
        changed = true;
      }
    });
    if (!changed) return null;
    y.uu = Math.max(num(y.uu) || 0, maxUt(y));
    return y;
  }
  /* 클실장 완료·취소(보낼 함 force) — 서버 public.pt_force 와 같은 규칙: 사장님이 이미 끝낸 일은 덮지 않고(PT-28), 손댄 칸만 시각을 박는다(PT-03) */
  function applyForce(x, patch, now) {
    var p = {}, ag = {};
    Object.keys(patch || {}).forEach(function (k) { if (patch[k] !== undefined && META.indexOf(k) < 0) (isUserKey(k) ? p : ag)[k] = patch[k]; });
    if (x.status === "done" && (p.status === "done" || p.status === "cancel")) { delete p.status; delete p.doneAt; delete p.doneBy; }
    Object.keys(p).forEach(function (k) { if (UMAP.indexOf(k) >= 0) { if (isObj(p[k])) p[k] = Object.assign({}, isObj(x[k]) ? x[k] : {}, p[k]); else delete p[k]; } });
    var y = applyUser(x, p, now) || Object.assign({}, stamp(x));
    Object.keys(ag).forEach(function (k) { y[k] = ag[k]; });
    y.u = Math.max(now, (num(x.u) || 0) + 1);
    return y;
  }
  /* ==== MERGE END ==== */
  function setUser(id, patch, quiet) {
    var x = S.items[id]; if (!x) return true;
    var y = applyUser(x, patch, Date.now());   // 클실장 몫 시각(u)은 올리지 않는다 — 오프라인에서 메모만 써도 클실장 새 제목·순서를 되돌리던 문제(PT-06)
    if (!y) { if (!quiet) render(); return true; }
    S.items[id] = y; S.dirty[id] = 1; var ok = save(); markSave();
    if (!quiet) render();
    syncSoon();
    return ok;
  }

  /* ---------- Supabase ---------- */
  function api(path, opt) {
    opt = opt || {};
    var h = { apikey: CFG.key, "Content-Type": "application/json" };
    if (opt.auth && sess) h.Authorization = "Bearer " + sess.access_token;
    if (opt.prefer) h.Prefer = opt.prefer;
    var ctl = window.AbortController ? new AbortController() : null, tm = setTimeout(function () { if (ctl) ctl.abort(); }, 20000);
    return fetch(CFG.url + path, { method: opt.method || "GET", headers: h, body: opt.body ? JSON.stringify(opt.body) : undefined, signal: ctl ? ctl.signal : undefined }).then(function (r) {
      clearTimeout(tm);
      return r.text().then(function (t) { var j = null; try { j = t ? JSON.parse(t) : null; } catch (e) { } if (!r.ok) { var er = new Error((j && (j.msg || j.error_description || j.message || j.error)) || ("오류 " + r.status)); er.status = r.status; throw er; } return j; });
    }, function (e) { clearTimeout(tm); throw new Error(e && e.name === "AbortError" ? "응답이 없습니다. 인터넷 연결을 확인해 주세요." : "연결 실패: " + (e.message || e)); });
  }
  function setSess(j) {
    if (j && j.access_token) sess = { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: j.expires_at || Math.floor(Date.now() / 1000) + (j.expires_in || 3600), user: { id: j.user.id, email: j.user.email } };
    else sess = null;
    LS.set("sess", sess);
  }
  function fresh() {
    if (!sess) return Promise.reject(new Error("로그인이 필요합니다."));
    if (sess.expires_at * 1000 - Date.now() > 60000) return Promise.resolve();
    return api("/auth/v1/token?grant_type=refresh_token", { method: "POST", body: { refresh_token: sess.refresh_token } }).then(setSess, function (e) { if (e.status === 400 || e.status === 401) { LS.set("expired", { at: Date.now() }); setSess(null); render(); } throw e; });
  }
  function koErr(m) { return /Invalid login/i.test(m) ? "이메일 또는 비밀번호가 맞지 않습니다." : /not confirmed/i.test(m) ? "메일 확인이 아직입니다." : m; }
  var timer = 0;
  function syncSoon() { if (!SB || !sess) return; clearTimeout(timer); timer = setTimeout(doSync, 700); }
  function msg(m) { S.msg = m; var el = $("#syncMsg"); if (el) el.textContent = m; }
  function pullPage(q, off, acc) {
    return api("/rest/v1/pt_items?select=id,data,updated_at" + q + "&order=updated_at.asc&limit=500&offset=" + off, { auth: true }).then(function (rows) {
      acc = acc.concat(rows || []);
      return rows && rows.length === 500 ? pullPage(q, off + 500, acc) : acc;
    });
  }
  var again = false;
  function doSync() {
    if (!SB || !sess) return Promise.resolve();
    if (S.busy) { again = true; return Promise.resolve(); }   // 올리는 중에 누른 것은 끝난 뒤 한 번 더(PT-08)
    S.busy = true; msg("동기화 중…");
    var first = !S.since, q;
    if (first) q = "&or=(" + encodeURIComponent("data->>status.eq.todo,updated_at.gt.\"" + new Date(Date.now() - KEEP_DAYS * 864e5).toISOString() + "\"") + ")";
    else q = "&updated_at=gt." + encodeURIComponent(new Date(Date.parse(S.since) - 5000).toISOString());
    var got = 0, fresh0 = 0, freshC = 0;
    return fresh().then(function () { return pullPage(q, 0, []); }).then(function (rows) {
      rows.forEach(function (row) {
        var r = row.data, l = S.items[row.id];
        if (!l && r.kind === "check" && r.status !== "done") freshC++;
        else if (!l && r.kind !== "log" && (r.t0 || 0) > Date.now() - 864e5) fresh0++;
        var m = merge(l, r);
        // 서버 것과 내용이 다를 때만 다시 올린다(칸별 시각만 붙은 것은 올리지 않는다 — 옛 자료를 한꺼번에 다시 쓰지 않게)
        if (!same(bare(m), bare(r))) S.dirty[row.id] = 1;
        if (!l || !same(l, m)) got++;
        S.items[row.id] = m;
        if (!S.since || row.updated_at > S.since) S.since = row.updated_at;
      });
      if (!S.since) S.since = nowIso();
      Object.keys(S.dirty).forEach(function (id) { if (!S.items[id]) delete S.dirty[id]; });   // 올릴 내용이 없는 표시는 치운다
      prune(); save();
      var ids = Object.keys(S.dirty);
      if (!ids.length) return 0;
      var snap = {}; ids.forEach(function (id) { snap[id] = S.items[id]; });
      var body = ids.map(function (id) { return { user_id: sess.user.id, id: id, data: S.items[id] }; });
      return api("/rest/v1/pt_items?on_conflict=user_id,id", { method: "POST", auth: true, prefer: "resolution=merge-duplicates,return=minimal", body: body }).then(function () {
        // 보내는 동안 또 고친 할 일은 '보낼 것' 표시를 남겨 둔다(PT-08) — 고치면 항목이 새 것으로 바뀐다
        ids.forEach(function (id) { if (S.items[id] === snap[id]) delete S.dirty[id]; }); save(); return ids.length;
      });
    }).then(function (sent) {
      S.busy = false;
      if (S.syncFail) { S.syncFail = false; got = got || 1; }   // 띠(PT-17)를 거두려고 한 번 다시 그린다
      msg("동기화 완료 " + new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) + " · 받은 것 " + got + " · 보낸 것 " + sent);
      if (got) { render(); if (freshC && !first) chkToast(freshC); else if (fresh0 && !first) toast("클실장이 새 할 일 " + fresh0 + "건을 올렸습니다"); }
      badge(); markSave(); outbox();
      if (again || Object.keys(S.dirty).length) { again = false; syncSoon(); }
    }).catch(function (e) { S.busy = false; again = false; msg("동기화 실패: " + koErr(e.message || String(e))); markSave(); if (!S.syncFail && sess) { S.syncFail = true; render(); } });
  }
  function bare(x) { var o = {}; Object.keys(x || {}).forEach(function (k) { if (k !== "uut" && k !== "uu") o[k] = x[k]; }); return o; }
  /* PC 도우미의 보낼 함(클실장이 tools/pt.py add 로 넣은 것)을 가져와 사장님 계정으로 올린다.
     클실장 몫 칸만 바꾸고 사장님 몫 칸(체크·주소·답·메모·미루기)은 서버에 있는 값을 지킨다. */
  var obusy = false;
  function outbox() {
    if (!S.local || !sess || obusy) return;
    obusy = true;
    fetch("/api/outbox", { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (j) {
      var files = j.files || [], items = [];
      files.forEach(function (f) { items = items.concat(f.items || []); });
      if (!items.length) { obusy = false; return; }
      var miss = items.map(function (x) { return x.id; }).filter(function (id, i, a) { return id && !S.items[id] && a.indexOf(id) === i; });
      var p = miss.length ? fresh().then(function () { return api("/rest/v1/pt_items?select=id,data&id=in.(" + encodeURIComponent(miss.map(function (id) { return '"' + id + '"'; }).join(",")) + ")", { auth: true }); }) : Promise.resolve([]);
      return p.then(function (rows) {
        (rows || []).forEach(function (r) { S.items[r.id] = merge(S.items[r.id], r.data); });
        var now = Date.now(), nNew = 0, nChk = 0;
        /* 서버 함수(pt_agent_upsert·pt_agent_set)와 같은 규칙: 다시 올린 할 일은 클실장 몫만 새것으로, 사장님 몫(체크·메모·주소·답…)은 칸별로 지킨다.
           완료 표시(force)는 손댄 칸(상태)만 바꾸고 아직 안 올라간 사장님 메모는 그대로(PT-03) */
        items.forEach(function (x) {
          if (!x || !x.id) return;
          var l = S.items[x.id];
          if (x.force) { if (l) { S.items[x.id] = applyForce(l, x.force, now); S.dirty[x.id] = 1; } return; }   // 없는 할 일에 완료 표시만 온 경우는 건너뛴다
          if (!l && !x.title) return;
          var n = {};
          Object.keys(x).forEach(function (k) { if (x[k] !== undefined && k !== "force" && k !== "uu" && k !== "uut" && !(l && isUserKey(k))) n[k] = x[k]; });
          n.u = Math.max(now, l ? (num(l.u) || 0) + 1 : 0);
          if (!l) { if (n.kind !== "log" && n.kind !== "sess" && !n.status) n.status = "todo"; n.t0 = n.t0 || now; if (n.kind === "task") nNew++; if (n.kind === "check") nChk++; S.items[x.id] = n; }
          else S.items[x.id] = merge(n, l);
          S.dirty[x.id] = 1;
        });
        save(); render();
        return fetch("/api/outbox/ack", { method: "POST", headers: { "Content-Type": "application/json", "X-PT": "1" }, body: JSON.stringify({ files: files.map(function (f) { return f.name; }) }) }).then(function () {
          obusy = false; if (nChk) chkToast(nChk); else if (nNew) toast("클실장이 새 할 일 " + nNew + "건을 올렸습니다"); doSync();
        });
      });
    }).catch(function () { obusy = false; });
  }
  function prune() {
    var cut = addDays(today(), -KEEP_DAYS);
    Object.keys(S.items).forEach(function (id) {
      var x = S.items[id]; if (S.dirty[id]) return;
      var d = x.kind === "log" ? x.date : (x.status === "done" || x.status === "cancel") ? (x.doneAt || "").slice(0, 10) : null;
      if (d && d < cut) delete S.items[id];
    });
  }
  function badge() {
    var n = list().filter(function (x) { var b = bucket(x); return b === "late" || b === "today"; }).length + newChecks().filter(function (x) { return x.lv === 1; }).length;
    try { if (navigator.setAppBadge) n ? navigator.setAppBadge(n) : navigator.clearAppBadge(); } catch (e) { }
  }

  /* ---------- 서버 검색(지난 일) ---------- */
  function remoteSearch(kind) {
    if (!SB || !sess) return;
    S.rbusy = true; render();
    var q = "/rest/v1/pt_items?select=id,data";
    if (kind === "done") {
      q += "&data->>kind=eq.task&data->>status=eq.done&order=" + encodeURIComponent("data->>doneAt") + ".desc&limit=300";
      if (S.dmonth) q += "&" + encodeURIComponent("data->>doneAt") + "=like." + encodeURIComponent(S.dmonth + "*");
      if (S.dq) q += "&" + encodeURIComponent("data->>title") + "=ilike." + encodeURIComponent("*" + S.dq + "*");
    } else {
      q += "&data->>kind=eq.log&order=" + encodeURIComponent("data->>date") + ".desc&limit=400";
      if (S.kmonth) q += "&" + encodeURIComponent("data->>date") + "=like." + encodeURIComponent(S.kmonth + "*");
      if (S.karea !== "전체") q += "&" + encodeURIComponent("data->>area") + "=eq." + encodeURIComponent(S.karea);
      if (S.kq) q += "&" + encodeURIComponent("data->>title") + "=ilike." + encodeURIComponent("*" + S.kq + "*");
    }
    q = q.replace("&data->>kind", "&" + encodeURIComponent("data->>kind")).replace("&data->>status", "&" + encodeURIComponent("data->>status"));
    fresh().then(function () { return api(q, { auth: true }); }).then(function (rows) {
      S.remote[kind] = (rows || []).map(function (r) { return r.data; }); S.rbusy = false; render();
    }).catch(function (e) { S.rbusy = false; toast("검색 실패: " + koErr(e.message)); render(); });
  }

  /* ---------- 🔍 전체 찾기 ----------
     이 기기에 있는 것(열린 일 + 최근 60일)은 바로 찾고, 60일 지난 기록은 서버 pt_search 로 함께 찾는다.
     낱말을 여러 개 넣으면 모두 들어간 것만. 제목뿐 아니라 순서·복사 문구·메모·답·주소·제안·아이디어·클실장 기록·날짜까지 본다. */
  function terms(q) { return String(q || "").toLowerCase().split(/\s+/).filter(Boolean); }
  function dateForms(d) {
    if (!d) return ""; d = String(d).slice(0, 10); var p = d.split("-"); if (p.length < 3) return d;
    return d + " " + (+p[1]) + "/" + (+p[2]) + " " + (+p[1]) + "월 " + (+p[2]) + "일";
  }
  function fieldsOf(x) {
    var F = [["제목", x.title], ["설명", x.why], ["내용", x.detail]];
    (x.steps || []).forEach(function (s, i) { F.push(["순서 " + (i + 1), s]); });
    (x.copies || []).forEach(function (c) { F.push(["복사 문구 · " + (c.label || ""), c.text]); });
    (x.ideas || []).forEach(function (d) { F.push([d.t === "아이디어" ? "💡 아이디어" : "실장 제안", d.text]); });
    F.push(["내 메모", x.note]);
    if (x.answer) F.push(["내 답", [x.answer.pick, x.answer.text].filter(Boolean).join(" / ")]);
    var u = x.urls || {}; Object.keys(u).forEach(function (k) { if (u[k] == null || u[k] === "") return; F.push(isLink(u[k]) ? ["올린 주소", u[k]] : ["내 답 · " + cut(labelOf(x, k), 30), u[k]]); });
    if (x.choice) F.push(["결정", (x.choice.q || "") + " " + (x.choice.opts || []).join(" / ")]);
    (x.links || []).concat(x.images || []).forEach(function (l) { F.push(["파일", (l.label || "") + " " + (l.path || l.url || "")]); });
    qList(x).forEach(function (q) { F.push(["클실장 질문", q.q]); });
    urlFields(x).forEach(function (f) { F.push(["주소 칸", f.label]); });
    F.push(["출처", x.src], ["끝나면 클실장이", x.after], ["분류", [x.area, x.biz, x.group, x.state, (CAT[x.cat] || {}).label].filter(Boolean).join(" ")], ["번호", x.id]);
    return F.filter(function (f) { return f[1]; });
  }
  function hay(x) {
    return (fieldsOf(x).map(function (f) { return f[1]; }).join("\n") + "\n" + [x.due, x.doneAt, x.date, x.t0 ? ymd(new Date(x.t0)) : ""].map(dateForms).join(" ")).toLowerCase();
  }
  function hasAll(h, ts) { return ts.every(function (t) { return h.indexOf(t) >= 0; }); }
  var _mq = null, _mre = null;
  function mark(html) {
    if (S.view !== "find") return html;
    if (_mq !== S.fq) { _mq = S.fq; var ts = terms(S.fq); _mre = ts.length ? new RegExp(ts.map(function (t) { return esc(t).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }).join("|"), "gi") : null; }
    if (!_mre) return html;
    return String(html).split(/(<[^>]*>)/).map(function (p, i) {
      return i % 2 ? p : p.split(/(&#?\w+;)/).map(function (q, j) { return j % 2 ? q : q.replace(_mre, "<mark>$&</mark>"); }).join("");
    }).join("");
  }
  /* 제목·설명에 안 보이는 낱말이 어디서 걸렸는지 한 줄로 보여 준다 */
  function snip(x) {
    var vis = ((x.title || "") + " " + (x.why || "")).toLowerCase(), ts = terms(S.fq).filter(function (t) { return vis.indexOf(t) < 0; });
    if (!ts.length) return "";
    var F = fieldsOf(x);
    for (var i = 0; i < F.length; i++) {
      if (F[i][0] === "제목" || F[i][0] === "설명") continue;
      var s = String(F[i][1]), k = s.toLowerCase().indexOf(ts[0]);
      if (k < 0) continue;
      var a = Math.max(0, k - 30), b = Math.min(s.length, k + ts[0].length + 60);
      return '<div class="hit"><b>' + esc(F[i][0]) + "</b>" + (a ? "…" : "") + mark(esc(s.slice(a, b))) + (b < s.length ? "…" : "") + "</div>";
    }
    return "";
  }
  /* 서버용 낱말: 날짜는 저장된 모양(2026-11-19)으로도 찾게 다른 표기를 '|' 로 붙인다 */
  function srvTerm(t) {
    var m = t.match(/^(\d{1,2})[\/.](\d{1,2})$/); if (m) return t + "|-" + ("0" + m[1]).slice(-2) + "-" + ("0" + m[2]).slice(-2);
    m = t.match(/^(\d{1,2})월$/); if (m) return t + "|-" + ("0" + m[1]).slice(-2) + "-";
    m = t.match(/^(\d{1,2})일$/); if (m) return t + "|-" + ("0" + m[1]).slice(-2);
    return t;
  }
  var ftm = 0;
  function findRemote() {
    clearTimeout(ftm);
    var q = S.fq, ts = terms(q);
    if (!SB || !sess || !ts.length || (S.fr && S.fr.q === q && !S.fr.err)) return;
    S.fbusy = true; render();
    fresh().then(function () { return api("/rest/v1/rpc/pt_search", { method: "POST", auth: true, body: { terms: ts.map(srvTerm), lim: 300 } }); }).then(function (rows) {
      if (S.fq !== q) return;
      S.fr = { q: q, rows: (rows || []).map(function (r) { return r.data; }) }; S.fbusy = false; render();
    }).catch(function () { if (S.fq !== q) return; S.fr = { q: q, rows: [], err: 1 }; S.fbusy = false; render(); });
  }
  function clearFind() { S.fq = ""; S.fr = null; S.fbusy = false; clearTimeout(ftm); var fi = $("#fq"); if (fi) fi.value = ""; }
  function viewFind() {
    var ts = terms(S.fq), h = "<h1>🔍 찾기</h1>";
    if (!sess) return h + needLogin();
    if (!ts.length) return h + '<div class="card"><p class="note">맨 위 칸에 찾을 말을 넣으세요.</p></div>';
    var seen = {}, pool = [];
    Object.keys(S.items).forEach(function (k) { seen[k] = 1; pool.push(S.items[k]); });
    var fr = S.fr && S.fr.q === S.fq ? S.fr : null, more = [].concat(fr ? fr.rows : [], S.remote.done || [], S.remote.log || []);
    more.forEach(function (x) { if (x && x.id && !seen[x.id]) { seen[x.id] = 1; pool.push(x); } });
    var G = { todo: [], idea: [], done: [], kl: [] };
    pool.forEach(function (x) {
      if (x.ideas && x.kind !== "log") {
        var base = (x.title || "") + " " + dateForms(x.t0 ? ymd(new Date(x.t0)) : "");
        x.ideas.forEach(function (d, i) { if (hasAll((d.text + " " + base).toLowerCase(), ts)) G.idea.push({ x: x, d: d, i: i, r: (x.react || {})[i] }); });
      }
      if (x.kind === "idea" || !hasAll(hay(x), ts)) return;
      if (x.kind === "task") (isOpen(x) ? G.todo : G.done).push(x);
      else G.kl.push(x);
    });
    G.todo.sort(sorter);
    G.done.sort(function (a, b) { return (b.doneAt || "").localeCompare(a.doneAt || ""); });
    G.idea.sort(function (a, b) { return (b.x.t0 || 0) - (a.x.t0 || 0) || a.i - b.i; });
    var KO = { check: -1, ktask: 0, sess: 1, log: 2 };
    G.kl.sort(function (a, b) { return (KO[a.kind] || 0) - (KO[b.kind] || 0) || (b.date || "").localeCompare(a.date || "") || (b.t0 || 0) - (a.t0 || 0); });
    var total = G.todo.length + G.idea.length + G.done.length + G.kl.length, f = S.fk;
    h += '<div class="chips">' + [["전체", total], ["할 일", G.todo.length], ["💡 아이디어", G.idea.length], ["한 일", G.done.length], ["클실장", G.kl.length]].map(function (c) {
      return '<button class="chip' + (f === c[0] ? " on" : "") + '" data-fk="' + c[0] + '">' + c[0] + " " + c[1] + "</button>";
    }).join("") + "</div>";
    h += '<p class="note fsum">“' + esc(S.fq) + "” " + total + "건" + (S.fbusy ? " · 60일 지난 기록도 서버에서 찾는 중…" : fr && fr.err ? " · 서버 검색 실패(이 기기 것만)" : fr ? " · 60일 지난 기록까지 함께 찾았습니다" : "") + "</p>";
    if (!total) return h + '<div class="empty">' + (S.fbusy ? "찾는 중…" : "“" + esc(S.fq) + "”이(가) 들어간 것이 없습니다. 낱말을 줄이거나 바꿔 보세요.") + "</div>";
    function sec(key, title, sub, html) { if (f !== "전체" && f !== key) return ""; return '<div class="sec"><h2>' + title + '</h2><span class="cnt">' + sub + "</span></div>" + html; }
    function cap(arr, n) { return arr.length > n ? arr.slice(0, n) : arr; }
    if (G.todo.length) h += sec("할 일", "할 일", G.todo.length + "건", G.todo.map(card).join(""));
    if (G.idea.length) h += sec("💡 아이디어", "💡 제안·아이디어", G.idea.length + "건", '<div class="ideas big">' + G.idea.map(function (e) {
      var from = e.x.kind === "task" ? ' <a class="from" href="#c_' + esc(e.x.id) + '" data-act="goto" data-id="' + esc(e.x.id) + '">' + (e.x.status === "done" ? "한 일: " : "할 일: ") + mark(esc(e.x.title)) + "</a>" : ' <span class="from">' + mark(esc(e.x.kind === "idea" ? (e.x.area || "새 아이디어") : e.x.title)) + "</span>";
      return ideaRow(e.x, e.d, e.i, e.r, from + (e.x.t0 ? ' <span class="from">' + md(ymd(new Date(e.x.t0))) + "</span>" : ""));
    }).join("") + "</div>");
    if (G.done.length) h += sec("한 일", "사장님이 한 일", G.done.length + "건" + (G.done.length > 100 ? " · 앞 100건" : ""), cap(G.done, 100).map(card).join(""));
    if (G.kl.length) {
      var KN = { ktask: "클실장 맡은 일", sess: "세션 정리", log: "클실장이 한 일", check: "체크 보고" };
      h += sec("클실장", "클실장", G.kl.length + "건" + (G.kl.length > 150 ? " · 앞 150건 — 낱말을 더 넣으면 좁혀집니다" : ""), '<div class="card list">' + cap(G.kl, 150).map(function (x) {
        var d = x.kind === "log" ? x.date : x.due || (x.t0 ? ymd(new Date(x.t0)) : "");
        return '<div class="row1"><div class="d">' + (d ? md(d) : "") + '</div><div class="grow"><details><summary><span class="area">' + esc(KN[x.kind] || "기록") + (x.area ? " · " + esc(x.area) : "") + "</span>" + mark(esc(x.title)) + (x.state ? ' <span class="badge">' + esc(x.state) + "</span>" : "") + "</summary>" +
          (x.detail ? "<div>" + mark(linkify(x.detail)) + "</div>" : "") + (x.why ? '<div class="note">' + mark(esc(x.why)) + "</div>" : "") + (x.kind === "sess" ? ideasBox(x) : "") + "</details>" + snip(x) + "</div></div>";
      }).join("") + "</div>");
    }
    return h;
  }

  /* ---------- PC 도우미(폴더 파일) ---------- */
  function helperBase() { return S.local ? "" : (CFG.helper || "http://127.0.0.1:8790"); }
  function fileUrl(p) { return helperBase() + "/f/" + p.split("/").map(encodeURIComponent).join("/"); }
  function checkLocal() {
    if (!/^(127\.0\.0\.1|localhost)$/.test(location.hostname)) return;
    /* PC 도우미가 꺼져 있으면 화면 맨 위에 알린다 — 꺼진 줄 모르고 쓰다 클실장 보낼 함·사진 복사가 멈췄던 일(2026-11-21, 원장 261121-51) */
    fetch("/api/ping", { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (j) { S.local = !!j.ok; S.helperDown = !j.ok; render(); }).catch(function () { S.local = false; S.helperDown = true; render(); });
  }
  function openFolder(p) {
    if (!S.local) { toast("폴더 열기는 PC 필투두(127.0.0.1:8790)에서 됩니다"); return; }
    fetch("/api/open", { method: "POST", headers: { "Content-Type": "application/json", "X-PT": "1" }, body: JSON.stringify({ path: p }) })
      .then(function (r) { return r.json(); }).then(function (j) { toast(j.ok ? "탐색기에서 열었습니다" : (j.msg || "못 열었습니다")); }).catch(function () { toast("PC 도우미가 꺼져 있습니다"); });
  }

  /* ---------- 복사 ---------- */
  function copyText(t) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(t).then(function () { toast("복사했습니다 — 붙여넣기(Ctrl+V) 하세요"); }, function () { fallback(t); });
    fallback(t); return Promise.resolve();
  }
  function fallback(t) { var ta = document.createElement("textarea"); ta.value = t; ta.style.position = "fixed"; ta.style.opacity = "0"; document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); toast("복사했습니다"); } catch (e) { toast("복사가 막혔습니다 — 길게 눌러 복사해 주세요"); } ta.remove(); }
  function toPng(blob) {
    if (blob.type === "image/png") return Promise.resolve(blob);
    return createImageBitmap(blob).then(function (bm) {
      var c = document.createElement("canvas"); c.width = bm.width; c.height = bm.height; c.getContext("2d").drawImage(bm, 0, 0);
      return new Promise(function (ok) { c.toBlob(ok, "image/png"); });
    });
  }
  function copyImage(p) {
    if (!S.local) { toast("사진은 PC 필투두(도우미 켜진 PC)에서 보이고 복사됩니다 — 폰에서 꺼내는 기능은 아직 없습니다"); return; }
    if (!window.ClipboardItem) { toast("이 브라우저는 사진 복사를 못 합니다 — 크롬·엣지를 써 주세요"); return; }
    var pr = fetch(fileUrl(p)).then(function (r) { if (!r.ok) throw new Error("사진을 찾지 못했습니다"); return r.blob(); }).then(toPng);
    navigator.clipboard.write([new ClipboardItem({ "image/png": pr })]).then(function () { toast("사진을 복사했습니다 — 카페 글쓰기에 붙여넣기(Ctrl+V)"); }, function () {
      window.open(fileUrl(p), "_blank"); toast("이 창에서는 사진 복사가 막혀 새 탭에 열었습니다 — 사진에서 오른쪽 클릭 → [이미지 복사]");
    });
  }

  /* ---------- 화면 ---------- */
  function list() { return Object.keys(S.items).map(function (id) { return S.items[id]; }).filter(isOpen); }
  function catChip(c) { var k = CAT[c] || CAT["기타"]; return '<span class="cat" style="--c:' + k.color + '">' + esc(k.label) + "</span>"; }
  function render() {
    var v = S.view;
    document.querySelectorAll(".top nav button").forEach(function (b) { b.classList.toggle("on", b.getAttribute("data-view") === v); });
    var nt = $("#navTodo"); if (nt) nt.textContent = list().length;
    var h;
    /* 화면 하나가 오류로 멈추면 앱 전체가 그대로 굳어 '검색이 안 된다'로 보인다 — 오류를 화면에 알리고 나머지는 계속 (원장 261121-50) */
    try { h = v === "find" ? viewFind() : v === "check" ? viewCheck() : v === "done" ? viewDone() : v === "kl" ? viewKl() : v === "set" ? viewSet() : v === "idea" ? viewIdeas() : viewTodo(); }
    catch (e) { if (window.console) console.error(e); h = '<div class="card"><h2>화면을 그리다 문제가 생겼습니다</h2><p class="note">' + esc(e && e.message || e) + '</p><p class="note">맨 위 메뉴로 다른 화면에 갔다가 다시 와 보시고, 계속되면 이 문장을 클실장에게 알려 주세요.</p></div>'; }
    if (S.helperDown) h = '<div class="helperdown"><b>PC 도우미가 꺼져 있습니다.</b> 할 일 체크·동기화는 되지만 클실장이 올린 새 할 일·사진 복사·폴더 열기가 멈춥니다. 클실장에게 <b>"도우미 켜 줘"</b>라고 하시거나, PC를 다시 켜면 자동으로 켜집니다. <button class="btn sm ghost" type="button" onclick="location.reload()">다시 확인</button></div>' + h;
    /* 인터넷이 끊겼거나 서버에 못 올렸으면 맨 위 띠로 알린다 — 고친 것은 이 기기에 보관 중(PT-17) */
    var np = sess ? pendingCount() : 0;
    if (sess && (navigator.onLine === false || (S.syncFail && np))) h = '<div class="offband">' + (navigator.onLine === false ? "<b>인터넷이 끊겼습니다.</b> " : "<b>서버에 아직 못 올렸습니다.</b> ") +
      (np ? "고친 것 " + np + "건은 이 기기에 보관 중이고, 연결되면 바로 올라갑니다." : "보던 화면은 그대로 쓸 수 있고, 연결되면 바로 새로 받습니다.") + (navigator.onLine === false ? "" : ' <button class="btn sm ghost" type="button" data-act="sync">다시 올리기</button>') + "</div>" + h;
    var ni = $("#navIdea"); if (ni) { var fi = sess ? freshIdeas().length : 0; ni.textContent = fi; ni.style.display = fi ? "" : "none"; }
    chkBtn();
    $("#app").innerHTML = h;
    /* 폰: 2줄로 줄인 설명이 실제로 넘칠 때만 '… 더보기'(누르면 카드가 펼쳐진다) */
    if (window.matchMedia && window.matchMedia("(max-width: 560px)").matches) document.querySelectorAll("#app .why.clamp").forEach(function (el) { if (el.scrollHeight > el.clientHeight + 2) el.insertAdjacentHTML("afterend", '<div class="more">… 더보기</div>'); });
    $("#ver").textContent = "필투두 " + (window.PT_BUILD || "") + (S.local ? " · PC 도우미 연결됨" : "");
  }
  function needLogin() {
    /* 로그인이 풀린 것이면(새로고침 열쇠 만료 등) 할 일이 사라진 게 아니라고 먼저 알린다(PT-26) */
    var ex = LS.get("expired", null), n = Object.keys(S.dirty).length;
    if (ex) return '<div class="card warnbox"><h2>로그인이 풀렸습니다 — 할 일은 그대로 있습니다</h2><p class="note">' + (ex.at ? esc(hm(ex.at)) + "에 " : "") + "로그인 기간이 끝났습니다. 할 일은 서버에 그대로 있고, " + (n ? "아직 못 올린 것 " + n + "건도 이 기기에 보관 중입니다 — 같은 계정으로 다시 로그인하면 그대로 올라갑니다." : "같은 계정으로 다시 로그인하면 바로 다시 보입니다.") + '</p><button class="btn" data-view="set">다시 로그인하기</button></div>';
    return '<div class="card"><h2>로그인하면 할 일이 보입니다</h2><p class="note">필보드와 같은 이메일·비밀번호로 한 번만 로그인하면 이 기기에 계속 남습니다. 클실장이 올린 할 일과 사장님 체크가 PC·폰에 같이 보입니다.</p><button class="btn" data-view="set">로그인하러 가기</button></div>';
  }

  function viewTodo() {
    if (!sess) return needLogin();
    var all = list(), td = today();
    var must = all.filter(function (x) { var b = bucket(x); return b === "late" || b === "today"; });
    var mins = must.reduce(function (a, x) { return a + (x.mins || 0); }, 0);
    var dec = all.filter(function (x) { return x.cat === "판단" && bucket(x) !== "snooze"; }).length;
    var doneToday = Object.keys(S.items).map(function (k) { return S.items[k]; }).filter(function (x) { return x.kind === "task" && x.status === "done" && (x.doneAt || "").slice(0, 10) === td; }).length;
    var nc = newChecks(), hc = nc.filter(function (x) { return x.lv === 1; }).length;
    var h = nc.length ? '<button type="button" class="ckstrip' + (hc ? " hot" : "") + '" data-view="check"><b>체크 ' + nc.length + "</b><span>" + (hc ? "급한 보고 " + hc + "건 — " : "") + "클실장이 꼭 알려 드릴 것이 있습니다</span><i>보기 →</i></button>" : "";
    /* 진행중 칸 — 누르면 진행중 할 일만, 다시 누르면 전체 (2026-11-21 사장님, 원장 261121-37) */
    var prog = all.filter(progOf), pOn = S.mode === "prog", mOn = S.mode === "must", nStall = prog.filter(function (x) { return progOf(x).stall; }).length;
    /* 요약 칸 글자: lg = PC, sh = 폰(한 줄에 다 들어가게 짧게 — 2026-11-24 전수조사 PT-13) */
    function lab(lg, sh, extra) { return '<span class="lab"><span class="lg">' + lg + '</span><span class="sh">' + sh + "</span>" + (extra || "") + "</span>"; }
    var pTile = '<div class="prog-tile' + (prog.length ? " has" : "") + (pOn ? " on" : "") + '"' + (prog.length || pOn ? ' data-mode="' + (pOn ? "all" : "prog") + '" role="button" title="' + (pOn ? "전체 보기로 돌아가기" : "진행중인 할 일만 보기") + '"' : "") + '><b><span class="hl">' + prog.length + "</span></b>" + lab(pOn ? "진행중만 보는 중" : "진행중 보기", "진행중", nStall ? ' <em class="stallc">멈춤 ' + nStall + "</em>" : "") + "</div>";
    /* '오늘 꼭' 칸 — 누르면 '꼭 할 것만', 다시 누르면 전체 (PT-I2) */
    var mTile = '<div class="hot must-tile' + (mOn ? " on" : "") + '" data-mode="' + (mOn ? "all" : "must") + '" role="button" title="' + (mOn ? "전체 보기로 돌아가기" : "오늘 꼭 할 것만 보기") + '"><b>' + must.length + "</b>" + lab((mOn ? "꼭 할 것만 보는 중" : "오늘 꼭 — 누르면 이것만") + (mins ? " · 약 " + mins + "분" : ""), "오늘 꼭") + "</div>";
    h += '<div class="sum"><div><b>' + all.length + "</b>" + lab("남은 일 전체", "남은 일") + "</div>" + pTile + mTile + "<div><b>" + dec + "</b>" + lab("결정 기다리는 것", "결정") + "</div><div><b>" + doneToday + "</b>" + lab("오늘 끝낸 일", "오늘 끝냄") + '</div><div class="idea-tile" data-view="idea"><b>💡 ' + freshIdeas().length + "</b>" + lab("새 제안·아이디어 보기", "새 제안") + "</div></div>";
    h += '<div class="mode"><button data-mode="all" class="' + (S.mode === "all" ? "on" : "") + '">전체 보기</button><button data-mode="must" class="' + (S.mode === "must" ? "on" : "") + '">시간 없을 때 — 꼭 할 것만</button></div>';
    if (pOn) h += '<div class="progbar"><span><b>진행중</b>인 할 일 ' + prog.length + "건만 보고 있습니다</span><button class=\"btn sm ghost\" data-mode=\"all\">전체 보기</button></div>";
    var pool = S.mode === "must" ? must : pOn ? prog : all, counts = {};
    pool.forEach(function (x) { counts[x.cat] = (counts[x.cat] || 0) + 1; });
    h += '<div class="chips"><button class="chip' + (S.cat === "전체" ? " on" : "") + '" data-cat="전체">전체 ' + pool.length + "</button>" +
      CATS.filter(function (c) { return counts[c[0]]; }).map(function (c) { return '<button class="chip' + (S.cat === c[0] ? " on" : "") + '" data-cat="' + c[0] + '">' + c[1] + " " + counts[c[0]] + "</button>"; }).join("") + "</div>";
    var shown = pool.filter(function (x) { return S.cat === "전체" || x.cat === S.cat; });
    if (!shown.length) h += '<div class="empty">' + (pOn ? "진행중인 할 일이 없습니다. 할 일을 열어 순서를 하나라도 체크하면 여기에 모입니다." : all.length ? "이 조건에 남은 일이 없습니다." : "남은 일이 없습니다. 수고하셨습니다.") + "</div>";
    BUCKETS.forEach(function (b) {
      if (S.mode === "must" && b[0] !== "late" && b[0] !== "today") return;
      var xs = shown.filter(function (x) { return bucket(x) === b[0]; }).sort(sorter);
      if (!xs.length) return;
      h += '<div class="sec ' + b[0] + '"><h2>' + b[1] + '</h2><span class="cnt">' + xs.length + "건 · " + b[2] + "</span></div>";
      if ((b[0] === "snooze" || b[0] === "later") && !pOn) h += "<details" + (S.open["sec_" + b[0]] ? " open" : "") + ' data-sec="' + b[0] + '"><summary class="note">펼쳐 보기</summary>' + xs.map(card).join("") + "</details>";
      else h += xs.map(card).join("");
    });
    if (S.mode === "must" && all.length > must.length) h += '<p class="note" style="text-align:center;margin-top:14px">나머지 ' + (all.length - must.length) + '건은 미뤄 두셔도 됩니다. <button class="btn sm ghost" data-mode="all">전체 보기</button></p>';
    return h;
  }
  /* 같은 묶음(기한 지남·오늘 꼭·이번 주…) 안에서는 진행중 할 일이 맨 위 (원장 261121-37) */
  function sorter(a, b) { return (progOf(b) ? 1 : 0) - (progOf(a) ? 1 : 0) || (a.due || "9999").localeCompare(b.due || "9999") || (a.pri || 3) - (b.pri || 3) || (a.order || 0) - (b.order || 0) || (a.t0 || 0) - (b.t0 || 0); }

  /* 진행중 = 사장님이 순서 체크를 하나라도 한, 아직 안 끝난 할 일 (2026-11-21 사장님, 원장 261121-32) — 제목을 형광펜으로 칠한 것처럼 */
  /* 순서 i 체크 여부 — 지금 순서 번호(옛 형식 그대로)가 먼저, 없으면 클실장이 순서를 바꿔 올릴 때 순서 문장으로 옮겨 붙인 체크(PT-05) */
  function ckOf(x, i) { var c = isObj(x.checks) ? x.checks : {}; if (own(c, String(i))) return !!c[i]; var s = (x.steps || [])[i]; return typeof s === "string" && !!c[stepKey(s)]; }
  function progOf(x) {
    if (x.status === "done" || x.status === "cancel" || !x.steps || !x.steps.length) return null;
    var n = 0;
    for (var i = 0; i < x.steps.length; i++) if (ckOf(x, i)) n++;
    if (!n) return null;
    /* 멈춤 = 사장님이 3일 넘게 손대지 않은 진행중 할 일(uu = 사장님이 마지막으로 체크·메모·주소를 바꾼 시각, 원장 261121-38). 일부러 미룬 일은 빼고 */
    var idle = x.uu ? Math.floor((Date.now() - x.uu) / 864e5) : 0;
    return { n: n, of: x.steps.length, stall: idle >= 3 && !(x.snoozeTo && x.snoozeTo > today()) ? idle : 0 };
  }
  /* 카드 왼쪽 위 네모(PT-16): 사장님 결정(원장 261124-72) "네모도 남겨" = "done" 누르면 바로 완료(맨 아래 [✓ 했어요]와 둘 다 쓴다).
     바꾸려면 "open"(펼치기만) · "ask"(한 번 묻고 완료) */
  var HEAD_BOX = "done";
  function card(x) {
    var op = !!S.open[x.id], td = today(), done = x.status === "done", pg = progOf(x);
    var isNew = !done && (x.t0 || 0) > Date.now() - 864e5;
    var box = HEAD_BOX === "open" ? '<button class="chk" data-act="expand" data-id="' + esc(x.id) + '" title="펼쳐 보기 — 다 하시면 맨 아래 [✓ 했어요]">✓</button>'
      : '<button class="chk" data-act="toggle" data-head="1" data-id="' + esc(x.id) + '" title="했어요">✓</button>';
    var ql = qList(x), qn = ql.filter(function (q) { return (x.urls || {})[q.key]; }).length;
    var h = '<div class="card task' + (done ? " done" : "") + (pg ? " prog" : "") + '" id="c_' + esc(x.id) + '"><div class="head">' + box + '<div class="grow" data-act="expand" data-id="' + esc(x.id) + '">';
    h += '<div class="t">' + (pg ? '<span class="badge prog">진행중 ' + pg.n + "/" + pg.of + "</span> " + (pg.stall ? '<span class="badge stall" title="마지막으로 손대신 날 ' + md(ymd(new Date(x.uu))) + '">멈춤 ' + pg.stall + "일</span> " : "") : "") + (isNew ? '<span class="badge new">새</span> ' : "") + (x.status === "cancel" ? '<span class="badge">취소됨</span> ' : "") + (pg ? '<span class="hl">' + mark(esc(x.title)) + "</span>" : mark(esc(x.title))) + "</div>";
    h += '<div class="meta">' + catChip(x.cat) + (x.due ? '<span class="due' + (x.due < td && !done ? " late" : "") + '">' + (x.due < td && !done ? "기한 지남 " : "") + md(x.due) + (x.dueNote ? " " + esc(x.dueNote) : "") + "</span>" : "") +
      (x.mins ? "<span>약 " + x.mins + "분</span>" : "") + (x.biz ? "<span>" + esc(x.biz) + "</span>" : "") + (x.snoozeTo && x.snoozeTo > td ? "<span>" + md(x.snoozeTo) + "까지 미룸</span>" : "") +
      (x.answer ? '<span class="badge">답함</span>' : "") + (ql.length ? '<span class="badge q' + (qn >= ql.length ? " all" : "") + '">질문 ' + (qn ? qn + "/" : "") + ql.length + (qn >= ql.length ? " 답함" : "") + "</span>" : "") +
      (x.ideas && x.ideas.length ? '<span class="badge idea">💡 제안·아이디어 ' + x.ideas.length + "</span>" : "") + "</div>";
    /* 접힌 카드의 설명은 폰에서 2줄까지만(PT-13) — 넘치면 render 가 '… 더보기'를 단다. 찾기 화면·펼친 카드는 다 보인다 */
    if (x.why) h += '<div class="why' + (!op && S.view !== "find" ? " clamp" : "") + '">' + mark(esc(x.why)) + "</div>";
    if (S.view === "find") h += snip(x);
    h += "</div></div>";
    if (op) h += body(x);
    return h + "</div>";
  }
  function body(x) {
    var id = esc(x.id), h = '<div class="body">' + ideasBox(x);
    if (x.steps && x.steps.length) {
      h += "<h3>순서</h3><ol class=\"steps\">" + x.steps.map(function (s, i) { var on = ckOf(x, i); return '<li class="' + (on ? "ok" : "") + '"><input type="checkbox" data-act="step" data-id="' + id + '" data-i="' + i + '"' + (on ? " checked" : "") + '><span class="grow">' + mark(linkify(s)) + '</span><button class="pc" data-act="para" data-id="' + id + '" data-i="' + i + '" title="이 문단만 복사해 클실장에게 고쳐 달라고 하기">⧉</button></li>'; }).join("") + "</ol>";
    }
    if (x.links && x.links.length) h += "<h3>바로 열기</h3>" + linkBtns(x.links);
    if (x.copies && x.copies.length) {
      /* 복사 문구가 5개 넘으면(요금 카드 20장 등) 하나씩 접어 둔다 — 펼친 것은 기억(PT-14) */
      var many = x.copies.length > 5;
      h += "<h3>복사해서 붙여넣기" + (many ? " — " + x.copies.length + "개, 눌러서 하나씩 펼쳐 보세요" : "") + "</h3>" + x.copies.map(function (c, i) {
        var top = "<b>" + esc(c.label) + '</b><button class="btn sm" data-act="copy" data-id="' + id + '" data-i="' + i + '">복사</button>', pre = "<pre>" + mark(esc(c.text)) + "</pre>";
        if (!many) return '<div class="copy"><div class="ch">' + top + "</div>" + pre + "</div>";
        return '<details class="copy" data-cp="' + id + "|" + i + '"' + (S.open["cp|" + x.id + "|" + i] ? " open" : "") + '><summary class="ch">' + top + "</summary>" + pre + "</details>";
      }).join("");
    }
    if (x.images && x.images.length) {
      h += "<h3>사진 — [복사] 누르고 바로 붙여넣기</h3><div class=\"imgs\">" + x.images.map(function (m) {
        return '<div class="img">' + (S.local ? '<div class="ph" data-act="zoom" data-src="' + esc(fileUrl(m.path)) + '" style="background-image:url(\'' + esc(fileUrl(m.path)).replace(/'/g, "%27") + '\')"></div>' : '<div class="noimg">사진은 PC 필투두에서 보입니다</div>') +
          // 폰에서도 [복사]를 누르면 왜 안 되는지 알려 준다(예전엔 눌리지도 않아 안내가 안 떴다 — PT-25)
          '<div class="cap">' + esc(m.label || m.path.split("/").pop()) + '</div><div class="btns"><button class="btn sm' + (S.local ? "" : " dim") + '" data-act="img" data-p="' + esc(m.path) + '">복사</button>' + (S.local ? '<button class="btn sm ghost" data-act="folder" data-p="' + esc(m.path) + '">폴더</button>' : "") + "</div></div>";
      }).join("") + "</div>";
    }
    /* 클실장 질문(PT-12): qs[{key,q,ph,need}] + 주소가 아닌 옛 fields(질문을 주소 칸으로 받던 것)는 글 상자로 받는다.
       답은 예전처럼 urls[key] 에 저장 — 사장님 칸 합치기(uut) 규칙은 그대로 */
    var u = x.urls || {}, ql = qList(x), uf = urlFields(x);
    if (ql.length) {
      h += "<h3>클실장 질문 — 아시는 것만 짧게 적어 주세요</h3>" + ql.map(function (q) {
        var val = draftOf("url", x.id, q.key, u[q.key] || ""), dr = S.drafts[dk("url", x.id, q.key)] != null;
        return '<div class="qa' + (val ? " filled" : "") + (dr ? " draft" : "") + '"><div class="qq">' + mark(linkify(q.q)) + (q.need ? ' <span class="badge pri1">꼭</span>' : "") + '</div><textarea rows="1" data-act="url" data-q="1" data-id="' + id + '" data-k="' + esc(q.key) + '" placeholder="' + esc(q.ph || "답을 적어 주세요") + '" aria-label="' + esc(q.q) + '">' + esc(val) + "</textarea></div>";
      }).join("") + '<p class="note">적으면 바로 저장됩니다 — 클실장이 다음 작업 때 읽고 반영합니다.</p>';
    }
    if (uf.length) {
      h += "<h3>올린 뒤 주소 넣기 — 클실장이 읽고 등록부·링크를 채웁니다</h3>" + uf.map(function (f) {
        var val = draftOf("url", x.id, f.key, u[f.key] || ""), dr = S.drafts[dk("url", x.id, f.key)] != null;
        return '<div class="field' + (val ? " filled" : "") + (dr ? " draft" : "") + '"><label>' + esc(f.label) + '</label><input type="url" inputmode="url" placeholder="' + esc(f.ph || "https://cafe.naver.com/freetourincebu/…") + '" value="' + esc(val) + '" data-act="url" data-id="' + id + '" data-k="' + esc(f.key) + '"></div>';
      }).join("");
    }
    if (x.choice) {
      var a = x.answer || {};
      h += '<h3>결정</h3><div class="choice">' + (x.choice.q ? '<div class="q">' + esc(x.choice.q) + "</div>" : "") + '<div class="opts">' +
        (x.choice.opts || []).map(function (o, i) { return '<button class="' + (a.pick === o ? "on" : "") + '" data-act="pick" data-id="' + id + '" data-i="' + i + '">' + (a.pick === o ? "✓ " : "") + esc(o) + "</button>"; }).join("") +
        '</div><p class="note" style="margin:8px 0 4px">직접 답하기(고르기 대신·덧붙이기)</p><textarea data-act="ans" data-id="' + id + '" placeholder="예: 1번으로 하되 금액은 빼 줘">' + esc(draftOf("ans", x.id, "", a.text || "")) + "</textarea>" +
        (a.at ? '<p class="note">답한 시각 ' + esc(a.at.replace("T", " ").slice(0, 16)) + " — 클실장이 다음 작업 때 반영합니다.</p>" : "") + "</div>";
    }
    h += '<h3>클실장에게 메모</h3><textarea data-act="note" data-id="' + id + '" placeholder="예: 이건 다음 주로 / 사진 바꿔 줘">' + esc(draftOf("note", x.id, "", x.note || "")) + "</textarea>";
    h += '<div class="req"><button class="btn sm ghost" data-act="req" data-id="' + id + '">✎ 고칠 것 있으면 — 이 할 일 통째로 복사</button><span class="note">새 대화창에 붙여넣고 고칠 점만 적으시면 클실장이 묻지 않고 고쳐서 여기에 다시 올립니다. 문단 하나만이면 줄 끝 ⧉</span></div>';
    h += '<div class="foot2">' + (x.status === "done" || x.status === "cancel" ? '<button class="btn sm ghost" data-act="toggle" data-id="' + id + '">다시 할 일로</button>' :
      '<button class="btn ok" data-act="toggle" data-id="' + id + '">✓ 했어요</button><button class="btn sm ghost" data-act="snooze" data-n="1" data-id="' + id + '">내일로</button><button class="btn sm ghost" data-act="snooze" data-n="7" data-id="' + id + '">다음 주로</button>' +
      (x.snoozeTo ? '<button class="btn sm ghost" data-act="unsnooze" data-id="' + id + '">미루기 취소</button>' : "")) +
      '<span class="src">' + (x.src ? "출처: " + esc(x.src) : "") + (x.after ? (x.src ? " · " : "") + "끝나면 클실장이: " + esc(x.after) : "") + "</span></div>";
    return h + "</div>";
  }
  function linkBtns(links) {
    var pc = false;
    var h = '<div class="btns">' + links.map(function (l) {
      if (l.url) return '<a class="btn ghost" target="_blank" rel="noopener" href="' + esc(l.url) + '">' + esc(l.label) + " ↗</a>";
      pc = true;
      return '<a class="btn' + (S.local ? "" : " ghost") + '" target="_blank" rel="noopener" href="' + esc(fileUrl(l.path)) + '">' + esc(l.label) + (S.local ? "" : " (PC)") + "</a>" +
        (S.local ? '<button class="btn sm ghost" data-act="folder" data-p="' + esc(l.path) + '" title="탐색기에서 열기">폴더</button>' : "");
    }).join("") + "</div>";
    return h + (pc && !S.local ? '<p class="note">(PC) 표시는 PC에서 필투두 도우미가 켜져 있을 때 열립니다.</p>' : "");
  }

  /* ---------- ✔ 체크 — 클실장이 사장님께 꼭 알려 드릴 보고(2026-11-20 사장님, 원장 261120-07) ----------
     할 일(사장님이 해야 하는 것)·💡 아이디어(제안)와 따로, '알아야 하는 것'만 모은다. 사업이 늘어도 맨 윗줄 오른쪽 [체크] 하나로 전부.
     항목: kind=check, lv 1 급함 / 2 알림, biz(투윙스·솔타나… → PT_BIZ 로 묶음), detail, links, task(관련 할 일 id).
     사장님 몫: status(todo 안 읽음 → done 확인함)·doneAt·note(클실장에게 답) — 서버 pt_agent_upsert 가 지켜 준다. */
  function allChecks() { return Object.keys(S.items).map(function (k) { return S.items[k]; }).filter(function (x) { return x.kind === "check" && x.status !== "cancel"; }); }
  function newChecks() { return allChecks().filter(function (x) { return x.status !== "done"; }); }
  function bizOf(x) {
    var L = window.PT_BIZ || [], b = x.biz || "";
    for (var i = 0; i < L.length; i++) if (L[i].name === b || (L[i].has || []).indexOf(b) >= 0) return L[i].name;
    return b || (L[0] ? L[0].name : "");
  }
  function hm(t) { var d = new Date(t); return md(ymd(d)) + " " + ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2); }
  function chkToast(n) { toast("클실장 보고가 " + n + "건 왔습니다 — 맨 위 [체크]", { label: "보기", fn: function () { clearFind(); S.view = "check"; render(); window.scrollTo(0, 0); } }); }
  function chkBtn() {
    var b = $("#chkBtn"); if (!b) return;
    var nc = sess ? newChecks() : [], hot = nc.some(function (x) { return x.lv === 1; });
    b.classList.toggle("on", S.view === "check");
    b.classList.toggle("hot", hot);
    var n = $("#navChk"); if (n) { n.textContent = nc.length; n.style.display = nc.length ? "" : "none"; }
    b.title = nc.length ? "클실장 보고 " + nc.length + "건" + (hot ? " — 급한 것 있음" : "") : "클실장이 꼭 알려 드릴 보고(지금은 새 것 없음)";
  }
  function ckCard(x, open) {
    var id = esc(x.id), read = x.status === "done", lv = x.lv === 1 ? 1 : 2;
    var h = '<div class="card ck lv' + lv + (read ? " read" : "") + '" id="c_' + id + '"><div class="ckh"><span class="lv">' + (lv === 1 ? "급함" : "알림") + "</span>" +
      (x.t0 ? '<span class="when">' + hm(x.t0) + "</span>" : "") + (x.biz ? '<span class="bz">' + esc(x.biz) + "</span>" : "") + (read ? '<span class="when">확인 ' + esc(md((x.doneAt || "").slice(0, 10))) + "</span>" : "") + "</div>";
    h += '<div class="t">' + esc(x.title) + "</div>";
    if (!open) return h + '<button class="btn sm ghost ckmore" data-act="expand" data-id="' + id + '">펼쳐 보기</button></div>';
    if (x.detail) h += '<div class="ckb">' + linkify(x.detail) + "</div>";
    if (x.links && x.links.length) h += linkBtns(x.links);
    var tk = x.task && S.items[x.task];
    if (x.task) h += '<p class="note cktask">관련 할 일: ' + (tk ? '<a href="#c_' + esc(x.task) + '" data-act="goto" data-id="' + esc(x.task) + '">' + (tk.status === "done" ? "✓ " : "") + esc(tk.title) + "</a>" : esc(x.task)) + "</p>";
    h += '<div class="ckf">' + (read ? '<button class="btn sm ghost" data-act="ckseen" data-id="' + id + '">안 읽은 것으로</button>' : '<button class="btn ok" data-act="ckseen" data-id="' + id + '">✓ 확인했어요</button>') +
      '<button class="btn sm ghost" data-act="ckcopy" data-id="' + id + '" title="복사해서 새 대화창에 붙여넣고 클실장과 더 얘기하기">⧉ 클실장과 얘기하기</button>' +
      (read && open ? '<button class="btn sm ghost" data-act="expand" data-id="' + id + '">접기</button>' : "") + "</div>";
    h += '<details class="ckn"' + (x.note || S.drafts[dk("note", x.id, "")] != null ? " open" : "") + '><summary class="note">클실장에게 한마디(선택)</summary><textarea data-act="note" data-id="' + id + '" placeholder="예: 알겠어, 다음 주에 처리하자 / 이건 더 자세히 알려 줘">' + esc(draftOf("note", x.id, "", x.note || "")) + "</textarea></details>";
    return h + "</div>";
  }
  function viewCheck() {
    var h = '<h1>체크 <span class="h1s">— 꼭 아셔야 할 것</span></h1>';
    if (!sess) return h + needLogin();
    var all = allChecks(), L = window.PT_BIZ || [], f = S.ckbiz || "전체", groups = {};
    all.forEach(function (x) { var g = bizOf(x); groups[g] = (groups[g] || 0) + 1; });
    var gs = Object.keys(groups);
    if (gs.length > 1 || L.length > 1) h += '<div class="chips"><button class="chip' + (f === "전체" ? " on" : "") + '" data-ckbiz="전체">전체 ' + all.length + "</button>" + gs.map(function (g) { return '<button class="chip' + (f === g ? " on" : "") + '" data-ckbiz="' + esc(g) + '">' + esc(g) + " " + groups[g] + "</button>"; }).join("") + "</div>";
    var shown = all.filter(function (x) { return f === "전체" || bizOf(x) === f; });
    var un = shown.filter(function (x) { return x.status !== "done"; }).sort(function (a, b) { return (a.lv === 1 ? 0 : 1) - (b.lv === 1 ? 0 : 1) || (b.t0 || 0) - (a.t0 || 0); });
    var rd = shown.filter(function (x) { return x.status === "done"; }).sort(function (a, b) { return (b.doneAt || "").localeCompare(a.doneAt || ""); });
    h += '<p class="note ckintro">클실장이 사장님께 직접 알려 드릴 것만 모았습니다 — 해야 할 일은 [할 일]에, 제안은 [💡 아이디어]에 따로 있습니다. 읽으셨으면 [✓ 확인했어요]를 눌러 주세요. 사업이 늘어도 모든 사업의 보고가 여기 한곳에 옵니다.</p>';
    if (un.length) {
      var hot = un.filter(function (x) { return x.lv === 1; }).length;
      h += '<div class="sec ck-sec"><h2>새 보고</h2><span class="cnt">' + un.length + "건" + (hot ? " · 급한 것 " + hot + "건" : "") + "</span>" + (un.length - hot > 1 ? '<button class="btn sm ghost" data-act="ckall" title="급함은 하나씩 확인해 주세요">알림 ' + (un.length - hot) + "건 모두 확인</button>" : "") + "</div>";
      h += un.map(function (x) { return ckCard(x, true); }).join("");
    } else h += '<div class="empty ckempty"><b>지금 꼭 아셔야 할 새 보고는 없습니다.</b><br>급한 일이 생기면 클실장이 여기에 올리고, 맨 위 [체크]에 숫자가 뜹니다.</div>';
    if (rd.length) h += '<div class="sec"><h2>확인한 것</h2><span class="cnt">' + rd.length + "건 · 최근 " + KEEP_DAYS + "일(지난 것은 맨 위 🔍 찾기)</span></div><details" + (S.open.sec_ckread ? " open" : "") + ' data-sec="ckread"><summary class="note">펼쳐 보기</summary>' + rd.map(function (x) { return ckCard(x, !!S.open[x.id]); }).join("") + "</details>";
    return h;
  }
  function ckText(x) {
    return "[필투두 체크] " + x.id + "\n보고: " + x.title + (x.detail ? "\n내용: " + x.detail : "") + (x.task ? "\n관련 할 일: " + x.task : "") + "\n\n내 생각: ";
  }

  /* 클실장 제안·아이디어 — 사장님이 가장 즐겨 보는 부분이라 노란 상자로 맨 위에, 하나씩 반응 버튼 */
  var REACT = [["진행", "좋아요, 진행해"], ["보류", "나중에"], ["안 함", "안 할래요"]];
  function ideasBox(x) {
    if (!x.ideas || !x.ideas.length) return "";
    var r = x.react || {};
    return '<div class="ideas"><div class="ih">💡 클실장 제안·아이디어</div>' + x.ideas.map(function (d, i) { return ideaRow(x, d, i, r[i]); }).join("") + "</div>";
  }
  function ideaRow(x, d, i, cur, from) {
    var gold = d.t === "아이디어";
    return '<div class="idea"><span class="it' + (gold ? " gold" : "") + '">' + (gold ? "💡 아이디어" : "실장 제안") + "</span>" + (from || "") + '<div class="itx">' + mark(linkify(d.text)) + '</div><div class="rb">' +
      REACT.map(function (o) { return '<button class="' + (cur === o[0] ? "on" : "") + '" data-act="react" data-id="' + esc(x.id) + '" data-i="' + i + '" data-v="' + o[0] + '">' + (cur === o[0] ? "✓ " : "") + o[1] + "</button>"; }).join("") +
      '<button class="pc" data-act="ideacopy" data-id="' + esc(x.id) + '" data-i="' + i + '" title="복사해서 새 대화창에 붙여넣고 더 얘기하기">⧉</button></div></div>';
  }
  function allIdeas() {
    var out = [];
    Object.keys(S.items).forEach(function (k) { var x = S.items[k]; if (x.kind === "log" || !x.ideas) return; x.ideas.forEach(function (d, i) { out.push({ x: x, d: d, i: i, r: (x.react || {})[i] }); }); });
    return out.sort(function (a, b) { return (b.x.t0 || 0) - (a.x.t0 || 0) || a.i - b.i; });
  }
  /* 답 없이 지나간 제안(PT-20) — 지우지 않고 💡 화면의 '지난 제안'으로 접어 둔다(새 숫자에서만 빠짐, 펼쳐서 언제든 답할 수 있음).
     사장님 결정(원장 261124-72) "30일 지나면": 올라온 지 IDEA_KEEP 일이 지나도록 답이 없는 것.
     취소된 일·사장님이 끝낸 할 일에 붙은 것은 예전부터 새 숫자에서 빠졌다 — 예전엔 💡 화면 어디에도 안 보였는데 이제 여기 모인다 */
  var IDEA_KEEP = 30;
  function ideaOld(e) {
    var x = e.x;
    if (x.status === "cancel" || (x.kind === "task" && x.status === "done")) return true;
    return IDEA_KEEP > 0 && (x.t0 || 0) > 0 && x.t0 < Date.now() - IDEA_KEEP * 864e5;
  }
  function freshIdeas() { return allIdeas().filter(function (e) { return !e.r && !ideaOld(e); }); }
  function viewIdeas() {
    if (!sess) return needLogin();
    var all = allIdeas(), f = S.ifilter || "전체";
    var shown = all.filter(function (e) { return f === "전체" || (f === "아이디어" ? e.d.t === "아이디어" : e.d.t !== "아이디어"); });
    var h = '<h1>💡 클실장 제안·아이디어</h1><p class="note" style="margin-top:-4px">일마다 클실장이 낸 제안과 아이디어를 모았습니다. [좋아요, 진행해]를 누르시면 클실장이 다음 작업 때 바로 진행하고, 더 얘기하고 싶으면 ⧉로 복사해 새 대화창에 붙여넣으세요.</p>';
    h += '<div class="chips">' + ["전체", "아이디어", "제안"].map(function (c) { return '<button class="chip' + (f === c ? " on" : "") + '" data-ifilter="' + c + '">' + (c === "아이디어" ? "💡 아이디어" : c === "제안" ? "실장 제안" : "전체") + "</button>"; }).join("") + "</div>";
    var oldSub = (IDEA_KEEP > 0 ? "올라온 지 " + IDEA_KEEP + "일 넘게 답이 없었거나 " : "") + "끝낸·취소된 할 일에 붙은 것 — 지우지 않고 모아 둡니다, 지금 답하셔도 됩니다";
    if (all.length && f === "전체" && !freshIdeas().length) h += '<div class="empty">새로 온 제안은 다 보셨습니다. 지난 제안은 아래에서 펼쳐 보실 수 있습니다.</div>';
    [["", "새로 온 것", "아직 답하지 않은 것"], ["old", "지난 제안", oldSub], ["진행", "진행하기로 한 것", "클실장이 진행합니다"], ["보류", "나중에", ""], ["안 함", "안 하기로 한 것", ""]].forEach(function (g) {
      var xs = shown.filter(function (e) { return g[0] === "old" ? !e.r && ideaOld(e) : g[0] ? e.r === g[0] : !e.r && !ideaOld(e); });
      if (!xs.length) return;
      h += '<div class="sec"><h2>' + g[1] + '</h2><span class="cnt">' + xs.length + "건" + (g[2] ? " · " + g[2] : "") + "</span></div>";
      var body = '<div class="ideas big">' + xs.map(function (e) {
        var from = e.x.kind === "task" ? ' <a class="from" href="#c_' + esc(e.x.id) + '" data-act="goto" data-id="' + esc(e.x.id) + '">할 일: ' + esc(e.x.title) + "</a>" : ' <span class="from">' + esc(e.x.kind === "idea" ? (e.x.area || "새 아이디어") : e.x.title) + "</span>";
        return ideaRow(e.x, e.d, e.i, e.r, from + (e.x.t0 ? ' <span class="from">' + md(ymd(new Date(e.x.t0))) + "</span>" : ""));
      }).join("") + "</div>";
      h += g[0] ? "<details" + (S.open["isec_" + g[0]] ? " open" : "") + ' data-isec="' + g[0] + '"><summary class="note">펼쳐 보기</summary>' + body + "</details>" : body;
    });
    if (!all.length) h += '<div class="empty">아직 올라온 제안·아이디어가 없습니다.</div>';
    return h;
  }

  /* 새 대화창에 붙여넣을 '수정 요청 — 맨 윗줄의 번호만 있으면 클실장이 원본 파일과 할 일을 찾아 고친다 */
  function reqText(x) {
    var L = ["[필투두 수정 요청] " + x.id, "할 일: " + x.title, "분류: " + (CAT[x.cat] || CAT["기타"]).label + (x.due ? " · 마감 " + md(x.due) : "") + (x.biz ? " · " + x.biz : "")];
    if (x.why) L.push("설명: " + x.why);
    if (x.steps && x.steps.length) { L.push("순서:"); x.steps.forEach(function (s, i) { L.push((i + 1) + ". " + s); }); }
    if (x.choice) L.push("결정: " + (x.choice.q || "") + " [" + (x.choice.opts || []).join(" / ") + "]");
    qList(x).forEach(function (q) { var v = (x.urls || {})[q.key]; L.push("질문: " + q.q + (v ? " → 내 답: " + v : "")); });
    var files = (x.links || []).concat(x.images || []).map(function (l) { return l.path || l.url; }).filter(Boolean);
    if (files.length) L.push("관련 파일: " + files.join(" , "));
    if (x.src) L.push("출처: " + x.src);
    if (x.note) L.push("내 메모: " + x.note);
    return L.join("\n") + "\n\n고칠 점: ";
  }
  function linkify(s) { return esc(s).replace(/https?:\/\/[^\s)]+/g, function (u) { return '<a href="' + u + '" target="_blank" rel="noopener">' + u + "</a>"; }); }

  /* ---------- 클실장 질문 칸(2026-11-24 전수조사 PT-12) ----------
     예전엔 질문 답을 '올린 주소' 칸(fields, 주소 자판)으로 받아 '한 일'에 깨진 링크로 보였다.
     qs[{key,q,ph,need}] = 질문, fields 중 주소가 아닌 것(예시가 http 로 시작하지 않고 이름에 '주소·링크'가 없는 것)도 질문으로 본다(f.t 로 고정 가능).
     답은 그대로 urls[key] — 저장·합치기 길은 주소와 같다. http 로 시작하지 않는 값은 링크가 아니라 글로 보인다. */
  function isQField(f) { if (f.t === "q") return true; if (f.t === "url") return false; return !(/^https?:/i.test(f.ph || "") || /주소|링크|url/i.test(f.label || "")); }
  function qList(x) {
    var out = [], seen = {};
    (Array.isArray(x.qs) ? x.qs : []).forEach(function (q) { if (q && q.key && !seen[q.key]) { seen[q.key] = 1; out.push({ key: q.key, q: q.q || q.label || q.key, ph: q.ph, need: q.need }); } });
    (Array.isArray(x.fields) ? x.fields : []).forEach(function (f) { if (f && f.key && !seen[f.key] && isQField(f)) { seen[f.key] = 1; out.push({ key: f.key, q: f.label || f.key, ph: f.ph, need: f.need }); } });
    return out;
  }
  function urlFields(x) { var qk = {}; qList(x).forEach(function (q) { qk[q.key] = 1; }); return (Array.isArray(x.fields) ? x.fields : []).filter(function (f) { return f && f.key && !qk[f.key]; }); }
  function isLink(v) { return /^https?:\/\/\S+$/i.test(String(v == null ? "" : v).trim()); }
  function labelOf(x, k) {
    var q = qList(x).filter(function (e) { return e.key === k; })[0]; if (q) return q.q;
    var f = (Array.isArray(x.fields) ? x.fields : []).filter(function (e) { return e && e.key === k; })[0]; return f ? f.label || k : k;
  }
  function cut(s, n) { s = String(s || ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; }
  /* '한 일'·찾기에 보일 주소(링크)와 질문 답(글) */
  function answersOf(x) {
    var u = x.urls || {}, links = [], qa = [];
    Object.keys(u).forEach(function (k) {
      var v = u[k]; if (v == null || v === "") return; v = String(v);
      if (isLink(v)) links.push('<a href="' + esc(v.trim()) + '" target="_blank" rel="noopener">' + esc(cut(labelOf(x, k), 60)) + "</a>");
      else qa.push('<div class="note qa1" title="' + esc(labelOf(x, k)) + '"><span>' + esc(cut(labelOf(x, k), 60)) + "</span> → <b>" + esc(v) + "</b></div>");
    });
    return (links.length ? '<div class="note">' + links.join(" · ") + "</div>" : "") + qa.join("");
  }

  function months(arr, key) { var m = {}; arr.forEach(function (x) { var d = (x[key] || "").slice(0, 7); if (d) m[d] = 1; }); return Object.keys(m).sort().reverse(); }
  function viewDone() {
    if (!sess) return needLogin();
    var loc = Object.keys(S.items).map(function (k) { return S.items[k]; }).filter(function (x) { return x.kind === "task" && x.status === "done"; });
    var src = S.remote.done || loc, seen = {}, rows = [];
    /* 서버에서 가져온 옛 복사본보다 이 기기의 지금 상태가 먼저 — 되돌린 일이 '한 일'에 남아 다시 누르면 도로 완료되던 문제(2026-11-21 사장님, 원장 261121-50) */
    src.concat(loc).forEach(function (x) { if (seen[x.id]) return; seen[x.id] = 1; var live = S.items[x.id]; if (live) x = live; if (x.status !== "done") return; if (S.dmonth && (x.doneAt || "").slice(0, 7) !== S.dmonth) return; if (S.dq && (x.title || "").toLowerCase().indexOf(S.dq.toLowerCase()) < 0) return; rows.push(x); });
    rows.sort(function (a, b) { return (b.doneAt || "").localeCompare(a.doneAt || ""); });
    var ms = months(src.concat(loc), "doneAt"); if (ms.indexOf(ymd().slice(0, 7)) < 0) ms.unshift(ymd().slice(0, 7));
    var h = '<h1>사장님이 한 일</h1><div class="card"><div class="grid2"><input class="search" id="dq" placeholder="제목으로 찾기" value="' + esc(S.dq) + '"><select id="dmonth"><option value="">모든 달</option>' + ms.map(function (m) { return '<option value="' + m + '"' + (S.dmonth === m ? " selected" : "") + ">" + m.replace("-", "년 ") + "월</option>"; }).join("") + '</select></div><p class="note" style="margin:6px 0 0">이 기기에는 최근 ' + KEEP_DAYS + '일만 둡니다. 그보다 오래된 일은 <button class="btn sm ghost" data-act="rsearch" data-k="done">서버에서 찾기</button>' + (S.rbusy ? " 찾는 중…" : "") + "</p></div>";
    /* 취소된 일(PT-19) — 원장 취소·클실장 취소로 할 일·한 일 어디에도 안 보이던 것. 사장님 메모가 있어도 여기서 보이고 되살릴 수 있다 */
    var cx = Object.keys(S.items).map(function (k) { return S.items[k]; }).filter(function (x) { return x.kind === "task" && x.status === "cancel"; }).sort(function (a, b) { return (b.doneAt || "").localeCompare(a.doneAt || "") || (b.t0 || 0) - (a.t0 || 0); });
    var cbox = cx.length ? '<div class="sec"><h2>취소된 일</h2><span class="cnt">' + cx.length + "건 · 클실장이 취소한 일 — 다시 하실 거면 [다시 할 일로]</span></div><details" + (S.open.sec_cancel ? " open" : "") + ' data-sec="cancel"><summary class="note">펼쳐 보기</summary><div class="card list">' + cx.map(function (x) {
      return '<div class="row1"><div class="d">' + md((x.doneAt || "").slice(0, 10)) + '</div><div class="grow"><span class="area">취소됨</span>' + esc(x.title) + (x.note ? '<div class="note">내 메모: ' + esc(x.note) + "</div>" : "") + (x.doneNote ? '<div class="note">' + esc(cut(x.doneNote, 120)) + "</div>" : "") +
        '</div><button class="btn sm ghost" data-act="undo" data-id="' + esc(x.id) + '">다시 할 일로</button></div>';
    }).join("") + "</div></details>" : "";
    if (!rows.length) return h + '<div class="empty">끝낸 일이 없습니다.</div>' + cbox;
    var last = "";
    h += '<div class="card list">' + rows.map(function (x) {
      var d = (x.doneAt || "").slice(0, 10);
      // 올린 주소는 링크로, 질문 답(http 로 시작하지 않는 값)은 'Q → 답' 글로 — 예전엔 답이 깨진 링크로 보였다(PT-12)
      var r = '<div class="row1"><div class="d">' + (d !== last ? md(d) : "") + '</div><div class="grow"><span class="area">' + esc((CAT[x.cat] || CAT["기타"]).label) + "</span>" + esc(x.title) + answersOf(x) + (x.answer ? '<div class="note">답: ' + esc([x.answer.pick, x.answer.text].filter(Boolean).join(" / ")) + "</div>" : "") +
        '</div><button class="btn sm ghost" data-act="undo" data-id="' + esc(x.id) + '">되돌리기</button></div>';
      last = d; return r;
    }).join("") + "</div>";
    return h + cbox;
  }
  function viewKl() {
    if (!sess) return needLogin();
    var all = Object.keys(S.items).map(function (k) { return S.items[k]; });
    var kt = all.filter(function (x) { return x.kind === "ktask" && x.status !== "done" && x.status !== "cancel"; }).sort(sorter);
    var loc = all.filter(function (x) { return x.kind === "log"; }), src = S.remote.log || loc, seen = {}, logs = [];
    var areas = {}; src.concat(loc).forEach(function (x) { areas[x.area || "기타"] = (areas[x.area || "기타"] || 0) + 1; });
    src.concat(loc).forEach(function (x) {
      if (seen[x.id]) return; seen[x.id] = 1;
      if (S.karea !== "전체" && (x.area || "기타") !== S.karea) return;
      if (S.kmonth && (x.date || "").slice(0, 7) !== S.kmonth) return;
      if (S.kq && ((x.title || "") + " " + (x.detail || "")).toLowerCase().indexOf(S.kq.toLowerCase()) < 0) return;
      logs.push(x);
    });
    logs.sort(function (a, b) { return (b.date || "").localeCompare(a.date || "") || (b.t0 || 0) - (a.t0 || 0); });
    var h = "<h1>클실장</h1>";
    var ss = all.filter(function (x) { return x.kind === "sess"; }), grp = {};
    ss.forEach(function (x) { (grp[x.group || "세션"] = grp[x.group || "세션"] || []).push(x); });
    Object.keys(grp).forEach(function (g) {
      var xs = grp[g].sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
      h += '<div class="card"><h2>' + esc(g) + "</h2>" + '<div class="list">' + xs.map(function (x) {
        var ts = (x.tasks || []).map(function (tid) { var t = S.items[tid]; return t ? '<a href="#c_' + esc(tid) + '" data-act="goto" data-id="' + esc(tid) + '">' + (t.status === "done" ? "✓ " : "") + esc(t.title) + "</a>" : ""; }).filter(Boolean);
        return '<div class="row1"><div class="grow"><b>' + esc(x.title) + '</b> <span class="badge' + (x.state === "사장님 차례" ? " pri1" : "") + '">' + esc(x.state || "") + "</span>" +
          (x.detail ? '<div class="note">' + esc(x.detail) + "</div>" : "") + ideasBox(x) + (ts.length ? '<div class="note">사장님 할 일: ' + ts.join(" · ") + "</div>" : "") + "</div></div>";
      }).join("") + "</div></div>";
    });
    /* 기한 지난 클실장 일은 빨간 '기한 지남'(PT-21) — 날짜순이라 맨 위에 모인다 */
    var td0 = today(), klate = kt.filter(function (x) { return x.due && x.due < td0; }).length;
    h += '<div class="card"><h2>클실장이 맡고 있는 일 ' + kt.length + "건" + (klate ? ' <span class="due late">기한 지남 ' + klate + "</span>" : "") + "</h2>" + (kt.length ? '<div class="list">' + kt.map(function (x) { var lt = x.due && x.due < td0; return '<div class="row1"><div class="d' + (lt ? " late" : "") + '">' + (x.due ? md(x.due) : "") + '</div><div class="grow"><span class="area">' + esc(x.area || "") + "</span>" + (lt ? '<span class="badge stall">기한 지남</span> ' : "") + esc(x.title) + (x.why ? '<div class="note">' + esc(x.why) + "</div>" : "") + "</div></div>"; }).join("") + "</div>" : '<p class="note">지금 맡은 일이 없습니다.</p>') + "</div>";
    var ar = Object.keys(areas).sort(function (a, b) { return areas[b] - areas[a]; });
    var ms = months(src.concat(loc), "date");
    h += '<div class="card"><h2>클실장이 한 일 — 분야별</h2><div class="chips"><button class="chip' + (S.karea === "전체" ? " on" : "") + '" data-karea="전체">전체</button>' + ar.map(function (a) { return '<button class="chip' + (S.karea === a ? " on" : "") + '" data-karea="' + esc(a) + '">' + esc(a) + " " + areas[a] + "</button>"; }).join("") + "</div>" +
      '<div class="grid2"><input class="search" id="kq" placeholder="찾기(제목·내용)" value="' + esc(S.kq) + '"><select id="kmonth"><option value="">모든 달</option>' + ms.map(function (m) { return '<option value="' + m + '"' + (S.kmonth === m ? " selected" : "") + ">" + m.replace("-", "년 ") + "월</option>"; }).join("") + "</select></div>" +
      '<p class="note" style="margin:6px 0 0">' + logs.length + '건 · 오래된 기록은 <button class="btn sm ghost" data-act="rsearch" data-k="log">서버에서 찾기</button>' + (S.rbusy ? " 찾는 중…" : "") + "</p></div>";
    var last = "";
    h += logs.length ? '<div class="card list">' + logs.slice(0, 300).map(function (x) {
      var r = '<div class="row1"><div class="d">' + (x.date !== last ? md(x.date) : "") + '</div><div class="grow"><details><summary><span class="area">' + esc(x.area || "기타") + "</span>" + esc(x.title) + "</summary>" + (x.detail ? "<div>" + linkify(x.detail) + "</div>" : "") + "</details></div></div>";
      last = x.date; return r;
    }).join("") + "</div>" : '<div class="empty">기록이 없습니다.</div>';
    return h;
  }
  function viewSet() {
    var h = "<h1>설정</h1>";
    if (!SB) h += '<div class="warnbox">동기화 설정(config.js)이 없습니다.</div>';
    else if (!sess) h += '<div class="card"><h2>로그인 (필보드와 같은 계정)</h2><div class="grid2"><div><label class="note">이메일</label><input class="search" id="em" type="email" autocomplete="username"></div><div><label class="note">비밀번호</label><input class="search" id="pw" type="password" autocomplete="current-password"></div></div><div class="btns" style="margin-top:8px"><button class="btn" data-act="login">로그인</button></div><p class="note" id="syncMsg">' + esc(S.msg) + "</p></div>";
    else h += '<div class="card"><h2>동기화 켜짐</h2><p class="note">' + esc(sess.user.email || "") + '</p><div class="btns"><button class="btn sm" data-act="sync">지금 동기화</button><button class="btn sm ghost" data-act="logout">로그아웃</button></div><p class="note" id="syncMsg">' + esc(S.msg) + "</p></div>";
    h += '<div class="card"><h2>PC 도우미(폴더 사진·HTML 바로 열기)</h2>' + (S.local ? '<div class="okbox">연결됨 — [열기]·[사진 복사]·[폴더]가 바로 됩니다.</div>' :
      '<p class="note">PC를 켜면 도우미가 자동으로 켜집니다(윈도 시작 프로그램 「필투두 도우미」). 안 켜져 있으면 <b>twowings\\philtodo\\필투두_켜기.bat</b> 을 두 번 누르세요. PC 필투두 주소는 http://127.0.0.1:8790 이고, 크롬 주소창 오른쪽 [설치] 아이콘을 누르면 PC 앱이 됩니다.</p>') + "</div>";
    h += '<div class="card"><h2>폰에 설치</h2><p class="note">폰 크롬(아이폰은 사파리)에서 필투두 주소를 열고 메뉴 → [홈 화면에 추가]. 폰에서는 할 일 보기·체크·주소 넣기·결정이 되고, 폴더 사진 복사는 PC에서 합니다.</p>' +
      /* 공용 install.js(원장 261120-01): 크롬은 설치 창, 아이폰·카톡은 기기별 안내 */
      (window.PhilInstall && PhilInstall.installed() ? '<div class="okbox">지금 앱으로 열려 있습니다.</div>' :
        '<button class="btn" type="button" onclick="window.PhilInstall&&PhilInstall.open(true)">이 기기에 설치</button>') + "</div>";
    h += '<div class="card"><h2>이 기기 저장</h2><p class="note">열린 일 + 최근 ' + KEEP_DAYS + "일만 이 기기에 둡니다(지금 " + Object.keys(S.items).length + "건). 지난 기록은 서버에 있어 맨 위 🔍 찾기나 [한 일]·[클실장]에서 찾으면 가져옵니다.</p></div>";
    h += '<div class="card"><h2>🔍 찾기</h2><p class="note">맨 위 칸에 낱말을 넣으면 할 일·한 일·💡 아이디어·클실장 기록을 한 번에 찾습니다. 제목뿐 아니라 순서·복사 문구·메모·내 답·올린 주소까지 보고, 낱말을 띄어 여러 개 넣으면 모두 들어간 것만 나옵니다. 날짜(11/19·11월)로도 찾습니다. PC에서는 <b>/</b> 키를 누르면 바로 찾기 칸으로 갑니다.</p></div>';
    h += '<div class="card"><h2>💾 저장</h2><p class="note">하다가 멈춰야 할 때 맨 위 <b>[💾 저장]</b>을 누르면 체크·주소·메모와 펼쳐 둔 카드, 보던 자리까지 그대로 남아 다음에 열면 이어서 하실 수 있습니다. 주소·메모는 서버에도 올라가 PC·폰 어디서 열어도 같습니다. 칸에 치는 글은 누르지 않아도 이 기기에 바로 남고, 아직 서버에 안 올라간 것이 있으면 버튼이 금색으로 바뀌고 개수가 보입니다. 쓰다 만 「직접 답하기」는 보내면 완료가 되므로 저장해도 이 기기에만 남겨 둡니다.</p></div>';
    return h;
  }

  /* ---------- 되돌리기·할 일로 가기 (2026-11-21 사장님: "되돌리기 하고 할 일로 가 보니 없어", 원장 261121-50) ---------- */
  function restoreTask(id) {
    if (!S.items[id]) return;
    setUser(id, { status: "todo", doneAt: null, doneBy: null }, true);
    var x = S.items[id];
    // 서버에서 가져온 옛 복사본도 같이 바꿔 '한 일'·찾기 화면에 완료로 남지 않게
    [S.remote.done, S.fr && S.fr.rows].forEach(function (arr) { (arr || []).forEach(function (r) { if (r && r.id === id) { r.status = "todo"; delete r.doneAt; delete r.doneBy; } }); });
    // '꼭 할 것만'·'진행중만'·분류 칸이 걸려 있으면 되돌린 일이 가려지므로 풀어 둔다
    if (S.mode !== "all" || (S.cat !== "전체" && S.cat !== x.cat)) { S.mode = "all"; S.cat = "전체"; LS.set("mode", S.mode); LS.set("cat", S.cat); }
    var b = BUCKETS.filter(function (k) { return k[0] === bucket(x); })[0];
    render();
    toast("다시 할 일로 돌렸습니다 — 할 일의 '" + (b ? b[1] : "할 일") + "' 칸에 있습니다", { label: "할 일에서 보기", fn: function () { goTask(id); } });
  }
  /* 로그아웃(2026-11-24 고침 PT-04): 아직 안 올라간 것이 있으면 먼저 올려 보고, 그래도 남으면 묻는다.
     로그아웃해도 그 할 일들은 이 기기 'pend'(계정별)에 남아 같은 계정으로 다시 로그인하면 올라간다 — 묻지 않고 지우던 길을 막음 */
  function pendingCount() { return Object.keys(S.dirty).filter(function (id) { return S.items[id]; }).length; }
  function logout() {
    var go = function () {
      var n = pendingCount();
      if (n && !window.confirm("아직 서버에 안 올라간 할 일이 " + n + "건 있습니다(체크·메모·답 등).\n\n[확인] 이 기기에 따로 보관하고 로그아웃합니다 — 같은 계정으로 다시 로그인하면 그때 올라갑니다.\n[취소] 로그아웃하지 않습니다 — 인터넷 연결을 확인한 뒤 [지금 동기화]를 먼저 눌러 주세요.")) { msg("로그아웃을 취소했습니다 — 안 올라간 것 " + n + "건"); return; }
      save();   // 지금 계정의 안 올라간 것을 pend 에 확실히 남긴다
      setSess(null); LS.set("expired", null); S.items = {}; S.dirty = {}; S.since = "";
      LS.set("items", S.items); LS.set("dirty", S.dirty); LS.set("since", "");   // pend 는 건드리지 않는다
      render();
      if (n) toast("안 올라간 " + n + "건은 이 기기에 보관했습니다 — 다시 로그인하면 올라갑니다");
    };
    if (pendingCount() && SB && sess) { msg("로그아웃 전에 안 올라간 것을 올리는 중…"); doSync().then(go, go); } else go();
  }
  function goTask(id) {
    var x = S.items[id];
    clearFind(); S.view = "todo"; S.cat = "전체"; S.mode = "all"; LS.set("view", "todo"); LS.set("cat", S.cat); LS.set("mode", S.mode); S.open[id] = true;
    if (x && x.snoozeTo) S.open["sec_snooze"] = true;
    if (x && x.due && bucket(x) === "later") S.open["sec_later"] = true;
    render(); window.scrollTo(0, 0);
    var el = document.getElementById("c_" + id);
    if (el) { el.scrollIntoView({ block: "start" }); el.classList.add("flash"); setTimeout(function () { el.classList.remove("flash"); }, 2400); }
  }

  /* ---------- 알림 ---------- */
  var tt = 0;
  function toast(m, act) {
    var el = $("#toast"); el.innerHTML = esc(m) + (act ? ' <button id="tAct">' + esc(act.label) + "</button>" : ""); el.classList.add("on");
    if (act) $("#tAct").onclick = function () { act.fn(); el.classList.remove("on"); };
    clearTimeout(tt); tt = setTimeout(function () { el.classList.remove("on"); }, act ? 6000 : 2600);
  }

  /* ---------- 이벤트 ---------- */
  document.addEventListener("click", function (ev) {
    var t = ev.target.closest("[data-view],[data-mode],[data-cat],[data-karea],[data-ifilter],[data-fk],[data-ckbiz],[data-act]"); if (!t) return;
    if (t.hasAttribute("data-ifilter")) { S.ifilter = t.getAttribute("data-ifilter"); render(); return; }
    if (t.hasAttribute("data-ckbiz")) { S.ckbiz = t.getAttribute("data-ckbiz"); render(); return; }
    if (t.hasAttribute("data-fk")) { S.fk = t.getAttribute("data-fk"); render(); return; }
    if (t.hasAttribute("data-view")) { clearFind(); S.view = t.getAttribute("data-view"); LS.set("view", S.view); render(); window.scrollTo(0, 0); return; }
    if (t.hasAttribute("data-mode")) { S.mode = t.getAttribute("data-mode"); LS.set("mode", S.mode); render(); return; }
    if (t.hasAttribute("data-cat")) { S.cat = t.getAttribute("data-cat"); LS.set("cat", S.cat); render(); return; }
    if (t.hasAttribute("data-karea")) { S.karea = t.getAttribute("data-karea"); if (S.remote.log) remoteSearch("log"); else render(); return; }
    var a = t.getAttribute("data-act"), id = t.getAttribute("data-id"), x = id && S.items[id];
    if (a === "saveall") { saveAll(); return; }
    if (id && !x) { [S.remote.done, S.remote.log, S.fr && S.fr.rows].forEach(function (arr) { (arr || []).forEach(function (r) { if (r.id === id) x = S.items[id] = r; }); }); }
    if (a === "expand") { S.open[id] = !S.open[id]; LS.set("open", S.open); render(); return; }
    if (a === "goto") { ev.preventDefault(); goTask(id); return; }
    /* '한 일'의 되돌리기는 되돌리기만 한다(누를 때마다 완료↔할 일이 바뀌지 않게) — 되돌린 뒤 그 할 일이 어디 있는지 바로 보여 준다 (원장 261121-50) */
    if (a === "undo" && x) {
      if (x.status === "done" || x.status === "cancel") restoreTask(id);
      else toast("이미 할 일에 있습니다", { label: "할 일에서 보기", fn: function () { goTask(id); } });
      return;
    }
    if (a === "toggle" && x) {
      if (x.status === "done" || x.status === "cancel") restoreTask(id);   // 취소된 일도 [다시 할 일로](PT-19)
      else if (t.getAttribute("data-head") && HEAD_BOX === "ask" && !window.confirm("「" + cut(x.title, 40) + "」\n\n이 할 일을 끝낸 것으로 '한 일'로 넘길까요?")) return;
      else { var uu0 = x.urls || {}, miss = urlFields(x).filter(function (f) { return f.need && !uu0[f.key]; }), missQ = qList(x).filter(function (q) { return q.need && !uu0[q.key]; }); S.open[id] = false; if (S.view === "find") { clearFind(); S.view = "todo"; LS.set("view", "todo"); } setUser(id, { status: "done", doneAt: nowIso(), doneBy: "사장님" }); window.scrollTo(0, 0); LS.set("scroll", 0); toast(miss.length ? "완료! 올린 주소도 넣어 주시면 클실장이 링크를 채웁니다" : missQ.length ? "완료! 질문 답도 적어 주시면 클실장이 반영합니다" : "완료했습니다", { label: "되돌리기", fn: function () { restoreTask(id); } }); }
      return;
    }
    if (a === "snooze" && x) { var n = +t.getAttribute("data-n"); setUser(id, { snoozeTo: addDays(today(), n) }); S.open[id] = false; toast(md(addDays(today(), n)) + "로 미뤘습니다", { label: "되돌리기", fn: function () { setUser(id, { snoozeTo: null }); } }); return; }
    if (a === "unsnooze" && x) { setUser(id, { snoozeTo: null }); return; }
    if (a === "copy" && x) { ev.preventDefault(); copyText(x.copies[+t.getAttribute("data-i")].text); return; }
    if (a === "react" && x) { var rv = Object.assign({}, x.react || {}), ii = t.getAttribute("data-i"), vv = t.getAttribute("data-v"); if (rv[ii] === vv) delete rv[ii]; else rv[ii] = vv; setUser(id, { react: rv }); toast(rv[ii] === "진행" ? "좋습니다 — 클실장이 다음 작업 때 진행합니다" : rv[ii] ? "기록했습니다" : "답을 지웠습니다"); return; }
    if (a === "ideacopy" && x) { var dd = x.ideas[+t.getAttribute("data-i")]; copyText("[필투두 아이디어] " + x.id + " #" + t.getAttribute("data-i") + "\n어디서: " + x.title + "\n" + (dd.t === "아이디어" ? "아이디어" : "실장 제안") + ": " + dd.text + "\n\n내 생각: ").then(function () { toast("복사했습니다 — 새 대화창에 붙여넣고 생각을 적어 주세요"); }); return; }
    if (a === "ckseen" && x) {
      if (x.status === "done") { setUser(id, { status: "todo", doneAt: null, doneBy: null }); toast("안 읽은 것으로 돌렸습니다"); }
      else { S.open[id] = false; setUser(id, { status: "done", doneAt: nowIso(), doneBy: "사장님" }); badge(); toast("확인했습니다", { label: "되돌리기", fn: function () { setUser(id, { status: "todo", doneAt: null, doneBy: null }); badge(); } }); }
      return;
    }
    if (a === "ckall") {
      var f0 = S.ckbiz || "전체", ids = newChecks().filter(function (c) { return c.lv !== 1 && (f0 === "전체" || bizOf(c) === f0); }).map(function (c) { return c.id; });
      ids.forEach(function (cid) { setUser(cid, { status: "done", doneAt: nowIso(), doneBy: "사장님" }, true); });
      render(); badge(); toast("알림 " + ids.length + "건을 확인했습니다", { label: "되돌리기", fn: function () { ids.forEach(function (cid) { setUser(cid, { status: "todo", doneAt: null, doneBy: null }, true); }); render(); badge(); } });
      return;
    }
    if (a === "ckcopy" && x) { copyText(ckText(x)).then(function () { toast("복사했습니다 — 새 대화창에 붙여넣고 생각을 적어 주세요"); }); return; }
    if (a === "req" && x) { copyText(reqText(x)).then(function () { toast("복사했습니다 — 새 대화창에 붙여넣고 '고칠 점'만 적어 주세요"); }); return; }
    if (a === "para" && x) { copyText("[필투두 수정 요청] " + x.id + "\n할 일: " + x.title + "\n고칠 문단: " + x.steps[+t.getAttribute("data-i")] + "\n\n고칠 점: ").then(function () { toast("이 문단을 복사했습니다 — 새 대화창에 붙여넣고 고칠 점을 적어 주세요"); }); return; }
    if (a === "img") { copyImage(t.getAttribute("data-p")); return; }
    if (a === "folder") { openFolder(t.getAttribute("data-p")); return; }
    if (a === "zoom") { var z = document.createElement("div"); z.className = "zoom"; z.innerHTML = '<img src="' + esc(t.getAttribute("data-src")) + '">'; z.onclick = function () { z.remove(); }; document.body.appendChild(z); return; }
    if (a === "pick" && x) { var o = x.choice.opts[+t.getAttribute("data-i")], an = Object.assign({}, x.answer || {}); an.pick = an.pick === o ? null : o; an.at = nowIso(); setUser(id, { answer: an }); S.open[id] = true; render(); toast(an.pick ? "답을 저장했습니다 — 할 일을 다 마치면 맨 아래 [✓ 했어요]를 눌러 주세요" : "고른 답을 지웠습니다"); return; }   // 11-22 사장님(원장 261122-45): 결정·답은 저장만 — '한 일'로는 [✓ 했어요]로만 넘어간다
    if (a === "rsearch") { remoteSearch(t.getAttribute("data-k")); return; }
    if (a === "sync") { doSync(); return; }
    if (a === "logout") { logout(); return; }
    if (a === "login") {
      var em = ($("#em").value || "").trim(), pw = $("#pw").value || "";
      if (!em || !pw) { msg("이메일과 비밀번호를 넣어 주세요."); return; }
      msg("로그인 중…");
      api("/auth/v1/token?grant_type=password", { method: "POST", body: { email: em, password: pw } }).then(function (j) { setSess(j); LS.set("expired", null); var nb = restorePend(); S.view = "todo"; LS.set("view", "todo"); render(); doSync(); if (nb) toast("지난번에 못 올린 것 " + nb + "건을 다시 올립니다"); }, function (e) { msg("로그인 실패: " + koErr(e.message)); });
    }
  });
  document.addEventListener("change", function (ev) {
    var t = ev.target, a = t.getAttribute("data-act"), id = t.getAttribute("data-id"), x = id && S.items[id];
    if (t.id === "dmonth") { S.dmonth = t.value; if (S.remote.done) remoteSearch("done"); else render(); return; }
    if (t.id === "kmonth") { S.kmonth = t.value; if (S.remote.log) remoteSearch("log"); else render(); return; }
    if (!x) return;
    if (a === "url" || a === "note" || a === "ans") { var dkey = dk(a, id, a === "url" ? t.getAttribute("data-k") : ""); if (S.drafts[dkey] != null) { delete S.drafts[dkey]; LS.set("drafts", S.drafts); markSave(); } }
    if (a === "step") { var ck = Object.assign({}, x.checks || {}); ck[t.getAttribute("data-i")] = t.checked; setUser(id, { checks: ck }); return; }
    if (a === "url") { var u = Object.assign({}, x.urls || {}); u[t.getAttribute("data-k")] = t.value.trim(); setUser(id, { urls: u }); savedToast(t.getAttribute("data-q") ? "답을 저장했습니다 — 할 일을 다 마치면 맨 아래 [✓ 했어요]를 눌러 주세요" : "주소를 저장했습니다"); return; }
    if (a === "note") { setUser(id, { note: t.value }, true); savedToast("메모를 저장했습니다"); return; }
    if (a === "ans") { var an = Object.assign({}, x.answer || {}); an.text = t.value.trim(); an.at = nowIso(); setUser(id, { answer: an }); savedToast("답을 저장했습니다 — 할 일을 다 마치면 맨 아래 [✓ 했어요]를 눌러 주세요"); return; }   // 11-22 저장만(원장 261122-45)
  });
  document.addEventListener("toggle", function (ev) { var s = ev.target.getAttribute && ev.target.getAttribute("data-sec"); if (s) S.open["sec_" + s] = ev.target.open; var s2 = ev.target.getAttribute && ev.target.getAttribute("data-isec"); if (s2) S.open["isec_" + s2] = ev.target.open; var s3 = ev.target.getAttribute && ev.target.getAttribute("data-cp"); if (s3) { if (ev.target.open) S.open["cp|" + s3] = true; else delete S.open["cp|" + s3]; } if (s || s2 || s3) LS.set("open", S.open); }, true);
  var st = 0;
  var frt = 0;
  /* 찾기 칸 글자 → 찾기 화면. 글자를 칠 때(input)·한글 조합이 끝날 때(compositionend)·Enter 때 모두 같은 길로 (원장 261121-50) */
  function fqSet(v) {
    S.fq = v; S.fk = S.fk || "전체";
    if (S.fq.trim()) { if (S.view !== "find") { S.fprev = S.view; S.view = "find"; S.fk = "전체"; window.scrollTo(0, 0); } }
    else if (S.view === "find") { S.view = S.fprev || "todo"; }
    clearTimeout(frt); frt = setTimeout(render, 120);
    clearTimeout(ftm); if (terms(S.fq).join("").length >= 2) ftm = setTimeout(findRemote, 550);
  }
  document.addEventListener("compositionend", function (ev) {
    var t = ev.target; if (!t) return;
    if (t.id === "fq") return fqSet(t.value);
    if (t.id === "dq" || t.id === "kq") { S[t.id] = t.value; clearTimeout(st); st = setTimeout(function () { var pos = t.selectionStart; render(); var n = $("#" + t.id); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) { } } }, 350); }
  });
  document.addEventListener("input", function (ev) {
    var t = ev.target;
    if (t.id === "fq") { fqSet(t.value); return; }  // 머리글 찾기 칸 — 머리글은 다시 그리지 않으니 글자를 치는 중에도 칸이 그대로다
    var da = t.getAttribute && t.getAttribute("data-act");
    if (da === "url" || da === "note" || da === "ans") {  // 치는 동안 이 기기에 바로 남긴다 — 갑자기 닫혀도 다시 열면 그대로
      S.drafts[dk(da, t.getAttribute("data-id"), da === "url" ? t.getAttribute("data-k") : "")] = t.value; LS.set("drafts", S.drafts); markSave(); return;
    }
    if (t.id !== "dq" && t.id !== "kq") return;
    S[t.id] = t.value; clearTimeout(st);
    if (ev.isComposing || ev.inputType === "insertCompositionText") return;  // 한글 조합 중에는 다시 그리지 않는다(자모가 낱자로 떨어짐) — 조합이 끝나면 compositionend 가 다시 그린다
    st = setTimeout(function () { var pos = t.selectionStart; render(); var n = $("#" + t.id); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) { } } }, 350);
  });
  document.addEventListener("keydown", function (ev) {
    var tg = ev.target, typing = /^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName || "") || tg.isContentEditable;
    if (tg.id === "fq") {
      /* 한글 입력 중(조합 중) Enter 는 글자를 확정하는 키 — 이때 칸을 빠져나가면 마지막 글자가 안 들어가 찾기가 안 됐다 (원장 261121-50) */
      if (ev.key === "Enter" && !ev.isComposing && ev.keyCode !== 229) { ev.preventDefault(); fqSet(tg.value); findRemote(); }
      if (ev.key === "Escape") { var back = S.view === "find" ? (S.fprev || "todo") : S.view; clearFind(); S.view = back; render(); tg.blur(); }
      return;
    }
    if (!typing && (ev.key === "/" || ((ev.ctrlKey || ev.metaKey) && (ev.key === "k" || ev.key === "K")))) { var fi = $("#fq"); if (fi) { ev.preventDefault(); fi.focus(); fi.select(); } return; }
    if (ev.key === "Enter" && (ev.target.id === "dq" || ev.target.id === "kq")) remoteSearch(ev.target.id === "dq" ? "done" : "log"); if (ev.key === "Enter" && ev.target.id === "pw") { var b = document.querySelector('[data-act="login"]'); if (b) b.click(); } });
  document.addEventListener("visibilitychange", function () { if (document.hidden) saveUi(); else { doSync(); render(); } });
  window.addEventListener("pagehide", saveUi);
  window.addEventListener("focus", function () { doSync(); });
  setInterval(function () { if (!document.hidden) doSync(); }, 60000);

  /* ---------- 맨 윗줄: 사장님 비즈니스 칸 (config.js PT_BIZ) ---------- */
  var BIZ_ICON = {
    plane: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z"/></svg>'
  };
  function renderBiz() {
    var bar = $("#bizbar"), L = window.PT_BIZ || []; if (!bar) return;
    var on = LS.get("biz", L[0] && L[0].id);
    if (!L.some(function (b) { return b.id === on; }) && L[0]) on = L[0].id;
    bar.innerHTML = L.map(function (b) {
      return '<button type="button" class="biz' + (b.id === on ? " on" : "") + '" data-biz="' + esc(b.id) + '"' + (b.id === on ? ' aria-current="true"' : "") + ">" + (BIZ_ICON[b.icon] || '<i class="dot"></i>') + esc(b.name) + "</button>";
    }).join("") +
      // 맨 윗줄 제일 오른쪽 = [체크] — 사업 칸이 몇 개가 되든 모든 사업의 클실장 보고를 여기서 한 번에(원장 261120-07)
      '<button type="button" class="chkbtn" id="chkBtn" data-view="check"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M7.5 12.3l3 3 6-6.3" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>체크<b id="navChk"></b></button>';
    chkBtn();
  }
  document.addEventListener("click", function (ev) {
    var b = ev.target.closest("[data-biz]"); if (!b) return;
    LS.set("biz", b.getAttribute("data-biz")); renderBiz();
  });

  window.PT_BUILD = window.PT_BUILD || (typeof PT_BUILD !== "undefined" ? PT_BUILD : "");
  if (sess) restorePend();   // 지난번에 못 올린 것(저장 공간 부족 등)부터 되살린다
  renderBiz(); render(); markSave(); checkLocal(); if (sess) doSync(); badge();
  window.addEventListener("online", function () { render(); doSync(); });   // 인터넷이 다시 되면 바로 올린다
  window.addEventListener("offline", function () { render(); });   // 끊기면 맨 위 띠(PT-17)
  (function () { var sy = LS.get("scroll", 0); if (sy > 0) setTimeout(function () { window.scrollTo(0, sy); }, 60); })();  // 저장해 둔 보던 자리로
})();
