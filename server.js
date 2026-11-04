// ============================================================================
// CỔNG VŨ TRỤ CỦA THẦN RA — TikTok Live Tarot (Bun.js + JSON-RPC 2.0 + ZeroTTS)
// ============================================================================
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const cors = require('cors');
const { WebSocketServer } = require('ws');
const { TikTokLiveConnection, WebcastEvent, ControlEvent } = require('tiktok-live-connector');

const ROOT = __dirname;
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(ROOT, 'data');
const TTS_CACHE_DIR = path.join(DATA_DIR, 'tts-cache');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const DECK_FILE = path.join(DATA_DIR, 'cards.json');
fs.mkdirSync(TTS_CACHE_DIR, { recursive: true });

if (!fs.existsSync(DECK_FILE)) {
  console.error('Chưa có data/cards.json — hãy kiểm tra lại thư mục data.');
  process.exit(1);
}
const DECK = JSON.parse(fs.readFileSync(DECK_FILE, 'utf8')).cards;

// ---- Bộ lọc spam / từ ngữ tiêu cực ----
const WEIRD_SPAM_RE = /[\u{12000}-\u{1254F}\uFDFD\u2800-\u28FF\u2580-\u259F]|[\u0300-\u036F]{3,}/u;
const BRACKET_EMOTE_RE = /\[[^\]]{1,24}\]/g;
const ALLOWED_VI_TEXT_RE = /[^0-9a-zA-ZÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚÝàáâãèéêìíòóôõùúýĂăĐđĨĩŨũƠơƯưẠ-ỹ\s.,!?]/g;
const ALLOWED_VI_NAME_RE = /[^0-9a-zA-ZÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚÝàáâãèéêìíòóôõùúýĂăĐđĨĩŨũƠơƯưẠ-ỹ\s._-]/g;
const VI_LETTER_RE = /[a-zA-ZÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚÝàáâãèéêìíòóôõùúýĂăĐđĨĩŨũƠơƯưẠ-ỹ]/g;
const BAD_WORDS_RE = /(đá dái|địt|lồn|cặc|đm|vcl|vl|yamate|i cư|lừa đảo|lừa à|te-le gram|telegram|bố là trùm)/i;

function isBlockedSpamOrToxic(raw) {
  if (!raw) return true;
  const s = String(raw);
  return WEIRD_SPAM_RE.test(s) || BAD_WORDS_RE.test(s);
}
function sanitizeUserName(rawName) {
  const n = String(rawName || '').normalize('NFKC').normalize('NFC').replace(BRACKET_EMOTE_RE, ' ')
    .replace(ALLOWED_VI_NAME_RE, ' ').replace(/(.)\1{3,}/gi, '$1$1').replace(/\s+/g, ' ').trim().slice(0, 22);
  if (!n || BAD_WORDS_RE.test(n) || (n.match(VI_LETTER_RE) || []).length < 2) return 'Lữ Khách';
  return n;
}
function sanitizeWishText(rawWish) {
  if (!rawWish) return '';
  const c = String(rawWish).normalize('NFKC').normalize('NFC').replace(BRACKET_EMOTE_RE, ' ')
    .replace(ALLOWED_VI_TEXT_RE, ' ').replace(/([.,!?])\1+/g, '$1').replace(/(.)\1{2,}/gi, '$1$1')
    .replace(/\s+/g, ' ').replace(/^[.,!?\s-]+|[.,!?\s-]+$/g, '').slice(0, 120);
  if (!c || BAD_WORDS_RE.test(c) || (c.match(VI_LETTER_RE) || []).length < 2) return '';
  return c;
}
const stripVN = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().trim();

class ZeroTTSManager {
  constructor() {
    this.proc = null;
    this.ready = false;
    this.status = 'starting';
    this.voice = 'maichi';
    this.voices = ['maichi'];
    this.model = 'zeroweight-ai/ZeroTTS';
    this.pending = new Map();
    this.inflight = new Map();
    this.reqCounter = 0;
    this.buffer = '';
    this.startWorker();
  }

  resolvePythonBin() {
    const cands = [path.join(ROOT, '.venv', 'Scripts', 'python.exe'), path.join(ROOT, '.venv', 'bin', 'python')];
    for (const c of cands) if (fs.existsSync(c)) return c;
    return process.platform === 'win32' ? 'python' : 'python3';
  }

