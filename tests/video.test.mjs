import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import exifr from 'exifr';
import {srtSeconds,parseDJISrt,matchTelemetry,extractionTimes,frameMetadata,geotagJpeg} from '../public/video-core.js';
import {normalizeMetadata} from '../public/core.js';
const modern=`1\r\n00:00:00,000 --> 00:00:01,000\r\n<font size="28">2026-11-24 10:20:30.125\r\n[latitude: -19.3] [longitude: -81.2] [rel_alt: 42.5 abs_alt: -5.25] [gb_pitch: -89.5 gb_yaw: 123.4 gb_roll: -1.2] [FlightPitchDegree: 9]</font>\r\n\r\n2\r\n00:00:01,000 --> 00:00:02,000\r\n[latitude: -19.3001] [longitude: -81.2001] [rel_alt: 43.2 abs_alt: -4.5]`;
test('DJI bracketed SRT parses GPS, grouped altitudes and camera angles',()=>{
  const p=parseDJISrt('\uFEFF'+modern);assert.equal(p.validCount,2);assert.equal(p.records[0].latitude,-19.3);assert.equal(p.records[0].absoluteAltitude,-5.25);assert.equal(p.records[0].pitch,-89.5);assert.equal(p.records[0].yaw,123.4);assert.equal(p.records[0].roll,-1.2);assert.equal(p.records[0].dateTime,'2026:11:24 10:20:30');assert.equal(p.records[0].subsecond,'125');assert.equal(p.records[1].pitch,null);
});
test('legacy GPS order is explicit; G.PRY is camera, F.PRY is aircraft',()=>{
  const p=parseDJISrt(`1\n00:00:00,000 --> 00:00:01,000\nGPS(-19.3,-81.2,5M) BAROMETER(12) H=42.5m F.PRY(4,5,6) G.PRY(-90°,0°,120°)`);
  assert.equal(p.records[0].latitude,-19.3);assert.equal(p.records[0].longitude,-81.2);assert.equal(p.records[0].absoluteAltitude,5);assert.equal(p.records[0].relativeHeight,42.5);assert.equal(p.records[0].pitch,-90);assert.equal(p.records[0].yaw,120);
  const reversed=parseDJISrt('1\n00:00:00.000 --> 00:00:01.000\nGPS(-81.2,-19.3,5)',{legacyOrder:'lonlat'});assert.equal(reversed.records[0].latitude,-19.3);
  const flightOnly=parseDJISrt('1\n00:00:00,000 --> 00:00:01,000\n[latitude: 0] [longitude: 0] [pitch: -90] F.PRY(-90,0,0)');assert.equal(flightOnly.records[0].pitch,null);assert.equal(flightOnly.validCount,0);assert.equal(flightOnly.zeroCount,1);
});
test('malformed timing, missing GPS and unsupported captions do not invent positions',()=>{
  assert.equal(parseDJISrt('ordinary captions').validCount,0);
  assert.equal(parseDJISrt('1\n00:61:00,000 --> 00:61:01,000\n[latitude: 1] [longitude: 2]').malformed,1);
  const p=parseDJISrt('1\n00:00:00,000 --> 00:00:01,000\n[latitude: 91] [longitude: 2]');assert.equal(p.validCount,0);
  assert.equal(srtSeconds('01:02:03.5'),3723.5);assert.equal(srtSeconds('00:99:00,000'),null);
});
test('frame schedule excludes end, respects duration, prevents excessive output',()=>{
  assert.deepEqual(extractionTimes({start:0,end:3,interval:1,duration:3}),[0,1,2]);assert.deepEqual(extractionTimes({start:1,end:2,interval:.4,duration:3}),[1,1.4,1.8]);
  assert.throws(()=>extractionTimes({start:0,end:10,interval:0,duration:10}));assert.throws(()=>extractionTimes({start:0,end:11,interval:1,duration:10}));assert.throws(()=>extractionTimes({start:0,end:1000,interval:.2,duration:1000}));
});
test('telemetry matching never interpolates across missing GPS or large gaps',()=>{
  const {records}=parseDJISrt(modern);assert.equal(matchTelemetry(records,.5,0).record.start,0);assert.equal(matchTelemetry(records,1,0).record.start,1);
  assert.equal(matchTelemetry(records,5,1),null);assert.equal(matchTelemetry(records,2.1,0),null);assert.ok(matchTelemetry(records,2.1,.2));
  const missing={start:2,end:3,gpsValid:false};assert.equal(matchTelemetry([...records,missing],2.5,1),null);
  assert.equal(matchTelemetry(records,-1,0),null);assert.equal(matchTelemetry([],0),null);
});
test('fallback pitch is explicit, labelled and never replaces real camera pitch',()=>{
  const {records}=parseDJISrt(modern);assert.equal(frameMetadata(records[0],{pitchOverride:-90}).pitch,-89.5);
  assert.equal(frameMetadata(records[1]).pitch,null);const m=frameMetadata(records[1],{pitchOverride:-90});assert.equal(m.pitch,-90);assert.match(m.pitchSource,/User-supplied/);assert.throws(()=>frameMetadata(records[1],{pitchOverride:100}));
});
test('JPEG GPS EXIF and DJI XMP round trip, including negative altitude and provenance',async()=>{
  const {records}=parseDJISrt(modern);const meta=frameMetadata(records[0]);const original=await readFile('tests/fixtures/drone.jpg');
  const tagged=geotagJpeg(original,meta,{width:100,height:100,SourceVideo:'clip<&.mp4',VideoSeconds:'0.500',FrameTiming:'decoded frame timestamp'});
  const parsed=await exifr.parse(tagged,{xmp:true,mergeOutput:false,translateValues:false});const d=normalizeMetadata(parsed,'frame.jpg','1');
  assert.ok(Math.abs(d.latitude+19.3)<1e-8);assert.ok(Math.abs(d.longitude+81.2)<1e-8);assert.equal(d.absoluteAltitude,-5.25);assert.equal(d.relativeHeight,42.5);assert.equal(d.pitch,-89.5);assert.equal(d.yaw,123.4);assert.equal(d.roll,-1.2);
  assert.equal(parsed.ifd0.Software,'FlightFrame');assert.equal(parsed.exif.DateTimeOriginal.getFullYear(),2026);assert.equal(parsed.ff.SourceVideo,'clip&lt;&amp;.mp4');assert.equal(parsed.ff.VideoSeconds,.5);
  // Inserted APP1 metadata does not alter the encoded JPEG scan data.
  const sos=bytes=>{for(let i=2;i<bytes.length-1;i++)if(bytes[i]===255&&bytes[i+1]===218)return bytes.subarray(i);throw Error('SOS absent');};
  assert.deepEqual(Buffer.from(sos(tagged)),Buffer.from(sos(original)));
});
test('no fabricated altitude or pitch tags when SRT omits them',async()=>{
  const m=frameMetadata({latitude:0,longitude:0,gpsValid:true,absoluteAltitude:null,relativeHeight:null,pitch:null,yaw:null,roll:null,dateTime:null});
  const tagged=geotagJpeg(await readFile('tests/fixtures/drone.jpg'),m,{width:100,height:100});
  // New generated frames have no prior EXIF; an SOI/EOI-only fixture isolates metadata.
  const clean=geotagJpeg(new Uint8Array([255,216,255,217]),m,{width:100,height:100});
  const p=await exifr.parse(clean,{xmp:true,mergeOutput:false,translateValues:false});assert.equal(p.gps.GPSAltitude,undefined);assert.equal(p['drone-dji'].GimbalPitchDegree,undefined);assert.ok(tagged.length>0);
});

test('zero/zero SRT telemetry is skipped and later real fixes are used',()=>{
 const p=parseDJISrt('1\n00:00:00,000 --> 00:00:01,000\n[latitude: 0.000000] [longitude: 0.000000] [rel_alt: 0.000 abs_alt: 3.933]\n\n2\n00:00:01,000 --> 00:00:02,000\n[latitude: 19.5] [longitude: -80.5] [rel_alt: 23.300 abs_alt: 20.641]');
 assert.equal(p.zeroCount,1);assert.equal(p.validCount,1);assert.equal(matchTelemetry(p.records,.5,0),null);const m=matchTelemetry(p.records,1.5,0);assert.equal(m.record.relativeHeight,23.3);assert.equal(frameMetadata(m.record,{pitchOverride:-90}).pitch,-90);
});
