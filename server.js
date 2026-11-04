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
const ALLOWED_VI_TEXT_RE = /[^0-9a-zA-ZÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚÝàáâãèéêìíòóôõùúýĂăĐđĨĩŨũƠơƯưẠ-ỹ\s.,!?\-?]/g;
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
function sanitizeCleanText(rawText, maxLen = 120) {
  if (!rawText) return '';
  const c = String(rawText).normalize('NFKC').normalize('NFC').replace(BRACKET_EMOTE_RE, ' ')
    .replace(ALLOWED_VI_TEXT_RE, ' ').replace(/([.,!?])\1+/g, '$1').replace(/(.)\1{2,}/gi, '$1$1')
    .replace(/\s+/g, ' ').replace(/^[.,!?\s-]+|[.,!?\s-]+$/g, '').slice(0, maxLen);
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
    const vRaw = (voiceOverride || state.settings.ttsVoice || 'maichi').toLowerCase();
    // Nếu chọn giọng Web Speech (vi-vn-nu / vi-vn-nam) thì trả về để trình duyệt tự đọc bằng giọng được chọn
    if (vRaw.startsWith('vi-vn')) {
      return Promise.resolve({ ok: false, browserSpeech: true, voice: vRaw });
    }
    const voice = vRaw;
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
  ttsEnabled: true,
  normalTtsEnabled: true, // Bật/tắt giọng đọc cho hàng sảnh chờ thường
  ttsVoice: 'vi-VN-nu',   // 'vi-VN-nu', 'vi-VN-nam', 'maichi'
  musicVolume: 0.35,
  ttsVolume: 0.95,
  lobbyCards: 1,
  repeatAfterMin: 20,
  doneSlots: 3,
  autoSim: true,
  autoSimIntervalMs: 2600,
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
const userQuestions = new Map(); // key -> { text, at } Lưu câu hỏi từ bình luận của người xem
let current = null;
let prioStreak = 0;
let engineBusy = false;
const claimWaiting = new Set();

const keyOf = (p) => String(p.uniqueId || p.user || 'khach').toLowerCase();
const now = () => Date.now();
const person = (p) => ({ key: keyOf(p), user: sanitizeUserName(p.user), uniqueId: p.uniqueId || '', avatar: p.avatar || '' });
const pub = (e) => ({ key: e.key, user: e.user, avatar: e.avatar, tier: e.tier || 0, coins: e.coins || 0, giftName: e.giftName || '', question: e.question || '' });
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
  if (coins >= 100) return { tier: 3, cards: 3, label: 'Quà >99 xu (3 lá)' };
  if (coins >= 11) return { tier: 2, cards: 2, label: 'Quà 11-99 xu (2 lá)' };
  return { tier: 1, cards: 1, label: 'Quà 01-10 xu (1 lá)' };
}

// ----------------------------------------------------------------------------
// XỬ LÝ SỰ KIỆN TƯƠNG TÁC
// ----------------------------------------------------------------------------

// 1. Vào xem live: Không tự động xếp vào sảnh chờ
function ev_join(p) {
  return { ok: true, note: 'đang xem live' };
}

// 2. Thả tim (Like): Điều kiện chính thức để vào Sảnh Thường
function ev_like(p, count = 1) {
  state.stats.likes += count; saveState();
  const me = person(p);
  broadcastNotification('person.pray', { ...pub(me), count });

  if (!isKnown(me.key)) {
    lobby.normal.push({ ...me, joinedAt: now() });
    broadcastNotification('lobby.join', { ...pub(me), lobby: 'normal' });
    logEvent('💖', `${me.user} thả tim → Vào Sảnh Thường`);
    pushState(); kick();
    return { ok: true, queued: true, lobby: 'normal' };
  }
  return { ok: true, queued: false };
}

// 3. Follow / Share: Vào Sảnh Ưu Tiên
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

