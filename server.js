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
const BGM_DIR = path.join(DATA_DIR, 'bgm');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const DECK_FILE = path.join(DATA_DIR, 'cards.json');

fs.mkdirSync(TTS_CACHE_DIR, { recursive: true });
fs.mkdirSync(BGM_DIR, { recursive: true });

if (!fs.existsSync(DECK_FILE)) {
  console.error('Chưa có data/cards.json — vui lòng kiểm tra lại thư mục data.');
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
    .replace(/\s+/g, ' ').replace(/^[.,!?\s-]+|[.,!?\s-]+$/g, '').slice(0, 140);
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
    const selectedVoice = String(voiceOverride || state.settings.ttsVoice || 'maichi').toLowerCase();
    
    // Nếu người dùng chọn các giọng đọc Web Speech API trên trình duyệt (nu-huyen-bi, nam-tram-am, tien-tri, nu-diu-dang, nam-co-dai),
    // trả về ok: false để trình duyệt tự động đọc bằng bộ Web Speech API tương ứng với pitch/rate riêng biệt!
    if (selectedVoice !== 'maichi' && !this.voices.includes(selectedVoice)) {
      return Promise.resolve({ ok: false, useWebSpeech: true, voice: selectedVoice });
    }

    const dedupKey = `${selectedVoice}::${cleanText}`;
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
      const payload = JSON.stringify({ id, text: cleanText, voice: selectedVoice }) + '\n';
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
  ttsNormalEnabled: true,    // Bật/tắt giọng nói khi đọc bài ở Sảnh Thường
  ttsPriorityEnabled: true,  // Bật/tắt giọng nói khi đọc bài ở Sảnh Ưu Tiên
  ttsVoice: 'nu-huyen-bi',   // Lựa chọn giọng đọc: nu-huyen-bi | nam-tram-am | tien-tri | nu-diu-dang | nam-co-dai | maichi
  bgmUrl: '',                // Đường dẫn file MP3 nhạc nền
  bgmName: 'Nhạc Vũ Trụ Mặc Định',
  musicVolume: 0.40,
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
const livePresent = new Set();        // Ghi nhận những người đã thực sự vào phiên live
const userQuestions = new Map();      // Lưu câu hỏi gần nhất của từng người xem (key -> question string)
let current = null;
let prioStreak = 0;
let engineBusy = false;
const claimWaiting = new Set();

const keyOf = (p) => String(p.uniqueId || p.user || 'khach').toLowerCase();
const now = () => Date.now();
const person = (p) => ({ key: keyOf(p), user: sanitizeUserName(p.user), uniqueId: p.uniqueId || '', avatar: p.avatar || '' });
const pub = (e) => ({
  key: e.key, user: e.user, avatar: e.avatar, tier: e.tier || 0,
  coins: e.coins || 0, giftName: e.giftName || '', question: e.question || userQuestions.get(e.key) || ''
});
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
  if (coins >= 100) return { tier: 3, cards: 3, label: 'Mức ≥ 100 xu' };
  if (coins >= 11) return { tier: 2, cards: 2, label: 'Mức 11–99 xu' };
  return { tier: 1, cards: 1, label: 'Mức 1–10 xu' };
}

