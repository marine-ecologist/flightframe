import {normalizeMetadata,gimbalAngle,inRange,insidePolygon,uniquePath,csv} from './core.js';
const $=id=>document.getElementById(id),fmt=v=>v===null?'—':Number(v).toFixed(2).replace(/\.00$/,'');
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const map=L.map('map',{preferCanvas:true,worldCopyJump:true}).setView([19.32,-81.25],9);
const tiles=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).addTo(map);
const points=L.layerGroup().addTo(map),shapes=L.featureGroup().addTo(map);
map.addControl(new L.Control.Draw({draw:{polyline:false,circle:false,marker:false,circlemarker:false,polygon:{allowIntersection:false,showArea:false},rectangle:{}},edit:{featureGroup:shapes,edit:true,remove:true}}));
let photos=[],filtered=[],selected=[],mode='none',ring=null,busy=false,lastReport=[];
const supported=/\.(jpe?g|tiff?|dng|heic|heif|png|avif|webp|arw|cr2|cr3|nef|orf|rw2|raf)$/i;
function status(message,error=false){$('status').textContent=message;$('status').classList.toggle('error',error);}
function setBusy(value){busy=value;document.querySelectorAll('button,input,select').forEach(el=>el.disabled=value);$('progress').hidden=!value;if(!value)render();}
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}
function reportRows(data){return data.map(p=>({path:p.path,latitude:p.latitude,longitude:p.longitude,gps_valid:p.gpsValid,relative_height_m:p.relativeHeight,relative_height_tag:p.relativeTag,absolute_altitude_m:p.absoluteAltitude,absolute_altitude_tag:p.absoluteTag,gimbal_angle_deg:gimbalAngle(p.pitch,$('convention').value),raw_camera_pitch_deg:p.pitch,pitch_tag:p.pitchTag,yaw_deg:p.yaw,roll_deg:p.roll,gps_tags:p.gpsTags,status:p.issues,selected:selected.includes(p)}));}
function extent(){const values=photos.map(p=>p[$('heightBasis').value]).filter(v=>v!==null);$('heightMin').value=values.length?Math.floor(values.reduce((a,b)=>Math.min(a,b),Infinity)):0;$('heightMax').value=values.length?Math.ceil(values.reduce((a,b)=>Math.max(a,b),-Infinity)):150;}
function reset(){extent();$('angleMin').value=0;$('angleMax').value=90;$('missingHeight').checked=false;$('missingAngle').checked=false;render();}
function fit(){if(!filtered.length)return;const bounds=L.latLngBounds(filtered.map(p=>[p.latitude,p.longitude<0 && filtered.some(q=>q.longitude>170)?p.longitude+360:p.longitude]));map.fitBounds(bounds.pad(.1),{maxZoom:19});}
function values(){return ['heightMin','heightMax','angleMin','angleMax'].map(id=>$(id).value.trim()===''?NaN:Number($(id).value));}
function render(){
  const [hmin,hmax,amin,amax]=values();
  const valid=[hmin,hmax,amin,amax].every(Number.isFinite)&&hmin<=hmax&&amin<=amax&&amin>=0&&amax<=90;
  filtered=valid?photos.filter(p=>p.gpsValid && inRange(p[$('heightBasis').value],hmin,hmax,$('missingHeight').checked) && inRange(gimbalAngle(p.pitch,$('convention').value),amin,amax,$('missingAngle').checked)):[];
  selected=filtered.filter(p=>mode==='all'||(mode==='shape'&&insidePolygon(p.latitude,p.longitude,ring)));
  $('loaded').textContent=photos.length;$('gps').textContent=photos.filter(p=>p.gpsValid).length;$('filtered').textContent=filtered.length;$('selected').textContent=selected.length;
  $('selectionMode').textContent=mode==='none'?'No selection · draw an area to begin':mode==='all'?'All filtered GPS points selected':'Drawn area ∩ current filters';
  if(!valid) $('selectionMode').textContent='Check ranges: minimum ≤ maximum; gimbal 0–90°';
  points.clearLayers();const selectedIds=new Set(selected.map(p=>p.id));
  for(const p of filtered){const chosen=selectedIds.has(p.id),body=document.createElement('div');
    const title=document.createElement('strong');title.textContent=p.path;body.append(title,document.createElement('br'));
    const details=document.createElement('span');details.textContent=`Relative: ${fmt(p.relativeHeight)} m · Absolute: ${fmt(p.absoluteAltitude)} m · Gimbal: ${fmt(gimbalAngle(p.pitch,$('convention').value))}° · Raw pitch: ${fmt(p.pitch)}° (${p.pitchTag||'missing'})`;body.append(details);
    L.circleMarker([p.latitude,p.longitude],{radius:chosen?7:5,color:chosen?'#df841c':'#277b80',weight:2,fillOpacity:.8}).bindPopup(body).addTo(points);
  }
  const inventory=$('onlySelected').checked?selected:photos;
  const body=$('rows');body.replaceChildren();
  for(const p of inventory.slice(0,500)){const row=document.createElement('tr'),chosen=selectedIds.has(p.id);if(chosen)row.className='selected-row';
    for(const value of [p.path,chosen?'Selected':p.gpsValid?'—':'No GPS',fmt(p.relativeHeight),fmt(p.absoluteAltitude),fmt(gimbalAngle(p.pitch,$('convention').value)),`${fmt(p.pitch)} / ${p.pitchTag||'missing'}`,p.issues.join('; ')||'Ready']){const cell=document.createElement('td');cell.textContent=value;row.append(cell);}body.append(row);
  }
  $('inventoryInfo').textContent=`Showing ${Math.min(500,inventory.length)} of ${inventory.length} files. Metadata CSV includes every imported photograph. ${photos.filter(p=>!p.gpsValid).length} without valid GPS.`;
  $('zip').disabled=busy||!selected.length;$('copy').disabled=busy||!selected.length||!window.showDirectoryPicker;$('report').disabled=busy||!lastReport.length;
}
async function load(files){
  if(busy)return;
  const list=Array.from(files).filter(f=>supported.test(f.name));
  if(!list.length){status('No supported photographs found. Choose JPG, TIFF, DNG, HEIC, PNG or other listed image formats.',true);return;}
  setBusy(true);const loaded=[];
  try {
    for(let i=0;i<list.length;i++){
      const file=list[i];let parsed={},error='';
      try{parsed=await exifr.parse(file,{xmp:true,mergeOutput:false,translateValues:false,sanitize:true})||{};}catch(e){error=`Browser metadata reader: ${e.message}`;}
      const path=file.webkitRelativePath||file.name;
      const photo=normalizeMetadata(parsed,path,String(i));photo.file=file;if(error)photo.issues.push(error);
      if(gimbalAngle(photo.pitch)===null&&photo.pitch!==null)photo.issues.push('Pitch outside supported ±90°');
      loaded.push(photo);$('progress').value=(i+1)/list.length;status(`Reading metadata · ${i+1} / ${list.length} · ${path}`);await tick();
    }
    photos=loaded;mode='none';ring=null;shapes.clearLayers();lastReport=[];reset();fit();
    status(`Loaded ${photos.length} photographs. Draw a polygon or rectangle, or select all filtered points.`);
  }catch(e){status(`Import stopped: ${e.message}. Previous survey retained.`,true);}finally{setBusy(false);$('folder').value='';$('files').value='';}
}
$('folder').onchange=e=>load(e.target.files);$('files').onchange=e=>load(e.target.files);
map.on(L.Draw.Event.CREATED,e=>{if(busy)return;shapes.clearLayers();shapes.addLayer(e.layer);ring=e.layer.toGeoJSON().geometry.coordinates[0];mode='shape';render();});
map.on(L.Draw.Event.EDITED,()=>{if(busy)return;const layer=shapes.getLayers()[0];ring=layer?.toGeoJSON().geometry.coordinates[0]||null;mode=ring?'shape':'none';render();});
map.on(L.Draw.Event.DELETED,()=>{if(busy)return;ring=null;mode='none';render();});
for(const id of ['heightMin','heightMax','angleMin','angleMax','missingHeight','missingAngle','convention','onlySelected'])$(id).addEventListener('change',render);
$('heightBasis').onchange=()=>{extent();render();};$('reset').onclick=reset;$('fit').onclick=fit;
$('all').onclick=()=>{mode='all';ring=null;shapes.clearLayers();render();};$('clear').onclick=()=>{mode='none';ring=null;shapes.clearLayers();render();};
$('tiles').onchange=()=>{$('tiles').checked?tiles.addTo(map):map.removeLayer(tiles);};
$('csv').onclick=()=>download(new Blob([csv(reportRows(photos))],{type:'text/csv;charset=utf-8'}),'drone-metadata.csv');
$('report').onclick=()=>download(new Blob([csv(lastReport)],{type:'text/csv;charset=utf-8'}),'drone-export-report.csv');
$('folderSupport').textContent=window.showDirectoryPicker?'Direct folder export is supported in this browser.':'Direct folder export is unavailable here. Use ZIP, or open this page in Chrome / Edge over HTTPS.';
async function exportZip(){
  if(busy||!selected.length)return;
  const snapshot=[...selected],size=snapshot.reduce((n,p)=>n+p.file.size,0);
  if(snapshot.length>=65535 || snapshot.some(p=>p.file.size>=0xffffffff)){status('This selection exceeds the ZIP format limits used here. Export to a folder or use smaller batches.',true);return;}
  if(size>750*1024*1024){status('Selection exceeds the 750 MB in-memory ZIP limit. Use folder export in Chrome/Edge, or export smaller selections.',true);return;}
  setBusy(true);lastReport=[];const chunks=[],used=new Set(['_drone-export-report.csv']);let zipError=null;
  try{
    let done;const complete=new Promise(resolve=>done=resolve);
    const archive=new fflate.Zip((err,data,final)=>{if(err)zipError=err;else chunks.push(data);if(final||err)done();});
    for(let i=0;i<snapshot.length;i++){
      const p=snapshot[i],path=uniquePath(p.path,used),entry=new fflate.ZipPassThrough(path);
      archive.add(entry);const reader=p.file.stream().getReader();
      try{while(true){const chunk=await reader.read();if(chunk.done)break;entry.push(chunk.value,false);if(zipError)throw zipError;}entry.push(new Uint8Array(0),true);}finally{reader.releaseLock();}
      lastReport.push({source:p.path,destination:path,status:'archived',bytes:p.file.size,message:'Original bytes added to ZIP'});
      $('progress').value=(i+1)/snapshot.length;status(`Preparing ZIP · ${i+1} / ${snapshot.length}`);await tick();
    }
    const manifest=new fflate.ZipPassThrough('_drone-export-report.csv');archive.add(manifest);manifest.push(fflate.strToU8(csv(lastReport)),true);archive.end();await complete;if(zipError)throw zipError;
    download(new Blob(chunks,{type:'application/zip'}),'flightframe-selected-photos.zip');
    status(`ZIP ready: ${snapshot.length} original photographs plus export report. Check your browser’s downloads.`);
  }catch(e){status(`ZIP failed: ${e.message}. Use folder export or a smaller selection.`,true);lastReport=[];}finally{setBusy(false);}
}
$('zip').onclick=exportZip;
$('copy').onclick=async()=>{
  if(busy||!selected.length||!window.showDirectoryPicker)return;
  const snapshot=[...selected];let root;
  try{root=await window.showDirectoryPicker({mode:'readwrite'});}catch(e){if(e.name!=='AbortError')status(e.message,true);return;}
  setBusy(true);lastReport=[];const used=new Set();
  try{for(let i=0;i<snapshot.length;i++){
    const p=snapshot[i],path=uniquePath(p.path,used);let outcome='copied',message='Original bytes copied';
    try{
      const parts=path.split('/');let folder=root;
      for(const part of parts.slice(0,-1))folder=await folder.getDirectoryHandle(part,{create:true});
      let exists=false;try{await folder.getFileHandle(parts.at(-1));exists=true;}catch(e){if(e.name!=='NotFoundError')throw e;}
      if(exists){outcome='skipped';message='Destination already exists; left unchanged';}
      else{const target=await folder.getFileHandle(parts.at(-1),{create:true});const writer=await target.createWritable();try{await p.file.stream().pipeTo(writer);}catch(e){throw new Error(`Write failed; inspect destination: ${e.message}`);}const result=await target.getFile();if(result.size!==p.file.size)throw new Error('File size differs; inspect destination');}
    }catch(e){outcome='failed';message=e.message;}
    lastReport.push({source:p.path,destination:path,status:outcome,bytes:p.file.size,message});
    $('progress').value=(i+1)/snapshot.length;status(`Copying originals · ${i+1} / ${snapshot.length}`);await tick();
  }
  const count=s=>lastReport.filter(r=>r.status===s).length;status(`Folder export finished · ${count('copied')} copied · ${count('skipped')} skipped · ${count('failed')} failed. Download the export report.`);
  }finally{setBusy(false);}
};
render();
