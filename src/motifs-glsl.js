/** New analytic constructions inspired by the requested SUBJECTS, not transcriptions
 * of unretrieved formula sheets. Each returns straight RGB radiance plus coverage.
 * Reusable kernels (feather, clusterLens, galaxy, vortex, capsule) are shared.
 * These are illustrations, not weather, MHD, radiative-transfer, or GR simulations.
 */
export const motifsGLSL = `
vec4 scatterStars(vec2 p,float density,float gain,float seed,float time) {
 vec3 rgb=vec3(0);
 for(int layer=0;layer<3;layer++) {
  float scale=density*(1.0+float(layer)*0.71);
  vec2 q=p*scale, cell=floor(q), local=fract(q);
  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++) {
   vec2 id=cell+vec2(x,y), h=hash22(id+seed+float(layer)*23.0);
   vec2 d=local-vec2(x,y)-0.12-0.76*h;
   float chance=hash21(id+seed+94.0+float(layer)*17.0);
   float size=mix(0.012,0.052,pow(h.x,7.0));
   float core=gaussian(length(d),size), glow=0.018*gaussian(length(d),size*6.0);
   float spikes=0.03*exp(-abs(d.x*d.y)*1800.0)*gaussian(length(d),0.18)*pow(h.x,18.0);
   float bright=mix(0.15,1.8,pow(h.y,5.0))*(0.88+0.12*sin(time+h.x*TAU));
   rgb+=(core+glow+spikes)*mix(vec3(0.57,0.73,1),vec3(1,0.80,0.63),h.y)*bright*step(0.60,chance);
  }
 }
 return vec4(rgb*gain,1);
}
// Multiple localized rotations on the visible sphere create cyclone coordinates.
vec2 cycloneDomain(vec2 uv,float twist,float time) {
 vec2 q=uv;
 for(int i=0;i<7;i++) {
  float k=float(i);
  vec2 center=vec2(sin(k*6.1+0.3)*1.08,cos(k*9.3+0.7)*0.77);
  vec2 d=q-center;
  q=center+vortex(d,twist*(0.8+0.2*sin(k))*((i%2==0)?1.0:-1.0),0.27+0.07*sin(k*2.3),0.0);
 }
 return q+vec2(time*0.025,0);
}
vec4 waterPlanet(vec2 p,float radius,float cloudCover,float stormTwist,float lightAngle,float time) {
 vec2 d=p/radius; float r2=dot(d,d);
 float mask=softInside(length(d)-1.0,0.004);
 if(r2>1.04) return vec4(0);
 float z=sqrt(max(1.0-r2,0.0));
 vec3 normal=normalize(vec3(d,z));
 vec2 uv=vec2(asin(clamp(d.x/max(sqrt(max(1.0-d.y*d.y,0.0)),0.001),-1.0,1.0)),asin(clamp(d.y,-1.0,1.0)));
 uv=cycloneDomain(uv,stormTwist,time);
 vec2 warped=domainWarp(uv*3.0,0.35,1.2,time*0.015);
 float n=fbm(warped*2.0,7.0);
 float striation=0.5+0.5*sin(uv.y*90.0+fbm(uv*14.0,5.0)*15.0);
 float cloud=smoothstep(0.62-cloudCover*0.30,0.79-cloudCover*0.28,n+striation*0.10);
 vec3 sun=normalize(vec3(cos(lightAngle),0.35,sin(lightAngle)));
 float diffuse=max(dot(normal,sun),0.0);
 vec3 ocean=mix(vec3(0.008,0.020,0.08),vec3(0.016,0.18,0.32),n);
 vec3 color=mix(ocean,vec3(0.80,0.9,1.0),cloud)*(0.06+diffuse);
 float spec=pow(max(dot(reflect(-sun,normal),vec3(0,0,1)),0.0),60.0)*(1.0-cloud);
 color+=vec3(0.38,0.55,0.70)*spec;
 color+=vec3(0.03,0.19,0.39)*pow(1.0-z,5.0)*sqrt(max(diffuse,0.0));
 return vec4(color,mask);
}
vec4 atmosphere(vec2 p,float radius,float strength) {
 float d=length(p)-radius;
 float a=gaussian(d,0.025)+0.18*gaussian(d,0.07);
 return vec4(vec3(0.08,0.25,0.55)*a*strength,clamp(a,0.0,1.0));
}
// Softened dimensionless thin-lens map: beta=theta-sum(m*d/(|d|²+eps²)).
// Nonzero eps is a numerical/artistic modification of the singular point lens.
vec2 lensCenter(int i) {
 float s=float(i); float angle=s*2.399963+0.23;
 float r=(i==0)?0.0:0.28+0.085*sqrt(s);
 return vec2(cos(angle),sin(angle))*r;
}
vec2 clusterLens(vec2 p,float strength,float count,float softening) {
 vec2 beta=p;
 for(int i=0;i<12;i++) {
  if(float(i)>=count) break;
  vec2 d=p-lensCenter(i);
  float mass=(i==0?0.18:0.024)*strength;
  beta-=mass*d/(dot(d,d)+softening*softening);
 }
 return beta;
}
vec4 clusterLights(vec2 p,float gain,float count) {
 vec3 c=vec3(0);
 for(int i=0;i<12;i++) {
  if(float(i)>=count) break;
  vec2 d=p-lensCenter(i);
  float star=1.8*gaussian(length(d),0.014)+0.14*gaussian(length(d),0.055);
  star+=0.022*gaussian(d.x,0.0025)*gaussian(d.y,0.16)+0.022*gaussian(d.y,0.0025)*gaussian(d.x,0.16);
  c+=star*mix(vec3(0.70,0.84,1),vec3(1,0.83,0.57),0.5+0.5*sin(float(i)));
 }
 return vec4(c*gain,1);
}
vec4 spiralGalaxy(vec2 p,float arms,float pitch,float radius,float dust,float time) {
 vec2 q=rotate2(p,0.35); q.y*=1.42;
 float r=length(q)/radius, a=angleOf(q);
 float phase=arms*a-pitch*log(r+0.10)-time*0.10;
 float n=fbm(q*8.0+0.3,6.0);
 float arm=pow(0.5+0.5*cos(phase+(n-0.5)*1.1),8.0);
 float envelope=exp(-r*1.65)*softInside(r-2.3,0.3);
 float lanes=smoothstep(0.44,0.7,fbm(q*19.0,6.0));
 vec3 diffuse=mix(vec3(0.24,0.09,0.12),vec3(0.20,0.44,0.77),sat(r*0.8));
 vec3 c=diffuse*(0.17+arm*(0.6+n))*envelope*(1.0-dust*lanes);
 c+=vec3(1,0.72,0.40)*exp(-r*r*24.0)*1.2;
 c+=vec3(0.64,0.51,1.0)*pow(n,10.0)*arm*envelope*2.5;
 return vec4(c,1);
}
vec4 auroraVortex(vec2 p,float turns,float width,float curtain,float time) {
 // An asymmetric projected spiral, with long ray-like striations across the ribbon.
 vec2 q=p-vec2(-0.10,0.16); q.y*=1.15;
 float r=length(q),a=angleOf(q);
 float phase=a+turns*log(r+0.12)+time*0.18;
 float distort=(fbm(q*3.5+vec2(0,time*0.025),5.0)-0.5)*0.30;
 float wave=sin(phase+distort);
 float ribbon=gaussian(wave,width)*(1.0-exp(-r*8.0))*exp(-r*0.70);
 float fine=0.28+0.72*pow(0.5+0.5*sin(a*175.0+fbm(q*7.0,5.0)*20.0+time*0.3),2.0);
 float top=gaussian(wave+0.11,width*1.6);
 vec3 c=vec3(0.05,0.86,0.22)*ribbon*(0.4+curtain*fine);
 c+=vec3(0.47,0.08,0.42)*top*0.15*exp(-r*0.85);
 c+=vec3(0.17,0.54,0.35)*gaussian(wave,width*3.5)*0.10*exp(-r);
 return vec4(c,1);
}
vec4 accretionDisk(vec2 p,float radius,float inclination,float spin,float time) {
 vec2 q=rotate2(p,-0.28); float r=length(vec2(q.x,q.y*inclination));
 float a=angleOf(vec2(q.x,q.y*inclination));
 float rings=0.5+0.5*sin(r*90.0+4.0*sin(a*3.0+spin*log(r+0.1)-time*0.8));
 float envelope=gaussian(r-radius*1.65,radius*0.65)*smoothstep(radius*1.03,radius*1.30,r);
 float Doppler=0.6+0.4*cos(a+1.0);
 vec3 c=mix(vec3(0.72,0.14,0.015),vec3(1,0.80,0.40),rings)*envelope*(0.2+1.8*Doppler);
 // Illustrative bent rear arc, NOT numerical null-geodesic integration.
 float arc=gaussian(length(vec2(p.x,p.y*0.98))-radius*1.04,0.022)*smoothstep(-0.05,0.05,p.y);
 c+=vec3(1,0.64,0.22)*arc*0.9;
 float hole=smoothstep(radius*0.86,radius*0.94,length(p));
 c*=hole;
 c+=vec3(1,0.38,0.08)*gaussian(length(p)-radius*0.94,0.007)*0.45;
 return vec4(c,1);
}
vec4 tidalStream(vec2 p,float stretch,float starSize,float time) {
 float u=clamp((p.x+0.05)/1.65,0.0,1.0);
 float center=0.14+0.40*u*u+0.05*sin(5.0*u-time*0.25);
 float w=mix(0.015,starSize,pow(u,stretch));
 float stream=gaussian(p.y-center,w)*smoothstep(-0.15,0.18,p.x)*(1.0-smoothstep(1.55,1.80,p.x));
 float fibers=0.6+0.4*sin(170.0*(p.y-center)+12.0*p.x-time);
 vec2 starCenter=vec2(1.53,0.14+0.40*sq(1.53/1.65)+0.05*sin(5.0*1.53/1.65-time*0.25));
 float star=gaussian(length(p-starCenter),starSize)*2.4;
 float glow=gaussian(length(p-starCenter),starSize*2.8)*0.14;
 return vec4(vec3(0.57,0.77,1.0)*stream*fibers+vec3(0.84,0.94,1.0)*star+vec3(0.13,0.34,0.85)*glow,1);
}
// One local feather. Local y runs from base (0) to tip (1); reuse it as a stamp.
vec4 feather(vec2 p,float width,float eyeScale,float time) {
 float v=p.y; float w=width*pow(max(sin(PI*clamp(v,0.0,1.0)),0.0),0.55);
 float silhouette=softInside(abs(p.x)-w,0.003)*smoothstep(0.0,0.05,v)*(1.0-smoothstep(0.96,1.02,v));
 float barbs=0.25+0.75*pow(0.5+0.5*cos(250.0*(v+abs(p.x)*1.3)+0.4*sin(time)),3.0);
 vec3 c=mix(vec3(0.03,0.13,0.10),vec3(0.18,0.52,0.34),barbs);
 vec2 ep=vec2(p.x/(width*0.76*eyeScale),(v-0.79)/(0.107*eyeScale));
 float e=length(ep);
 c=mix(c,vec3(0.46,0.43,0.12),1.0-smoothstep(0.85,1.0,e));
 c=mix(c,vec3(0.05,0.59,0.50),1.0-smoothstep(0.66,0.77,e));
 c=mix(c,vec3(0.10,0.18,0.60),1.0-smoothstep(0.47,0.56,e));
 c=mix(c,vec3(0.008,0.027,0.065),1.0-smoothstep(0.32,0.39,e));
 c+=vec3(0.28,0.66,0.66)*gaussian(e-0.65,0.016)*0.7;
 c+=vec3(0.14,0.22,0.11)*gaussian(p.x,0.0018)*(1.0-smoothstep(0.72,0.82,v));
 return vec4(c,silhouette);
}
vec4 peacockFan(vec2 p,float spread,float rows,float width,float time) {
 vec4 result=vec4(0);
 vec2 base=vec2(0,-0.91);
 // Outer rows first. Each feather is an instance of the same local kernel.
 for(int row=0;row<4;row++) {
  if(float(row)>=rows) break;
  float rr=float(row), len=2.12-0.26*rr;
  int count=23-row*3;
  for(int i=0;i<23;i++) {
   if(i>=count) break;
   float f=float(i)/float(count-1);
   float a=(f-0.5)*spread+0.015*sin(float(i)*1.8+time*0.45)*(1.0-abs(f-0.5));
   vec2 q=rotate2(p-base,a)/len;
   q.x+=0.008*sin(q.y*3.0+float(i)+time*0.4)*q.y;
   vec4 stamp=feather(q,width,1.0,time);
   stamp.rgb*=1.0-rr*0.08;
   result=overLayer(stamp,result);
  }
 }
 return result;
}
vec4 peacockBody(vec2 p,float size) {
 vec2 q=p/size;
 float body=softInside(length(vec2(q.x/0.18,(q.y+0.78)/0.33))-1.0,0.02);
 float neckX=-0.035+0.047*sin((q.y+0.45)*5.0);
 float neck=softInside(abs(q.x-neckX)-0.063,0.006)*smoothstep(-0.85,-0.62,q.y)*(1.0-smoothstep(0.03,0.08,q.y));
 float head=softInside(length((q-vec2(-0.044,0.058))/vec2(0.11,0.085))-1.0,0.03);
 float mask=max(body,max(neck,head));
 vec3 c=mix(vec3(0.004,0.02,0.20),vec3(0.02,0.26,0.56),sat((q.x+0.16)/0.32));
 float eye=gaussian(length(q-vec2(-0.08,0.075)),0.013);
 c=mix(c,vec3(0.004),eye); c+=vec3(0.7)*gaussian(length(q-vec2(-0.084,0.08)),0.004);
 float beak=softInside(segmentDistance(q,vec2(-0.12,0.035),vec2(-0.19,0.004))-0.012,0.003);
 c=mix(c,vec3(0.52,0.48,0.34),beak); mask=max(mask,beak);
 for(int i=0;i<5;i++) {
  float a=-0.3+float(i)*0.15;
  vec2 end=vec2(-0.03,0.1)+vec2(sin(a),cos(a))*0.16;
  float stem=gaussian(segmentDistance(q,vec2(-0.03,0.1),end),0.0035);
  float tip=gaussian(length(q-end),0.012);
  c=mix(c,vec3(0.04,0.39,0.43),max(stem,tip)); mask=max(mask,max(stem,tip));
 }
 return vec4(c,mask);
}
vec4 firePlume(vec2 p,float height,float width,float turbulence,float time) {
 vec2 q=vec2(p.x/width,(p.y+1.05)/height);
 float h=sat(q.y);
 vec2 uv=domainWarp(vec2(q.x*2.0,q.y*3.8-time*0.30),0.75*turbulence,2.0,0.05*time);
 float n=fbm(uv*2.3,7.0), fine=fbm(uv*6.0,5.0);
 float taper=0.7*pow(max(1.0-q.y,0.0),0.63);
 float edge=abs(q.x+0.15*sin(q.y*9.0-time*0.6))-(taper+(n-0.5)*0.65*turbulence);
 float flame=softInside(edge,0.13)*(1.0-smoothstep(0.92,1.1,q.y))*smoothstep(-0.08,0.04,q.y);
 float heat=clamp(flame*(1.25-h*0.65)*(0.6+n),0.0,1.0);
 vec3 c=mix(vec3(0.7,0.016,0.001),vec3(1.2,0.30,0.008),sat(heat*1.9));
 c=mix(c,vec3(1.8,1.0,0.12),smoothstep(0.58,0.92,heat));
 c=mix(c,vec3(2.8,2.1,1.0),smoothstep(0.87,1.0,heat));
 c*=flame*(0.70+0.6*fine);
 c+=vec3(0.10,0.009,0.001)*gaussian(q.x,0.7)*gaussian(q.y-0.24,0.52);
 return vec4(c,1);
}
vec4 hedgehog(vec2 p,float quillLength,float density,float time) {
 vec2 q=p-vec2(-0.10,-0.28); float breathe=1.0+0.007*sin(time*1.8); q.y/=breathe;
 float body=softInside(length(q/vec2(0.91,0.59))-1.0,0.014);
 float fur=fbm(q*36.0,5.0);
 vec4 result=vec4(mix(vec3(0.15,0.075,0.028),vec3(0.53,0.38,0.22),fur),body);
 for(int i=0;i<160;i++) {
  if(float(i)>=density) break;
  float s=float(i), a=PI*(0.05+0.90*hash21(vec2(s,9.0)));
  float rad=0.35+0.65*hash21(vec2(s,18.0));
  vec2 root=vec2(cos(a)*0.90,sin(a)*0.57)*rad;
  float len=quillLength*(0.65+0.35*hash21(vec2(s,38.0)));
  vec2 end=root+normalize(vec2(cos(a),sin(a)*1.6))*len;
  float d=segmentDistance(q,root,end), along=clamp(dot(q-root,end-root)/max(dot(end-root,end-root),0.001),0.0,1.0);
  float spike=gaussian(d,0.007*(1.1-along*0.8));
  vec3 c=mix(vec3(0.12,0.07,0.035),vec3(0.78,0.65,0.42),smoothstep(0.3,1.0,along));
  result=overLayer(vec4(c,spike),result);
 }
 // A tapered muzzle, visible ear, feet and specular eye complete the silhouette.
 float head=softInside(length((q-vec2(0.83,-0.08))/vec2(0.43,0.30))-1.0,0.02);
 vec3 skin=mix(vec3(0.39,0.23,0.12),vec3(0.71,0.53,0.33),0.5+0.5*sin(q.y*3.0));
 result=overLayer(vec4(skin,head),result);
 float ear=softInside(length((q-vec2(0.63,0.15))/vec2(0.11,0.13))-1.0,0.03);
 result=overLayer(vec4(0.24,0.12,0.061,ear),result);
 float eye=gaussian(length(q-vec2(0.96,0.015)),0.037);
 result=overLayer(vec4(0.006,0.004,0.003,eye),result);
 result.rgb+=vec3(0.8)*gaussian(length(q-vec2(0.953,0.025)),0.008);
 float nose=gaussian(length(q-vec2(1.225,-0.085)),0.065);
 result=overLayer(vec4(0.038,0.023,0.017,nose),result);
 for(int i=0;i<2;i++) {
  float foot=softInside(length((q-vec2(-0.42+float(i)*0.9,-0.49))/vec2(0.15,0.085))-1.0,0.05);
  result=overLayer(vec4(0.26,0.13,0.07,foot),result);
 }
 return result;
}
`;
