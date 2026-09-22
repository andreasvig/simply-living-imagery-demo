// Shared by the workbench, motion playground and static GitHub Pages demo.
export const MOTION = Object.freeze({version:1, strength:3, fraction:.025, minorAxis:.4, showcardHorizontal:2/3});
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const keys=['left','right','up','down'];
const blank=()=>Object.fromEntries(keys.map(k=>[k,Infinity]));
export function axisFractions(scene,strength=MOTION.strength){
 const f=MOTION.fraction*strength;
 return scene.height>scene.width?{x:f*MOTION.minorAxis,y:f}:scene.width>scene.height?{x:f*MOTION.showcardHorizontal,y:f*MOTION.minorAxis}:{x:f,y:f};
}
export function depth(scene,layer){
 const zs=scene.layers?.map(l=>l.z)??[0,1],lo=Math.min(0,...zs),hi=Math.max(...zs);
 return layer.kind==='background'?0:clamp((layer.z-lo)/(hi-lo||1),0,1);
}
export function basePlacement(scene,layer){
 const {width:w,height:h}=scene,c=scene.asset_canvas;
 if(c)return[-c.padding_x,-c.padding_y,c.width,c.height];
 // Keep historical framing exactly as exported. Motion tuning never adds zoom.
 const m=scene.config?.motion_fraction??scene.motion_fraction??.025;
 const scale=layer.overscan===false?1:1+2*m,sw=Math.round(w*scale),sh=Math.round(h*scale);
 return[Math.floor((w-sw)/2),Math.floor((h-sh)/2),sw,sh];
}
export function softLimit(value,limit){
 if(!Number.isFinite(limit))return value;
 if(limit<=0)return 0;
 const sign=Math.sign(value),v=Math.abs(value),knee=limit*.6,tail=limit-knee;
 return sign*(v<=knee?v:knee+tail*(-Math.expm1(-(v-knee)/tail)));
}
// Measure actual crop planes, not the previous requested motion amplitude.
// Plan descriptions and semantic object bounds are not needed here.
export function edgeLimits(scene,layer,pixels){
 const {width:w,height:h,data}=pixels,[ox,oy,sw,sh]=basePlacement(scene,layer);
 const sx=sw/w,sy=sh/h,limits=blank();
 const alpha=(x,y)=>x>=0&&x<w&&y>=0&&y<h?data[(y*w+x)*4+3]>=64:false;
 let x0=w,y0=h,x1=-1,y1=-1;
 for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(alpha(x,y)){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}
 if(x1<0)return {left:0,right:0,up:0,down:0};
 const bbox=[x0,y0,x1+1,y1+1];
 const identity=[layer.id,layer.name,layer.src].filter(Boolean).join(' ');
 const lettering=/title|typography|logo|lettering/i.test(identity);
 const support=layer.coverage?.support_box;
 const padding=scene.asset_canvas;
 const planes=[new Set([0,x0]),new Set([w-1,x1]),new Set([0,y0]),new Set([h-1,y1])];
 const viewport=[-ox/sx,(scene.width-ox)/sx-1,-oy/sy,(scene.height-oy)/sy-1];
 viewport.forEach((v,i)=>{for(let d=-1;d<=1;d++)planes[i].add(Math.round(v)+d);});
 if(support&&padding){
  [support[0]/sx,support[2]/sx-1,support[1]/sy,support[3]/sy-1].forEach((v,i)=>{
   for(let d=-2;d<=2;d++)planes[i].add(Math.round(v)+d);
  });
 }
 const sourceEdges=layer.source_crop_edges; // left, top, right, bottom
 const map=[0,2,1,3];
 for(let side=0;side<4;side++){
  const horizontal=side<2,negative=side===0||side===2,normal=negative?-1:1;
  const length=horizontal?h:w,threshold=Math.max(8,Math.ceil(length*.02));
  for(const plane of planes[side]){
   if(plane<0||plane>=(horizontal?w:h))continue;
   const world=(horizontal?ox:oy)+(plane+(negative?0:1))*(horizontal?sx:sy);
   const boundary=negative?0:(horizontal?scene.width:scene.height);
   // Only edge-adjacent straight cuts qualify; an interior rectangular logo
   // is an intentional contour. Known original crops remain eligible after fitting.
   const known=sourceEdges?.[map[side]];
   if(lettering&&!known&&plane!==0&&plane!==(horizontal?w:h)-1)continue;
   if(!known&&(negative?world>2:world<boundary-2))continue;
   let longest=0,streak=0;
   for(let along=0;along<length;along++){
    const a=horizontal?alpha(plane,along):alpha(along,plane);
    const outside=horizontal?alpha(plane+normal,along):alpha(along,plane+normal);
    streak=a&&!outside?streak+1:0;longest=Math.max(longest,streak);
   }
   if(longest<threshold)continue;
   const direction=['right','left','down','up'][side];
   const margin=negative?-world:world-boundary;
   limits[direction]=Math.min(limits[direction],Math.max(0,margin-2));
  }
 }
 // Preserve already-complete lettering within the card; its transparent border
 // is not a cropped surface, but it should not disappear while exploring depth.
 if(lettering){
  limits.left=Math.min(limits.left,Math.max(0,ox+bbox[0]*sx-2));
  limits.right=Math.min(limits.right,Math.max(0,scene.width-ox-bbox[2]*sx-2));
  limits.up=Math.min(limits.up,Math.max(0,oy+bbox[1]*sy-2));
  limits.down=Math.min(limits.down,Math.max(0,scene.height-oy-bbox[3]*sy-2));
 }
 return limits;
}
export function sceneLimits(scene,perLayer){
 const result=blank();
 scene.layers.forEach((layer,i)=>{
  const z=depth(scene,layer);if(z<=0)return;
  for(const key of keys){const v=perLayer[i]?.[key];if(v!=null)result[key]=Math.min(result[key],v/((key==='left'||key==='right'?scene.width:scene.height)*z));}
 });
 return result;
}
export function prepareMotion(scene,images){
 const limits=scene.layers.map((layer,i)=>{
  const image=images[i].image??images[i],canvas=document.createElement('canvas');
  canvas.width=image.naturalWidth||image.width;canvas.height=image.naturalHeight||image.height;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);
  return edgeLimits(scene,layer,ctx.getImageData(0,0,canvas.width,canvas.height));
 });
 scene.motion_envelope=sceneLimits(scene,limits);
 scene.motion_edge_limits=limits;
 return scene.motion_envelope;
}
export function motionPlacement(scene,layer,x=0,y=0,{strength=MOTION.strength,protectEdges=true}={}){
 const a=axisFractions(scene,strength),z=depth(scene,layer);
 let dx=x*a.x,dy=y*a.y;
 if(protectEdges){
  // Runtime alpha measurement applies to old exports too. Until decoded, use
  // conservative saved limits; never mistake them for extra invented margin.
  const limits=scene.motion_envelope??sceneLimits({...scene,layers:scene.layers??[layer]},(scene.layers??[layer]).map(l=>l.motion_limits??{left:0,right:0,up:0,down:0}));
  dx=softLimit(dx,limits[dx<0?'left':'right']);dy=softLimit(dy,limits[dy<0?'up':'down']);
 }
 const base=basePlacement(scene,layer);
 return[base[0]+dx*scene.width*z,base[1]+dy*scene.height*z,base[2],base[3]];
}
