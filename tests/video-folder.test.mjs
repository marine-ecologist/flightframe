import test from 'node:test';import assert from 'node:assert/strict';
import {pairVideoFiles,buildVideoTimeline,timelinePosition,telemetryTime,mergedTelemetry,telemetrySrt,parseDJISrt,matchTelemetry,extractionTimes} from '../public/video-core.js';
const file=path=>({name:path.split('/').at(-1),webkitRelativePath:path});
const source=(lat=19)=>parseDJISrt(`1\n00:00:00,000 --> 00:00:03,000\n[latitude: ${lat}] [longitude: -80] [rel_alt: 20 abs_alt: 25]`);
function clips(){return [{sourcePath:'flight/DJI_2.MP4',srtPath:'flight/DJI_2.SRT',duration:3,telemetry:source(19)},{sourcePath:'flight/DJI_10.MP4',srtPath:'flight/DJI_10.SRT',duration:3,telemetry:source(20)}];}
test('folder matches video and SRT, naturally orders clips and ignores unrelated files',()=>{
 const p=pairVideoFiles(['flight/DJI_10.MP4','flight/DJI_2.MP4','flight/DJI_10.SRT','flight/DJI_2.srt','flight/ignore.JPG','flight/unused.SRT'].map(file));
 assert.deepEqual(p.errors,[]);assert.deepEqual(p.pairs.map(p=>p.clip.name),['DJI_2.MP4','DJI_10.MP4']);assert.equal(p.warnings.length,1);
});
test('missing/ambiguous matching SRTs block the folder instead of guessing',()=>{
 assert.match(pairVideoFiles([file('f/a.mp4'),file('f/b.srt')]).errors[0],/Missing matching SRT/);
 assert.match(pairVideoFiles([file('f/a.mp4'),file('f/a.srt'),file('f/a.mp4.srt')]).errors[0],/Multiple SRT/);
 assert.match(pairVideoFiles([file('f/a.mp4'),file('f/a.mov'),file('f/a.srt')]).errors[0],/Ambiguous video/);
 assert.match(pairVideoFiles([file('f/a.srt')]).errors[0],/No MP4/);
});
test('pairs remain local to each subfolder, including .MP4.SRT names',()=>{
 const p=pairVideoFiles(['root/a/clip.MP4','root/a/clip.MP4.SRT','root/b/clip.mp4','root/b/clip.srt'].map(file));
 assert.deepEqual(p.errors,[]);assert.equal(p.pairs.length,2);assert.equal(p.pairs[0].srtPath,'root/a/clip.MP4.SRT');
 assert.match(pairVideoFiles([file('root/a/clip.mp4'),file('root/b/clip.srt')]).errors[0],/Missing/);
});
test('one joined timeline samples across clip boundaries without resetting interval',()=>{
 const p=buildVideoTimeline(clips());assert.equal(p.duration,6);assert.equal(p.segments[1].timelineStart,3);
 assert.equal(timelinePosition(p.segments,0).segment.index,0);assert.equal(timelinePosition(p.segments,3).segment.index,1);assert.equal(timelinePosition(p.segments,3).localTime,0);assert.equal(timelinePosition(p.segments,6),null);assert.equal(timelinePosition(p.segments,-1),null);
 const times=extractionTimes({start:0,end:6,interval:2,duration:6});assert.deepEqual(times,[0,2,4]);
 const samples=times.map(t=>{const p2=timelinePosition(p.segments,t);return [p2.segment.index,p2.localTime,matchTelemetry(p2.segment.telemetry.records,telemetryTime(p2.segment,p2.localTime),0).record.latitude];});
 assert.deepEqual(samples,[[0,0,19],[0,2,19],[1,1,20]]);
 assert.deepEqual(extractionTimes({start:2.5,end:4.5,interval:1,duration:6}),[2.5,3.5]);
});
test('combined SRT offsets per-clip cues once and preserves GPS on both sides',()=>{
 const p=buildVideoTimeline(clips()),records=mergedTelemetry(p.segments);
 assert.deepEqual(records.map(r=>[r.start,r.end]),[[0,3],[3,6]]);
 const parsed=parseDJISrt(telemetrySrt(records));assert.equal(parsed.validCount,2);assert.equal(matchTelemetry(parsed.records,2.9,0).record.latitude,19);assert.equal(matchTelemetry(parsed.records,3,0).record.latitude,20);
 assert.deepEqual(mergedTelemetry(p.segments,'per-clip',1).map(r=>[r.start,r.end]),[[0,2],[3,5]]);
});
test('already-continuous SRT clock is not offset twice',()=>{
 const c=clips();c[1].telemetry.records[0].start=3;c[1].telemetry.records[0].end=6;
 const p=buildVideoTimeline(c);assert.equal(telemetryTime(p.segments[1],1,0,'continuous'),4);
 assert.equal(telemetryTime(p.segments[1],1,.5,'per-clip'),1.5);
 assert.deepEqual(mergedTelemetry(p.segments,'continuous').map(r=>[r.start,r.end]),[[0,3],[3,6]]);
});
test('a clip without valid GPS cannot borrow a preceding clip GPS fix',()=>{
 const c=clips();c[1].telemetry=parseDJISrt('1\n00:00:00,000 --> 00:00:03,000\n[latitude: 0] [longitude: 0]');
 const p=buildVideoTimeline(c),position=timelinePosition(p.segments,3);assert.equal(matchTelemetry(position.segment.telemetry.records,position.localTime,5),null);
 assert.throws(()=>buildVideoTimeline([{duration:NaN}]));
});

test('SRT-driven schedule uses cue timestamps, skips gaps, and resets per matched clip',async()=>{
 const {srtExtractionTimes}=await import('../public/video-core.js');
 const cue=(start,end,gpsValid=true)=>({start,end,gpsValid});
 const segments=buildVideoTimeline([
  {duration:8,telemetry:{records:[cue(1,1.02),cue(2,2.02,false),cue(3.5,3.52),cue(6,6.02)]}},
  {duration:4,telemetry:{records:[cue(.5,.52),cue(2.5,2.52)]}}
 ]).segments;
 const times=srtExtractionTimes(segments,{start:0,end:12,interval:2,duration:12});
 assert.deepEqual(times.map(t=>Number(t.toFixed(3))),[1.01,3.51,6.01,8.51,10.51]);
 assert.deepEqual(srtExtractionTimes(segments,{start:7,end:8,interval:2,duration:12}),[]);
 assert.throws(()=>srtExtractionTimes(segments,{start:0,end:12,interval:0,duration:12}));
});
