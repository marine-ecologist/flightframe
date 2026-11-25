// DJI subtitle telemetry. No network, wall-clock timezone guesses or GPS interpolation.
const NUM='[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)';
const numeric=x=>x===undefined||x===null||String(x).trim()===''?null:Number.isFinite(Number(x))?Number(x):null;
export function srtSeconds(value){
  const m=String(value).trim().match(/^(\d+):([0-5]\d):([0-5]\d)[,.](\d{1,3})$/);
  return m?Number(m[1])*3600+Number(m[2])*60+Number(m[3])+Number(m[4].padEnd(3,'0'))/1000:null;
}
function field(text,names){
  for(const name of names){const m=text.match(new RegExp(`(?:^|[\\s\\[,])${name}\\s*[:=]\\s*(${NUM})(?![\\d.])`,'i'));if(m)return Number(m[1]);}
  return null;
}
export function validGPS(lat,lon){return lat!==null&&lon!==null&&Number.isFinite(lat)&&Number.isFinite(lon)&&Math.abs(lat)<=90&&Math.abs(lon)<=180;}
export function parseDJISrt(input,{legacyOrder='latlon'}={}){
  const text=String(input).replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');
  const times=/^\s*(\d+:\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*(\d+:\d{2}:\d{2}[,.]\d{1,3})[^\n]*\n/gm;
  const matches=[...text.matchAll(times)],records=[];let malformed=0;
  for(let i=0;i<matches.length;i++){
    const match=matches[i],start=srtSeconds(match[1]),end=srtSeconds(match[2]);
    if(start===null||end===null||end<=start){malformed++;continue;}
    const body=text.slice(match.index+match[0].length,matches[i+1]?.index??text.length).replace(/<[^>]*>/g,' ');
    let latitude=field(body,['latitude','lat']),longitude=field(body,['longitude','lon','lng']);
    let relativeHeight=field(body,['rel_alt','relative_altitude','relativealtitude']),absoluteAltitude=field(body,['abs_alt','absolute_altitude','absolutealtitude']);
    let pitch=field(body,['gb_pitch','gimbal_pitch','gimbalpitchdegree','cam_pitch']),yaw=field(body,['gb_yaw','gimbal_yaw','gimbalyawdegree']),roll=field(body,['gb_roll','gimbal_roll','gimbalrolldegree']);
    const tuple=body.match(new RegExp(`\\bGPS\\s*\\(\\s*(${NUM})\\s*,\\s*(${NUM})\\s*,\\s*(${NUM})\\s*[mM]?\\s*\\)`,'i'));
    if(tuple){if(latitude===null)latitude=Number(tuple[legacyOrder==='lonlat'?2:1]);if(longitude===null)longitude=Number(tuple[legacyOrder==='lonlat'?1:2]);if(absoluteAltitude===null)absoluteAltitude=Number(tuple[3]);}
    const height=body.match(new RegExp(`(?:^|[\\s,])H\\s*[:=]?\\s*(${NUM})\\s*m?\\b`,'i'));if(relativeHeight===null&&height)relativeHeight=Number(height[1]);
    const gpry=body.match(new RegExp(`\\bG\\.PRY\\s*\\(\\s*(${NUM})[°\\s]*,\\s*(${NUM})[°\\s]*,\\s*(${NUM})[°\\s]*\\)`,'i'));
    if(gpry){pitch??=Number(gpry[1]);roll??=Number(gpry[2]);yaw??=Number(gpry[3]);}
    const date=body.match(/\b(\d{4})[.-](\d{2})[.-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:[,.](\d{1,3}))?/);
    const dateTime=date?`${date[1]}:${date[2]}:${date[3]} ${date[4]}:${date[5]}:${date[6]}`:null;
    records.push({start,end,latitude,longitude,relativeHeight,absoluteAltitude,pitch,yaw,roll,dateTime,
      subsecond:date?.[7]||null,gpsValid:validGPS(latitude,longitude)&&!(latitude===0&&longitude===0),zeroGPS:latitude===0&&longitude===0,legacy:!!tuple});
  }
  records.sort((a,b)=>a.start-b.start);
  return {records,malformed,validCount:records.filter(r=>r.gpsValid).length,zeroCount:records.filter(r=>r.zeroGPS).length};
}
export function matchTelemetry(records,time,maxGap=1){
  if(!records.length||!Number.isFinite(time)||!Number.isFinite(maxGap)||maxGap<0)return null;
  // Last cue starting no later than this video time; no copying across invalid GPS cues.
  let lo=0,hi=records.length;
  while(lo<hi){const mid=(lo+hi)>>1;if(records[mid].start<=time)lo=mid+1;else hi=mid;}
  const before=records[lo-1],after=records[lo];
  const gap=r=>r?Math.max(r.start-time,time-r.end,0):Infinity;
  let record=gap(before)<=gap(after)?before:after;
  if(!record||!record.gpsValid||gap(record)>maxGap)return null;
  return {record,gapSeconds:gap(record),sampleDeltaSeconds:time-record.start};
}
export function extractionTimes({start,end,interval,duration}){
  if(![start,end,interval,duration].every(Number.isFinite)||start<0||end<=start||end>duration+1e-6||interval<=0)throw new Error('Use a valid clip range and a positive interval.');
  const count=Math.ceil((end-start)/interval-1e-9);
  return Array.from({length:count},(_,i)=>start+i*interval).filter(t=>t<end-1e-7&&t<duration);
}
export function frameMetadata(record,{pitchOverride=null}={}){
  if(!record?.gpsValid)throw new Error('A frame needs a valid telemetry GPS fix.');
  const override=numeric(pitchOverride),pitch=record.pitch??override;
  if(override!==null&&(override< -90||override>90))throw new Error('Fallback gimbal pitch must be between −90° and +90°.');
  return {...record,pitch,pitchSource:record.pitch!==null?'SRT camera/gimbal pitch':override!==null?'User-supplied fallback pitch':'Missing SRT camera/gimbal pitch'};
}
function join(parts){const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let at=0;for(const p of parts){out.set(p,at);at+=p.length;}return out;}
const ascii=text=>Uint8Array.from(String(text)+'\0',c=>c.charCodeAt(0)&255);
function u32(n){const b=new Uint8Array(4);new DataView(b.buffer).setUint32(0,n,true);return b;}
function rational(n,den=1000000){const b=new Uint8Array(8),v=new DataView(b.buffer);v.setUint32(0,Math.round(Math.abs(n)*den),true);v.setUint32(4,den,true);return b;}
function dms(n){n=Math.abs(n);const d=Math.floor(n),m=Math.floor((n-d)*60),s=((n-d)*60-m)*60;return join([rational(d,1),rational(m,1),rational(s)]);}
function entry(tag,type,count,bytes){return {tag,type,count,bytes};}
function ifdSize(entries){return 2+12*entries.length+4;}
function buildExif(meta,width,height){
  const root=[entry(0x0100,4,1,u32(width)),entry(0x0101,4,1,u32(height)),entry(0x0131,2,12,ascii('FlightFrame'))];
  const gps=[entry(0,1,4,new Uint8Array([2,3,0,0])),entry(1,2,2,ascii(meta.latitude<0?'S':'N')),entry(2,5,3,dms(meta.latitude)),entry(3,2,2,ascii(meta.longitude<0?'W':'E')),entry(4,5,3,dms(meta.longitude))];
  if(meta.absoluteAltitude!==null){gps.push(entry(5,1,1,new Uint8Array([meta.absoluteAltitude<0?1:0])),entry(6,5,1,rational(meta.absoluteAltitude,1000)));}
  const exif=[entry(0xa002,4,1,u32(width)),entry(0xa003,4,1,u32(height))];
  if(meta.dateTime){exif.push(entry(0x9003,2,20,ascii(meta.dateTime)));if(meta.subsecond)exif.push(entry(0x9291,2,meta.subsecond.length+1,ascii(meta.subsecond)));}
  root.push(entry(0x8825,4,1,u32(0)),entry(0x8769,4,1,u32(0)));
  root.sort((a,b)=>a.tag-b.tag);gps.sort((a,b)=>a.tag-b.tag);exif.sort((a,b)=>a.tag-b.tag);
  const gpsOffset=8+ifdSize(root),exifOffset=gpsOffset+ifdSize(gps),dataOffset=exifOffset+ifdSize(exif);
  root.find(e=>e.tag===0x8825).bytes=u32(gpsOffset);root.find(e=>e.tag===0x8769).bytes=u32(exifOffset);
  const total=dataOffset+[...root,...gps,...exif].reduce((n,e)=>n+(e.bytes.length>4?e.bytes.length+(e.bytes.length%2):0),0);
  const tiff=new Uint8Array(total),v=new DataView(tiff.buffer);tiff.set([73,73,42,0,8,0,0,0]);let dataAt=dataOffset;
  for(const [offset,entries]of [[8,root],[gpsOffset,gps],[exifOffset,exif]]){v.setUint16(offset,entries.length,true);entries.forEach((e,i)=>{const p=offset+2+i*12;v.setUint16(p,e.tag,true);v.setUint16(p+2,e.type,true);v.setUint32(p+4,e.count,true);if(e.bytes.length<=4)tiff.set(e.bytes,p+8);else{v.setUint32(p+8,dataAt,true);tiff.set(e.bytes,dataAt);dataAt+=e.bytes.length+(e.bytes.length%2);}});}
  return join([new Uint8Array([69,120,105,102,0,0]),tiff]);
}
const xml=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;').replaceAll('>','&gt;');
function buildXmp(meta,provenance){
  const attributes={'GPSLatitude':meta.latitude,'GPSLongitude':meta.longitude,'RelativeAltitude':meta.relativeHeight,'AbsoluteAltitude':meta.absoluteAltitude,'GimbalPitchDegree':meta.pitch,'GimbalYawDegree':meta.yaw,'GimbalRollDegree':meta.roll};
  const tags=Object.entries(attributes).filter(([,v])=>v!==null&&v!==undefined).map(([k,v])=>`drone-dji:${k}="${xml(v)}"`).join(' ');
  const trace=Object.entries({...provenance,PitchSource:meta.pitchSource,PositionMeaning:'Camera location; not ground pixel georeferencing',TimestampTimezone:'SRT wall clock; timezone unknown'}).map(([k,v])=>`ff:${k}="${xml(v)}"`).join(' ');
  const xmp=`<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:drone-dji="http://www.dji.com/drone-dji/1.0/" xmlns:ff="https://marine-ecologist.github.io/flightframe/ns/1.0/" ${tags} ${trace}/></rdf:RDF></x:xmpmeta>`;
  return join([new TextEncoder().encode('http://ns.adobe.com/xap/1.0/\0'),new TextEncoder().encode(xmp)]);
}
function app1(payload){if(payload.length>65533)throw new Error('JPEG metadata exceeds APP1 size limit.');const out=new Uint8Array(payload.length+4);out.set([255,225,(payload.length+2)>>8,(payload.length+2)&255]);out.set(payload,4);return out;}
function removeOldMetadata(jpeg){
  const parts=[jpeg.slice(0,2)];let at=2;
  while(at<jpeg.length){
    if(jpeg[at]!==255||at+1>=jpeg.length){parts.push(jpeg.slice(at));break;}
    const marker=jpeg[at+1];
    if(marker===218||marker===217){parts.push(jpeg.slice(at));break;}
    if(at+4>jpeg.length)throw new Error('Truncated JPEG header.');
    const size=(jpeg[at+2]<<8)|jpeg[at+3],end=at+2+size;
    if(size<2||end>jpeg.length)throw new Error('Invalid JPEG segment size.');
    const signature=new TextDecoder().decode(jpeg.slice(at+4,Math.min(end,at+45)));
    const oldMetadata=marker===225&&(signature.startsWith('Exif\0\0')||signature.startsWith('http://ns.adobe.com/xap/')||signature.startsWith('http://ns.adobe.com/xmp/'));
    if(!oldMetadata)parts.push(jpeg.slice(at,end));at=end;
  }
  return join(parts);
}
export function geotagJpeg(jpeg,meta,{width,height,...provenance}){
  if(jpeg[0]!==255||jpeg[1]!==216)throw new Error('Frame encoder did not return a JPEG.');
  if(!validGPS(meta.latitude,meta.longitude)||!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1)throw new Error('Invalid JPEG dimensions or frame GPS.');
  const clean=removeOldMetadata(jpeg);
  return join([clean.slice(0,2),app1(buildExif(meta,width,height)),app1(buildXmp(meta,provenance)),clean.slice(2)]);
}

// Folder inputs are paired within their relative directory. Never borrow telemetry
// from another clip when the matching SRT is missing or ambiguous.
export function videoInputPath(file){return String(file.webkitRelativePath||file.name).replaceAll('\\','/');}
export function pairVideoFiles(files){
  const videos=new Map(),subtitles=new Map(),errors=[],warnings=[];
  const key=(path,isSrt)=>path.replace(isSrt?/\.srt$/i:/\.(mp4|mov|m4v)$/i,'').replace(/\.(mp4|mov|m4v)$/i,'').toLowerCase();
  for(const file of files){
    const path=videoInputPath(file),isVideo=/\.(mp4|mov|m4v)$/i.test(path),isSrt=/\.srt$/i.test(path);
    if(!isVideo&&!isSrt)continue;
    const target=isVideo?videos:subtitles,k=key(path,isSrt);
    if(!target.has(k))target.set(k,[]);target.get(k).push(file);
  }
  const pairs=[];
  for(const [k,clips]of videos){
    const srts=subtitles.get(k)||[];
    if(clips.length!==1){errors.push(`Ambiguous video basename: ${clips.map(videoInputPath).join(', ')}`);continue;}
    if(srts.length!==1){errors.push(srts.length?`Multiple SRT files match ${videoInputPath(clips[0])}. Keep one matching SRT.`:`Missing matching SRT: ${videoInputPath(clips[0])}`);continue;}
    pairs.push({clip:clips[0],srt:srts[0],sourcePath:videoInputPath(clips[0]),srtPath:videoInputPath(srts[0])});
  }
  for(const [k,srts]of subtitles)if(!videos.has(k))warnings.push(`Unused SRT: ${srts.map(videoInputPath).join(', ')}`);
  if(!videos.size)errors.push('No MP4, MOV or M4V video clips found in this folder.');
  const natural=new Intl.Collator('en',{numeric:true,sensitivity:'base'});
  pairs.sort((a,b)=>natural.compare(a.sourcePath,b.sourcePath)||a.sourcePath.localeCompare(b.sourcePath));
  return {pairs,errors,warnings};
}
export function buildVideoTimeline(clips){
  let duration=0;
  const segments=clips.map((clip,index)=>{
    if(!Number.isFinite(clip.duration)||clip.duration<=0)throw new Error(`Invalid duration for ${clip.sourcePath||'clip '+(index+1)}.`);
    const segment={...clip,index,timelineStart:duration,timelineEnd:duration+clip.duration};duration=segment.timelineEnd;return segment;
  });
  return {segments,duration};
}
export function timelinePosition(segments,time){
  if(!Number.isFinite(time)||time<0)return null;
  let lo=0,hi=segments.length;
  while(lo<hi){const mid=(lo+hi)>>1;if(segments[mid].timelineEnd<=time+1e-9)lo=mid+1;else hi=mid;}
  const segment=segments[lo];
  return segment&&time>=segment.timelineStart-1e-9&&time<segment.timelineEnd-1e-9?{segment,localTime:Math.max(0,time-segment.timelineStart)}:null;
}
export function telemetryTime(segment,localTime,offset=0,clock='per-clip'){
  return localTime+offset+(clock==='continuous'?segment.timelineStart:0);
}
export function mergedTelemetry(segments,clock='per-clip',offset=0){
  return segments.flatMap(segment=>segment.telemetry.records.map(record=>{
    const shift=(clock==='continuous'?0:segment.timelineStart)-offset;
    return {...record,start:record.start+shift,end:record.end+shift,sourceVideo:segment.sourcePath,sourceSRT:segment.srtPath};
  }).filter(r=>r.end>segment.timelineStart&&r.start<segment.timelineEnd)
    .map(r=>({...r,start:Math.max(r.start,segment.timelineStart),end:Math.min(r.end,segment.timelineEnd)})))
    .sort((a,b)=>a.start-b.start);
}
export function telemetrySrt(records){
  const stamp=t=>{const n=Math.round(Math.max(0,t)*1000);return `${String(Math.floor(n/3600000)).padStart(2,'0')}:${String(Math.floor(n/60000)%60).padStart(2,'0')}:${String(Math.floor(n/1000)%60).padStart(2,'0')},${String(n%1000).padStart(3,'0')}`;};
  return records.map((r,i)=>{
    const tags=[['latitude',r.latitude],['longitude',r.longitude],['rel_alt',r.relativeHeight],['abs_alt',r.absoluteAltitude],['gb_pitch',r.pitch],['gb_yaw',r.yaw],['gb_roll',r.roll]].filter(([,v])=>v!==null&&v!==undefined).map(([k,v])=>`[${k}: ${v}]`).join(' ');
    return `${i+1}\n${stamp(r.start)} --> ${stamp(r.end)}\n${r.dateTime?r.dateTime.replace(/^(\d{4}):(\d{2}):(\d{2})/,'$1-$2-$3')+'\n':''}${tags}\n`;
  }).join('\n');
}
