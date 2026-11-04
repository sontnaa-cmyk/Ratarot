// Điều phối màn hình Live 9:16: hai sảnh lớn, Thần Ra xào/rút/lật bài, đèn hoa đăng, claim bài.
(() => {
  const $ = (id) => document.getElementById(id);
  const stage = $('stage'), peopleEl = $('people'), cardsEl = $('cards'), lanternsEl = $('lanterns');
  const params = new URLSearchParams(location.search);
  if (params.get('obs')) document.body.classList.add('obs');
  const fit = () => { stage.style.transform = `scale(${Math.min(innerWidth / 1080, innerHeight / 1920)})`; };
  addEventListener('resize', fit); fit();

  const people = new Map();           // key -> {el, x, y}
  let S = null, likes = 0, energy = 0, reading = null, timers = [];
  const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.push(t); return t; };
  const hue = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 0);
  const DECK = [540, 905], CARD_AR = 527 / 300;
  const orb = () => (window.RaPuppet ? RaPuppet.orb : [344, 201]);
  const cast = (k) => window.RaPuppet && RaPuppet.cast(k);

  // ---------- Tọa độ nhân vật (tâm avatar) ----------
  const L = [[75, 385], [172, 385], [75, 520]], R = [[1005, 385], [908, 385], [1005, 520]];
  const slot = {
    // Sảnh lớn chia đều 4 cột x 2 hàng
    priority: (i) => ({ x: 85 + (i % 4) * 120, y: 1530 + (i >> 2) * 115, s: 1 }),
    normal:   (i) => ({ x: 635 + (i % 4) * 120, y: 1530 + (i >> 2) * 115, s: 1 }),
    gift:     (i) => { const p = [[344, 1180], [736, 1180], [250, 1250], [830, 1250]][i] || [540, 1220]; return { x: p[0], y: p[1], s: 1.15 }; },
    spot:     { x: 540, y: 1140, s: 1.45 },
    done:     (i) => { const p = (i % 2 ? R : L)[i >> 1] || (i % 2 ? R : L)[2]; return { x: p[0], y: p[1], s: 0.95 }; },
  };

  // ---------- Tạo nhân vật: Avatar trên đầu + Hình dáng người (Body Silhouette) bên dưới ----------
  function makePerson(p) {
    const h = hue(p.key), el = document.createElement('div');
    el.className = 'pp'; el.style.setProperty('--h', h);
    const ini = (p.user || '?').trim().charAt(0).toUpperCase();
    const safeKey = p.key.replace(/[^a-zA-Z0-9]/g, '_');

    el.innerHTML = `
      <div class="pp-ped"></div>
      <div class="pp-body">
        <svg class="pp-silhouette" viewBox="0 0 50 65">
          <defs>
            <linearGradient id="bodyGrad_${safeKey}" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="hsl(${h}, 85%, 68%)" stop-opacity="0.95"/>
              <stop offset="60%" stop-color="hsl(${(h + 40) % 360}, 75%, 35%)" stop-opacity="0.85"/>
              <stop offset="100%" stop-color="rgba(10, 5, 35, 0.95)"/>
            </linearGradient>
          </defs>
          <path d="M17 10 C21 6 29 6 33 10 C39 15 45 25 43 45 L44 65 C44 65 42 65 40 65 L10 65 C8 65 6 65 6 65 L7 45 C5 25 11 15 17 10 Z" fill="url(#bodyGrad_${safeKey})" stroke="#ffd45e" stroke-width="1.2" stroke-opacity="0.6"/>
          <path d="M25 10 L25 56" stroke="#ffd45e" stroke-width="1" stroke-opacity="0.4" stroke-dasharray="3,3"/>
          <path d="M14 24 C20 30 30 30 36 24" stroke="#ffd45e" stroke-width="1.2" stroke-opacity="0.5" fill="none"/>
        </svg>
      </div>
      <div class="pp-av">
        <span>${ini}</span>
        ${p.avatar ? `<img src="${p.avatar.replace(/"/g, '')}" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}
      </div>
      <div class="pp-pray">🙏</div>
      <div class="pp-name"></div>
      <div class="pp-tag" hidden></div>
    `;
    el.querySelector('.pp-name').textContent = p.user;
    peopleEl.appendChild(el);
    return el;
  }

  const tf = (x, y, s) => `translate(${x - 50}px,${y - 35}px) scale(${s})`;

  function place(key, w) {
    let o = people.get(key);
    if (!o) {
      const el = makePerson(w.p);
      o = { el, x: null, y: null };
      el.style.transition = 'none';
      el.style.transform = tf(w.x, 2020, w.s);
      el.getBoundingClientRect();
      el.style.transition = '';
      people.set(key, o);
    }
    if (o.x !== w.x || o.y !== w.y) {
      o.el.classList.add('walking');
      clearTimeout(o.wt);
      o.wt = setTimeout(() => o.el.classList.remove('walking'), 2600);
      o.el.style.transform = tf(w.x, w.y, w.s);
      o.x = w.x; o.y = w.y;
    }
    ['lob', 'pri', 'nor', 'gift', 'done', 'cur'].forEach((c) => o.el.classList.remove(c));
    w.cls.split(' ').forEach((c) => o.el.classList.add(c));

    const tag = o.el.querySelector('.pp-tag');
    tag.hidden = !w.tag;
    tag.textContent = w.tag || '';

    let ci = o.el.querySelector('.pp-card');
    if (w.card && !ci) {
      ci = document.createElement('img');
      ci.className = 'pp-card';
      ci.src = `/cards/${w.card}.jpg`;
      o.el.appendChild(ci);
    }
    if (!w.card && ci) ci.remove();
  }

  function sync(st) {
    S = st;
    const want = new Map();
    st.lobby.priority.slice(0, 8).forEach((p, i) => want.set(p.key, { p, ...slot.priority(i), tag: '#' + (i + 1), cls: 'lob pri' }));
    st.lobby.normal.slice(0, 8).forEach((p, i) => want.set(p.key, { p, ...slot.normal(i), tag: '#' + (i + 1), cls: 'lob nor' }));
    st.giftQueue.slice(0, 4).forEach((p, i) => want.set(p.key, { p, ...slot.gift(i), tag: '🎁' + p.tier, cls: 'gift' }));
    st.done.slice(0, 6).forEach((d, i) => want.set(d.key, { p: d, ...slot.done(i), cls: 'done', card: d.claimed ? d.cardIds[0] : null }));
    if (st.current) want.set(st.current.key, { p: st.current, ...slot.spot, cls: 'cur' });

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
    $('cntPri').textContent = lp > 8 ? `8/${lp}` : lp;
    $('cntNor').textContent = ln > 8 ? `8/${ln}` : ln;
    $('stView').textContent = st.tiktok.viewerCount || 0;
    $('stRead').textContent = st.stats.readings;
    $('stLike').textContent = Math.max(likes, st.stats.likes);

    const live = st.tiktok.connected || st.settings.autoSim;
    $('liveDot').classList.toggle('on', live);
    $('liveText').textContent = st.tiktok.connected ? `@${st.tiktok.username} • LIVE` : st.settings.autoSim ? 'CỔNG VŨ TRỤ • DEMO' : 'CỔNG VŨ TRỤ • THẦN RA';

    // Cập nhật trạng thái nút Demo
    const isAuto = !!st.settings.autoSim;
    if ($('demoLed')) $('demoLed').className = 'demo-led ' + (isAuto ? 'on' : 'off');
    if ($('demoText')) $('demoText').textContent = isAuto ? 'DEMO: BẬT' : 'DEMO: TẮT';
    if ($('dockBtnAuto')) $('dockBtnAuto').textContent = isAuto ? 'Demo tự động: BẬT' : 'Demo tự động: TẮT';

    RaAudio.setVolumes(st.settings.musicVolume, st.settings.ttsVolume, st.settings.ttsEnabled);
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
      showCaption(ev.tierLabel || 'QUẺ BÀI THIÊN MỆNH', `THẦN RA ĐỌC BÀI CHO ${ev.user.toUpperCase()}`, ev.lines, ev.speakMs);
      RaAudio.chime();
      RaAudio.speak(ev.audioUrl, ev.speech, ev.speakMs);
    }, ev.walkMs + n * ev.dealMs);
  }

  function clearTimers() { timers.forEach(clearTimeout); timers = []; }

  function endReading(ev) {
    clearTimers(); hideCaption(); RaAudio.stopSpeech(); reading = null;
    const els = [...cardsEl.querySelectorAll('.card:not(.deck)')];
    cardsEl.querySelectorAll('.deck').forEach((d) => d.remove());
    if (ev.claimed) setTimeout(() => flyTo(els, ev.key), 300);
    else els.forEach((el) => {
      el.style.transition = 'opacity 1s,translate 1s';
      el.style.opacity = 0; el.style.translate = '0 -140px';
      setTimeout(() => el.remove(), 1100);
    });
  }

  function flyTo(els, key) {
    const o = people.get(key), tx = o ? o.x : 540, ty = o ? o.y : 900;
    els.forEach((el, i) => setTimeout(() => {
      const w = el.offsetWidth, h = el.offsetHeight;
      el.style.transition = 'transform 1.1s cubic-bezier(.5,0,.8,.4),opacity 1.1s';
      el.style.transform = place2(w, h, tx, ty, 340, 0.12);
      el.style.opacity = 0.15;
      FX.burst(tx, ty, 'gold', 26, 6);
      setTimeout(() => el.remove(), 1200);
    }, i * 180));
    RaAudio.sparkle();
  }

  function claim(ev) {
    const n = ev.cardIds.length, w = 150, h = Math.round(150 * CARD_AR);
    const els = ev.cardIds.map((id, i) => {
      const el = makeCard({ image: `/cards/${id}.jpg`, vn: '', keywords: '' }, w, h, 'shown');
      el.style.transform = place2(w, h, 540 + (i - (n - 1) / 2) * 110, 900, 0, 0.1);
      el.style.transition = 'transform .7s cubic-bezier(.2,.9,.3,1)';
      el.getBoundingClientRect();
      el.style.transform = place2(w, h, 540 + (i - (n - 1) / 2) * 110, 900, 0, 1);
      return el;
    });
    FX.burst(540, 900, 'gold', 40, 7);
    wave(540, 900); cast(0.6);
    setTimeout(() => flyTo(els, ev.key), 900);
  }

  // ---------- Đèn hoa đăng / Thả tim / Quà tặng ----------
  function lantern(ev) {
    const o = people.get(ev.key);
    if (o) { o.el.classList.add('bow'); setTimeout(() => o.el.classList.remove('bow'), 1800); }
    while (lanternsEl.children.length > 14) lanternsEl.firstChild.remove();
    const x = o ? o.x - 28 : 200 + Math.random() * 600, y = o ? o.y - 70 : 1500;
    const el = document.createElement('div'); el.className = 'lantern';
    el.style.cssText = `--x0:${x}px;--y0:${y}px;--dx:${Math.round(Math.random() * 200 - 100)}px;left:0;top:0`;
    el.innerHTML = '<div class="lamp"></div><small></small>';
    el.querySelector('small').textContent = `${ev.user}: ${ev.wish.slice(0, 48)}`;
    lanternsEl.appendChild(el); setTimeout(() => el.remove(), 11500);
    FX.burst(x + 28, y, 'gold', 14, 3);
  }

  function pray(ev) {
    energy = Math.min(1, energy + Math.min(ev.count, 10) * 0.02); likes += ev.count;
    const o = people.get(ev.key); if (!o) return;
    o.el.classList.add('pray'); clearTimeout(o.pt);
    o.pt = setTimeout(() => o.el.classList.remove('pray'), 2400);
    FX.burst(o.x, o.y, 'pink', 6, 3);
  }

  function giftBanner(ev) {
    const b = $('banner'), n = ev.tier;
    b.className = 'banner t' + n;
    b.innerHTML = `🎁 ${ev.user.replace(/</g, '')}<small>${ev.giftName.replace(/</g, '')} • ${ev.coins} xu → ${n} lá bài</small>`;
    requestAnimationFrame(() => b.classList.add('show'));
    setTimeout(() => b.classList.remove('show'), 3400);
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
    'tarot.state': sync, 'reading.start': startReading, 'reading.end': endReading, 'card.claim': claim,
    'lantern.release': lantern, 'person.pray': pray, 'gift.in': giftBanner, 'event.log': (e) => ticker(`${e.icon} ${e.text}`),
    'prayer.speak': (e) => {
      showCaption('LỜI CẦU NGUYỆN', 'RA LẮNG NGHE LỜI NGUYỆN', [e.wish], e.durationMs);
      setTimeout(hideCaption, e.durationMs + 400);
      RaAudio.speak(e.audioUrl, e.text, e.durationMs);
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

  // ---------- Âm thanh, Điều khiển MP3 & Nút Demo ----------
  const unlock = () => RaAudio.unlock();
  addEventListener('pointerdown', unlock, { once: true });
  if (params.get('obs')) unlock();

  if (!params.get('obs') && !params.get('quiet')) {
    const b = document.createElement('button');
    b.className = 'sound'; b.textContent = '🔊 Bấm để mở âm thanh & hiệu ứng';
    b.onclick = () => { unlock(); b.remove(); };
    document.body.appendChild(b);
  }

  const rpc = (method, p) => fetch('/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: p })
  });

  // Xử lý nút bật/tắt demo trên giao diện chính
  $('btnToggleDemo')?.addEventListener('click', () => {
    const curAuto = S && S.settings ? S.settings.autoSim : false;
    rpc('live.setAutoSim', { enabled: !curAuto });
  });

  // Xử lý tải và phát MP3 tùy chọn
  $('mp3UploadInput')?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      const name = RaAudio.loadCustomMP3(file);
      $('mp3TrackName').textContent = name.length > 14 ? name.slice(0, 12) + '…' : name;
      $('btnPlayPauseMusic').textContent = '⏸';
    }
  });

  $('btnPlayPauseMusic')?.addEventListener('click', () => {
    const isPlaying = RaAudio.toggleMusic();
    $('btnPlayPauseMusic').textContent = isPlaying ? '⏸' : '▶';
  });

  // Xử lý bộ chọn giọng đọc
  $('voicePicker')?.addEventListener('change', (e) => {
    const v = e.target.value;
    RaAudio.setVoice(v);
    rpc('tarot.updateSettings', { ttsVoice: v });
  });

  // Dock tương tác
  const NAMES = ['Ngọc Anh', 'Minh Quân', 'Diệu Thảo', 'Hoàng Nam', 'Thanh Hà', 'Đức Thịnh', 'Bảo Châu', 'Gia Hân', 'Tuấn Kiệt', 'Mai Phương', 'Khánh Linh', 'Quốc Bảo'];
  let demoN = 0, lastU = null;
  const newU = () => (lastU = { user: NAMES[demoN % NAMES.length], uniqueId: 'demo' + demoN++ });
  const U = () => lastU || newU();
  const ACT = {
    like: () => rpc('tarot.like', { ...newU(), count: 8 }),
    follow: () => rpc('tarot.follow', U()),
    g1: () => rpc('tarot.gift', { ...newU(), coins: 1, giftName: 'Hoa hồng' }),
    g2: () => rpc('tarot.gift', { ...newU(), coins: 20, giftName: 'Nước hoa' }),
    g3: () => rpc('tarot.gift', { ...newU(), coins: 199, giftName: 'Vương miện' }),
    pray: () => rpc('tarot.pray', { ...U(), wish: 'Cầu cho gia đình bình an và may mắn' }),
    claim: () => rpc('tarot.claim', U()),
    auto: () => rpc('live.setAutoSim', { enabled: !(S && S.settings.autoSim) })
  };
  $('dock').addEventListener('click', (e) => { const a = e.target.dataset.a; if (a && ACT[a]) ACT[a](); });
})();
