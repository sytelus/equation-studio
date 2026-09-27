/** Works: the animations this repository studies, reproduces and explains.
 *
 * Each work is a post by an artist that publishes its complete source in the
 * post itself (a twigl.app shader or a p5.js sketch), or, for one post without
 * published code, our own study of its look. A work records:
 *
 *   id, title                 scene id and a descriptive title (the posts have no
 *                             titles, except where `titled` says the artist named it)
 *   author, handle, url       credit: the artist and the post
 *   posted                    date of the post (UTC)
 *   platform                  'twigl' (GLSL ES 3.00, geekest mode), 'p5' (p5.js)
 *                             or 'study' (our own code; no source was published)
 *   video                     the post's clip: {width, height, seconds}
 *   duration                  the loop the scene plays (the clip's length unless a
 *                             shorter period is exact); thumbTime: the moment its
 *                             gallery picture shows (default 1.3 s)
 *   original                  the code exactly as posted (twigl: the shader body;
 *                             p5: the sketch)
 *   readable                  the same computation written to be read: named
 *                             variables, one step per line, a caption on each line.
 *                             For twigl works it renders the same image as the
 *                             original (checked on the GPU, tools/works_check.py);
 *                             for p5 works it is the point formula in the equation
 *                             language (the drawing loop is the Point cloud component)
 *   points                    p5 works: the Point cloud settings {count, alpha, speed, phase}
 *   summary                   what the code does, in a paragraph
 *   tour                      the explanation, one step at a time: {title, text,
 *                             at: [code snippets whose lines to highlight], show?:
 *                             a variable to put on the canvas, steps?: {loop: n}}
 *   concepts, tags            the ideas it uses (concepts.js) and gallery filters
 *
 * Works are data. presets.js turns each into a scene; the Code view shows the
 * original, the readable version and the tour; research.js lists the sources.
 */