// 4. Tặng quà (Gift): Bước lên đài trung tâm, gắn kèm câu hỏi nếu có
function ev_gift(p, coins, giftName = 'Quà', questionText = '') {
  const me = person(p);
  coins = Math.max(1, Number(coins) || 1);
  state.stats.gifts += 1; state.stats.coins += coins; saveState();

  for (const L of [lobby.priority, lobby.normal]) {
    const i = inList(L, me.key);
    if (i >= 0) L.splice(i, 1);
  }

  // Lấy câu hỏi từ tham số trực tiếp hoặc từ bình luận gần nhất của người đó
  const savedQ = userQuestions.get(me.key);
  const cleanQ = sanitizeCleanText(questionText, 110) || (savedQ && (now() - savedQ.at < 600000) ? savedQ.text : '');
  if (cleanQ) userQuestions.set(me.key, { text: cleanQ, at: now() });

  const gi = inList(giftQueue, me.key);
  if (gi >= 0) {
    const g = giftQueue[gi];
    g.coins += coins;
    g.giftName = giftName;
    if (cleanQ) g.question = cleanQ;
    Object.assign(g, giftTier(g.coins));
  } else {
    giftQueue.push({ ...me, coins, giftName, question: cleanQ, ...giftTier(coins), joinedAt: now() });
  }

  const t = giftTier(coins);
  broadcastNotification('gift.in', { ...pub(me), coins, giftName, tier: t.tier, question: cleanQ });
  logEvent('🎁', `${me.user} tặng ${giftName} (${coins} xu) → ${t.cards} lá bài${cleanQ ? ` [Hỏi: "${cleanQ}"]` : ''}`);
  pushState(); kick();
  return { ok: true, cards: t.cards, question: cleanQ };
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
  const me = person(p); const w = sanitizeCleanText(wish, 110) || 'Cầu bình an cho mọi người';
  state.stats.prayers += 1; saveState();
  broadcastNotification('lantern.release', { ...pub(me), wish: w });
  logEvent('🏮', `${me.user}: ${w}`);
  if (prayerSpeech.length < 4) prayerSpeech.push({ ...me, wish: w });
  kick();
  return { ok: true };
}

const CLAIM_RE = /(^|\s)(claim|don nhan|xin don nhan|nhan bai|con xin nhan|nhan ne)(\s|$|[!.])/;
const PRAY_RE = /^(cau|nguyen|nam mo|a di da|binh an|chuc)(\s|$|[,.!])|(\s|^)(nam mo|a di da phat)(\s|$)/;

function ev_comment(p, text) {
  const raw = String(text || '').trim();
  if (!raw || isBlockedSpamOrToxic(raw)) return { ok: false, note: 'bị lọc' };
  const t = stripVN(raw);
  if (CLAIM_RE.test(t)) return ev_claim(p);
  if (PRAY_RE.test(t)) return ev_pray(p, raw);

  // Nếu là bình luận đặt câu hỏi / tâm sự -> Lưu lại câu hỏi cho người dùng đó
  const me = person(p);
  const cleanQ = sanitizeCleanText(raw, 110);
  if (cleanQ && cleanQ.length >= 4) {
    userQuestions.set(me.key, { text: cleanQ, at: now() });
    if (userQuestions.size > 500) userQuestions.delete(userQuestions.keys().next().value);

    // Nếu người này đang đứng trong hàng chờ Quà tặng (vừa tặng quà xong rồi mới gõ câu hỏi), gắn luôn câu hỏi vào lượt đọc!
    const gi = inList(giftQueue, me.key);
    if (gi >= 0) {
      giftQueue[gi].question = cleanQ;
      logEvent('❓', `${me.user} bổ sung câu hỏi cho quẻ quà tặng: "${cleanQ}"`);
      pushState();
      return { ok: true, note: 'đã gắn câu hỏi vào lượt tặng quà' };
    }
    logEvent('💬', `${me.user} nhắn: "${cleanQ}"`);
  }
  return { ok: true, note: 'đã lưu câu hỏi' };
}

function recentlyDone(key) {
  const d = doneList.find((x) => x.key === key);
  return !!d && now() - d.doneAt < state.settings.repeatAfterMin * 60000;
}
function isKnown(key) {
  return (current && current.key === key) || inList(lobby.priority, key) >= 0 || inList(lobby.normal, key) >= 0 || inList(giftQueue, key) >= 0 || recentlyDone(key);
}

