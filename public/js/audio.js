// Âm thanh: Nhạc nền MP3 + Ambient Synth Web Audio, Bộ đọc tiếng Việt đa dạng
(() => {
  let ctx = null, master = null, pad = null, ducked = false;
  let musicVol = 0.35, ttsVol = 0.95, ttsOn = true;
  let bgAudioEl = null;
  let currentVoice = 'vi-VN-nu';
  const speakQ = [];
  let speaking = false;

  function init() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return;
    }
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = musicVol;
    master.connect(ctx.destination);

    // Hợp âm nền vũ trụ mặc định
    pad = ctx.createGain();
    pad.gain.value = 0.5;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    pad.connect(lp);
    lp.connect(master);

    [110, 164.81, 220, 277.18, 329.63].forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = i % 2 ? 'sine' : 'triangle';
      o.frequency.value = f;
      o.detune.value = (i - 2) * 4;
      const g = ctx.createGain();
      g.gain.value = 0.12;
      const l = ctx.createOscillator();
      l.frequency.value = 0.05 + i * 0.021;
      const lg = ctx.createGain();
      lg.gain.value = 0.07;
      l.connect(lg);
      lg.connect(g.gain);
      l.start();
      o.connect(g);
      g.connect(pad);
      o.start();
    });

    if (!bgAudioEl) {
      bgAudioEl = new Audio();
      bgAudioEl.loop = true;
      bgAudioEl.volume = musicVol;
    }
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

  function loadCustomMP3(file) {
    init();
    const url = URL.createObjectURL(file);
    if (!bgAudioEl) {
      bgAudioEl = new Audio();
      bgAudioEl.loop = true;
    }
    bgAudioEl.src = url;
    bgAudioEl.volume = musicVol;
    bgAudioEl.play().catch(() => {});
    if (pad) pad.gain.setTargetAtTime(0.05, ctx.currentTime, 0.5);
    return file.name;
  }

  function toggleMusic() {
    if (!bgAudioEl || !bgAudioEl.src) {
      if (pad) {
        const cur = pad.gain.value;
        pad.gain.setTargetAtTime(cur > 0.1 ? 0 : 0.5, ctx.currentTime, 0.2);
        return cur <= 0.1;
      }
      return false;
    }
    if (bgAudioEl.paused) {
      bgAudioEl.play();
      return true;
    } else {
      bgAudioEl.pause();
      return false;
    }
  }

  const A = {
    unlock: init,
    loadCustomMP3,
    toggleMusic,
    setVoice(v) { currentVoice = v; },
    setVolumes(m, t, on) {
      if (m != null) {
        musicVol = m;
        if (master) master.gain.value = ducked ? m * 0.25 : m;
        if (bgAudioEl) bgAudioEl.volume = ducked ? m * 0.25 : m;
      }
      if (t != null) ttsVol = t;
      if (on != null) ttsOn = on;
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
    duck(on) {
      ducked = on;
      const target = on ? musicVol * 0.25 : musicVol;
      if (master) master.gain.setTargetAtTime(target, ctx.currentTime, 0.3);
      if (bgAudioEl) bgAudioEl.volume = target;
    },
    speak(url, text, ms) {
      speakQ.push({ url, text, ms, voice: currentVoice });
      next();
    },
    stopSpeech() {
      speakQ.length = 0;
      if (window.speechSynthesis) window.speechSynthesis.cancel();
    },
  };

  function next() {
    if (speaking || !speakQ.length || !ttsOn) {
      if (!ttsOn) speakQ.length = 0;
      return;
    }
    speaking = true;
    A.duck(true);
    const it = speakQ.shift();
    const done = () => {
      speaking = false;
      A.duck(false);
      next();
    };

    const fallbackSpeech = () => {
      try {
        if (!window.speechSynthesis) return setTimeout(done, it.ms || 3000);
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(it.text);
        u.lang = 'vi-VN';
        u.volume = ttsVol;
        u.rate = 0.95;
        u.pitch = it.voice === 'vi-VN-nam' ? 0.82 : 1.05;

        const voices = window.speechSynthesis.getVoices();
        const viVoice = voices.find(v => v.lang.includes('vi') || v.lang.includes('VIE'));
        if (viVoice) u.voice = viVoice;

        u.onend = done;
        u.onerror = done;
        window.speechSynthesis.speak(u);
      } catch (_) {
        setTimeout(done, it.ms || 3000);
      }
    };

    if (it.url) {
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