  startWorker() {
    const pyBin = this.resolvePythonBin();
    const scriptPath = path.join(ROOT, 'tts_worker.py');
    console.log(`[ZeroTTS] Khởi chạy worker với ${pyBin}...`);

    this.status = 'loading';
    this.proc = spawn(pyBin, [scriptPath], {
      cwd: ROOT,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    this.proc.stdout.on('data', (chunk) => {
      this.buffer += chunk.toString('utf8');
      let lines = this.buffer.split('\n');
      this.buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        this.handleWorkerLine(line.trim());
      }
    });

    this.proc.stderr.on('data', (chunk) => {
      const msg = chunk.toString('utf8').trim();
      if (msg) console.log(`[ZeroTTS stderr] ${msg}`);
    });

    this.proc.on('exit', (code) => {
      console.warn(`[ZeroTTS] Worker thoát với mã ${code}`);
      this.ready = false;
      this.status = 'stopped';
      for (const [, item] of this.pending) {
        clearTimeout(item.timer);
        item.resolve({ ok: false, error: 'ZeroTTS worker exited' });
      }
      this.pending.clear();
    });
  }

  handleWorkerLine(line) {
    try {
      const msg = JSON.parse(line);
      if (msg.type === 'status') {
        this.status = msg.status;
        this.model = msg.model || this.model;
        broadcastNotification('tts.status', this.getStatus());
      } else if (msg.type === 'ready') {
        this.ready = true;
        this.status = 'ready';
        this.voice = msg.voice || 'maichi';
        this.voices = msg.voices || ['maichi'];
        this.model = msg.model || this.model;
        console.log(`[ZeroTTS] Sẵn sàng! Giọng: ${this.voice}`);
        broadcastNotification('tts.status', this.getStatus());
      } else if (msg.type === 'result' && msg.id != null) {
        const entry = this.pending.get(msg.id);
        if (entry) {
          clearTimeout(entry.timer);
          this.pending.delete(msg.id);
          entry.resolve(msg);
        }
      } else if (msg.type === 'error') {
        console.error('[ZeroTTS Error]', msg.error);
        this.status = 'error';
        broadcastNotification('tts.status', this.getStatus());
      }
    } catch (_) {}
  }

  getStatus() {
    return {
      ready: this.ready,
      status: this.status,
      engine: 'ZeroTTS',
      voice: state.settings.ttsVoice || this.voice || 'maichi',
      voices: this.voices,
      model: this.model
    };
  }

  synthesize(text, voiceOverride) {
    const cleanText = String(text || '').trim();
    if (!cleanText) return Promise.resolve({ ok: false, error: 'Empty text' });
    const voice = (voiceOverride || state.settings.ttsVoice || 'maichi').toLowerCase();
    const dedupKey = `${voice}::${cleanText}`;

    if (this.inflight.has(dedupKey)) {
      return this.inflight.get(dedupKey);
    }

    const promise = new Promise((resolve) => {
      if (!this.proc || !this.ready) {
        return resolve({ ok: false, error: `ZeroTTS đang ở trạng thái: ${this.status}` });
      }
      const id = ++this.reqCounter;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ ok: false, error: 'ZeroTTS synthesis timeout' });
      }, 30000);

      this.pending.set(id, { resolve, timer });
      const payload = JSON.stringify({ id, text: cleanText, voice }) + '\n';
      this.proc.stdin.write(payload);
    }).finally(() => {
      this.inflight.delete(dedupKey);
    });

    this.inflight.set(dedupKey, promise);
    return promise;
  }
}

// ============================================================================
// CẤU HÌNH TRẠNG THÁI & HÀNG CHỜ
// ============================================================================
const DEFAULT_SETTINGS = {
  ttsEnabled: true, ttsVoice: 'maichi', musicVolume: 0.35, ttsVolume: 0.95,
  lobbyCards: 1,
  repeatAfterMin: 20,
  doneSlots: 3,
  autoSim: true, autoSimIntervalMs: 2600,
};
const state = {
  settings: { ...DEFAULT_SETTINGS },
  stats: { readings: 0, cards: 0, prayers: 0, likes: 0, gifts: 0, coins: 0 },
  tiktok: { connected: false, connecting: false, username: '', roomId: null, viewerCount: 0, lastError: null },
};
function loadState() {
  try {
    const j = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    Object.assign(state.settings, j.settings || {});
    Object.assign(state.stats, j.stats || {});
  } catch (_) {}
}
let saveTimer = null;
function saveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => fs.promises.writeFile(STATE_FILE, JSON.stringify({ settings: state.settings, stats: state.stats }, null, 2)).catch(() => {}), 1000);
}
loadState();

const lobby = { priority: [], normal: [] };
const giftQueue = [];
const doneList = [];
const prayerSpeech = [];
let current = null;
let prioStreak = 0;
let engineBusy = false;
const claimWaiting = new Set();

const keyOf = (p) => String(p.uniqueId || p.user || 'khach').toLowerCase();
const now = () => Date.now();
const person = (p) => ({ key: keyOf(p), user: sanitizeUserName(p.user), uniqueId: p.uniqueId || '', avatar: p.avatar || '' });
const pub = (e) => ({ key: e.key, user: e.user, avatar: e.avatar, tier: e.tier || 0, coins: e.coins || 0, giftName: e.giftName || '' });
const inList = (list, key) => list.findIndex((e) => e.key === key);

function getPublicState() {
  return {
    settings: state.settings, stats: state.stats, tiktok: state.tiktok,
    lobby: { priority: lobby.priority.map(pub), normal: lobby.normal.map(pub) },
    giftQueue: giftQueue.map(pub),
    done: doneList.slice(0, state.settings.doneSlots * 2).map((d) => ({ ...pub(d), cardIds: d.cardIds, claimed: !!d.claimed })),
    current: current ? { ...pub(current), phase: current.phase, cardIds: current.cards.map((c) => c.id) } : null,
    tts: zeroTts.getStatus(),
  };
}
let stateTimer = null;
function pushState() {
  if (stateTimer) return;
  stateTimer = setTimeout(() => { stateTimer = null; broadcastNotification('tarot.state', getPublicState()); }, 120);
}
const logEvent = (icon, text) => broadcastNotification('event.log', { icon, text, t: now() });