// ----------------------------------------------------------------------------
// NHẬN DIỆN CÂU HỎI & CHỦ ĐỀ TỪ BÌNH LUẬN CHO NGƯỜI TẶNG QUÀ
// ----------------------------------------------------------------------------
function detectQuestionTopic(qText) {
  if (!qText) return null;
  const s = stripVN(qText);
  if (/(tinh yeu|tinh cam|nguoi yeu|crush|ex|ny|nyc|chia tay|quay lai|duyen|hon nhan|vo chong|co don|thich|yeu)/.test(s)) {
    return {
      topic: 'tình duyên',
      label: 'Tình Duyên & Mối Quan Hệ',
      opening: 'Về chuyện tình cảm và mối nhân duyên mà bạn đang trăn trở',
      closing: 'Trong tình yêu, khi bạn mở lòng đón nhận và trân trọng giá trị bản thân, nhân duyên lành sẽ tự khắc nở hoa.'
    };
  }
  if (/(cong viec|su nghiep|錢|tien|tai chinh|lam an|kinh doanh|buon ban|thang tien|xin viec|nhay viec|dau tu|no nan|loc|giau)/.test(s)) {
    return {
      topic: 'công việc & tài chính',
      label: 'Sự Nghiệp & Tài Lộc',
      opening: 'Hướng về con đường công danh, sự nghiệp và tài vận mà bạn vừa hỏi',
      closing: 'Hãy nắm bắt thời cơ với sự quyết đoán và tỉnh táo, dòng chảy thịnh vượng đang dần nghiêng về phía bạn.'
    };
  }
  if (/(hoc tap|thi cu|diem|truong|do|rot|du hoc|nganh|tot nghiep|kiem tra)/.test(s)) {
    return {
      topic: 'học tập & thi cử',
      label: 'Học Vấn & Thi Cử',
      opening: 'Đối với hành trình học vấn và kỳ thi quan trọng sắp tới của bạn',
      closing: 'Mọi nỗ lực bền bỉ hôm nay đều đang tích tụ thành quả ngọt; hãy giữ tâm trí thật sáng suốt và tự tin.'
    };
  }
  if (/(suc khoe|benh|om|met|tinh than|스트레스|ap luc|អារម្មណ៍|chua lanh|binh an|gia dinh|nha cua)/.test(s)) {
    return {
      topic: 'sức khỏe & bình an',
      label: 'Sức Khỏe & Gia Đạo',
      opening: 'Về năng lượng chữa lành, sức khỏe và sự bình an trong tâm hồn bạn',
      closing: 'Hãy dành thời gian vỗ về bản thân và buông nhẹ những muộn phiền, ánh sáng thái dương luôn chở che cho bạn.'
    };
  }
  if (/(bao gio|khi nao|thang may|nam nay|tuong lai|sap toi|co nen|nen khong|lua chon|살|di hay o|sao)/.test(s) || qText.includes('?')) {
    return {
      topic: 'định hướng tương lai',
      label: 'Định Hướng & Quyết Định',
      opening: 'Trước ngã rẽ và câu hỏi mà bạn đang gửi gắm vào vũ trụ',
      closing: 'Trực giác của bạn đã có sẵn câu trả lời; hãy dũng cảm bước theo tiếng gọi của trái tim mình.'
    };
  }
  return {
    topic: 'tâm nguyện riêng',
    label: 'Tâm Nguyện & Vận Mệnh',
    opening: `Lắng nghe nỗi niềm của bạn về điều bạn nhắn nhủ: "${qText}"`,
    closing: 'Vũ trụ luôn hồi đáp những trái tim chân thành; hãy tin tưởng vào hành trình phía trước.'
  };
}

// ----------------------------------------------------------------------------
// XỬ LÝ SỰ KIỆN TƯƠNG TÁC
// ----------------------------------------------------------------------------
// 1. Vào xem live: Ghi nhận đã vào phòng live, KHÔNG tự động vào sảnh chờ
function ev_join(p) {
  const me = person(p);
  livePresent.add(me.key);
  return { ok: true, note: 'đã vào phòng live (thả tim để vào sảnh chờ)' };
}

// 2. Thả tim (Like): Chỉ người vào phiên live và thả tim mới được vào Sảnh Thường + vái lạy 3 cái
function ev_like(p, count = 1) {
  state.stats.likes += count; saveState();
  const me = person(p);
  livePresent.add(me.key);

  if (!isKnown(me.key)) {
    lobby.normal.push({ ...me, joinedAt: now() });
    broadcastNotification('lobby.join', { ...pub(me), lobby: 'normal', bow3: true });
    logEvent('💖', `${me.user} vào live & thả tim → Bước vào Sảnh Thường (vái lạy 3 cái)`);
    pushState(); kick();
    // Sau khi bước vào sảnh, phát hiệu ứng vái lạy 3 cái
    setTimeout(() => broadcastNotification('person.bow3', { ...pub(me), count }), 400);
    return { ok: true, queued: true, lobby: 'normal' };
  } else {
    broadcastNotification('person.pray', { ...pub(me), count });
  }
  return { ok: true, queued: false };
}

