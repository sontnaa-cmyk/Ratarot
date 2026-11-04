// Điều phối màn hình Live 9:16: hai sảnh lớn (15 người/sảnh), avatar khung viền tinh tế,
// vào sảnh vái lạy 3 cái, Thần Ra xào/rút/lật bài, claim hiện bài bên cạnh avatar, thông báo quà tự ẩn chuẩn xác.
(() => {
  const $ = (id) => document.getElementById(id);
  const stage = $('stage'), peopleEl = $('people'), cardsEl = $('cards'), lanternsEl = $('lanterns');
  const params = new URLSearchParams(location.search);
  if (params.get('obs')) document.body.classList.add('obs');
  const fit = () => { stage.style.transform = `scale(${Math.min(innerWidth / 1080, innerHeight / 1920)})`; };
  addEventListener('resize', fit); fit();

  const people = new Map();           // key -> {el, x, y}
  let S = null, likes = 0, energy = 0, reading = null, timers = [];
  let bannerTimer = null;             // Bộ đếm thời gian tự ẩn thông báo tặng quà
  const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.push(t); return t; };
  const hue = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 0);
  const DECK = [540, 880], CARD_AR = 527 / 300;
  const orb = () => (window.RaPuppet ? RaPuppet.orb : [344, 201]);
  const cast = (k) => window.RaPuppet && RaPuppet.cast(k);

  // ---------- Vị trí (tâm avatar) — Mở rộng Sảnh Chờ lên 15 người mỗi sảnh (5 cột x 3 hàng) ----------
  const L = [[78, 360], [182, 360], [78, 495]], R = [[1002, 360], [898, 360], [1002, 495]];
  const MAX_LOBBY_SHOW = 15;
  const slot = {
    priority: (i) => ({ x: 74 + (i % 5) * 98, y: 1475 + Math.floor(i / 5) * 98, s: 0.94 }),
    normal:   (i) => ({ x: 614 + (i % 5) * 98, y: 1475 + Math.floor(i / 5) * 98, s: 0.94 }),
    gift:     (i) => {
      const p = [[330, 1135], [750, 1135], [225, 1205], [855, 1205]][i] || [540, 1190];
      return { x: p[0], y: p[1], s: 1.12 };
    },
    spot:     { x: 540, y: 1115, s: 1.42 },
    done:     (i) => {
      const p = (i % 2 ? R : L)[i >> 1] || (i % 2 ? R : L)[2];
      return { x: p[0], y: p[1], s: 0.95 };
    },
  };

  // ---------- Nhân vật: Chỉ dùng Avatar tròn và khung viền sang trọng (đã bỏ hoàn toàn phần thân lỗi) ----------
  function makePerson(p) {
    const h = hue(p.key), el = document.createElement('div');
    el.className = 'pp';
    el.style.setProperty('--h', h);
    const ini = (p.user || '?').trim().charAt(0).toUpperCase();

    el.innerHTML = `
      <div class="pp-ped"></div>
      <div class="pp-ring"></div>
      <div class="pp-av">
        <span>${ini}</span>
        ${p.avatar ? `<img src="${p.avatar.replace(/"/g, '')}" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}
      </div>
      <div class="pp-pray">🙏</div>
      <div class="pp-cards-wrap"></div>
      <div class="pp-name"></div>
      <div class="pp-tag" hidden></div>
    `;
    el.querySelector('.pp-name').textContent = p.user;
    peopleEl.appendChild(el);
    return el;
  }

  const tf = (x, y, s) => `translate(${x - 50}px,${y - 36}px) scale(${s})`;

  // Hiệu ứng vái lạy 3 cái khi vừa bước vào sảnh chờ
  function triggerBow3(el) {
    if (!el) return;
    el.classList.remove('bow3');
    void el.offsetWidth; // Force reflow
    el.classList.add('bow3');
    clearTimeout(el.bowT);
    el.bowT = setTimeout(() => el.classList.remove('bow3'), 2600);
  }

  function renderPersonCards(el, cardIds) {
    const wrap = el.querySelector('.pp-cards-wrap');
    if (!wrap) return;
    if (!cardIds || !cardIds.length) {
      wrap.innerHTML = '';
      return;
    }
    const sig = cardIds.join(',');
    if (wrap.dataset.sig === sig) return;
    wrap.dataset.sig = sig;
    wrap.innerHTML = cardIds.map((cid, idx) =>
      `<img class="pp-card" style="--idx:${idx}" src="/cards/${cid}.jpg" alt="">`
    ).join('');
  }

  function place(key, w) {
    let o = people.get(key);
    let isNewInLobby = false;
    if (!o) {
      const el = makePerson(w.p);
      o = { el, x: null, y: null, inLobby: false };
      el.style.transition = 'none';
      el.style.transform = tf(w.x, 2020, w.s);
      el.getBoundingClientRect();
      el.style.transition = '';
      people.set(key, o);
      if (w.cls.includes('lob')) isNewInLobby = true;
    } else if (!o.inLobby && w.cls.includes('lob')) {
      isNewInLobby = true;
    }
    o.inLobby = w.cls.includes('lob');

    if (o.x !== w.x || o.y !== w.y) {
      o.el.classList.add('walking');
      clearTimeout(o.wt);
      o.wt = setTimeout(() => {
        o.el.classList.remove('walking');
        if (isNewInLobby) triggerBow3(o.el);
      }, 2200);
      o.el.style.transform = tf(w.x, w.y, w.s);
      o.x = w.x; o.y = w.y;
    } else if (isNewInLobby) {
      triggerBow3(o.el);
    }

    ['lob', 'pri', 'nor', 'gift', 'done', 'cur'].forEach((c) => o.el.classList.remove(c));
    w.cls.split(' ').forEach((c) => o.el.classList.add(c));

    const tag = o.el.querySelector('.pp-tag');
    tag.hidden = !w.tag;
    tag.textContent = w.tag || '';

    renderPersonCards(o.el, w.cards);
  }

  function sync(st) {
    S = st;
    const want = new Map();
    st.lobby.priority.slice(0, MAX_LOBBY_SHOW).forEach((p, i) =>
      want.set(p.key, { p, ...slot.priority(i), tag: '#' + (i + 1), cls: 'lob pri' })
    );
    st.lobby.normal.slice(0, MAX_LOBBY_SHOW).forEach((p, i) =>
      want.set(p.key, { p, ...slot.normal(i), tag: '#' + (i + 1), cls: 'lob nor' })
    );
    st.giftQueue.slice(0, 4).forEach((p, i) =>
      want.set(p.key, { p, ...slot.gift(i), tag: p.coins + ' xu', cls: 'gift' })
    );
    st.done.slice(0, 6).forEach((d, i) =>
      want.set(d.key, { p: d, ...slot.done(i), cls: 'done', cards: d.claimed ? d.cardIds : null })
    );
    if (st.current) {
      want.set(st.current.key, {
        p: st.current, ...slot.spot, cls: 'cur',
        cards: st.current.claimed ? st.current.cardIds : null
      });
    }

    for (const [k, o] of people) {
      if (!want.has(k)) {
        o.el.classList.add('gone');
        const el = o.el;
        setTimeout(() => el.remove(), 700);
        people.delete(k);
      }
    }
    for (const [k, w] of want) place(k, w);

    const lp = st.lobby.priority.length, ln = st.lobby.normal.length;
    $('cntPri').textContent = lp > MAX_LOBBY_SHOW ? `${MAX_LOBBY_SHOW}/${lp}` : lp;
    $('cntNor').textContent = ln > MAX_LOBBY_SHOW ? `${MAX_LOBBY_SHOW}/${ln}` : ln;

    if ($('dockBtnAuto')) {
      $('dockBtnAuto').textContent = st.settings.autoSim ? '🤖 Tự động demo: BẬT' : '🤖 Tự động demo: TẮT';
    }

    RaAudio.setVolumes(st.settings.musicVolume, st.settings.ttsVolume, st.settings.ttsEnabled);
    if (st.settings.ttsVoice) RaAudio.setVoice(st.settings.ttsVoice);
    if (st.settings.bgmUrl) RaAudio.loadBgmUrl(st.settings.bgmUrl);
  }

  // ---------- Lá bài: Xào → Rút → Lật 3D ----------
  const cardBox = (n) => { const w = n === 1 ? 236 : n === 2 ? 208 : 196; return { w, h: Math.round(w * CARD_AR) }; };
  const spread = (n, i) => ({ x: 540 + (i - (n - 1) / 2) * (n === 1 ? 0 : n === 2 ? 236 : 222), y: DECK[1] + (n === 3 && i !== 1 ? 14 : 0), rot: n === 3 ? (i - 1) * 5.5 : n === 2 ? (i - 0.5) * 5 : 0 });
  const place2 = (w, h, x, y, rot = 0, s = 1) => `translate(${x - w / 2}px,${y - h / 2}px) rotate(${rot}deg) scale(${s})`;

  function makeCard(c, w, h, mode) {
    const el = document.createElement('div');
    el.className = 'card' + (mode === 'shown' ? ' shown' : '');
    el.style.width = w + 'px'; el.style.height = h + 'px';
    el.innerHTML = `<div class="in"><img class="back" src="/cards/back.jpg">${c ? `<img class="front" src="${c.image}"><div class="lbl"><b>${(c.vn || '').replace(/</g, '')}</b><small>${(c.keywords || '').split(' · ')[0]}</small></div>` : ''}<div class="shine"></div></div>`;
    cardsEl.appendChild(el);
    return el;
  }

  const ease = (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
  const easeOut = (k) => 1 - Math.pow(1 - k, 3);
  function tween(ms, ev, fn, done) {
    const t0 = performance.now();
    (function f(now) {
      if (reading !== ev) return;
      const k = Math.min(1, (now - t0) / ms);
      fn(k);
      k < 1 ? requestAnimationFrame(f) : done && done();
    })(t0);
  }

  function wave(x, y) {
    const e = document.createElement('div'); e.className = 'wave';
    e.style.left = x + 'px'; e.style.top = y + 'px';
    stage.appendChild(e); setTimeout(() => e.remove(), 1000);
  }

  function beam(x0, y0, x1, y1) {
    const e = document.createElement('div'); e.className = 'beam';
    const len = Math.hypot(x1 - x0, y1 - y0), a = Math.atan2(y1 - y0, x1 - x0);
    e.style.cssText = `left:${x0}px;top:${y0}px;width:${len}px;--r:rotate(${a}rad)`;
    stage.appendChild(e); setTimeout(() => e.remove(), 900);
  }

  function shuffle(ev) {
    const N = 9, { w, h } = cardBox(1);
    const stack = (i) => place2(w, h, DECK[0] + (i - N / 2) * 1.2, DECK[1] - (i - N / 2) * 1.6, 0, 0.72);
    for (let i = 0; i < N; i++) {
      const el = makeCard(null, w, h, 'back'); el.classList.add('deck');
      el.style.opacity = 0; el.style.transform = stack(i);
      const dir = i % 2 ? 1 : -1;
      const split = place2(w, h, DECK[0] + dir * 150, DECK[1] - 10 + (i >> 1) * -3, dir * 9, 0.72);
      const up = place2(w, h, DECK[0] + dir * 60, DECK[1] - 90 - (i >> 1) * 4, dir * 18, 0.78);
      el.animate([
        { opacity: 0, transform: place2(w, h, DECK[0], DECK[1] + 60, 0, 0.3) },
        { opacity: 1, transform: stack(i), offset: 0.14 },
        { transform: split, offset: 0.3 },
        { transform: stack(i), offset: 0.46 },
        { transform: up, offset: 0.6 },
        { transform: split, offset: 0.72 },
        { transform: stack(i), offset: 0.88 },
        { transform: stack(i) }
      ], { duration: 2300, delay: 300 + i * 22, fill: 'forwards', easing: 'ease-in-out' });
    }
    later(() => { FX.burst(DECK[0], DECK[1], 'cyan', 40, 6); cast(0.5); }, 350);
    later(() => RaAudio.riffle(), 700);
    later(() => RaAudio.riffle(), 1500);
  }

  function drawCard(ev, i) {
    const n = ev.cards.length, c = ev.cards[i], { w, h } = cardBox(n), sp = spread(n, i);
    const el = makeCard(c, w, h, 'back');
    el.style.opacity = 0; el.style.transform = place2(w, h, DECK[0], DECK[1], -8, 0.72);
    const [ox, oy] = orb(); beam(ox, oy, DECK[0], DECK[1]); cast(1);
    FX.burst(ox, oy, 'gold', 36, 7); RaAudio.whoosh();
    const cx = (DECK[0] + sp.x) / 2 + (i % 2 ? 70 : -70), cy = DECK[1] - 260;
    tween(1000, ev, (k) => {
      const e = ease(k);
      const x = (1 - e) * (1 - e) * DECK[0] + 2 * (1 - e) * e * cx + e * e * sp.x;
      const y = (1 - e) * (1 - e) * DECK[1] + 2 * (1 - e) * e * cy + e * e * sp.y;
      const s = 0.72 + 0.28 * easeOut(k) + Math.sin(k * Math.PI) * 0.12;
      el.style.opacity = Math.min(1, k * 6);
      el.style.transform = place2(w, h, x, y, -8 + (sp.rot + 8) * e + Math.sin(k * Math.PI * 2) * 6, s);
      if (k < 0.95) FX.burst(x, y, 'gold', 1, 1.6);
    }, () => {
      el.style.transform = place2(w, h, sp.x, sp.y, sp.rot, 1);
      el.classList.add('charge'); wave(sp.x, sp.y);
    });

    later(() => {
      el.classList.remove('charge');
      el.classList.add('flip', 'glowup');
      wave(sp.x, sp.y);
      FX.burst(sp.x, sp.y, 'gold', 50, 9);
      FX.burst(sp.x, sp.y, i % 2 ? 'pink' : 'cyan', 36, 7);
      RaAudio.flip(); RaAudio.sparkle(); cast(0.6);
    }, 1500);

    later(() => el.classList.remove('glowup'), 2500);
    if (i === n - 1) later(() => document.querySelectorAll('.card.deck').forEach((d) => {
      d.style.transition = 'opacity .8s'; d.style.opacity = 0;
      setTimeout(() => d.remove(), 900);
    }), 600);
  }

  function showCaption(tierLabel, who, lines, ms) {
    const cap = $('caption');
    if ($('capTier')) $('capTier').textContent = tierLabel || 'THÔNG ĐIỆP BÀI TAROT';
    $('capWho').textContent = who;
    cap.classList.add('show');
    const total = lines.reduce((s, l) => s + l.length, 0) || 1;
    let t = 0;
    lines.forEach((l) => {
      later(() => { $('capText').textContent = l; }, t);
      t += ms * (l.length / total);
    });
  }

  const hideCaption = () => $('caption').classList.remove('show');

  function startReading(ev) {
    clearTimers(); cardsEl.innerHTML = ''; reading = ev;
    const n = ev.cards.length; shuffle(ev);
    ev.cards.forEach((_, i) => later(() => drawCard(ev, i), ev.walkMs + i * ev.dealMs));
    later(() => {
      const qSub = ev.question ? ` • HỎI: "${ev.question}"` : '';
      showCaption(ev.tierLabel || 'QUẺ BÀI THIÊN MỆNH', `THẦN RA ĐỌC BÀI CHO ${ev.user.toUpperCase()}${qSub}`, ev.lines, ev.speakMs);
      RaAudio.chime();
      RaAudio.speak(ev.audioUrl, ev.speech, ev.speakMs, ev.voice, ev.ttsAllowed !== false);
    }, ev.walkMs + n * ev.dealMs);
  }

  function clearTimers() { timers.forEach(clearTimeout); timers = []; }

  function endReading(ev) {
    clearTimers(); hideCaption(); RaAudio.stopSpeech(); reading = null;
    const els = [...cardsEl.querySelectorAll('.card:not(.deck)')];
    cardsEl.querySelectorAll('.deck').forEach((d) => d.remove());
    if (ev.claimed) setTimeout(() => flyTo(els, ev.key, ev.cardIds), 250);
    else els.forEach((el) => {
      el.style.transition = 'opacity 1s,translate 1s';
      el.style.opacity = 0; el.style.translate = '0 -140px';
      setTimeout(() => el.remove(), 1100);
    });
  }

  function flyTo(els, key, cardIds) {
    const o = people.get(key), tx = o ? o.x : 540, ty = o ? o.y : 900;
    els.forEach((el, i) => setTimeout(() => {
      const w = el.offsetWidth, h = el.offsetHeight;
      el.style.transition = 'transform 1.05s cubic-bezier(.5,0,.8,.4),opacity 1.05s';
      el.style.transform = place2(w, h, tx, ty, 340, 0.14);
      el.style.opacity = 0.2;
      FX.burst(tx, ty, 'gold', 26, 6);
      setTimeout(() => {
        el.remove();
        const target = people.get(key);
        if (target && cardIds) renderPersonCards(target.el, cardIds);
      }, 1050);
    }, i * 160));
    RaAudio.sparkle();
  }

  // Claim: Lá bài vừa trải bay về và hiển thị ngay bên cạnh avatar người đó
  function claim(ev) {
    const o = people.get(ev.key);
    if (o && ev.cardIds) {
      renderPersonCards(o.el, ev.cardIds);
      FX.burst(o.x, o.y, 'gold', 35, 7);
    }
    if (!ev.immediate) {
      const n = ev.cardIds.length, w = 140, h = Math.round(140 * CARD_AR);
      const els = ev.cardIds.map((id, i) => {
        const el = makeCard({ image: `/cards/${id}.jpg`, vn: '', keywords: '' }, w, h, 'shown');
        el.style.transform = place2(w, h, 540 + (i - (n - 1) / 2) * 105, 880, 0, 0.1);
        el.style.transition = 'transform .65s cubic-bezier(.2,.9,.3,1)';
        el.getBoundingClientRect();
        el.style.transform = place2(w, h, 540 + (i - (n - 1) / 2) * 105, 880, 0, 1);
        return el;
      });
      FX.burst(540, 880, 'gold', 40, 7);
      wave(540, 880); cast(0.6);
      setTimeout(() => flyTo(els, ev.key, ev.cardIds), 800);
    } else {
      RaAudio.sparkle();
    }
  }

  // ---------- Đèn hoa đăng / Vái lạy 3 cái / Thông báo quà tặng tự ẩn ----------
  function lantern(ev) {
    const o = people.get(ev.key);
    if (o) triggerBow3(o.el);
    while (lanternsEl.children.length > 14) lanternsEl.firstChild.remove();
    const x = o ? o.x - 28 : 200 + Math.random() * 600, y = o ? o.y - 70 : 1460;
    const el = document.createElement('div'); el.className = 'lantern';
    el.style.cssText = `--x0:${x}px;--y0:${y}px;--dx:${Math.round(Math.random() * 200 - 100)}px;left:0;top:0`;
    el.innerHTML = '<div class="lamp"></div><small></small>';
    el.querySelector('small').textContent = `${ev.user}: ${ev.wish.slice(0, 48)}`;
    lanternsEl.appendChild(el); setTimeout(() => el.remove(), 11500);
    FX.burst(x + 28, y, 'gold', 14, 3);
  }

  function pray(ev) {
    energy = Math.min(1, energy + Math.min(ev.count || 1, 10) * 0.02); likes += (ev.count || 1);
    const o = people.get(ev.key); if (!o) return;
    o.el.classList.add('pray'); clearTimeout(o.pt);
    o.pt = setTimeout(() => o.el.classList.remove('pray'), 2500);
    FX.burst(o.x, o.y, 'pink', 8, 3.5);
  }

  function bow3(ev) {
    const o = people.get(ev.key);
    if (!o) return;
    triggerBow3(o.el);
    FX.burst(o.x, o.y, 'gold', 16, 4.5);
  }

  // Sửa triệt để lỗi thông báo tặng quà không tự ẩn sau vài giây
  function giftBanner(ev) {
    const b = $('banner'), n = ev.tier || 1;
    if (bannerTimer) {
      clearTimeout(bannerTimer);
      bannerTimer = null;
    }
    b.classList.remove('show');
    void b.offsetWidth; // Force reflow để animation luôn chạy mượt
    b.className = 'banner t' + n + ' show';
    const qHtml = ev.question ? `<em class="banner-q">Hỏi: “${ev.question.replace(/</g, '')}”</em>` : '';
    b.innerHTML = `🎁 ${ev.user.replace(/</g, '')}<small>Tặng ${ev.coins} xu → Trải ${n} lá bài VIP</small>${qHtml}`;

    bannerTimer = setTimeout(() => {
      b.classList.remove('show');
      bannerTimer = null;
    }, 3600);

    const [ox, oy] = orb();
    FX.burst(ox, oy, 'gold', 40 + n * 25, 9);
    if (n >= 3) FX.rain('gold', 90);
    if (n >= 2) FX.burst(540, 300, 'pink', 40, 8);
    cast(0.4 * n); RaAudio.gift(n);
    energy = Math.min(1, energy + n * 0.15);
  }

  let tkT;
  function ticker(t) {
    const e = $('ticker'); e.textContent = t; e.classList.add('show');
    clearTimeout(tkT); tkT = setTimeout(() => e.classList.remove('show'), 3200);
  }

  // ---------- WebSocket JSON-RPC ----------
  const H = {
    'tarot.state': sync,
    'reading.start': startReading,
    'reading.end': endReading,
    'card.claim': claim,
    'lantern.release': lantern,
    'person.pray': pray,
    'person.bow3': bow3,
    'gift.in': giftBanner,
    'bgm.changed': (p) => { if (p && p.url) RaAudio.loadBgmUrl(p.url); },
    'settings.updated': (s) => {
      RaAudio.setVolumes(s.musicVolume, s.ttsVolume, s.ttsEnabled);
      if (s.ttsVoice) RaAudio.setVoice(s.ttsVoice);
      if (s.bgmUrl) RaAudio.loadBgmUrl(s.bgmUrl);
    },
    'event.log': (e) => ticker(`${e.icon} ${e.text}`),
    'prayer.speak': (e) => {
      showCaption('LỜI CẦU NGUYỆN', 'THẦN RA LẮNG NGHE LỜI NGUYỆN', [e.wish], e.durationMs);
      setTimeout(hideCaption, e.durationMs + 400);
      RaAudio.speak(e.audioUrl, e.text, e.durationMs, e.voice, e.ttsAllowed !== false);
    },
  };

  let ws;
  function connect() {
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    ws.onmessage = (m) => {
      let j; try { j = JSON.parse(m.data); } catch (_) { return; }
      if (j.method && H[j.method]) H[j.method](j.params);
    };
    ws.onclose = () => setTimeout(connect, 1500);
  }
  connect();
  setInterval(() => { energy *= 0.965; stage.style.setProperty('--e', energy.toFixed(2)); }, 250);

  // ---------- Mở khóa âm thanh & Dock thử nghiệm (Hiển thị đúng mức xu) ----------
  const unlock = () => RaAudio.unlock();
  addEventListener('pointerdown', unlock, { once: true });
  if (params.get('obs')) unlock();

  if (!params.get('obs') && !params.get('quiet')) {
    const b = document.createElement('button');
    b.className = 'sound'; b.textContent = '🔊 Bấm để kích hoạt âm thanh & nhạc nền';
    b.onclick = () => { unlock(); b.remove(); };
    document.body.appendChild(b);
  }

  const rpc = (method, p) => fetch('/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: p })
  });

  const NAMES = ['Ngọc Anh', 'Minh Quân', 'Diệu Thảo', 'Hoàng Nam', 'Thanh Hà', 'Đức Thịnh', 'Bảo Châu', 'Gia Hân', 'Tuấn Kiệt', 'Mai Phương', 'Khánh Linh', 'Quốc Bảo'];
  const QUESTIONS = [
    'Chuyện tình cảm của em tháng tới thế nào ạ?',
    'Công việc và tài chính sắp tới có khởi sắc không thần Ra?',
    'Người cũ có còn nghĩ đến em không ạ?',
    'Sắp tới em chuyển việc có thuận lợi không?'
  ];
  let demoN = 0, lastU = null;
  const newU = () => (lastU = { user: NAMES[demoN % NAMES.length], uniqueId: 'demo' + demoN++ });
  const U = () => lastU || newU();

  const ACT = {
    like: () => rpc('tarot.like', { ...newU(), count: 5 }),
    follow: () => rpc('tarot.follow', U()),
    g1: () => rpc('tarot.gift', { ...newU(), coins: 5, giftName: 'Gói 1–10 xu', question: QUESTIONS[demoN % QUESTIONS.length] }),
    g2: () => rpc('tarot.gift', { ...newU(), coins: 30, giftName: 'Gói 11–99 xu', question: QUESTIONS[demoN % QUESTIONS.length] }),
    g3: () => rpc('tarot.gift', { ...newU(), coins: 150, giftName: 'Gói ≥ 100 xu', question: QUESTIONS[demoN % QUESTIONS.length] }),
    pray: () => rpc('tarot.pray', { ...U(), wish: 'Cầu cho gia đình luôn bình an và may mắn' }),
    claim: () => rpc('tarot.claim', U()),
    auto: () => rpc('live.setAutoSim', { enabled: !(S && S.settings.autoSim) })
  };
  $('dock').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const a = btn.dataset.a;
    if (a && ACT[a]) ACT[a]();
  });
})();