function giftTier(coins) {
  if (coins >= 100) return { tier: 3, cards: 3, label: 'Siêu cao cấp' };
  if (coins >= 11) return { tier: 2, cards: 2, label: 'Cao cấp' };
  return { tier: 1, cards: 1, label: 'Cao' };
}

// ----------------------------------------------------------------------------
// XỬ LÝ SỰ KIỆN: CHỐNG NGHẼN DO NGƯỜI LƯỚT QUA
// ----------------------------------------------------------------------------
// 1. Vào live xem: CHỈ ghi nhận đang xem, KHÔNG đưa vào sảnh chờ
function ev_join(p) {
  const me = person(p);
  return { ok: true, note: 'đang xem live' };
}

// 2. Thả tim (Like): ĐIỀU KIỆN CHÍNH THỨC để xếp hàng vào Sảnh Thường
function ev_like(p, count = 1) {
  state.stats.likes += count; saveState();
  const me = person(p);
  broadcastNotification('person.pray', { ...pub(me), count });

  // Kiểm tra nếu chưa từng có trong sảnh, chưa đọc và không đọc gần đây -> Thêm vào Sảnh Thường
  if (!isKnown(me.key)) {
    lobby.normal.push({ ...me, joinedAt: now() });
    broadcastNotification('lobby.join', { ...pub(me), lobby: 'normal' });
    logEvent('💖', `${me.user} thả tim → Vào Sảnh Thường`);
    pushState(); kick();
    return { ok: true, queued: true, lobby: 'normal' };
  }
  return { ok: true, queued: false };
}

// 3. Follow / Share: Bước thẳng vào Sảnh Ưu Tiên
function ev_follow(p, kind = 'follow') {
  const me = person(p);
  if (current && current.key === me.key) return { ok: true, note: 'đang được đọc' };
  if (inList(lobby.priority, me.key) >= 0 || inList(giftQueue, me.key) >= 0) return { ok: true, note: 'đã ở sảnh ưu tiên' };
  if (recentlyDone(me.key)) return { ok: true, note: 'đã được đọc gần đây' };
  const i = inList(lobby.normal, me.key);
  const entry = i >= 0 ? lobby.normal.splice(i, 1)[0] : { ...me, joinedAt: now() };
  lobby.priority.push(entry);
  broadcastNotification(i >= 0 ? 'lobby.move' : 'lobby.join', { ...pub(entry), lobby: 'priority', from: i >= 0 ? 'normal' : null });
  logEvent(kind === 'share' ? '🔁' : '💜', `${me.user} ${kind === 'share' ? 'chia sẻ live' : 'theo dõi kênh'} → Sảnh Ưu Tiên`);
  pushState(); kick();
  return { ok: true, lobby: 'priority' };
}

// 4. Tặng quà (Gift): Đứng giữa đài tế, đọc ngay lập tức 1/2/3 lá
function ev_gift(p, coins, giftName = 'Quà') {
  const me = person(p); coins = Math.max(1, Number(coins) || 1);
  state.stats.gifts += 1; state.stats.coins += coins; saveState();
  for (const L of [lobby.priority, lobby.normal]) { const i = inList(L, me.key); if (i >= 0) L.splice(i, 1); }
  const gi = inList(giftQueue, me.key);
  if (gi >= 0) {
    const g = giftQueue[gi]; g.coins += coins; g.giftName = giftName; Object.assign(g, giftTier(g.coins));
  } else {
    giftQueue.push({ ...me, coins, giftName, ...giftTier(coins), joinedAt: now() });
  }
  const t = giftTier(coins);
  broadcastNotification('gift.in', { ...pub(me), coins, giftName, tier: t.tier });
  logEvent('🎁', `${me.user} tặng ${giftName} (${coins} xu) → ${t.cards} lá bài`);
  pushState(); kick();
  return { ok: true, cards: t.cards };
}

// 5. Đón nhận / Claim
function ev_claim(p) {
  const me = person(p);
  if (current && current.key === me.key) { claimWaiting.add(me.key); return { ok: true, note: 'sẽ nhận khi kết thúc' }; }
  const d = doneList.find((x) => x.key === me.key);
  if (!d || d.claimed) return { ok: false, note: 'không có bài để nhận' };
  d.claimed = true;
  broadcastNotification('card.claim', { ...pub(d), cardIds: d.cardIds });
  logEvent('✨', `${d.user} đón nhận lá bài`);
  pushState();
  return { ok: true };
}

// 6. Cầu nguyện / Thả đèn
function ev_pray(p, wish) {
  const me = person(p); const w = sanitizeWishText(wish) || 'Cầu bình an cho mọi người';
  state.stats.prayers += 1; saveState();
  broadcastNotification('lantern.release', { ...pub(me), wish: w });
  logEvent('🏮', `${me.user}: ${w}`);
  if (prayerSpeech.length < 4) prayerSpeech.push({ ...me, wish: w });
  kick();
  return { ok: true };
}