// 3. Follow / Share: Bước vào Sảnh Ưu Tiên + vái lạy 3 cái
function ev_follow(p, kind = 'follow') {
  const me = person(p);
  livePresent.add(me.key);
  if (current && current.key === me.key) return { ok: true, note: 'đang được đọc' };
  if (inList(lobby.priority, me.key) >= 0 || inList(giftQueue, me.key) >= 0) return { ok: true, note: 'đã ở sảnh ưu tiên' };
  if (recentlyDone(me.key)) return { ok: true, note: 'đã được đọc gần đây' };
  const i = inList(lobby.normal, me.key);
  const entry = i >= 0 ? lobby.normal.splice(i, 1)[0] : { ...me, joinedAt: now() };
  lobby.priority.push(entry);
  broadcastNotification(i >= 0 ? 'lobby.move' : 'lobby.join', { ...pub(entry), lobby: 'priority', from: i >= 0 ? 'normal' : null, bow3: true });
  logEvent(kind === 'share' ? '🔁' : '💜', `${me.user} ${kind === 'share' ? 'chia sẻ live' : 'theo dõi kênh'} → Sảnh Ưu Tiên`);
  pushState(); kick();
  setTimeout(() => broadcastNotification('person.bow3', { ...pub(entry), count: 3 }), 400);
  return { ok: true, lobby: 'priority' };
}

// 4. Tặng quà (Gift): Nhận diện kèm câu hỏi nếu có
function ev_gift(p, coins, giftName = '', question = '') {
  const me = person(p);
  livePresent.add(me.key);
  coins = Math.max(1, Number(coins) || 1);
  const t = giftTier(coins);
  const displayGift = giftName || `Gói ${coins} xu`;
  const cleanQ = sanitizeWishText(question || p.question || '');
  if (cleanQ) userQuestions.set(me.key, cleanQ);

  state.stats.gifts += 1; state.stats.coins += coins; saveState();
  for (const L of [lobby.priority, lobby.normal]) { const i = inList(L, me.key); if (i >= 0) L.splice(i, 1); }
  const gi = inList(giftQueue, me.key);
  if (gi >= 0) {
    const g = giftQueue[gi];
    g.coins += coins;
    g.giftName = displayGift;
    if (cleanQ) g.question = cleanQ;
    Object.assign(g, giftTier(g.coins));
  } else {
    giftQueue.push({
      ...me, coins, giftName: displayGift,
      question: cleanQ || userQuestions.get(me.key) || '',
      ...t, joinedAt: now()
    });
  }
  broadcastNotification('gift.in', { ...pub(me), coins, giftName: displayGift, tier: t.tier, question: cleanQ || userQuestions.get(me.key) || '' });
  logEvent('🎁', `${me.user} tặng ${coins} xu → Trải ${t.cards} lá bài${cleanQ ? ` (Hỏi: "${cleanQ}")` : ''}`);
  pushState(); kick();
  return { ok: true, cards: t.cards };
}

// 5. Đón nhận / Claim: Hiển thị lá bài ngay bên cạnh avatar người đó
function ev_claim(p) {
  const me = person(p);
  if (current && current.key === me.key) {
    claimWaiting.add(me.key);
    current.claimed = true;
    broadcastNotification('card.claim', { ...pub(current), cardIds: current.cards.map(c => c.id), immediate: true });
    logEvent('✨', `${me.user} đón nhận bộ bài đang mở`);
    pushState();
    return { ok: true, note: 'đã nhận bài trực tiếp' };
  }
  const d = doneList.find((x) => x.key === me.key);
  if (d) {
    d.claimed = true;
    broadcastNotification('card.claim', { ...pub(d), cardIds: d.cardIds });
    logEvent('✨', `${d.user} đón nhận lá bài về bên cạnh mình`);
    pushState();
    return { ok: true };
  }
  // Nếu bấm nút Claim thử nghiệm trên thanh công cụ khi đang có người đọc bài hoặc người vừa đọc xong
  if (current) {
    claimWaiting.add(current.key);
    current.claimed = true;
    broadcastNotification('card.claim', { ...pub(current), cardIds: current.cards.map(c => c.id), immediate: true });
    logEvent('✨', `${current.user} đón nhận lá bài`);
    pushState();
    return { ok: true };
  }
  if (doneList.length > 0) {
    const latest = doneList[0];
    latest.claimed = true;
    broadcastNotification('card.claim', { ...pub(latest), cardIds: latest.cardIds });
    logEvent('✨', `${latest.user} đón nhận lá bài`);
    pushState();
    return { ok: true };
  }
  return { ok: false, note: 'không có bài để nhận' };
}

