// Nền Cổng Thiên Hà (Galaxy Portal) sang trọng, huyền bí và ma mị (WebGL Shader)
(() => {
  const cv = document.getElementById('bg');
  if (!cv) return;
  const gl = cv.getContext('webgl');
  if (!gl) return;

  const VS = 'attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}';
  const FS = `precision mediump float;
uniform float t;
uniform vec2 res;

float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123);}
float n(vec2 p){
  vec2 i=floor(p),f=fract(p);
  f=f*f*(3.-2.*f);
  return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);
}
float fbm(vec2 p){
  float v=0.,a=.5;
  mat2 rot=mat2(.8,.6,-.6,.8);
  for(int i=0;i<5;i++){v+=a*n(p);p=rot*p*2.03;a*=.5;}
  return v;
}

void main(){
  vec2 uv=gl_FragCoord.xy/res;
  uv.y=1.-uv.y;
  
  // Tâm cổng thiên hà đặt tại khu vực giữa thần Ra và đài trải bài
  vec2 center=vec2(.5,.43);
  vec2 dVec=(uv-center)*vec2(1.,1.68);
  float r=length(dVec);
  float ang=atan(dVec.y,dVec.x);
  
  // Xoáy cổng thiên hà (Spiral Galaxy Vortex)
  float swirl=ang - r*4.5 + t*.18;
  vec2 spUv=vec2(cos(swirl),sin(swirl))*r*2.8 + vec2(t*.02, -t*.015);
  
  float f1=fbm(spUv*1.4);
  float f2=fbm(spUv*2.6 + vec2(f1*1.2, t*.04));
  float arms=pow(max(0., sin(ang*2.0 - r*7.0 + f1*3.5 + t*.25)), 2.2);
  
  // Bảng màu vũ trụ sang trọng: Đen huyền bí, Tím Hoàng Gia, Xanh Lam Tinh Vân & Vàng Kim Cổng Trời
  vec3 col=vec3(.015,.006,.05);
  col=mix(col, vec3(.14,.04,.38), smoothstep(.18,.78,f1));
  col=mix(col, vec3(.38,.06,.56), smoothstep(.35,.88,f2)*.82);
  col+=vec3(.06,.32,.68)*arms*exp(-r*1.8)*.75;
  
  // Vòng cổng thiên hà phát sáng ma mị (Sacred Galaxy Gate Rings)
  float gateRing1=exp(-pow((r-.36)*18., 2.));
  float gateRing2=exp(-pow((r-.22)*24., 2.));
  col+=vec3(1.,.78,.32)*gateRing1*(.45+.35*sin(ang*6.+t*1.2));
  col+=vec3(.55,.35,1.)*gateRing2*.5;
  
  // Hào quang thần thánh phía sau Thần Ra
  float raGlow=exp(-pow(length((uv-vec2(.5,.17))*vec2(1.,.65))*2.9, 2.));
  col+=vec3(1.,.68,.22)*raGlow*.48;
  
  // Hào quang tâm cổng thiên hà
  float core=exp(-r*r*11.);
  col+=vec3(.95,.82,1.)*core*.38;
  
  // Viền tối sâu tạo chiều sâu sang trọng (Vignette)
  col*=.52+.55*smoothstep(1.38,.15,length((uv-.5)*vec2(.95,.75)));
  
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
    if (document.hidden || ts - last < 45) return;
    last = ts;
    gl.uniform1f(uT, ts / 1000);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  })(0);
})();