const CLAIM_RE = /(^|\s)(claim|don nhan|xin don nhan|nhan bai|con xin nhan|nhan ne)(\s|$|[!.])/;
const PRAY_RE = /^(cau|nguyen|nam mo|a di da|binh an|chuc|xin)(\s|$|[,.!])|(\s|^)(nam mo|a di da phat)(\s|$)/;
function ev_comment(p, text) {
  const raw = String(text || '').trim();
  if (!raw || isBlockedSpamOrToxic(raw)) return { ok: false, note: 'bị lọc' };
  const t = stripVN(raw);
  if (CLAIM_RE.test(t)) return ev_claim(p);
  if (PRAY_RE.test(t)) return ev_pray(p, raw);
  return { ok: true, note: 'bình luận thường' };
}

function recentlyDone(key) {
  const d = doneList.find((x) => x.key === key);
  return !!d && now() - d.doneAt < state.settings.repeatAfterMin * 60000;
}
function isKnown(key) {
  return (current && current.key === key) || inList(lobby.priority, key) >= 0 || inList(lobby.normal, key) >= 0 || inList(giftQueue, key) >= 0 || recentlyDone(key);
}

// ----------------------------------------------------------------------------
// THỨ TỰ BỐC BÀI: Quà tặng > 2 Sảnh Ưu Tiên : 1 Sảnh Thường
// ----------------------------------------------------------------------------
function pickNext() {
  if (giftQueue.length) {
    giftQueue.sort((a, b) => b.tier - a.tier || a.joinedAt - b.joinedAt);
    const g = giftQueue.shift(); return { ...g, source: 'gift' };
  }
  const pri = lobby.priority[0], nor = lobby.normal[0];
  if (pri && (prioStreak < 2 || !nor)) {
    prioStreak = nor ? prioStreak + 1 : 0;
    lobby.priority.shift();
    return { ...pri, source: 'priority', cards: state.settings.lobbyCards, tier: 0 };
  }
  if (nor) {
    prioStreak = 0;
    lobby.normal.shift();
    return { ...nor, source: 'normal', cards: state.settings.lobbyCards, tier: 0 };
  }
  return null;
}

// ----------------------------------------------------------------------------
// RÚT BÀI VÀ BIÊN SOẠN THÔNG ĐIỆP PHÂN CẤP
// ----------------------------------------------------------------------------
function drawCards(n) {
  const pool = [...DECK]; const out = [];
  for (let i = 0; i < n; i++) out.push(pool.splice(crypto.randomInt(pool.length), 1)[0]);
  return out;
}
const slim = (c) => ({ id: c.id, vn: c.vn, en: c.en, image: c.image, keywords: c.keywords, message: c.message, roman: c.roman, arcana: c.arcana, suit: c.suit });
const pick = (arr, seed) => arr[seed % arr.length];
const seedOf = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const lcFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);
const ucFirst = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const msgParts = (m) => { const [a, b] = m.replace(/\.$/, '').split('; '); return { obs: a, adv: b || a }; };
const kw1 = (c) => c.keywords.split(' · ')[0];

