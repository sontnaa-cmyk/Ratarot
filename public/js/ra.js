// Thần Ra "sống": biến dạng lưới bằng shader (cánh vỗ, thở, vạt áo, trôi nổi) + ánh sáng quả cầu / đĩa mặt trời / tia nắng.
// RaPuppet.cast(k) làm Ra vung tay, quả cầu bừng sáng khi rút bài.
(() => {
  const cv = document.getElementById('raGL'), fallback = document.getElementById('raImg');
  const none = () => { if (fallback) fallback.hidden = false; cv.hidden = true; window.RaPuppet = { cast() {}, orb: [344, 201] }; };
  const gl = cv.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false });
  if (!gl) return none();
  const VS = 'attribute vec2 a;varying vec2 uv;void main(){uv=vec2(a.x*.5+.5,.5-a.y*.5);gl_Position=vec4(a,0.,1.);}';
  const FS = `precision mediump float;uniform sampler2D tex;uniform float t,cst;varying vec2 uv;
float sm(float a,float b,float x){return smoothstep(a,b,x);}
void main(){
  vec2 p=uv;float amp=1.0+cst*2.4;float side=p.x-.5,ax=abs(side);
  p.y+=.004*sin(t*.9)*amp;                                          // trôi nổi
  float tor=1.-sm(.1,.32,length((p-vec2(.5,.5))*vec2(1.,.8)));
  p+=(p-vec2(.5,.5))*.007*sin(t*1.25)*tor*amp;                      // thở
  float wy=sm(.1,.3,p.y)*(1.-sm(.6,.92,p.y));
  float ww=sm(.2,.36,ax)*wy,ph=t*1.7-ax*6.+(side<0.?0.:.9);
  p.y+=ww*(ax-.15)*.1*sin(ph)*amp;p.x+=sign(side)*ww*.02*sin(ph+1.2)*amp;   // cánh vỗ
  float cp=sm(.1,.4,.55-p.x)*sm(.42,.7,p.y)*(1.-sm(.45,.6,p.x));
  p.x+=cp*.011*sin(t*1.4+p.y*10.)*amp;                              // vạt áo trắng
  float sw=sm(.72,.9,p.x)*sm(.45,.8,p.y);p.x+=sw*.004*sin(t*1.1+p.y*4.)*amp; // quyền trượng
  float arm=1.-sm(.04,.2,length((p-vec2(.27,.5))*vec2(1.,.7)));p.y+=arm*.03*cst;  // vung tay
  vec4 c=texture2D(tex,p);
  vec2 orb=vec2(.27,.325),dsc=vec2(.5,.18);
  float d=length((uv-orb)*vec2(1.,.74)),pl=.5+.5*sin(t*2.2);
  float g=exp(-d*d*900.)*(.22+.22*pl+cst*1.4);
  vec2 r=(uv-dsc)*vec2(1.,.74);float dd=length(r);
  float g2=exp(-dd*dd*420.)*(.14+.1*sin(t*1.3)+cst*.5);
  float ray=pow(abs(sin(atan(r.y,r.x)*9.+t*.35)),14.)*exp(-dd*5.)*(.16+cst*.45);
  float ring=exp(-pow((d-(.05+.05*fract(t*.5)))*60.,2.))*(.3+cst)*(1.-fract(t*.5));  // sóng quanh quả cầu
  c.rgb+=vec3(1.,.78,.35)*(g+g2+ray+ring)*c.a;
  float sp=pow(max(0.,sin(uv.x*90.+t*3.)*sin(uv.y*70.-t*2.)),30.)*ww*.7;c.rgb+=vec3(.9,.8,1.)*sp*c.a;  // lấp lánh cánh
  gl_FragColor=c;}`;
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  let prog; try { prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog); } catch (e) { console.warn('Ra shader:', e); return none(); }
  gl.useProgram(prog);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'a'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const uT = gl.getUniformLocation(prog, 't'), uC = gl.getUniformLocation(prog, "cst");
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  const tex = gl.createTexture(), img = new Image(); let ready = false;
  img.onload = () => { gl.bindTexture(gl.TEXTURE_2D, tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]].forEach(([k, v]) => gl.texParameteri(gl.TEXTURE_2D, k, v)); ready = true; };
  img.onerror = none; img.src = '/assets/ra.png';
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.viewport(0, 0, cv.width, cv.height);
  let cast = 0, last = 0, t0 = performance.now();
  window.RaPuppet = { orb: [344, 201], cast(k = 1) { cast = Math.max(cast, k); } };
  (function frame(ts) {
    requestAnimationFrame(frame);
    if (document.hidden || !ready || ts - last < 33) return; const dt = (ts - last) / 1000; last = ts;
    cast = Math.max(0, cast - dt * .7);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform1f(uT, (ts - t0) / 1000); gl.uniform1f(uC, cast); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  })(0);
})();
