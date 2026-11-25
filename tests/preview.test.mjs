import test from 'node:test';
import assert from 'node:assert/strict';
import {flatFootprint} from '../public/preview-core.js';
const photo={gpsValid:true,latitude:0,longitude:0,relativeHeight:100,absoluteAltitude:130,yaw:0,pitch:-90,roll:0};
test('nadir corner rays scale with height and field of view',()=>{
 const a=flatFootprint(photo,{fov:90,aspect:2}),b=flatFootprint({...photo,relativeHeight:200},{fov:90,aspect:2});
 const metres=6378137*Math.PI/180;
 assert.ok(Math.abs(a.corners[0][1]*metres+100)<1e-8);
 assert.ok(Math.abs(a.corners[0][0]*metres-50)<1e-8);
 assert.ok(Math.abs(b.corners[0][1]/a.corners[0][1]-2)<1e-8);
 assert.deepEqual(flatFootprint(photo,{heightBasis:'absoluteAltitude',ground:30,fov:90,aspect:2}).corners,a.corners);
});
test('camera yaw rotates the footprint clockwise and oblique pitch shifts it forward',()=>{
 const a=flatFootprint({...photo,yaw:90},{fov:90,aspect:2});
 assert.ok(a.corners[0][0]>0&&a.corners[0][1]>0);
 const tilted=flatFootprint({...photo,pitch:-60},{fov:40,aspect:2});
 assert.ok(tilted.corners.reduce((n,c)=>n+c[0],0)>0);
});
test('missing orientation uses labelled assumptions; invalid geometry has no footprint',()=>{
 const result=flatFootprint({...photo,yaw:null,pitch:null,roll:null},{heading:25});
 assert.equal(result.heading,25);assert.ok(result.assumptions.includes('fallback heading'));
 for(const p of [{relativeHeight:null},{relativeHeight:0},{pitch:-10},{gpsValid:false}])assert.equal(flatFootprint({...photo,...p}),null);
 assert.equal(flatFootprint(photo,{fov:180}),null);
 assert.deepEqual(flatFootprint({...photo,pitch:90},{pitchConvention:'positive'}).corners,flatFootprint(photo).corners);
});