// ----------------------------------------------------------------------------
// CHỌN LƯỢT TIẾP THEO
// ----------------------------------------------------------------------------
function pickNext() {
  if (giftQueue.length) {
    giftQueue.sort((a, b) => b.tier - a.tier || a.joinedAt - b.joinedAt);
    const g = giftQueue.shift();
    // Kiểm tra lại xem người này có vừa comment câu hỏi mới không
    if (!g.question && userQuestions.has(g.key)) {
      const qObj = userQuestions.get(g.key);
      if (now() - qObj.at < 600000) g.question = qObj.text;
    }
    return { ...g, source: 'gift' };
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
// RÚT BÀI, PHÂN TÍCH CÂU HỎI & BIÊN SOẠN THÔNG ĐIỆP
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

// Phân tích định hướng câu hỏi của người tặng quà
function analyzeQuestionFocus(qRaw, cards) {
  if (!qRaw) return null;
  const q = stripVN(qRaw);
  const cLast = cards[cards.length - 1];
  const kw = kw1(cLast);
  const p = msgParts(cLast.message);

  if (/(yeu|tinh|crush|nguoi cu|ex|quay lai|hon nhan|vo chong|ny|nguoi ay|chia tay|co nho)/.test(q)) {
    return {
      topic: 'Tình duyên',
      answer: `Trả lời câu hỏi tình cảm của bạn: Năng lượng lá ${cLast.vn} (${kw}) cho thấy ${lcFirst(p.obs)}. Lời khuyên cho trái tim bạn lúc này là ${lcFirst(p.adv)}.`
    };
  }
  if (/(tien|tai chinh|no|giau|loc|dau tu|mua ban|kinh doanh|buon ban|loi nhuan|von)/.test(q)) {
    return {
      topic: 'Tài lộc',
      answer: `Giải đáp về tài chính cho bạn: Quẻ bài hội tụ tại lá ${cLast.vn} báo hiệu ${lcFirst(p.obs)}. Về dòng tiền sắp tới, ${lcFirst(p.adv)}.`
    };
  }
  if (/(cong viec|su nghiep|thi|do|nghi viec|chuyen viec|xin viec|thang tien|sep|du an|hoc)/.test(q)) {
    return {
      topic: 'Sự nghiệp & Học vấn',
      answer: `Định hướng công việc bạn hỏi: Lá ${cLast.vn} mang tần số của ${kw}, khẳng định ${lcFirst(p.obs)}. Để đạt kết quả tốt nhất, ${lcFirst(p.adv)}.`
    };
  }
  if (/(suc khoe|benh|binh an|gia dinh|con cai|nha cua)/.test(q)) {
    return {
      topic: 'Gia đạo & Bình an',
      answer: `Về điều bạn đang trăn trở: Ánh sáng lá ${cLast.vn} nhắn nhủ rằng ${lcFirst(p.obs)}; vì vậy ${lcFirst(p.adv)}.`
    };
  }
  return {
    topic: 'Vấn đề bạn hỏi',
    answer: `Trực tiếp trả lời câu hỏi "${qRaw}" của bạn: Lá ${cLast.vn} (${kw}) chỉ rõ ${lcFirst(p.obs)}. Hướng đi dành cho bạn là ${lcFirst(p.adv)}.`
  };
}

function composeReading(entry, cards) {
  const seed = seedOf(entry.key + cards.map((c) => c.id).join());
  const nm = entry.user || 'Lữ khách';
  const source = entry.source || (entry.tier > 0 ? 'gift' : 'normal');
  const question = entry.question ? String(entry.question).trim() : '';

  const intros = [
    `Ra chào ${nm}. Ánh sáng Mặt Trời soi rọi vào tâm thức của bạn.`,
    `${nm} ơi, cổng thiên hà vừa gửi đến bạn một thông điệp định mệnh.`,
    `Ánh dương của Thần Ra đã chạm tới quẻ bài của ${nm}.`,
    `Dưới vầng nhật quang thiêng liêng, Ra gửi trao chỉ dẫn cho ${nm}.`,
    `Hỡi lữ khách ${nm}, vũ trụ thấu suốt ước nguyện trong tim bạn.`
  ];
  const intro = pick(intros, seed);

  let tierLabel = 'THÔNG ĐIỆP BÀI TAROT';
  let body = [];
