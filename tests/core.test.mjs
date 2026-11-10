import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import exifr from 'exifr';import {Zip,ZipPassThrough,unzipSync} from 'fflate';
import {normalizeMetadata,gimbalAngle,inRange,insidePolygon,safePath,uniquePath,csv} from '../public/core.js';
test('real EXIF and DJI XMP extraction from generated JPEG',async()=>{
  const parsed=await exifr.parse(await readFile('tests/fixtures/drone.jpg'),{xmp:true,mergeOutput:false,translateValues:false,sanitize:true});
  const d=normalizeMetadata(parsed,'survey/drone.jpg','1');
  assert.equal(d.latitude,19.3);assert.equal(d.longitude,-81.2);assert.equal(d.absoluteAltitude,-5);assert.equal(d.relativeHeight,42.5);assert.equal(d.pitch,-89.5);assert.equal(d.pitchTag,'drone-dji:GimbalPitchDegree');assert.equal(d.gpsValid,true);
});
test('raw signed GPS, missing values, invalid coordinates and flight pitch exclusion',()=>{
  const d=normalizeMetadata({GPSLatitude:[19,30,0],GPSLatitudeRef:'S',GPSLongitude:[81,0,0],GPSLongitudeRef:'W',FlightPitchDegree:5},'a.jpg','1');
  assert.equal(d.latitude,-19.5);assert.equal(d.longitude,-81);assert.equal(d.pitch,null);assert.equal(d.gpsValid,true);
  assert.equal(normalizeMetadata({},'b.jpg','2').gpsValid,false);
  assert.equal(normalizeMetadata({latitude:91,longitude:0},'b.jpg','2').gpsValid,false);
  assert.equal(normalizeMetadata({latitude:0,longitude:0},'b.jpg','2').gpsValid,true);
});
test('gimbal conventions and inclusive filters',()=>{
  assert.equal(gimbalAngle(-90),90);assert.equal(gimbalAngle(90),90);assert.equal(gimbalAngle(0),0);assert.equal(gimbalAngle(91),null);assert.equal(gimbalAngle(null),null);
  assert.equal(gimbalAngle(45,'negative'),null);assert.equal(gimbalAngle(-45,'negative'),45);assert.equal(gimbalAngle(-45,'positive'),null);
  assert.equal(inRange(90,0,90,false),true);assert.equal(inRange(null,0,90,false),false);assert.equal(inRange(null,0,90,true),true);
});
test('concave polygon follows outline and includes edges/vertices',()=>{
  const ring=[[0,0],[3,0],[3,1],[1,1],[1,3],[0,3],[0,0]];
  assert.equal(insidePolygon(2,2,ring),false);assert.equal(insidePolygon(.5,2,ring),true);assert.equal(insidePolygon(2,.5,ring),true);assert.equal(insidePolygon(1,1,ring),true);assert.equal(insidePolygon(0,0,ring),true);
  const wrapped=[[178,-1],[182,-1],[182,1],[178,1],[178,-1]];assert.equal(insidePolygon(0,-179,wrapped),true);assert.equal(insidePolygon(0,0,wrapped),false);
});
test('safe archive paths, duplicate disambiguation and CSV escaping',()=>{
  assert.equal(safePath('../a/../b.jpg'),'a/b.jpg');const used=new Set();assert.equal(uniquePath('a.jpg',used),'a.jpg');assert.equal(uniquePath('A.jpg',used),'A (2).jpg');
  assert.match(csv([{name:'=malicious',value:-81}]),/"'=malicious","-81"/);assert.match(csv([{name:'a"b'}]),/a""b/);
});
test('streamed archive preserves original bytes and nested paths',async()=>{
  const original=await readFile('tests/fixtures/drone.jpg'),chunks=[];
  const archive=new Zip((error,data)=>{if(error)throw error;chunks.push(data);});
  const entry=new ZipPassThrough('survey/drone.jpg');archive.add(entry);
  for(let i=0;i<original.length;i+=100)entry.push(original.subarray(i,i+100),false);
  entry.push(new Uint8Array(0),true);archive.end();
  const expanded=unzipSync(Buffer.concat(chunks));assert.deepEqual(Buffer.from(expanded['survey/drone.jpg']),original);
});
