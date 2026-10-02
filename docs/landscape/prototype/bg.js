/* Living mist landscape behind the screen sheets.
   Ideas adapted from the personal motion library: React Bits "Gradient Waves"
   (hazy horizon + grain) and Paper "God Rays" (soft light shafts).
   One full-screen shader + a sparse field of drifting motes. */
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js";

const canvas = document.getElementById("bg");
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
} catch (e) {
  document.body.classList.add("no-webgl");
}

if (renderer) {
  // The glass needs crisp light lines; the soft mist does not. The canvas runs near native
  // resolution and the landscape renders into its own lighter buffer (LAND_SCALE of it).
  const PR = Math.min(devicePixelRatio, 2) * .9, LAND_SCALE = .62 / .9;
  renderer.setPixelRatio(PR);
  renderer.autoClear = false;

  /* ---------- landscape shader ---------- */
  const uniforms = {
    uTime: { value: 0 }, uRes: { value: new THREE.Vector2() }, uMouse: { value: new THREE.Vector2() },
    uFocus: { value: 0 }, uTint: { value: new THREE.Color("#2D9D8F") }, uTintAmt: { value: 0 },
    uLight: { value: .56 }, uBreath: { value: 0 }, uDebug: { value: /[?&]grid\b/.test(location.search) ? 1 : 0 },
    uRip: { value: Array.from({ length: 4 }, () => new THREE.Vector4(0, 0, 0, 0)) },
    uSh: { value: Array.from({ length: 8 }, () => new THREE.Vector4(0, 0, 0, 0)) },
    uShC: { value: Array.from({ length: 8 }, () => new THREE.Vector3(1, 1, 1)) },
  };
  const frag = /* glsl */ `
  precision highp float;
  uniform float uTime, uFocus, uTintAmt, uLight, uBreath, uDebug; uniform vec2 uRes, uMouse; uniform vec3 uTint;
  uniform vec4 uRip[4];   // xy origin (uv), z age (s), w amplitude
  uniform vec4 uSh[8];    // sheet footprints in uv: x0, x1, foot y, alpha
  uniform vec3 uShC[8];   // reflection tint per sheet
  varying vec2 vUv;
  float hash(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
  float noise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.-2.*f);
    return mix(mix(hash(i),hash(i+vec2(1,0)),u.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x), u.y); }
  float fbm(vec2 p){ float v=0., a=.5; for(int i=0;i<5;i++){ v+=a*noise(p); p*=2.03; a*=.5; } return v; }
  float ridge(vec2 p){ float v=0., a=.55; for(int i=0;i<5;i++){ float n=1.-abs(noise(p)*2.-1.); v+=a*n*n; p*=2.1; a*=.48; } return v; }

  // height of mountain layer i at x (far layers taller, softer)
  float layerH(float x, float i){
    float amp = .30 - i*.058;
    float r = ridge(vec2(x*(.85 + i*.42) + i*7.3, i*3.1));
    return .505 + .012 + amp * pow(r, 1.35) * (.75 + .25*sin(x*.9 + i*2.));
  }

  vec3 landscape(vec2 uv, float aspect, float refl){
    float hz = .505;
    vec3 skyTop = vec3(.815,.86,.895), skyHz = vec3(.948,.958,.966);
    vec3 col = mix(skyHz, skyTop, smoothstep(hz, 1.05, uv.y));
    // sun haze
    vec2 sp = vec2(mix(.56, uLight, .35*uFocus) + uMouse.x*.01, .66);
    float sd = length((uv - sp)*vec2(aspect,1.));
    col += vec3(1.,.985,.955) * (.065*exp(-sd*2.6) + .028*exp(-sd*10.));
    // god rays — very soft, angular falloff from the sun
    float ang = atan(uv.y-sp.y, (uv.x-sp.x)*aspect);
    float rays = fbm(vec2(ang*6., uTime*.025)) * smoothstep(.9,.0,sd) * smoothstep(hz-.02, hz+.25, uv.y);
    col += vec3(1.,.99,.97) * rays * .032;
    // mountain layers, far → near
    for(float i=0.; i<4.; i++){
      float par = (.004 + i*.010);
      float x = (uv.x-.5)*aspect + uMouse.x*par*(1.-refl*.0) ;
      float h = layerH(x, i) - uFocus*.012*(i+1.);
      float aa = 1.5/uRes.y;
      float m = smoothstep(h+aa, h-aa, uv.y) * step(hz, uv.y);
      vec3 mc = mix(vec3(.80,.85,.885), vec3(.58,.655,.70), i/3.);
      // aerial perspective: farther layers dissolve, valley mist rises from each base
      float valley = smoothstep(hz + .11 - i*.018, hz - .005, uv.y);
      float far = .44 - i*.14 + uFocus*.08;
      mc = mix(mc, skyHz, clamp(far + valley*.6, 0., 1.));
      // light from the sun side, shade on the other
      mc += .025 * (1. - i/3.) * smoothstep(-.3, .6, (uv.x - .5));
      col = mix(col, mc, m);
    }
    // drifting fog banks over the horizon
    float t = uTime*.012;
    float f1 = fbm(vec2(uv.x*aspect*1.6 + t, uv.y*6. - t*.4));
    float f2 = fbm(vec2(uv.x*aspect*3.2 - t*1.3, uv.y*11. + 4.));
    float band = exp(-pow((uv.y - hz - .045)*7.5, 2.));
    float fog = band * smoothstep(.35,.8, f1*.7 + f2*.45);
    col = mix(col, vec3(.965,.972,.978), clamp(fog*(.75 + uFocus*.35), 0., 1.));
    return col;
  }

  void main(){
    vec2 uv = vUv; float aspect = uRes.x/uRes.y;
    float hz = .505;
    vec3 col;
    if (uv.y >= hz) {
      col = landscape(uv, aspect, 0.);
    } else {
      // lake: mirrored landscape, ripples, fading into a pale floor
      float d = hz - uv.y;
      // ripples from selections (adapted from Canvas UI "Ripple": gaussian ring × decay)
      vec2 g = vec2(0.);
      for (int i = 0; i < 4; i++) {
        vec4 R = uRip[i]; if (R.w <= 0.) continue;
        vec2 dv = (uv - R.xy) * vec2(aspect, 3.2);           // squashed: rings lie flat on the water
        float sd = length(dv) - .2*R.z, env = exp(-sd*sd/.0022) * exp(-1.25*R.z) * R.w;
        g += normalize(dv + 1e-4) * cos(sd*95.) * env;
      }
      vec2 r = vec2(uv.x + (noise(vec2(uv.x*40., d*160. - uTime*.35))-.5)*.004*smoothstep(0.,.1,d), hz + d*1.05);
      r += g * .004;
      vec3 mir = landscape(r, aspect, 1.);
      vec3 floorC = mix(vec3(.93,.945,.955), vec3(.875,.9,.915), smoothstep(0., .5, d));
      col = mix(mir, floorC, .62 + .36*smoothstep(0., .3, d));
      col += vec3(1.) * .05 * exp(-d*90.);
      col += .018 * smoothstep(.55,.9, fbm(vec2(uv.x*aspect*2. + uTime*.01, d*8.)));
      // sheets: soft contact shadow + a pale, tinted reflection that the ripples bend
      for (int i = 0; i < 8; i++) {
        vec4 S = uSh[i]; if (S.w <= 0.) continue;
        float x = uv.x + g.x*.006;
        float dy = S.z - uv.y;                                  // distance below the sheet's foot
        float bx = smoothstep(S.x - .006, S.x + .006, x) * smoothstep(S.y + .006, S.y - .006, x);
        float fall = smoothstep(-.002, .006, dy) * exp(-max(dy, 0.) * 11.);
        col = mix(col, mix(vec3(.975,.98,.985), uShC[i], .22), bx * fall * S.w * .42);
        float cx = (S.x + S.y) * .5, hw = (S.y - S.x) * .62;
        float sh = exp(-pow((uv.x - cx)/hw, 2.) * 1.6 - pow(dy/.012, 2.));
        col *= 1. - .085 * sh * S.w * step(-.004, dy);
      }
      col += .055 * clamp(dot(g, vec2(-.55,.8)), 0., 1.);    // ripple crest glint
    }
    // focus: world recedes into mist and takes a faint provider tint
    col = mix(col, vec3(.935,.948,.958), uFocus*.12 + uBreath*.16);
    col = mix(col, col*(.9 + .1*uTint), uTintAmt*.6);
    // vignette + grain
    vec2 q = uv - .5; col *= 1. - .10*dot(q*vec2(1.,1.25), q*vec2(1.,1.25));
    col += (hash(gl_FragCoord.xy + fract(uTime*7.)*91.) - .5) * .018;
    // ?grid: a test pattern behind the glass, to see the lensing plainly
    if (uDebug > .5) { vec2 g = abs(fract(gl_FragCoord.xy / uRes.y * 28.) - .5); col = mix(col, vec3(.15, .2, .25), smoothstep(.06, .02, min(g.x, g.y)) * .75); }
    gl_FragColor = vec4(col, 1.);
  }`;
  const bgScene = new THREE.Scene();
  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  bgScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms, fragmentShader: frag, depthWrite: false,
    vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }",
  })));

  /* ---------- drifting motes ---------- */
  const N = 260, pos = new Float32Array(N * 3), seed = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    pos[i * 3] = (Math.random() - .5) * 26; pos[i * 3 + 1] = (Math.random() - .35) * 12; pos[i * 3 + 2] = -Math.random() * 18 + 2;
    seed[i] = Math.random();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("seed", new THREE.BufferAttribute(seed, 1));
  const moteMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.NormalBlending,
    uniforms: { uTime: uniforms.uTime, uPx: { value: renderer.getPixelRatio() }, uFocus: uniforms.uFocus },
    vertexShader: `attribute float seed; uniform float uTime, uPx; varying float vA;
      void main(){ vec3 p = position;
        p.y += mod(uTime*.08*(.4+seed) + seed*12., 12.) - 6.;
        p.x += sin(uTime*.15 + seed*40.)*.5;
        vec4 mv = modelViewMatrix*vec4(p,1.); gl_Position = projectionMatrix*mv;
        gl_PointSize = (1.6 + seed*2.6) * uPx * (8. / -mv.z);
        vA = (.25 + .45*seed) * smoothstep(-20., -4., mv.z) * smoothstep(-.5,-3.,mv.z); }`,
    fragmentShader: `uniform float uFocus; varying float vA; void main(){ float d = length(gl_PointCoord-.5);
      gl_FragColor = vec4(1., 1., 1., vA * smoothstep(.5, .0, d) * (1. - uFocus*.35)); }`,
  });
  const moteScene = new THREE.Scene();
  const persp = new THREE.PerspectiveCamera(50, 1, .1, 100);
  persp.position.set(0, 0, 8);
  const motes = new THREE.Points(geo, moteMat); moteScene.add(motes);


  /* ---------- liquid glass ----------
     After Apple's Liquid Glass (WWDC25 "Meet Liquid Glass"): the material lenses rather
     than scatters. The interior stays clear; all bending happens in a narrow bezel whose
     profile is a squircle, y = (1 - (1 - x)^4)^(1/4), so light gathers at the rim without a
     hard inner edge. Refraction follows Snell's law (glass 1.5) with a slight per-channel
     spread; a hairline specular rim defines the silhouette, brightest on the side facing the
     light and again, weaker, on the opposite side; touch lights the glass from within; a
     soft shadow sits beneath. Panes materialise by modulating the lensing, not by fading.
     Glass is screen-space: each pane is a grid bent to its DOM element's projected corners;
     it samples the landscape texture, which is drawn once per frame. */
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace; // the landscape is authored in display space
  const landRT = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });
  const glassScene = new THREE.Scene();
  const glassCam = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10);
  const uOut = { value: new THREE.Vector2(1, 1) };
  const screenQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: { tLand: { value: landRT.texture }, uOut }, depthWrite: false, depthTest: false,
    vertexShader: "void main(){ gl_Position = vec4(position.xy, .999, 1.); }",
    fragmentShader: "uniform sampler2D tLand; uniform vec2 uOut; void main(){ gl_FragColor = texture2D(tLand, gl_FragCoord.xy / uOut); }",
  }));
  screenQuad.frustumCulled = false; screenQuad.renderOrder = -1;
  glassScene.add(screenQuad);

  const glassShared = {
    tLand: { value: landRT.texture }, uOut, uPR: { value: PR }, uTime: uniforms.uTime,
    uLight: { value: new THREE.Vector2(-.6, -.8) },       // toward the light, element space (y down)
    uPointer: { value: new THREE.Vector2(-1e4, -1e4) },  // css px, y down
  };
  const makeGlassMat = () => new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: false,
    uniforms: { uHalf: { value: new THREE.Vector2() }, uRadius: { value: 8 }, uBezel: { value: 14 },
      uThick: { value: 18 }, uScale: { value: 1 }, uAlpha: { value: 1 }, uFrost: { value: .1 }, uColor: { value: new THREE.Color(1, 1, 1) },
      uTinted: { value: 0 } },
    vertexShader: `attribute vec2 aLocal; varying vec2 vLocal;
      void main(){ vLocal = aLocal; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform sampler2D tLand; uniform vec2 uOut, uHalf, uLight, uPointer; uniform vec3 uColor;
      uniform float uPR, uTime, uRadius, uBezel, uThick, uScale, uAlpha, uFrost, uTinted;
      varying vec2 vLocal;
      float sdRR(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + r; return length(max(q, 0.)) + min(max(q.x, q.y), 0.) - r; }
      void main(){
        float d = sdRR(vLocal, uHalf, uRadius);                       // px, negative inside
        // outward normal, taken from a shape rounded at least as much as the bezel is deep, so the
        // bend turns smoothly round the corners instead of meeting along a mitred diagonal
        float rn = max(uRadius, uBezel * 1.1);
        vec2 e = vec2(.75, 0.);
        vec2 n = normalize(vec2(sdRR(vLocal + e.xy, uHalf, rn) - sdRR(vLocal - e.xy, uHalf, rn),
                                sdRR(vLocal + e.yx, uHalf, rn) - sdRR(vLocal - e.yx, uHalf, rn)) + 1e-6);
        float aa = max(fwidth(d), .5);
        float inside = smoothstep(aa, -aa, d);

        // convex bezel: x = 0 at the rim, 1 where the clear interior begins. A circular profile
        // y = sqrt(1 - (1 - x)^2) spreads the bending across the whole bezel (a squircle would
        // hide it in the last pixel or two); softened toward the interior so there is no seam
        float x = clamp(-d / uBezel, 0., 1.), s = 1. - x;
        float slope = min(s / sqrt(max(1. - s * s, 1e-3)), 8.) * smoothstep(0., .35, s) * 1.1;
        float th = atan(slope), th2 = asin(sin(th) / 1.5);
        float shift = uThick * tan(th - th2) * uAlpha;                 // Snell: lateral shift through the glass
        vec2 dir = -n * shift * uScale * uPR;                          // inward, so the rim gathers light from inside
        dir.y = -dir.y;                                                // element space is y-down, framebuffer y-up
        vec2 uv = gl_FragCoord.xy / uOut, px = 1. / uOut;
        vec3 col = vec3(texture2D(tLand, uv + dir * px * 1.00).r,
                        texture2D(tLand, uv + dir * px * 1.025).g,
                        texture2D(tLand, uv + dir * px * 1.05).b);
        // clear body: barely lifted from what is behind it
        float l = dot(col, vec3(.299, .587, .114));
        col = mix(vec3(l), col, 1.12) * 1.02;
        col = mix(col, vec3(1.), uFrost);
        // coloured glass: the provider hue lives in the rim's thickness, like the green pill
        float w = 1.2 * max(uScale, .5);
        col = mix(col, col * mix(vec3(1.), uColor * 1.25, .7), uTinted * pow(s, 3.) * .18 * inside);

        // light: fixed from the upper left; the rim answers on the facing side and, weaker, opposite
        vec2 L = normalize(uLight);
        float face = dot(n, L);
        float hl = pow(max(face, 0.), 3.) + .65 * pow(max(-face, 0.), 3.);
        // the cursor is a second light: nearby edges catch it, those facing it most
        vec2 sp = vec2(gl_FragCoord.x, uOut.y - gl_FragCoord.y) / uPR;
        vec2 toP = uPointer - sp;
        float prox = exp(-dot(toP, toP) / (2. * 150. * 150.));
        float cf = .35 + .65 * max(dot(n, normalize(toP + 1e-4)), 0.);
        float hot = cf * cf * prox;
        // outer hairline: bright where lit, nearly gone along the unlit sides; a faint
        // spectral fringe where the light is strongest (the pink-violet-blue corner of the reference)
        float hair = smoothstep(-w - aa, -w + aa, d) * inside;
        float ang = atan(n.y, n.x);
        vec3 spectrum = .62 + .38 * cos(6.28318 * (vec3(0., .33, .67) + ang * .55 + .15));
        vec3 lineCol = mix(vec3(1.), spectrum, .45 * smoothstep(.35, .9, hl));
        lineCol = mix(lineCol, mix(uColor * 1.15, vec3(1.), .25 + .5 * hl), uTinted * (1. - .6 * hot));
        float lineA = clamp(.12 + .95 * hl + 1.1 * hot + uTinted * .45, 0., 1.);
        col = mix(col, lineCol * (1. + .25 * hot), hair * lineA);
        // inner contour: the far wall of the glass, a faint line a few pixels in
        float innerD = d + w * 3.2;
        float innerLine = (smoothstep(-.9 - aa, -.9 + aa, innerD) - smoothstep(.1 - aa, .1 + aa, innerD)) * inside;
        col *= 1. - innerLine * (.07 + .05 * (1. - hl));
        col += vec3(1.) * innerLine * (.10 * hl + .35 * hot);

        // opaque: a fading pane weakens its lensing (shift scales with uAlpha) rather than going
        // see-through, which would lay the unbent landscape over the bent one
        gl_FragColor = vec4(col, inside * smoothstep(.03, .3, uAlpha));
      }`,
  });

  const PAD = 3, GRID = 10;
  // A flat grid over the element plus a hair of margin for the anti-aliased edge. aLocal is element space in
  // CSS px from the centre (y down); positions are written each time the element moves.
  function paneGeo(w, h) {
    const g = new THREE.PlaneGeometry(1, 1, GRID, GRID), loc = [], uv = g.attributes.uv.array;
    const W = w + PAD * 2, H = h + PAD * 2;
    for (let i = 0; i < uv.length; i += 2) loc.push((uv[i] - .5) * W, (.5 - uv[i + 1]) * H);
    g.setAttribute("aLocal", new THREE.Float32BufferAttribute(loc, 2));
    return g;
  }
  const panes = new Map();
  const bilerp = (c, u, v, k) => c[0][k] * (1 - u) * (1 - v) + c[1][k] * u * (1 - v) + c[2][k] * u * v + c[3][k] * (1 - u) * v;
  function updatePane(p) {
    const el = p.el;
    if (!el.isConnected) { removePane(el); return; }
    const alpha = p.opts.alpha ? p.opts.alpha(el) : 1;
    const w = el.offsetWidth, h = el.offsetHeight;
    if (alpha < .03 || w < 4 || h < 4) { p.mesh.visible = false; return; }
    const c = p.marks.map((m) => { const r = m.getBoundingClientRect(); return [r.left, r.top]; });
    if (Math.abs(c[1][0] - c[0][0]) < 2) { p.mesh.visible = false; return; }
    if (!p.w || Math.abs(p.w - w) > .5 || Math.abs(p.h - h) > .5) {
      p.mesh.geometry.dispose(); p.mesh.geometry = paneGeo(w, h); p.w = w; p.h = h;
    }
    const pos = p.mesh.geometry.attributes.position, arr = pos.array, loc = p.mesh.geometry.attributes.aLocal.array;
    for (let i = 0, j = 0; i < arr.length; i += 3, j += 2) {
      const u = loc[j] / w + .5, v = loc[j + 1] / h + .5;
      arr[i] = bilerp(c, u, v, 0); arr[i + 1] = -bilerp(c, u, v, 1); arr[i + 2] = 0;
    }
    pos.needsUpdate = true; p.mesh.geometry.computeBoundingSphere();
    const U = p.mesh.material.uniforms, o = p.opts;
    U.uHalf.value.set(w / 2, h / 2);
    U.uScale.value = Math.hypot(c[1][0] - c[0][0], c[1][1] - c[0][1]) / w;
    U.uAlpha.value = alpha;
    if (typeof o.frost === "function") U.uFrost.value = o.frost(el);
    p.mesh.visible = true;
  }
  function removePane(el) {
    const p = panes.get(el); if (!p) return;
    glassScene.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh.material.dispose();
    p.marks.forEach((m) => m.remove()); panes.delete(el);
  }
  let panesDirtyUntil = 0;
  const updatePanes = () => panes.forEach(updatePane);

  /* ---------- bloom: only light brighter than white spills ---------- */
  const hdrRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  const bloomA = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
  const bloomB = bloomA.clone();
  const postScene = new THREE.Scene(), post = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  post.frustumCulled = false; postScene.add(post);
  const postVert = "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }";
  const blurMat = new THREE.ShaderMaterial({ depthWrite: false, depthTest: false,
    uniforms: { tMap: { value: null }, uStep: { value: new THREE.Vector2() }, uThreshold: { value: 1 } }, vertexShader: postVert,
    fragmentShader: `varying vec2 vUv; uniform sampler2D tMap; uniform vec2 uStep; uniform float uThreshold;
      vec3 hot(vec2 uv){ vec3 c = texture2D(tMap, uv).rgb; float l = max(max(c.r, c.g), c.b); return c * max(l - uThreshold, 0.) / max(l, 1e-4); }
      void main(){ vec3 c = hot(vUv) * .227027;
        c += (hot(vUv + uStep * 1.384615) + hot(vUv - uStep * 1.384615)) * .316216;
        c += (hot(vUv + uStep * 3.230769) + hot(vUv - uStep * 3.230769)) * .070270;
        gl_FragColor = vec4(c, 1.); }` });
  const finishMat = new THREE.ShaderMaterial({ depthWrite: false, depthTest: false,
    uniforms: { tScene: { value: hdrRT.texture }, tBloom: { value: bloomB.texture } }, vertexShader: postVert,
    fragmentShader: `varying vec2 vUv; uniform sampler2D tScene, tBloom; void main(){
      vec3 c = texture2D(tScene, vUv).rgb + texture2D(tBloom, vUv).rgb * .55;
      gl_FragColor = vec4(min(c, vec3(1.)), 1.); }` });
  const orthoPost = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  function renderBloom() {
    post.material = blurMat;
    blurMat.uniforms.tMap.value = hdrRT.texture; blurMat.uniforms.uThreshold.value = 1;
    blurMat.uniforms.uStep.value.set(2 / bloomA.width, 0);
    renderer.setRenderTarget(bloomA); renderer.render(postScene, orthoPost);
    blurMat.uniforms.tMap.value = bloomA.texture; blurMat.uniforms.uThreshold.value = 0;
    blurMat.uniforms.uStep.value.set(0, 2 / bloomA.height);
    renderer.setRenderTarget(bloomB); renderer.render(postScene, orthoPost);
    post.material = finishMat; renderer.setRenderTarget(null); renderer.render(postScene, orthoPost);
  }

  /* ---------- loop ---------- */
  const target = { focus: 0, tint: 0, mx: 0, my: 0, light: .56 };
  const cur = { focus: 0, tint: 0, mx: 0, my: 0, light: .56 };
  const ripples = []; let breath = 0, rectSource = null, rectsUntil = 0;
  function resize() {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false);
    const ow = Math.round(w * PR), oh = Math.round(h * PR), lw = Math.round(ow * LAND_SCALE), lh = Math.round(oh * LAND_SCALE);
    uniforms.uRes.value.set(lw, lh); uOut.value.set(ow, oh);
    persp.aspect = w / h; persp.updateProjectionMatrix();
    glassCam.left = -w / 2; glassCam.right = w / 2; glassCam.top = h / 2; glassCam.bottom = -h / 2;
    glassCam.position.set(w / 2, -h / 2, 5); glassCam.updateProjectionMatrix();
    landRT.setSize(lw, lh);
    hdrRT.setSize(ow, oh); hdrRT.samples = ow * oh > 2600000 ? 2 : 4;
    bloomA.setSize(Math.max(1, Math.round(ow / 3)), Math.max(1, Math.round(oh / 3))); bloomB.setSize(bloomA.width, bloomA.height);
    panesDirtyUntil = performance.now() + 300;
  }
  addEventListener("resize", resize); resize();
  let lastActive = performance.now(), frame = 0;
  document.addEventListener("pointerleave", () => glassShared.uPointer.value.set(-1e4, -1e4));
  addEventListener("pointermove", (e) => { lastActive = performance.now(); glassShared.uPointer.value.set(e.clientX, e.clientY); target.mx = e.clientX / innerWidth * 2 - 1; target.my = e.clientY / innerHeight * 2 - 1; }, { passive: true });

  const clock = new THREE.Clock();
  let running = true;
  document.addEventListener("visibilitychange", () => { running = !document.hidden; if (running) { clock.getDelta(); loop(); } });
  function loop() {
    if (!running) return;
    requestAnimationFrame(loop);
    // idle and settled: drop to ~30fps, the drift is slow enough
    const settled = Math.abs(target.focus - cur.focus) + Math.abs(target.mx - cur.mx) + Math.abs(target.tint - cur.tint) < .002
      && !ripples.length && breath <= 0 && performance.now() > rectsUntil && performance.now() > panesDirtyUntil;
    if (settled && performance.now() - lastActive > 2500 && (frame++ & 1)) return;
    const dt = Math.min(clock.getDelta(), .05);
    if (!reduced) uniforms.uTime.value += dt;
    const k = 1 - Math.pow(.0016, dt); // frame-rate independent smoothing
    for (const key in cur) cur[key] += (target[key] - cur[key]) * (key === "focus" || key === "tint" ? k * .55 : k * .35);
    uniforms.uFocus.value = cur.focus; uniforms.uTintAmt.value = cur.tint; uniforms.uLight.value = cur.light;
    // transient: ripples age out, the mist breath decays
    for (let i = ripples.length - 1; i >= 0; i--) { ripples[i].age += dt; if (ripples[i].age > 2.6) ripples.splice(i, 1); }
    uniforms.uRip.value.forEach((v, i) => { const r = ripples[i]; r ? v.set(r.x, r.y, r.age, r.amp) : v.set(0, 0, 0, 0); });
    breath = Math.max(0, breath - dt * 1.4);
    uniforms.uBreath.value = Math.sin(Math.min(1, breath) * Math.PI) * .9;
    if (rectSource && performance.now() < rectsUntil) writeSheets(rectSource());
    uniforms.uMouse.value.set(cur.mx, cur.my);
    persp.position.x = cur.mx * .5; persp.position.y = -cur.my * .3; persp.position.z = 8 - cur.focus * 1.6;
    persp.lookAt(0, 0, -6);

    if (performance.now() < rectsUntil || performance.now() < panesDirtyUntil) updatePanes();
    renderer.setRenderTarget(landRT); renderer.clear(); renderer.render(bgScene, ortho);
    renderer.setRenderTarget(hdrRT); renderer.clear(); renderer.render(glassScene, glassCam); renderer.render(moteScene, persp);
    renderBloom();
  }
  loop();
  canvas.classList.add("on");

  function writeSheets(list) {
    const w = innerWidth, h = innerHeight;
    uniforms.uSh.value.forEach((v, i) => {
      const r = list[i];
      if (!r) return v.set(0, 0, 0, 0);
      v.set(r.left / w, r.right / w, 1 - r.bottom / h, r.alpha);
      uniforms.uShC.value[i].set(r.color[0], r.color[1], r.color[2]);
    });
  }
  window.WLBG = {
    // Back a DOM element with a physical glass pane that follows its projected corners.
    // opts: radius, bezel, thickness (px), frost (number or el → 0..1), color (provider light), alpha(el) → 0..1
    glassEl(el, opts = {}) {
      if (!el || panes.has(el)) return;
      const cs = getComputedStyle(el), bw = parseFloat(cs.borderLeftWidth) || 0;
      if (cs.position === "static") el.style.position = "relative";
      const marks = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([x, y]) => {
        const m = document.createElement("i");
        m.setAttribute("aria-hidden", "true");
        m.style.cssText = `position:absolute;width:0;height:0;pointer-events:none;left:calc(${x * 100}% + ${(x ? 1 : -1) * bw}px);top:calc(${y * 100}% + ${(y ? 1 : -1) * bw}px)`;
        el.appendChild(m); return m;
      });
      const mat = makeGlassMat(), U = mat.uniforms;
      Object.assign(U, glassShared);   // shared by reference: landscape, light, pointer, time
      U.uRadius.value = opts.radius ?? 8; U.uBezel.value = opts.bezel ?? 14; U.uThick.value = opts.thickness ?? 18;
      U.uFrost.value = typeof opts.frost === "number" ? opts.frost : .1;
      if (opts.color) { U.uColor.value.set(opts.color); U.uTinted.value = 1; }
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
      mesh.frustumCulled = false; mesh.renderOrder = panes.size;
      glassScene.add(mesh);
      const p = { el, opts, marks, mesh };
      panes.set(el, p); updatePane(p); panesDirtyUntil = performance.now() + 400; lastActive = performance.now();
    },
    unglass(el) { removePane(el); },
    ripple(cx, cy, amp = 1) {
      if (reduced) return;
      ripples.unshift({ x: cx / innerWidth, y: 1 - cy / innerHeight, age: 0, amp });
      ripples.length = Math.min(ripples.length, 4); lastActive = performance.now();
    },
    breathe() { if (!reduced) { breath = 1; lastActive = performance.now(); } },
    setLight(x) { target.light = x; },
    // app supplies sheet footprints; sampled each frame for `ms` while things move
    trackSheets(fn, ms = 1300) { if (fn) rectSource = fn; rectsUntil = Math.max(rectsUntil, performance.now() + ms); lastActive = performance.now(); },
    setFocus(v) { target.focus = v; lastActive = performance.now(); },
    setTint(hex, amt = 1) { if (hex) uniforms.uTint.value.set(hex); target.tint = hex ? amt : 0; },
  };
}