/** Width of the p5.js sketches' canvas (createCanvas(400, 400)). */
export const P5_CANVAS = 400;
/** A p5.js sketch that adds `delta` to t before drawing each frame, at 60 frames per second. */
const sketchTime = delta => ({ speed: 60 * delta, phase: delta });
export const works = [
    {
        id: 'jellyfish-lattice',
        title: 'Jellyfish lattice',
        author: 'yonatan', handle: 'zozuar', url: 'https://x.com/zozuar/status/1430657958329917450', posted: '2021-08-25',
        platform: 'twigl', video: { width: 720, height: 720, seconds: 10 }, duration: 10,
        original: 'for(float i,e,g,s;i++<2e2;){vec3 p=vec3((FC.xy-r*.5)/r.y*g+.7,g+=e);p.y-=t*.1;p-=round(p);p.xz*=1.+sin(t*PI+(round(g)+p.y)*9.)*.2;for(e=s=9.;s<4e2;s+=s)e=s/2e6+min(e,max(-p.y,abs(length(p)-.2))/s),p.y+=length(p.xz)*2.,p=.2-abs(p*3.);o.rgb+=hsv(.6+.9/p.y,.9,4e-6/e);}',
        readable: `// Jellyfish lattice · yonatan (@zozuar), 25 Aug 2021 · readable version, same image
vec2 uv = (FC.xy - r*.5)/r.y;        // this pixel as a direction: the center is 0, the image 1 high
float depth = 0., dist = 0., scale;   // how far the ray has gone; the last distance to a jellyfish
for (float i = 0.; i++ < 2e2;) {      // march 200 steps along the ray
  vec3 p = vec3(uv*depth + .7, depth += dist);   // the point on the ray (the camera looks along z)
  p.y -= t*.1;                        // the swarm drifts with time
  p -= round(p);                      // one jellyfish per unit cell: an endless lattice
  p.xz *= 1. + sin(t*PI + (round(depth) + p.y)*9.)*.2;   // pulse: each bell squeezes and relaxes, a wave running down its body
  for (dist = scale = 9.; scale < 4e2; scale += scale) {   // levels of detail at scales 9, 18, 36, 72, 144, 288
    dist = scale/2e6 + min(dist, max(-p.y, abs(length(p) - .2))/scale);   // a thin dome (radius .2, cut at y = 0) at this scale; keep the nearest
    p.y += length(p.xz)*2.;           // lift points away from the axis: the dome becomes a bell
    p = .2 - abs(p*3.);               // mirror and enlarge 3×: the next level is a smaller copy (the tentacles)
  }
  o.rgb += hsv(.6 + .9/p.y, .9, 4e-6/dist);   // glow: bright where the ray passes close, blue to green by the last height
}`,
        summary: 'A raymarcher that never shades a surface: every one of its 200 steps adds a little light that grows as the ray passes close to a jellyfish, so bodies glow like neon. One jellyfish is built from a thin dome that is bent, mirrored and shrunk six times (the tentacles are the smaller copies), then repeated in every unit cell of space. A sine of time and height squeezes the bells so a pulse runs down each body.',
        tour: [
            { title: 'A ray for every pixel', text: 'uv is the direction of this pixel. The point on its ray is (uv·depth + 0.7, depth): the further along the ray, the wider the view. depth grows by the last distance estimate every step.', at: ['vec2 uv', 'vec3 p = vec3'], show: 'depth' },
            { title: 'One cell, endless jellyfish', text: 'p − round(p) sends every point into the unit cell around the origin, so the single jellyfish drawn there appears in every cell of space. The drift t·0.1 moves the whole lattice.', at: ['p -= round(p)', 'p.y -= t*.1'] },
            { title: 'A pulse down the body', text: 'Scaling x and z by 1 + 0.2 sin(…) squeezes the bell; the phase depends on the height p.y and on which cell (round(depth)), so a wave travels down each body and neighbors pulse out of step.', at: ['p.xz *= 1. + sin'] },
            { title: 'Dome, bend, mirror, shrink', text: 'The inner loop draws a thin dome |length(p) − 0.2| cut at y = 0, then bends space (points away from the axis rise) and mirrors and enlarges it 3×. Each pass adds a smaller, bent copy: the tentacles. Stop loop 2 after 1 step to see the bare domes.', at: ['for (dist = scale', 'p.y += length', 'p = .2 - abs'], steps: { 2: 1 } },
            { title: 'Glow instead of surfaces', text: 'Every step adds light 4·10⁻⁶/dist: a lot where the ray grazes a body, almost nothing in the gaps. Summed over 200 steps this looks like translucent, glowing tissue. Stop loop 1 early to see the glow build up from the front.', at: ['o.rgb += hsv'], steps: { 1: 40 } }
        ],
        concepts: ['raymarching', 'glow', 'domain-repetition', 'kaleidoscopic-fold', 'hsv-color', 'seamless-loop'],
        tags: ['raymarching', 'fractal', 'glow', 'repetition', 'creature']
    },
    {
        id: 'stormy-sea',
        title: 'Stormy sea',
        author: 'yonatan', handle: 'zozuar', url: 'https://x.com/zozuar/status/1632160439944478721', posted: '2023-03-04',
        platform: 'twigl', video: { width: 720, height: 720, seconds: 6.283 }, duration: 6.283,
        original: 'float e,i,a,w,x,g;for(;i++<1e2;){vec3 p=vec3((FC.xy-.5*r)/r.y*g,g-3.);p.zy*=rotate2D(.6);i<1e2?p:p+=1e-4;e=p.y;for(a=.8;a>.003;a*=.8)p.xz*=rotate2D(5.),x=(++p.x+p.z)/a+t+t,w=exp(sin(x)-2.5)*a,o.gb+=w/4e2,p.xz-=w*cos(x),e-=w;g+=e;}o+=min(e*e*4e6,1./g)+g*g/2e2;',
        readable: `// Stormy sea · yonatan (@zozuar), 4 Mar 2023 · readable version, same image
vec2 uv = (FC.xy - .5*r)/r.y;         // this pixel as a direction: the center is 0, the image 1 high
float height, depth = 0., amp, wave, phase;
for (float i = 0.; i++ < 1e2;) {      // march 100 steps along the ray
  vec3 p = vec3(uv*depth, depth - 3.);   // the point on the ray; the camera stands at z = −3
  p.zy *= rotate2D(.6);               // tilt the view down toward the water
  if (i >= 1e2) p += 1e-4;            // last step: nudge the point (the change of height lights the foam at the end)
  height = p.y;                       // height above calm water at y = 0 …
  for (amp = .8; amp > .003; amp *= .8) {   // … minus 26 waves, each 0.8 times smaller than the last
    p.xz *= rotate2D(5.);             // every wave runs in another direction
    phase = (++p.x + p.z)/amp + t + t;   // position along the wave: finer for small waves, moving with time
    wave = exp(sin(phase) - 2.5)*amp; // exp(sin) makes sharp crests and wide troughs
    o.gb += wave/4e2;                 // a little blue-green light from every wave
    p.xz -= wave*cos(phase);          // crests lean sideways: choppy water
    height -= wave;                   // the surface is higher by the wave
  }
  depth += height;                    // step forward by the height above the water
}
o += min(height*height*4e6, 1./depth) + depth*depth/2e2;   // foam where the nudge changed the height a lot (steep water), haze far away`,
        summary: 'A height field raymarcher: at every step the ray moves forward by its height above the water, which is 26 layers of sharp-crested waves. Each wave points in a new direction (rotate2D(5)), is 0.8 times smaller than the previous one and leans sideways like a real choppy crest. The colour is a byproduct: every wave adds a pinch of blue-green, the last step is nudged by 10⁻⁴ so the change in height marks steep foam, and distance adds haze.',
        tour: [
            { title: 'Camera above the water', text: 'The ray starts at z = −3 and is tilted down by 0.6 radians. depth is how far it has travelled.', at: ['vec3 p = vec3(uv*depth', 'rotate2D(.6)'], show: 'depth' },
            { title: 'Waves as a sum', text: 'The height of the water is the sum of 26 waves exp(sin(phase) − 2.5)·amp. exp(sin) is flat most of the time and peaks sharply: crests. Each wave is rotated by 5 radians and 0.8 times smaller, so the sum looks irregular. Try fewer waves with loop 2.', at: ['for (amp', 'wave = exp'], steps: { 2: 6 } },
            { title: 'Choppy crests', text: 'p.xz −= wave·cos(phase) moves the sample sideways by the slope of the wave, so crests lean and sharpen, as in real (Gerstner) waves.', at: ['p.xz -= wave*cos'] },
            { title: 'Marching a height field', text: 'height is how far above the water the point is; stepping by it lands close to the surface in a few steps and then creeps toward it.', at: ['depth += height'], show: 'height' },
            { title: 'Foam and haze', text: 'On the last step the point was nudged by 10⁻⁴: where the water is steep that changes the height a lot, so height² lights the crests. depth²/200 is the haze on the horizon.', at: ['if (i >= 1e2)', 'o += min'] }
        ],
        concepts: ['raymarching', 'octave-doubling', 'rotation-matrix', 'seamless-loop'],
        tags: ['raymarching', 'landscape', 'water', 'waves']
    },
    {
        id: 'vortex',
        title: 'Vortex',
        titled: true,
        author: 'Xor', handle: 'XorDev', url: 'https://x.com/XorDev/status/1726103550986469869', posted: '2023-11-19',
        platform: 'twigl', video: { width: 1080, height: 1080, seconds: 20 }, duration: 20,
        original: 'vec2 p=(FC.xy*2.-r)/r.y,v;for(float i=.2,l;i<1.;o+=(cos(i*5.+vec4(0,1,2,3))+1.)*(1.+v.y/(l=length(v)+.003))/l/1e2)v=vec2(mod(atan(p.y,p.x)+i+i*t,PI2)-PI,1)*length(p)-i,v.x-=clamp(v.x+=i,-i,i),i+=.05;o=tanh(o);',
        readable: `// Vortex · Xor (@XorDev), 19 Nov 2023 · readable version, same image
vec2 p = (FC.xy*2. - r)/r.y, v;       // this pixel: the center is 0, the image 2 high
for (float i = .2, l; i < 1.;) {      // 16 rings of radius i = .2, .25, … , .95
  float angle = mod(atan(p.y, p.x) + i + i*t, PI2) - PI;   // angle around the center, turned by i and spinning at speed i
  v = vec2(angle, 1)*length(p) - i;   // (distance along the ring, distance from the ring)
  v.x -= clamp(v.x += i, -i, i);      // … measured from an arc 2i long instead of the whole ring
  i += .05;                           // (the color below already uses the next ring's i)
  o += (cos(i*5. + vec4(0, 1, 2, 3)) + 1.)*(1. + v.y/(l = length(v) + .003))/l/1e2;   // neon glow ~ 1/distance, colored by i, brighter outside the arc
}
o = tanh(o);                          // soft clip: bright cores keep their color`,
        summary: 'Sixteen glowing arcs, one per radius from 0.2 to 0.95, each spinning at a speed equal to its radius, so the inner arcs lag and the rings shear into a vortex. Each arc is a distance field in polar coordinates: v measures how far a pixel is along and away from the arc. Light falls off as 1/distance and is brighter on the outer side of each arc, then tanh squeezes it into the displayable range.',
        tour: [
            { title: 'Polar coordinates', text: 'atan gives the angle around the center; adding i + i·t turns each ring and spins it at speed i. mod(…, 2π) − π keeps the angle between −π and π.', at: ['float angle'], show: 'angle' },
            { title: 'Distance to an arc', text: 'v = (angle·r − i, r − i): the first part is the distance along the ring, the second the distance from it. Subtracting clamp(v.x, −i, i) makes the first part zero along an arc 2i long, so only that arc glows.', at: ['v = vec2(angle', 'v.x -= clamp'], show: 'v' },
            { title: 'Neon by 1/distance', text: 'Light 1/l with l the distance to the arc is huge on the arc and fades smoothly, a classic glow. The factor 1 + v.y/l is 2 outside the arc and 0 inside, so each arc casts a shadow toward the center.', at: ['o += (cos'] },
            { title: 'A rainbow by phase', text: 'cos(5i + (0, 1, 2, 3)) + 1 gives each channel a shifted cosine of the ring index: a palette running through orange, magenta and blue.', at: ['cos(i*5.'] },
            { title: 'Soft clipping', text: 'tanh maps any brightness into 0–1 smoothly, so overlapping cores stay colored instead of burning out.', at: ['o = tanh'] }
        ],
        concepts: ['polar', 'sdf', 'glow', 'soft-clip'],
        tags: ['2d', 'glow', 'rings', 'neon']
    },
    {
        id: 'blossom-tree',
        title: 'Blossoming tree',
        author: 'yonatan', handle: 'zozuar', url: 'https://x.com/zozuar/status/1763906851337326736', posted: '2024-03-02',
        platform: 'twigl', video: { width: 720, height: 720, seconds: 6.284 }, duration: 6.283,
        original: 'vec3 p,q=vec3(-.1,.65,-.6);for(float j,i,e,v,u;i++<130.;o+=.007/exp(3e3/(v*vec4(9,5,4,4)+e*4e6))){p=q+=vec3((FC.xy-.5*r)/r.y,1)*e;for(j=e=v=7.;j++<21.;e=min(e,max(length(p.xz=abs(p.xz*rotate2D(j+sin(1./u+t)/v))-.53)-.02/u,p.y=1.8-p.y)/v))v/=u=dot(p,p),p/=u+.01;}',
        readable: `// Blossoming tree · yonatan (@zozuar), 2 Mar 2024 · readable version, same image
vec3 p, ray = vec3(-.1, .65, -.6);    // the camera; ray walks along the ray of this pixel
for (float level, i, dist, scale, r2; i++ < 130.;) {   // march 130 steps
  p = ray += vec3((FC.xy - .5*r)/r.y, 1)*dist;   // step forward by the last distance
  for (level = dist = scale = 7.; level++ < 21.;) {   // 14 levels of branching (level 7 to 20)
    scale /= r2 = dot(p, p);          // sphere inversion: divide by |p|² …
    p /= r2 + .01;                    // … so every level holds smaller copies of the tree (scale tracks their size)
    p.xz = abs(p.xz*rotate2D(level + sin(1./r2 + t)/scale)) - .53;   // turn (swaying with time) and mirror into four branches
    float twig = length(p.xz) - .02/r2;   // distance to a thin twig along y
    p.y = 1.8 - p.y;                  // mirror across y = 0.9
    dist = min(dist, max(twig, p.y)/scale);   // the twig, cut by the mirror plane, at this level's size; keep the nearest
  }
  o += .007/exp(3e3/(scale*vec4(9, 5, 4, 4) + dist*4e6));   // light: pink-white where the ray grazes tiny twigs (blossoms), dark along thick branches
}`,
        summary: 'A tree grown by sphere inversion. Each of 14 levels inverts space through the unit sphere (p /= |p|²), which turns the whole tree into smaller copies of itself, then turns and mirrors it into four branches and measures the distance to one thin twig. The shrinking factor `scale` is also the key to the colour: where the ray passes tiny twigs deep in the recursion it adds pink-white light (the blossom), along thick branches it stays dark. The sway is a sine of time and of the inversion radius.',
        tour: [
            { title: 'Camera and ray', text: 'The camera stands at (−0.1, 0.65, −0.6) and looks along z; every step moves by the last distance estimate.', at: ['vec3 p, ray', 'p = ray +='] },
            { title: 'Inversion makes copies', text: 'Dividing p by |p|² maps the outside of the unit sphere inside and vice versa. Repeated with folds, the same twig reappears at ever smaller sizes; scale records the size so the distance stays right.', at: ['scale /= r2', 'p /= r2'], show: 'scale' },
            { title: 'Four branches and a twig', text: 'abs(p.xz·rotation) − 0.53 mirrors space into four branches 0.53 apart; length(p.xz) − 0.02/r2 is the distance to a thin twig. The rotation includes sin(1/r2 + t), so every level sways at its own rate.', at: ['p.xz = abs', 'float twig'] },
            { title: 'Fewer levels', text: 'With only a few levels the tree is bare branches; the blossoms appear only when the recursion goes deep. Drag loop 2 to see the tree grow.', at: ['for (level'], steps: { 2: 4 } },
            { title: 'Light from the size', text: 'The light is .007/exp(3000/(scale·(9, 5, 4, 4) + dist·4·10⁶)): large scale or distance makes the exponent small and the light strong. The channel weights 9, 5, 4 make it pink.', at: ['o += .007'] }
        ],
        concepts: ['raymarching', 'sphere-inversion', 'kaleidoscopic-fold', 'glow', 'distance-estimate'],
        tags: ['raymarching', 'fractal', 'nature', 'inversion']
    },
    {
        id: 'jewel-box',
        title: 'Folded jewel box',
        author: 'yonatan', handle: 'zozuar', url: 'https://x.com/zozuar/status/1786335843700912160', posted: '2024-05-03',
        platform: 'twigl', video: { width: 720, height: 720, seconds: 25.134 }, duration: 25.133,
        original: 'vec3 f=vec3(.2,.4,1.5),p;for(float i,e,g,S,u;i++<50.;o+=exp(e*5e3-sin(vec4(4,3,2,0)*p.z-log(S)))/50.){p=vec3((FC.xy-.5*r)/r.y*g,g)-i/3e4;mat2 M=rotate2D(t/8.);p.yz*=M*M;p--;p.yx*=M;S=5.;for(int j;j++<20;p/=u)S/=u=dot(p=2.*clamp(p,-f,f)-p,p);g-=e=p.z/S;}',
        readable: `// Folded jewel box · yonatan (@zozuar), 3 May 2024 · readable version, same image
vec3 box = vec3(.2, .4, 1.5), p;      // half-size of the folding box along x, y and z
vec2 uv = (FC.xy - .5*r)/r.y;
for (float i, dist, depth, scale, r2; i++ < 50.;) {   // march 50 steps
  p = vec3(uv*depth, depth) - i/3e4;  // the point on the ray (a tiny shift per step softens banding)
  mat2 M = rotate2D(t/8.);            // a slow turn
  p.yz *= M*M;                        // turn about x by twice the angle …
  p--;                                // … move …
  p.yx *= M;                          // … and turn about z: the camera orbits
  scale = 5.;
  for (int j = 0; j++ < 20; p /= r2) {   // 20 folds of a Mandelbox-like fractal
    p = 2.*clamp(p, -box, box) - p;   // box fold: whatever sticks out of the box is reflected back in
    scale /= r2 = dot(p, p);          // sphere inversion (p /= r2 after each fold), tracking the total scale
  }
  depth -= dist = p.z/scale;          // step by the folded z, corrected by the scale
  o += exp(dist*5e3 - sin(vec4(4, 3, 2, 0)*p.z - log(scale)))/50.;   // light near the surface, colored by the fold (p.z) and the scale
}`,
        summary: 'A Mandelbox-style fractal: 20 times, space is folded back into a box (2·clamp(p) − p reflects anything outside it) and inverted through the sphere. The folded z coordinate divided by the accumulated scale serves as the distance to step. The colours come from the fold itself: a sine of the final p.z and log(scale) in four phase-shifted channels, so ornaments get their gold, green and slate bands without any lighting.',
        tour: [
            { title: 'Orbiting camera', text: 'Two rotations by t/8 (one doubled) turn the scene about two axes; after 8π seconds the view is symmetric again, which is the clip’s loop.', at: ['mat2 M', 'p.yz *= M*M', 'p.yx *= M'] },
            { title: 'Box fold', text: '2·clamp(p, −box, box) − p leaves points inside the box alone and reflects the rest back in. Together with inversion it is the recipe of the Mandelbox fractal.', at: ['p = 2.*clamp'] },
            { title: 'Inversion and scale', text: 'Each fold divides by |p|², shrinking or growing that piece; scale keeps the product so the distance p.z/scale is in the units of the original space.', at: ['scale /= r2'], show: 'scale' },
            { title: 'Fewer folds', text: 'With a handful of folds the shapes are simple boxes; the ornament appears as the folds accumulate. Try loop 2 at 3.', at: ['for (int j'], steps: { 2: 3 } },
            { title: 'Colour from the fold', text: 'sin((4, 3, 2, 0)·p.z − log(scale)) gives each channel a different phase of the fold coordinate: an orbit-trap palette. exp(dist·5000) limits the light to steps close to the surface.', at: ['o += exp'] }
        ],
        concepts: ['raymarching', 'kaleidoscopic-fold', 'sphere-inversion', 'distance-estimate', 'seamless-loop'],
        tags: ['raymarching', 'fractal', 'mandelbox', 'ornament']
    },
    {
        id: 'lace-garden',
        title: 'Lace garden',
        author: 'yonatan', handle: 'zozuar', url: 'https://x.com/zozuar/status/1861521606390018548', posted: '2024-11-26',
        platform: 'twigl', video: { width: 720, height: 720, seconds: 1.566 }, duration: 1.5708,
        original: 'float j,i,e,v,u,S;vec3 w,p,q;for(q.yz+=.6;p=q+=(FC.rgb/r.y-.5)*e,e=v=3.,p.xz*=rotate2D(t),w=p/e,i++<1e2;e=min(e,(w.x+w.z)/S),o+=.01/exp(e*S))for(j=S=.7;j++<9.;e=min(e,max(length(p.xz=abs(p.xz)-.4),p.y=2.-p.y)/v))w.y-=2.5,S/=u=min(dot(w,w),.5)+.02,w=abs(w)/u-.4,v/=u=dot(p,p),p/=u;',
        readable: `// Lace garden · yonatan (@zozuar), 26 Nov 2024 · readable version, same image
float level, dist, scale, r2, scale2;
vec3 w, p, ray;
ray.yz += .6;                         // the camera
for (float i = 0.; i < 1e2; i++) {    // march 100 steps
  p = ray += (FC.rgb/r.y - .5)*dist;  // step forward (FC.z = .5 makes the ray look along −z)
  dist = scale = 3.;
  p.xz *= rotate2D(t);                // the garden turns
  w = p/dist;                         // a second, smaller copy of space: the background
  for (level = scale2 = .7; level++ < 9.;) {   // 9 levels
    w.y -= 2.5;                       // background: shift, …
    scale2 /= r2 = min(dot(w, w), .5) + .02;   // … a clamped inversion …
    w = abs(w)/r2 - .4;               // … and a mirror
    scale /= r2 = dot(p, p);          // flowers: sphere inversion
    p /= r2;
    dist = min(dist, max(length(p.xz = abs(p.xz) - .4), p.y = 2. - p.y)/scale);   // mirrored stems (cylinders .4 apart), cut by a mirror plane
  }
  dist = min(dist, (w.x + w.z)/scale2);   // the background's folded plane
  o += .01/exp(dist*scale2);          // light where a surface is close
}`,
        summary: 'Two fractals marched together. The first inverts space (p /= |p|²) and mirrors four stems at every level, which blossoms into lace flowers; the second, in a smaller copy of space w, uses a clamped inversion and a fold to build the ornate background panels. Both distances join with min, and each step adds light .01/exp(dist·scale2): pure grey tones from proximity alone. The whole garden turns once every 2π seconds; the clip loops after a quarter turn because the mirrors make it four-fold symmetric.',
        tour: [
            { title: 'Turning garden', text: 'p.xz is rotated by t; with abs(p.xz) folding four ways, a quarter turn (π/2 s) brings the same picture back.', at: ['p.xz *= rotate2D(t)'] },
            { title: 'Flowers by inversion', text: 'Inverting through the unit sphere and mirroring stems at every level makes smaller and smaller flowers inside each other.', at: ['scale /= r2 = dot', 'dist = min(dist, max(length'], show: 'scale' },
            { title: 'Background panels', text: 'w is a copy of space three times smaller. Shifting, inverting with a clamp and mirroring it builds the panels; its plane w.x + w.z is joined with the flowers by min.', at: ['w.y -= 2.5', 'w = abs(w)'] },
            { title: 'Grey light', text: 'Only proximity makes light here: .01/exp(dist·scale2). Fewer steps (loop 1) show which surfaces are found first.', at: ['o += .01'], steps: { 1: 25 } }
        ],
        concepts: ['raymarching', 'sphere-inversion', 'kaleidoscopic-fold', 'glow'],
        tags: ['raymarching', 'fractal', 'monochrome', 'inversion']
    },
    {
        id: 'stone-kaleidoscope',
        title: 'Carved stone kaleidoscope',
        author: 'yonatan', handle: 'zozuar', url: 'https://x.com/zozuar/status/1862325652013097042', posted: '2024-11-29',
        platform: 'twigl', video: { width: 720, height: 720, seconds: 12 }, duration: 12,
        original: 'float e,i,s,x=.5;vec3 p,q,d=x-FC.rgb/r.y;for(q.z--;i++<1e2;o+=.01/exp(e*1e3)){x<.01?d=q*3.:q;p=q+=d*e;p.zy*=rotate2D(t*PI/6.);p.z=fract(p.z+t)-.5;p.y;s=2.;p=.5-abs(p);for(int i;i++<9;p.z+=3.)p=abs(p)-.7,s*=e=6./min(dot(p,p),2.),p=abs(p)*e-4.;e=min(x=length(q)-.3,length(p.xz)/s);}',
        readable: `// Carved stone kaleidoscope · yonatan (@zozuar), 29 Nov 2024 · readable version, same image
float dist, scale, ball = .5;         // ball: distance to the mirror ball at the center
vec3 p, ray, dir = ball - FC.rgb/r.y; // the direction of this pixel's ray (FC.z = .5 makes it look along +z)
ray.z--;                              // the camera stands at z = −1
for (float i = 0.; i++ < 1e2;) {      // march 100 steps
  if (ball < .01) dir = ray*3.;       // the ray touched the mirror ball: bounce away from its center
  p = ray += dir*dist;                // step forward
  p.zy *= rotate2D(t*PI/6.);          // the world turns, once every 12 s
  p.z = fract(p.z + t) - .5;          // repeat along z and fly through it
  scale = 2.;
  p = .5 - abs(p);                    // mirror into a box
  for (int k = 0; k++ < 9; p.z += 3.) {   // 9 folds of a kaleidoscopic fractal
    p = abs(p) - .7;
    scale *= dist = 6./min(dot(p, p), 2.);   // an inversion-like stretch (at least 3×) …
    p = abs(p)*dist - 4.;             // … mirror, stretch and shift
  }
  dist = min(ball = length(ray) - .3, length(p.xz)/scale);   // the nearest of the ball (radius .3) and the carved columns
  o += .01/exp(dist*1e3);             // light where a surface is very close
}`,
        summary: 'A kaleidoscopic fractal (repeated abs, stretch and shift) carves columns of stone that repeat along the flight direction, while a small mirror ball at the center reflects them: when the ray touches the ball it simply changes direction to point away from its center. Everything is grey light from proximity. The world turns once every 12 s and the repetition moves one cell per second, so the clip loops after 12 s.',
        tour: [
            { title: 'Flying through repeats', text: 'fract(p.z + t) − .5 repeats space along z and moves it by one cell per second: an endless flight.', at: ['p.z = fract'] },
            { title: 'Kaleidoscopic folds', text: 'Each of 9 passes mirrors (abs), shifts, stretches by up to 6/|p|² and shifts again. The stretch is multiplied into scale so the column distance length(p.xz)/scale stays true.', at: ['for (int k', 'scale *= dist', 'p = abs(p)*dist'], show: 'scale' },
            { title: 'A mirror ball', text: 'ball is the distance to a sphere of radius .3 at the center. Once it is tiny the direction becomes ray·3: pointing out from the center, a crude but convincing reflection.', at: ['if (ball < .01)', 'ball = length(ray)'], show: 'ball' },
            { title: 'Only proximity lights', text: '.01/exp(dist·1000) is large only when a step lands within a few thousandths of a surface. Stopping loop 2 early leaves the stone smooth.', at: ['o += .01/exp'], steps: { 2: 3 } }
        ],
        concepts: ['raymarching', 'kaleidoscopic-fold', 'domain-repetition', 'glow', 'seamless-loop'],
        tags: ['raymarching', 'fractal', 'monochrome', 'kaleidoscope']
    },
    {
        id: 'underwater-reef',
        title: 'Underwater reef',
        author: 'yonatan', handle: 'zozuar', url: 'https://x.com/zozuar/status/1865850795822104948', posted: '2024-12-08',
        platform: 'twigl', video: { width: 720, height: 720, seconds: 47.116 }, duration: 47.116,
        original: 'for(float i,k,j,g,e,s,n=15.;i++<1e2;o.rgb+=hsv(s=log(s)/n,.5,s/2e2*k)+FC.zww*g*k/6e4){vec3 q,p=vec3((FC.xy-.5*r)/r.y*g-9.,g)+n;p.zx*=rotate2D(t/n);s=j=3.;k=s+snoise3D(vec3(p.xz*.1,t));for(q=p;j++<23.;p=vec3(0,4,-1)-abs(abs(p)*e-vec3(3,4,3)))s*=e=n/dot(p,p);g+=min(30.-q.y,p.y/s);}',
        readable: `// Underwater reef · yonatan (@zozuar), 8 Dec 2024 · readable version, same image
float light, level, depth, stretch, scale, n = 15.;
for (float i = 0.; i++ < 1e2;) {      // march 100 steps
  vec3 q, p = vec3((FC.xy - .5*r)/r.y*depth - 9., depth) + n;   // the point on the ray, seen from (6, 15, 15)
  p.zx *= rotate2D(t/n);              // the camera turns slowly (a full turn in 94 s)
  scale = level = 3.;
  light = scale + snoise3D(vec3(p.xz*.1, t));   // caustics: brightness 3 ± noise that drifts with time
  for (q = p; level++ < 23.;) {       // 20 folds of a kaleidoscopic fractal: the coral
    scale *= stretch = n/dot(p, p);   // an inversion-like stretch …
    p = vec3(0, 4, -1) - abs(abs(p)*stretch - vec3(3, 4, 3));   // … mirror, stretch and shift
  }
  depth += min(30. - q.y, p.y/scale); // step: the nearest of the water surface (y = 30) and the coral
  o.rgb += hsv(scale = log(scale)/n, .5, scale/2e2*light) + FC.zww*depth*light/6e4;   // coral colored by its scale, plus blue-green haze growing with distance
}`,
        summary: 'A coral reef from a kaleidoscopic fractal: 20 passes of stretch, mirror and shift make branching, porous shapes, marched together with a flat water surface above (y = 30). Colour comes from the fractal scale (hue and brightness by log(scale)) and from distance (FC.zww is (0.5, 1, 1), a cyan haze), both modulated by 3D simplex noise over time: flickering caustics. The camera turns once every 30π seconds; the clip shows half a turn.',
        tour: [
            { title: 'Camera in the water', text: 'The ray starts at (6, 15, 15) (−9 + 15) and turns with t/15 around the vertical axis.', at: ['vec3 q, p = vec3', 'p.zx *= rotate2D'] },
            { title: 'Coral by folding', text: 'Twenty passes stretch space by 15/|p|², mirror it twice and shift it; scale multiplies the stretches so p.y/scale is a usable distance to the coral.', at: ['for (q = p', 'scale *= stretch', 'p = vec3(0, 4, -1)'], show: 'scale' },
            { title: 'Water surface', text: 'min(30 − q.y, …) adds a flat ceiling: the surface of the sea seen from below.', at: ['depth += min'], show: 'depth' },
            { title: 'Caustics', text: 'light = 3 + simplex noise of (x/10, z/10, t): the brightness of every step flickers the way sunlight dances under water.', at: ['light = scale + snoise3D'], show: 'light' },
            { title: 'Colour and haze', text: 'hsv(log(scale)/15, …) colours the coral by how deep in the fractal the ray is; FC.zww·depth adds cyan with distance.', at: ['o.rgb += hsv'] }
        ],
        concepts: ['raymarching', 'kaleidoscopic-fold', 'hsv-color', 'distance-estimate'],
        tags: ['raymarching', 'fractal', 'nature', 'water', 'noise']
    },
    {
        id: 'golden-spiral',
        title: 'Golden spiral',
        author: 'yonatan', handle: 'zozuar', url: 'https://x.com/zozuar/status/1875945664070475933', posted: '2025-01-05',
        platform: 'twigl', video: { width: 720, height: 720, seconds: 6.116 }, duration: 6.283, thumbTime: 0.1,
        original: 'float y,i,e,R,a;for(vec3 q,p;i++<85.;e=max(-y,R)/5.){p=q+=(.5-FC.gbr/r.y)*e;o+=vec4(.4,.2,.1,0)/exp(e*6e3);p.y--;p.xy*=rotate2D(sin(t));y=p.y;e=atan(p.x,p.z)-t;p=vec3(log(R=length(p))+e/PI-t,a*sin(5.*e),a=y/R)+.5;for(int j;j++<9;p/=a)R*=a=dot(p-=round(p),p)+.25;}o-=log(++e)*2e2;',
        readable: `// Golden spiral · yonatan (@zozuar), 5 Jan 2025 · readable version, same image
float height, i, dist, R, a;
for (vec3 ray, p; i++ < 85.;) {       // march 85 steps
  p = ray += (.5 - FC.gbr/r.y)*dist;  // step forward (the image's x and y become the world's z and x)
  o += vec4(.4, .2, .1, 0)/exp(dist*6e3);   // amber light where a surface is very close
  p.y--;
  p.xy *= rotate2D(sin(t));           // rock back and forth
  height = p.y;
  dist = atan(p.x, p.z) - t;          // the angle around the vertical axis, turning with time
  // spiral coordinates: log R + angle/π is constant along a logarithmic spiral; − t zooms in forever
  p = vec3(log(R = length(p)) + dist/PI - t, a*sin(5.*dist), a = height/R) + .5;
  for (int j = 0; j++ < 9; p /= a)    // 9 folds: repeat into unit cells and invert
    R *= a = dot(p -= round(p), p) + .25;
  dist = max(-height, R)/5.;          // the step: the pattern's size, but never below the floor
}
o -= log(++dist)*2e2;                 // darken wherever the last step was long (nothing near)`,
        summary: 'The whole scene lives in spiral coordinates: log R + angle/π is constant along a logarithmic spiral, so repeating space in that coordinate (p − round(p)) lays copies of a pattern along a golden-looking spiral, and subtracting t zooms into it forever. Nine repeat-and-invert passes carve the ornament; each step adds amber light near surfaces and the last line darkens pixels whose final step was long.',
        tour: [
            { title: 'Logarithmic spiral', text: 'In (log R + angle/π − t, …) a logarithmic spiral becomes a straight line, and zooming becomes a shift. See the log-polar concept.', at: ['p = vec3(log(R'], show: 'R' },
            { title: 'Repeat and invert', text: 'p −= round(p) repeats space in unit cells; dividing by dot(p, p) + .25 inverts each cell. The factor a is multiplied into R, the size of the result.', at: ['R *= a = dot'], steps: { 2: 2 } },
            { title: 'Rocking and turning', text: 'rotate2D(sin t) rocks the spiral; atan(p.x, p.z) − t turns it. After 2π seconds everything is back: a seamless loop.', at: ['rotate2D(sin(t))', 'dist = atan'] },
            { title: 'Amber glow and dark gaps', text: 'Each step adds (.4, .2, .1)/exp(dist·6000): amber near surfaces. The last line subtracts 200·log(1 + dist), blacking out where the final step found nothing close.', at: ['o += vec4(.4', 'o -= log'] }
        ],
        concepts: ['log-polar', 'domain-repetition', 'sphere-inversion', 'glow', 'raymarching', 'seamless-loop'],
        tags: ['raymarching', 'fractal', 'spiral', 'zoom']
    },
    {
        id: 'cloud-cave',
        title: 'Cloud cave',
        author: 'Yohei Nishitsuji', handle: 'YoheiNishitsuji', url: 'https://x.com/YoheiNishitsuji/status/1880163156741275732', posted: '2025-01-17',
        platform: 'twigl', video: { width: 700, height: 500, seconds: 15.716 }, duration: 15.708,
        original: 'float i,e,R,s;vec3 q,p,d=vec3(FC.xy/r-vec2(.5,-.3),1);for(q.zy--;i++<99.;){o.rgb+=hsv(.1,.2,min(e*s,.65-e)/45.);s=1.;p=q+=d*e*R*.3;p=vec3(log2(R=length(p))-t*.8,exp2(-p.z/R+.9),atan(p.y,p.x)-t*.4);for(e=--p.y;s<3e2;s+=s)e+=(dot(sin(p.xy*s)-.5,.5-sin(p.zy*s)))/s*.3;}',
        readable: `// Cloud cave · Yohei Nishitsuji (@YoheiNishitsuji), 17 Jan 2025 · readable version, same image
float dist, R, freq;
vec3 ray, p, dir = vec3(FC.xy/r - vec2(.5, -.3), 1);   // the ray of this pixel, tilted up
ray.zy--;                             // the camera stands at y = −1, z = −1
for (float i = 0.; i++ < 99.;) {      // march 99 steps
  o.rgb += hsv(.1, .2, min(dist*freq, .65 - dist)/45.);   // warm white light, strongest at a middle distance from the cloud (from the last step)
  freq = 1.;
  p = ray += dir*dist*R*.3;           // step forward; steps grow with the distance R from the center
  // log-spherical coordinates: log₂R − 0.8t (flying inward forever), a height from the angle to z, the angle around z (turning)
  p = vec3(log2(R = length(p)) - t*.8, exp2(-p.z/R + .9), atan(p.y, p.x) - t*.4);
  for (dist = --p.y; freq < 3e2; freq += freq)   // the cloud: the height minus one …
    dist += (dot(sin(p.xy*freq) - .5, .5 - sin(p.zy*freq)))/freq*.3;   // … plus 9 octaves of sine turbulence (frequency 1, 2, 4, …, 256)
}`,
        summary: 'Yohei Nishitsuji’s signature construction: the ray lives in log-spherical coordinates (log R, a height made from the angle to the z axis, the angle around it), so the scene repeats at every scale and subtracting t flies into it forever. The surface is a plane in those coordinates plus nine octaves of sine turbulence (frequency doubling with s += s). The light is not shading but a warm glow that peaks at a middle distance from the surface, which draws bright rims on every billow.',
        tour: [
            { title: 'Log-spherical space', text: 'Replacing p by (log₂R − 0.8t, exp2(.9 − cos of the polar angle), angle − 0.4t) makes zooming a shift and turning a shift: the flight never ends.', at: ['p = vec3(log2'], show: 'R' },
            { title: 'Octaves by doubling', text: 'freq runs 1, 2, 4, …, 256: each octave adds sin-based detail at twice the frequency and half the amplitude. Stop loop 2 at 2 to see the smooth underlying shape.', at: ['for (dist = --p.y', 'dist += (dot'], steps: { 2: 2 } },
            { title: 'Steps that scale', text: 'The step is dist·R·0.3: far from the center, the log coordinates stretch, so steps must grow with R.', at: ['p = ray += dir*dist*R'] },
            { title: 'Rim light', text: 'min(dist·freq, .65 − dist)/45 is small on the surface and far from it, largest in between: bright edges on every billow. Show dist to see the distance to the cloud.', at: ['o.rgb += hsv'], show: 'dist' }
        ],
        concepts: ['log-polar', 'octave-doubling', 'raymarching', 'hsv-color', 'seamless-loop'],
        tags: ['raymarching', 'clouds', 'zoom', 'turbulence', 'monochrome']
    },
    {
        id: 'smoke-tunnel',
        title: 'Smoke tunnel',
        author: 'Yohei Nishitsuji', handle: 'YoheiNishitsuji', url: 'https://x.com/YoheiNishitsuji/status/1898392319386366065', posted: '2025-03-08',
        platform: 'twigl', video: { width: 800, height: 600, seconds: 6.283 }, duration: 6.283,
        original: 'float i,e,R,s;vec3 q,p,d=vec3(FC.xy/r-vec2(.6,.5),.7);for(q.zx--;i++<99.;){o.rgb+=hsv(.1,.2,min(e*s,.7-e)/35.);s=1.;p=q+=d*e*R*.1;p=vec3(log2(R=length(p))-t,exp(1.-p.z/R),atan(p.y,p.x)+cos(t)*.2);for(e=--p.y;s<3e2;s+=s)e+=sin(dot(sin(p.zxy*s)-.5,1.-cos(p.yxz*s)))/s;}',
        readable: `// Smoke tunnel · Yohei Nishitsuji (@YoheiNishitsuji), 8 Mar 2025 · readable version, same image
float dist, R, freq;
vec3 ray, p, dir = vec3(FC.xy/r - vec2(.6, .5), .7);   // the ray of this pixel, looking a little to the left
ray.zx--;                             // the camera stands at x = −1, z = −1
for (float i = 0.; i++ < 99.;) {      // march 99 steps
  o.rgb += hsv(.1, .2, min(dist*freq, .7 - dist)/35.);   // warm white rim light from the last step
  freq = 1.;
  p = ray += dir*dist*R*.1;           // step forward, growing with the distance R from the center
  // log-spherical coordinates: flying in by one octave of R per second, the angle swaying with cos t
  p = vec3(log2(R = length(p)) - t, exp(1. - p.z/R), atan(p.y, p.x) + cos(t)*.2);
  for (dist = --p.y; freq < 3e2; freq += freq)   // the smoke surface …
    dist += sin(dot(sin(p.zxy*freq) - .5, 1. - cos(p.yxz*freq)))/freq;   // … with 9 octaves of swirling turbulence
}`,
        summary: 'The same log-spherical flight as the Cloud cave, with a different turbulence (a sine of a dot product of shuffled sines and cosines) that folds into thin wisps, and a camera that sways with cos(t). The zoom moves one octave of the distance per second and the sway repeats after 2π seconds, so the clip loops.',
        tour: [
            { title: 'Endless tunnel', text: 'log₂R − t moves inward by one octave per second; in these coordinates the tunnel looks the same at every scale.', at: ['p = vec3(log2'] },
            { title: 'Swirling octaves', text: 'Each octave adds sin(dot(…))/freq; swapping the axes (zxy, yxz) in the sines makes the wisps twist.', at: ['dist += sin(dot'], steps: { 2: 3 } },
            { title: 'Rim light', text: 'The glow min(dist·freq, .7 − dist)/35 draws the bright edges.', at: ['o.rgb += hsv'], show: 'dist' }
        ],
        concepts: ['log-polar', 'octave-doubling', 'raymarching', 'seamless-loop'],
        tags: ['raymarching', 'smoke', 'zoom', 'turbulence', 'monochrome']
    },
    {
        id: 'cloud-mountains',
        title: 'Cloud mountains',
        author: 'Yohei Nishitsuji', handle: 'YoheiNishitsuji', url: 'https://x.com/YoheiNishitsuji/status/2027368118130000146', posted: '2026-02-27',
        platform: 'twigl', video: { width: 800, height: 600, seconds: 12.566 }, duration: 12.566,
        original: 'float i,e,R,s;vec3 q,p,d=vec3(FC.xy/r*.6-vec2(.3,-.6),.5);for(q.zy--;i++<97.;){o.rgb+=hsv(.1,e,min(e*s,1.)/95.);s=5.;p=q+=d*e*R*.4;p=vec3(log(R=length(p))-t*.5,exp(-p.z/R)+sin(t)*.07+.2,atan(p.y,p.x));for(e=--p.y;s<1e3;s+=s)e+=dot(sin(p.zxx*s),.4-cos(p.yyz*s))/s*.3;}',
        readable: `// Cloud mountains · Yohei Nishitsuji (@YoheiNishitsuji), 27 Feb 2026 · readable version, same image
float dist, R, freq;
vec3 ray, p, dir = vec3(FC.xy/r*.6 - vec2(.3, -.6), .5);   // the ray of this pixel, looking up
ray.zy--;                             // the camera stands at y = −1, z = −1
for (float i = 0.; i++ < 97.;) {      // march 97 steps
  o.rgb += hsv(.1, dist, min(dist*freq, 1.)/95.);   // sepia light: saturated where far from the surface, white on it
  freq = 5.;
  p = ray += dir*dist*R*.4;           // step forward, growing with the distance R from the center
  // log-spherical coordinates: zooming in slowly, the height breathing with sin t
  p = vec3(log(R = length(p)) - t*.5, exp(-p.z/R) + sin(t)*.07 + .2, atan(p.y, p.x));
  for (dist = --p.y; freq < 1e3; freq += freq)   // the mountain surface …
    dist += dot(sin(p.zxx*freq), .4 - cos(p.yyz*freq))/freq*.3;   // … with 8 octaves (frequency 5 to 640)
}`,
        summary: 'Log-spherical space again, now with the turbulence starting at frequency 5, so the octaves read as ridges and cliffs: a mountain range of cloud. The colour uses the distance itself as the saturation: far from the surface the sepia deepens, on it the light turns white. The height breathes with sin(t) and the zoom (0.5 per second in natural log) repeats after 4π seconds.',
        tour: [
            { title: 'Ridges from octaves', text: 'Starting at frequency 5 with 8 doublings gives sharp ridges instead of soft billows. Compare loop 2 at 1, 3 and 8.', at: ['for (dist = --p.y', 'dist += dot'], steps: { 2: 3 } },
            { title: 'Breathing', text: 'sin(t)·.07 raises and lowers the whole surface; exp(−p.z/R) is the height from the polar angle.', at: ['exp(-p.z/R)'] },
            { title: 'Saturation from distance', text: 'hsv(.1, dist, …): dist is the saturation, so light far from the surface is sepia and light on it is white.', at: ['o.rgb += hsv'], show: 'dist' }
        ],
        concepts: ['log-polar', 'octave-doubling', 'raymarching', 'hsv-color', 'seamless-loop'],
        tags: ['raymarching', 'clouds', 'landscape', 'zoom', 'turbulence']
    },
    {
        id: 'rainbow-trefoil',
        title: 'Rainbow trefoil',
        author: 'yonatan', handle: 'zozuar', url: 'https://x.com/zozuar/status/2094068054590190033', posted: '2026-08-30',
        platform: 'twigl', video: { width: 720, height: 720, seconds: 6.266 }, duration: 6.283,
        original: 'vec3 p;float D,e,i,B,R;for(p.z=5.;i++<6e2;mod(i,25.)==s?o.rgb+=hsv(B/6.,.7,.1/exp(e<s?s:e*i)),p-=(.5-FC.rgb/r.y)*e++:p)R=fsnoise(p.xy*i+t)*2.-1.,D=length(p*rotate3D(t,p+i)-vec3(sin(R=B+R*R*R*PI)+2.*sin(R+R),cos(R)-2.*cos(R+R),-sin(3.*R)))-fract((R/6.-t)/PI*3.),D<e?e=D,B=R:e;',
        readable: `// Rainbow trefoil · yonatan (@zozuar), 30 Aug 2026 · readable version, same image
vec3 p;                               // the point marching along the ray
float d, best, knot, u;               // a sample's distance, the best distance found, its place on the knot, a random number
p.z = 5.;                             // the camera stands at z = 5
for (float i = 0.; i++ < 6e2;) {      // 600 samples: 24 steps along the ray × 25 random guesses each
  u = fsnoise(p.xy*i + t)*2. - 1.;    // a random number in −1 … 1, different for every pixel, sample and moment
  // distance to a random point of a trefoil knot near the best guess, minus a tube radius that changes along the knot and with time
  d = length(p*rotate3D(t, p + i) - vec3(sin(u = knot + u*u*u*PI) + 2.*sin(u + u), cos(u) - 2.*cos(u + u), -sin(3.*u)))
      - fract((u/6. - t)/PI*3.);
  if (d < best) { best = d; knot = u; }   // keep the nearest guess
  if (mod(i, 25.) == 0.) {            // after every 25 guesses:
    o.rgb += hsv(knot/6., .7, .1/exp(best < 0. ? 0. : best*i));   // color by the place on the knot, brightness by the distance
    p -= (.5 - FC.rgb/r.y)*best++;    // step along the ray by the best distance; + 1 lets the next search start over
  }
}`,
        summary: 'A raymarcher without a distance formula. The trefoil knot is the curve (sin u + 2 sin 2u, cos u − 2 cos 2u, −sin 3u); instead of solving for its nearest point, every step makes 25 random guesses of the parameter u near the best one so far (knot + u³π, which searches finely near the best and coarsely far away) and keeps the closest. The random numbers differ per pixel and frame, which gives the grain. The hue is the parameter along the knot: a rainbow that follows the tube.',
        tour: [
            { title: 'The trefoil curve', text: '(sin u + 2 sin 2u, cos u − 2 cos 2u, −sin 3u) traces a knot that passes through itself three times as u goes around 2π.', at: ['vec3(sin(u = knot'] },
            { title: 'Random search', text: 'fsnoise gives a new random u every sample; knot + u³π concentrates guesses near the best parameter. After 25 guesses the best distance is used to step: a stochastic sphere tracer.', at: ['u = fsnoise', 'if (d < best)'], show: 'best' },
            { title: 'A tube that grows', text: 'Subtracting fract((u/6 − t)/π·3) makes the tube radius a sawtooth along the knot that moves with time: the fat part travels around the loop.', at: ['- fract((u/6.'] },
            { title: 'Rainbow by parameter', text: 'hsv(knot/6, …): the hue follows the place on the knot, so each lobe has its own color. Fewer samples (loop 1) make the image grainier.', at: ['o.rgb += hsv(knot'], steps: { 1: 150 } }
        ],
        concepts: ['raymarching', 'distance-estimate', 'hsv-color', 'rotation-matrix', 'seamless-loop'],
        tags: ['raymarching', 'knot', 'random', 'rainbow']
    },
    {
        id: 'point-jellyfish',
        title: 'Point jellyfish',
        author: 'ア', handle: 'yuruyurau', url: 'https://x.com/yuruyurau/status/2093710258120331463', posted: '2026-08-29',
        platform: 'p5', video: { width: 800, height: 800, seconds: 8 }, duration: 8,
        original: 'a=(y,d=mag(k=(8+sin(i/19+t))*cos(i/49),e=y/8-12)**2/79+1)=>point(k/d*4-e*sin(k)+k/(d*d)*(12+d*6*sin(d*d-t+cos(t/3)+.3*sin(e)))+200,12*sin(d*2.6-t)+d*66+40)\nt=0,draw=$=>{t||createCanvas(w=400,w);background(9).stroke(w,66);for(t+=PI/80,i=2e4;i--;)a(i/99)}',
        points: { count: 20000, alpha: 66 / 255, ...sketchTime(Math.PI / 80) },
        readable: `// Point jellyfish · ア (@yuruyurau), 29 Aug 2026 · the point formula of the p5.js sketch
y = i/99                              // a slow second index: 0 to 202 over the 20000 points
k = (8 + sin(i/19 + t))*cos(i/49)     // across the bell: swings side to side as i runs; the swing breathes with time
e = y/8 - 12                          // along the body: −12 at the top to 13 at the tentacle tips
d = length(vec2(k, e))^2/79 + 1       // squared distance in the (k, e) plane: 1 at the top of the bell, growing downward
x = k/d*4 - e*sin(k) + k/(d*d)*(12 + d*6*sin(d*d - t + cos(t/3) + .3*sin(e))) + 200   // sideways: the bell narrows with d; the sines make the tentacles wave
vec2(x, 12*sin(d*2.6 - t) + d*66 + 40)   // down: mostly d (the body hangs from the top), plus a pulse running down it`,
        summary: 'Twenty thousand faint points drawn by one formula of their index i and the time. Two slow and fast views of the index (cos(i/49) swings across, i/99 runs down) act as two coordinates, so consecutive points weave a surface: the bell. d grows from the top of the bell outward; dividing by d narrows the body and the sine terms of d and t make a pulse and the tentacles wave. Density does the shading: where many points overlap the jellyfish glows.',
        tour: [
            { title: 'Two coordinates from one index', text: 'cos(i/49) swings back and forth every 308 points while i/99 creeps down: together they sweep a 2D sheet, like a scan line on an old television.', at: ['y = i/99', 'k = (8'] },
            { title: 'Distance from the top', text: 'd = |(k, e)|²/79 + 1 is 1 at the top of the bell and grows along the body. The vertical position is mostly 66·d: the body hangs from the top.', at: ['d = length'] },
            { title: 'A bell that pulses', text: 'k/d·4 narrows the body with d; 12·sin(2.6d − t) moves each ring up and down with a phase that travels down the body.', at: ['x = k/d*4', 'vec2(x'] },
            { title: 'Density is light', text: 'Each point is 26% opaque; overlapping points build up (Opacity). Try fewer points (Points) or a larger Point size.', at: [] }
        ],
        concepts: ['point-cloud', 'density', 'seamless-loop'],
        tags: ['points', 'creature', 'p5js']
    },
    {
        id: 'point-creature',
        title: 'Swimming creature',
        author: 'ア', handle: 'yuruyurau', url: 'https://x.com/yuruyurau/status/2100230050063024467', posted: '2026-09-16',
        platform: 'p5', video: { width: 800, height: 800, seconds: 16 }, duration: 8,
        original: 'a=(y,d=mag(k=(5+sin(y))*cos(i/7),e=y/5-11)/.6-6)=>point((q=99+d*sin(t-d)+y/23*k*(3*sin(e)+e*sin(e*2)+sin(d*4)))*sin(c=d/4-t/8+cos(t+e)/9)+200,q*cos(c)+200)\nt=0,draw=$=>{t||createCanvas(w=400,w);background(9).stroke(w,96);for(t+=PI/30,i=2e4;i--;)a(i/598)}',
        points: { count: 20000, alpha: 96 / 255, ...sketchTime(Math.PI / 30) },
        readable: `// Swimming creature · ア (@yuruyurau), 16 Sep 2026 · the point formula of the p5.js sketch
y = i/598                             // a slow second index: 0 to 33 over the 20000 points
k = (5 + sin(y))*cos(i/7)             // across the body: a fast swing every 44 points, wider where sin(y) is large
e = y/5 - 11                          // along the body: −11 to −4.3
d = length(vec2(k, e))/.6 - 6         // distance in the (k, e) plane: where along the body the point is
q = 99 + d*sin(t - d) + y/23*k*(3*sin(e) + e*sin(e*2) + sin(d*4))   // distance from the center: a wave runs along the body; fins and hairs from the sines
c = d/4 - t/8 + cos(t + e)/9          // angle around the center: the creature circles once every 16π of sketch time and wiggles
vec2(q*sin(c) + 200, q*cos(c) + 200)  // polar to sketch pixels around the center (200, 200)`,
        summary: 'A creature swimming in a circle. The point formula works in polar coordinates around the center of the sketch: the angle c moves with −t/8 (circling) and cos(t + e)/9 (wiggling), the radius q is 99 plus a wave that travels along the body and fin-like terms. The fast index cos(i/7) sweeps across the body, the slow one y = i/598 along it.',
        tour: [
            { title: 'Polar placement', text: 'The last line turns (q, c) into sketch pixels: q is the distance from the center, c the angle. Everything else computes those two.', at: ['vec2(q*sin(c)'] },
            { title: 'Swimming', text: 'c = d/4 − t/8 + cos(t + e)/9: −t/8 moves the creature around the circle, cos(t + e) wiggles the body with a phase that runs along it.', at: ['c = d/4'] },
            { title: 'Fins and hairs', text: 'y/23·k·(3 sin e + e sin 2e + sin 4d) pushes points in and out depending on where they sit: the thin appendages.', at: ['q = 99'] }
        ],
        concepts: ['point-cloud', 'polar', 'density', 'seamless-loop'],
        tags: ['points', 'creature', 'p5js']
    },
    {
        id: 'point-twins',
        title: 'Circling twins',
        author: 'ア', handle: 'yuruyurau', url: 'https://x.com/yuruyurau/status/2100956346057392137', posted: '2026-09-18',
        platform: 'p5', video: { width: 800, height: 800, seconds: 16 }, duration: 8,
        original: 'a=(y,d=mag(k=(3+cos(y))*sin(i/7)+1e-4,e=y/5-9)-3)=>point((q=99+3*sin(k*3)-d*d*sin(t-d)+y/13*k*(e+sin(d*d-t*3)))*sin(c=d/3-t/4+i%2*9+k*k/89)+200,q*cos(c)+200)\nt=0,draw=$=>{t||createCanvas(w=400,w);background(9).stroke(w,96);for(t+=PI/60,i=2e4;i--;)a(i/638)}',
        points: { count: 20000, alpha: 96 / 255, ...sketchTime(Math.PI / 60) },
        readable: `// Circling twins · ア (@yuruyurau), 18 Sep 2026 · the point formula of the p5.js sketch
y = i/638                             // a slow second index: 0 to 31 over the 20000 points
k = (3 + cos(y))*sin(i/7) + 1e-4      // across the body: a fast swing every 44 points (never exactly 0)
e = y/5 - 9                           // along the body
d = length(vec2(k, e)) - 3            // where along the body the point is
q = 99 + 3*sin(k*3) - d*d*sin(t - d) + y/13*k*(e + sin(d*d - t*3))   // distance from the center: ripples, a wave along the body, frills
c = d/3 - t/4 + (i % 2)*9 + k*k/89    // angle: odd points are turned by 9 radians, so two twins circle together
vec2(q*sin(c) + 200, q*cos(c) + 200)  // polar to sketch pixels around the center`,
        summary: 'The same polar construction, with a twist: (i % 2)·9 adds 9 radians to every odd point, so the even and odd points form two copies of the creature, about 1.4 turns apart, circling together. The frills come from sin(d² − 3t), a wave whose wavelength shrinks along the body.',
        tour: [
            { title: 'Two creatures from one formula', text: 'i % 2 is 0 for even and 1 for odd points; multiplying by 9 turns every odd point 9 radians further: a twin.', at: ['c = d/3'] },
            { title: 'Frills', text: 'sin(d² − 3t) oscillates faster and faster along the body (d² grows quickly), which ruffles the edges.', at: ['q = 99'] }
        ],
        concepts: ['point-cloud', 'polar', 'density', 'seamless-loop'],
        tags: ['points', 'creature', 'p5js']
    },
    {
        id: 'point-twins-hairy',
        title: 'Circling twins, bristled',
        author: 'ア', handle: 'yuruyurau', url: 'https://x.com/yuruyurau/status/2101319815772397831', posted: '2026-09-19',
        platform: 'p5', video: { width: 800, height: 800, seconds: 16 }, duration: 8,
        original: 'a=(y,d=mag(k=(3+cos(y))*sin(i/7)+1e-4,e=y/5-9)-3)=>point((q=99+3*sin(9/k)-d*d*sin(t-d)+y/13*k*(e+sin(d*d-t*3)))*sin(c=d/3-t/4+i%2*9+k*k/89)+200,q*cos(c)+200)\nt=0,draw=$=>{t||createCanvas(w=400,w);background(9).stroke(w,96);for(t+=PI/60,i=2e4;i--;)a(i/638)}',
        points: { count: 20000, alpha: 96 / 255, ...sketchTime(Math.PI / 60) },
        readable: `// Circling twins, bristled · ア (@yuruyurau), 19 Sep 2026 · the point formula of the p5.js sketch
y = i/638                             // a slow second index
k = (3 + cos(y))*sin(i/7) + 1e-4      // across the body (never exactly 0: 9/k below would be infinite)
e = y/5 - 9                           // along the body
d = length(vec2(k, e)) - 3            // where along the body the point is
q = 99 + 3*sin(9/k) - d*d*sin(t - d) + y/13*k*(e + sin(d*d - t*3))   // 3 sin(9/k) instead of 3 sin(3k): wild oscillation near the center line makes bristles
c = d/3 - t/4 + (i % 2)*9 + k*k/89    // angle: two twins circling together
vec2(q*sin(c) + 200, q*cos(c) + 200)  // polar to sketch pixels around the center`,
        summary: 'A one-term variation of the Circling twins: 3·sin(9/k) replaces 3·sin(3k). Near the body’s center line k is tiny, 9/k huge and its sine oscillates wildly from point to point, scattering points into bristles and spines. Compare the two scenes side by side to see what a single term does.',
        tour: [
            { title: 'One term changed', text: 'sin(9/k) swings between −1 and 1 ever faster as k approaches 0, so neighbouring points jump apart: bristles along the middle of each body.', at: ['q = 99'] },
            { title: 'Why + 1e-4', text: 'k is never exactly 0 thanks to + 1e-4, so 9/k stays finite.', at: ['k = (3'] }
        ],
        concepts: ['point-cloud', 'polar', 'density'],
        tags: ['points', 'creature', 'p5js', 'variation']
    },
    {
        id: 'fluffy-anemone',
        title: 'Fluffy anemone (study)',
        author: 'Jae', handle: 'Jaenam97', url: 'https://x.com/Jaenam97/status/2082449968548159779', posted: '2026-07-29',
        platform: 'study', video: { width: 1920, height: 1440, seconds: 19.108 }, duration: 18.85,
        original: null,
        readable: `// Fluffy anemone · a study after Jae (@Jaenam97), 29 Jul 2026 · our own code
// The post (“Volumetric raymarch of a fluffy sea creature… multi pass #glsl fragment shader”) did not publish its shader.
// This is Equation Studio's single-pass model of the look: a ball of glowing fibers in deep water.
param radius = .45 [.2, .7] step .01    // radius of the ball
param fibers = 13 [4, 40] step 1        // fibers along each side of the six cube faces (6 × fibers² in all)
param width = .13 [.03, .45] step .005  // thickness of a fiber, relative to the spacing of the fibers
param sway = .5 [0, 2] step .01         // how strongly the fibers wave in the current
param glow = 1 [0, 3] step .01          // brightness of the fibers
vec2 uv = (FC.xy - .5*r)/r.y;          // this pixel: the center is 0, the image 1 high
vec3 ray = vec3(0, 0, -2.2), dir = normalize(vec3(uv, 1.8));   // the camera and the direction of this pixel
o.rgb = vec3(.02, .035, .08)*(1.2 - .8*length(uv));   // deep water behind, darker toward the corners
float through = 1.;                    // how much of what lies behind still shows (transmittance)
for (float i = 0.; i < 90.; i++) {     // 90 slices through the ball, front to back
  vec3 p = ray + dir*(2.2 - radius*1.4 + i*radius*2.8/90.);   // the sample point of this slice
  float R = length(p);                 // distance from the center of the ball
  if (R > radius*1.3) continue;        // outside the ball: nothing to add
  vec3 q = p*rotate3D(sway*R*R*sin(t*.333 + R*5.), vec3(sin(t*.667), 1, .4));   // bend: outer parts turn more, swaying with time
  vec3 n = normalize(q), a = abs(n);   // the direction from the center, and its size on each axis
  vec2 face = a.x > a.y && a.x > a.z ? n.yz/a.x : a.y > a.z ? n.xz/a.y : n.xy/a.z;   // that direction on the largest face of a cube
  float side = a.x > a.y && a.x > a.z ? sign(n.x) : a.y > a.z ? 2.*sign(n.y) : 3.*sign(n.z);   // which face
  vec2 cell = floor(face*fibers), f = face*fibers - cell;   // one fiber per cell of that face
  float near = 9., seed = 0.;          // distance to the nearest fiber (in cells) and that fiber's random number
  for (int k = 0; k < 9; k++) {        // this cell and its eight neighbors
    vec2 c = vec2(k%3 - 1, k/3 - 1), id = cell + c + side*17.;
    vec2 jitter = vec2(fsnoise(id), fsnoise(id + 5.3));   // where the fiber sits in its cell
    float d = length(f - c - .15 - .7*jitter);
    if (d < near) { near = d; seed = fsnoise(id + 9.1); }
  }
  float along = R/(radius*(.7 + .45*seed));   // 0 at the center, 1 at this fiber's tip (every fiber has its own length)
  float fiber = exp(-near*near/(width*width))*(1. - smoothstep(.85, 1.05, along));   // density: high on a fiber, ending at its tip
  float bead = exp(-near*near/(width*width*2.))*exp(-(along - .95)*(along - .95)*300.);   // a bright bead at the tip
  float core = exp(-R*R/(radius*radius*.05));   // a soft glowing core
  vec3 color = mix(vec3(.3, .42, 1.), vec3(.55, .95, 1.), smoothstep(-.3, .8, n.y*.7 + n.x*.5));   // blue, turning cyan toward the upper right …
  color = mix(color, vec3(1., .42, .72), smoothstep(.4, 1., along)*(1. - smoothstep(-.9, .1, n.x*.8 - n.y*.3)));   // … pink tips on the left …
  color = mix(color, vec3(.45, .3, 1.), (1. - smoothstep(-.9, -.1, n.y))*.6);   // … violet underneath
  color = mix(vec3(.8, .95, 1.), color, smoothstep(.05, .35, along));   // white where the fibers meet at the core
  o.rgb += through*glow*(fiber*.16 + bead*.3 + core*.05)*color;   // emitted light, dimmed by what lies in front
  through *= 1. - min(fiber*.12, .5);  // fibers hide some of what lies behind them
}`,
        summary: 'The post shows a glowing ball of fibers rendered by a multi-pass volumetric raymarcher, without publishing its code. This study rebuilds the look in one pass: rays step through the ball in 80 slices; at each sample the direction from the center is mapped onto a cube face whose grid holds one randomly placed fiber per cell, so the density is high near a fiber direction. Rotating the sample point by an angle that grows with the radius makes the fibers bend and sway. Emission is cyan at the core and pink at the tips; transmittance makes front fibers hide those behind.',
        tour: [
            { title: 'Slices through a volume', text: 'There is no surface to hit: the ray takes 80 evenly spaced samples through the ball and adds the light emitted at each, weighted by the density there.', at: ['for (float i', 'vec3 p = ray'], steps: { 1: 30 } },
            { title: 'Fibers from a cube', text: 'The direction from the center is projected onto a cube face; each grid cell of the face holds one fiber at a random place (fsnoise). near is the distance to the closest fiber direction, and seed that fiber’s own random number, which sets its length.', at: ['vec2 face', 'vec2 cell', 'if (d < near)'], show: 'near' },
            { title: 'Swaying', text: 'rotate3D turns the sample by sway·R²·sin(t/3 + 6R): the outer parts of the fibers turn more and at a different phase than the inner parts, so the fibers bend like hair in a current.', at: ['vec3 q = p*rotate3D'] },
            { title: 'Tips and colors', text: 'along runs from 0 at the center to 1 at the fiber’s tip, where a bright bead sits. The color depends on the direction: cyan toward the upper right, pink tips on the left, violet underneath, white where the fibers meet.', at: ['float along', 'float bead', 'vec3 color'], show: 'along' },
            { title: 'Seeing through the fluff', text: 'through (the transmittance) starts at 1 and shrinks behind every fiber, so the front fibers hide those behind: the ball looks solid in the middle and wispy at the edge.', at: ['through *='], show: 'through' }
        ],
        concepts: ['volumetric', 'raymarching', 'glow'],
        tags: ['volumetric', 'creature', 'study']
    }
];
/** The work with this id, or null. */
export function getWork(id) {
    return works.find(w => w.id === id) || null;
}
/** Line numbers (1-based) of `code` that contain any of `snippets`. */
export function linesOf(code, snippets = []) {
    const lines = code.split('\n'), out = [];
    lines.forEach((line, k) => {
        if (snippets.some(s => s && line.includes(s))) {
            out.push(k + 1);
        }
    });
    return out;
}
/** "yonatan (@zozuar), 25 Aug 2021": the credit line of a work. */
export function creditLine(work) {
    const date = new Date(`${work.posted}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
    return `${work.author} (@${work.handle}), ${date}`;
}