function composeReading(entry, cards) {
  const seed = seedOf(entry.key + cards.map((c) => c.id).join());
  const nm = entry.user || 'Lữ khách';
  const source = entry.source || (entry.tier > 0 ? 'gift' : 'normal');

  const intros = [
    `Ra chào ${nm}. Ánh sáng Mặt Trời soi rọi vào tâm thức của bạn.`,
    `${nm} ơi, cổng thiên hà vừa gửi đến bạn một thông điệp định mệnh.`,
    `Ánh dương của Thần Ra đã chạm tới quẻ bài của ${nm}.`,
    `Dưới vầng nhật quang thiêng liêng, Ra gửi trao chỉ dẫn cho ${nm}.`,
    `Hỡi lữ khách ${nm}, vũ trụ thấu suốt ước nguyện trong tim bạn.`,
    `Vầng hào quang thái dương khai mở vận trình mới dành riêng cho ${nm}.`
  ];
  const intro = pick(intros, seed);

  let tierLabel = 'THÔNG ĐIỆP BÀI TAROT';
  let body = [];
  let outro = '';

  // 1. Sảnh Thường (Thả tim): 1 lá bài, ngắn gọn súc tích
  if (source === 'normal' || (entry.tier === 0 && entry.source !== 'priority')) {
    tierLabel = 'THÔNG ĐIỆP THẢ TIM • 1 LÁ TRỌNG TÂM';
    const c = cards[0];
    const kw = c.keywords.split(' · ')[0];
    body = [
      `Lá bài của bạn là ${c.vn}.`,
      `${ucFirst(kw)}: ${c.message.split(';')[0]}.`,
      `Lời khuyên: Vững tâm, thuận theo tự nhiên.`
    ];
    outro = pick([
      'Chúc bạn một ngày bình an và may mắn.',
      'Hãy giữ tâm an định, vạn sự sẽ lành.',
      'Ánh sáng bình minh luôn chờ đón bạn.'
    ], seed);
  }
  // 2. Sảnh Ưu Tiên (Follow / Share): 1-2 lá bài, lời khuyên và hành động
  else if (source === 'priority' || (entry.isFollow && entry.tier === 0)) {
    tierLabel = 'TRI ÂN FOLLOW • LỜI KHUYÊN ĐỊNH HƯỚNG';
    if (cards.length === 1) {
      const c = cards[0];
      const p = msgParts(c.message);
      body = [
        `Lá bài dẫn lối là ${c.vn} (${c.keywords}).`,
        `Thực tại: ${ucFirst(lcFirst(p.obs))}.`,
        `Định hướng: ${ucFirst(lcFirst(p.adv))}. Hãy tin vào trực giác và bước tới dứt khoát.`
      ];
    } else {
      const [a, b] = cards;
      const pa = msgParts(a.message), pb = msgParts(b.message);
      body = [
        `Hai lá bài chỉ dẫn: ${a.vn} và ${b.vn}.`,
        `${ucFirst(kw1(a))} kết hợp cùng ${kw1(b)}.`,
        `Thông điệp: ${ucFirst(lcFirst(pa.obs))}. ${ucFirst(lcFirst(pb.adv))}.`
      ];
    }
    outro = pick([
      'Cảm ơn bạn đã theo dõi kênh. Nguyện vầng thái dương dẫn đường chỉ lối.',
      'Tri ân bạn đã kết nối cùng Ra. Hãy giữ vững năng lượng tích cực này.',
      'Sự đồng hành của bạn mang lại duyên lành lớn. Chúc bạn vạn sự hanh thông.'
    ], seed);
  }
  // 3. Quà Tặng (Gift): 1-3 lá bài, phân tích sâu sắc toàn cảnh & lời sấm truyền
  else {
    const coins = entry.coins || 1;
    tierLabel = `VIP GIFT (${coins} XU) • TIÊN TRI TOÀN CẢNH`;
    if (cards.length === 1) {
      const c = cards[0];
      const p = msgParts(c.message);
      body = [
        `Lá bài hoàng kim: ${c.vn} (${c.keywords}).`,
        `Vũ trụ báo hiệu: ${ucFirst(lcFirst(p.obs))}.`,
        `Lời sấm truyền: ${ucFirst(lcFirst(p.adv))}. Quý nhân và thời cơ lớn đang hội tụ xung quanh bạn.`
      ];
    } else if (cards.length === 2) {
      const [a, b] = cards;
      const pa = msgParts(a.message), pb = msgParts(b.message);
      body = [
        `Cặp bài vinh quang: ${a.vn} và ${b.vn}.`,
        `Chuyển biến thiên mệnh: Từ ${kw1(a)} thăng hoa thành ${kw1(b)}.`,
        `Luận giải: ${ucFirst(lcFirst(pa.obs))}, mở đường cho ${lcFirst(pb.adv)}. Thành quả lớn đang đến rất gần.`
      ];
    } else {
      const [a, b, c] = cards;
      const pa = msgParts(a.message), pb = msgParts(b.message), pc = msgParts(c.message);
      body = [
        `Bộ ba thiên mệnh tối cao: ${a.vn}, ${b.vn} và ${c.vn}.`,
        `Dòng chảy vận mệnh: Nền tảng ${kw1(a)} qua chuyển biến ${kw1(b)}, hướng tới kết quả ${kw1(c)}.`,
        `Lời tiên tri toàn cảnh: ${ucFirst(lcFirst(pa.obs))}. ${ucFirst(lcFirst(pb.adv))}. Kết cuộc ${lcFirst(pc.adv)}. Mọi ước nguyện đang dần viên mãn.`
      ];
    }
    outro = entry.tier === 3
      ? 'Ra trân trọng món quà lớn của bạn. Nguyện quyền năng Mặt Trời che chở bạn phú quý viên mãn. Hãy comment ĐÓN NHẬN để giữ trọn vượng khí!'
      : 'Thần Ra cảm ơn tấm lòng của bạn. Chúc bạn tỏa sáng rực rỡ và phát tài phát lộc.';
  }

  const lines = [intro, ...body, outro];
  return { tierLabel, lines, speech: lines.join(' ') };
}

// ----------------------------------------------------------------------------
// ENGINE TIMELINE
// ----------------------------------------------------------------------------
const WALK_MS = 3400, DEAL_MS = 2500, HOLD_MS = 2400;
const TS = Number(process.env.RA_TIME_SCALE || 1);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function kick() { if (!engineBusy) setTimeout(engineLoop, 50); }

async function speakInGap() {
  const pr = prayerSpeech.shift(); if (!pr) return false;
  const text = `Ra lắng nghe lời nguyện của ${pr.user}. ${pr.wish}`;
  const res = state.settings.ttsEnabled ? await zeroTts.synthesize(text) : null;
  const ms = res && res.ok ? Math.round((res.durationSec || 4) * 1000) : Math.max(3500, text.length * 70);
  broadcastNotification('prayer.speak', { ...pub(pr), wish: pr.wish, text, audioUrl: res && res.ok ? res.url : null, durationMs: ms });
  await sleep(ms + 600);
  return true;
}

