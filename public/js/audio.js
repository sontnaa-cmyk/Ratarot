// Âm thanh: nhạc nền vũ trụ (Web Audio), hiệu ứng lấp lánh, giọng đọc ZeroTTS (fallback Web Speech vi-VN).
(() => {
  let ctx = null, master = null, pad = null, ducked = false, musicVol = .35, ttsVol = .95, ttsOn = true;
  const speakQ = []; let speaking = false;
  function init() {
    if (ctx) return ctx.resume && ctx.resume();
    ctx = new (window.AudioContext || window.webkitAudioContext)(); master = ctx.createGain(); master.gain.value = musicVol; master.connect(ctx.destination);
    pad = ctx.createGain(); pad.gain.value = .5; const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; pad.connect(lp); lp.connect(master);
    [110, 164.81, 220, 277.18, 329.63].forEach((f, i) => { const o = ctx.createOscillator(); o.type = i % 2 ? 'sine' : 'triangle'; o.frequency.value = f; o.detune.value = (i - 2) * 4;
      const g = ctx.createGain(); g.gain.value = .12; const l = ctx.createOscillator(); l.frequency.value = .05 + i * .021; const lg = ctx.createGain(); lg.gain.value = .07; l.connect(lg); lg.connect(g.gain); l.start(); o.connect(g); g.connect(pad); o.start(); });
  }
  function tone(f, t0, dur, type = 'sine', vol = .2, dest) { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = type; o.frequency.value = f; g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vol, t0 + .01); g.gain.exponentialRampToValueAtTime(.0008, t0 + dur); o.connect(g); g.connect(dest || ctx.destination); o.start(t0); o.stop(t0 + dur + .05); }
  const A = {
    unlock: init,
    setVolumes(m, t, on) { if (m != null) { musicVol = m; if (master) master.gain.value = ducked ? m * .35 : m; } if (t != null) ttsVol = t; if (on != null) ttsOn = on; },
    sparkle() { if (!ctx) return; const t = ctx.currentTime; [1318, 1760, 2093, 2637].forEach((f, i) => tone(f, t + i * .07, .8, 'sine', .08)); },
    chime() { if (!ctx) return; const t = ctx.currentTime; [523, 659, 784, 1047].forEach((f, i) => { tone(f, t + i * .12, 2.2, 'sine', .14); tone(f * 2.01, t + i * .12, 1.2, 'sine', .05); }); },
    whoosh() { if (!ctx) return; const t = ctx.currentTime, n = ctx.createBufferSource(), b = ctx.createBuffer(1, ctx.sampleRate * .6, ctx.sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length); n.buffer = b; const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.setValueAtTime(400, t); f.frequency.exponentialRampToValueAtTime(3500, t + .5); const g = ctx.createGain(); g.gain.value = .12; n.connect(f); f.connect(g); g.connect(ctx.destination); n.start(t); },
    gift(tier = 1) { if (!ctx) return; const t = ctx.currentTime; const seq = tier >= 3 ? [392, 523, 659, 784, 1047, 1319] : tier === 2 ? [523, 659, 784, 1047] : [659, 880]; seq.forEach((f, i) => tone(f, t + i * .09, 1.2, 'triangle', .13)); },
    riffle() { if (!ctx) return; const t = ctx.currentTime; for (let i = 0; i < 16; i++) { const b = ctx.createBuffer(1, 400, ctx.sampleRate), d = b.getChannelData(0); for (let k = 0; k < d.length; k++) d[k] = (Math.random() * 2 - 1) * (1 - k / d.length); const n = ctx.createBufferSource(); n.buffer = b; const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2400 + Math.random() * 2200; const g = ctx.createGain(); g.gain.value = .16; n.connect(f); f.connect(g); g.connect(ctx.destination); n.start(t + i * .035); } },
    flip() { if (!ctx) return; const t = ctx.currentTime; tone(880, t, .35, 'triangle', .1); tone(1760, t + .1, .6, 'sine', .08); tone(2349, t + .22, .9, 'sine', .06); },
    duck(on) { ducked = on; if (master) master.gain.setTargetAtTime(on ? musicVol * .35 : musicVol, ctx.currentTime, .3); },
    speak(url, text, ms) { speakQ.push({ url, text, ms }); next(); },
    stopSpeech() { speakQ.length = 0; speechSynthesis && speechSynthesis.cancel(); },
  };
  function next() {
    if (speaking || !speakQ.length || !ttsOn) { if (!ttsOn) speakQ.length = 0; return; }
    speaking = true; A.duck(true); const it = speakQ.shift();
    const done = () => { speaking = false; A.duck(false); next(); };
    const fb = () => { try { const u = new SpeechSynthesisUtterance(it.text); u.lang = 'vi-VN'; u.volume = ttsVol; u.onend = done; u.onerror = done; speechSynthesis.speak(u); } catch (_) { setTimeout(done, it.ms || 3000); } };
    if (it.url) { const a = new Audio(it.url); a.volume = ttsVol; a.onended = done; a.onerror = fb; a.play().catch(fb); } else fb();
  }
  window.RaAudio = A;
})();
