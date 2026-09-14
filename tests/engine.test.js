import assert from 'node:assert/strict';
import E from '../src/engine.js';
const approx = (a,b,t=1e-8) => assert(Math.abs(a-b) < t, `${a} != ${b}`);
let seed=814721;
function rand() { seed=(Math.imul(seed,1664525)+1013904223)>>>0; return seed/4294967296; }
for (let test=0; test<160; test++) {
  const xs=[.03+rand()*.97,0,0,0], ys=[0,0,0,.03+rand()*.97];
  xs[1]=xs[0]*(.1+rand()*.8); xs[2]=xs[1]*(.1+rand()*.8);
  ys[2]=ys[3]*(.1+rand()*.8); ys[1]=ys[2]*(.1+rand()*.8);
  const points=xs.map((x,i)=>({x,y:ys[i]}));
  for(const mode of ['Through anchors','Cubic handles']) {
    const curves=E.segments(points,mode);
    assert.equal(curves.length,mode==='Through anchors'?3:1);
    let previous=points[0];
    for(const s of curves) {
      for(let i=0;i<=100;i++) {
        const p=E.evaluate(s,i/100);
        assert(p.x<=previous.x+1e-10 && p.y>=previous.y-1e-10,'Curve must remain monotone');
        assert(p.x>=-1e-10 && p.y>=-1e-10 && p.x<=1 && p.y<=1);
        previous=p;
      }
    }
    if(mode==='Through anchors') {
      for(let i=0;i<3;i++) {
        approx(curves[i][0].x,points[i].x); approx(curves[i][3].y,points[i+1].y);
      }
      for(let i=0;i<2;i++) for(const k of ['x','y']) {
        approx(curves[i][3][k]-curves[i][2][k],curves[i+1][1][k]-curves[i+1][0][k]);
      }
    }
    const lut=E.radialLUT(curves,2048);
    approx(lut[0],points[0].x,1e-7); approx(lut[lut.length-1],points[3].y,1e-7);
    for(const v of lut) assert(Number.isFinite(v) && v>0);
    for(const s of curves) for(let i=1;i<20;i++) {
      const p=E.evaluate(s,i/20), r=p.x+p.y, q=Math.sqrt(p.y)/(Math.sqrt(p.x)+Math.sqrt(p.y))*2048;
      const a=Math.min(2047,Math.floor(q)), f=q-a;
      const boundary=lut[a]*(1-f)+lut[a+1]*f;
      assert(Math.abs(boundary-r)<.002, 'LUT should agree with the Bezier contour');
    }
  }
}
assert.deepEqual(E.colorRGB('#66aAff'),[102,170,255]);
assert.throws(()=>E.colorRGB('red'));
for (const blend of ['Smooth','Linear']) for (const falloff of [.25,1,4]) {
  const t=E.transferLUT({blend,falloff}); approx(t[0],0); approx(t[t.length-1],1);
  for(let i=1;i<t.length;i++) assert(t[i]>=t[i-1]);
}
console.log('PASS: 320 randomized contour cases; on-curve anchors; C1 joins; monotonicity; LUT accuracy; colors; falloff.');

const waveSettings = { waveEnabled: true, waveAmplitude: 35, waveLength: .3, waveComplexity: 1, waveEdges: 1 };
for (let test = 0; test < 160; test++) {
  const reachX = test === 0 ? 1 : .0001 + rand() * .9999;
  const reachY = test === 0 ? 1 : .0001 + rand() * .9999;
  const base = [{ x: reachX, y: 0 }, { x: reachX * .7, y: reachY * .00001 },
    { x: reachX * .00001, y: reachY * .4 }, { x: 0, y: reachY }];
  const original = JSON.stringify(base), phase = rand() * 10000;
  const moving = E.wavePoints(base, waveSettings, phase);
  assert.equal(JSON.stringify(base), original, 'Animation must not mutate saved anchors');
  assert.equal(moving[0].y, 0); assert.equal(moving[3].x, 0);
  for (let i = 1; i < 4; i++) {
    assert(moving[i].x < moving[i - 1].x && moving[i].y > moving[i - 1].y);
  }
  for (const p of moving) assert(p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1);
  const restored = E.wavePoints(moving, waveSettings, phase, true);
  const adjacent = E.wavePoints(base, waveSettings, phase + 1e-5);
  base.forEach((p, i) => {
    for (const axis of ['x', 'y']) {
      approx(restored[i][axis], p[axis]);
      approx(adjacent[i][axis], moving[i][axis], 1e-4);
    }
  });
  assert.deepEqual(E.wavePoints(base, { ...waveSettings, waveAmplitude: 0 }, phase), base);
  assert.deepEqual(E.wavePoints(base, { ...waveSettings, waveEnabled: false }, phase), base);
  const pinned = E.wavePoints(base, { ...waveSettings, waveEdges: 0 }, phase);
  assert.deepEqual(pinned[0], base[0]); assert.deepEqual(pinned[3], base[3]);
}
console.log('PASS: 160 wave cases; bounded ordered anchors; smooth motion; inverse editing; no base drift; pinned edges; disabled/zero amplitude.');
