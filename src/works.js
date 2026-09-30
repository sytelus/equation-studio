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
 *   level                     'easy', 'medium' or 'expert': how much there is to take in
 *                             (the gallery badge; easy works are listed first)
 *   try                       "Try this" challenges shown with the scene: {text, and one
 *                             action}. Actions, applied to the work's component and
 *                             undoable in one step:
 *                               set: {param, value} or {param, times}  change a setting
 *                                 (times multiplies its current value)
 *                               code: {find, replace}  edit its code or formula text
 *                                 (the first occurrence of find)
 *                               view: 'motion' | 'stage'  show what moves / just this part
 *                               show: 'name'  show a variable of the code on the canvas
 *                               build: loop number (1, 2, …)  build the picture up,
 *                                 sweeping that loop from 0 steps to all of them
 *
 * All text is written for a curious reader of about thirteen: full sentences, what you
 * see first, then how the math makes it, every technical word explained where it is
 * first used (docs/DEVELOPMENT.md, "Writing for the app").
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
vec2 uv = (FC.xy - r*.5)/r.y;        // The pixel's direction: 0 in the center, and the image is 1 high.
float depth = 0., dist = 0., scale;   // How far the ray has gone, and how far it was from a jellyfish.
for (float i = 0.; i++ < 2e2;) {      // March 200 steps along the ray
  vec3 p = vec3(uv*depth + .7, depth += dist);   // The point on the ray; depth grows by the last distance.
  p.y -= t*.1;                        // Slide space down as time runs, so the jellyfish drift up.
  p -= round(p);                      // Wrap space into one box: every box holds the same jellyfish.
  p.xz *= 1. + sin(t*PI + (round(depth) + p.y)*9.)*.2;   // Narrow and widen the bell: a pulse runs down the body.
  for (dist = scale = 9.; scale < 4e2; scale += scale) {   // Six levels of detail, scale 9 to 288
    dist = scale/2e6 + min(dist, max(-p.y, abs(length(p) - .2))/scale);   // Distance to a thin dome of radius 0.2; keep the nearest.
    p.y += length(p.xz)*2.;           // Bend space: raise each point by twice its distance from the middle.
    p = .2 - abs(p*3.);               // Mirror, flip and enlarge 3 times: the next level draws smaller copies.
  }
  o.rgb += hsv(.6 + .9/p.y, .9, 4e-6/dist);   // Add glow: a lot when the ray passes close; the hue starts at blue.
}`,
        level: 'medium',
        summary: 'You are looking into an endless swarm of glowing jellyfish that drift slowly upward while their bells pulse. The picture is made by a shader, a small program that runs once for every pixel and works out that pixel’s color. For each pixel it sends out a ray, an imaginary line from your eye into the scene, and walks along it in 200 steps. At every step it checks how far the ray is from the nearest jellyfish and adds a little light, far more when the ray passes close by, so the bodies glow like neon instead of looking solid. Only one jellyfish is ever described: space is cut into boxes, and every box shows the same one. Its frilly tentacles come from shrinking, bending and mirroring the bell shape again and again, six times.',
        tour: [
            { title: 'A ray for every pixel', text: 'For each pixel the code follows a ray, a straight line from the camera into the scene. uv is the pixel’s direction, with (0, 0) in the middle of the image. The point on the ray is (uv·depth + 0.7, depth), so depth says how far along the ray we are. Each step moves depth forward by dist, the distance to the nearest jellyfish measured in the step before.', at: ['vec2 uv', 'vec3 p = vec3'], show: 'depth' },
            { title: 'One box, endless jellyfish', text: 'round(p) is the nearest point whose coordinates are whole numbers, so p − round(p) is the position inside a box one unit wide. Every box of space gives the same answer, so the one jellyfish drawn in the middle of a box appears in every box, forever. Before that, p.y −= 0.1·t slides space down a little every second, which makes the whole swarm rise by one box every 10 seconds. That is exactly how long the animation takes to repeat.', at: ['p -= round(p)', 'p.y -= t*.1'] },
            { title: 'A pulse runs down the body', text: 'This line multiplies x and z, the two sideways directions, by 1 + 0.2·sin(…), a number that swings between 0.8 and 1.2, so each bell gets narrower and wider. The sine grows with time (t·π, one pulse every 2 seconds) and with the height p.y, so the squeeze reaches different heights at different moments: a wave that runs down the body. round(depth) is added too, so jellyfish at different distances pulse at different times.', at: ['p.xz *= 1. + sin'] },
            { title: 'Dome, bend, mirror, repeat', text: 'Loop 2, the inner loop marked ⟳2, repeats three lines six times. First it measures the distance to a dome, the top half of a thin ball with radius 0.2. Then it bends space, raising every point by twice its distance from the middle, and mirrors, flips and enlarges it 3 times. The next pass measures the same dome in this changed space, so it shows up as smaller, bent copies, and copies of copies become the tentacles. This step stops loop 2 after one pass, so you see only smooth domes (their colors change too, because the hue comes from the last pass).', at: ['for (dist = scale', 'p.y += length', 'p = .2 - abs'], steps: { 2: 1 } },
            { title: 'Glow instead of surfaces', text: 'The ray never stops at a surface. Every step adds a little light, 0.000004 ÷ dist: when the ray passes close to a body, dist is tiny and the light is strong, and in the empty gaps it adds almost nothing. A tiny extra, scale ÷ 2,000,000, keeps dist from ever reaching 0, so the light never becomes infinite. Added up over 200 steps, this looks like glowing, see-through jelly. This step stops loop 1 after 80 steps: only the nearest jellyfish have had time to light up.', at: ['o.rgb += hsv'], steps: { 1: 80 } }
        ],
        try: [
            { text: 'Watch the glow build up. The picture is drawn again with 0, then more and more ray steps, up to all 200: the nearest jellyfish light up first.', build: 1 },
            { text: 'Keep only 2 of the 6 levels of detail. The fine tentacles vanish, and the colors go wild, because the hue is taken from the last level.', set: { param: 'steps2', value: 2 } },
            { text: 'Make the pulse much stronger: change 0.2 to 0.5, and the bells squeeze and bulge far more.', code: { find: '*9.)*.2;', replace: '*9.)*.5;' } },
            { text: 'Change the starting hue from 0.6 (blue) to 0.9 and you get a swarm of pink jellyfish.', code: { find: 'hsv(.6 + .9/p.y', replace: 'hsv(.9 + .9/p.y' } },
            { text: 'Color only what moves, and watch the pulse travel down each body.', view: 'motion' }
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
vec2 uv = (FC.xy - .5*r)/r.y;         // The pixel's direction: 0 in the center, and the image is 1 high.
float height, depth = 0., amp, wave, phase;   // The height above the water, the distance traveled, and one wave's size, height and position.
for (float i = 0.; i++ < 1e2;) {      // March 100 steps along the ray
  vec3 p = vec3(uv*depth, depth - 3.);   // The point on the ray; the camera starts at z = −3.
  p.zy *= rotate2D(.6);               // Turn by 0.6 radians: the camera rises and looks down at the water.
  if (i >= 1e2) p += 1e-4;            // On the very last step, nudge the point a tiny bit (it is used for the foam).
  height = p.y;                       // Start with the height above flat water at y = 0.
  for (amp = .8; amp > .003; amp *= .8) {   // Subtract 26 waves, each one smaller
    p.xz *= rotate2D(5.);             // Turn each wave to run in a new direction.
    phase = (++p.x + p.z)/amp + t + t;   // Where we are along this wave: smaller waves are shorter, and all move with time.
    wave = exp(sin(phase) - 2.5)*amp; // The wave's height: exp of a sine gives sharp crests and wide, flat troughs.
    o.gb += wave/4e2;                 // Every wave adds a little blue-green light.
    p.xz -= wave*cos(phase);          // Push the point sideways along the wave's slope, so the smaller waves bunch up.
    height -= wave;                   // The water is higher here by this wave.
  }
  depth += height;                    // Step forward by the height above the water.
}
o += min(height*height*4e6, 1./depth) + depth*depth/2e2;   // White foam where the nudge changed the height a lot, plus haze far away.`,
        level: 'medium',
        summary: 'A dark, stormy ocean heaves under a gray sky, with white foam flashing on the steepest waves. The code is a shader, a small program that runs once for every pixel to find its color. For each pixel it follows a ray, an imaginary line from the camera down toward the water, and moves along it by the ray’s height above the waves, so it slows down as it gets close to the surface. The surface is 26 waves added together, each smaller than the one before and running in a new direction, which is why it looks so rough and real. The colors are a side effect: every wave adds a pinch of blue-green light, a last tiny nudge picks out steep spots as foam, and distance adds a gray haze toward the horizon.',
        tour: [
            { title: 'A camera above the water', text: 'Each pixel’s ray starts at a camera 3 units back (z = −3) and points forward. rotate2D is a helper that turns a pair of coordinates by an angle, here 0.6 radians (about 34 degrees; a full turn is about 6.28 radians). Turning the whole view this way lifts the camera to about 1.7 units above the water and tips it to look down at the sea. depth is how far the ray has traveled so far.', at: ['vec3 p = vec3(uv*depth', 'rotate2D(.6)'], show: 'depth' },
            { title: 'Twenty-six waves', text: 'The water’s height is a sum of 26 waves, each exp(sin(phase) − 2.5)·amp. A sine goes smoothly up and down; exp, “e to the power”, turns that into sharp peaks with wide, flat valleys, just like wave crests. amp, the wave’s size, starts at 0.8 and is multiplied by 0.8 each time, so the waves get smaller and shorter. Each one is also turned by 5 radians so it runs in a new direction, and ++p.x shifts each wave by one more unit, so they do not all start from the same spot. This step keeps only the first 6 waves: the sea becomes smooth, rolling swells.', at: ['for (amp', 'wave = exp'], steps: { 2: 6 } },
            { title: 'Choppy crests', text: 'After each wave, p.xz −= wave·cos(phase) pushes the point sideways by an amount that follows the slope of that wave. All the smaller waves after it are measured at this pushed point, so they crowd together on one side of each crest. That makes the crests lean and sharpen, the way real waves do in a storm.', at: ['p.xz -= wave*cos'] },
            { title: 'Walking toward the water', text: 'height is how far the point is above the water, and the ray moves forward by exactly that much at each step. High above the waves it takes big steps; close to the surface the steps become tiny, so the ray slows down and creeps up to the water. After 100 steps it is very close to the surface.', at: ['depth += height'], show: 'height' },
            { title: 'Foam and haze', text: 'On the very last step the point is nudged by 0.0001. Where the water is flat that barely changes the height, but where it is steep it changes a lot. The last line multiplies that change, squared, by 4,000,000 and adds it as white light: foam on the steepest crests. The foam is never brighter than 1 ÷ depth, so faraway foam is dimmer, and depth² ÷ 200 adds a gray haze that grows toward the horizon.', at: ['if (i >= 1e2)', 'o += min'] }
        ],
        try: [
            { text: 'Keep only the 3 biggest waves. The storm calms down into long, smooth swells.', set: { param: 'steps2', value: 3 } },
            { text: 'Whip up the storm: change −2.5 to −2. Every wave becomes about 1.6 times taller, and foam spreads everywhere.', code: { find: 'sin(phase) - 2.5', replace: 'sin(phase) - 2.' } },
            { text: 'Stop turning the waves: turn them by 0 instead of 5 radians. All 26 waves now run the same way, and the sea becomes long, straight ridges.', code: { find: 'rotate2D(5.)', replace: 'rotate2D(0.)' } },
            { text: 'Add much more foam: multiply by 40,000,000 instead of 4,000,000.', code: { find: 'height*height*4e6', replace: 'height*height*4e7' } },
            { text: 'Watch the picture change as the rays take more and more steps toward the water, from 0 up to all 100.', build: 1 }
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
vec2 p = (FC.xy*2. - r)/r.y, v;       // The pixel's position: 0 in the center, and the image is 2 high.
for (float i = .2, l; i < 1.;) {      // 16 rings, radius i = 0.2 to 0.95
  float angle = mod(atan(p.y, p.x) + i + i*t, PI2) - PI;   // The pixel's angle around the center, turned by i and spinning at speed i.
  v = vec2(angle, 1)*length(p) - i;   // v.y is how far the pixel is outside ring i; v.x measures along the ring.
  v.x -= clamp(v.x += i, -i, i);      // Make v.x zero all along an arc 2i long, so only the arc glows.
  i += .05;                           // Move on to the next ring (the color below already uses the new i).
  o += (cos(i*5. + vec4(0, 1, 2, 3)) + 1.)*(1. + v.y/(l = length(v) + .003))/l/1e2;   // Glow: 1 ÷ distance, colored by the ring, lit only outside the arc.
}
o = tanh(o);                          // Squeeze the brightness into 0 to 1, so bright spots fade smoothly into white.`,
        level: 'easy',
        summary: 'Sixteen glowing rings of light swirl around a black hole, orange on the inside and blue-white on the outside. Each ring is really an arc, a piece of a circle about a third of the way around, and each spins at its own speed: the bigger the ring, the faster it turns, so the arcs slide past each other like water in a whirlpool. The code is a shader, a small program that runs once for every pixel. For each pixel it works out how far the pixel is from every arc and adds light that is huge right next to an arc and fades quickly with distance, which makes the arcs glow like neon tubes. Each arc is lit only on its outer side, so every arc casts a dark shadow toward the middle.',
        tour: [
            { title: 'The angle around the center', text: 'atan(p.y, p.x) gives the angle of the pixel around the center, like the hand of a clock. Angles here are in radians: a full turn is 2π, about 6.28. The code adds i + i·t, so ring i starts turned by i and keeps turning at i radians per second, clockwise: the biggest ring goes around in about 6.6 seconds, the smallest in about 31. mod(…, 2π) − π wraps the angle back into the range −π to π, the way a clock hand goes from 12 back to 1.', at: ['float angle'], show: 'angle' },
            { title: 'Distance to an arc', text: 'length(p) is the pixel’s distance from the center. v.y = length(p) − i says how far the pixel is outside ring i (it is negative inside). After the next line adds i back, v.x = angle × length(p) measures how far along the ring the pixel is from the middle of the arc. clamp keeps a number between two limits, so subtracting clamp(v.x, −i, i) makes v.x zero anywhere along an arc 2i long. At radius i, an arc 2i long covers 2 radians, about a third of the circle, and length(v) is the distance to that arc.', at: ['v = vec2(angle', 'v.x -= clamp'], show: 'v' },
            { title: 'Neon glow by division', text: 'The glow comes from one division: brightness = 1 ÷ l, where l is the distance to the arc plus 0.003 (so it is never 0). Right on the arc l is tiny, so the light is huge; a little farther away it drops quickly. The factor 1 + v.y ÷ l is close to 2 just outside the arc and close to 0 just inside it, so each arc is lit on its outer side and throws a shadow toward the center. With all 16 rings dark on their inner side, the middle stays black.', at: ['o += (cos'] },
            { title: 'A color for each ring', text: 'cos(5i + (0, 1, 2, 3)) + 1 gives red, green and blue three cosine waves of the ring’s radius i, each shifted a little. As i grows, the mix runs from orange through magenta and blue to almost white. For the innermost ring (i = 0.25 when the color is made), red is cos(1.25) + 1 ≈ 1.3, green is about 0.37 and blue about 0.01: a bright orange.', at: ['cos(i*5.'] },
            { title: 'Soft clipping', text: 'A screen cannot show brightness above 1, and where arcs overlap the sum can be much bigger. tanh squeezes any positive number into the range 0 to 1: small values pass almost unchanged, and huge values end up just under 1. Because the squeeze is smooth, the bright cores fade gently into white instead of ending in a hard edge.', at: ['o = tanh'] }
        ],
        try: [
            { text: 'Build the vortex one ring at a time, from the inside out.', build: 1 },
            { text: 'Make the arcs three times longer: change the limits −i and i to −i·3 and i·3. The arcs grow into almost full circles.', code: { find: 'clamp(v.x += i, -i, i)', replace: 'clamp(v.x += i, -i*3., i*3.)' } },
            { text: 'Make every ring spin at the same speed: change i + i·t to i + t. The rings stop sliding past each other and the swirl turns like one stiff wheel.', code: { find: 'i + i*t', replace: 'i + t' } },
            { text: 'Change 5 to 9 in the color line, and the rings run through the rainbow faster from the inside out.', code: { find: 'cos(i*5.', replace: 'cos(i*9.' } },
            { text: 'Play it four times as fast and watch the outer rings lap the inner ones.', set: { param: 'speed', times: 4 } }
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
vec3 p, ray = vec3(-.1, .65, -.6);    // The camera's position; ray walks from there along this pixel's direction.
for (float level, i, dist, scale, r2; i++ < 130.;) {   // March 130 steps along the ray
  p = ray += vec3((FC.xy - .5*r)/r.y, 1)*dist;   // Step forward by the last distance.
  for (level = dist = scale = 7.; level++ < 21.;) {   // 14 levels of branches
    scale /= r2 = dot(p, p);          // r2 is the squared distance from the center; scale keeps track of the stretching.
    p /= r2 + .01;                    // Sphere inversion: turn space inside out around the center.
    p.xz = abs(p.xz*rotate2D(level + sin(1./r2 + t)/scale)) - .53;   // Turn (swaying with time), mirror and shift: four branches.
    float twig = length(p.xz) - .02/r2;   // The distance to a thin twig standing along the y axis.
    p.y = 1.8 - p.y;                  // Flip the height around y = 0.9.
    dist = min(dist, max(twig, p.y)/scale);   // Keep only the part of the twig above height 1.8, at its real size; keep the nearest.
  }
  o += .007/exp(3e3/(scale*vec4(9, 5, 4, 4) + dist*4e6));   // Light: pink-white near tiny twigs and in the open sky, dark near thick branches.
}`,
        level: 'medium',
        summary: 'You are looking into the crown of a cherry tree in full bloom: dark branches that split again and again, covered in pink-white blossoms, swaying in the breeze. The code is a shader, a small program that runs for every pixel, and it follows each pixel’s ray, an imaginary line from the camera, through the tree in 130 steps. The tree is built with sphere inversion, a trick that turns space inside out around a ball: points close to the center are thrown far away, and far points are pulled close. Doing this 14 times, while turning and mirroring space into four branches each time, makes smaller and smaller copies of one twig, a fractal (a shape made of smaller copies of itself). The code keeps track of how much each copy was shrunk and uses that number for the color: light is added where the ray passes tiny twigs deep inside the tree (the blossoms) and in the open sky, while the thick branches stay dark.',
        tour: [
            { title: 'Camera and ray', text: 'The camera stands at (−0.1, 0.65, −0.6), and each pixel’s ray points forward along z, spread out by the pixel’s position. Each of the 130 steps moves the ray forward by dist, the distance to the nearest part of the tree found in the step before. So the ray moves quickly through empty space and slows down near branches.', at: ['vec3 p, ray', 'p = ray +='] },
            { title: 'Inversion makes copies', text: 'dot(p, p) is the squared distance from the center, r2. Dividing p by it is sphere inversion: a point at distance 2 from the center moves to distance ½, and a point at distance ½ moves to 2 (the + 0.01 only avoids dividing by 0). Because the loop does this 14 times, with turns and mirrors in between, the same twig shows up again and again at smaller and smaller sizes. scale keeps track of how much space was stretched on the way, so dividing by it turns distances back into real ones. It starts at 7, which makes every step 7 times more careful.', at: ['scale /= r2', 'p /= r2'], show: 'scale' },
            { title: 'Four branches and a twig', text: 'rotate2D turns the x–z pair by an angle, and abs mirrors it: abs(x) folds the left side onto the right side, like folding paper. Folding both x and z makes four matching quarters, and subtracting 0.53 moves each quarter’s branch away from the middle. twig = length(p.xz) − 0.02/r2 is the distance to a thin stick standing along the y axis. The turn angle includes sin(1/r2 + t), which changes with time, so the branches sway, and each level sways a little differently.', at: ['p.xz = abs', 'float twig'] },
            { title: 'Growing the tree', text: 'With only a few levels the tree is just bare branches with a few twigs; the blossoms appear only when the loop goes deep and the twigs become tiny. This step stops loop 2 (the inner loop, marked ⟳2) after 4 levels. Drag the Loop 2 slider up to watch the tree grow.', at: ['for (level'], steps: { 2: 4 } },
            { title: 'Light from size and distance', text: 'Each step adds 0.007 ÷ exp(3000 ÷ (scale·(9, 5, 4, 4) + dist·4,000,000)). exp means “e to the power”, and dividing by exp of a big number gives almost nothing, so the light is strong only when the bottom of the fraction is big. That happens when scale is big (the ray is near tiny twigs, the blossoms) or when dist is big (open sky). Near thick branches both are small and the step adds almost no light. Red gets the biggest weight (9), then green (5) and blue (4), so the blossoms come out pink.', at: ['o += .007'] }
        ],
        try: [
            { text: 'Watch the tree grow: the branch loop is swept from 0 to all 14 levels, and the blossoms appear only near the end.', build: 2 },
            { text: 'Swap the red and blue weights (9 and 4) and the tree blooms with blue blossoms.', code: { find: 'vec4(9, 5, 4, 4)', replace: 'vec4(4, 5, 9, 4)' } },
            { text: 'Spread the branches farther apart: change 0.53 to 0.6. The tree becomes sparse, with bare, dark branches and far fewer blossoms.', code: { find: ') - .53;', replace: ') - .6;' } },
            { text: 'Let the wind blow harder: play it four times as fast.', set: { param: 'speed', times: 4 } }
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
vec3 box = vec3(.2, .4, 1.5), p;      // Half the size of the folding box along x, y and z.
vec2 uv = (FC.xy - .5*r)/r.y;         // The pixel's direction: 0 in the center, and the image is 1 high.
for (float i, dist, depth, scale, r2; i++ < 50.;) {   // March 50 steps along the ray
  p = vec3(uv*depth, depth) - i/3e4;  // The point on the ray, shifted a tiny bit more at every step.
  mat2 M = rotate2D(t/8.);            // A slow turn by t/8 radians.
  p.yz *= M*M;                        // Turn around the x axis by twice that angle, …
  p--;                                // … shift by 1 along every axis, …
  p.yx *= M;                          // … and turn around the z axis: the camera circles.
  scale = 5.;                         // Start at 5, which makes every step 5 times more careful.
  for (int j = 0; j++ < 20; p /= r2) {   // Fold space 20 times
    p = 2.*clamp(p, -box, box) - p;   // Box fold: whatever sticks out of the box is mirrored back in.
    scale /= r2 = dot(p, p);          // Then turn space inside out (p /= r2 ends each pass); scale tracks the stretching.
  }
  depth -= dist = p.z/scale;          // Move along the ray by the folded z, divided by the total stretching.
  o += exp(dist*5e3 - sin(vec4(4, 3, 2, 0)*p.z - log(scale)))/50.;   // Light only near a surface, colored by the folded z and the stretching.
}`,
        level: 'medium',
        summary: 'Ornaments that look like carved beads, gold studs and striped cushions fill the view as the camera slowly circles through them. The code is a shader, a small program that runs for every pixel, and it follows each pixel’s ray, an imaginary line from the camera, in 50 steps. The shapes come from folding space 20 times: whatever sticks out of a box is mirrored back inside, like folding a sheet of paper, and then space is turned inside out around a ball. Each fold copies and shrinks the pattern, so detail keeps appearing inside detail: a fractal, a shape made of smaller copies of itself. There is no lighting at all; the colors come from two numbers the folding leaves behind, which paint the bands of gold, green and slate.',
        tour: [
            { title: 'A circling camera', text: 'M is a turn by t/8 radians (a full turn is about 6.28 radians). The code turns the point around the x axis by twice that angle (M·M), shifts it by 1 along every axis, and then turns it around the z axis by t/8. Together these make the camera circle slowly through the ornament. After 8π seconds (about 25) the view is back to one that looks exactly like the start, so the animation repeats.', at: ['mat2 M', 'p.yz *= M*M', 'p.yx *= M'] },
            { title: 'Box fold', text: 'clamp(p, −box, box) keeps each coordinate between minus and plus the box’s half-size. 2·clamp(p, −box, box) − p leaves points inside the box where they are, but a point that sticks out past a wall is mirrored back across that wall, like folding paper along it. For example, with the x wall at 0.2, x = 0.5 becomes 2·0.2 − 0.5 = −0.1.', at: ['p = 2.*clamp'] },
            { title: 'Inversion and scale', text: 'After each box fold, the code divides p by r2 = dot(p, p), the squared distance from the center. This is sphere inversion: points near the center are thrown far away and far points are pulled close. A box fold followed by an inversion is close to the recipe of a famous fractal, the Mandelbox. Each inversion stretches or squeezes space, and scale keeps the total, so p.z ÷ scale can be used as a careful distance to step.', at: ['scale /= r2'], show: 'scale' },
            { title: 'Fewer folds', text: 'With only a few folds the shapes are plain and gray, with a few round beads; the studs, stripes and colors appear only as the folds pile up. This step stops loop 2 (the inner loop, marked ⟳2) after 3 folds. Drag the Loop 2 slider up to watch the ornament grow.', at: ['for (int j'], steps: { 2: 3 } },
            { title: 'Color from the folds', text: 'Each step adds exp(dist·5000 − sin(…)) ÷ 50, where exp means “e to the power”. dist·5000 is a big negative number unless the step is tiny, so light is added only right next to a surface. Inside the sine, the folded p.z is multiplied by 4 for red, 3 for green and 2 for blue, and log(scale) is subtracted (log turns a huge range of stretches into a small range of numbers). The three colors rise and fall out of step with each other, and that paints the bands of gold, green and slate.', at: ['o += exp'] }
        ],
        try: [
            { text: 'Watch the ornament grow fold by fold: loop 2 is swept from 0 to all 20 folds.', build: 2 },
            { text: 'Make the folding box wider along x (0.2 → 0.5). You get a completely different jewel box, full of round studs.', code: { find: 'vec3(.2, .4, 1.5)', replace: 'vec3(.5, .4, 1.5)' } },
            { text: 'Swap the color multipliers so that blue gets 4 and red gets 2. The gold turns into teal and ice blue.', code: { find: 'vec4(4, 3, 2, 0)', replace: 'vec4(2, 3, 4, 0)' } },
            { text: 'Speed the camera up four times and fly around the jewel box.', set: { param: 'speed', times: 4 } }
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
float level, dist, scale, r2, scale2; // Numbers for the two fractals: scale for the flowers, scale2 for the background.
vec3 w, p, ray;                       // p is the flowers' space, w the background's, and ray the point walking along the ray.
ray.yz += .6;                         // The camera starts at y = 0.6, z = 0.6.
for (float i = 0.; i < 1e2; i++) {    // March 100 steps along the ray
  p = ray += (FC.rgb/r.y - .5)*dist;  // Step forward; the third part is about −0.5, so the ray looks along −z.
  dist = scale = 3.;                  // Start both at 3.
  p.xz *= rotate2D(t);                // The garden turns, one full turn every 2π seconds.
  w = p/dist;                         // The background's space: p divided by 3, so its shapes come out 3 times bigger.
  for (level = scale2 = .7; level++ < 9.;) {   // 9 levels of both fractals
    w.y -= 2.5;                       // Background: shift down, …
    scale2 /= r2 = min(dot(w, w), .5) + .02;   // … divide by the squared distance, but never by more than 0.52, …
    w = abs(w)/r2 - .4;               // … then mirror and shift.
    scale /= r2 = dot(p, p);          // Flowers: sphere inversion, keeping track of the stretching …
    p /= r2;                          // … (turn space inside out around the center).
    dist = min(dist, max(length(p.xz = abs(p.xz) - .4), p.y = 2. - p.y)/scale);   // Four mirrored stems 0.4 from the middle, only above height 2; keep the nearest.
  }
  dist = min(dist, (w.x + w.z)/scale2);   // Add the background, a folded flat plane, if it is nearer.
  o += .01/exp(dist*scale2);          // Gray light, strong only close to a surface.
}`,
        level: 'expert',
        summary: 'A gray garden made of lace turns in front of you: delicate flowers on thin stems stand in the middle, and ornate, frilly panels surround them. The code is a shader, a small program that runs for every pixel, and it follows each pixel’s ray, an imaginary line from the camera, in 100 steps. It builds two fractals at once, shapes made of smaller copies of themselves. The flowers come from sphere inversion, which turns space inside out around a ball, together with four mirrored stems, repeated 9 times; the background panels come from a second copy of space that is shifted, stretched and mirrored in a similar way. There is no color, only light: each step adds a little gray light when the ray is close to a surface, so surfaces glow and empty space stays black.',
        tour: [
            { title: 'A turning garden', text: 'The camera sits at (0, 0.6, 0.6) and looks along −z. rotate2D(t) turns each point around the vertical axis by t radians, so the garden makes one full turn every 2π seconds, about 6.3. Because the flowers and the panels are mirrored four ways, the picture looks the same after only a quarter turn, π/2 seconds (about 1.57), and that is how long the loop lasts.', at: ['p.xz *= rotate2D(t)'] },
            { title: 'Flowers by inversion', text: 'Inside loop 2 (the inner loop, marked ⟳2), dividing p by dot(p, p), its squared distance from the center, turns space inside out around a ball of radius 1: points near the center are thrown far away and far points are pulled close. Then abs(p.xz) − 0.4 mirrors four stems into place, 0.4 from the middle, and 2 − p.y keeps only the part above height 2. Repeating this 9 times puts smaller and smaller flowers inside each other. scale keeps track of the stretching, so dividing by it turns distances back into real ones.', at: ['scale /= r2 = dot', 'dist = min(dist, max(length'], show: 'scale' },
            { title: 'Background panels', text: 'w is a second copy of space, p divided by 3, so everything built in it comes out 3 times bigger. At each level it is shifted down by 2.5, divided by its squared distance (but never by more than 0.52, so it cannot blow up), and mirrored with abs. A flat plane in this folded space, w.x + w.z = 0, becomes the ornate panels. min then joins them with the flowers: it keeps whichever surface is nearer.', at: ['w.y -= 2.5', 'w = abs(w)'] },
            { title: 'Gray light', text: 'Each step adds 0.01 ÷ exp(dist·scale2), the same amount to red, green and blue, so everything is gray. exp means “e to the power”: when a step lands right on a surface (dist near 0) it adds the full 0.01, and far from everything it adds almost nothing. Over 100 steps, rays that stay close to surfaces add up to bright lace. This step stops loop 1 after 50 steps: the flowers and the nearest panels have appeared, but they are still dim.', at: ['o += .01'], steps: { 1: 50 } }
        ],
        try: [
            { text: 'Delete the background: replace its distance with 9, a number so big that it never wins. Only the flowers remain, glowing on black.', code: { find: '(w.x + w.z)/scale2', replace: '9.' } },
            { text: 'Move the stems closer to the middle (0.4 → 0.2). The flowers merge into one big, umbrella-shaped plant.', code: { find: 'abs(p.xz) - .4', replace: 'abs(p.xz) - .2' } },
            { text: 'Watch the lace appear as the rays take more and more steps, from 0 up to all 100.', build: 1 },
            { text: 'Slow the turning down to a quarter of the speed and study the lace.', set: { param: 'speed', value: 0.25 } }
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
float dist, scale, ball = .5;         // ball is the distance to the mirror ball in the middle.
vec3 p, ray, dir = ball - FC.rgb/r.y; // This pixel's ray direction; its third part is about 0.5, so it looks along +z.
ray.z--;                              // The camera starts at z = −1.
for (float i = 0.; i++ < 1e2;) {      // March 100 steps along the ray
  if (ball < .01) dir = ray*3.;       // The ray touched the ball: point it straight out from the ball's center.
  p = ray += dir*dist;                // Step forward.
  p.zy *= rotate2D(t*PI/6.);          // The world turns, once every 12 seconds.
  p.z = fract(p.z + t) - .5;          // Repeat space along z, and slide it by one copy every second.
  scale = 2.;                         // Start the stretch count at 2.
  p = .5 - abs(p);                    // Mirror space, like the mirrors in a kaleidoscope.
  for (int k = 0; k++ < 9; p.z += 3.) {   // Carve 9 times: mirror, stretch, shift
    p = abs(p) - .7;                  // Mirror and shift.
    scale *= dist = 6./min(dot(p, p), 2.);   // Stretch by 6 ÷ the squared distance (at least 3 times) and keep count.
    p = abs(p)*dist - 4.;             // Mirror, stretch and shift again; z also moves by 3 after each pass.
  }
  dist = min(ball = length(ray) - .3, length(p.xz)/scale);   // The nearer of the ball (radius 0.3) and the carved stone.
  o += .01/exp(dist*1e3);             // Gray light, only very close to a surface.
}`,
        level: 'medium',
        summary: 'You fly through a hall of carved white stone, mirrored left to right like the view inside a kaleidoscope, with a shiny ball floating in the middle. The code is a shader, a small program that runs for every pixel, and it follows each pixel’s ray, an imaginary line from the camera, in 100 steps. The carvings are a fractal, a shape made of smaller copies of itself: 9 times over, space is mirrored, stretched and shifted, which carves finer and finer detail. Space is also repeated along the flight direction and slides by one copy every second, so the flight never ends, and the whole world turns once every 12 seconds. When a ray touches the ball, it simply changes direction to point straight out from the ball’s center, which is enough to make the ball look like a mirror. Every step adds the same amount of red, green and blue, so the whole picture is gray.',
        tour: [
            { title: 'Flying through copies', text: 'fract keeps only the part of a number after the decimal point, so fract(p.z + t) − 0.5 wraps z into a slice from −0.5 to 0.5 that repeats forever along z. Adding t slides the slices by one whole copy every second, which feels like flying forward through an endless hall. The world also turns by π/6 radians per second, a full turn in 12 seconds, so after 12 seconds everything is back where it started.', at: ['p.z = fract', 'p.zy *= rotate2D'] },
            { title: 'Carving the stone', text: 'abs(p) mirrors space: the left side becomes a copy of the right side, like the mirrors inside a kaleidoscope. Loop 2 (the inner loop, marked ⟳2) runs 9 times. Each pass mirrors and shifts space, stretches it by 6 ÷ dot(p, p) (a lot near the center, and never less than 3 times), then mirrors, stretches and shifts it again. Each pass turns one big shape into many smaller ones, so the carvings get finer and finer. scale multiplies all the stretches together, and dividing by it turns the distance length(p.xz) back into a real distance.', at: ['p = .5 - abs(p)', 'for (int k', 'scale *= dist', 'p = abs(p)*dist'], show: 'scale' },
            { title: 'A mirror ball', text: 'ball = length(ray) − 0.3 is the distance from the ray to a ball of radius 0.3 in the middle, which does not turn or repeat like the rest. When that distance drops below 0.01, the ray has touched the ball, and the code sets the ray’s direction to ray·3: straight out from the ball’s center. A real mirror bounces light at an angle, but this simple shortcut still puts the surrounding stone on the ball’s surface, so it looks shiny.', at: ['if (ball < .01)', 'ball = length(ray)'], show: 'ball' },
            { title: 'Light from nearness', text: 'Each step adds 0.01 ÷ exp(dist·1000), where exp means “e to the power”. That is the full 0.01 when the ray is right on a surface, and almost nothing once it is even 0.005 away, so only steps that end very close to the stone add light. This step stops loop 2 after 3 passes: the stone nearly disappears, leaving only faint lines. Drag the Loop 2 slider up and the carvings fill in by about 5 passes.', at: ['o += .01/exp'], steps: { 2: 3 } }
        ],
        try: [
            { text: 'Carve the stone one pass at a time: loop 2 is swept from 0 to all 9 passes.', build: 2 },
            { text: 'Make the mirror ball bigger (radius 0.3 → 0.45) and look at the stone reflected in it.', code: { find: 'length(ray) - .3', replace: 'length(ray) - .45' } },
            { text: 'Fly three times as fast through the hall, while the world keeps turning at the same speed.', code: { find: 'fract(p.z + t)', replace: 'fract(p.z + t*3.)' } },
            { text: 'Put ball, the distance from each ray to the mirror ball, on the canvas.', show: 'ball' },
            { text: 'Color only what moves, and see the whole hall stream toward you.', view: 'motion' }
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
float light, level, depth, stretch, scale, n = 15.;   // n = 15 is used several times below.
for (float i = 0.; i++ < 1e2;) {      // March 100 steps along the ray
  vec3 q, p = vec3((FC.xy - .5*r)/r.y*depth - 9., depth) + n;   // The point on the ray; the camera starts at (6, 6, 15).
  p.zx *= rotate2D(t/n);              // The camera circles slowly, once every 94 seconds.
  scale = level = 3.;                 // Start both at 3.
  light = scale + snoise3D(vec3(p.xz*.1, t));   // Flickering sunlight: 3 plus smooth noise that changes with time.
  for (q = p; level++ < 23.;) {       // Fold 20 times to grow the coral
    scale *= stretch = n/dot(p, p);   // Stretch by 15 ÷ the squared distance, and keep the total …
    p = vec3(0, 4, -1) - abs(abs(p)*stretch - vec3(3, 4, 3));   // … then mirror, stretch, shift, mirror and shift again.
  }
  depth += min(30. - q.y, p.y/scale); // Step by the nearer of the water surface (y = 30) and the coral.
  o.rgb += hsv(scale = log(scale)/n, .5, scale/2e2*light) + FC.zww*depth*light/6e4;   // Coral colored by its stretching, plus blue-green haze that grows with distance.
}`,
        level: 'medium',
        summary: 'You are diving over a coral reef: lumpy green coral below, the rippling underside of the water surface above, and patches of sunlight flickering over everything. The code is a shader, a small program that runs for every pixel, and it follows each pixel’s ray, an imaginary line from the camera, in 100 steps. The coral is a fractal, a shape made of smaller copies of itself: 20 times over, space is stretched, mirrored and shifted, which grows branching, bumpy shapes full of holes. A flat water surface sits above it, 24 units over the camera. The flickering comes from noise, a smooth random pattern that slowly changes with time, the way sunlight dances under water. The coral’s color depends on how much the folding stretched space, and a blue-green haze grows with distance.',
        tour: [
            { title: 'A camera in the water', text: 'Each ray starts at (6, 6, 15): the point on the ray is (uv·depth − 9, depth) + 15, and at depth 0 that is (−9 + 15, −9 + 15, 15). rotate2D(t/15) turns x and z around the vertical axis, so the camera circles the middle of the reef once every 30π seconds, about 94 seconds. The clip shows half of that circle.', at: ['vec3 q, p = vec3', 'p.zx *= rotate2D'] },
            { title: 'Coral by folding', text: 'Loop 2 (the inner loop, marked ⟳2) runs 20 times. Each pass stretches space by 15 ÷ dot(p, p), which is a lot near the center and a little far away, then mirrors it with abs, shifts it by (3, 4, 3), mirrors it again and shifts it by (0, 4, −1). Mirroring and stretching over and over turns a flat surface into branching, bubbly coral. scale multiplies all the stretches, so p.y ÷ scale gives a careful distance to the coral.', at: ['for (q = p', 'scale *= stretch', 'p = vec3(0, 4, -1)'], show: 'scale' },
            { title: 'Water above', text: 'min(30 − q.y, …) adds a flat ceiling at height 30: the underside of the water surface. q is the point before folding, so 30 − q.y is simply how far below the surface the point is. The ray steps by whichever is nearer, the coral or the surface.', at: ['depth += min'], show: 'depth' },
            { title: 'Dancing sunlight', text: 'snoise3D is noise: a smooth, random-looking pattern with values from about −1 to 1. Here it is read at (x/10, z/10, t), so it drifts and changes as time passes. light = 3 plus that noise swings between about 2 and 4, and it multiplies everything this step adds, so bright and dark patches flicker across the reef.', at: ['light = scale + snoise3D'], show: 'light' },
            { title: 'Color and haze', text: 'hsv makes a color from a hue (a place on the color wheel, from 0 to 1), a saturation (how strong the color is) and a brightness. Here both the hue and the brightness come from log(scale) ÷ 15, so parts of the coral get different colors depending on how much the folds stretched them. The second part, FC.zww·depth, adds a little (0.5, 1, 1), more green and blue than red, that grows with distance: the blue-green haze of deep water.', at: ['o.rgb += hsv'] }
        ],
        try: [
            { text: 'Watch the coral grow: loop 2 is swept from 0 to all 20 folds. For most of the sweep there is little to see; the coral takes shape only in the last few folds.', build: 2 },
            { text: 'Switch off the dancing sunlight by setting light to plain 3. The ripples on the water surface disappear.', code: { find: 'light = scale + snoise3D(vec3(p.xz*.1, t));', replace: 'light = scale;' } },
            { text: 'Lower the water surface from height 30 to 12, much closer over your head.', code: { find: '30. - q.y', replace: '12. - q.y' } },
            { text: 'Double the saturation (0.5 → 1) for a more colorful reef.', code: { find: 'log(scale)/n, .5,', replace: 'log(scale)/n, 1.,' } },
            { text: 'Circle the reef four times as fast.', set: { param: 'speed', times: 4 } }
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
float height, i, dist, R, a;          // The height along the spiral's axis, the step count, the step, the radius and a fold factor.
for (vec3 ray, p; i++ < 85.;) {       // March 85 steps along the ray
  p = ray += (.5 - FC.gbr/r.y)*dist;  // Step forward; the image's x and y become the world's z and x, and the ray looks along y.
  o += vec4(.4, .2, .1, 0)/exp(dist*6e3);   // Amber light when the last step was tiny, because a surface is very close.
  p.y--;                              // Put the spiral's center 1 unit in front of the camera.
  p.xy *= rotate2D(sin(t));           // Rock the spiral back and forth.
  height = p.y;                       // The point's height along the spiral's axis.
  dist = atan(p.x, p.z) - t;          // The angle around the axis, turning with time.
  // Spiral coordinates: log R + angle/π stays the same along a logarithmic spiral, and − t zooms in forever.
  p = vec3(log(R = length(p)) + dist/PI - t, a*sin(5.*dist), a = height/R) + .5;
  for (int j = 0; j++ < 9; p /= a)    // Fold 9 times: repeat, then turn inside out
    R *= a = dot(p -= round(p), p) + .25;
  dist = max(-height, R)/5.;          // The next step is R ÷ 5; nothing is drawn in front of the plane where height is 0.
}
o -= log(++dist)*2e2;                 // Darken every pixel whose last step was long: its ray found nothing.`,
        level: 'expert',
        summary: 'A glowing amber spiral, like a snail shell made of lace, rocks back and forth while its pattern turns and zooms inward forever. The code is a shader, a small program that runs for every pixel, and it follows each pixel’s ray, an imaginary line from the camera, in 85 steps. Its secret is a change of coordinates: instead of x, y and z, it describes each point by the logarithm of its distance from the spiral’s center, its angle around the center, and its height. In these spiral coordinates a logarithmic spiral, the kind found in snail shells and galaxies, becomes a straight line, and zooming in becomes a simple slide. The code then repeats and folds space 9 times to carve an ornament, adds amber light near its surfaces, and at the end blacks out every pixel whose ray found nothing.',
        tour: [
            { title: 'Looking down the axis', text: 'The ray starts at the origin and moves mostly along the y direction; the image’s x and y become the world’s z and x. p.y−− puts the spiral’s center 1 unit in front of the camera, so you look straight down the spiral’s axis. rotate2D(sin t) then tilts the spiral by an angle that swings between −1 and 1 radian (about 57 degrees each way) as sin t goes up and down, so it rocks back and forth every 2π seconds, about 6.3.', at: ['p = ray +=', 'p.y--', 'rotate2D(sin(t))'] },
            { title: 'Spiral coordinates', text: 'R = length(p) is the distance from the spiral’s center, and dist here holds the angle around its axis (atan gives an angle, like the hand of a clock). log R, the logarithm of R, goes up by the same amount every time R is multiplied by the same number. The first new coordinate, log R + angle ÷ π − t, stays the same along a logarithmic spiral that gets about 7.4 times wider with every turn. So the pattern is laid out along spirals, and because − t (and the − t inside the angle) keeps sliding this coordinate, the pattern moves outward and you seem to zoom in forever.', at: ['dist = atan', 'p = vec3(log(R'], show: 'R' },
            { title: 'Two more coordinates', text: 'The second coordinate, sin(5 × angle) times a, makes five ripples around the axis. The third, a = height ÷ R, says how far the point is above or below the spiral’s flat middle, compared with its distance from the center. Dividing the angle by π in the first coordinate is a clever choice: where the angle jumps from π back to −π, that coordinate jumps by exactly 2, a whole number, so the repeating in the next step hides the seam.', at: ['p = vec3(log(R'] },
            { title: 'Repeat and fold', text: 'Loop 2 (marked ⟳2) runs 9 times. p −= round(p) keeps only how far each coordinate is from the nearest whole number, which repeats the pattern in boxes and so copies it along the spiral. Then p is divided by a = dot(p, p) + 0.25, which turns each box inside out around its center. a is between 0.25 and 1, and R is multiplied by every a, so R becomes tiny near the ornament. This step stops loop 2 after 6 passes: R stays bigger, fewer rays get close enough to light up, and the ornament turns faint and patchy.', at: ['R *= a = dot'], steps: { 2: 6 } },
            { title: 'Amber glow and black gaps', text: 'The next step is R ÷ 5, and max(−height, R) keeps the ray from stopping in front of the flat plane where height is 0. At every step the code adds (0.4, 0.2, 0.1) ÷ exp(dist·6000): red, half as much green and a quarter as much blue, which is amber. That is almost nothing unless the last step was tiny, meaning a surface is very close. At the end, o −= 200·log(1 + dist) darkens each pixel more the longer its last step was, so pixels whose ray found nothing turn black.', at: ['dist = max(-height', 'o += vec4(.4', 'o -= log'] }
        ],
        try: [
            { text: 'Stop the rocking: change sin(t) to 0. Now you look straight down the spiral’s axis and see the whole spiral face on.', code: { find: 'rotate2D(sin(t))', replace: 'rotate2D(0.)' } },
            { text: 'Change the 5 ripples around the axis to 3 and watch the ornament rearrange itself.', code: { find: 'sin(5.*dist)', replace: 'sin(3.*dist)' } },
            { text: 'Make the glow emerald instead of amber by giving green the biggest share.', code: { find: 'vec4(.4, .2, .1, 0)', replace: 'vec4(.1, .4, .2, 0)' } },
            { text: 'Watch the rays find the ornament, from 0 up to all 85 steps. The picture stays dark until the rays get close.', build: 1 }
        ],
        concepts: ['log-polar', 'domain-repetition', 'sphere-inversion', 'glow', 'raymarching'], // not seamless: the zoom slides 8.28 pattern cells per 2π s
        tags: ['raymarching', 'fractal', 'spiral', 'zoom']
    },
    {
        id: 'cloud-cave',
        title: 'Cloud cave',
        author: 'Yohei Nishitsuji', handle: 'YoheiNishitsuji', url: 'https://x.com/YoheiNishitsuji/status/1880163156741275732', posted: '2025-01-17',
        platform: 'twigl', video: { width: 700, height: 500, seconds: 15.716 }, duration: 15.708,
        original: 'float i,e,R,s;vec3 q,p,d=vec3(FC.xy/r-vec2(.5,-.3),1);for(q.zy--;i++<99.;){o.rgb+=hsv(.1,.2,min(e*s,.65-e)/45.);s=1.;p=q+=d*e*R*.3;p=vec3(log2(R=length(p))-t*.8,exp2(-p.z/R+.9),atan(p.y,p.x)-t*.4);for(e=--p.y;s<3e2;s+=s)e+=(dot(sin(p.xy*s)-.5,.5-sin(p.zy*s)))/s*.3;}',
        readable: `// Cloud cave · Yohei Nishitsuji (@YoheiNishitsuji), 17 Jan 2025 · readable version, same image
float dist, R, freq;                  // The distance to the cloud, the distance from the center, and a ripple frequency.
vec3 ray, p, dir = vec3(FC.xy/r - vec2(.5, -.3), 1);   // This pixel's ray direction, tilted upward.
ray.zy--;                             // The camera starts at y = −1, z = −1.
for (float i = 0.; i++ < 99.;) {      // March 99 steps along the ray
  o.rgb += hsv(.1, .2, min(dist*freq, .65 - dist)/45.);   // Warm white light, strongest just outside the cloud (from the last step).
  freq = 1.;                          // The ripples start at frequency 1.
  p = ray += dir*dist*R*.3;           // Step forward; the steps grow with R, the distance from the center.
  // New coordinates: log₂R − 0.8t (flying inward), a height from the angle to the z axis, and the angle around it (turning).
  p = vec3(log2(R = length(p)) - t*.8, exp2(-p.z/R + .9), atan(p.y, p.x) - t*.4);
  for (dist = --p.y; freq < 3e2; freq += freq)   // Start at a cone, add 9 ripple layers
    dist += (dot(sin(p.xy*freq) - .5, .5 - sin(p.zy*freq)))/freq*.3;   // Each layer: twice the frequency, half the height.
}`,
        level: 'medium',
        summary: 'You drift endlessly into a cave of billowing, smoky clouds, with a soft warm glow along every edge. The code is a shader, a small program that runs for every pixel, and it follows each pixel’s ray, an imaginary line from the camera, in 99 steps. Its trick, a favorite of the artist, is to describe each point not by x, y and z but by the logarithm of its distance from the center and two angles. In these coordinates zooming in is the same as sliding, so subtracting time from the first coordinate flies you inward forever, with new clouds growing out of the middle. The cloud’s surface is a simple cone, a funnel shape, made bumpy by 9 layers of ripples, each twice as fine and half as tall as the one before. There is no real lighting: each step adds a little warm white light, most of it when the ray passes just outside the cloud, which draws bright rims on every billow.',
        tour: [
            { title: 'New coordinates', text: 'The code replaces the point p with three new numbers. The first is log₂R − 0.8t: log₂R goes up by 1 every time R, the distance from the center, doubles, and subtracting 0.8t slides everything so you keep flying inward, by one doubling every 1.25 seconds. The second, exp2(0.9 − p.z/R), depends only on the angle between the point and the z axis. The third is the angle around the z axis (atan, like the hand of a clock), turning slowly with − 0.4t. In these coordinates zooming in is just sliding, so the flight never has to end, and after 5π seconds (about 15.7) everything is back in step.', at: ['p = vec3(log2'], show: 'R' },
            { title: 'A cone with ripples', text: 'dist starts as the second coordinate minus 1, which is 0 on a cone, a funnel shape around the z axis. Loop 2 (marked ⟳2) then adds 9 layers of ripples made from sines (waves that go up and down between −1 and 1), with freq = 1, 2, 4, … up to 256. Each layer is twice as fine and, because it is divided by freq, half as tall. Stacking layers like this turns a smooth shape into billowing clouds. This step stops loop 2 after 2 layers to show the smooth shape underneath.', at: ['for (dist = --p.y', 'dist += (dot'], steps: { 2: 2 } },
            { title: 'Steps that grow', text: 'In the new coordinates, a distance of 1 is small near the center and huge far away. So the step, dist·R·0.3, is multiplied by R, the real distance from the center, to turn it back into a real distance, and the 0.3 keeps it careful.', at: ['p = ray += dir*dist*R'] },
            { title: 'Rims of light', text: 'The light added at each step is min(dist·512, 0.65 − dist) ÷ 45, because freq is 512 when the loop ends. It is 0 right on the surface, peaks when the ray is a hair outside the cloud (dist about 0.0013), and slowly fades farther out. Inside the cloud, where dist is below 0, it is negative and takes light away. Rays that skim past an edge spend many steps just outside it, so the edges glow, and hsv(0.1, 0.2, …) makes that light a pale, warm white.', at: ['o.rgb += hsv'], show: 'dist' }
        ],
        try: [
            { text: 'Add the ripple layers one by one: loop 2 is swept from 0 to all 9 layers. Watch smooth walls turn into clouds.', build: 2 },
            { text: 'Make it an ice cave: change the hue to 0.6 (blue) and the saturation to 0.6.', code: { find: 'hsv(.1, .2,', replace: 'hsv(.6, .6,' } },
            { text: 'Fly in three times as fast: change 0.8 to 2.4.', code: { find: 't*.8', replace: 't*2.4' } },
            { text: 'Put dist, the distance to the cloud, on the canvas.', show: 'dist' }
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
float dist, R, freq;                  // The distance to the smoke, the distance from the center, and a ripple frequency.
vec3 ray, p, dir = vec3(FC.xy/r - vec2(.6, .5), .7);   // This pixel's ray direction, turned a little to the left.
ray.zx--;                             // The camera starts at x = −1, z = −1.
for (float i = 0.; i++ < 99.;) {      // March 99 steps along the ray
  o.rgb += hsv(.1, .2, min(dist*freq, .7 - dist)/35.);   // Warm white light, strongest just outside the smoke (from the last step).
  freq = 1.;                          // The ripples start at frequency 1.
  p = ray += dir*dist*R*.1;           // Step forward; the steps grow with R, the distance from the center.
  // New coordinates: log₂R − t (flying inward), a height from the angle to the z axis, and the angle around it (swaying with cos t).
  p = vec3(log2(R = length(p)) - t, exp(1. - p.z/R), atan(p.y, p.x) + cos(t)*.2);
  for (dist = --p.y; freq < 3e2; freq += freq)   // Add 9 layers of swirling ripples
    dist += sin(dot(sin(p.zxy*freq) - .5, 1. - cos(p.yxz*freq)))/freq;   // Each layer: twice the frequency, half the height, axes shuffled.
}`,
        level: 'medium',
        summary: 'You rush through a tunnel of swirling white smoke, full of thin, twisting wisps, while the whole tunnel sways gently back and forth. The code is a close cousin of the Cloud cave by the same artist: a shader, a small program that runs for every pixel, following each pixel’s ray, an imaginary line from the camera, in 99 steps. Like the Cloud cave, it describes each point by the logarithm of its distance from the center and two angles, so subtracting time from the first coordinate flies you inward forever, here by one doubling of the distance every second. The smoke gets its wisps from a different recipe for its ripples: 9 layers, each a sine of sines and cosines taken with the coordinates shuffled around. The glow works like the Cloud cave’s: warm white light that is strongest just outside the smoke, so every wisp gets a bright edge.',
        tour: [
            { title: 'An endless flight', text: 'Like the Cloud cave, the code swaps x, y and z for three new numbers. The first, log₂R − t, slides inward by one doubling of the distance R every second. The second, exp(1 − p.z/R), depends only on the angle away from the z axis. The third is the angle around the z axis (atan) plus cos(t)·0.2, which swings by up to 0.2 radians (about 11 degrees) each way, so the whole tunnel sways gently. After 2π seconds (about 6.3) the flight and the sway are both back in step, so the animation loops.', at: ['p = vec3(log2'] },
            { title: 'Swirling layers', text: 'dist starts as exp(1 − p.z/R) − 1, which is 0 along the z axis and grows as you turn away from it. Loop 2 (marked ⟳2) adds 9 layers, with freq = 1, 2, 4, … up to 256, each half as tall as the one before. Each layer is the sine of a dot product (a sum of products) of sines and cosines, with the three coordinates shuffled into different orders (zxy and yxz). The shuffling mixes the directions together, which folds the smoke into thin, twisting wisps. This step stops loop 2 after 3 layers, which leaves smooth ribbons of smoke.', at: ['for (dist = --p.y', 'dist += sin(dot'], steps: { 2: 3 } },
            { title: 'Glowing edges', text: 'Each step adds min(dist·512, 0.7 − dist) ÷ 35 of warm white light, because freq is 512 when the loop ends. That is largest when the ray is just outside the smoke and 0 right on it, so rays that skim past a wisp add up the most light and draw its bright edge. The steps are dist·R·0.1, even more careful than in the Cloud cave.', at: ['o.rgb += hsv'], show: 'dist' }
        ],
        try: [
            { text: 'Add the layers of smoke one at a time, from 0 to all 9, and watch smooth ribbons turn into wisps.', build: 2 },
            { text: 'Make the tunnel sway five times as far: change 0.2 to 1.', code: { find: 'cos(t)*.2', replace: 'cos(t)*1.' } },
            { text: 'Slow the flight to a quarter of its speed, while the sway keeps its pace.', code: { find: 'log2(R = length(p)) - t', replace: 'log2(R = length(p)) - t*.25' } },
            { text: 'Paint the smoke electric blue by changing the hue to 0.55 and the saturation to 0.7.', code: { find: 'hsv(.1, .2,', replace: 'hsv(.55, .7,' } }
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
float dist, R, freq;                  // The distance to the mountains, the distance from the center, and a ripple frequency.
vec3 ray, p, dir = vec3(FC.xy/r*.6 - vec2(.3, -.6), .5);   // This pixel's ray direction, tilted steeply upward.
ray.zy--;                             // The camera starts at y = −1, z = −1.
for (float i = 0.; i++ < 97.;) {      // March 97 steps along the ray
  o.rgb += hsv(.1, dist, min(dist*freq, 1.)/95.);   // Sepia light far from the surface, almost white close to it (from the last step).
  freq = 5.;                          // The ripples start at frequency 5.
  p = ray += dir*dist*R*.4;           // Step forward; the steps grow with R, the distance from the center.
  // New coordinates: log R − 0.5t (flying slowly inward), a height from the angle to the z axis that breathes with sin t, and the angle around the z axis.
  p = vec3(log(R = length(p)) - t*.5, exp(-p.z/R) + sin(t)*.07 + .2, atan(p.y, p.x));
  for (dist = --p.y; freq < 1e3; freq += freq)   // Add 8 layers of sharp ridges
    dist += dot(sin(p.zxx*freq), .4 - cos(p.yyz*freq))/freq*.3;   // Each layer: twice the frequency (5 up to 640), half the height.
}`,
        level: 'medium',
        summary: 'Jagged mountains of cloud tower up in sepia brown and white, slowly rising and sinking as if the landscape were breathing. The code is by the same artist as the Cloud cave and the Smoke tunnel, and it is a shader: a small program that runs for every pixel, following each pixel’s ray, an imaginary line from the camera, in 97 steps. Again each point is described by the logarithm of its distance from the center and two angles, so subtracting time from the first coordinate flies you slowly inward forever. This time the ripples start at a higher frequency, 5, and double 8 times up to 640, so there are no big soft billows, only sharp ridges and cliffs. The color uses the distance to the surface as its saturation: light added far from the mountains is a deep sepia, and light added right next to them is almost white.',
        tour: [
            { title: 'Ridges from layers', text: 'dist starts as the second coordinate minus 1. Loop 2 (marked ⟳2) then adds 8 layers of ripples with freq = 5, 10, 20, … up to 640, each twice as fine and half as tall as the one before. Because even the first layer is fairly fine, there are no big soft billows: the layers stack up into sharp ridges and cliffs, like a mountain range. This step stops loop 2 after 3 layers, which leaves soft, rounded hills; try 1 and 8 on the Loop 2 slider to compare.', at: ['for (dist = --p.y', 'dist += dot'], steps: { 2: 3 } },
            { title: 'A breathing landscape', text: 'exp(−p.z/R) depends only on the angle between the point and the z axis, so the bare surface is a cone around that axis, so wide that it is almost flat. sin(t)·0.07 raises and lowers the whole surface a little as time passes, which makes the mountains breathe once every 2π seconds (about 6.3). At the same time, log R − 0.5t slides slowly inward, and after 4π seconds (about 12.6) everything is back in step, so the animation loops.', at: ['exp(-p.z/R)'] },
            { title: 'Color from distance', text: 'hsv(0.1, dist, …) is a color with hue 0.1 (orange-brown), saturation dist and a brightness. Saturation is how strong the color is: 0 gives white or gray, 1 gives the full color. Using dist as the saturation means light added while the ray is far from the surface comes out sepia, and light added right next to it comes out white, which gives the ridges their bright, frosty edges. The brightness, min(dist·1280, 1) ÷ 95, is full for any step that is not almost touching the surface.', at: ['o.rgb += hsv'], show: 'dist' }
        ],
        try: [
            { text: 'Add the ridge layers one at a time, from 0 to all 8, and watch soft hills turn into sharp mountains.', build: 2 },
            { text: 'Start the ripples at frequency 1 instead of 5. Two extra layers of big waves appear, and the sharp peaks turn into softer, rounder cloud banks.', code: { find: 'freq = 5.;', replace: 'freq = 1.;' } },
            { text: 'Turn the sepia into a cold blue by changing the hue from 0.1 to 0.6.', code: { find: 'hsv(.1, dist,', replace: 'hsv(.6, dist,' } },
            { text: 'Make the mountains breathe twice as deeply: change 0.07 to 0.15.', code: { find: 'sin(t)*.07', replace: 'sin(t)*.15' } }
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
vec3 p;                               // The point that walks along the ray.
float d, best, knot, u;               // A guess's distance, the best distance so far, the best place on the knot, and a random number.
p.z = 5.;                             // The camera starts at z = 5.
for (float i = 0.; i++ < 6e2;) {      // 600 samples: 24 steps × 25 guesses
  u = fsnoise(p.xy*i + t)*2. - 1.;    // A random number from −1 to 1, new for every pixel, guess and moment.
  // The distance from the point (turned with time) to a guessed place u on the trefoil knot, minus the tube's thickness there.
  d = length(p*rotate3D(t, p + i) - vec3(sin(u = knot + u*u*u*PI) + 2.*sin(u + u), cos(u) - 2.*cos(u + u), -sin(3.*u)))
      - fract((u/6. - t)/PI*3.);
  if (d < best) { best = d; knot = u; }   // Keep the closest guess.
  if (mod(i, 25.) == 0.) {            // After every 25 guesses:
    o.rgb += hsv(knot/6., .7, .1/exp(best < 0. ? 0. : best*i));   // add color: the hue comes from the place on the knot, and it is brighter when closer.
    p -= (.5 - FC.rgb/r.y)*best++;    // Step along the ray by the best distance, then add 1 so any guess at the new spot can win.
  }
}`,
        level: 'expert',
        summary: 'A rainbow-colored tube tied in a trefoil knot, the simplest knot that cannot be untied, turns in the dark, one end swelling fat while the other thins to a point. The code is a shader, a small program that runs for every pixel, and it follows each pixel’s ray, an imaginary line from the camera, like the other 3D works here, but with a twist: it has no formula for the distance to the knot. Instead, at every step it makes 25 random guesses of a place on the knot, keeps the one closest to the ray, and uses that distance to step forward. Most guesses land close to the best place found so far, so the search quickly homes in. Because the random guesses differ from pixel to pixel and from moment to moment, the image has a fine, sparkling grain. The color follows the place on the knot, so the rainbow runs along the tube.',
        tour: [
            { title: 'The trefoil knot', text: 'As u goes from 0 to 2π (about 6.28), the point (sin u + 2 sin 2u, cos u − 2 cos 2u, −sin 3u) traces a closed loop with three lobes that passes over and under itself: a trefoil knot. You cannot untie it without cutting it. rotate3D, a helper that turns a point around an axis, turns the knot by t radians around a tilted axis, so it makes one full turn every 2π seconds (about 6.3).', at: ['vec3(sin(u = knot'] },
            { title: 'Searching at random', text: 'fsnoise gives a random-looking number from 0 to 1, and × 2 − 1 turns it into a number u from −1 to 1. The guess is knot + u³·π: u³ is tiny when u is small, so most guesses land very near knot, the best place found so far, and a few land up to π away. If a guess is closer than the best one, it becomes the new best. After 25 guesses, the ray steps forward by the best distance: this raymarcher searches for its distance instead of calculating it.', at: ['u = fsnoise', 'if (d < best)'], show: 'best' },
            { title: 'A tube that swells', text: 'Subtracting a number from the distance to a curve makes a tube that thick around it. Here the thickness is fract((u/6 − t)/π·3), and fract keeps only the part after the decimal point, so it grows from 0 to 1 once around the knot and then drops back to 0. That is why one end of the tube is fat and the other comes to a point. Because t is in it too, the fat part slides along the knot, all the way around about once a second.', at: ['- fract((u/6.'] },
            { title: 'Rainbow and grain', text: 'hsv(knot/6, 0.7, …) takes the hue, the place on the color wheel, from knot, the place on the knot, so the colors run through the rainbow along the tube. The brightness is 0.1 ÷ exp(best·i): bright when the best guess is close to the ray. Because the guesses are random, neighboring pixels get slightly different answers, which is the sparkling grain. This step stops loop 1 after 300 of its 600 samples (12 ray steps), so the knot is dimmer and grainier.', at: ['o.rgb += hsv(knot'], steps: { 1: 300 } }
        ],
        try: [
            { text: 'Watch the samples add up, from 0 to all 600: the knot fades in, grainy at first.', build: 1 },
            { text: 'Give the tube the same thickness everywhere: replace the swelling with a fixed 0.4.', code: { find: 'fract((u/6. - t)/PI*3.)', replace: '.4' } },
            { text: 'Run through the rainbow three times along the tube instead of once: divide by 2 instead of 6.', code: { find: 'hsv(knot/6.', replace: 'hsv(knot/2.' } },
            { text: 'Spread the guesses evenly instead of near the best one (u³ becomes u). The search gets worse, and the knot turns fuzzy.', code: { find: 'u*u*u*PI', replace: 'u*PI' } },
            { text: 'Slow time down to a quarter and follow the fat end of the tube as it slides along the knot.', set: { param: 'speed', value: 0.25 } }
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
        readable: `// Point jellyfish · ア (@yuruyurau), 29 Aug 2026 · where the sketch puts dot number i
y = i/99                              // y is like a row number: it goes up by 1 every 99 dots, from 0 to about 202
k = (8 + sin(i/19 + t))*cos(i/49)     // k swings from side to side as i counts up, and how far it swings changes with time t
e = y/8 - 12                          // e turns the row into a height from −12 to 13, with 0 in the middle rows
d = length(vec2(k, e))^2/79 + 1       // d is 1 in the middle of the sheet of dots and grows toward its edges
x = k/d*4 - e*sin(k) + k/(d*d)*(12 + d*6*sin(d*d - t + cos(t/3) + .3*sin(e))) + 200   // across: dividing by d squeezes the dots together lower down, and the sines make the strands sway
vec2(x, 12*sin(d*2.6 - t) + d*66 + 40)   // the dot's place: 66·d pixels down, so the middle of the sheet is the top of the bell, plus a wave that runs down the body`,
        level: 'easy',
        summary: 'This jellyfish is drawn with 20,000 tiny dots, and there is no picture of a jellyfish anywhere in the code. One formula takes each dot’s number i (0, 1, 2, … up to 19,999) and the time t, and works out where that dot goes. Dots with neighboring numbers land close together, so all of them together trace a smooth sheet that folds into a bell with hanging strands. Every dot is faint, so the jellyfish looks brightest where many dots pile up. As time runs, the same formula moves every dot a little: the bell pulses and the strands sway.',
        tour: [
            { title: 'One number becomes two', text: 'The formula gets just one number per dot: its number i. It makes two coordinates out of it. y = i/99 grows slowly, by 1 every 99 dots, like a row number. cos(i/49) swings back and forth quickly, once every 308 dots, like a pendulum. Together they sweep over a flat sheet, the way the beam of an old TV drew the screen line by line.', at: ['y = i/99', 'k = (8'] },
            { title: 'How far from the middle', text: 'e = y/8 − 12 turns the row number into a height from −12 to 13, with 0 in the middle rows. Then d = (k² + e²)/79 + 1 measures how far a dot is from the middle of the sheet: exactly 1 in the middle and bigger toward the edges. Each dot is placed 66·d pixels down, so the middle of the sheet becomes the top of the bell and its edges hang below as strands.', at: ['e = y/8', 'd = length'] },
            { title: 'A wide bell, thin strands', text: 'Sideways, the formula divides by d and by d·d. Near the top d is small, so the dots spread out into a wide dome. Lower down d is bigger, the division squeezes the dots together, and the body narrows into strands. The sin(…) terms add ripples that change with time, so the strands sway.', at: ['x = k/d*4'] },
            { title: 'A pulse runs down the body', text: 'The last line adds 12·sin(2.6·d − t) to the height. As t grows, this wave moves toward bigger d, so a ripple travels from the top of the bell down to the tips, again and again. Watch the bell squeeze and relax.', at: ['vec2(x'] },
            { title: 'Light from crowds of dots', text: 'Each dot is only 26% opaque, so one dot on its own is dim. Where hundreds of dots land in the same place, their light adds up, which is why the edges of the bell glow. Try fewer dots with the Points slider and you will start to see the separate dots.', at: [] }
        ],
        try: [
            { text: 'Use only 2,000 dots. Can you still see the jellyfish?', set: { param: 'count', value: 2000 } },
            { text: 'Make each dot three times bigger, so the dots melt together.', set: { param: 'size', value: 3 } },
            { text: 'Play it three times as fast.', set: { param: 'speed', times: 3 } },
            { text: 'Change 49 to 20 in the formula: the sheet folds more often.', code: { find: 'cos(i/49)', replace: 'cos(i/20)' } },
            { text: 'Color only the dots that are moving.', view: 'motion' }
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
        readable: `// Swimming creature · ア (@yuruyurau), 16 Sep 2026 · where the sketch puts dot number i
y = i/598                             // y counts slowly: it goes up by 1 every 598 dots, reaching about 33.
k = (5 + sin(y))*cos(i/7)             // k swings fast from side to side, once every 44 dots, by 4 to 6.
e = y/5 - 11                          // e turns y into a number from −11 to about −4.3.
d = length(vec2(k, e))/.6 - 6         // d says where along the body the dot sits: from about 1 to 14.5.
q = 99 + d*sin(t - d) + y/23*k*(3*sin(e) + e*sin(e*2) + sin(d*4))   // q is the distance from the center: about 99 pixels, plus a wave along the body, plus the fins.
c = d/4 - t/8 + cos(t + e)/9          // c is the angle around the center: − t/8 makes the creature circle, and cos(t + e)/9 makes it wiggle.
vec2(q*sin(c) + 200, q*cos(c) + 200)  // Turn the distance q and the angle c into a place around the center (200, 200).`,
        level: 'easy',
        summary: 'A long, feathery creature swims in a circle around the middle of the picture, its body rippling and its fins waving. It is drawn with 20,000 tiny, faint dots, and there is no picture of the creature anywhere in the code. One formula takes each dot’s number i (0, 1, 2, … up to 19,999) and the time t, and works out where that dot goes. The formula first finds how far the dot should be from the center of the picture and at what angle, like the length and direction of a clock hand, and only then turns those into a position. Dots with neighboring numbers land close together, so together they trace smooth strands, and the creature looks brightest where many dots pile up.',
        tour: [
            { title: 'A distance and an angle', text: 'The last line places each dot using two numbers: q, its distance from the center of the picture, and c, its angle around the center, like the length and direction of a clock hand. Describing a point this way is called polar coordinates. q·sin(c) and q·cos(c) turn them into steps across and down, and + 200 moves the center to the middle of the 400-pixel sketch. Every line above the last one only works out q and c.', at: ['vec2(q*sin(c)'] },
            { title: 'Two counters from one number', text: 'Each dot knows only its number i. y = i/598 grows slowly, by 1 every 598 dots, so it moves along the body. cos(i/7) swings back and forth fast, once every 44 dots, so k sweeps across the body again and again, like someone shading with a pencil. From these the formula works out e and d; d, from about 1 to 14.5, says where along the body the dot is.', at: ['y = i/598', 'k = (5', 'd = length'] },
            { title: 'Swimming in a circle', text: 'c = d/4 − t/8 + cos(t + e)/9. The d/4 part spreads the body out along the circle, so it is bent into a long arc about half the circle long. The sketch’s time t grows by 2π (about 6.28) every second, so − t/8 moves the whole creature clockwise around the center, once every 8 seconds. cos(t + e)/9 adds a small wiggle, once a second, that reaches different parts of the body at different moments.', at: ['c = d/4'] },
            { title: 'Waves, fins and hairs', text: 'q = 99 + … keeps the body about 99 pixels from the center. d·sin(t − d) adds a wave that runs along the body toward the end where d is big, and it grows bigger there. The last part, y/23·k·(…), pushes dots in and out; it grows with y, so one end of the body stays smooth while the other end sprouts fins and hairs that wave as the sines change.', at: ['q = 99'] },
            { title: 'Light from crowds of dots', text: 'Each dot is faint: it covers only about 38% of what is behind it (the sketch’s alpha, 96 out of 255). Where many dots land on top of each other, their light adds up, so the dense strands glow and the loose hairs look thin and dim.', at: [] }
        ],
        try: [
            { text: 'Draw only the first 3,000 dots. You will see just the smooth tip of the body, because each dot’s number decides where along the body it goes.', set: { param: 'count', value: 3000 } },
            { text: 'Make the body wave four times as strongly.', code: { find: '99 + d*sin(t - d)', replace: '99 + 4*d*sin(t - d)' } },
            { text: 'Make the fins about three times bigger by dividing by 8 instead of 23.', code: { find: 'y/23*k*', replace: 'y/8*k*' } },
            { text: 'Paint the creature gold.', set: { param: 'color', value: '#ffd080' } },
            { text: 'Color only the dots that are moving.', view: 'motion' }
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
        readable: `// Circling twins · ア (@yuruyurau), 18 Sep 2026 · where the sketch puts dot number i
y = i/638                             // y counts slowly: it goes up by 1 every 638 dots, reaching about 31.
k = (3 + cos(y))*sin(i/7) + 1e-4      // k swings fast from side to side, once every 44 dots; + 0.0001 keeps it from being exactly 0.
e = y/5 - 9                           // e turns y into a number from −9 to about −2.7.
d = length(vec2(k, e)) - 3            // d says where along the body the dot sits: from about 0 to 7.
q = 99 + 3*sin(k*3) - d*d*sin(t - d) + y/13*k*(e + sin(d*d - t*3))   // q is the distance from the center: about 99 pixels, plus ripples, a wave along the body, and frills.
c = d/3 - t/4 + (i % 2)*9 + k*k/89    // c is the angle: odd dots (i % 2 = 1) are turned 9 radians further, which makes the twin.
vec2(q*sin(c) + 200, q*cos(c) + 200)  // Turn the distance q and the angle c into a place around the center (200, 200).`,
        level: 'easy',
        summary: 'Two lacy creatures chase each other around the center of the picture, their bodies rippling with frills. Both are drawn by one formula from 20,000 faint dots: it takes each dot’s number i and the time t, and works out where that dot goes. Like the Swimming creature, it first finds each dot’s distance from the center and its angle around it, like the length and direction of a clock hand, and then turns those into a position. The twin comes from one small extra term: every odd-numbered dot is turned 9 radians further around the circle, so the odd dots draw a second copy of the creature about 156 degrees away. The frills come from a wave whose ripples get closer and closer together along the body.',
        tour: [
            { title: 'Two creatures from one formula', text: 'i % 2 is the remainder when i is divided by 2: 0 for even dots and 1 for odd dots. Multiplied by 9, it turns every odd dot 9 radians further around the center (a full turn is about 6.28 radians). 9 radians is almost one and a half turns, so the odd dots draw a second copy of the creature about 156 degrees around the circle: the twin. Even and odd dots take turns, so each twin gets 10,000 dots.', at: ['c = d/3'] },
            { title: 'Circling together', text: 'The rest of the angle, d/3 − t/4 + k²/89, is the same for both twins. d/3 spreads each body out along the circle, so it is bent into an arc. The sketch’s time t grows by π (about 3.14) every second, so − t/4 moves both twins clockwise around the center, once every 8 seconds.', at: ['c = d/3'] },
            { title: 'Waves and frills', text: 'q starts at 99 pixels from the center. − d²·sin(t − d) is a wave that runs along the body and gets much bigger toward the end where d is large, because d² grows fast. y/13·k·(e + sin(d² − 3t)) makes the frills: since d² grows faster and faster, the ripples of sin(d² − 3t) get closer and closer together along the body. 3·sin(3k) adds a small ripple of up to 3 pixels.', at: ['q = 99'] },
            { title: 'Light from crowds of dots', text: 'Each dot is faint: it covers only about 38% of what is behind it (the sketch’s alpha, 96 out of 255). Where the strands of a body cross and pile up, their light adds up and they glow.', at: [] }
        ],
        try: [
            { text: 'Make triplets: use i % 3, which is 0, 1 or 2, and turn by 2.1 radians, about a third of a circle. Three creatures now chase each other.', code: { find: '(i % 2)*9', replace: '(i % 3)*2.1' } },
            { text: 'Make the twins swim the other way around.', code: { find: '- t/4', replace: '+ t/4' } },
            { text: 'Make the small ripple four times bigger (3 → 12 pixels) and watch the bodies turn jagged.', code: { find: '3*sin(k*3)', replace: '12*sin(k*3)' } },
            { text: 'Draw only the first 3,000 dots and see which part of each twin they make.', set: { param: 'count', value: 3000 } },
            { text: 'Color only the dots that are moving.', view: 'motion' }
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
        readable: `// Circling twins, bristled · ア (@yuruyurau), 19 Sep 2026 · where the sketch puts dot number i
y = i/638                             // y counts slowly: it goes up by 1 every 638 dots, reaching about 31.
k = (3 + cos(y))*sin(i/7) + 1e-4      // k swings fast from side to side; + 0.0001 keeps it from being exactly 0, since 9/k below would be infinite.
e = y/5 - 9                           // e turns y into a number from −9 to about −2.7.
d = length(vec2(k, e)) - 3            // d says where along the body the dot sits.
q = 99 + 3*sin(9/k) - d*d*sin(t - d) + y/13*k*(e + sin(d*d - t*3))   // The one change: 3·sin(9/k) instead of 3·sin(3k). Near k = 0 it jumps wildly, which makes bristles.
c = d/3 - t/4 + (i % 2)*9 + k*k/89    // c is the angle: odd dots are turned 9 radians further, which makes the twin.
vec2(q*sin(c) + 200, q*cos(c) + 200)  // Turn the distance q and the angle c into a place around the center (200, 200).`,
        level: 'easy',
        summary: 'These are the same two creatures as in Circling twins, but now they are covered in fine, bristly fuzz. The formula is exactly the Circling twins formula with one small term changed: 3·sin(9/k) instead of 3·sin(3k). k swings from side to side across each body, so it is very close to 0 along the middle of the body. There 9/k is huge and jumps to very different values from one dot to the next, so its sine jumps between −1 and 1 almost at random. That scatters neighboring dots up to 3 pixels in and out, and the scattered dots look like bristles. Open the two scenes one after the other to see how much one small term can change.',
        tour: [
            { title: 'One term changed', text: 'Compare the q line with the Circling twins: 3·sin(3k) became 3·sin(9/k). Where k is far from 0, 9/k changes smoothly, and the term is a gentle ripple, as before. But along the middle of each body k is tiny, so 9/k is huge and jumps to very different values from one dot to the next, and its sine swings between −1 and 1 almost at random. The dots there scatter up to 3 pixels in and out, which looks like bristles.', at: ['q = 99'] },
            { title: 'Why + 0.0001', text: 'k = (3 + cos y)·sin(i/7) + 0.0001. For dot number 0, sin(0) is exactly 0, and 9 ÷ 0 would be infinite, which would break that dot. Adding 0.0001 keeps k away from exactly 0. The Circling twins has the same tiny number, but there it makes no difference, because nothing divides by k.', at: ['k = (3'] },
            { title: 'Circling together', text: 'Everything else is the same as in Circling twins. Odd dots are turned 9 radians further around the center, which makes the twin, and − t/4 moves both twins clockwise around the center, once every 8 seconds.', at: ['c = d/3'] }
        ],
        try: [
            { text: 'Make the bristles three times longer: change 3 to 9 in front of sin(9/k).', code: { find: '3*sin(9/k)', replace: '9*sin(9/k)' } },
            { text: 'Divide 90 by k instead of 9, and the fuzz spreads over much more of each body.', code: { find: 'sin(9/k)', replace: 'sin(90/k)' } },
            { text: 'Make each dot fainter (opacity 0.1), so that only the densest strands stay bright.', set: { param: 'alpha', value: 0.1 } },
            { text: 'Color only the dots that are moving.', view: 'motion' }
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
// This is Equation Studio's own one-pass attempt at the look: a ball of glowing fibers in deep water.
param radius = .45 [.2, .7] step .01    // The radius of the ball.
param fibers = 13 [4, 40] step 1        // Fibers along each side of each of the six cube faces (6 × fibers² in all).
param width = .13 [.03, .45] step .005  // How thick a fiber is, compared with the spacing between fibers.
param sway = .5 [0, 2] step .01         // How strongly the fibers wave in the current.
param glow = 1 [0, 3] step .01          // How brightly the fibers glow.
vec2 uv = (FC.xy - .5*r)/r.y;          // The pixel's position: 0 in the center, and the image is 1 high.
vec3 ray = vec3(0, 0, -2.2), dir = normalize(vec3(uv, 1.8));   // The camera, 2.2 units from the ball's center, and this pixel's direction.
o.rgb = vec3(.02, .035, .08)*(1.2 - .8*length(uv));   // Deep blue water behind, darker toward the corners.
float through = 1.;                    // How much of what lies behind still shows through (1 means all of it).
for (float i = 0.; i < 90.; i++) {     // 90 slices through the ball, front to back
  vec3 p = ray + dir*(2.2 - radius*1.4 + i*radius*2.8/90.);   // The point where the ray crosses this slice.
  float R = length(p);                 // Its distance from the center of the ball.
  if (R > radius*1.3) continue;        // Outside the ball there is nothing to add: go on to the next slice.
  vec3 q = p*rotate3D(sway*R*R*sin(t*.333 + R*5.), vec3(sin(t*.667), 1, .4));   // Bend: turn the point more the farther out it is, swaying with time.
  vec3 n = normalize(q), a = abs(n);   // The direction from the center, and how big it is along each axis.
  vec2 face = a.x > a.y && a.x > a.z ? n.yz/a.x : a.y > a.z ? n.xz/a.y : n.xy/a.z;   // Where that direction hits a cube around the ball, on the face it hits.
  float side = a.x > a.y && a.x > a.z ? sign(n.x) : a.y > a.z ? 2.*sign(n.y) : 3.*sign(n.z);   // Which of the six faces that is.
  vec2 cell = floor(face*fibers), f = face*fibers - cell;   // A grid on the face, with one fiber in each square.
  float near = 9., seed = 0.;          // The distance to the nearest fiber (in squares), and that fiber's random number.
  for (int k = 0; k < 9; k++) {        // Check this square and its 8 neighbors
    vec2 c = vec2(k%3 - 1, k/3 - 1), id = cell + c + side*17.;   // Which neighbor, and a number that names its square.
    vec2 jitter = vec2(fsnoise(id), fsnoise(id + 5.3));   // A random spot for the fiber inside its square.
    float d = length(f - c - .15 - .7*jitter);   // The distance to that fiber.
    if (d < near) { near = d; seed = fsnoise(id + 9.1); }   // Keep the nearest fiber and its random number.
  }
  float along = R/(radius*(.7 + .45*seed));   // 0 at the center and 1 at this fiber's tip (each fiber has its own length).
  float fiber = exp(-near*near/(width*width))*(1. - smoothstep(.85, 1.05, along));   // How much fiber is here: a lot on a fiber, fading out at its tip.
  float bead = exp(-near*near/(width*width*2.))*exp(-(along - .95)*(along - .95)*300.);   // A bright bead at the tip.
  float core = exp(-R*R/(radius*radius*.05));   // A soft glow at the core.
  vec3 color = mix(vec3(.3, .42, 1.), vec3(.55, .95, 1.), smoothstep(-.3, .8, n.y*.7 + n.x*.5));   // Blue, turning cyan toward the upper right …
  color = mix(color, vec3(1., .42, .72), smoothstep(.4, 1., along)*(1. - smoothstep(-.9, .1, n.x*.8 - n.y*.3)));   // … pink tips on the left …
  color = mix(color, vec3(.45, .3, 1.), (1. - smoothstep(-.9, -.1, n.y))*.6);   // … violet underneath …
  color = mix(vec3(.8, .95, 1.), color, smoothstep(.05, .35, along));   // … and white where the fibers meet at the core.
  o.rgb += through*glow*(fiber*.16 + bead*.3 + core*.05)*color;   // Add this slice's light, dimmed by the fibers in front of it.
  through *= 1. - min(fiber*.12, .5);  // Fibers hide part of whatever lies behind them.
}`,
        level: 'expert',
        summary: 'A round ball of glowing fibers floats in deep blue water, blue and cyan with pink tips, swaying gently as if in a current. This one is different from the other works: the artist, Jae, posted only a video, not the code, so the code here is our own attempt to rebuild the look, not the artist’s program. It is a shader, a small program that runs for every pixel, but there is no solid surface for its rays to hit. Instead, each pixel’s ray (an imaginary line from the camera) takes 90 thin slices through the ball, like a stack of tracing paper, and at each slice adds the light of any fiber passing through it. The fibers are placed by pointing directions at the six faces of a cube and scattering one fiber at a random spot in each square of a grid on each face. Fibers in front partly hide the ones behind, so the ball looks dense in the middle and wispy at the edge.',
        tour: [
            { title: 'Slices through a cloud of fibers', text: 'The other 3D works in this gallery look for the surface a ray hits. This ball has no surface: it is a volume, like fog or cotton candy. So each pixel’s ray takes 90 evenly spaced samples, or slices, straight through the ball and adds the light given off at each one. This step stops loop 1 after 30 slices, so you see only the front third of the ball.', at: ['for (float i', 'vec3 p = ray'], steps: { 1: 30 } },
            { title: 'Fibers from a cube', text: 'Every fiber points straight out from the center, so a fiber is really a direction. To spread about a thousand directions evenly, the code imagines a cube around the ball: it finds which of the six faces the direction points at and where on that face it lands. Each face is divided into a grid of fibers × fibers squares (13 × 13 at first), and each square holds one fiber at a random spot; fsnoise gives the random numbers. near is the distance to the closest fiber, found by checking this square and its 8 neighbors, and seed is that fiber’s own random number.', at: ['vec2 face', 'vec2 cell', 'if (d < near)'], show: 'near' },
            { title: 'Swaying in the current', text: 'rotate3D, a helper that turns a point around an axis, turns the point by the angle sway·R²·sin(0.333t + 5R). R² makes the turn tiny near the center and bigger toward the outside, so the fibers stay fixed in the middle and bend toward their tips. The sine changes with time and with R, so the bend moves along the fibers like hair waving in water. The axis wobbles too, because its first part is sin(0.667t).', at: ['vec3 q = p*rotate3D'] },
            { title: 'Tips and colors', text: 'along is R divided by the fiber’s length: 0 at the center and 1 at the tip. seed gives each fiber its own length, between 0.7 and 1.15 times the ball’s radius. The fiber fades out just past its tip, and a bright bead sits where along is 0.95. The color depends on the direction: blue, turning cyan toward the upper right, pink tips on the left, violet underneath, and white near the core where the fibers meet.', at: ['float along', 'float bead', 'vec3 color'], show: 'along' },
            { title: 'Seeing through the fluff', text: 'through starts at 1, meaning everything behind still shows. Each slice multiplies it by 1 − fiber·0.12 (but never by less than 0.5), so every fiber the ray passes dims whatever lies behind it. The light from each slice is multiplied by through, so fibers in front partly hide the ones behind: the ball looks dense in the middle and wispy at the edges.', at: ['through *='], show: 'through' }
        ],
        try: [
            { text: 'Set fibers to 5: only 150 thick spikes, and you can see each one.', set: { param: 'fibers', value: 5 } },
            { text: 'Make the fibers thicker (width 0.3), and the ball turns into a soft, glowing puff.', set: { param: 'width', value: 0.3 } },
            { text: 'Turn the current up: sway 2 makes the fibers bend four times as much.', set: { param: 'sway', value: 2 } },
            { text: 'Give the fibers golden tips instead of pink ones.', code: { find: 'vec3(1., .42, .72)', replace: 'vec3(1., .75, .15)' } },
            { text: 'Build the ball slice by slice, from the front to the back.', build: 1 }
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
