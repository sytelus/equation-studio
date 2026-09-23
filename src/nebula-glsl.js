/** GPU port of the supplied Bipolar Nebula equations, not a look-alike replacement.
 * Reference: reference/nebula_rewrite/docs/FORMULA_REFERENCE.md.
 * Parameter defaults retain 27 shells, 50 + 50 texture bands, and 30 star lattices.
 * Floats/transcendentals differ from the float64 CPU oracle; see validation report.
 */
import { sourceConstantsGLSL } from './source-constants.js';
export const nebulaGLSL = sourceConstantsGLSL + `
struct Geometry { float warp; float rim; float coverage; };
Geometry nebulaGeometry(vec2 p,float pinch,float shear,float shells) {
 float remain=1.0, warp=0.0, rim=0.0;
 for(int i=1;i<=27;i++) {
  if(float(i)>shells) break;
  float s=float(i);
  vec3 shell=sourceShell[i];
  float radius=shell.x;
  float u=p.x+(shear+shell.y)*p.y+0.0001;
  float v=p.y-(shear+shell.z)*p.x;
  float denominator=pow(abs(u),pinch);
  float L;
  // Match the explicit undefined-coordinate convention of the Python reference.
  if(denominator==0.0) L=(v==0.0)?-radius:1e10;
  else L=length(vec2(u,2.0*pow(radius,pinch)*v/denominator))-radius;
  float J=cutoff(25.0-50.0*s)*cutoff(10.0*L);
  float weight=remain*J;
  if(weight>0.0) warp+=2.0*weight*L;
  rim+=0.25*weight*cutoff(0.15*(s-23.0))*cutoff(-3.0*L);
  remain*=1.0-J;
 }
 return Geometry(warp,rim,1.0-remain);
}
Geometry ringGeometry(vec2 p,float radius,float width,float flatten) {
 float d=length(vec2(p.x,p.y*flatten))-radius;
 float ring=gaussian(d,width);
 return Geometry(2.0*d,0.22*ring,ring);
}
float nebulaTurbulence(vec2 p,Geometry g,float bands,float motion) {
 float E=0.0;
 for(int i=1;i<=50;i++) {
  if(float(i)>bands) break;
  float frequency=sourceFrequencies[i].x, weight=sourceFrequencies[i].z;
  float Q=dot(p,sourceRotation15[i]), S=g.warp;
  vec2 d7=sourceDirection7[i], d4=sourceDirection4[i], d8=sourceDirection8[i];
  vec4 phase=sourceTurbulencePhase[i];
  float a=frequency*(d7.x*S+d7.y*Q+phase.x);
  float b=4.0*cos(frequency*(d4.x*S+d4.y*Q));
  float c=frequency*(d7.x*Q-d7.y*S+phase.y);
  float d=4.0*cos(frequency*(d8.x*S+d8.y*Q));
  E+=weight*cos(a+b+phase.z+motion)*cos(c+d+phase.w-motion);
 }
 return E;
}
vec4 nebulaCloud(vec2 p,Geometry g,float E,float bands,float detail) {
 vec3 K=vec3(0);
 for(int i=1;i<=50;i++) {
  if(float(i)>bands) break;
  float frequency=sourceFrequencies[i].y, weight=sourceFrequencies[i].z;
  float c=sourceRotation15[i].x,b=sourceRotation15[i].y;
  float Q=p.x*c+p.y*b;
  float cell=cos(frequency*(c*g.warp+b*Q)+sourcePhase27_28[i].x)
            *cos(frequency*(c*Q-b*g.warp)+sourcePhase27_28[i].y);
  float Z=cell-1.25+2.0*g.rim+E/7.0;
  float I=45.0*detail*cutoff(-4.0*Z)+6.0*cutoff(-0.25*Z);
  // Preserve individual negative blue coefficients until final output conversion.
  K+=I*weight*sourceCloudColor[i];
 }
 return vec4(K,1);
}
float nebulaCoreMask(vec2 p,float E) { return cutoff(10.0*length(p)-1.0+E/4.0); }
vec4 nebulaGas(vec2 p,Geometry g,float E,vec4 cloud,float gain) {
 float W=nebulaCoreMask(p,E); return vec4(1.1*(1.0-W)*cloud.rgb*g.rim*gain,1);
}
vec4 nebulaCore(vec2 p,float E,float gain) { return vec4(vec3(2,2,3)*nebulaCoreMask(p,E)*gain,1); }
vec4 nebulaStars(vec2 p,float bands,float gain) {
 vec3 color=vec3(0);
 for(int i=1;i<=30;i++) {
  if(float(i)>bands) break;
  float s=float(i),k=s*s;
  vec3 lattice=sourceStarLattice[i];
  float frequency=lattice.x, c=sourceRotation15[i].x,b=sourceRotation15[i].y;
  float P=p.y*c-p.x*b,Q=p.x*c+p.y*b;
  float M=acos(clamp(cos(frequency*(lattice.y*P+lattice.z*Q)+sourcePhase27_28[i].x),-1.0,1.0));
  float N=acos(clamp(cos(frequency*(lattice.y*Q-lattice.z*P)+sourcePhase27_28[i].y),-1.0,1.0));
  float theta=(M==0.0 && N==0.0)?0.0:atan(M,N);
  float B=cutoff(5.0*cos(20.0*theta+2.0*cos(9.0*theta+k))+3.75);
  float radius2=M*M+N*N;
  float center=4.0*cutoff(200.0*(radius2-0.00125-B/200.0));
  float halo=cutoff(20.0*radius2-0.14);
  vec3 v=vec3(0,1,2); float parity=(i%2==0)?1.0:-1.0;
  color+=(center+halo)*(v*v-2.0*v+4.0+(v-1.0)*parity)/4.0;
 }
 return vec4(color*gain,1);
}
`;
