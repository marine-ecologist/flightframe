import {parseDJISrt,matchTelemetry,extractionTimes,frameMetadata,geotagJpeg} from './video-core.js';
import {normalizeMetadata,safePath} from './core.js';
const $=id=>document.getElementById(id);
const seconds=n=>Number(n).toFixed(3);
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
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
export function initVideoTools({setBusy,isBusy,status,onFrames}){
  const video=$('videoPreview');let telemetry=null,videoURL=null,prepared=false,preparing=false,cancelled=false,extracting=false;
  function notice(message,error=false){$('videoStatus').textContent=message;$('videoStatus').classList.toggle('error',error);}
  function refresh(){const active=isBusy();$('extractFrames').disabled=active||preparing||!prepared;$('cancelFrames').disabled=!extracting;$('cancelFrames').hidden=!extracting;}
  function options(){const num=id=>$(id).value.trim()===''?NaN:Number($(id).value);return {start:num('videoStart'),end:num('videoEnd'),interval:num('frameInterval'),duration:video.duration,offset:num('srtOffset'),maxGap:num('srtGap'),quality:num('jpegQuality')/100};}
  async function prepare(){
    if(isBusy()||preparing)return;prepared=false;refresh();
    const clip=$('videoFile').files[0],srt=$('srtFile').files[0];
    if(!clip||!srt){notice('Choose a DJI video and its matching SRT telemetry file.');return;}
    if(srt.size>100*1024*1024){notice('SRT exceeds the 100 MB browser limit. Use a shorter clip/telemetry segment.',true);return;}
    preparing=true;setBusy(true);refresh();notice('Reading clip and subtitle telemetry…');
    try{
      if(videoURL)URL.revokeObjectURL(videoURL);videoURL=URL.createObjectURL(clip);
      await mediaReady(video,videoURL);
      telemetry=parseDJISrt(await srt.text(),{legacyOrder:$('legacyOrder').value});
      if(!telemetry.records.length)throw new Error('No valid SRT cue timestamps found. Supply a DJI .SRT file, not a flight-log CSV.');
      if(!telemetry.validCount)throw new Error(telemetry.zeroCount?'This SRT contains only missing/zero GPS positions (0, 0). It cannot locate video frames. Choose a matching SRT with a valid GPS fix; another recording’s telemetry must not be substituted.':'No valid GPS positions found in this SRT. For older GPS(a,b,c) records, check the tuple-order setting.');
      $('videoStart').value=0;$('videoEnd').value=seconds(video.duration);
      const pitchCount=telemetry.records.filter(r=>r.gpsValid&&r.pitch!==null).length;
      const sameStem=clip.name.replace(/\.[^.]+$/,'').toLowerCase()===srt.name.replace(/\.[^.]+$/,'').toLowerCase();
      $('pairWarning').hidden=sameStem;$('confirmPair').checked=sameStem;
      notice(`${clip.name}: ${video.videoWidth} × ${video.videoHeight}, ${seconds(video.duration)} s. ${telemetry.validCount} GPS cues; ${pitchCount} with gimbal pitch. SRT: ${seconds(telemetry.records[0].start)}–${seconds(telemetry.records.at(-1).end)} s.${pitchCount?'':' No camera pitch in SRT: the fallback defaults to assumed −90° (downward); clear it to leave pitch unknown.'}${telemetry.zeroCount?` ${telemetry.zeroCount} zero-GPS cue(s) will be skipped.`:''}${telemetry.malformed?` ${telemetry.malformed} malformed cue(s) ignored.`:''}`);
      prepared=true;
    }catch(e){notice(e.message,true);}
    finally{preparing=false;setBusy(false);refresh();}
  }
  $('videoFile').onchange=prepare;$('srtFile').onchange=prepare;$('legacyOrder').onchange=prepare;
  $('cancelFrames').onclick=()=>{cancelled=true;notice('Cancelling after the current frame…');};
  $('extractFrames').onclick=async()=>{
    if(isBusy()||!prepared)return;
    let config,times;
    try{
      config=options();times=extractionTimes(config);
      if(!Number.isFinite(config.offset)||!Number.isFinite(config.maxGap)||config.maxGap<0||config.maxGap>5||!Number.isFinite(config.quality)||config.quality<.5||config.quality>1)throw new Error('Check the timing offset, maximum telemetry gap (0–5 seconds), and JPEG quality (50–100%).');
      if(!$('confirmPair').checked)throw new Error('The filenames differ. Confirm that this SRT belongs to the chosen video.');
      const hasMatch=times.some(t=>matchTelemetry(telemetry.records,t+config.offset,config.maxGap));
      if(!hasMatch)throw new Error('No GPS telemetry matches this clip range. Check the range and SRT time offset.');
      const override=$('pitchFallback').value.trim()===''?null:Number($('pitchFallback').value);
      if(override!==null&&(!Number.isFinite(override)||override< -90||override>90))throw new Error('Known fallback gimbal pitch must be between −90° and +90°.');
      config.pitchOverride=override;
    }catch(e){notice(e.message,true);return;}
    setBusy(true);extracting=true;cancelled=false;refresh();video.pause();video.controls=false;
    const canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;
    const context=canvas.getContext('2d');const frames=[];let totalBytes=0,skipped=0,lastDecoded=-Infinity;
    const clip=$('videoFile').files[0],srt=$('srtFile').files[0],stem=safePath(clip.name.replace(/\.[^.]+$/,''));
    try{
      if(!context)throw new Error('Canvas is unavailable in this browser.');
      for(let i=0;i<times.length;i++){
        if(cancelled)throw new Error('Extraction cancelled. Your previous survey is unchanged.');
        const frame=await seekVideoFrame(video,times[i]);
        if(cancelled)throw new Error('Extraction cancelled. Your previous survey is unchanged.');
        // Avoid duplicate decoded frames for a sampling rate above the video frame rate.
        const match=matchTelemetry(telemetry.records,frame.time+config.offset,config.maxGap);
        if(frame.time<=lastDecoded+1e-7||!match){skipped++;continue;}
        lastDecoded=frame.time;
        const meta=frameMetadata(match.record,{pitchOverride:config.pitchOverride});
        context.drawImage(video,0,0,canvas.width,canvas.height);
        const raw=await jpegBlob(canvas,config.quality);
        const tagged=geotagJpeg(new Uint8Array(await raw.arrayBuffer()),meta,{width:canvas.width,height:canvas.height,
          SourceVideo:clip.name,SourceSRT:srt.name,VideoSeconds:seconds(frame.time),RequestedVideoSeconds:seconds(times[i]),FrameTiming:frame.timing,
          SRTSeconds:seconds(frame.time+config.offset),SRTCueSeconds:seconds(meta.start),TelemetryGapSeconds:seconds(match.gapSeconds),SRTOffsetSeconds:config.offset});
        totalBytes+=tagged.length;if(totalBytes>500*1024*1024)throw new Error('Extracted JPEGs exceed the 500 MB working-memory limit. Use a shorter range or larger frame interval. Your previous survey is unchanged.');
        const name=`${stem}_frame_${String(i+1).padStart(6,'0')}_${Math.round(frame.time*1000)}ms.jpg`;
        const file=new File([tagged],name,{type:'image/jpeg'});
        const data={latitude:meta.latitude,longitude:meta.longitude,RelativeAltitude:meta.relativeHeight,AbsoluteAltitude:meta.absoluteAltitude,GimbalPitchDegree:meta.pitch,GimbalYawDegree:meta.yaw,GimbalRollDegree:meta.roll};
        const photo=normalizeMetadata(data,`${stem}_stills/${name}`,`video-${i}`);photo.file=file;
        photo.relativeTag=meta.relativeHeight===null?'':'SRT relative altitude';photo.absoluteTag=meta.absoluteAltitude===null?'':'SRT absolute altitude (datum unverified)';photo.pitchTag=meta.pitchSource;photo.gpsTags='SRT latitude / longitude';
        photo.videoSource=clip.name;photo.videoSeconds=frame.time;photo.requestedVideoSeconds=times[i];photo.frameTiming=frame.timing;photo.srtSource=srt.name;photo.srtSeconds=frame.time+config.offset;photo.srtCueSeconds=meta.start;photo.srtOffsetSeconds=config.offset;photo.telemetryGapSeconds=match.gapSeconds;
        if(meta.pitchSource.startsWith('User'))photo.issues.push('Assumed gimbal pitch from user fallback');
        if(frame.timing==='seek timeline estimate')photo.issues.push('Frame time estimated from browser seek');
        frames.push(photo);$('progress').value=(i+1)/times.length;notice(`Extracting JPEG ${i+1} / ${times.length} · ${frames.length} geotagged · ${skipped} skipped`);await wait(0);
      }
      if(!frames.length)throw new Error('No geotagged frames were produced. Check the clip, telemetry alignment and valid GPS coverage.');
      onFrames(frames);
      const missing=frames.some(p=>p.pitch===null);
      notice(`Created ${frames.length} full-resolution geotagged JPEGs; ${skipped} unmatched or duplicate frames skipped. Previous survey replaced. Use the map, then ZIP or folder export.${missing?' Missing-angle filtering has been enabled because some frames have no camera pitch.':''}`);
      status(`Video extraction complete: ${frames.length} geotagged stills ready for selection and export.`);
    }catch(e){notice(e.message,true);status(e.message,true);}
    finally{canvas.width=0;canvas.height=0;video.controls=true;extracting=false;setBusy(false);refresh();}
  };
  document.addEventListener('flightframe:idle',refresh);
  refresh();
}
