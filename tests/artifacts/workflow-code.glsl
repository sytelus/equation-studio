// Vortex: Xor (@XorDev), 19 Nov 2023 · https://x.com/XorDev/status/1726103550986469869
// Shader code from Equation Studio. Paste into twigl.app, mode "geekest (300 es)".
// Vortex · Xor (@XorDev), 19 Nov 2023 · readable version, same image
vec2 p = (FC.xy*2. - r)/r.y, v;       // The pixel's position: 0 in the center, and the image is 2 high.
for (float i = .2, l; i < 1.;) {      // 16 rings, radius i = 0.2 to 0.95
  float angle = mod(atan(p.y, p.x) + i + i*t, PI2) - PI;   // The pixel's angle around the center, turned by i and spinning at speed i.
  v = vec2(angle, 1)*length(p) - i;   // v.y is how far the pixel is outside ring i; v.x measures along the ring.
  v.x -= clamp(v.x += i, -i, i);      // Make v.x zero all along an arc 2i long, so only the arc glows.
  i += .05;                           // Move on to the next ring (the color below already uses the new i).
  o += (cos(i*5. + vec4(0, 1, 2, 3)) + 1.)*(1. + v.y/(l = length(v) + .003))/l/1e2;   // Glow: 1 ÷ distance, colored by the ring, lit only outside the arc.
}
o = tanh(o);                          // Squeeze the brightness into 0 to 1, so bright spots fade smoothly into white.
