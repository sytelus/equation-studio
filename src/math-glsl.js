/** Shared analytic atoms. GLSL ES 3.00, highp float. No image textures or RNG state. */
export const mathGLSL = `
const float PI = 3.141592653589793;
const float TAU = 6.283185307179586;
float sq(float x) { return x*x; }
float sat(float x) { return clamp(x, 0.0, 1.0); }
// The output exp(-exp(x)) remains finite even when the inner exponential would overflow.
float cutoff(float x) { return exp(-exp(clamp(x, -80.0, 6.0))); }
vec3 cutoff3(vec3 x) { return exp(-exp(clamp(x, vec3(-80.0), vec3(6.0)))); }
float angleOf(vec2 p) { return dot(p,p)<1e-20 ? 0.0 : atan(p.y,p.x); }
vec2 rotate2(vec2 p, float a) { float c=cos(a), s=sin(a); return vec2(c*p.x-s*p.y,s*p.x+c*p.y); }
float softInside(float d, float edge) { return 1.0-smoothstep(-edge,edge,d); }
float gaussian(float d, float w) { return exp(-sq(d/max(w,1e-5))); }
float segmentDistance(vec2 p, vec2 a, vec2 b) {
 vec2 d=b-a; return length(p-a-d*clamp(dot(p-a,d)/max(dot(d,d),1e-10),0.0,1.0));
}
// Deterministic hash: seeds define repeatable content; this is not a noise texture.
float hash21(vec2 p) { vec3 q=fract(vec3(p.xyx)*vec3(0.1031,0.1030,0.0973)); q+=dot(q,q.yzx+33.33); return fract((q.x+q.y)*q.z); }
vec2 hash22(vec2 p) { return vec2(hash21(p),hash21(p+vec2(37.0,19.0))); }
float noise2(vec2 p) {
 vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
 return mix(mix(hash21(i),hash21(i+vec2(1,0)),f.x),mix(hash21(i+vec2(0,1)),hash21(i+vec2(1,1)),f.x),f.y);
}
float fbm(vec2 p, float octaves) {
 float s=0.0,a=0.5, norm=0.0;
 for(int i=0;i<8;i++) { if(float(i)>=octaves) break; s+=a*noise2(p); norm+=a; p=rotate2(p,0.51)*2.03+vec2(11.3,7.1); a*=0.5; }
 return s/max(norm,0.001);
}
vec2 domainWarp(vec2 p, float amplitude, float frequency, float time) {
 return p+amplitude*(vec2(fbm(p*frequency+vec2(time,0),5.0),fbm(p*frequency+vec2(9.2,-time),5.0))-0.5);
}
vec2 vortex(vec2 p, float strength, float radius, float phase) {
 float r=length(p); return rotate2(p,strength*exp(-sq(r/max(radius,0.01)))+phase);
}
// Fold the angle into mirrored sectors of width 2*PI/sectors; the radius is unchanged.
vec2 angularMirror(vec2 p, float sectors, float phase) {
 float sector=TAU/max(sectors,1.0);
 float a=abs(mod(angleOf(p)+phase+0.5*sector,sector)-0.5*sector);
 return length(p)*vec2(cos(a),sin(a));
}
vec3 spectrum(float x, float shift) { return 0.5+0.5*cos(TAU*(x+shift+vec3(0.0,0.33,0.67))); }
vec4 addLight(vec4 a, vec4 b, float gain) { return vec4(a.rgb+gain*b.rgb,max(a.a,b.a)); }
// Inputs are STRAIGHT (unpremultiplied) RGB. Preserve straight RGB at the output.
vec4 overLayer(vec4 front, vec4 back) {
 float a=front.a+back.a*(1.0-front.a);
 return vec4((front.rgb*front.a+back.rgb*back.a*(1.0-front.a))/max(a,1e-8),a);
}
vec3 displayColor(vec3 radiance,float exposure,int mode) {
 vec3 h=radiance*exposure;
 if(mode==0) { // Original F, including floor; do not insert gamma here.
   vec3 f=255.0*cutoff3(-1000.0*h)*pow(max(abs(h),vec3(1e-30)),cutoff3(1000.0*(h-1.0)));
   return clamp(floor(f),vec3(0),vec3(255))/255.0;
 }
 if(mode==1) return pow(1.0-exp(-max(h,vec3(0))),vec3(1.0/2.2));
 return clamp(h,vec3(0),vec3(1));
}
`;
