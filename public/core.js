export function number(value) {
  if (value === null || value === undefined || value === '') return null;
  if (Array.isArray(value)) {
    if(value.length !== 1) return null;
    value=value[0];
  }
  const n=Number(value); return Number.isFinite(n) ? n : null;
}
export function flatten(object,prefix='',output=Object.create(null)) {
  for(const [key,value] of Object.entries(object || {})) {
    const path=prefix ? `${prefix}:${key}` : key;
    if(value && typeof value==='object' && !Array.isArray(value) && !(value instanceof Date) && !ArrayBuffer.isView(value)) flatten(value,path,output);
    else output[path]=value;
  }
  return output;
}
function pick(tags,names) {
  for(const name of names) for(const [tag,raw] of Object.entries(tags)) {
    if(tag===name || tag.split(':').at(-1)===name) {
      const value=number(raw); if(value!==null) return {value,tag};
    }
  }
  return {value:null,tag:''};
}
function valueOf(tags,name) { return Object.entries(tags).find(([k])=>k.split(':').at(-1)===name)?.[1]; }
function coordinate(tags,axis) {
  const signed=pick(tags,[axis]); if(signed.value!==null) return signed;
  const tag=axis==='latitude'?'GPSLatitude':'GPSLongitude';
  let found=pick(tags,[tag]);
  if(found.value===null) {
    const raw=valueOf(tags,tag);
    if(Array.isArray(raw) && raw.length===3 && raw.every(x=>number(x)!==null)) found={value:Number(raw[0])+Number(raw[1])/60+Number(raw[2])/3600,tag};
    else if(typeof raw==='string') {
      const m=raw.match(/^\s*([+-]?\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*([NSEW])?\s*$/i);
      if(m) found={value:(Number(m[1])+Number(m[2])/60)*(/[SW]/i.test(m[3]||'')?-1:1),tag};
    }
  }
  const ref=String(valueOf(tags,tag+'Ref')||'').toUpperCase();
  if(found.value!==null && ['S','W'].includes(ref)) found.value=-Math.abs(found.value);
  return found;
}
export function gimbalAngle(pitch,convention='magnitude') {
  if(pitch===null) return null;
  const n=convention==='negative'?-pitch:convention==='positive'?pitch:Math.abs(pitch);
  return n>=0 && n<=90?n:null;
}
export function normalizeMetadata(parsed,path,id) {
  const tags=flatten(parsed),lat=coordinate(tags,'latitude'),lon=coordinate(tags,'longitude');
  const relative=pick(tags,['RelativeAltitude']),absolute=pick(tags,['AbsoluteAltitude','GPSAltitude']);
  if(absolute.tag.split(':').at(-1)==='GPSAltitude' && absolute.value!==null) {
    const ref=valueOf(tags,'GPSAltitudeRef');
    if(Number(ref)===1 || /below/i.test(String(ref))) absolute.value=-Math.abs(absolute.value);
  }
  const pitch=pick(tags,['GimbalPitchDegree','GimbalPitch','CameraPitch','CameraPitchDegree']);
  const yaw=pick(tags,['GimbalYawDegree','GimbalYaw','CameraYaw','GPSImgDirection']);
  const roll=pick(tags,['GimbalRollDegree','GimbalRoll','CameraRoll']);
  const gpsValid=lat.value!==null && lon.value!==null && Math.abs(lat.value)<=90 && Math.abs(lon.value)<=180;
  return {id,path,latitude:lat.value,longitude:lon.value,gpsValid,relativeHeight:relative.value,relativeTag:relative.tag,
    absoluteAltitude:absolute.value,absoluteTag:absolute.tag,pitch:pitch.value,pitchTag:pitch.tag,yaw:yaw.value,roll:roll.value,
    gpsTags:[lat.tag,lon.tag].join(' / '),issues:[...(!gpsValid?['Missing/invalid GPS']:[]),...(relative.value===null?['No relative height']:[]),...(pitch.value===null?['No camera pitch']:[])]};
}
export function inRange(value,min,max,includeMissing) {
  return value===null ? includeMissing : value>=min && value<=max;
}
export function insidePolygon(lat,lon,ring) {
  if(!ring?.length || !Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  const p=ring.map(a=>[...a]);
  for(let i=1;i<p.length;i++) p[i][0]=p[i-1][0]+((p[i][0]-p[i-1][0]+540)%360-180);
  const x=p[0][0]+((lon-p[0][0]+540)%360-180),y=lat;
  let inside=false;
  for(let i=0,j=p.length-1;i<p.length;j=i++) {
    const [a,b]=p[i],[c,d]=p[j],dx=c-a,dy=d-b;
    if(Math.abs((x-a)*dy-(y-b)*dx)<=1e-10*Math.max(1,Math.abs(dx),Math.abs(dy)) && x>=Math.min(a,c)-1e-10 && x<=Math.max(a,c)+1e-10 && y>=Math.min(b,d)-1e-10 && y<=Math.max(b,d)+1e-10) return true;
    if((b>y)!==(d>y) && x<a+(y-b)*dx/dy) inside=!inside;
  }
  return inside;
}
export function safePath(path) {
  return path.replaceAll('\\','/').split('/').filter(p=>p && p!=='.' && p!=='..').map(p=>p.replace(/[\u0000-\u001f<>:"|?*]/g,'_')).join('/') || 'photo';
}
export function uniquePath(path,used) {
  const clean=safePath(path); let candidate=clean,n=2;
  const dot=clean.lastIndexOf('.'),slash=clean.lastIndexOf('/');
  const base=dot>slash?clean.slice(0,dot):clean,extension=dot>slash?clean.slice(dot):'';
  while(used.has(candidate.toLowerCase())) candidate=`${base} (${n++})${extension}`;
  used.add(candidate.toLowerCase()); return candidate;
}
export function csv(rows) {
  if(!rows.length) return '';
  const keys=Object.keys(rows[0]);
  const field=v=>{let s=Array.isArray(v)?v.join('; '):String(v??''); if(typeof v==='string' && /^[=+\-@\t\r]/.test(s)) s="'"+s; return '"'+s.replaceAll('"','""')+'"';};
  return [keys.map(field).join(','),...rows.map(r=>keys.map(k=>field(r[k])).join(','))].join('\r\n');
}
