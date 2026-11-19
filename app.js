/* 필투두 — 사장님 할 일·한 일, 클실장 할 일·한 일을 한곳에서.
   데이터: Supabase pt_items(행 하나 = 할 일 하나, 내용은 data). 클실장 몫 칸과 사장님 몫 칸(체크·메모·주소·답·미루기)을 나눠
   서로 덮어쓰지 않게 합친다. 이 기기에는 열린 일 + 최근 60일만 두고, 지난 일은 검색할 때 서버에서 가져온다(용량 차지 없음). */
(function () {
  "use strict";
  var CFG = window.PT_CONFIG || {}, SB = !!(CFG.url && CFG.key && window.fetch);
  var USER_KEYS = ["status", "note", "doneAt", "doneBy", "snoozeTo", "answer", "urls", "checks", "react", "uu"];
  var CATS = [["올리기", "콘텐츠 올리기", "#e8590c"], ["수정", "올린 글 고치기", "#1c7ed6"], ["판단", "결정해 주실 것", "#7048e8"],
    ["설정", "카페·사이트 설정", "#0ca678"], ["연락", "업체 연락·확인", "#d6336c"], ["확인", "확인·점검", "#5c677d"], ["기타", "기타", "#868e96"]];
  var CAT = {}; CATS.forEach(function (c) { CAT[c[0]] = { label: c[1], color: c[2] }; });
  var KEEP_DAYS = 60;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  var LS = {
    get: function (k, d) { try { var v = localStorage.getItem("pt_" + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem("pt_" + k, JSON.stringify(v)); } catch (e) { } }
  };
  var S = {
    items: LS.get("items", {}), dirty: LS.get("dirty", {}), since: LS.get("since", ""), view: LS.get("view", "todo"),
    cat: LS.get("cat", "전체"), mode: LS.get("mode", "all"), open: LS.get("open", {}), drafts: LS.get("drafts", {}), msg: "", busy: false, local: false,
    dq: "", dmonth: "", karea: "전체", kq: "", kmonth: "", remote: { done: null, log: null }, rbusy: false,
    fq: "", fk: "전체", fprev: "todo", fr: null, fbusy: false
  };
  var sess = LS.get("sess", null);
  function save() { LS.set("items", S.items); LS.set("dirty", S.dirty); LS.set("since", S.since); }
  /* ---------- 💾 저장(2026-11-19 사장님, 원장 261119-110): 하다 만 입력·펼친 카드·보던 자리를 그대로 남겨 언제 다시 열어도 이어서 ---------- */
  function dk(act, id, k) { return act + "|" + id + "|" + (k || ""); }
  function draftOf(act, id, k, saved) { var v = S.drafts[dk(act, id, k)]; return v != null ? v : saved; }
  function saveUi() { LS.set("open", S.open); LS.set("cat", S.cat); LS.set("view", S.view === "find" ? (S.fprev || "todo") : S.view); LS.set("mode", S.mode); LS.set("scroll", window.scrollY || 0); LS.set("drafts", S.drafts); }
  function markSave() {
    var b = document.getElementById("saveBtn"); if (!b) return;
    var n = Object.keys(S.drafts).length;
    b.classList.toggle("dirty", n > 0);
    b.textContent = n ? "💾 저장 (" + n + ")" : "💾 저장";
    b.title = n ? "아직 서버에 안 올라간 입력 " + n + "개 — 누르면 저장" : "지금 화면(체크·입력·펼친 카드·보던 자리) 저장";
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

  /* ---------- 합치기(동기화) ---------- */
  function merge(l, r) {
    if (!l) return r; if (!r) return l;
    var base = (r.u || 0) >= (l.u || 0) ? r : l, us = (l.uu || 0) >= (r.uu || 0) ? l : r, o = {};
    Object.keys(base).forEach(function (k) { o[k] = base[k]; });
    USER_KEYS.forEach(function (k) { if (us[k] === undefined) delete o[k]; else o[k] = us[k]; });
    o.u = Math.max(l.u || 0, r.u || 0);
    return o;
  }
  function setUser(id, patch, quiet) {
    var x = S.items[id]; if (!x) return;
    Object.keys(patch).forEach(function (k) { if (patch[k] === null) delete x[k]; else x[k] = patch[k]; });
    x.uu = Date.now(); x.u = Date.now(); S.dirty[id] = 1; save();
    if (!quiet) render();
    syncSoon();
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
    return api("/auth/v1/token?grant_type=refresh_token", { method: "POST", body: { refresh_token: sess.refresh_token } }).then(setSess, function (e) { if (e.status === 400 || e.status === 401) { setSess(null); render(); } throw e; });
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
  function doSync() {
    if (!SB || !sess || S.busy) return Promise.resolve();
    S.busy = true; msg("동기화 중…");
    var first = !S.since, q;
    if (first) q = "&or=(" + encodeURIComponent("data->>status.eq.todo,updated_at.gt.\"" + new Date(Date.now() - KEEP_DAYS * 864e5).toISOString() + "\"") + ")";
    else q = "&updated_at=gt." + encodeURIComponent(new Date(Date.parse(S.since) - 5000).toISOString());
    var got = 0, fresh0 = 0;
    return fresh().then(function () { return pullPage(q, 0, []); }).then(function (rows) {
      rows.forEach(function (row) {
        var r = row.data, l = S.items[row.id];
        if (!l && r.kind !== "log" && (r.t0 || 0) > Date.now() - 864e5) fresh0++;
        var m = merge(l, r);
        if (JSON.stringify(m) !== JSON.stringify(r)) S.dirty[row.id] = 1;
        if (!l || JSON.stringify(l) !== JSON.stringify(m)) got++;
        S.items[row.id] = m;
        if (!S.since || row.updated_at > S.since) S.since = row.updated_at;
      });
      if (!S.since) S.since = nowIso();
      prune(); save();
      var ids = Object.keys(S.dirty).filter(function (id) { return S.items[id]; });
      if (!ids.length) return 0;
      var body = ids.map(function (id) { return { user_id: sess.user.id, id: id, data: S.items[id] }; });
      return api("/rest/v1/pt_items?on_conflict=user_id,id", { method: "POST", auth: true, prefer: "resolution=merge-duplicates,return=minimal", body: body }).then(function () {
        ids.forEach(function (id) { delete S.dirty[id]; }); save(); return ids.length;
      });
    }).then(function (sent) {
      S.busy = false;
      msg("동기화 완료 " + new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) + " · 받은 것 " + got + " · 보낸 것 " + sent);
      if (got) { render(); if (fresh0 && !first) toast("클실장이 새 할 일 " + fresh0 + "건을 올렸습니다"); }
      badge(); outbox();
    }).catch(function (e) { S.busy = false; msg("동기화 실패: " + koErr(e.message || String(e))); });
  }
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
        var now = Date.now(), nNew = 0;
        items.forEach(function (x) {
          if (!x || !x.id) return;
          var l = S.items[x.id], o = l ? Object.assign({}, l) : {};
          if (!l && !x.title) return; // 없는 할 일에 완료 표시만 온 경우는 건너뛴다
          Object.keys(x).forEach(function (k) { if (k === "force") return; if (l && (USER_KEYS.indexOf(k) >= 0 || k === "t0")) return; o[k] = x[k]; });
          if (!l) { if (o.kind !== "log" && o.kind !== "sess" && !o.status) o.status = "todo"; o.t0 = o.t0 || now; if (o.kind === "task") nNew++; }
          if (x.force) { Object.keys(x.force).forEach(function (k) { o[k] = x.force[k]; }); o.uu = now; }
          o.u = now; S.items[x.id] = o; S.dirty[x.id] = 1;
        });
        save(); render();
        return fetch("/api/outbox/ack", { method: "POST", headers: { "Content-Type": "application/json", "X-PT": "1" }, body: JSON.stringify({ files: files.map(function (f) { return f.name; }) }) }).then(function () {
          obusy = false; if (nNew) toast("클실장이 새 할 일 " + nNew + "건을 올렸습니다"); doSync();
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
    var n = list().filter(function (x) { var b = bucket(x); return b === "late" || b === "today"; }).length;
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
    var u = x.urls || {}; Object.keys(u).forEach(function (k) { F.push(["올린 주소", u[k]]); });
    if (x.choice) F.push(["결정", (x.choice.q || "") + " " + (x.choice.opts || []).join(" / ")]);
    (x.links || []).concat(x.images || []).forEach(function (l) { F.push(["파일", (l.label || "") + " " + (l.path || l.url || "")]); });
    (x.fields || []).forEach(function (f) { F.push(["주소 칸", f.label]); });
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
    var KO = { ktask: 0, sess: 1, log: 2 };
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
      var KN = { ktask: "클실장 맡은 일", sess: "세션 정리", log: "클실장이 한 일" };
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
    fetch("/api/ping", { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (j) { S.local = !!j.ok; render(); }).catch(function () { });
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
    if (!S.local) { toast("사진 복사는 PC 필투두에서 됩니다(폰은 길게 눌러 저장)"); return; }
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
    var h = v === "find" ? viewFind() : v === "done" ? viewDone() : v === "kl" ? viewKl() : v === "set" ? viewSet() : v === "idea" ? viewIdeas() : viewTodo();
    var ni = $("#navIdea"); if (ni) { var fi = sess ? freshIdeas().length : 0; ni.textContent = fi; ni.style.display = fi ? "" : "none"; }
    $("#app").innerHTML = h;
    $("#ver").textContent = "필투두 " + (window.PT_BUILD || "") + (S.local ? " · PC 도우미 연결됨" : "");
  }
  function needLogin() {
    return '<div class="card"><h2>로그인하면 할 일이 보입니다</h2><p class="note">필보드와 같은 이메일·비밀번호로 한 번만 로그인하면 이 기기에 계속 남습니다. 클실장이 올린 할 일과 사장님 체크가 PC·폰에 같이 보입니다.</p><button class="btn" data-view="set">로그인하러 가기</button></div>';
  }

  function viewTodo() {
    if (!sess) return needLogin();
    var all = list(), td = today();
    var must = all.filter(function (x) { var b = bucket(x); return b === "late" || b === "today"; });
    var mins = must.reduce(function (a, x) { return a + (x.mins || 0); }, 0);
    var dec = all.filter(function (x) { return x.cat === "판단" && bucket(x) !== "snooze"; }).length;
    var doneToday = Object.keys(S.items).map(function (k) { return S.items[k]; }).filter(function (x) { return x.kind === "task" && x.status === "done" && (x.doneAt || "").slice(0, 10) === td; }).length;
    var h = '<div class="sum"><div><b>' + all.length + '</b><span>남은 일 전체</span></div><div class="hot"><b>' + must.length + "</b><span>오늘 꼭" + (mins ? " · 약 " + mins + "분" : "") + '</span></div><div><b>' + dec + '</b><span>결정 기다리는 것</span></div><div><b>' + doneToday + '</b><span>오늘 끝낸 일</span></div><div class="idea-tile" data-view="idea"><b>💡 ' + freshIdeas().length + '</b><span>새 제안·아이디어 보기</span></div></div>';
    h += '<div class="mode"><button data-mode="all" class="' + (S.mode === "all" ? "on" : "") + '">전체 보기</button><button data-mode="must" class="' + (S.mode === "must" ? "on" : "") + '">시간 없을 때 — 꼭 할 것만</button></div>';
    var pool = S.mode === "must" ? must : all, counts = {};
    pool.forEach(function (x) { counts[x.cat] = (counts[x.cat] || 0) + 1; });
    h += '<div class="chips"><button class="chip' + (S.cat === "전체" ? " on" : "") + '" data-cat="전체">전체 ' + pool.length + "</button>" +
      CATS.filter(function (c) { return counts[c[0]]; }).map(function (c) { return '<button class="chip' + (S.cat === c[0] ? " on" : "") + '" data-cat="' + c[0] + '">' + c[1] + " " + counts[c[0]] + "</button>"; }).join("") + "</div>";
    var shown = pool.filter(function (x) { return S.cat === "전체" || x.cat === S.cat; });
    if (!shown.length) h += '<div class="empty">' + (all.length ? "이 조건에 남은 일이 없습니다." : "남은 일이 없습니다. 수고하셨습니다.") + "</div>";
    BUCKETS.forEach(function (b) {
      if (S.mode === "must" && b[0] !== "late" && b[0] !== "today") return;
      var xs = shown.filter(function (x) { return bucket(x) === b[0]; }).sort(sorter);
      if (!xs.length) return;
      h += '<div class="sec ' + b[0] + '"><h2>' + b[1] + '</h2><span class="cnt">' + xs.length + "건 · " + b[2] + "</span></div>";
      if (b[0] === "snooze" || b[0] === "later") h += "<details" + (S.open["sec_" + b[0]] ? " open" : "") + ' data-sec="' + b[0] + '"><summary class="note">펼쳐 보기</summary>' + xs.map(card).join("") + "</details>";
      else h += xs.map(card).join("");
    });
    if (S.mode === "must" && all.length > must.length) h += '<p class="note" style="text-align:center;margin-top:14px">나머지 ' + (all.length - must.length) + '건은 미뤄 두셔도 됩니다. <button class="btn sm ghost" data-mode="all">전체 보기</button></p>';
    return h;
  }
  function sorter(a, b) { return (a.due || "9999").localeCompare(b.due || "9999") || (a.pri || 3) - (b.pri || 3) || (a.order || 0) - (b.order || 0) || (a.t0 || 0) - (b.t0 || 0); }

  function card(x) {
    var op = !!S.open[x.id], td = today(), done = x.status === "done";
    var isNew = !done && (x.t0 || 0) > Date.now() - 864e5;
    var h = '<div class="card task' + (done ? " done" : "") + '" id="c_' + esc(x.id) + '"><div class="head"><button class="chk" data-act="toggle" data-id="' + esc(x.id) + '" title="했어요">✓</button><div class="grow" data-act="expand" data-id="' + esc(x.id) + '">';
    h += '<div class="t">' + (isNew ? '<span class="badge new">새</span> ' : "") + (x.status === "cancel" ? '<span class="badge">취소됨</span> ' : "") + mark(esc(x.title)) + "</div>";
    h += '<div class="meta">' + catChip(x.cat) + (x.due ? '<span class="due' + (x.due < td && !done ? " late" : "") + '">' + (x.due < td && !done ? "기한 지남 " : "") + md(x.due) + (x.dueNote ? " " + esc(x.dueNote) : "") + "</span>" : "") +
      (x.mins ? "<span>약 " + x.mins + "분</span>" : "") + (x.biz ? "<span>" + esc(x.biz) + "</span>" : "") + (x.snoozeTo && x.snoozeTo > td ? "<span>" + md(x.snoozeTo) + "까지 미룸</span>" : "") +
      (x.answer ? '<span class="badge">답함</span>' : "") + (x.ideas && x.ideas.length ? '<span class="badge idea">💡 제안·아이디어 ' + x.ideas.length + "</span>" : "") + "</div>";
    if (x.why) h += '<div class="why">' + mark(esc(x.why)) + "</div>";
    if (S.view === "find") h += snip(x);
    h += "</div></div>";
    if (op) h += body(x);
    return h + "</div>";
  }
  function body(x) {
    var id = esc(x.id), h = '<div class="body">' + ideasBox(x);
    if (x.steps && x.steps.length) {
      var ck = x.checks || {};
      h += "<h3>순서</h3><ol class=\"steps\">" + x.steps.map(function (s, i) { return '<li class="' + (ck[i] ? "ok" : "") + '"><input type="checkbox" data-act="step" data-id="' + id + '" data-i="' + i + '"' + (ck[i] ? " checked" : "") + '><span class="grow">' + mark(linkify(s)) + '</span><button class="pc" data-act="para" data-id="' + id + '" data-i="' + i + '" title="이 문단만 복사해 클실장에게 고쳐 달라고 하기">⧉</button></li>'; }).join("") + "</ol>";
    }
    if (x.links && x.links.length) {
      h += "<h3>바로 열기</h3><div class=\"btns\">" + x.links.map(function (l) {
        if (l.url) return '<a class="btn ghost" target="_blank" rel="noopener" href="' + esc(l.url) + '">' + esc(l.label) + " ↗</a>";
        return '<a class="btn' + (S.local ? "" : " ghost") + '" target="_blank" rel="noopener" href="' + esc(fileUrl(l.path)) + '">' + esc(l.label) + (S.local ? "" : " (PC)") + "</a>" +
          (S.local ? '<button class="btn sm ghost" data-act="folder" data-p="' + esc(l.path) + '" title="탐색기에서 열기">폴더</button>' : "");
      }).join("") + "</div>" + (S.local ? "" : '<p class="note">(PC) 표시는 PC에서 필투두 도우미가 켜져 있을 때 열립니다.</p>');
    }
    if (x.copies && x.copies.length) {
      h += "<h3>복사해서 붙여넣기</h3>" + x.copies.map(function (c, i) { return '<div class="copy"><div class="ch"><b>' + esc(c.label) + '</b><button class="btn sm" data-act="copy" data-id="' + id + '" data-i="' + i + '">복사</button></div><pre>' + mark(esc(c.text)) + "</pre></div>"; }).join("");
    }
    if (x.images && x.images.length) {
      h += "<h3>사진 — [복사] 누르고 바로 붙여넣기</h3><div class=\"imgs\">" + x.images.map(function (m) {
        return '<div class="img">' + (S.local ? '<div class="ph" data-act="zoom" data-src="' + esc(fileUrl(m.path)) + '" style="background-image:url(\'' + esc(fileUrl(m.path)).replace(/'/g, "%27") + '\')"></div>' : '<div class="noimg">사진은 PC 필투두에서 보입니다</div>') +
          '<div class="cap">' + esc(m.label || m.path.split("/").pop()) + '</div><div class="btns"><button class="btn sm' + (S.local ? "" : " off") + '" data-act="img" data-p="' + esc(m.path) + '">복사</button>' + (S.local ? '<button class="btn sm ghost" data-act="folder" data-p="' + esc(m.path) + '">폴더</button>' : "") + "</div></div>";
      }).join("") + "</div>";
    }
    if (x.fields && x.fields.length) {
      var u = x.urls || {};
      h += "<h3>올린 뒤 주소 넣기 — 클실장이 읽고 등록부·링크를 채웁니다</h3>" + x.fields.map(function (f) {
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
    h += '<div class="foot2">' + (x.status === "done" ? '<button class="btn sm ghost" data-act="toggle" data-id="' + id + '">다시 할 일로</button>' :
      '<button class="btn ok" data-act="toggle" data-id="' + id + '">✓ 했어요</button><button class="btn sm ghost" data-act="snooze" data-n="1" data-id="' + id + '">내일로</button><button class="btn sm ghost" data-act="snooze" data-n="7" data-id="' + id + '">다음 주로</button>' +
      (x.snoozeTo ? '<button class="btn sm ghost" data-act="unsnooze" data-id="' + id + '">미루기 취소</button>' : "")) +
      '<span class="src">' + (x.src ? "출처: " + esc(x.src) : "") + (x.after ? (x.src ? " · " : "") + "끝나면 클실장이: " + esc(x.after) : "") + "</span></div>";
    return h + "</div>";
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
  function freshIdeas() { return allIdeas().filter(function (e) { return !e.r && e.x.status !== "cancel" && !(e.x.kind === "task" && e.x.status === "done"); }); }
  function viewIdeas() {
    if (!sess) return needLogin();
    var all = allIdeas(), f = S.ifilter || "전체";
    var shown = all.filter(function (e) { return f === "전체" || (f === "아이디어" ? e.d.t === "아이디어" : e.d.t !== "아이디어"); });
    var h = '<h1>💡 클실장 제안·아이디어</h1><p class="note" style="margin-top:-4px">일마다 클실장이 낸 제안과 아이디어를 모았습니다. [좋아요, 진행해]를 누르시면 클실장이 다음 작업 때 바로 진행하고, 더 얘기하고 싶으면 ⧉로 복사해 새 대화창에 붙여넣으세요.</p>';
    h += '<div class="chips">' + ["전체", "아이디어", "제안"].map(function (c) { return '<button class="chip' + (f === c ? " on" : "") + '" data-ifilter="' + c + '">' + (c === "아이디어" ? "💡 아이디어" : c === "제안" ? "실장 제안" : "전체") + "</button>"; }).join("") + "</div>";
    [["", "새로 온 것", "아직 답하지 않은 것"], ["진행", "진행하기로 한 것", "클실장이 진행합니다"], ["보류", "나중에", ""], ["안 함", "안 하기로 한 것", ""]].forEach(function (g) {
      var xs = shown.filter(function (e) { return (e.r || "") === g[0] && (g[0] || !(e.x.kind === "task" && e.x.status === "done")); });
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
    var files = (x.links || []).concat(x.images || []).map(function (l) { return l.path || l.url; }).filter(Boolean);
    if (files.length) L.push("관련 파일: " + files.join(" , "));
    if (x.src) L.push("출처: " + x.src);
    if (x.note) L.push("내 메모: " + x.note);
    return L.join("\n") + "\n\n고칠 점: ";
  }
  function linkify(s) { return esc(s).replace(/https?:\/\/[^\s)]+/g, function (u) { return '<a href="' + u + '" target="_blank" rel="noopener">' + u + "</a>"; }); }

  function months(arr, key) { var m = {}; arr.forEach(function (x) { var d = (x[key] || "").slice(0, 7); if (d) m[d] = 1; }); return Object.keys(m).sort().reverse(); }
  function viewDone() {
    if (!sess) return needLogin();
    var loc = Object.keys(S.items).map(function (k) { return S.items[k]; }).filter(function (x) { return x.kind === "task" && x.status === "done"; });
    var src = S.remote.done || loc, seen = {}, rows = [];
    src.concat(loc).forEach(function (x) { if (seen[x.id]) return; seen[x.id] = 1; if (S.dmonth && (x.doneAt || "").slice(0, 7) !== S.dmonth) return; if (S.dq && (x.title || "").toLowerCase().indexOf(S.dq.toLowerCase()) < 0) return; rows.push(x); });
    rows.sort(function (a, b) { return (b.doneAt || "").localeCompare(a.doneAt || ""); });
    var ms = months(src.concat(loc), "doneAt"); if (ms.indexOf(ymd().slice(0, 7)) < 0) ms.unshift(ymd().slice(0, 7));
    var h = '<h1>사장님이 한 일</h1><div class="card"><div class="grid2"><input class="search" id="dq" placeholder="제목으로 찾기" value="' + esc(S.dq) + '"><select id="dmonth"><option value="">모든 달</option>' + ms.map(function (m) { return '<option value="' + m + '"' + (S.dmonth === m ? " selected" : "") + ">" + m.replace("-", "년 ") + "월</option>"; }).join("") + '</select></div><p class="note" style="margin:6px 0 0">이 기기에는 최근 ' + KEEP_DAYS + '일만 둡니다. 그보다 오래된 일은 <button class="btn sm ghost" data-act="rsearch" data-k="done">서버에서 찾기</button>' + (S.rbusy ? " 찾는 중…" : "") + "</p></div>";
    if (!rows.length) return h + '<div class="empty">끝낸 일이 없습니다.</div>';
    var last = "";
    h += '<div class="card list">' + rows.map(function (x) {
      var d = (x.doneAt || "").slice(0, 10), u = x.urls || {}, links = Object.keys(u).filter(function (k) { return u[k]; }).map(function (k) { return '<a href="' + esc(u[k]) + '" target="_blank" rel="noopener">' + esc(((x.fields || []).filter(function (f) { return f.key === k; })[0] || { label: k }).label) + "</a>"; });
      var r = '<div class="row1"><div class="d">' + (d !== last ? md(d) : "") + '</div><div class="grow"><span class="area">' + esc((CAT[x.cat] || CAT["기타"]).label) + "</span>" + esc(x.title) + (links.length ? '<div class="note">' + links.join(" · ") + "</div>" : "") + (x.answer ? '<div class="note">답: ' + esc([x.answer.pick, x.answer.text].filter(Boolean).join(" / ")) + "</div>" : "") +
        '</div><button class="btn sm ghost" data-act="toggle" data-id="' + esc(x.id) + '">되돌리기</button></div>';
      last = d; return r;
    }).join("") + "</div>";
    return h;
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
    h += '<div class="card"><h2>클실장이 맡고 있는 일 ' + kt.length + "건</h2>" + (kt.length ? '<div class="list">' + kt.map(function (x) { return '<div class="row1"><div class="d">' + (x.due ? md(x.due) : "") + '</div><div class="grow"><span class="area">' + esc(x.area || "") + "</span>" + esc(x.title) + (x.why ? '<div class="note">' + esc(x.why) + "</div>" : "") + "</div></div>"; }).join("") + "</div>" : '<p class="note">지금 맡은 일이 없습니다.</p>') + "</div>";
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
    h += '<div class="card"><h2>폰에 설치</h2><p class="note">폰 크롬(아이폰은 사파리)에서 필투두 주소를 열고 메뉴 → [홈 화면에 추가]. 폰에서는 할 일 보기·체크·주소 넣기·결정이 되고, 폴더 사진 복사는 PC에서 합니다.</p></div>';
    h += '<div class="card"><h2>이 기기 저장</h2><p class="note">열린 일 + 최근 ' + KEEP_DAYS + "일만 이 기기에 둡니다(지금 " + Object.keys(S.items).length + "건). 지난 기록은 서버에 있어 맨 위 🔍 찾기나 [한 일]·[클실장]에서 찾으면 가져옵니다.</p></div>";
    h += '<div class="card"><h2>🔍 찾기</h2><p class="note">맨 위 칸에 낱말을 넣으면 할 일·한 일·💡 아이디어·클실장 기록을 한 번에 찾습니다. 제목뿐 아니라 순서·복사 문구·메모·내 답·올린 주소까지 보고, 낱말을 띄어 여러 개 넣으면 모두 들어간 것만 나옵니다. 날짜(11/19·11월)로도 찾습니다. PC에서는 <b>/</b> 키를 누르면 바로 찾기 칸으로 갑니다.</p></div>';
    h += '<div class="card"><h2>💾 저장</h2><p class="note">하다가 멈춰야 할 때 맨 위 <b>[💾 저장]</b>을 누르면 체크·주소·메모와 펼쳐 둔 카드, 보던 자리까지 그대로 남아 다음에 열면 이어서 하실 수 있습니다. 주소·메모는 서버에도 올라가 PC·폰 어디서 열어도 같습니다. 칸에 치는 글은 누르지 않아도 이 기기에 바로 남고, 아직 서버에 안 올라간 것이 있으면 버튼이 금색으로 바뀌고 개수가 보입니다. 쓰다 만 「직접 답하기」는 보내면 완료가 되므로 저장해도 이 기기에만 남겨 둡니다.</p></div>';
    return h;
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
    var t = ev.target.closest("[data-view],[data-mode],[data-cat],[data-karea],[data-ifilter],[data-fk],[data-act]"); if (!t) return;
    if (t.hasAttribute("data-ifilter")) { S.ifilter = t.getAttribute("data-ifilter"); render(); return; }
    if (t.hasAttribute("data-fk")) { S.fk = t.getAttribute("data-fk"); render(); return; }
    if (t.hasAttribute("data-view")) { clearFind(); S.view = t.getAttribute("data-view"); LS.set("view", S.view); render(); window.scrollTo(0, 0); return; }
    if (t.hasAttribute("data-mode")) { S.mode = t.getAttribute("data-mode"); LS.set("mode", S.mode); render(); return; }
    if (t.hasAttribute("data-cat")) { S.cat = t.getAttribute("data-cat"); LS.set("cat", S.cat); render(); return; }
    if (t.hasAttribute("data-karea")) { S.karea = t.getAttribute("data-karea"); if (S.remote.log) remoteSearch("log"); else render(); return; }
    var a = t.getAttribute("data-act"), id = t.getAttribute("data-id"), x = id && S.items[id];
    if (a === "saveall") { saveAll(); return; }
    if (id && !x) { [S.remote.done, S.remote.log, S.fr && S.fr.rows].forEach(function (arr) { (arr || []).forEach(function (r) { if (r.id === id) x = S.items[id] = r; }); }); }
    if (a === "expand") { S.open[id] = !S.open[id]; LS.set("open", S.open); render(); return; }
    if (a === "goto") { ev.preventDefault(); clearFind(); S.view = "todo"; S.cat = "전체"; S.mode = "all"; S.open[id] = true; if (x && x.snoozeTo) S.open["sec_snooze"] = true; if (x && x.due && bucket(x) === "later") S.open["sec_later"] = true; render(); var el = document.getElementById("c_" + id); if (el) el.scrollIntoView({ block: "start" }); return; }
    if (a === "toggle" && x) {
      if (x.status === "done") { setUser(id, { status: "todo", doneAt: null, doneBy: null }); toast("다시 할 일로 돌렸습니다"); }
      else { var miss = (x.fields || []).filter(function (f) { return f.need && !((x.urls || {})[f.key]); }); setUser(id, { status: "done", doneAt: nowIso(), doneBy: "사장님" }); toast(miss.length ? "완료! 올린 주소도 넣어 주시면 클실장이 링크를 채웁니다" : "완료했습니다", { label: "되돌리기", fn: function () { setUser(id, { status: "todo", doneAt: null, doneBy: null }); } }); }
      return;
    }
    if (a === "snooze" && x) { var n = +t.getAttribute("data-n"); setUser(id, { snoozeTo: addDays(today(), n) }); S.open[id] = false; toast(md(addDays(today(), n)) + "로 미뤘습니다", { label: "되돌리기", fn: function () { setUser(id, { snoozeTo: null }); } }); return; }
    if (a === "unsnooze" && x) { setUser(id, { snoozeTo: null }); return; }
    if (a === "copy" && x) { copyText(x.copies[+t.getAttribute("data-i")].text); return; }
    if (a === "react" && x) { var rv = Object.assign({}, x.react || {}), ii = t.getAttribute("data-i"), vv = t.getAttribute("data-v"); if (rv[ii] === vv) delete rv[ii]; else rv[ii] = vv; setUser(id, { react: rv }); toast(rv[ii] === "진행" ? "좋습니다 — 클실장이 다음 작업 때 진행합니다" : rv[ii] ? "기록했습니다" : "답을 지웠습니다"); return; }
    if (a === "ideacopy" && x) { var dd = x.ideas[+t.getAttribute("data-i")]; copyText("[필투두 아이디어] " + x.id + " #" + t.getAttribute("data-i") + "\n어디서: " + x.title + "\n" + (dd.t === "아이디어" ? "아이디어" : "실장 제안") + ": " + dd.text + "\n\n내 생각: ").then(function () { toast("복사했습니다 — 새 대화창에 붙여넣고 생각을 적어 주세요"); }); return; }
    if (a === "req" && x) { copyText(reqText(x)).then(function () { toast("복사했습니다 — 새 대화창에 붙여넣고 '고칠 점'만 적어 주세요"); }); return; }
    if (a === "para" && x) { copyText("[필투두 수정 요청] " + x.id + "\n할 일: " + x.title + "\n고칠 문단: " + x.steps[+t.getAttribute("data-i")] + "\n\n고칠 점: ").then(function () { toast("이 문단을 복사했습니다 — 새 대화창에 붙여넣고 고칠 점을 적어 주세요"); }); return; }
    if (a === "img") { copyImage(t.getAttribute("data-p")); return; }
    if (a === "folder") { openFolder(t.getAttribute("data-p")); return; }
    if (a === "zoom") { var z = document.createElement("div"); z.className = "zoom"; z.innerHTML = '<img src="' + esc(t.getAttribute("data-src")) + '">'; z.onclick = function () { z.remove(); }; document.body.appendChild(z); return; }
    if (a === "pick" && x) { var o = x.choice.opts[+t.getAttribute("data-i")], an = Object.assign({}, x.answer || {}); an.pick = an.pick === o ? null : o; an.at = nowIso(); var fin = !!(an.pick || an.text); setUser(id, { answer: an, status: fin ? "done" : "todo", doneAt: fin ? nowIso() : null, doneBy: fin ? "사장님" : null }); S.open[id] = true; render(); if (fin) toast("결정을 보냈습니다 — 클실장이 반영합니다"); return; }
    if (a === "rsearch") { remoteSearch(t.getAttribute("data-k")); return; }
    if (a === "sync") { doSync(); return; }
    if (a === "logout") { setSess(null); S.items = {}; S.dirty = {}; S.since = ""; save(); render(); return; }
    if (a === "login") {
      var em = ($("#em").value || "").trim(), pw = $("#pw").value || "";
      if (!em || !pw) { msg("이메일과 비밀번호를 넣어 주세요."); return; }
      msg("로그인 중…");
      api("/auth/v1/token?grant_type=password", { method: "POST", body: { email: em, password: pw } }).then(function (j) { setSess(j); S.view = "todo"; LS.set("view", "todo"); render(); doSync(); }, function (e) { msg("로그인 실패: " + koErr(e.message)); });
    }
  });
  document.addEventListener("change", function (ev) {
    var t = ev.target, a = t.getAttribute("data-act"), id = t.getAttribute("data-id"), x = id && S.items[id];
    if (t.id === "dmonth") { S.dmonth = t.value; if (S.remote.done) remoteSearch("done"); else render(); return; }
    if (t.id === "kmonth") { S.kmonth = t.value; if (S.remote.log) remoteSearch("log"); else render(); return; }
    if (!x) return;
    if (a === "url" || a === "note" || a === "ans") { var dkey = dk(a, id, a === "url" ? t.getAttribute("data-k") : ""); if (S.drafts[dkey] != null) { delete S.drafts[dkey]; LS.set("drafts", S.drafts); markSave(); } }
    if (a === "step") { var ck = Object.assign({}, x.checks || {}); ck[t.getAttribute("data-i")] = t.checked; setUser(id, { checks: ck }); return; }
    if (a === "url") { var u = Object.assign({}, x.urls || {}); u[t.getAttribute("data-k")] = t.value.trim(); setUser(id, { urls: u }); toast("주소를 저장했습니다"); return; }
    if (a === "note") { setUser(id, { note: t.value }, true); toast("메모를 저장했습니다"); return; }
    if (a === "ans") { var an = Object.assign({}, x.answer || {}); an.text = t.value.trim(); an.at = nowIso(); var fin = !!(an.pick || an.text); setUser(id, { answer: an, status: fin ? "done" : "todo", doneAt: fin ? nowIso() : null, doneBy: fin ? "사장님" : null }); toast("답을 보냈습니다"); return; }
  });
  document.addEventListener("toggle", function (ev) { var s = ev.target.getAttribute && ev.target.getAttribute("data-sec"); if (s) S.open["sec_" + s] = ev.target.open; var s2 = ev.target.getAttribute && ev.target.getAttribute("data-isec"); if (s2) S.open["isec_" + s2] = ev.target.open; if (s || s2) LS.set("open", S.open); }, true);
  var st = 0;
  var frt = 0;
  document.addEventListener("input", function (ev) {
    var t = ev.target;
    if (t.id === "fq") {  // 머리글 찾기 칸 — 머리글은 다시 그리지 않으니 글자를 치는 중에도 칸이 그대로다
      S.fq = t.value; S.fk = S.fk || "전체";
      if (S.fq.trim()) { if (S.view !== "find") { S.fprev = S.view; S.view = "find"; S.fk = "전체"; window.scrollTo(0, 0); } }
      else if (S.view === "find") { S.view = S.fprev || "todo"; }
      clearTimeout(frt); frt = setTimeout(render, 120);
      clearTimeout(ftm); if (terms(S.fq).join("").length >= 2) ftm = setTimeout(findRemote, 550);
      return;
    }
    var da = t.getAttribute && t.getAttribute("data-act");
    if (da === "url" || da === "note" || da === "ans") {  // 치는 동안 이 기기에 바로 남긴다 — 갑자기 닫혀도 다시 열면 그대로
      S.drafts[dk(da, t.getAttribute("data-id"), da === "url" ? t.getAttribute("data-k") : "")] = t.value; LS.set("drafts", S.drafts); markSave(); return;
    }
    if (t.id !== "dq" && t.id !== "kq") return;
    S[t.id] = t.value; clearTimeout(st);
    st = setTimeout(function () { var pos = t.selectionStart; render(); var n = $("#" + t.id); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) { } } }, 350);
  });
  document.addEventListener("keydown", function (ev) {
    var tg = ev.target, typing = /^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName || "") || tg.isContentEditable;
    if (tg.id === "fq") {
      if (ev.key === "Enter") { ev.preventDefault(); findRemote(); if (S.fq.trim()) tg.blur(); }
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
    }).join("");
  }
  document.addEventListener("click", function (ev) {
    var b = ev.target.closest("[data-biz]"); if (!b) return;
    LS.set("biz", b.getAttribute("data-biz")); renderBiz();
  });

  window.PT_BUILD = window.PT_BUILD || (typeof PT_BUILD !== "undefined" ? PT_BUILD : "");
  renderBiz(); render(); markSave(); checkLocal(); if (sess) doSync(); badge();
  (function () { var sy = LS.get("scroll", 0); if (sy > 0) setTimeout(function () { window.scrollTo(0, sy); }, 60); })();  // 저장해 둔 보던 자리로
})();
