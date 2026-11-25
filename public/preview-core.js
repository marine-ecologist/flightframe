// Project camera corner rays onto a horizontal plane in local east/north/up metres.
export function flatFootprint(photo,{heightBasis='relativeHeight',ground=0,fov=70,aspect=4/3,heading=0,pitchConvention='negative'}={}){
  const altitude=photo[heightBasis],yaw=photo.yaw??heading;
  const pitch=photo.pitch===null?-90:pitchConvention==='positive'?-photo.pitch:pitchConvention==='magnitude'?-Math.abs(photo.pitch):photo.pitch;
  const roll=photo.roll??0,h=altitude-ground;
  if(!photo.gpsValid||altitude===null||![h,yaw,pitch,roll,fov,aspect,photo.latitude,photo.longitude].every(Number.isFinite)||h<=0||fov<=0||fov>=180||aspect<=0||pitch< -90||pitch>=0)return null;
  const rad=Math.PI/180,y=yaw*rad,p=pitch*rad,r=roll*rad;
  const forward=[Math.sin(y)*Math.cos(p),Math.cos(y)*Math.cos(p),Math.sin(p)];
  const right=[Math.cos(y),-Math.sin(y),0],up=[-Math.sin(y)*Math.sin(p),-Math.cos(y)*Math.sin(p),Math.cos(p)];
  const rr=right.map((v,i)=>v*Math.cos(r)-up[i]*Math.sin(r)),uu=up.map((v,i)=>v*Math.cos(r)+right[i]*Math.sin(r));
  const tx=Math.tan(fov*rad/2),ty=tx/aspect,cosLat=Math.cos(photo.latitude*rad);
  if(Math.abs(cosLat)<1e-6)return null;
  const corners=[];
  for(const [x,z] of [[-tx,ty],[tx,ty],[tx,-ty],[-tx,-ty]]){
    const ray=forward.map((v,i)=>v+x*rr[i]+z*uu[i]);
    if(ray[2]>=-1e-8)return null; // A corner at/above the horizon has no finite ground footprint.
    const scale=-h/ray[2],east=ray[0]*scale,north=ray[1]*scale;
    corners.push([photo.latitude+north/6378137/rad,photo.longitude+east/6378137/cosLat/rad]);
  }
  return {corners,height:h,heading:yaw,assumptions:[photo.yaw===null?'fallback heading':null,photo.pitch===null?'assumed −90° pitch':null,photo.roll===null?'assumed 0° roll':null,'manual horizontal field of view','flat ground'].filter(Boolean)};
}