// 6. Cầu nguyện / Thả đèn
function ev_pray(p, wish) {
  const me = person(p); const w = sanitizeWishText(wish) || 'Cầu bình an và may mắn cho mọi người';
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
  const me = person(p);
  livePresent.add(me.key);
  const t = stripVN(raw);

  if (CLAIM_RE.test(t)) return ev_claim(p);
  if (PRAY_RE.test(t)) return ev_pray(p, raw);

  // Lưu lại câu hỏi từ bình luận để nếu người này đã hoặc sắp tặng quà thì Thần Ra giải đáp trực tiếp
  const cleanQ = sanitizeWishText(raw);
  if (cleanQ && cleanQ.length >= 4) {
    userQuestions.set(me.key, cleanQ);
    // Nếu người này đang nằm trong giftQueue chờ đọc thì gắn câu hỏi vào luôn
    const gi = inList(giftQueue, me.key);
    if (gi >= 0) {
      giftQueue[gi].question = cleanQ;
      logEvent('💬', `Ghi nhận câu hỏi của VIP ${me.user}: "${cleanQ}"`);
      pushState();
    }
  }
  return { ok: true, note: 'đã ghi nhận bình luận / câu hỏi' };
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
    const g = giftQueue.shift();
    if (!g.question && userQuestions.has(g.key)) g.question = userQuestions.get(g.key);
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
// RÚT BÀI VÀ BIÊN SOẠN THÔNG ĐIỆP UYỂN CHUYỂN, TRẢ LỜI CÂU HỎI VIP
// ----------------------------------------------------------------------------
function drawCards(n) {
  const pool = [...DECK]; const out = [];
  for (let i = 0; i < n; i++) out.push(pool.splice(crypto.randomInt(pool.length), 1)[0]);
  return out;
}
const slim = (c) => ({ id: c.id, vn: c.vn, en: c.en, image: c.image, keywords: c.keywords, message: c.message, roman: c.roman, arcana: c.arcana, suit: c.suit });
const pick = (arr, seed) => arr[seed % arr.length];
const seedOf = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const lcFirst = (s) => s ? s.charAt(0).toLowerCase() + s.slice(1) : '';
const ucFirst = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
const msgParts = (m) => { const [a, b] = String(m || '').replace(/\.$/, '').split('; '); return { obs: a || '', adv: b || a || '' }; };
const kw1 = (c) => String(c.keywords || '').split(' · ')[0];

function composeReading(entry, cards) {
  const seed = seedOf(entry.key + cards.map((c) => c.id).join() + (entry.question || ''));
  const nm = entry.user || 'Lữ khách';
  const source = entry.source || (entry.tier > 0 ? 'gift' : 'normal');
  const rawQuestion = entry.question || userQuestions.get(entry.key) || '';
  const qInfo = detectQuestionTopic(rawQuestion);

  let tierLabel = 'THÔNG ĐIỆP BÀI TAROT';
  let lines = [];

  // 1. Sảnh Thường (Thả tim): 1 lá bài ngắn gọn, súc tích
  if (source === 'normal' || (entry.tier === 0 && entry.source !== 'priority')) {
    tierLabel = 'SẢNH THƯỜNG • 1 LÁ TRỌNG TÂM';
    const c = cards[0];
    const p = msgParts(c.message);
    const intro = pick([
      `Thần Ra chào ${nm}, cảm ơn những nhịp tim ấm áp của bạn.`,
      `${nm} thân mến, ánh sáng thiên hà vừa gọi tên bạn.`,
      `Chào ${nm}, vũ trụ gửi đến bạn một tín hiệu ngắn gọn.`
    ], seed);
    lines = [
      `${intro} Lá bài của bạn là ${c.vn}.`,
      `Từ khóa năng lượng: ${ucFirst(c.keywords)}.`,
      `Thông điệp: ${ucFirst(p.obs)}. Lời khuyên: ${ucFirst(p.adv)}.`
    ];
  }
  // 2. Sảnh Ưu Tiên (Follow / Share): Sâu sắc hơn, định hướng rõ
  else if (source === 'priority') {
    tierLabel = 'SẢNH ƯU TIÊN • ĐỊNH HƯỚNG VẬN MỆNH';
    const intro = pick([
      `Tri ân ${nm} đã theo dõi và đồng hành cùng Thần Ra.`,
      `Duyên lành hội tụ, cổng thiên hà mở lối cho ${nm}.`,
      `Ánh sáng vĩnh hằng của Ra soi chiếu quẻ bài của ${nm}.`
    ], seed);
    if (cards.length === 1) {
      const c = cards[0];
      const p = msgParts(c.message);
      lines = [
        `${intro} Bạn rút được lá ${c.vn}.`,
        `Năng lượng chủ đạo xoay quanh ${c.keywords.replace(/ · /g, ', ')}.`,
        `Hiện tại, ${lcFirst(p.obs)}. Vì vậy, ${lcFirst(p.adv)}. Hãy tin tưởng vào trực giác của chính mình.`
      ];
    } else {
      const [a, b] = cards;
      const pa = msgParts(a.message), pb = msgParts(b.message);
      lines = [
        `${intro} Hai lá bài xuất hiện là ${a.vn} và ${b.vn}.`,
        `Sự giao thoa giữa ${kw1(a)} và ${kw1(b)} báo hiệu một bước chuyển mình đáng kể.`,
        `Lời khuyên dành cho bạn: ${ucFirst(pa.obs)}, đồng thời ${lcFirst(pb.adv)}.`
      ];
    }
  }
  // 3. Người Tặng Quà (VIP Gift): Văn phong uyển chuyển, giàu hình ảnh, giải đáp trực tiếp câu hỏi nếu có
  else {
    const coins = entry.coins || 1;
    tierLabel = qInfo
      ? `VIP ${coins} XU • GIẢI ĐÁP: ${qInfo.label.toUpperCase()}`
      : `VIP ${coins} XU • TIÊN TRI THẦN RA (${cards.length} LÁ)`;

    const vipIntros = [
      `Hỡi ${nm}, Thần Ra trân trọng tấm lòng hào phóng với lễ vật ${coins} xu của bạn. Giữa vòng xoáy thiên hà rực rỡ, bộ bài huyền bí đã mở ra.`,
      `Ánh hào quang kim hoàng của Thần Ra bừng sáng chào đón ${nm}. Cảm ơn món quà ${coins} xu đầy trân quý mà bạn đã dâng tặng.`,
      `Từ đỉnh tháp mặt trời vĩnh cửu, Thần Ra lắng nghe trọn vẹn tâm niệm của ${nm} qua món quà ${coins} xu.`
    ];
    const intro = pick(vipIntros, seed);
    const topicLead = qInfo
      ? `${qInfo.opening}, những lá bài Tarot đã lên tiếng vô cùng rõ ràng.`
      : `Dòng chảy định mệnh của bạn trong giai đoạn sắp tới được phản chiếu trọn vẹn qua trải bài này.`;

    if (cards.length === 1) {
      const c = cards[0];
      const p = msgParts(c.message);
      lines = [
        `${intro} ${topicLead}`,
        `Lá bài chủ mệnh xuất hiện là ${c.vn}, mang nguồn năng lượng của ${c.keywords.replace(/ · /g, ', ')}.`,
        `Lá bài cho thấy: ${ucFirst(p.obs)}. Thiên cơ nhắn nhủ rằng ${lcFirst(p.adv)}.`,
        qInfo ? qInfo.closing : `Nguyện ánh sáng Mặt Trời dẫn lối cho ${nm} gặt hái thành tựu viên mãn. Hãy bình luận Đón Nhận để giữ trọn vượng khí này!`
      ];
    } else if (cards.length === 2) {
      const [a, b] = cards;
      const pa = msgParts(a.message), pb = msgParts(b.message);
      lines = [
        `${intro} ${topicLead}`,
        `Hai lá bài song hành cùng bạn là ${a.vn} kết hợp với ${b.vn}.`,
        `Lá thứ nhất (${a.vn}) phản ánh hiện tại: ${ucFirst(pa.obs)}, với điểm tựa là ${kw1(a)}.`,
        `Lá thứ hai (${b.vn}) mở ra hướng giải quyết: Từ nguồn lực ${kw1(b)}, ${lcFirst(pb.adv)}.`,
        qInfo ? qInfo.closing : `Sự kết hợp này khẳng định vận may đang xoay chuyển thuận lợi. Bạn hãy bình luận Đón Nhận để thâu nạp năng lượng nhé!`
      ];
    } else {
      const [a, b, c] = cards;
      const pa = msgParts(a.message), pb = msgParts(b.message), pc = msgParts(c.message);
      lines = [
        `${intro} ${topicLead}`,
        `Trải bài Ba Ngôi Sao Định Mệnh đã gọi tên: ${a.vn}, ${b.vn} và ${c.vn}.`,
        `Khởi nguồn từ lá ${a.vn}: Nền tảng của bạn gắn liền với ${kw1(a)} — ${lcFirst(pa.obs)}.`,
        `Bước sang hiện tại cùng lá ${b.vn}: Sự chuyển hóa của ${kw1(b)} nhắc nhở bạn rằng ${lcFirst(pb.obs)}, và ${lcFirst(pb.adv)}.`,
        `Đích đến tương lai mở ra với lá ${c.vn}: Biểu trưng cho ${kw1(c)} — ${lcFirst(pc.obs)}, vì thế ${lcFirst(pc.adv)}.`,
        qInfo
          ? `${qInfo.closing} Hãy bình luận Đón Nhận để khắc ghi phước lành tối thượng từ Thần Ra!`
          : `Một chu kỳ rực rỡ và viên mãn đang chờ đón ${nm}. Hãy bình luận Đón Nhận ngay để đón rước đại cát đại lợi về mình!`
      ];
    }
  }

  return { tierLabel, lines, speech: lines.join(' '), question: rawQuestion };
}

// ----------------------------------------------------------------------------
// KIỂM TRA BẬT/TẮT GIỌNG ĐỌC THEO SẢNH
// ----------------------------------------------------------------------------
function shouldSpeakForEntry(entry) {
  if (!state.settings.ttsEnabled) return false;
  if (entry.source === 'gift' || entry.tier > 0) return true; // Quà tặng luôn đọc khi TTS tổng bật
  if (entry.source === 'priority') return !!state.settings.ttsPriorityEnabled;
  return !!state.settings.ttsNormalEnabled;
}

const WALK_MS = 3200, DEAL_MS = 2400, HOLD_MS = 2400;
const TS = Number(process.env.RA_TIME_SCALE || 1);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function kick() { if (!engineBusy) setTimeout(engineLoop, 50); }

async function speakInGap() {
  const pr = prayerSpeech.shift(); if (!pr) return false;
  const text = `Thần Ra lắng nghe lời nguyện cầu của ${pr.user}: ${pr.wish}`;
  const allowTts = state.settings.ttsEnabled;
  const res = allowTts ? await zeroTts.synthesize(text) : null;
  const ms = res && res.ok ? Math.round((res.durationSec || 4) * 1000) : Math.max(3500, text.length * 68);
  broadcastNotification('prayer.speak', {
    ...pub(pr), wish: pr.wish, text,
    audioUrl: res && res.ok ? res.url : null,
    ttsAllowed: allowTts,
    voice: state.settings.ttsVoice,
    durationMs: ms
  });
  await sleep(ms + 500);
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
  const { tierLabel, lines, speech, question } = composeReading(entry, cards);
  current = { ...entry, cards, phase: 'walk', skip: false, claimed: false };
  pushState();

  const ttsAllowed = shouldSpeakForEntry(entry);
  const tts = ttsAllowed ? await zeroTts.synthesize(speech) : null;
  const speakMs = tts && tts.ok
    ? Math.round((tts.durationSec || 8) * 1000)
    : Math.max(5500, speech.length * (entry.source === 'gift' ? 68 : 62));

  broadcastNotification('reading.start', {
    ...pub(entry), source: entry.source, cards: cards.map(slim), tierLabel, lines, speech, question,
    audioUrl: tts && tts.ok ? tts.url : null,
    ttsAllowed,
    voice: state.settings.ttsVoice,
    speakMs, walkMs: WALK_MS, dealMs: DEAL_MS, holdMs: HOLD_MS,
  });

  logEvent('🔮', `Ra đọc ${cards.length} lá cho ${entry.user}: ${cards.map((c) => c.vn).join(', ')}`);
  const total = (WALK_MS + cards.length * DEAL_MS + speakMs + HOLD_MS) * TS;
  const t0 = now();
  while (now() - t0 < total && !current.skip) await sleep(150);

  const claimed = claimWaiting.delete(entry.key) || !!current.claimed;
  const d = { ...pub(entry), cardIds: cards.map((c) => c.id), doneAt: now(), claimed };
  const di = inList(doneList, d.key); if (di >= 0) doneList.splice(di, 1);
  doneList.unshift(d); doneList.length = Math.min(doneList.length, 40);
  state.stats.readings += 1; state.stats.cards += cards.length; saveState();
  broadcastNotification('reading.end', { ...pub(entry), cardIds: d.cardIds, claimed });
  current = null; pushState();
  await sleep(800);
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
  
  c.on(WebcastEvent.MEMBER, (d) => ev_join(extractUser(d)));
  c.on(WebcastEvent.CHAT, (d) => { const u = extractUser(d); ev_comment(u, d?.content || d?.comment || ''); });
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
    ev_gift(u, coins, `Gói ${coins} xu`);
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
const SIM_NAMES = [
  'Ngọc Anh', 'Minh Quân', 'Diệu Thảo', 'Hoàng Nam', 'Thanh Hà', 'Đức Thịnh',
  'Bảo Châu', 'Gia Hân', 'Tuấn Kiệt', 'Mai Phương', 'Khánh Linh', 'Quốc Bảo',
  'Thu Trang', 'Hải Đăng', 'Lan Chi', 'Việt Anh', 'Phương Nhi', 'Hoàng Dũng',
  'Thiên Ân', 'Bích Ngọc', 'Quang Huy', 'Nhật Minh', 'Tuyết Mai', 'Trọng Nhân'
];
const SIM_WISH = [
  'Cầu cho gia đình luôn bình an', 'Nguyện mọi điều tốt đẹp sẽ đến',
  'Chúc cả phòng live một ngày may mắn', 'Xin vũ trụ chỉ lối cho con', 'Bình an và hạnh phúc nhé'
];
const SIM_QUESTIONS = [
  'Chuyện tình cảm của em tháng tới thế nào ạ?',
  'Công việc và tài chính sắp tới có khởi sắc không thần Ra?',
  'Người cũ có còn nghĩ đến em và quay lại không ạ?',
  'Sắp tới em dự định chuyển việc thì có thuận lợi không?',
  'Kỳ thi sắp tới của em kết quả có tốt đẹp không ạ?'
];

function simStep() {
  const r = Math.random();
  const u = { user: SIM_NAMES[crypto.randomInt(SIM_NAMES.length)], uniqueId: `sim${crypto.randomInt(36)}` };
  if (r < 0.44) ev_like(u, 5);
  else if (r < 0.65) ev_follow(u, Math.random() < 0.5 ? 'follow' : 'share');
  else if (r < 0.77) ev_pray(u, SIM_WISH[crypto.randomInt(SIM_WISH.length)]);
  else if (r < 0.88) ev_claim(u);
  else {
    const c = [5, 10, 25, 50, 120, 200][crypto.randomInt(6)];
    const q = SIM_QUESTIONS[crypto.randomInt(SIM_QUESTIONS.length)];
    ev_gift(u, c, `Gói ${c} xu`, q);
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
    case 'tarot.gift': return ev_gift(p, p.coins, p.giftName, p.question);
    case 'tarot.claim': return ev_claim(p);
    case 'tarot.pray': return ev_pray(p, p.wish);
    case 'tarot.comment': return ev_comment(p, p.text);
    case 'tarot.skip': if (current) current.skip = true; return { ok: true };
    case 'tarot.preview': {
      const n = Math.min(3, Math.max(1, Number(p.cards) || 1));
      const cs = p.cardIds ? p.cardIds.map((id) => DECK.find((c) => c.id === id)).filter(Boolean) : drawCards(n);
      const isGift = n >= 2 || !!p.question;
      return {
        cards: cs.map(slim),
        ...composeReading({
          key: 'preview',
          user: p.user || 'Bạn',
          tier: n === 3 ? 3 : n === 2 ? 2 : (p.question ? 1 : 0),
          coins: n === 3 ? 150 : n === 2 ? 30 : (p.question ? 10 : 0),
          source: isGift ? 'gift' : 'normal',
          question: p.question || ''
        }, cs)
      };
    }
    case 'tarot.reset':
      lobby.priority.length = lobby.normal.length = giftQueue.length = doneList.length = prayerSpeech.length = 0; prioStreak = 0;
      if (current) current.skip = true; pushState(); return getPublicState();
    case 'tarot.updateSettings': {
      const keys = Object.keys(DEFAULT_SETTINGS).filter((k) => k !== 'autoSim');
      for (const k of keys) {
        if (p[k] !== undefined) {
          state.settings[k] = typeof DEFAULT_SETTINGS[k] === 'number'
            ? Number(p[k])
            : typeof DEFAULT_SETTINGS[k] === 'boolean'
              ? !!p[k]
              : String(p[k]);
        }
      }
      saveState(); pushState();
      broadcastNotification('settings.updated', state.settings);
      return state.settings;
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
app.use(express.json({ limit: '50mb' }));
app.use('/tts-cache', express.static(TTS_CACHE_DIR, { maxAge: '7d' }));
app.use('/bgm', express.static(BGM_DIR, { maxAge: '7d' }));
app.use(express.static(path.join(ROOT, 'public')));
app.get('/admin', (_req, res) => res.sendFile(path.join(ROOT, 'public', 'admin.html')));

// API Upload file MP3 nhạc nền từ Admin hoặc màn hình Live
app.post('/api/bgm', express.raw({ type: '*/*', limit: '50mb' }), async (req, res) => {
  try {
    const rawName = decodeURIComponent(req.headers['x-filename'] || 'nhac-nen.mp3');
    const safeName = rawName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const fileName = `bgm_${Date.now()}_${safeName}`;
    const filePath = path.join(BGM_DIR, fileName);
    await fs.promises.writeFile(filePath, req.body);
    state.settings.bgmUrl = `/bgm/${fileName}`;
    state.settings.bgmName = rawName;
    saveState();
    pushState();
    broadcastNotification('bgm.changed', { url: state.settings.bgmUrl, name: state.settings.bgmName });
    res.json({ ok: true, url: state.settings.bgmUrl, name: state.settings.bgmName });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

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
  console.log(`🎛️  Admin & Điều khiển : http://localhost:${PORT}/admin`);
  console.log(`🔌 JSON-RPC 2.0       : POST /rpc  |  ws://localhost:${PORT}/ws`);
  console.log('============================================================');
  if (state.settings.autoSim) configureAutoSim(true);
  const ch = process.env.TIKTOK_USER;
  if (ch) connectTikTokLive(ch).catch((e) => console.warn(`[Auto-Connect @${ch}]`, e.message));
});
