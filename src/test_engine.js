const fs=require('fs'); eval(fs.readFileSync('engine.js','utf8')+';globalThis.Engine=Engine;');
const st=a=>{const m=a.reduce((x,y)=>x+y,0)/a.length;return `mean ${m.toFixed(3)} max|${Math.max(...a.map(Math.abs)).toFixed(3)}|`;};
// ---- sprint ----
let e10=[],e30=[],etop=[],efly=[];
for(let s=1;s<=20;s++){
  const vmax=8+((s*37)%18)/10, sim=Engine.simulate({seed:s*97+3,vmax,target:30,noise:0.03});
  const r=Engine.process(sim.raw,{mode:'sprint',target:30,mass:68}); if(r.error){console.log('ERR',r.error);continue;}
  const T=sim.truth; let t0=T.runStart; // true time speed passes 0.2 m/s
  const tv=(t)=>{const a=T.xAt(t),b=T.xAt(t+0.001);return (b-a)/0.001;}; while(tv(t0)<0.2) t0+=0.001;
  const x0=T.xAt(t0);
  e10.push(r.cum[10]-(T.atX(x0+10)-t0)); e30.push(r.time-(T.atX(x0+30)-t0));
  let best=1e9; for(let x=0;x+10<=30;x+=0.05) best=Math.min(best,T.atX(x0+x+10)-T.atX(x0+x)); efly.push(r.fly10.time-best);
  if(s<=3) console.log(`sprint s${s}: 30m ${r.time.toFixed(3)} top ${r.top.speed.toFixed(2)} @${r.top.dist.toFixed(1)}m fly ${r.fly10.time.toFixed(3)} F0 ${r.fv&&r.fv.F0.toFixed(2)} V0 ${r.fv&&r.fv.V0.toFixed(2)} P0 ${r.fv&&r.fv.P0.toFixed(1)} steps ${r.steps.counted}`);
}
console.log('sprint 0-10 err',st(e10)); console.log('sprint 0-30 err',st(e30)); console.log('fly10 err',st(efly));
// ---- vault ----
let lok=0,ln=0,eTo=[],eL5=[];
for(const hop of [false,true]) for(let s=1;s<=20;s++){
  const steps=12+(s%9), vmax=8.2+((s*13)%10)/10;
  const sim=Engine.simulate({seed:s*31+(hop?7:1),vmax,steps,hop,back:2.4,noise:0.03});
  const r=Engine.process(sim.raw,{mode:'vault',setup:'runway100',noBox:true}); if(r.error){console.log('ERR',r.error);continue;}
  const trueLefts=Math.ceil((steps-1)/2); ln++; if(r.steps.lefts===trueLefts) lok++; else console.log(`  miss hop=${hop} s${s}: steps ${steps} counted ${r.steps.counted} (first at ${r.steps.firstAt} m) lefts ${r.steps.lefts} vs ${trueLefts}`);
  const T=sim.truth, xTo=T.xAt(T.vaultEnd);
  eTo.push(r.takeoff.sensor-(2.4+xTo));
  const tl=5/(T.atX(xTo)-T.atX(xTo-5)); if(r.last5) eL5.push(r.last5.speed-tl);
}
console.log(`lefts correct ${lok}/${ln}`); console.log('takeoff position err (m)',st(eTo)); console.log('last 5 m speed err',st(eL5));

// ---- pole runs off the runway: takeoff found where the feet leave the ground ----
let pok=0,pn=0,plok=0,eP=[];
for(let s=1;s<=40;s++){
  const steps=12+(s%7), vmax=8.0+((s*13)%10)/10;
  const sim=Engine.simulate({seed:s*71+5,vmax,steps,hop:s%3==0,back:2.5,noise:0.03,popup:true,toLoss:0.06+(s%5)*0.02,flight:0.45+(s%4)*0.08});
  const r=Engine.process(sim.raw,{mode:'vault',setup:'polerun100',noBox:true}); pn++; if(r.error){console.log('ERR',r.error);continue;}
  const T=sim.truth, last=r.contacts[r.contacts.length-1].t+r.start.t;
  if(Math.abs(last-T.vaultEnd)<0.08) pok++; if(r.steps.lefts===Math.ceil((steps-1)/2)) plok++;
  eP.push(r.takeoff.sensor-(2.5+T.xAt(T.vaultEnd)));
}
console.log(`pole run takeoff found ${pok}/${pn}, lefts correct ${plok}/${pn}`); console.log('pole run takeoff position err (m)',st(eP));
if (pok < 0.9 * pn) { console.error('pole run takeoff detection below 90%'); process.exit(1); }