async function engineLoop() {
  if (engineBusy) return; engineBusy = true;
  try {
    for (;;) {
      const next = pickNext();
      if (!next) { if (await speakInGap()) continue; break; }
      await runReading(next);
      await speakInGap();
      await sleep(500);
    }
  } catch (e) { console.error('[Engine]', e); }
  engineBusy = false; pushState();
}

async function runReading(entry) {
  const cards = drawCards(entry.cards || 1);
  const { tierLabel, lines, speech } = composeReading(entry, cards);
  current = { ...entry, cards, phase: 'walk', skip: false };
  pushState();
  const tts = state.settings.ttsEnabled ? await zeroTts.synthesize(speech) : null;
  const speakMs = tts && tts.ok ? Math.round((tts.durationSec || 8) * 1000) : Math.max(6000, speech.length * 75);
  broadcastNotification('reading.start', {
    ...pub(entry), source: entry.source, cards: cards.map(slim), tierLabel, lines, speech,
    audioUrl: tts && tts.ok ? tts.url : null, speakMs, walkMs: WALK_MS, dealMs: DEAL_MS, holdMs: HOLD_MS,
  });
  logEvent('🔮', `Ra đọc ${cards.length} lá cho ${entry.user}: ${cards.map((c) => c.vn).join(', ')}`);
  const total = (WALK_MS + cards.length * DEAL_MS + speakMs + HOLD_MS) * TS;
  const t0 = now();
  while (now() - t0 < total && !current.skip) await sleep(150);
  const claimed = claimWaiting.delete(entry.key);
  const d = { ...pub(entry), cardIds: cards.map((c) => c.id), doneAt: now(), claimed };
  const di = inList(doneList, d.key); if (di >= 0) doneList.splice(di, 1);
  doneList.unshift(d); doneList.length = Math.min(doneList.length, 40);
  state.stats.readings += 1; state.stats.cards += cards.length; saveState();
  broadcastNotification('reading.end', { ...pub(entry), cardIds: d.cardIds, claimed });
  current = null; pushState();
  await sleep(900);
}

// ----------------------------------------------------------------------------
// KẾT NỐI TIKTOK LIVE & GIẢ LẬP
// ----------------------------------------------------------------------------
let tiktokConn = null;
const giftComboTracker = new Map();
const likeThrottle = new Map();

function extractUser(data) {
  const u = data?.user || data || {};
  const uniqueId = u.uniqueId || u.displayId || data?.uniqueId || '';
  const user = u.nickname || uniqueId || data?.nickname || 'Lữ Khách';
  const avatar = u.profilePictureUrl || u.avatarLarge?.urlList?.[0] || u.avatarThumb?.urlList?.[0] || u.avatarMedium?.urlList?.[0] || data?.profilePictureUrl || '';
  return { user, uniqueId, avatar };
}

