// Drives the 实时 / 待办 / 问它 tabs. Connects to the backend SSE + APIs.
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const hhmm = (ts) => { const d = new Date(ts); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  let state = null, lastOtherChat = '';

  // ---------- space config (/api/space): every name/label comes from here ----------
  let SPACE = {};
  let ctxApplied = false, isBiz = false;
  const meN = () => (SPACE.me && SPACE.me.name) || '我';
  const tgN = () => (SPACE.target && SPACE.target.name) || '对方';
  const tgP = () => (SPACE.target && SPACE.target.pronoun) || 'TA';
  const orgN = () => (SPACE.org && SPACE.org.name) || SPACE.name || '团队';
  const hasPlugin = (p) => Array.isArray(SPACE.plugins) && SPACE.plugins.includes(p);
  function applySpaceLabels() {
    const setAll = (sel, txt) => document.querySelectorAll(sel).forEach((el) => { el.textContent = txt; });
    setAll('.me-name', meN()); setAll('.tg-name', tgN()); setAll('.tg-pr', tgP()); setAll('.org-name', orgN());
    const title = SPACE.name || 'Relate';
    document.title = title;
    const h1 = document.querySelector('header h1'); if (h1 && !isBiz) h1.textContent = title;
    // chart series labels (charts are created empty in index.html)
    if (window.Chart && Chart.getChart) ['cMonthly', 'cSorry', 'cLove'].forEach((id) => {
      const c = Chart.getChart(id); if (!c) return;
      if (c.data.datasets[0]) c.data.datasets[0].label = meN();
      if (c.data.datasets[1]) c.data.datasets[1].label = tgN();
      c.update('none');
    });
  }
  const spaceReady = fetch('/api/space').then((r) => r.json()).then((s) => { SPACE = s || {}; }).catch(() => {}).then(() => applySpaceLabels());

  // ---------- KPI tiles (live) ----------
  function kpis(d) {
    const r = d.rel || {};
    const w = r.waiting;
    const waitTxt = w ? (w.whoShouldReply === 'G' ? `你该回复（已 ${w.minutes} 分钟）` : `等 ${tgN()} 回复（${w.minutes} 分钟）`) : '—';
    const waitColor = w && w.whoShouldReply === 'G' && w.minutes > 20 ? 'var(--warn)' : 'var(--ink)';
    const ci = r.conflictToday || 0;
    const ciColor = ci >= 30 ? 'var(--warn)' : ci >= 10 ? '#9a7b3f' : 'var(--calm)';
    const tiles = [
      { n: `${r.gToday || 0} : ${r.eToday || 0}`, l: `今日消息 ${esc(meN())} : ${esc(tgN())}` },
      { n: ci, l: '今日冲突强度', c: ciColor },
      { n: `${r.sorryG || 0} : ${r.sorryE || 0}`, l: `今日"对不起" ${esc(meN())} : ${esc(tgN())}` },
      { n: r.scriptG || 0, l: `剧本指数（${esc(meN())} 模板句）` },
      { n: r.testE || 0, l: `测试指数（${esc(tgN())} 试探句）` },
      { n: waitTxt, l: '当前谁该回复', c: waitColor, small: true },
    ];
    $('liveKpis').innerHTML = tiles.map((t) =>
      `<div class="card kpi"><div class="num" style="color:${t.c || 'var(--ink)'};${t.small ? 'font-size:16px;line-height:1.4' : ''}">${esc(t.n)}</div><div class="lbl">${t.l}</div></div>`
    ).join('');
  }

  // ---------- message bubble ----------
  function bubble(m) {
    const isG = m.isSend === 1;
    const tag = m._tag || {};
    const el = document.createElement('div');
    el.className = 'bub ' + (isG ? 'bG' : 'bE');
    let tags = '';
    if (tag.conflict > 0) tags += `<span class="btag c">冲突</span>`;
    if (tag.scriptG && isG) tags += `<span class="btag s">剧本</span>`;
    if (m.voice) tags += `<span class="btag v">语音</span>`;
    if (tag.care) tags += `<span class="btag care">⚠</span>`;
    el.innerHTML = `<div class="t">${esc(isG ? meN() : tgN())} · ${hhmm(m.ts)}${tags}</div><div class="${m.voice ? 'voice' : ''}">${esc(m.content)}</div>`;
    return el;
  }
  const seenMsg = new Set();
  function pushFeed(m) {
    const sig = `${m.isSend}|${Math.floor(m.ts / 1000)}|${String(m.content).slice(0, 40)}`;
    if (seenMsg.has(sig)) return; seenMsg.add(sig);
    const f = $('liveFeed'); const atBottom = f.scrollTop + f.clientHeight >= f.scrollHeight - 40;
    f.appendChild(bubble(m));
    while (f.children.length > 120) f.removeChild(f.firstChild);
    if (atBottom) f.scrollTop = f.scrollHeight;
  }
  function pushOther(o) {
    const f = $('otherFeed'); const none = $('othernone'); if (none) none.remove();
    const el = document.createElement('div');
    el.className = 'bub bE'; el.style.maxWidth = '100%';
    el.innerHTML = `<div class="t">${esc(o.sessionName)} · ${esc(o.senderName || '')} · ${hhmm(o.ts)}</div><div>${esc(o.content)}</div>`;
    f.appendChild(el); while (f.children.length > 40) f.removeChild(f.firstChild); f.scrollTop = f.scrollHeight;
  }

  // ---------- AI briefing ----------
  function brief(ins, at) {
    if (!ins) return;
    const al = (ins.alerts || []).filter(Boolean);
    $('liveBrief').innerHTML =
      `<div style="font-weight:600;font-size:15px;margin-bottom:4px">${esc(ins.headline || '')}</div>
       <div style="font-size:13.5px;color:#4a453f">${esc(ins.summary || '')}</div>
       ${ins.mood ? `<div class="tagm" style="margin-top:8px;display:inline-block">情绪 · ${esc(ins.mood)}</div>` : ''}
       <div style="margin-top:8px">${(ins.activeTopics || []).map((t) => `<span class="tagm" style="margin:2px">${esc(t)}</span>`).join('')}</div>
       ${al.length ? `<div style="margin-top:10px">${al.map((a) => `<div class="note" style="margin-top:6px;border-left:3px solid var(--warn)">⚠ ${esc(a)}</div>`).join('')}</div>` : ''}`;
    if (at) $('lbriefage').textContent = '更新于 ' + hhmm(at);
  }

  // ---------- care banner ----------
  let careDismissed = 0;
  function care(c) {
    if (!c || !c.at) return;
    if (Date.now() - c.at > 12 * 3600000) { $('careBanner').style.display = 'none'; return; } // stale => hide
    if (c.at <= careDismissed) return;                                                          // dismissed this one
    const b = $('careBanner');
    b.style.display = 'block';
    const when = new Date(c.at).toLocaleString('zh-CN');
    b.innerHTML = `<h3>⚠ 需要认真对待 <span style="float:right;cursor:pointer;font-size:14px;color:var(--sub)" id="careX">✕ 关闭</span></h3>
      <p>${when} 出现了超出普通吵架范畴的表达："${esc(c.text)}"。这不该被当作气话。若情绪持续，请优先安全，认真谈一谈或寻求专业帮助。</p>
      <div class="res"><b>求助</b>：Lifeline <b>13 11 14</b> · Beyond Blue 1300 22 4636 · 中国心理援助 <b>12356</b></div>`;
    $('careX').onclick = () => { careDismissed = c.at; b.style.display = 'none'; };
  }

  // ---------- todos ----------
  const KMETA = { reply: ['需回复', 'reply'], sensitive: ['敏感点', 'sensitive'], promise: ['承诺', 'promise'], discuss: ['需讨论', 'discuss'] };
  function scoreColor(s) { return s >= 75 ? 'var(--warn)' : s >= 55 ? '#c98a3f' : s >= 35 ? 'var(--g)' : 'var(--sub)'; }
  function rankRow(t) {
    const who = t.who === 'me' ? '你欠的' : `${esc(tgN())} 在意`;
    return `<div class="rank ${t.status === 'done' ? 'done' : ''}">
      <div class="score" style="background:${scoreColor(t.score)}">${t.score ?? '·'}</div>
      <div class="bd"><div class="tx"><span class="kt ${t.kind}">${(KMETA[t.kind] || [''])[0]}</span> ${esc(t.text)}</div>
        <div class="mx"><span>严重 <b>${t.severity || '-'}/5</b></span><span>时效 <b>${{ high: '高', medium: '中', low: '低' }[t.urgency] || '-'}</b></span><span>提及 <b>×${t.seen || 1}</b></span><span>情绪 <b>${t.emotion || '-'}/5</b></span><span>· ${who}</span></div>
      </div>
      <div class="chk" data-id="${encodeURIComponent(t.id)}" style="align-self:center">${t.status === 'done' ? '✓' : ''}</div></div>`;
  }
  let todoExpanded = false;
  function todos(r) {
    const ranked = r.topRanked || [];
    $('todoRanked').innerHTML = ranked.length ? ranked.map(rankRow).join('') : '<div class="tagm">分析中…</div>';
    const rest = r.rest || [];
    if ($('todoRestList')) $('todoRestList').innerHTML = rest.length ? rest.map(rankRow).join('') : '<div class="tagm">没有更多了</div>';
    if ($('restCnt')) $('restCnt').textContent = rest.length ? rest.length + ' 条' : '';
    const moreLabel = () => `${todoExpanded ? '▴ 收起' : '▾ 展开'}其余待办与分类明细${rest.length ? '（' + rest.length + '）' : ''}`;
    if ($('todoRest')) $('todoRest').style.display = todoExpanded ? 'block' : 'none';
    if ($('todoMore')) { $('todoMore').textContent = moreLabel(); $('todoMore').onclick = () => { todoExpanded = !todoExpanded; $('todoRest').style.display = todoExpanded ? 'block' : 'none'; $('todoMore').textContent = moreLabel(); }; }
    const g = r.groups || {};
    const order = ['reply', 'promise', 'discuss'];   // 敏感点 rendered separately from Living State
    const cols = order.map((k) => {
      const items = g[k] || [];
      const rows = items.length ? items.map(todoRow).join('') : '<div class="tagm">暂无</div>';
      return `<div class="card todocol"><h4><span class="kt ${k}">${KMETA[k][0]}</span> ${labelFor(k)} <span class="cc">${items.length}</span></h4>${rows}</div>`;
    });
    $('todoGrid').innerHTML = cols.join('') + `<div class="card todocol" id="sensitiveCol"><h4><span class="kt sensitive">敏感点</span> 回复时的雷区 <small style="color:var(--sub)">来自关系记忆</small></h4><div id="sensitiveList"><span class="tagm">加载中…</span></div></div>`;
    renderSensitive();
    // auto-resolved stash (addressed / stale)
    const stash = r.stashed || [];
    if ($('todoStash')) {
      $('todoStash').style.display = stash.length ? 'block' : 'none';
      $('stashList').innerHTML = stash.map((t) => {
        const tag = t.status === 'addressed' ? '<span class="kt reply">✓ 已处理</span>' : '<span class="kt discuss">💤 已过时</span>';
        return `<div class="todo done"><div class="chk">✓</div><div style="flex:1"><div class="tx">${esc(t.text)}</div>
          <div class="mt">${tag}${t.reason ? `<span>· ${esc(t.reason)}</span>` : ''}<span>· ${(KMETA[t.kind] || [''])[0]}</span></div></div></div>`;
      }).join('');
    }
    bindChecks();
  }
  function labelFor(k) { return { reply: '对方在等你回', sensitive: '回复时的雷区', promise: '许下的承诺', discuss: '需要认真谈' }[k]; }
  // 敏感点 = Living State memory (landmines + watchNow) — higher quality than re-extracting
  let livingMem = null;
  function renderSensitive() {
    if (!$('sensitiveList')) return;
    const m = livingMem || {};
    const items = [...(m.landmines || []).map((t) => ['雷', t]), ...(m.watchNow || []).map((t) => ['注意', t])];
    $('sensitiveList').innerHTML = items.length
      ? items.map(([tag, t]) => `<div class="todo"><div style="flex:1"><div class="tx">${esc(t)}</div><div class="mt"><span class="cred no">${tag}</span></div></div></div>`).join('')
      : '<div class="tagm">暂无（需要一次深度分析）</div>';
  }
  async function pollLiving() { try { const d = await (await fetch('/api/living')).json(); livingMem = d.memory || {}; renderSensitive(); } catch {} }
  pollLiving(); setInterval(pollLiving, 30000);

  // ---- relationship trend strip (last N weeks, from real message tags) ----
  function sparkline(arr, color, range) {
    const w = 62, h = 20;
    const pts = arr.map((x, i) => ({ i, v: x })).filter((p) => p.v != null);   // real points only — nulls are gaps, NOT zeros
    const N = Math.max(arr.length - 1, 1);
    const svg = (inner) => `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${inner}</svg>`;
    if (!pts.length) return svg('');
    if (pts.length < 2) { const p = pts[pts.length - 1]; return svg(`<circle cx="${((p.i / N) * w).toFixed(1)}" cy="${(h / 2).toFixed(1)}" r="2.2" fill="${color}"/>`); }  // one point = dot, no fake line
    const vals = pts.map((p) => p.v);
    let min = range ? range[0] : Math.min(...vals), max = range ? range[1] : Math.max(...vals);
    const span = (max - min) || 1;
    const poly = pts.map((p) => `${((p.i / N) * w).toFixed(1)},${(h - ((p.v - min) / span) * (h - 4) - 2).toFixed(1)}`).join(' ');
    return svg(`<polyline points="${poly}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round"/>`);
  }
  async function renderTrends() {
    const box = $('trendStrip'); if (!box) return;
    let t; try { t = await (await fetch('/api/trends')).json(); } catch { return; }
    if (!t || !t.series || !t.weeks || t.weeks.length < 2) { box.style.display = 'none'; return; }
    const pct = (x) => (x == null ? '—' : x);
    const P = esc(tgP());
    const items = [
      { k: 'herSent', label: `${P}情绪`, badUp: false, fmt: pct, range: [-1, 1] },
      { k: 'herInitPct', label: `${P}主动%`, badUp: false, fmt: pct },
      { k: 'conflict', label: '冲突', badUp: true },
      { k: 'sweet', label: '甜度%', badUp: false, fmt: pct },
      { k: 'msgs', label: '互动量', badUp: false },
      { k: 'nightPct', label: '深夜%', badUp: true, fmt: pct },
      { k: 'latMin', label: '你回复(分)', badUp: true, fmt: (x) => (x == null ? '—' : Math.round(x)) },
      { k: 'herLatMin', label: `${P}回复(分)`, badUp: true, fmt: (x) => (x == null ? '—' : Math.round(x)) },
      { k: 'love', label: '示爱', badUp: false },
      { k: 'sorryG', label: '你道歉', badUp: true },
    ];
    box.style.display = '';
    box.innerHTML = `<h3 style="margin:0 0 10px">📈 近${t.weeks.length}周趋势 <small style="color:var(--sub)">每格一周 · 最右=本周</small></h3><div class="trend-row">`
      + items.map((it) => {
        const arr = t.series[it.k] || [], arw = (t.arrows[it.k]) || '→';
        const nonNull = arr.filter((x) => x != null).length;
        const last = arr[arr.length - 1], val = it.fmt ? it.fmt(last) : (last ?? 0);
        const cls = nonNull < 2 ? 'flat' : arw === '↑' ? (it.badUp ? 'up' : 'down') : arw === '↓' ? (it.badUp ? 'down' : 'up') : 'flat';
        const color = cls === 'up' ? '#c0392b' : cls === 'down' ? '#2a9d54' : '#9aa0ac';
        const tail = nonNull < 2 ? '<span class="tl" style="opacity:.55">·积累中</span>' : `<span class="tv ${cls}">${val} ${arw}</span>`;
        const head = nonNull < 2 ? `<span class="tv flat">${val}</span>` : '';
        return `<div class="trend-item"><span class="tl">${it.label}</span>${sparkline(arr, color, it.range)}${head}${tail}</div>`;
      }).join('') + '</div>';
  }
  renderTrends(); setInterval(renderTrends, 5 * 60000);
  function todoRow(t) {
    const who = esc(t.who === 'me' ? '你' : (t.scope === 'main' ? tgN() : (t.chatLabel || '对方')));
    const cred = t.kind === 'promise' && t.credible !== undefined ? `<span class="cred ${t.credible ? 'yes' : 'no'}">${t.credible ? '较可兑现' : '偏空头'}</span>` : '';
    const scope = t.scope === 'other' ? `· ${esc(t.chatLabel || '')}` : '';
    return `<div class="todo ${t.status === 'done' ? 'done' : ''}" data-id="${encodeURIComponent(t.id)}">
      <div class="chk"></div>
      <div style="flex:1"><div class="tx">${esc(t.text)}</div>
        <div class="mt"><span style="color:${scoreColor(t.score)};font-weight:600">▲${t.score ?? '-'}</span><span>${who}</span>${cred}${t.urgency === 'high' ? '<span class="u-high">紧要</span>' : ''}${t.due ? `<span>⏱ ${esc(t.due)}</span>` : ''}<span>${scope}</span></div>
      </div></div>`;
  }
  function bindChecks() {
    document.querySelectorAll('#todo .chk').forEach((el) => el.onclick = () => {
      const id = el.dataset.id || (el.closest('[data-id]') && el.closest('[data-id]').dataset.id);
      if (id) fetch(`/api/reminders/${id}/toggle`, { method: 'POST' });
    });
  }

  // ---------- reply drafts ----------
  async function draft(scope, btn, out) {
    btn.disabled = true; const old = btn.textContent; btn.innerHTML = '<span class="spin"></span> 生成中…';
    try {
      const url = scope === 'main' ? '/api/reply-preview?scope=main' : `/api/reply-preview?scope=other&chat=${encodeURIComponent(lastOtherChat)}`;
      const d = await (await fetch(url)).json();
      if (d.error) { out.innerHTML = `<div class="tagm" style="margin-top:10px">${esc(d.error)}</div>`; }
      else out.innerHTML = `<div class="draftbox"><div class="d">${esc(d.draft)}</div>
        <div class="meta">${d.tone ? `语气：${esc(d.tone)}　` : ''}${d.note ? `<br>💡 ${esc(d.note)}` : ''}</div></div>`;
    } catch (e) { out.innerHTML = `<div class="tagm">生成失败：${esc(e.message)}</div>`; }
    btn.disabled = false; btn.textContent = old;
  }
  $('genMain').onclick = () => draft('main', $('genMain'), $('draftMain'));
  $('genOther').onclick = () => draft('other', $('genOther'), $('draftOther'));

  // ---------- lightweight markdown: headings, **bold**, *italic*, `code`, bullets, tables, ---, [n] ----------
  function mdInline(s) {
    return esc(s)
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/(^|[^*])\*(?!\s)([^*]+?)\*(?!\*)/g, '$1<i>$2</i>')
      .replace(/`([^`]+?)`/g, '<code>$1</code>')
      .replace(/\[(\d+)\]/g, '<span class="cref">[$1]</span>');
  }
  const isTableRow = (l) => /^\|.*\|\s*$/.test(l);
  const isTableSep = (l) => /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(l);
  const cells = (l) => l.replace(/^\||\|\s*$/g, '').split('|').map((c) => c.trim());
  function mdLite(t) {
    const lines = String(t || '').replace(/\r/g, '').split('\n');
    let html = '', inList = false; const closeList = () => { if (inList) { html += '</ul>'; inList = false; } };
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i].trim();
      // table: a row followed by a --- separator
      if (isTableRow(l) && i + 1 < lines.length && isTableSep(lines[i + 1].trim())) {
        closeList();
        const head = cells(l); i += 2; let rows = '';
        while (i < lines.length && isTableRow(lines[i].trim())) { rows += '<tr>' + cells(lines[i].trim()).map((c) => `<td>${mdInline(c)}</td>`).join('') + '</tr>'; i++; }
        i--;
        html += `<div class="mdtw"><table class="mdt"><thead><tr>${head.map((c) => `<th>${mdInline(c)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;
        continue;
      }
      if (!l) { closeList(); continue; }
      if (/^---+$/.test(l) || /^___+$/.test(l)) { closeList(); html += '<hr class="mdhr">'; }
      else if (/^#{1,6}\s/.test(l)) { closeList(); const lvl = (l.match(/^#+/)[0].length); html += `<div class="mdh mdh${lvl > 3 ? 3 : lvl}">${mdInline(l.replace(/^#{1,6}\s/, ''))}</div>`; }
      else if (/^>\s?/.test(l)) { closeList(); html += `<blockquote class="mdq">${mdInline(l.replace(/^>\s?/, ''))}</blockquote>`; }
      else if (/^[-*+]\s/.test(l)) { if (!inList) { html += '<ul class="mdul">'; inList = true; } html += `<li>${mdInline(l.replace(/^[-*+]\s/, ''))}</li>`; }
      else if (/^\d+\.\s/.test(l)) { if (!inList) { html += '<ul class="mdul mdol">'; inList = true; } html += `<li>${mdInline(l.replace(/^\d+\.\s/, ''))}</li>`; }
      else { closeList(); html += `<p class="mdp">${mdInline(l)}</p>`; }
    }
    closeList();
    return html;
  }

  // ---------- ask (persistent multi-chat assistant + advisor thread) ----------
  let chatHist = [];                 // display turns of the ACTIVE chat (== chatMsgs.get(activeChatId))
  let activeChatId = null;           // server-side chat id (null = will be created on first send)
  let chatsList = [];                // [{id,title,updatedAt,count}]
  const chatMsgs = new Map();        // chatId -> messages[] : per-chat buffer, keeps in-flight turns alive off-screen
  const generating = new Set();      // chatIds with a generation in flight (spinner on tab)
  const unread = new Set();          // chatIds whose reply landed while you were on another tab (dot on tab)
  // ping when a reply lands so you can look away during the wait and come back.
  // fires only when the app isn't focused (if you're watching, the bubble's already there).
  async function notifyReplyReady(question, answer) {
    try {
      if (!('Notification' in window) || Notification.permission !== 'granted') return;
      if (!document.hidden && document.hasFocus()) return;
      const body = String(answer || '').replace(/[#*`>\[\]]/g, '').replace(/\s+/g, ' ').trim().slice(0, 90) || '回复已生成';
      const title = '💬 ' + String(question || '回复').slice(0, 24) + ' —— 回复好了';
      const opts = { body, tag: 'ask-reply', renotify: true, icon: '/icon-192.png', badge: '/icon-192.png', data: { url: '/' }, vibrate: [60, 30, 60] };
      const reg = ('serviceWorker' in navigator) ? await navigator.serviceWorker.getRegistration() : null;
      if (reg && reg.showNotification) await reg.showNotification(title, opts);
      else new Notification(title, opts);
    } catch {}
  }

  function renderThread() {
    const box = $('askout'); if (!box) return;
    if (!chatHist.length) { box.innerHTML = '<span class="tagm">在下面输入问题。它会记住这次对话，可以追问。</span>'; return; }
    let html = '';
    for (const t of chatHist) {
      if (t.role === 'user') { html += `<div class="bubu">${esc(t.content)}</div>`; continue; }
      const status = t.streaming && t.status ? `<div class="tagm" style="margin-bottom:6px">⏳ ${esc(t.status)}</div>` : '';
      const body = t.content ? mdLite(t.content) : (t.streaming && !t.status ? '<span class="spin"></span> 思考中…' : '');
      const cursor = t.streaming && t.content ? '<span class="cursor"></span>' : '';
      html += `<div class="buba">${status}<div class="mdbody">${body}${cursor}</div>${t.hitsHtml || ''}</div>`;
    }
    box.innerHTML = html;
    box.scrollTop = box.scrollHeight;
  }
  // build clickable/highlighted source block from meta hits + cited set
  function hitsBlock(hits, cited) {
    if (!hits || !hits.length) return '';
    const set = new Set(cited || []);
    const rows = hits.map((h) => `<div class="qhit${set.has(h.i) ? ' used' : ''}">[${h.i}] ${esc(h.date)}${h.dateEnd ? '–' + esc(h.dateEnd) : ''}<br>${esc(h.text)}</div>`).join('');
    return `<details class="qsrc"><summary class="tagm">依据片段（${hits.length}）</summary>${rows}</details>`;
  }
  async function ask() {
    const q = $('askq').value.trim(); if (!q) return;
    // pin this generation to a chat id up-front so it lands in the right tab even if you switch away
    let cid = activeChatId;
    if (!cid) {
      try {
        const c = await (await fetch('/api/chats', { method: 'POST' })).json();
        cid = c.id; activeChatId = cid;
        chatMsgs.set(cid, []); chatHist = chatMsgs.get(cid);
        chatsList = [{ id: cid, title: '新对话', updatedAt: Date.now(), count: 0 }, ...chatsList.filter((x) => x.id !== cid)];
      } catch { return; }
    }
    if (generating.has(cid)) return;          // one generation per chat at a time
    if (!chatMsgs.has(cid)) chatMsgs.set(cid, []);
    const msgs = chatMsgs.get(cid);           // this generation writes here, on- or off-screen
    generating.add(cid); $('askq').value = '';
    msgs.push({ role: 'user', content: q });
    const turn = { role: 'assistant', content: '', hitsHtml: '', streaming: true };
    msgs.push(turn);
    const isActive = () => cid === activeChatId;
    if (isActive()) renderThread();
    renderTabs();                             // spinner appears on this tab
    // streaming keeps the connection alive, so no CF-timeout risk. Abort only on a real stall
    // (no bytes for 60s) or a very long overall cap.
    const ac = new AbortController();
    let stall = setTimeout(() => ac.abort(), 60000);
    const armStall = () => { clearTimeout(stall); stall = setTimeout(() => ac.abort(), 60000); };
    const overall = setTimeout(() => ac.abort(), 300000);
    let hits = [];
    let gotAny = false;                       // did streaming deliver any content?
    let rafPending = false;
    const paint = () => { if (!isActive() || rafPending) return; rafPending = true; requestAnimationFrame(() => { rafPending = false; renderThread(); }); };
    // one-shot fallback for browsers/networks that can't read a streamed body (some iOS Safari/PWA)
    async function oneShot() {
      turn.status = '（切换到非流式模式，请稍候…）'; paint();
      const r2 = await fetch('/api/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ q, chatId: cid }) });
      if (!r2.ok) throw new Error('服务器返回 ' + r2.status + (r2.status === 401 ? '（登录已过期，请刷新页面重新输入密码）' : ''));
      const d = await r2.json();
      turn.status = ''; turn.content = d.answer || '(无回答)';
      turn.hitsHtml = hitsBlock(d.hits || [], d.cited);
    }
    // called once the answer is fully in (or failed): drop the spinner, flag unread if off-screen
    const finish = () => {
      turn.streaming = false; generating.delete(cid);
      if (isActive()) renderThread();
      else { unread.add(cid); notifyReplyReady(q, turn.content); }
      renderTabs(); loadChats();              // refresh titles/order (title just auto-generated)
    };
    try {
      let r;
      try {
        r = await fetch('/api/ask/stream', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ q, chatId: cid }), signal: ac.signal });
        if (!r.ok || !r.body || !r.body.getReader) throw new Error('no-stream');
      } catch (streamStart) { await oneShot(); r = null; }   // couldn't even open the stream → fall back
      if (r) {
        const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          armStall();
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i); buf = buf.slice(i + 1);
            if (!line.trim()) continue;
            let m; try { m = JSON.parse(line); } catch { continue; }
            if (m.type === 'meta') { hits = m.hits || []; }
            else if (m.type === 'progress') { turn.status = m.msg; paint(); }
            else if (m.type === 'token') { turn.status = ''; gotAny = true; turn.content += m.t; paint(); }
            else if (m.type === 'done') { gotAny = true; turn.hitsHtml = hitsBlock(hits, m.cited); }
            else if (m.type === 'error') { gotAny = true; turn.content += (turn.content ? '\n\n' : '') + '出错：' + m.message; }
          }
        }
      }
      finish();
    } catch (e) {
      // if the stream broke mid-way but gave us nothing, try the one-shot before giving up
      if (!gotAny && !turn.content) {
        try { await oneShot(); finish(); }
        catch (e2) { turn.streaming = false; turn.status = ''; turn.content = '出错：' + (e2.message || e2); generating.delete(cid); if (isActive()) renderThread(); renderTabs(); }
      } else {
        turn.streaming = false; generating.delete(cid);
        const tail = e.name === 'AbortError' ? '（回答中断了——请重试）' : '（连接中断）';
        turn.content += (turn.content ? '\n\n' : '') + tail;
        if (isActive()) renderThread(); else unread.add(cid);
        renderTabs();
      }
    } finally { clearTimeout(stall); clearTimeout(overall); }
  }
  $('askbtn').onclick = ask;
  $('askq').addEventListener('keydown', (e) => { if (e.key === 'Enter') ask(); });

  // ---------- persistent multi-chat management ----------
  function renderTabs() {
    const box = $('chatTabs'); if (!box) return;
    box.innerHTML = chatsList.map((c) => {
      const gen = generating.has(c.id) ? '<span class="tspin"></span>' : '';
      const isUnread = unread.has(c.id) && c.id !== activeChatId;
      const dot = isUnread ? '<span class="udot"></span>' : '';
      return `<div class="chattab${c.id === activeChatId ? ' on' : ''}${isUnread ? ' unread' : ''}" data-id="${c.id}">${gen}<span class="t">${esc(c.title || '新对话')}</span>${dot}<span class="x" data-del="${c.id}">×</span></div>`;
    }).join('');
    box.querySelectorAll('.chattab').forEach((el) => el.addEventListener('click', (e) => { if (e.target.dataset.del) return; openChat(el.dataset.id); }));
    box.querySelectorAll('.x').forEach((el) => el.addEventListener('click', (e) => { e.stopPropagation(); deleteChat(el.dataset.del); }));
  }
  async function loadChats() {
    try { const r = await (await fetch('/api/chats')).json(); chatsList = r.chats || []; } catch { chatsList = []; }
    renderTabs();
  }
  async function openChat(id) {
    if (id === activeChatId) return;          // switching is always allowed now, even mid-generation
    unread.delete(id);                        // viewing it clears the dot
    // if it's live in memory (incl. an in-flight turn), show that — don't clobber with the persisted copy
    if (chatMsgs.has(id)) {
      activeChatId = id; chatHist = chatMsgs.get(id);
      renderTabs(); renderThread(); return;
    }
    try {
      const c = await (await fetch('/api/chats/' + encodeURIComponent(id))).json();
      if (c.error) { await loadChats(); return; }
      const msgs = (c.messages || []).map((m) => m.role === 'user'
        ? { role: 'user', content: m.content }
        : { role: 'assistant', content: m.content, hitsHtml: hitsBlock(m.hits || [], m.cited || []) });
      chatMsgs.set(c.id, msgs);
      activeChatId = c.id; chatHist = msgs;
      renderTabs(); renderThread();
    } catch {}
  }
  async function newChat() {
    try {
      const c = await (await fetch('/api/chats', { method: 'POST' })).json();
      activeChatId = c.id; chatMsgs.set(c.id, []); chatHist = chatMsgs.get(c.id);
      chatsList = [{ id: c.id, title: '新对话', updatedAt: Date.now(), count: 0 }, ...chatsList.filter((x) => x.id !== c.id)];
      renderTabs(); renderThread();
      const box = $('askq'); if (box) box.focus();
    } catch {}
  }
  async function deleteChat(id) {
    try { await fetch('/api/chats/' + encodeURIComponent(id), { method: 'DELETE' }); } catch {}
    chatMsgs.delete(id); generating.delete(id); unread.delete(id);
    if (activeChatId === id) { activeChatId = null; chatHist = []; }
    await loadChats();
    if (!activeChatId && chatsList.length) await openChat(chatsList[0].id);
    else if (!activeChatId) renderThread();
  }
  if ($('chatNew')) $('chatNew').onclick = newChat;

  // ---------- background notes (user-taught facts) ----------
  async function loadNotes() {
    const box = $('notesList'); if (!box) return;
    let ns = [];
    try { ns = (await (await fetch('/api/notes')).json()).notes || []; } catch {}
    if ($('notesN')) $('notesN').textContent = ns.length ? `· ${ns.length} 条` : '';
    box.innerHTML = ns.length ? ns.map((n) => `<div class="noterow" data-id="${n.id}">· ${esc(n.text)} <span class="notedel" data-id="${n.id}">×</span></div>`).join('')
      : '<span class="tagm">还没有背景笔记。加一条，或在对话里说「记住 …」。</span>';
    box.querySelectorAll('.notedel').forEach((el) => (el.onclick = async () => { try { await fetch('/api/notes/' + el.dataset.id, { method: 'DELETE' }); } catch {} loadNotes(); }));
  }
  async function addNote() {
    const inp = $('noteInput'); if (!inp || !inp.value.trim()) return;
    try { await fetch('/api/notes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: inp.value.trim() }) }); } catch {}
    inp.value = ''; loadNotes();
  }
  if ($('noteAdd')) $('noteAdd').onclick = addNote;
  if ($('noteInput')) $('noteInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') addNote(); });
  loadNotes();
  // init: load the chat list, open the most recent (or start empty)
  (async function initChats() {
    await loadChats();
    if (chatsList.length) await openChat(chatsList[0].id);
    else renderThread();
  })();

  // ---------- 关系体检 (structured checkup) ----------
  function renderCheckup(c) {
    if (!c || !c.report) return;
    if ($('checkupWhen') && c.at) $('checkupWhen').textContent = '更新于 ' + new Date(c.at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    if ($('checkupOut')) $('checkupOut').innerHTML = `<div class="mdbody">${mdLite(c.report)}</div>`;
  }
  async function pollCheckup() { try { renderCheckup(await (await fetch('/api/checkup')).json()); } catch {} }
  const cbtn = $('checkupBtn');
  if (cbtn) cbtn.onclick = async () => {
    cbtn.disabled = true; const old = cbtn.textContent; cbtn.textContent = '生成中…';
    $('checkupOut').innerHTML = '<span class="spin"></span> 正在做关系体检（约 30-60 秒）…';
    let before = 0; try { before = (await (await fetch('/api/checkup')).json()).at || 0; } catch {}
    try { await fetch('/api/checkup/run', { method: 'POST' }); } catch {}
    // poll every 8s up to ~100s until the report timestamp advances (SSE also pushes it live)
    let n = 0; const iv = setInterval(async () => {
      n++; let c = null; try { c = await (await fetch('/api/checkup')).json(); } catch {}
      if (c && c.at && c.at !== before) { renderCheckup(c); clearInterval(iv); cbtn.disabled = false; cbtn.textContent = old; }
      else if (n >= 13) { clearInterval(iv); cbtn.disabled = false; cbtn.textContent = old; }
    }, 8000);
  };
  pollCheckup();

  // ---------- render snapshot ----------
  // ---------- business context: hide relationship UI, show a per-chat list (not one blob) ----------
  function applyContext(d) {
    if (ctxApplied || !d) return; ctxApplied = true;
    const tpl = SPACE.template || d.contextType;
    isBiz = tpl === 'business' || tpl === 'team';
    if (!isBiz) return;
    document.body.dataset.ctx = 'business';
    ['careBanner', 'occasions', 'gameStrip', 'checkupCard'].forEach((id) => { const el = $(id); if (el) el.style.display = 'none'; });
    // hide relationship draft-reply cards (建议回复 / 其他对话回复)
    ['genMain', 'genOther'].forEach((id) => { const el = $(id); const card = el && el.closest('.card'); if (card) card.style.display = 'none'; });
    const t = $('lfeedTitle'); if (t) t.textContent = '对话';
    // header + footer: replace the relationship framing with a chief-of-staff one
    const h1 = document.querySelector('header h1'); if (h1) h1.textContent = `${orgN()} · 幕僚长视角`;
    const hp = document.querySelector('header p'); if (hp) hp.textContent = `${(d.kpi ? d.kpi.total.toLocaleString() : '')} 条消息 · ${d.topSessions ? d.topSessions.length : ''} 个对话 · 实时`;
    const hdiv = document.querySelector('header > div'); if (hdiv) hdiv.style.display = 'none';   // me/target legend
    const ft = document.querySelector('.footer'); if (ft) ft.textContent = '由 AI 基于聊天记录整理 · 仅供参考，最终决策在你';
    document.title = `${orgN()} · 幕僚长`;
    // native business nav (概览 / 对话 / 待办 / 问它) — reuse the existing group machinery
    try {
      if (typeof GROUPS !== 'undefined') {
        GROUPS.bizhome = { stack: true, secs: [['bizhome']] };
        GROUPS.bizchats = { stack: true, secs: [['live']] };
        GROUPS.biztodo = { stack: true, secs: [['todo']] };
      }
      const nav = document.querySelector('nav');
      if (nav) {
        nav.innerHTML = '<button class="on" data-g="bizhome">📋 概览</button>'
          + '<button data-g="bizchats">💬 对话</button>'
          + '<button data-g="biztodo">✅ 待办</button>'
          + '<button data-g="ask">🤖 问它</button>'
          + `<span style="flex:1"></span><span class="whotoggle"><b class="on">${esc(orgN())}</b></span>`;
        nav.querySelectorAll('button[data-g]').forEach((b) => (b.onclick = () => { if (typeof showGroup === 'function') showGroup(b.dataset.g); if (b.dataset.g === 'bizhome') renderBizHome(); }));
      }
      if (typeof showGroup === 'function') showGroup('bizhome');
    } catch (e) {}
    renderBizHome();
  }
  // chief-of-staff board: who's waiting on you / your commitments / waiting on others / blockers / open loops
  async function renderBizHome() {
    const board = $('bizBoard'); if (!board) return;
    let mem = {}, todos = [];
    try { mem = (await (await fetch('/api/living')).json()).memory || {}; } catch {}
    try { const r = await (await fetch('/api/reminders')).json(); todos = r.topRanked || r.open || []; } catch {}
    // pending approvals — the agent wants to DO something; needs your ✓ before it acts
    const ap = $('bizApprovals');
    if (ap) {
      let pend = [];
      try { pend = (await (await fetch('/api/approvals')).json()).pending || []; } catch {}
      if (pend.length) {
        ap.style.display = '';
        ap.innerHTML = `<h3>🔔 待批准 <span style="margin-left:auto;font-weight:400;color:var(--sub);font-size:12px">${pend.length} 个动作等你确认</span></h3>`
          + pend.map((a) => `<div class="appr-row" data-id="${a.id}"><div class="txt">${esc(a.preview)}<div class="src">来自 ${esc(a.source || '助手')}</div></div>`
            + `<button class="appr-btn appr-ok" data-ok="${a.id}">✓ 批准</button><button class="appr-btn appr-no" data-no="${a.id}">✗</button></div>`).join('');
        ap.querySelectorAll('[data-ok]').forEach((el) => (el.onclick = async () => {
          el.textContent = '执行中…'; el.disabled = true;
          try { const r = await (await fetch('/api/approvals/' + el.dataset.ok + '/approve', { method: 'POST' })).json();
            const row = el.closest('.appr-row'); if (row) row.innerHTML = `<div class="appr-done">${r.ok ? '✅ 已执行' : '⚠️ 失败：' + esc(JSON.stringify(r.result || {}).slice(0, 120))}</div>`;
          } catch {}
          setTimeout(renderBizHome, 1200);
        }));
        ap.querySelectorAll('[data-no]').forEach((el) => (el.onclick = async () => {
          try { await fetch('/api/approvals/' + el.dataset.no + '/reject', { method: 'POST' }); } catch {}
          setTimeout(renderBizHome, 300);
        }));
      } else ap.style.display = 'none';
    }
    // team mood / synergy / issues (overall vibe, not per-person)
    const md = $('bizMood');
    if (md) {
      let mood = null; try { mood = await (await fetch('/api/mood')).json(); } catch {}
      if (mood && (mood.latest != null || mood.synergy != null || (mood.concerns || []).length)) {
        const lbl = mood.latest == null ? '积累中' : mood.latest > 0.2 ? '😊 正面' : mood.latest < -0.2 ? '😟 偏负' : '😐 中性';
        const syn = mood.synergy, synC = syn == null ? '#9aa0ac' : syn >= 75 ? '#2a9d54' : syn >= 50 ? '#e0a800' : '#c0392b';
        const spark = sparkline(mood.overall || [], mood.arrow === '↓' ? '#c0392b' : '#2a9d54', [-1, 1]);
        const issues = [...(mem.blockers || []), ...(mem.openLoops || [])].slice(0, 4);
        md.style.display = '';
        md.innerHTML = '<h3 style="margin:0 0 10px">🌡️ 团队氛围</h3><div class="mood-row">'
          + `<div class="mood-big"><span class="ml">整体情绪 ${mood.arrow || ''}</span><span class="mv">${lbl}</span></div>`
          + `<div class="mood-big"><span class="ml">近周走势</span>${spark}</div>`
          + `<div class="mood-big"><span class="ml">协作指数</span><div class="syn-bar"><div class="syn-fill" style="width:${syn || 0}%;background:${synC}"></div></div><span class="mv" style="font-size:13px">${syn == null ? '—' : syn + '%'}</span></div>`
          + `<div class="mood-big"><span class="ml">活跃 / 静默</span><span class="mv" style="font-size:14px">${mood.active} / ${mood.quiet}</span></div>`
          + '</div>'
          + ((mood.concerns || []).length ? `<div class="mood-concern">⚠️ 需要关注：${mood.concerns.map((c) => esc(c.name) + '（' + esc(c.why) + '）').join(' · ')}</div>` : '')
          + (issues.length ? `<div style="margin-top:10px"><div class="ml" style="font-size:11px;color:var(--sub)">当前卡点/问题</div>${issues.map((x) => `<div class="mood-issue">· ${esc(x)}</div>`).join('')}</div>` : '');
      } else md.style.display = 'none';
    }
    const obs = state && state.ai && state.ai.insight;
    const ob = $('bizObs');
    if (ob && obs && (obs.headline || obs.summary)) {
      ob.style.display = '';
      ob.innerHTML = `<div class="h">🔭 现在：${esc(obs.headline || '')}</div><div class="s">${esc(obs.summary || '')}</div>`
        + (obs.alerts && obs.alerts.length ? `<div class="s" style="margin-top:6px;color:var(--e)">⚠️ ${obs.alerts.map(esc).join(' · ')}</div>` : '');
    }
    // todo-derived items carry an id → tickable; Living-State items are plain (auto-clear on re-ground)
    const mkTodo = (t) => ({ text: t.text, id: t.id });
    const mkMem = (x) => ({ text: String(x) });
    const cols = [
      { t: '🔴 需要你回复 / 处理', hot: true, items: [...(mem.waitingOnMe || []).map(mkMem), ...todos.filter((t) => t.kind === 'reply').map(mkTodo)] },
      { t: '🤝 你的承诺 / 待办', items: [...(mem.commitments || []).map(mkMem), ...todos.filter((t) => t.kind === 'promise').map(mkTodo)] },
      { t: '⏳ 在等别人', items: (mem.waitingOnThem || []).map(mkMem) },
      { t: '🚧 卡点', items: (mem.blockers || []).map(mkMem) },
      { t: '📌 未完成', items: (mem.openLoops || []).map(mkMem) },
    ];
    board.innerHTML = cols.map((c) => {
      const seen = new Set();
      const items = c.items.filter((x) => x && x.text && !seen.has(x.text) && seen.add(x.text)).slice(0, 8);
      // every item is tickable now: todo-derived ones (id) toggle done; Living-State ones (text) get dismissed
      const lis = items.length ? items.map((x) => x.id
        ? `<li class="tk" data-id="${encodeURIComponent(x.id)}"><span class="tkbox">○</span>${esc(x.text)}</li>`
        : `<li class="tk" data-text="${encodeURIComponent(x.text)}"><span class="tkbox">○</span>${esc(x.text)}</li>`).join('') : '<li class="tagm">暂无</li>';
      return `<div class="bizcol${c.hot ? ' hot' : ''}${items.length ? '' : ' empty'}"><h4>${c.t}<span class="cnt">${items.length}</span></h4><ul>${lis}</ul></div>`;
    }).join('');
    board.querySelectorAll('li.tk').forEach((el) => (el.onclick = async () => {
      if (el.dataset.done) return;                       // guard against double-tap
      el.dataset.done = '1'; el.style.opacity = '.4'; el.querySelector('.tkbox').textContent = '✓';
      try {
        if (el.dataset.id) await fetch('/api/reminders/' + el.dataset.id + '/toggle', { method: 'POST' });
        else if (el.dataset.text) await fetch('/api/living/dismiss', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: decodeURIComponent(el.dataset.text) }) });
      } catch {}
      setTimeout(renderBizHome, 450);
    }));
  }
  function renderBizChats(d) {
    const f = $('liveFeed'); if (!f) return;
    const sessions = (d.topSessions || []).slice().sort((a, b) => (b.last || 0) - (a.last || 0));
    f.innerHTML = sessions.map((s) => {
      const when = s.last ? new Date(s.last).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
      return `<div class="bizchat" data-sess="${esc(s.session)}"><div class="bc-name">${esc(s.name || s.session)}</div><div class="bc-meta">${s.count} 条 · 最近 ${when}</div></div>`;
    }).join('') || '<span class="tagm">暂无对话</span>';
    f.querySelectorAll('.bizchat').forEach((el) => (el.onclick = () => openBizChat(el.dataset.sess, d)));
    if ($('lfeedn')) $('lfeedn').textContent = `${sessions.length} 个对话`;
  }
  function openBizChat(sess, d) {
    const f = $('liveFeed'); if (!f) return;
    const name = (d.topSessions.find((s) => s.session === sess) || {}).name || sess;
    const msgs = (d.recent || []).filter((m) => m.session === sess).slice().reverse();
    const body = msgs.length
      ? msgs.map((m) => `<div class="bc-msg${m.isSend ? ' me' : ''}"><b>${m.isSend ? '我' : esc(m.senderName || name)}</b> ${esc(String(m.content).slice(0, 220))}</div>`).join('')
      : '<span class="tagm">最近没有新消息 — 历史都在「问它」里可查。</span>';
    f.innerHTML = `<div class="bc-back">← 返回全部对话</div><div class="bc-head">${esc(name)}</div>${body}`;
    f.querySelector('.bc-back').onclick = () => renderBizChats(d);
  }

  function render(d) {
    state = d;
    applyContext(d);
    if (isBiz) { renderBizChats(d); if (d.ai && d.ai.insight) brief(d.ai.insight, d.ai.insightAt); status(d.push); return; }
    kpis(d);
    $('lfeedn').textContent = `共 ${d.kpi.total} 条`;
    if (d.ai && d.ai.insight) brief(d.ai.insight, d.ai.insightAt);
    if (d.rel && d.rel.care) care(d.rel.care);
    // keep the feed in sync on every stats tick (pushFeed dedups) — the 25s weflow poll
    // adds messages that never come through the SSE push, so the feed must reconcile here
    if (d.recent) d.recent.slice().reverse().forEach(pushFeed);
    if (d.other && d.other.recent && $('otherFeed').children.length <= 1) {
      d.other.recent.slice().reverse().forEach(pushOther);
      if (d.other.recent[0]) { lastOtherChat = d.other.recent[0].sessionName; $('otherChatName').textContent = lastOtherChat; }
    }
    status(d.push);
  }
  function status(p) {
    if (!p) return;
    $('ldot').className = 'ldot' + (p.connected ? ' on' : '');
    $('lstat').textContent = p.connected ? `已连接 · ${p.info || ''}` : `连接中（${p.info || ''}）`;
  }

  // ---------- SSE ----------
  function connect() {
    const es = new EventSource('/stream');
    es.addEventListener('stats', (e) => render(JSON.parse(e.data)));
    es.addEventListener('message', (e) => { const m = JSON.parse(e.data); pushFeed(m); if (state) { state.kpi.total++; $('lfeedn').textContent = `共 ${state.kpi.total} 条`; } });
    es.addEventListener('other', (e) => { const o = JSON.parse(e.data); pushOther(o); lastOtherChat = o.sessionName; $('otherChatName').textContent = lastOtherChat; });
    es.addEventListener('insight', (e) => { const d = JSON.parse(e.data); brief(d.insight, d.at); if (isBiz) renderBizHome(); });
    es.addEventListener('reminders', (e) => { todos(JSON.parse(e.data)); if (isBiz) renderBizHome(); });
    es.addEventListener('approvals', () => { if (isBiz) renderBizHome(); });
    es.addEventListener('care', (e) => care(JSON.parse(e.data)));
    es.addEventListener('narrative', (e) => { lastNarrative = JSON.parse(e.data); renderNarrative(lastNarrative); });
    es.addEventListener('regen', (e) => renderRegen(JSON.parse(e.data)));
    es.addEventListener('checkup', (e) => renderCheckup(JSON.parse(e.data)));
    es.addEventListener('status', (e) => status(JSON.parse(e.data)));
    es.onerror = () => { $('lstat').textContent = '连接中断，重试…'; };
  }
  // wait for /api/space so the first render already uses the right names/template
  spaceReady.then(() => { connect(); renderTrends(); });

  // ai + corpus badges
  const AILABELS = { todos: ['待办提取', 'var(--calm)'], summary: ['实时观察', 'var(--g)'], ask: ['问它/顾问', '#39a0a8'], rag: ['问它检索', '#39a0a8'], census: ['逐条普查', '#3f8f6a'], title: ['对话标题', '#b0a0c0'], checkup: ['关系体检', '#c46b9e'], reply: ['回复草稿', 'var(--e)'], narrative: ['近期动态', '#9a7b3f'], archive: ['档案重生成', 'var(--warn)'], perspectives: ['视角重生成', '#bc6bff'], sentiment: ['情感分析', '#888'], other: ['其他', '#aaa'] };
  function renderUsage(a) {
    if (!$('aiUsage')) return;
    const d = a.daily || { byLabel: {}, cost: 0, calls: 0 };
    const rows = Object.entries(d.byLabel || {}).sort((x, y) => y[1].cost - x[1].cost);
    if ($('aiCostTop')) $('aiCostTop').textContent = `${d.calls} 次 · ¥${(d.cost || 0).toFixed(3)} · 上限 ${a.used}/${a.cap}·时`;
    if (!rows.length) { $('aiUsage').innerHTML = '<span class="tagm">今日还没有 AI 调用</span>'; return; }
    const head = `<div class="us"><div class="hd"><span>功能</span><span class="rt">次数</span><span class="rt">tokens(in/out)</span><span class="rt">¥</span></div>`;
    const body = rows.map(([k, v]) => {
      const meta = AILABELS[k] || [k, '#aaa'];
      return `<div class="usr"><span class="nm"><i class="usdot" style="background:${meta[1]}"></i>${meta[0]}</span>
        <span class="rt">${v.calls}</span><span class="rt">${(v.in / 1000).toFixed(1)}k / ${(v.out / 1000).toFixed(1)}k</span><span class="rt">¥${v.cost.toFixed(3)}</span></div>`;
    }).join('');
    const tot = `<div class="ustot"><span>今日合计</span><span class="big">¥${(d.cost || 0).toFixed(3)}</span></div>`;
    $('aiUsage').innerHTML = head + body + '</div>' + tot;
  }
  function poll() {
    fetch('/api/ai').then((r) => r.json()).then((a) => {
      // guard each element — a missing one must NOT block renderUsage (that was the perma-loading bug)
      const set = (id, txt) => { const el = $(id); if (el) el.textContent = txt; };
      set('lai', `${a.enabled ? a.model : 'AI 关闭'} · ${a.used}/${a.cap}·h · 今日¥${(a.daily?.cost || 0).toFixed(2)}`);
      set('lvoice', '🎙 语音');
      set('corpusN', `${a.corpus} 条聊天记录`);
      renderUsage(a);
    }).catch(() => {});
  }
  poll(); setInterval(poll, 8000);
  setInterval(() => { $('lclock').textContent = new Date().toLocaleTimeString('zh-CN'); }, 1000);

  // ---------- make the analysis tabs (总览 + 热力图 + 标题) advance live ----------
  function daysBetween(from, to) { return Math.floor((to - new Date(from + 'T00:00:00')) / 86400000) + 1; }
  function setChart(id, labels, datasets) {
    const c = (window.Chart && Chart.getChart) ? Chart.getChart(id) : null;
    if (!c) return;
    if (labels) c.data.labels = labels;
    datasets.forEach((d, i) => { if (c.data.datasets[i]) c.data.datasets[i].data = d; });
    c.update('none');
  }
  const lvl = (s) => s <= 0 ? 0 : s < 5 ? 1 : s < 15 ? 2 : s < 35 ? 3 : s < 75 ? 4 : 5;
  function pad(n) { return String(n).padStart(2, '0'); }
  function rebuildHeatmap(a, startStr) {
    const grid = $('hmGrid'), months = $('hmMonths');
    if (!grid) return;
    grid.innerHTML = ''; months.innerHTML = '';
    const start = new Date(startStr + 'T12:00:00');
    const end = new Date(); end.setHours(12, 0, 0, 0);
    const first = new Date(start); first.setDate(first.getDate() - first.getDay());
    const mN = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
    let col = 0, lastMonth = -1;
    for (let d = new Date(first); d <= end; d.setDate(d.getDate() + 1)) {
      if (d.getDay() === 0 && d > first) col++;
      const ds = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      const cell = document.createElement('i');
      if (d < start) { cell.className = 'hm-cell lfuture'; grid.appendChild(cell); continue; }
      if (d.getMonth() !== lastMonth && d.getDate() <= 7) {
        lastMonth = d.getMonth();
        const lab = document.createElement('span'); lab.textContent = mN[lastMonth]; lab.style.left = (col * 17) + 'px'; months.appendChild(lab);
      }
      const has = a.daily[ds] !== undefined;
      if (!has) { cell.className = 'hm-cell lnone clickable'; cell.dataset.info = ds + ' · 无消息'; }
      else { const s = a.conflictScore[ds] || 0; cell.className = 'hm-cell clickable l' + lvl(s); cell.dataset.info = `${ds} · ${a.daily[ds]} 条 · 冲突强度 ${s}`; }
      const tip = $('hmTip');
      cell.onmouseenter = () => tip && (tip.textContent = cell.dataset.info);
      cell.onclick = () => tip && (tip.textContent = cell.dataset.info);
      grid.appendChild(cell);
    }
  }
  async function pollAnalytics() {
    try {
      const a = await (await fetch('/api/analytics')).json();
      // dates: prefer /api/space, then the analytics target; never invent a default
      const t = Object.assign({}, a.target || {}, SPACE.target || {});
      const validDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
      const daily = a.daily || {};
      const dayKeys = Object.keys(daily).sort();
      setChart('cDaily', dayKeys, [dayKeys.map((k) => daily[k])]);
      setChart('cMonthly', a.labels, [a.mG, a.mE]);
      setChart('cSorry', a.labels, [a.sG, a.sE]);
      setChart('cLove', a.labels, [a.lG, a.lE]);
      setChart('cNight', a.labels, [a.night]);
      const hmStart = validDate(t.firstContactDate) ? t.firstContactDate : dayKeys[0];
      if (hmStart) rebuildHeatmap({ daily, conflictScore: a.conflictScore || {} }, hmStart);
      renderAnaKpis(a);
      if (isBiz) return;
      // header subtitle: day counts only when the dates are actually configured
      const sub = document.querySelector('header p');
      if (sub) {
        const parts = [];
        if (validDate(t.firstContactDate)) parts.push(`${t.firstContactDate.replace(/-/g, '.')} 起 · 我们这 <b>${daysBetween(t.firstContactDate, new Date())}</b> 天`);
        if (validDate(t.togetherDate)) parts.push(`正式在一起第 <b>${daysBetween(t.togetherDate, new Date())}</b> 天`);
        if (a.totalMsgs != null) parts.push(`${Number(a.totalMsgs).toLocaleString()} 条消息`);
        parts.push('实时');
        sub.innerHTML = parts.join(' · ');
      }
    } catch {}
  }
  // 总览 KPI tiles, computed from the same analytics payload
  function renderAnaKpis(a) {
    const box = $('anaKpis'); if (!box) return;
    const sum = (arr) => (Array.isArray(arr) ? arr.reduce((s, x) => s + (Number(x) || 0), 0) : 0);
    const mG = sum(a.mG), mE = sum(a.mE), tot = a.totalMsgs != null ? Number(a.totalMsgs) : mG + mE;
    if (!tot) { box.innerHTML = ''; return; }
    const pct = (x) => (mG + mE ? Math.round((x / (mG + mE)) * 100) : 0);
    const tiles = [
      { n: tot.toLocaleString(), l: `消息总数（${esc(meN())} ${pct(mG)}% / ${esc(tgN())} ${pct(mE)}%）` },
      { n: `${sum(a.sG)} : ${sum(a.sE)}`, l: `"对不起"次数 ${esc(meN())} : ${esc(tgN())}` },
      { n: `${sum(a.lG)} : ${sum(a.lE)}`, l: `"爱你/想你"次数 ${esc(meN())} : ${esc(tgN())}` },
    ];
    box.innerHTML = tiles.map((x) => `<div class="card kpi"><div class="num">${x.n}</div><div class="lbl">${x.l}</div></div>`).join('');
  }
  spaceReady.then(pollAnalytics); setInterval(pollAnalytics, 12000);

  // ---------- upcoming festivals & milestones (optional 'occasions' plugin) ----------
  async function pollOccasions() {
    const box = $('occasions'); if (!box) return;
    if (isBiz || !hasPlugin('occasions')) { box.innerHTML = ''; box.style.display = 'none'; return; }
    box.style.display = '';
    try {
      const o = await (await fetch('/api/p/occasions/upcoming')).json();
      const list = (o.upcoming || []).slice(0, 4);
      if (!list.length) { box.innerHTML = ''; return; }
      box.innerHTML = list.map((it) => {
        const soon = it.daysUntil <= 10;
        const when = it.daysUntil === 0 ? '就是今天！' : it.daysUntil === 1 ? '明天' : `还有 ${it.daysUntil} 天`;
        const icon = it.type === 'festival' ? '🎉' : it.type === 'anniversary' ? '💞' : it.type === 'monthly' ? '📅' : '🎯';
        return `<div class="occ ${soon ? 'soon' : ''}">
          <div class="nm">${icon} ${esc(it.name)}</div>
          <div class="cd">${esc(it.date)} · <span class="${soon ? 'big' : ''}">${when}</span></div>
          ${it.gift || soon ? `<div class="gf">${it.gift ? '🎁 ' + esc(it.gift) : ''}${soon ? '　<b style="color:var(--warn)">该准备了</b>' : ''}</div>` : ''}
        </div>`;
      }).join('');
    } catch {}
  }
  { const occ = $('occasions'); if (occ) occ.style.display = 'none'; }
  spaceReady.then(() => {
    if (!hasPlugin('occasions')) return;
    pollOccasions(); setInterval(pollOccasions, 60000);
  });

  // ---------- gamification (闯关) ----------
  function renderGame(g) {
    const L = g.level, nx = g.next;
    const trendTxt = g.trend > 2 ? `📈 比上周 +${g.trend}` : g.trend < -2 ? `📉 比上周 ${g.trend}` : '➡ 与上周持平';
    $('gameMain').innerHTML = `<div class="lvcard">
      <div class="lvtop">
        <div class="lvicon">${L.icon}</div>
        <div style="flex:1">
          <div class="lvname">Lv.${L.index + 1} ${esc(L.name)}</div>
          <div class="lvsub">${esc(L.tip)} · ${trendTxt}</div>
          <div class="hbar"><div class="hfill" style="width:${g.health}%"></div></div>
          <div class="lvsub">健康值 <b>${g.health}</b>/100 ${nx ? `· 距「${esc(nx.name)}」还需 ${Math.max(0, nx.min - g.health)}` : '· 已满级 🎉'}</div>
        </div>
      </div>
      <div class="gstats">
        <div class="gstat"><div class="n" style="color:var(--calm)">${g.streak}</div><div class="l">连续平静天数</div></div>
        <div class="gstat"><div class="n">${g.weeklyXP >= 0 ? '+' : ''}${g.weeklyXP}</div><div class="l">本周经验</div></div>
        <div class="gstat"><div class="n" style="color:${g.todaySettle >= 0 ? 'var(--calm)' : 'var(--warn)'}">${g.todaySettle >= 0 ? '+' : ''}${g.todaySettle}</div><div class="l">今日结算</div></div>
        <div class="gstat"><div class="n" style="color:${g.calmToday >= 35 ? 'var(--warn)' : 'var(--ink)'}">${g.calmToday}</div><div class="l">今日冲突强度</div></div>
        <div class="gstat"><div class="n" style="color:var(--g)">+${g.questXP}</div><div class="l">今日任务经验</div></div>
      </div></div>`;
    $('quests').innerHTML = g.quests.map((q) =>
      `<div class="quest ${q.done ? 'done' : ''} ${q.manual ? 'manual' : 'auto'}" data-q="${q.id}">
        <div class="qchk">${q.done ? '✓' : ''}</div>
        <div class="qtx">${q.icon} ${esc(q.text)}</div>
        <div class="qxp">${q.manual ? '' : '自动 '}+${q.xp}</div></div>`).join('');
    document.querySelectorAll('#quests .quest.manual').forEach((el) => el.onclick = () =>
      fetch(`/api/game/quest/${el.dataset.q}/toggle`, { method: 'POST' }).then(() => pollGame()));
    $('badges').innerHTML = (g.badges || []).map((b) =>
      `<span class="badge ${b.got ? '' : 'locked'}">${b.icon} ${esc(b.name)}</span>`).join('') || '<span class="tagm">还没有成就，去完成任务吧</span>';
  }
  // compact care-aware strip shown at the top of 今天
  function renderStrip(g) {
    const el = $('gameStrip'); if (!el) return;
    const careRecent = state && state.rel && state.rel.care;
    const soft = g.health < 40 || careRecent;
    const L = g.level;
    let right;
    if (soft) {
      right = `<div class="gsub" style="flex:1">${careRecent ? '今天先照顾好情绪，安全和感受比分数重要。慢慢来。' : '最近有点辛苦，一步一步来，稳住就是进步。'}</div>`;
    } else {
      right = `<div class="gbar"><div class="f" style="width:${g.health}%"></div></div>
        <div class="gpill">🕊️ ${g.streak} 天平静</div>
        <div class="gpill" style="color:${g.todaySettle >= 0 ? 'var(--calm)' : 'var(--warn)'}">今日 ${g.todaySettle >= 0 ? '+' : ''}${g.todaySettle}</div>`;
    }
    el.className = 'gstrip' + (soft ? ' soft' : '');
    el.innerHTML = `<div class="gi">${soft ? '🌱' : L.icon}</div>
      <div><div class="gl">Lv.${L.index + 1} ${esc(L.name)}</div><div class="gsub">健康值 ${g.health}/100</div></div>
      ${right}
      <a class="gmore" id="toGame">闯关详情 →</a>`;
    const t = $('toGame'); if (t) t.onclick = () => document.querySelector('nav button[data-g="game"]').click();
  }
  async function pollGame() { try { const g = await (await fetch('/api/game')).json(); renderGame(g); renderStrip(g); } catch {} }
  pollGame(); setInterval(pollGame, 15000);

  // ---------- narrative "近期动态" injected into analysis tabs ----------
  function renderNarrative(n) {
    if (!n || !n.at) return;
    const when = new Date(n.at).toLocaleString('zh-CN');
    const box = (title, inner) => `<div class="narbox"><div class="h">🔄 近期动态 · ${title}<small>AI 每 12h 更新 · ${when}</small></div>${inner}</div>`;
    // 档案 t3: new episodes
    if (n.newEpisodes && n.newEpisodes.length) {
      $('narT3').innerHTML = box('新的记录', n.newEpisodes.map((e) => `<p><b>${esc(e.date || '')} ${esc(e.title || '')}</b><br>${esc(e.body || '')}</p>`).join(''));
    } else if ($('narT3')) $('narT3').innerHTML = box('新的记录', `<p>${esc(n.digest || '最近没有新的显著争执。')}</p>`);
    // 视角 t4 + 循环 t5: pattern shift
    const ps = n.patternShift ? `<p>${esc(n.patternShift)}</p>` : `<p>${esc(n.digest || '')}</p>`;
    if ($('narT4')) $('narT4').innerHTML = box('相处模式的最新变化', ps);
    if ($('narT5')) $('narT5').innerHTML = box('循环的最新观察', ps + (n.actions?.length ? '<ul>' + n.actions.map((a) => `<li>${esc(a)}</li>`).join('') + '</ul>' : ''));
    // 最重要的一页 t6: care signal
    if ($('narT6')) $('narT6').innerHTML = n.careSignal
      ? box('最新情绪信号', `<p style="color:var(--warn)">${esc(n.careSignal)}</p>`)
      : box('最新情绪信号', '<p>最近没有检测到需要特别担心的信号。</p>');
  }
  let lastNarrative = null;
  async function pollNarrative() { try { lastNarrative = await (await fetch('/api/narrative')).json(); renderNarrative(lastNarrative); } catch {} }
  pollNarrative(); setInterval(pollNarrative, 60000);

  // ---------- fully-regenerated 档案 + 视角 (daily 8pm) ----------
  const escNL = (s) => esc(s).replace(/\n/g, '<br>');
  function renderRegen(r) {
    if (!r) return;
    const when = r.at ? new Date(r.at).toLocaleString('zh-CN') : '';
    if (r.archive && r.archive.episodes && r.archive.episodes.length && $('eps')) {
      $('eps').innerHTML =
        `<div class="narbox"><div class="h">🔄 AI 重新生成的争执档案<small>每天 20:00 更新 · ${when}</small></div></div>` +
        r.archive.episodes.map((e) =>
          `<details><summary><span style="color:var(--sub);font-size:13px">${esc(e.date)}</span> ${esc(e.tag)}</summary><div class="body">${escNL(e.body)}</div></details>`
        ).join('');
    }
    if (r.perspectives && $('t4')) {
      const p = r.perspectives;
      const ul = (a) => `<ul>${(a || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
      $('t4').innerHTML =
        `<div id="narT4"></div>
         <div class="narbox"><div class="h">🔄 AI 重新生成的双方视角<small>每天 20:00 更新 · ${when}</small></div>
           <p style="font-size:13px;color:var(--sub)">对称呈现，不站队。先读自己那栏的"盲区"，再读对方的"合理之处"。</p></div>
         <div class="fair">
           <div class="card"><h3><span class="pill pillE">${esc(tgN())}</span>${esc(tgP())}的视角</h3>
             <div class="good">✓ 合理的部分</div>${ul(p.themValid)}
             <div class="bad">△ 喂养循环的部分</div>${ul(p.themCycle)}</div>
           <div class="card"><h3><span class="pill pillG">${esc(meN())}</span>我的视角</h3>
             <div class="good">✓ 合理的部分</div>${ul(p.meValid)}
             <div class="bad">△ 喂养循环的部分</div>${ul(p.meCycle)}</div>
         </div>
         <div class="card" style="margin-top:14px"><h3>同样真实的：这段关系拥有的东西</h3>${ul(p.shared)}</div>`;
      if (lastNarrative) renderNarrative(lastNarrative); // refill narT4
    }
  }
  async function pollRegen() { try { renderRegen(await (await fetch('/api/regen')).json()); } catch {} }
  spaceReady.then(pollRegen); setInterval(pollRegen, 60000);
})();
