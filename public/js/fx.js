// Hạt vũ trụ: sao lấp lánh, bụi vàng, tia sáng bùng nổ. 30 FPS, tạm dừng khi ẩn tab.
(() => {
  const cv = document.getElementById('fx'), g = cv.getContext('2d');
  const W = 1080, H = 1920, rnd = (a, b) => a + Math.random() * (b - a);
  const mk = (c, r) => { const o = document.createElement('canvas'); o.width = o.height = r * 2; const x = o.getContext('2d'); const gr = x.createRadialGradient(r, r, 0, r, r, r); gr.addColorStop(0, c); gr.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = gr; x.fillRect(0, 0, r * 2, r * 2); return o; };
  const spr = { gold: mk('rgba(255,236,160,1)', 16), white: mk('rgba(255,255,255,1)', 12), pink: mk('rgba(255,120,200,1)', 16), cyan: mk('rgba(120,255,240,1)', 16) };
  const stars = Array.from({ length: 110 }, () => ({ x: rnd(0, W), y: rnd(0, H), s: rnd(.15, .6), p: rnd(0, 6.28), v: rnd(.6, 2) }));
  const dust = Array.from({ length: 60 }, () => ({ x: rnd(0, W), y: rnd(0, H), vy: rnd(-.5, -.15), vx: rnd(-.15, .15), s: rnd(.25, .7), p: rnd(0, 6.28) }));
  const bursts = [];
  window.FX = {
    burst(x, y, kind = 'gold', n = 26, power = 5) {
      for (let i = 0; i < n; i++) { const a = rnd(0, 6.28), v = rnd(1, power); bursts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 1, life: 1, d: rnd(.012, .03), s: rnd(.4, 1), k: kind }); }
    },
    rain(kind = 'gold', n = 60) { for (let i = 0; i < n; i++) bursts.push({ x: rnd(0, W), y: rnd(-100, 300), vx: rnd(-.5, .5), vy: rnd(2, 6), life: 1, d: rnd(.004, .01), s: rnd(.4, 1), k: kind }); },
  };
  let last = 0, t = 0;
  function frame(ts) {
    requestAnimationFrame(frame);
    if (document.hidden || ts - last < 33) return; last = ts; t += .033;
    g.clearRect(0, 0, W, H);
    g.globalCompositeOperation = 'lighter';
    for (const s of stars) { g.globalAlpha = .35 + .65 * Math.abs(Math.sin(t * s.v + s.p)); const r = s.s * 24; g.drawImage(spr.white, s.x - r / 2, s.y - r / 2, r, r); }
    for (const d of dust) { d.x += d.vx + Math.sin(t + d.p) * .25; d.y += d.vy; if (d.y < -20) { d.y = H + 20; d.x = rnd(0, W); } g.globalAlpha = .4 + .5 * Math.abs(Math.sin(t * 1.6 + d.p)); const r = d.s * 34; g.drawImage(spr.gold, d.x - r / 2, d.y - r / 2, r, r); }
    for (let i = bursts.length - 1; i >= 0; i--) { const b = bursts[i]; b.x += b.vx; b.y += b.vy; b.vy += .06; b.life -= b.d * 2; if (b.life <= 0) { bursts.splice(i, 1); continue; } g.globalAlpha = Math.min(1, b.life * 1.4); const r = b.s * 34 * (.5 + b.life); g.drawImage(spr[b.k] || spr.gold, b.x - r / 2, b.y - r / 2, r, r); }
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  }
  requestAnimationFrame(frame);
})();