async function resolveTikTokUsername(rawInput) {
  const input = String(rawInput || '').trim();
  if (!input) throw new Error('Vui lòng nhập @username hoặc link TikTok Live');
  if (/tiktok\.com\//i.test(input)) {
    const direct = input.match(/tiktok\.com\/@([^/?#]+)/i); if (direct) return direct[1];
    try { const r = await fetch(input.startsWith('http') ? input : `https://${input}`, { redirect: 'follow' }); const m = (r.url || '').match(/tiktok\.com\/@([^/?#]+)/i); if (m) return m[1]; } catch (_) {}
  }
  return input.replace(/^@/, '').split(/[/?#]/)[0].trim();
}

async function connectTikTokLive(usernameOrUrl) {
  const user = await resolveTikTokUsername(usernameOrUrl);
  if (!user) throw new Error('Không tìm thấy @username hợp lệ');
  if (tiktokConn) { try { await tiktokConn.disconnect(); } catch (_) {} tiktokConn = null; }
  state.tiktok = { connected: false, connecting: true, username: user, roomId: null, viewerCount: 0, lastError: null };
  pushState();
  const c = (tiktokConn = new TikTokLiveConnection(user, { processInitialData: true, fetchRoomInfoOnConnect: false, enableExtendedGiftInfo: false }));
  c.on(ControlEvent.CONNECTED, (rs) => { Object.assign(state.tiktok, { connected: true, connecting: false, roomId: rs?.roomId || c.roomId || null, lastError: null }); pushState(); });
  c.on(ControlEvent.DISCONNECTED, () => { Object.assign(state.tiktok, { connected: false, connecting: false }); pushState(); });
  c.on(ControlEvent.ERROR, (err) => { state.tiktok.lastError = err?.message || String(err); pushState(); });
  c.on(WebcastEvent.ROOM_USER, (d) => { const v = Number(d?.total ?? d?.viewerCount ?? 0); if (v > 0) { state.tiktok.viewerCount = v; pushState(); } });
  
  // Member vào xem live KHÔNG xếp vào sảnh chờ
  c.on(WebcastEvent.MEMBER, (d) => ev_join(extractUser(d)));
  
  // Bình luận
  c.on(WebcastEvent.CHAT, (d) => { const u = extractUser(d); ev_comment(u, d?.content || d?.comment || ''); });
  
  // Thả tim / Like: Chạm vào màn hình để xếp hàng vào Sảnh Thường
  c.on(WebcastEvent.LIKE, (d) => {
    const u = extractUser(d); const k = keyOf(u); const t = now();
    if (t - (likeThrottle.get(k) || 0) < 1500) return; likeThrottle.set(k, t);
    if (likeThrottle.size > 800) likeThrottle.delete(likeThrottle.keys().next().value);
    ev_like(u, Math.min(15, Math.max(1, Number(d?.count ?? d?.likeCount ?? 1))));
  });

  c.on(WebcastEvent.FOLLOW, (d) => ev_follow(extractUser(d), 'follow'));
  c.on(WebcastEvent.SHARE, (d) => ev_follow(extractUser(d), 'share'));
  c.on(WebcastEvent.SOCIAL, (d) => {
    const a = String(d?.action || ''); const disp = String(d?.common?.displayText?.displayType || d?.displayType || '').toLowerCase();
    if (a === '1' || disp.includes('follow')) ev_follow(extractUser(d), 'follow'); else if (a === '3' || disp.includes('share')) ev_follow(extractUser(d), 'share');
  });

  c.on(WebcastEvent.GIFT, (d) => {
    const u = extractUser(d); const g = d?.gift || d?.giftDetails || {};
    const gid = String(d?.giftId || g?.id || 'gift'); const group = String(d?.groupId || `${u.uniqueId}_${gid}`);
    const rep = Math.max(1, Number(d?.repeatCount || d?.comboCount || 1)); const prev = giftComboTracker.get(group) || 0;
    if (rep <= prev && d?.repeatEnd) { giftComboTracker.delete(group); return; }
    const delta = Math.max(1, rep - prev); giftComboTracker.set(group, rep);
    if (giftComboTracker.size > 500) giftComboTracker.delete(giftComboTracker.keys().next().value);
    const coins = Math.max(1, Number(g?.diamondCount || d?.diamondCount || 1)) * delta;
    ev_gift(u, coins, (delta > 1 ? `${delta}x ` : '') + (g?.name || d?.giftName || 'Quà'));
  });

  try {
    const rs = await c.connect();
    Object.assign(state.tiktok, { connected: true, connecting: false, roomId: rs?.roomId || c.roomId || null }); pushState();
    return state.tiktok;
  } catch (err) {
    Object.assign(state.tiktok, { connected: false, connecting: false, lastError: err?.message || 'Không thể kết nối (tài khoản đã bật Live chưa?)' }); pushState();
    throw new Error(state.tiktok.lastError);
  }
}
function disconnectTikTokLive() {
  if (tiktokConn) { try { tiktokConn.disconnect(); } catch (_) {} tiktokConn = null; }
  Object.assign(state.tiktok, { connected: false, connecting: false, viewerCount: 0 }); pushState();
  return state.tiktok;
}

// Giả lập
let simTimer = null, simN = 0;
const SIM_NAMES = ['Ngọc Anh', 'Minh Quân', 'Diệu Thảo', 'Hoàng Nam', 'Thanh Hà', 'Đức Thịnh', 'Bảo Châu', 'Gia Hân', 'Tuấn Kiệt', 'Mai Phương', 'Khánh Linh', 'Quốc Bảo', 'Thu Trang', 'Hải Đăng', 'Lan Chi', 'Việt Anh'];
const SIM_WISH = ['Cầu cho gia đình luôn bình an', 'Nguyện mọi điều tốt đẹp sẽ đến', 'Chúc cả phòng live một ngày may mắn', 'Xin vũ trụ chỉ lối cho con', 'Bình an và hạnh phúc nhé'];

function simStep() {
  const r = Math.random();
  const u = { user: SIM_NAMES[crypto.randomInt(SIM_NAMES.length)], uniqueId: `sim${crypto.randomInt(30)}` };
  // Người xem giả lập thả tim để bước vào sảnh chờ
  if (r < 0.40) ev_like(u, 5);
  else if (r < 0.60) ev_follow(u, Math.random() < 0.5 ? 'follow' : 'share');
  else if (r < 0.75) ev_pray(u, SIM_WISH[crypto.randomInt(SIM_WISH.length)]);
  else if (r < 0.88) ev_claim(u);
  else {
    const c = [1, 5, 10, 25, 49, 120, 299][crypto.randomInt(7)];
    ev_gift(u, c, c >= 100 ? 'Galaxy' : c >= 11 ? 'Đèn lưu ly' : 'Hoa hồng');
  }
  simN++;
}

function configureAutoSim(on) {
  state.settings.autoSim = !!on; clearInterval(simTimer);
  if (on) simTimer = setInterval(simStep, state.settings.autoSimIntervalMs);
  saveState(); pushState();
  return { autoSim: state.settings.autoSim };
}

// JSON-RPC 2.0
async function handleRpcCall(method, p = {}) {
  switch (method) {
    case 'tarot.getState': return getPublicState();
    case 'tarot.getDeck': return DECK.map(slim);
    case 'tarot.join': return ev_join(p);
    case 'tarot.follow': return ev_follow(p, 'follow');
    case 'tarot.share': return ev_follow(p, 'share');
    case 'tarot.like': return ev_like(p, Number(p.count) || 1);
    case 'tarot.gift': return ev_gift(p, p.coins, p.giftName);
    case 'tarot.claim': return ev_claim(p);
    case 'tarot.pray': return ev_pray(p, p.wish);
    case 'tarot.comment': return ev_comment(p, p.text);
    case 'tarot.skip': if (current) current.skip = true; return { ok: true };
    case 'tarot.preview': {
      const n = Math.min(3, Math.max(1, Number(p.cards) || 1));
      const cs = p.cardIds ? p.cardIds.map((id) => DECK.find((c) => c.id === id)).filter(Boolean) : drawCards(n);
      return { cards: cs.map(slim), ...composeReading({ key: 'preview', user: p.user || 'Bạn', tier: n === 3 ? 3 : n === 2 ? 2 : 0, source: 'normal' }, cs) };
    }
    case 'tarot.reset':
      lobby.priority.length = lobby.normal.length = giftQueue.length = doneList.length = prayerSpeech.length = 0; prioStreak = 0;
      if (current) current.skip = true; pushState(); return getPublicState();
    case 'tarot.updateSettings': {
      const keys = Object.keys(DEFAULT_SETTINGS).filter((k) => k !== 'autoSim');
      for (const k of keys) if (p[k] !== undefined) state.settings[k] = typeof DEFAULT_SETTINGS[k] === 'number' ? Number(p[k]) : typeof DEFAULT_SETTINGS[k] === 'boolean' ? !!p[k] : String(p[k]);
      saveState(); pushState(); return state.settings;
    }
    case 'tarot.speak': { const r = await zeroTts.synthesize(p.text, p.voice); return r; }
    case 'tarot.ttsStatus': return zeroTts.getStatus();
    case 'live.connect': return connectTikTokLive(p.username || p.url);
    case 'live.disconnect': return disconnectTikTokLive();
    case 'live.setAutoSim': return configureAutoSim(p.enabled);
    default: throw new Error(`Không tìm thấy phương thức JSON-RPC: ${method}`);
  }
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use('/tts-cache', express.static(TTS_CACHE_DIR, { maxAge: '7d' }));
app.use(express.static(path.join(ROOT, 'public')));
app.get('/admin', (_req, res) => res.sendFile(path.join(ROOT, 'public', 'admin.html')));
app.post('/rpc', async (req, res) => {
  const { jsonrpc, id, method, params } = req.body || {};
  if (!method) return res.status(400).json({ jsonrpc: '2.0', id: id ?? null, error: { code: -32600, message: 'Invalid Request: thiếu method' } });
  try { res.json({ jsonrpc: jsonrpc || '2.0', id: id ?? null, result: await handleRpcCall(method, params || {}) }); }
  catch (err) { res.json({ jsonrpc: jsonrpc || '2.0', id: id ?? null, error: { code: -32000, message: err.message || 'Server error' } }); }
});
app.all('/api/tts', async (req, res) => {
  const text = String(req.body?.text || req.query?.text || '').trim();
  if (!text) return res.status(400).json({ ok: false, error: 'Thiếu text' });
  res.json(await zeroTts.synthesize(text, req.body?.voice || req.query?.voice));
});
app.get('/api/state', (_req, res) => res.json(getPublicState()));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
function broadcastNotification(method, params) {
  const payload = JSON.stringify({ jsonrpc: '2.0', method, params });
  for (const c of wss.clients) if (c.readyState === 1) c.send(payload);
}
wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'tarot.state', params: getPublicState() }));
  ws.on('message', async (raw) => {
    let msg; try { msg = JSON.parse(raw.toString('utf8')); } catch (_) { return; }
    if (!msg || !msg.method) return;
    try { const result = await handleRpcCall(msg.method, msg.params || {}); if (msg.id !== undefined) ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result })); }
    catch (err) { if (msg.id !== undefined) ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: err.message || 'RPC Error' } })); }
  });
});

const zeroTts = new ZeroTTSManager();
module.exports = { handleRpcCall, getPublicState };
server.listen(PORT, () => {
  console.log('============================================================');
  console.log('☀️  CỔNG VŨ TRỤ CỦA THẦN RA — TAROT LIVE đã khởi động');
  console.log(`📺 Màn hình Live 9:16 : http://localhost:${PORT}   (OBS: ?obs=1)`);
  console.log(`🎛️  Admin & RPC        : http://localhost:${PORT}/admin`);
  console.log(`🔌 JSON-RPC 2.0       : POST /rpc  |  ws://localhost:${PORT}/ws`);
  console.log('============================================================');
  if (state.settings.autoSim) configureAutoSim(true);
  const ch = process.env.TIKTOK_USER;
  if (ch) connectTikTokLive(ch).catch((e) => console.warn(`[Auto-Connect @${ch}]`, e.message));
});
