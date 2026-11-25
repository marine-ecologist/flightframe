import {parseDJISrt,matchTelemetry,srtExtractionTimes,frameMetadata,geotagJpeg,pairVideoFiles,buildVideoTimeline,timelinePosition,telemetryTime,mergedTelemetry,telemetrySrt,videoInputPath} from './video-core.js?v=srt2';
import {normalizeMetadata,safePath} from './core.js';
const $=id=>document.getElementById(id);
const seconds=n=>Number(n).toFixed(3);
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function readLocalFile(file,operation){
  try{return await operation();}
  catch(error){throw new Error(`Cannot read ${videoInputPath(file)}: ${error.message}. Ensure the file is fully downloaded and accessible locally (not an unavailable cloud placeholder or disconnected drive), then select the folder again. If it still fails, try the matching pair in Single file mode.`);}
}
function mediaReady(video,file){
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>finish(new Error('Video decoder timed out. Try an H.264 MP4, or another supported browser.')),20000);
    const ready=()=>{if(video.readyState>=2&&video.videoWidth&&Number.isFinite(video.duration)&&video.duration>0)finish();};
    const failure=()=>finish(new Error('This browser cannot decode this clip. Try an H.264 MP4; DJI H.265/HEVC support depends on browser and operating system.'));
    const finish=error=>{clearTimeout(timer);video.removeEventListener('loadeddata',ready);video.removeEventListener('error',failure);error?reject(error):resolve();};
    video.addEventListener('loadeddata',ready);video.addEventListener('error',failure);video.src=file;video.load();
  });
}
export async function seekVideoFrame(video,target){
  // A compositor callback identifies the decoded frame timestamp when available.
  // Older browsers fall back to the seek timeline; the manifest labels that estimate.
  if(Math.abs(video.currentTime-target)<1e-7 && video.readyState>=2)return {time:video.currentTime,timing:'seek timeline estimate'};
  return new Promise((resolve,reject)=>{
    let frameId=null,frame=null,seekDone=false,settled=false,fallbackTimer=null;
    const timer=setTimeout(()=>finish(new Error('Timed out decoding a video frame. Try a shorter clip or an H.264 MP4.')),20000);
    const cleanup=()=>{clearTimeout(timer);clearTimeout(fallbackTimer);video.removeEventListener('seeked',seeked);video.removeEventListener('error',error);if(frameId!==null)video.cancelVideoFrameCallback?.(frameId);};
    const finish=(err,value)=>{if(settled)return;settled=true;cleanup();err?reject(err):resolve(value);};
    const seeked=()=>{seekDone=true;if(frame)finish(null,frame);else fallbackTimer=setTimeout(()=>finish(null,{time:video.currentTime,timing:'seek timeline estimate'}),250);};
    const error=()=>finish(new Error('The browser failed to decode this video frame.'));
    video.addEventListener('seeked',seeked);video.addEventListener('error',error);
    if(video.requestVideoFrameCallback)frameId=video.requestVideoFrameCallback((now,meta)=>{frame={time:meta.mediaTime,timing:'decoded frame timestamp'};if(seekDone)finish(null,frame);});
    video.currentTime=target;
  });
}
function jpegBlob(canvas,quality){return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Frame encoding failed. The video dimensions may exceed browser limits.')),'image/jpeg',quality));}
export function initVideoTools({setBusy,isBusy,status,onFrames,download,onExport}){
  const video=$('videoPreview');
  let inputMode='single',plan={segments:[],duration:0},videoURL=null,activeSegment=-1;
  let prepared=false,preparing=false,cancelled=false,extracting=false,hasExtracted=false,batchStem='video';
  function notice(message,error=false){$('videoStatus').textContent=message;$('videoStatus').classList.toggle('error',error);}
  function refresh(){
    const active=isBusy();
    $('extractFrames').disabled=active||preparing||!prepared;
    $('cancelFrames').disabled=!extracting;$('cancelFrames').hidden=!extracting;
    $('combinedSrt').disabled=active||!prepared;
    $('downloadVideoFrames').disabled=active||!hasExtracted;
  }
  function options(){
    const num=id=>$(id).value.trim()===''?NaN:Number($(id).value);
    return {start:num('videoStart'),end:num('videoEnd'),interval:num('frameInterval'),duration:plan.duration,offset:0,maxGap:num('srtGap'),quality:num('jpegQuality')/100,clock:'per-clip'};
  }
  async function openSegment(segment){
    if(activeSegment===segment.index&&video.readyState>=2)return;
    video.pause();activeSegment=-1;
    video.removeAttribute('src');video.load();
    if(videoURL)URL.revokeObjectURL(videoURL);
    await readLocalFile(segment.clip,()=>segment.clip.slice(0,1).arrayBuffer());
    videoURL=URL.createObjectURL(segment.clip);
    try{await mediaReady(video,videoURL);}catch(error){throw new Error(`${segment.sourcePath}: ${error.message}`);}activeSegment=segment.index;
  }
  function manifest(){
    const body=$('videoManifestRows');body.replaceChildren();
    for(const segment of plan.segments){
      const row=document.createElement('tr');
      for(const text of [segment.index+1,`${segment.sourcePath} / ${segment.srtPath}`,`${seconds(segment.timelineStart)}–${seconds(segment.timelineEnd)}`,`${segment.width} × ${segment.height}`,`${segment.telemetry.validCount} / ${segment.telemetry.records.length}`]){
        const cell=document.createElement('td');cell.textContent=text;row.append(cell);
      }
      body.append(row);
    }
    $('videoManifest').hidden=!plan.segments.length;
    $('videoManifestSummary').textContent=`${plan.segments.length} clip(s) · ${seconds(plan.duration)} seconds on one processing timeline. Original MP4/MOV files are not re-encoded or modified. The preview shows the active source clip.`;
  }
  async function prepare(){
    if(isBusy()||preparing)return;
    prepared=false;activeSegment=-1;plan={segments:[],duration:0};manifest();refresh();$('videoExportActions').hidden=true;
    let pairs,warnings=[];
    if(inputMode==='folder'){
      const files=Array.from($('videoFolder').files);
      if(!files.length){notice('Choose one folder containing your MP4 clips and their matching SRT files.');return;}
      const matched=pairVideoFiles(files);warnings=matched.warnings;
      if(matched.errors.length){notice(matched.errors.join('\n'),true);return;}
      pairs=matched.pairs;
      batchStem=safePath((files[0].webkitRelativePath||'folder').split('/')[0]);
    }else{
      const files=Array.from($('videoPair').files);
      if(!files.length){notice('Choose the video and its same-named SRT together.');return;}
      const matched=pairVideoFiles(files);warnings=matched.warnings;
      if(matched.errors.length){notice(matched.errors.join('\n'),true);return;}
      if(matched.pairs.length!==1){notice('Single file mode needs exactly one matching video/SRT pair. Use Folder for several clips.',true);return;}
      pairs=matched.pairs;batchStem=safePath(pairs[0].clip.name.replace(/\.[^.]+$/,''));
    }
    preparing=true;setBusy(true);refresh();
    try{
      const clips=[];
      for(let i=0;i<pairs.length;i++){
        const pair=pairs[i];notice(`Preparing clip ${i+1} / ${pairs.length}: ${pair.sourcePath}`);
        const segment={...pair,index:i};await openSegment(segment);
        const telemetry=parseDJISrt(await readLocalFile(pair.srt,()=>pair.srt.text()),{legacyOrder:$('legacyOrder').value});
        if(!telemetry.records.length)throw new Error(`${pair.srtPath}: no valid SRT cue timestamps found.`);
        clips.push({...segment,duration:video.duration,width:video.videoWidth,height:video.videoHeight,telemetry});
        $('progress').value=(i+1)/pairs.length;await wait(0);
      }
      const validCount=clips.reduce((n,c)=>n+c.telemetry.validCount,0);
      if(!validCount)throw new Error('No usable GPS fixes in these SRT files. Zero/zero coordinates are skipped. Choose matching telemetry with a valid GPS fix; another recording’s SRT must not be substituted.');
      plan=buildVideoTimeline(clips);manifest();
      $('videoStart').value=0;$('videoEnd').value=String(Number(plan.duration.toFixed(6)));
      const pitchCount=clips.reduce((n,c)=>n+c.telemetry.records.filter(r=>r.gpsValid&&r.pitch!==null).length,0);
      const zeroCount=clips.reduce((n,c)=>n+c.telemetry.zeroCount,0),noGpsClips=clips.filter(c=>!c.telemetry.validCount).length;
      await openSegment(plan.segments[0]);
      notice(`${clips.length} automatically matched clip/SRT pair(s) ready as one ${seconds(plan.duration)} s timeline. Extraction uses each SRT’s elapsed cue times. ${validCount} GPS cues; ${pitchCount} with gimbal pitch.${pitchCount?'':' Missing pitch defaults to assumed −90°; clear the fallback to leave it unknown.'}${zeroCount?` ${zeroCount} zero-GPS cues will be skipped.`:''}${noGpsClips?` ${noGpsClips} clip(s) have no usable GPS and will contribute no geotagged frames.`:''}${warnings.length?'\n'+warnings.join('\n'):''}`);
      prepared=true;
    }catch(e){plan={segments:[],duration:0};manifest();notice(e.message,true);}
    finally{preparing=false;setBusy(false);refresh();}
  }
  function switchMode(mode){
    if(isBusy())return;
    inputMode=mode;
    for(const [tab,panel,key]of [['singleVideoTab','singleVideoPanel','single'],['folderVideoTab','folderVideoPanel','folder']]){
      $(tab).setAttribute('aria-selected',String(key===mode));$(tab).tabIndex=key===mode?0:-1;$(panel).hidden=key!==mode;
    }
    prepare();
  }
  for(const [id,mode]of [['singleVideoTab','single'],['folderVideoTab','folder']]){
    $(id).onclick=()=>switchMode(mode);
    $(id).onkeydown=event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const next=event.key==='Home'?'single':event.key==='End'?'folder':inputMode==='single'?'folder':'single';switchMode(next);$(next==='single'?'singleVideoTab':'folderVideoTab').focus();}};
  }
  $('videoPair').onchange=prepare;$('videoFolder').onchange=prepare;$('legacyOrder').onchange=prepare;
  $('combinedSrt').onclick=()=>{
    if(isBusy()||!prepared)return;const config=options();
    if(!Number.isFinite(config.offset)){notice('Set a valid SRT time offset before downloading combined telemetry.',true);return;}
    const records=mergedTelemetry(plan.segments,config.clock,config.offset);
    download(new Blob([telemetrySrt(records)],{type:'application/x-subrip;charset=utf-8'}),`${batchStem}_combined.srt`);
  };
  $('downloadVideoFrames').onclick=()=>{if(!isBusy()&&hasExtracted)onExport();};
  $('cancelFrames').onclick=()=>{cancelled=true;notice('Cancelling after the current frame…');};
  $('extractFrames').onclick=async()=>{
    if(isBusy()||!prepared)return;
    let config,times;
    try{
      config=options();times=srtExtractionTimes(plan.segments,config);
      if(!Number.isFinite(config.offset)||!Number.isFinite(config.maxGap)||config.maxGap<0||config.maxGap>5||!Number.isFinite(config.quality)||config.quality<.5||config.quality>1)throw new Error('Check the timing offset, maximum telemetry gap (0–5 seconds), and JPEG quality (50–100%).');
      const hasMatch=times.some(time=>{const position=timelinePosition(plan.segments,time);return position&&matchTelemetry(position.segment.telemetry.records,telemetryTime(position.segment,position.localTime,config.offset,config.clock),config.maxGap);});
      if(!hasMatch)throw new Error('No GPS telemetry matches this timeline range. Check that the SRT contains valid GPS cues within its matching video duration and the selected range.');
      const override=$('pitchFallback').value.trim()===''?null:Number($('pitchFallback').value);
      if(override!==null&&(!Number.isFinite(override)||override< -90||override>90))throw new Error('Fallback gimbal pitch must be between −90° and +90°.');
      config.pitchOverride=override;
    }catch(e){notice(e.message,true);return;}
    setBusy(true);extracting=true;cancelled=false;refresh();video.pause();video.controls=false;
    const canvas=document.createElement('canvas'),context=canvas.getContext('2d'),frames=[];
    let skipped=0,lastDecoded=-Infinity,lastSegment=-1;
    try{
      if(!context)throw new Error('Canvas is unavailable in this browser.');
      for(let i=0;i<times.length;i++){
        if(cancelled)throw new Error('Extraction cancelled. Your previous survey is unchanged.');
        const position=timelinePosition(plan.segments,times[i]);if(!position){skipped++;continue;}
        const {segment,localTime}=position;
        await openSegment(segment);
        if(lastSegment!==segment.index){canvas.width=segment.width;canvas.height=segment.height;lastDecoded=-Infinity;lastSegment=segment.index;}
        const frame=await seekVideoFrame(video,localTime);
        if(cancelled)throw new Error('Extraction cancelled. Your previous survey is unchanged.');
        const srtTime=telemetryTime(segment,frame.time,config.offset,config.clock),combinedTime=segment.timelineStart+frame.time;
        const match=matchTelemetry(segment.telemetry.records,srtTime,config.maxGap);
        // Only the active clip's telemetry can locate a frame. Never bridge a clip boundary.
        if(frame.time<=lastDecoded+1e-7||frame.time>=segment.duration||!match){skipped++;$('progress').value=(i+1)/times.length;continue;}
        lastDecoded=frame.time;const meta=frameMetadata(match.record,{pitchOverride:config.pitchOverride});
        context.drawImage(video,0,0,canvas.width,canvas.height);const raw=await jpegBlob(canvas,config.quality);
        const tagged=geotagJpeg(new Uint8Array(await raw.arrayBuffer()),meta,{width:canvas.width,height:canvas.height,
          SourceVideo:segment.sourcePath,SourceSRT:segment.srtPath,VideoSeconds:seconds(frame.time),RequestedVideoSeconds:seconds(localTime),TimelineSeconds:seconds(combinedTime),RequestedTimelineSeconds:seconds(times[i]),ClipIndex:segment.index+1,FrameTiming:frame.timing,
          SRTSeconds:seconds(srtTime),SRTCueSeconds:seconds(meta.start),TelemetryGapSeconds:seconds(match.gapSeconds),SRTOffsetSeconds:config.offset,SRTClock:config.clock});
        const clipStem=safePath(segment.clip.name.replace(/\.[^.]+$/,'')),name=`frame_${String(i+1).padStart(6,'0')}_${Math.round(combinedTime*1000)}ms_${clipStem}.jpg`;
        const file=new File([tagged],name,{type:'image/jpeg'});
        const data={latitude:meta.latitude,longitude:meta.longitude,RelativeAltitude:meta.relativeHeight,AbsoluteAltitude:meta.absoluteAltitude,GimbalPitchDegree:meta.pitch,GimbalYawDegree:meta.yaw,GimbalRollDegree:meta.roll};
        const photo=normalizeMetadata(data,`${batchStem}_stills/${name}`,`video-${i}`);photo.file=file;
        photo.relativeTag=meta.relativeHeight===null?'':'SRT relative altitude';photo.absoluteTag=meta.absoluteAltitude===null?'':'SRT absolute altitude (datum unverified)';photo.pitchTag=meta.pitchSource;photo.gpsTags='SRT latitude / longitude';
        Object.assign(photo,{videoSource:segment.sourcePath,videoSeconds:frame.time,requestedVideoSeconds:localTime,frameTiming:frame.timing,srtSource:segment.srtPath,srtSeconds:srtTime,srtCueSeconds:meta.start,srtOffsetSeconds:config.offset,telemetryGapSeconds:match.gapSeconds,timelineSeconds:combinedTime,requestedTimelineSeconds:times[i],clipIndex:segment.index+1,srtClock:config.clock});
        if(meta.pitchSource.startsWith('User'))photo.issues.push('Assumed gimbal pitch from user fallback');
        if(frame.timing==='seek timeline estimate')photo.issues.push('Frame time estimated from browser seek');
        frames.push(photo);$('progress').value=(i+1)/times.length;
        notice(`Clip ${segment.index+1} / ${plan.segments.length} · ${segment.clip.name} · frame ${i+1} / ${times.length} · ${frames.length} geotagged · ${skipped} skipped`);await wait(0);
      }
      if(!frames.length)throw new Error('No geotagged frames were produced. Check the clips, telemetry alignment and valid GPS coverage.');
      onFrames(frames);hasExtracted=true;$('videoExportActions').hidden=false;
      const missing=frames.some(p=>p.pitch===null);
      notice(`Created ${frames.length} full-resolution geotagged JPEGs from ${new Set(frames.map(p=>p.clipIndex)).size} clip(s) on one timeline; ${skipped} unmatched or duplicate frames skipped. Nothing saved yet: use the download button below.${missing?' Missing-angle filtering has been enabled.':''}`);
      status(`Extraction complete: ${frames.length} geotagged stills in memory. Download the stills before closing this page.`);
    }catch(e){notice(e.message,true);status(e.message,true);}
    finally{canvas.width=0;canvas.height=0;video.controls=true;extracting=false;setBusy(false);refresh();}
  };
  document.addEventListener('flightframe:idle',refresh);
  document.addEventListener('flightframe:photos-loaded',()=>{hasExtracted=false;$('videoExportActions').hidden=true;refresh();});
  refresh();
}
