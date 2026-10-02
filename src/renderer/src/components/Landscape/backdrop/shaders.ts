/**
 * GLSL for the landscape backdrop, ported verbatim from the approved prototype
 * (docs/landscape/prototype/bg.js). Only bloom is gone: highlights no longer
 * exceed white, so the half-float target and three blur passes bought nothing
 * (PLAN.md §3a).
 */

/** The mist landscape: sky, sun haze, god rays, four mountain layers, fog, the lake with ripples and screen reflections. */
export const LANDSCAPE_FRAG = /* glsl */ `
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
  }`

export const FULLSCREEN_VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }'

/** Copies the landscape texture to the screen. */
export const SCREEN_VERT = 'void main(){ gl_Position = vec4(position.xy, .999, 1.); }'
export const SCREEN_FRAG = 'uniform sampler2D tLand; uniform vec2 uOut; void main(){ gl_FragColor = texture2D(tLand, gl_FragCoord.xy / uOut); }'

/**
 * Liquid Glass (the approved recipe, see docs/landscape/PLAN.md and the memory
 * note): a screen-space rounded-rect lens. Clear body, round bezel profile with
 * Snell refraction, slight per-channel spread, a hairline light edge lit on two
 * opposite sides with a faint spectral fringe, a faint inner contour, the
 * cursor as the light, no shadow, opaque (fading weakens the lensing).
 */
export const GLASS_VERT = `attribute vec2 aLocal; varying vec2 vLocal;
  void main(){ vLocal = aLocal; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`
export const GLASS_FRAG = /* glsl */ `
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
      }`

/** Drifting motes over the mist. */
export const MOTE_VERT = `attribute float seed; uniform float uTime, uPx; varying float vA;
      void main(){ vec3 p = position;
        p.y += mod(uTime*.08*(.4+seed) + seed*12., 12.) - 6.;
        p.x += sin(uTime*.15 + seed*40.)*.5;
        vec4 mv = modelViewMatrix*vec4(p,1.); gl_Position = projectionMatrix*mv;
        gl_PointSize = (1.6 + seed*2.6) * uPx * (8. / -mv.z);
        vA = (.25 + .45*seed) * smoothstep(-20., -4., mv.z) * smoothstep(-.5,-3.,mv.z); }`
export const MOTE_FRAG = `uniform float uFocus; varying float vA; void main(){ float d = length(gl_PointCoord-.5);
      gl_FragColor = vec4(1., 1., 1., vA * smoothstep(.5, .0, d) * (1. - uFocus*.35)); }`
