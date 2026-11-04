// Nền tinh vân vũ trụ chuyển động chậm (fbm shader WebGL đa lớp)
(() => {
  const cv = document.getElementById('bg');
  if (!cv) return;
  const gl = cv.getContext('webgl');
  if (!gl) return;

  const VS = 'attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}';
  const FS = `precision mediump float;
uniform float t;
uniform vec2 res;

float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n(vec2 p){
  vec2 i=floor(p),f=fract(p);
  f=f*f*(3.-2.*f);
  return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);
}
float fbm(vec2 p){
  float v=0.,a=.5;
  for(int i=0;i<5;i++){v+=a*n(p);p*=2.02;a*=.5;}
  return v;
}

void main(){
  vec2 uv=gl_FragCoord.xy/res;
  uv.y=1.-uv.y;
  vec2 p=uv*vec2(2.4,4.2);
  float a=fbm(p+vec2(t*.018,0.));
  float b=fbm(p*1.3+vec2(5.2,t*.013)+a);
  float c=fbm(p*.8-b+vec2(0.,t*.01));
  
  // Màu sắc vũ trụ: tím huyền bí, hồng tinh vân, xanh thiên hà
  vec3 col=vec3(.012,.008,.06);
  col=mix(col,vec3(.18,.08,.62),smoothstep(.32,.82,a)*.95);
  col=mix(col,vec3(.65,.09,.68),smoothstep(.48,.89,b)*.65);
  col+=vec3(.05,.26,.65)*smoothstep(.48,.94,c)*.75;
  
  // Hào quang vàng hoàng kim bao quanh Thần Ra ở đỉnh
  col+=vec3(1.0,.68,.25)*exp(-pow(length((uv-vec2(.5,.14))*vec2(1.,.55))*3.0,2.))*.42;
  col*=.55+.6*smoothstep(1.3,.1,length((uv-.5)*vec2(.9,.7)));
  
  gl_FragColor=vec4(col,1.);
}`;

  const sh = (ty, s) => {
    const o = gl.createShader(ty);
    gl.shaderSource(o, s);
    gl.compileShader(o);
    return o;
  };

  const pr = gl.createProgram();
  gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS));
  gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(pr);
  gl.useProgram(pr);

  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const l = gl.getAttribLocation(pr, 'a');
  gl.enableVertexAttribArray(l);
  gl.vertexAttribPointer(l, 2, gl.FLOAT, false, 0, 0);

  const uT = gl.getUniformLocation(pr, 't');
  gl.uniform2f(gl.getUniformLocation(pr, 'res'), cv.width, cv.height);
  gl.viewport(0, 0, cv.width, cv.height);

  let last = 0;
  (function frame(ts) {
    requestAnimationFrame(frame);
    if (document.hidden || ts - last < 50) return;
    last = ts;
    gl.uniform1f(uT, ts / 1000);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  })(0);
})();
