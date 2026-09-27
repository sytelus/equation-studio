// Vortex: Xor (@XorDev), 19 Nov 2023 · https://x.com/XorDev/status/1726103550986469869
// Shader code from Equation Studio. Paste into twigl.app, mode "geekest (300 es)".
// Vortex · Xor (@XorDev), 19 Nov 2023 · readable version, same image
vec2 p = (FC.xy*2. - r)/r.y, v;       // this pixel: the center is 0, the image 2 high
for (float i = .2, l; i < 1.;) {      // 16 rings of radius i = .2, .25, … , .95
  float angle = mod(atan(p.y, p.x) + i + i*t, PI2) - PI;   // angle around the center, turned by i and spinning at speed i
  v = vec2(angle, 1)*length(p) - i;   // (distance along the ring, distance from the ring)
  v.x -= clamp(v.x += i, -i, i);      // … measured from an arc 2i long instead of the whole ring
  i += .05;                           // (the color below already uses the next ring's i)
  o += (cos(i*5. + vec4(0, 1, 2, 3)) + 1.)*(1. + v.y/(l = length(v) + .003))/l/1e2;   // neon glow ~ 1/distance, colored by i, brighter outside the arc
}
o = tanh(o);                          // soft clip: bright cores keep their color
