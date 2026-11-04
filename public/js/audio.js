// Quản lý Âm thanh: Nhạc nền MP3 lặp vô hạn (tự động thu nhỏ khi đọc bài, tăng lại khi rảnh),
// Hiệu ứng âm thanh phép thuật, và Hệ thống 6 phong cách giọng đọc tiếng Việt đa dạng.
(() => {
  let ctx = null, master = null, pad = null, ducked = false;
  let musicVol = 0.40, ttsVol = 0.95, ttsOn = true;
  let bgAudioEl = null, currentBgmUrl = '';
  let currentVoice = 'nu-huyen-bi';
  const speakQ = [];
  let speaking = false;

  // Cấu hình 6 phong cách giọng đọc khác nhau để không bị nhàm chán
  const VOICE_PROFILES = {
    'nu-huyen-bi': { pitch: 1.06, rate: 0.94, preferFemale: true },
    'nam-tram-am': { pitch: 0.76, rate: 0.91, preferFemale: false },
    'tien-tri':    { pitch: 0.86, rate: 0.84, preferFemale: true },
    'nu-diu-dang': { pitch: 1.18, rate: 0.97, preferFemale: true },
    'nam-co-dai':  { pitch: 0.70, rate: 1.01, preferFemale: false },
    'maichi':      { pitch: 1.0,  rate: 0.95, preferFemale: true }
  };

  function init() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      if (bgAudioEl && bgAudioEl.src && bgAudioEl.paused) {
        bgAudioEl.play().catch(() => {});
      }
      return;
    }
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = musicVol;
    master.connect(ctx.destination);

    // Dàn hợp âm nền vũ trụ mặc định (chỉ kêu khi chưa chọn file MP3)
    pad = ctx.createGain();
    pad.gain.value = currentBgmUrl ? 0.0 : 0.45;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 850;
    pad.connect(lp);
    lp.connect(master);

    [110, 164.81, 220, 277.18, 329.63].forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = i % 2 ? 'sine' : 'triangle';
      o.frequency.value = f;
      o.detune.value = (i - 2) * 4;
      const g = ctx.createGain();
      g.gain.value = 0.11;
      const l = ctx.createOscillator();
      l.frequency.value = 0.05 + i * 0.021;
      const lg = ctx.createGain();
      lg.gain.value = 0.06;
      l.connect(lg);
      lg.connect(g.gain);
      l.start();
      o.connect(g);
      g.connect(pad);
      o.start();
    });

    ensureBgAudioElement();
    if (currentBgmUrl) {
      bgAudioEl.src = currentBgmUrl;
      bgAudioEl.play().catch(() => {});
    }
  }

  function ensureBgAudioElement() {
    if (!bgAudioEl) {
      bgAudioEl = new Audio();
      bgAudioEl.loop = true; // Chạy lặp vô hạn
      bgAudioEl.preload = 'auto';
      bgAudioEl.volume = ducked ? musicVol * 0.22 : musicVol;
      // Đảm bảo lặp vô hạn kể cả trên các trình duyệt khắt khe
      bgAudioEl.addEventListener('ended', () => {
        bgAudioEl.currentTime = 0;
        bgAudioEl.play().catch(() => {});
      });
    }
    return bgAudioEl;
  }

  function loadBgmUrl(url) {
    if (!url || url === currentBgmUrl) return;
    currentBgmUrl = url;
    const el = ensureBgAudioElement();
    el.src = url;
    el.loop = true;
    el.volume = ducked ? musicVol * 0.22 : musicVol;
    if (ctx && pad) {
      // Tắt tiếng synth mặc định khi đã có file MP3 nhạc nền
      pad.gain.setTargetAtTime(0.0, ctx.currentTime, 0.3);
    }
    el.play().catch(() => {});
  }

  function rampAudioVolume(targetVol, durationMs = 400) {
    if (!bgAudioEl) return;
    const startVol = bgAudioEl.volume;
    const diff = targetVol - startVol;
    if (Math.abs(diff) < 0.01) {
      bgAudioEl.volume = Math.max(0, Math.min(1, targetVol));
      return;
    }
    const steps = 12;
    const stepTime = durationMs / steps;
    let step = 0;
    const timer = setInterval(() => {
      step++;
      const nextV = startVol + (diff * (step / steps));
      bgAudioEl.volume = Math.max(0, Math.min(1, nextV));
      if (step >= steps) clearInterval(timer);
    }, stepTime);
  }

  function tone(f, t0, dur, type = 'sine', vol = 0.2, dest) {
    if (!ctx) return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.value = f;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    o.connect(g);
    g.connect(dest || ctx.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  const A = {
    unlock: init,
    loadBgmUrl,
    setVoice(v) {
      if (v) currentVoice = v;
    },
    setVolumes(m, t, on) {
      if (m != null) {
        musicVol = Number(m);
        const target = ducked ? musicVol * 0.22 : musicVol;
        if (master && ctx) master.gain.setTargetAtTime(target, ctx.currentTime, 0.2);
        if (bgAudioEl) rampAudioVolume(target, 250);
      }
      if (t != null) ttsVol = Number(t);
      if (on != null) ttsOn = !!on;
    },
    sparkle() {
      if (!ctx) return;
      const t = ctx.currentTime;
      [1318, 1760, 2093, 2637].forEach((f, i) => tone(f, t + i * 0.07, 0.8, 'sine', 0.08));
    },
    chime() {
      if (!ctx) return;
      const t = ctx.currentTime;
      [523, 659, 784, 1047].forEach((f, i) => {
        tone(f, t + i * 0.12, 2.2, 'sine', 0.14);
        tone(f * 2.01, t + i * 0.12, 1.2, 'sine', 0.05);
      });
    },
    whoosh() {
      if (!ctx) return;
      const t = ctx.currentTime, n = ctx.createBufferSource(), b = ctx.createBuffer(1, ctx.sampleRate * 0.6, ctx.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
      n.buffer = b;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.setValueAtTime(400, t);
      f.frequency.exponentialRampToValueAtTime(3500, t + 0.5);
      const g = ctx.createGain();
      g.gain.value = 0.12;
      n.connect(f);
      f.connect(g);
      g.connect(ctx.destination);
      n.start(t);
    },
    gift(tier = 1) {
      if (!ctx) return;
      const t = ctx.currentTime;
      const seq = tier >= 3 ? [392, 523, 659, 784, 1047, 1319] : tier === 2 ? [523, 659, 784, 1047] : [659, 880];
      seq.forEach((f, i) => tone(f, t + i * 0.09, 1.2, 'triangle', 0.13));
    },
    riffle() {
      if (!ctx) return;
      const t = ctx.currentTime;
      for (let i = 0; i < 16; i++) {
        const b = ctx.createBuffer(1, 400, ctx.sampleRate), d = b.getChannelData(0);
        for (let k = 0; k < d.length; k++) d[k] = (Math.random() * 2 - 1) * (1 - k / d.length);
        const n = ctx.createBufferSource();
        n.buffer = b;
        const f = ctx.createBiquadFilter();
        f.type = 'bandpass';
        f.frequency.value = 2400 + Math.random() * 2200;
        const g = ctx.createGain();
        g.gain.value = 0.16;
        n.connect(f);
        f.connect(g);
        g.connect(ctx.destination);
        n.start(t + i * 0.035);
      }
    },
    flip() {
      if (!ctx) return;
      const t = ctx.currentTime;
      tone(880, t, 0.35, 'triangle', 0.1);
      tone(1760, t + 0.1, 0.6, 'sine', 0.08);
      tone(2349, t + 0.22, 0.9, 'sine', 0.06);
    },
    // Tự động thu nhỏ âm lượng khi đọc bài, và tăng trở lại bình thường khi rảnh
    duck(on) {
      ducked = !!on;
      const target = ducked ? musicVol * 0.22 : musicVol;
      if (master && ctx) master.gain.setTargetAtTime(target, ctx.currentTime, 0.35);
      if (bgAudioEl) rampAudioVolume(target, 450);
    },
    speak(url, text, ms, voiceOverride, ttsAllowed = true) {
      if (!ttsAllowed) return;
      speakQ.push({ url, text, ms, voice: voiceOverride || currentVoice });
      next();
    },
    stopSpeech() {
      speakQ.length = 0;
      speaking = false;
      A.duck(false);
      if (window.speechSynthesis) window.speechSynthesis.cancel();
    },
  };

  function next() {
    if (speaking || !speakQ.length || !ttsOn) {
      if (!ttsOn) {
        speakQ.length = 0;
        A.duck(false);
      }
      return;
    }
    speaking = true;
    A.duck(true); // Thu nhỏ nhạc nền khi bắt đầu đọc bài
    const it = speakQ.shift();
    const done = () => {
      speaking = false;
      if (speakQ.length === 0) A.duck(false); // Khi rảnh thì tăng âm lượng nhạc nền trở lại bình thường
      next();
    };

    const profile = VOICE_PROFILES[it.voice] || VOICE_PROFILES['nu-huyen-bi'];

    const fallbackSpeech = () => {
      try {
        if (!window.speechSynthesis) return setTimeout(done, it.ms || 3000);
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(it.text);
        u.lang = 'vi-VN';
        u.volume = ttsVol;
        u.rate = profile.rate;
        u.pitch = profile.pitch;

        const voices = window.speechSynthesis.getVoices().filter(v => v.lang.toLowerCase().includes('vi'));
        if (voices.length > 0) {
          if (profile.preferFemale) {
            const fem = voices.find(v => /hoai|my|linh|nu|female|lan|mai/i.test(v.name));
            u.voice = fem || voices[0];
          } else {
            const mal = voices.find(v => /nam|minh|male|quang|huy/i.test(v.name));
            u.voice = mal || voices[voices.length - 1];
          }
        }

        u.onend = done;
        u.onerror = done;
        window.speechSynthesis.speak(u);
      } catch (_) {
        setTimeout(done, it.ms || 3000);
      }
    };

    if (it.url && it.voice === 'maichi') {
      const a = new Audio(it.url);
      a.volume = ttsVol;
      a.onended = done;
      a.onerror = fallbackSpeech;
      a.play().catch(fallbackSpeech);
    } else {
      fallbackSpeech();
    }
  }

  window.RaAudio = A;
})();
