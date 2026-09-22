import {motionPlacement as placement, prepareMotion} from './parallax-motion.mjs?v=10';
const $ = (s, root=document) => root.querySelector(s);
const mobile = matchMedia('(max-width: 760px)');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const clamp = (n,min=-1,max=1) => Math.max(min,Math.min(max,n));
// Demo motion tuning: reach full phone response with a small wrist movement.
const PARALLAX={pointerGain:1.3,tiltX:6,tiltY:8,gyroGamma:8,gyroBeta:10,scrollGain:1.4,swipeGain:5};
const escape = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let data, mode='animation', format='showcards', motion=!reduced.matches;
let controllers=[], current=null, settleTimer, scrollFrame, banner=null, bannerObserver, carouselCleanup;
let carouselDragging=false, syncCarousel=()=>{};
let tiltState='idle', tiltBase=null, tiltX=0, tiltY=0, tiltTimer;
const motionDebugEnabled=new URLSearchParams(location.search).has('motion-debug');
const sensorReadings={events:0,count:0,accepted:0,beta:null,gamma:null,lastAt:0};
const needsTiltPermission = () => typeof window.DeviceOrientationEvent?.requestPermission === 'function';
function announce(message){$('#announce').textContent=message;}
function updateMotion(){
 $('#motion').setAttribute('aria-pressed',String(motion));$('#motion').setAttribute('aria-label',`Motion ${motion?'on':'off'}`);$('#motion-label').textContent=`Motion ${motion?'on':'off'}`;
}
$('#motion').onclick=()=>{motion=!motion;updateMotion();if(!motion){controllers.forEach(c=>c.stop());banner?.pause();}else{syncMobile();syncCarousel();syncBanner();}};
updateMotion();
function tiltUI(){
 const b=$('#tilt');if(!b)return;
 b.hidden=!mobile.matches||mode!=='parallax'||!needsTiltPermission()||tiltState==='granted'||tiltState==='unavailable';
 b.textContent=tiltState==='denied'?'Retry motion access':'Enable motion';
 const status=$('#tilt-status');
 status.textContent=tiltState==='denied'?'Motion access was declined. Scroll and swipe still work.':tiltState==='unavailable'?'Scroll or swipe sideways to explore depth.':tiltState==='granted'?'Tilt your phone or swipe sideways to explore depth.':'';
}
async function enableTilt(fromTap=false){
 if(!mobile.matches||tiltState==='granted')return;
 if(!window.DeviceOrientationEvent){tiltState='unavailable';tiltUI();return;}
 if(needsTiltPermission()){
  if(!fromTap){tiltUI();return;}
  try{const result=await DeviceOrientationEvent.requestPermission();if(result!=='granted'){tiltState='denied';tiltUI();return;}}
  catch{tiltState='denied';tiltUI();return;}
 }
 tiltState='listening';tiltBase=null;
 clearTimeout(tiltTimer);tiltTimer=setTimeout(()=>{if(tiltState==='listening'){tiltState='unavailable';tiltUI();}},2500);
 tiltUI();
}
window.addEventListener('deviceorientation',e=>{
 if(motionDebugEnabled){sensorReadings.events++;sensorReadings.beta=e.beta;sensorReadings.gamma=e.gamma;if(Number.isFinite(e.beta)&&Number.isFinite(e.gamma)){sensorReadings.count++;sensorReadings.lastAt=Date.now();}}
 if(!mobile.matches||mode!=='parallax'||!motion||document.hidden||!['listening','granted','unavailable'].includes(tiltState)||e.beta==null||e.gamma==null)return;
 if(motionDebugEnabled)sensorReadings.accepted++;
 tiltState='granted';clearTimeout(tiltTimer);tiltUI();
 if(!tiltBase)tiltBase={beta:e.beta,gamma:e.gamma};
 const wrap=n=>((n+540)%360)-180, angle=(screen.orientation?.angle||0)*Math.PI/180;
 const gx=wrap(e.gamma-tiltBase.gamma)/PARALLAX.gyroGamma,gy=wrap(e.beta-tiltBase.beta)/PARALLAX.gyroBeta;
 tiltX=clamp(gx*Math.cos(angle)+gy*Math.sin(angle));tiltY=clamp(gy*Math.cos(angle)-gx*Math.sin(angle));
 controllers.forEach(c=>c.sensor(tiltX,tiltY));
});
window.addEventListener('orientationchange',()=>{tiltBase=null;});
function readRoute(){const [m,f]=location.hash.slice(1).split('/');mode=m==='parallax'?'parallax':'animation';format=f==='covers'?'covers':'showcards';}
function navigate(m,f){const next=`#${m}/${f}`;if(location.hash===next)return;location.hash=next;}
for(const b of document.querySelectorAll('[data-mode]'))b.onclick=()=>{
 if(b.dataset.mode==='parallax')enableTilt(true);
 navigate(b.dataset.mode,format);
};
function card(i){
 const t=mode==='animation'?'video':'parallax';
 return `<button class="card ${format==='covers'?'portrait':''}" data-id="${i.id}" data-type="${t}" aria-label="${escape(i.label)} · ${t==='video'?'animate':'explore depth'}" aria-pressed="false"><div class="surface"><img src="${mode==='parallax'&&!mobile.matches?(i.neutral||i.cover):i.cover}" alt="${escape(i.label)}" loading="lazy" decoding="async"><span class="badge"><i>${t==='video'?'↻':'◇'}</i>${t==='video'?'ANIMATED':'PARALLAX'}</span></div><div class="caption"><div><strong>${escape(i.title.split(':')[0])}</strong><p>${escape(i.label.split(' · ')[1]||'')}</p></div><small>${i.kind}</small></div></button>`;
}
function hero(){return `<section class="hero" aria-label="Featured film"><div class="hero-art"><img src="assets/die-hard-banner.webp" alt="Die Hard trailer" fetchpriority="high"></div><div class="hero-copy"><p class="eyebrow">FEATURED · MOVIE</p><h1>Die Hard <small>(random film)</small></h1><div class="metadata"><span>R</span><span>1988</span><span>Action</span><span>2h 12m</span></div><p>A New York cop. A Los Angeles skyscraper. When terrorists take over his wife’s Christmas party, John McClane is the one guest they didn’t plan for.</p><div class="hero-actions"><a class="primary" href="#collection" id="explore">▷ Explore the collection</a><button class="secondary" id="banner-toggle" aria-pressed="false">Ⅱ Pause preview</button></div></div><div class="hero-pagination"><i></i> Featured preview</div></section>`;}

function mount(node,item){
 const type=node.dataset.type,surface=$('.surface',node);
 let active=false,disposed=false,epoch=0,resetTimer,video,canvas,images,promise,raf;
 let x=0,y=0,tx=0,ty=0,drag=null,moved=false,swipeX=0,scrollY=0,sensorX=0,sensorY=0;
 const busy=v=>{$('.status',surface)?.remove();if(v)surface.insertAdjacentHTML('beforeend','<span class="status"><span class="spinner"></span></span>');node.setAttribute('aria-busy',String(v));};
 const show=v=>{node.classList.toggle('active',v);node.setAttribute('aria-pressed',String(v));};
 function targets(){tx=clamp(swipeX+sensorX);ty=clamp(scrollY*PARALLAX.scrollGain+sensorY);}
 function draw(){
  if(disposed||!images)return;
  x+=(tx-x)*.16;y+=(ty-y)*.16;
  const ctx=canvas.getContext('2d');ctx.setTransform(canvas.width/item.width,0,0,canvas.height/item.height,0,0);ctx.clearRect(0,0,item.width,item.height);
  images.forEach((img,n)=>ctx.drawImage(img,...placement(item,item.layers[n],x,y)));
  if(!mobile.matches){surface.style.setProperty('--rx',`${-y*PARALLAX.tiltX}deg`);surface.style.setProperty('--ry',`${x*PARALLAX.tiltY}deg`);}
  if(active||Math.abs(x)+Math.abs(y)>.005)raf=requestAnimationFrame(draw);
 }
 function load(){
  if(promise)return promise;
  canvas=document.createElement('canvas');canvas.width=Math.min(1200,item.width);canvas.height=Math.round(canvas.width*item.height/item.width);surface.prepend(canvas);
  promise=Promise.all(item.layers.map(l=>new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=reject;im.src=l.src;}))).then(v=>{images=v;prepareMotion(item,v);});return promise;
 }
 function prepare(){
  if(video){if(video.error)video.load();return;}
  video=document.createElement('video');video.muted=true;video.playsInline=true;video.setAttribute('playsinline','');video.preload=mobile.matches?'auto':'none';video.src=item.video;video.loop=!item.loopStart;
  video.addEventListener('ended',()=>{if(active){video.currentTime=item.loopStart;video.play().catch(fail);}});
  video.addEventListener('error',()=>{if(active)fail();});surface.prepend(video);
 }
 function fail(){stop();if(disposed)return;$('.error',surface)?.remove();surface.insertAdjacentHTML('beforeend','<span class="error">Tap to play motion</span>');announce('Motion could not start automatically. Tap the artwork to try again.');if(type==='parallax'){promise=null;canvas?.remove();canvas=null;images=null;}}
 async function start(){
  if(active||!motion||disposed||document.hidden)return;
  if(type==='video'){current?.stop();current=api;banner?.pause();}
  active=true;const token=++epoch;clearTimeout(resetTimer);$('.error',surface)?.remove();busy(type==='video'?(!video||video.readyState<3):!images);
  try{if(type==='video'){prepare();await video.play();}else await load();if(disposed||!active||epoch!==token)return;busy(false);show(true);if(type==='parallax'){cancelAnimationFrame(raf);draw();}}
  catch{if(active&&epoch===token)fail();}
 }
 function stop(){
  if(!active&&!node.classList.contains('active'))return;
  active=false;++epoch;busy(false);show(false);if(current===api)current=null;
  tx=0;ty=0;swipeX=0;
  clearTimeout(resetTimer);resetTimer=setTimeout(()=>{video?.pause();if(video?.readyState)video.currentTime=0;surface.style.removeProperty('--rx');surface.style.removeProperty('--ry');},360);
 }
 function inspectMotion(){
  if(type!=='parallax'||!images)return null;
  const layer=item.layers.reduce((a,b)=>a.z>b.z?a:b),base=placement(item,layer,0,0),position=placement(item,layer,x,y),scale=surface.clientWidth/item.width;
  return {label:item.label,dx:(position[0]-base[0])*scale,dy:(position[1]-base[1])*scale};
 }
 const api={node,start,stop,inspectMotion,preload(){if(type==='video'&&mobile.matches&&motion&&!disposed)prepare();},get active(){return active;},sensor(a,b){sensorX=a;sensorY=b;targets();},scroll(v){scrollY=v;targets();},dispose(){disposed=true;stop();clearTimeout(resetTimer);cancelAnimationFrame(raf);video?.pause();observer.disconnect();}};
 node.addEventListener('pointerenter',e=>{if(e.pointerType==='mouse'&&!mobile.matches&&!carouselDragging&&type!=='video')start();});
 node.addEventListener('pointerleave',e=>{if(e.pointerType==='mouse'&&!mobile.matches&&type!=='video'){stop();syncBanner();}});
 node.addEventListener('focus',()=>{if(node.matches(':focus-visible'))start();});node.addEventListener('blur',()=>{if(!mobile.matches)stop();});
 node.addEventListener('click',()=>{if(moved){moved=false;return;}if(type==='parallax'&&mobile.matches){enableTilt(true);start();}else active?stop():start();});
 node.addEventListener('pointerdown',e=>{moved=false;if(type==='parallax'&&e.pointerType!=='mouse')drag={x:e.clientX,y:e.clientY,start:swipeX};});
 node.addEventListener('pointermove',e=>{
  if(type!=='parallax')return;const r=node.getBoundingClientRect();
  if(e.pointerType==='mouse'&&!mobile.matches){tx=clamp(((e.clientX-r.left)/r.width*2-1)*PARALLAX.pointerGain);ty=clamp(((e.clientY-r.top)/surface.offsetHeight*2-1)*PARALLAX.pointerGain);}
  else if(drag&&Math.abs(e.clientX-drag.x)>5){moved=true;swipeX=clamp(drag.start+(e.clientX-drag.x)/r.width*PARALLAX.swipeGain);targets();start();}
 });
 node.addEventListener('pointerup',()=>{drag=null;});node.addEventListener('pointercancel',()=>{drag=null;});
 const observer=new IntersectionObserver(entries=>{if(!entries[0].isIntersecting)stop();},{threshold:0});observer.observe(node);
 if(type==='parallax'&&!mobile.matches){load().then(()=>{if(disposed)return;node.classList.add('neutral-ready');if(!active)draw();}).catch(()=>{/* Keep the neutral poster if a layer cannot load. */});}
 return api;
}
function nearest(){
 const centre=150+(innerHeight-150)/2;
 return controllers.map(c=>{const r=c.node.getBoundingClientRect();const visible=Math.max(0,Math.min(r.bottom,innerHeight)-Math.max(r.top,150));return {c,r,visible,dist:Math.abs(r.top+r.height/2-centre)};}).filter(v=>v.visible/Math.min(v.r.height,innerHeight-150)>.55).sort((a,b)=>a.dist-b.dist)[0]?.c;
}
function syncMobile(settled=true){
 if(!mobile.matches||!motion||document.hidden)return;
 if(mode==='animation'){
  controllers.forEach(c=>c.preload());
  const next=nearest();if(current&&current!==next)current.stop();if(settled)next?.start();
 }else{
  controllers.forEach(c=>{const r=c.node.getBoundingClientRect();if(r.bottom>150&&r.top<innerHeight){c.scroll(clamp((innerHeight/2-(r.top+r.height/2))/(innerHeight/2)));c.start();}else c.stop();});
 }
}
function onScroll(){
 clearTimeout(settleTimer);if(!scrollFrame)scrollFrame=requestAnimationFrame(()=>{scrollFrame=null;syncMobile(false);syncCarousel();});
 settleTimer=setTimeout(()=>syncMobile(true),240);
}
let bannerPaused=false;
function syncBanner(){
 if(!banner)return;const r=$('.hero').getBoundingClientRect();
 if(!mobile.matches&&motion&&!current&&!bannerPaused&&!document.hidden&&r.bottom>100){banner.play().then(()=>{if(!banner.paused){$('.hero-art')?.classList.add('playing');$('#banner-toggle').textContent='Ⅱ Pause preview';$('#banner-toggle').setAttribute('aria-pressed','true');}}).catch(()=>{$('#banner-toggle').textContent='▷ Play preview';});}
 else banner.pause();
}
function mountCarousel(){
 const row=$('.items'),wrap=$('.carousel'),zone=$('.collection'),prev=$('.previous',wrap),next=$('.next',wrap);
 let drag=null,suppressClick=false,resetClickTimer,pointer=null,hoverFrame;
 function syncHover(){
  if(mobile.matches||mode!=='animation'||carouselDragging||!pointer)return;
  const hit=document.elementFromPoint(pointer.x,pointer.y);
  if(!hit||!zone.contains(hit)){pointer=null;current?.stop();syncBanner();return;}
  if(!motion||document.hidden)return;
  const hovered=hit.closest('.card');
  const bounds=row.getBoundingClientRect();
  const chosen=controllers.find(c=>c.node===hovered)||controllers.find(c=>{
   const r=c.node.getBoundingClientRect();
   return r.left>=Math.max(0,bounds.left)-1&&r.right<=Math.min(innerWidth,bounds.right)+1&&r.bottom>0&&r.top<innerHeight;
  });
  if(chosen)chosen.start();else{current?.stop();syncBanner();}
 }
 function scheduleHover(){cancelAnimationFrame(hoverFrame);hoverFrame=requestAnimationFrame(syncHover);}
 syncCarousel=syncHover;
 zone.addEventListener('pointermove',e=>{if(e.pointerType==='mouse'){pointer={x:e.clientX,y:e.clientY};scheduleHover();}});
 zone.addEventListener('pointerenter',e=>{if(e.pointerType==='mouse'){pointer={x:e.clientX,y:e.clientY};scheduleHover();}});
 zone.addEventListener('pointerleave',e=>{if(e.pointerType==='mouse'&&mode==='animation'&&!mobile.matches){pointer=null;current?.stop();syncBanner();}});
 function update(){
  const max=row.scrollWidth-row.clientWidth;
  prev.disabled=row.scrollLeft<2;next.disabled=row.scrollLeft>max-2;
  wrap.classList.toggle('can-scroll',max>2);
  wrap.style.setProperty('--arrow-y',`${($('.surface',row)?.offsetHeight||0)/2+8}px`);scheduleHover();
 }
 const observer=new ResizeObserver(update);observer.observe(row);row.addEventListener('scroll',update,{passive:true});
 for(const b of [prev,next])b.onclick=()=>row.scrollBy({left:(($('.card',row)?.getBoundingClientRect().width||0)+parseFloat(getComputedStyle(row).columnGap))*Number(b.dataset.scroll),behavior:reduced.matches?'instant':'smooth'});
 row.addEventListener('dragstart',e=>e.preventDefault());
 row.addEventListener('pointerdown',e=>{
  if(mobile.matches||mode!=='animation'||e.pointerType!=='mouse'||e.button!==0||row.scrollWidth<=row.clientWidth+2)return;
  clearTimeout(resetClickTimer);suppressClick=false;drag={id:e.pointerId,x:e.clientX,left:row.scrollLeft};
 });
 row.addEventListener('pointermove',e=>{
  if(!drag)return;const delta=e.clientX-drag.x;
  if(!carouselDragging&&Math.abs(delta)>6){carouselDragging=true;suppressClick=true;row.classList.add('dragging');controllers.forEach(c=>c.stop());row.setPointerCapture(e.pointerId);}
  if(carouselDragging){e.preventDefault();row.scrollLeft=drag.left-delta;}
 });
 function finish(){
  if(!drag)return;const id=drag.id;drag=null;
  if(row.hasPointerCapture(id))row.releasePointerCapture(id);
  carouselDragging=false;row.classList.remove('dragging');scheduleHover();
  // The click synthesized after pointerup must not toggle the card.
  resetClickTimer=setTimeout(()=>{suppressClick=false;},0);
 }
 row.addEventListener('pointerup',finish);row.addEventListener('pointercancel',finish);row.addEventListener('lostpointercapture',finish);
 row.addEventListener('pointerleave',()=>{if(drag&&!carouselDragging)finish();});
 row.addEventListener('click',e=>{if(suppressClick){e.preventDefault();e.stopImmediatePropagation();suppressClick=false;}},true);
 update();return()=>{observer.disconnect();clearTimeout(resetClickTimer);cancelAnimationFrame(hoverFrame);syncCarousel=()=>{};};
}
function render(){
 carouselCleanup?.();carouselDragging=false;controllers.forEach(c=>c.dispose());controllers=[];current=null;banner?.pause();banner=null;bannerObserver?.disconnect();clearTimeout(settleTimer);
 document.body.classList.toggle('parallax-mode',mode==='parallax');
 document.querySelectorAll('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mode===mode)));
 document.querySelectorAll('[data-format]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.format===format)));
 const items=(mode==='animation'?data.animations:data.parallax).filter(i=>format==='covers'?i.width<i.height:i.width>i.height);
 $('#content').innerHTML=(mode==='animation'?hero():'')+`<section class="collection" id="collection"><button id="tilt" class="tilt-button" hidden>Enable motion</button><div class="section-heading"><div><h2>${mode==='animation'?'In motion':'A different dimension'}<small>${items.length}</small></h2><p>${mode==='animation'?'<span class="desktop-hint">Hover to bring the artwork to life.</span><span class="mobile-hint">Scroll to explore. Pause on a cover to bring it to life.</span>':'<span class="desktop-hint">Move across the artwork. Discover another layer.</span><span class="mobile-hint">Scroll, tilt your phone, or swipe sideways.</span>'}</p></div></div><p id="tilt-status" class="tilt-status"></p><div class="carousel"><div class="items ${format}">${items.map(card).join('')}</div><button class="carousel-arrow previous" aria-label="Previous artwork" data-scroll="-1">‹</button><button class="carousel-arrow next" aria-label="Next artwork" data-scroll="1">›</button></div></section>`;
 document.querySelectorAll('[data-format]').forEach(b=>b.onclick=()=>navigate(mode,b.dataset.format));
 document.querySelectorAll('.card').forEach(n=>controllers.push(mount(n,items.find(i=>i.id===n.dataset.id))));
 carouselCleanup=mountCarousel();
 if(mobile.matches&&mode==='animation')controllers.forEach(c=>c.preload());
 $('#tilt').onclick=()=>enableTilt(true);
 if(mode==='animation'){
  $('#explore').onclick=e=>{e.preventDefault();$('#collection').scrollIntoView({behavior:reduced.matches?'instant':'smooth'});};
  if(!mobile.matches){banner=document.createElement('video');banner.muted=true;banner.playsInline=true;banner.loop=true;banner.src='assets/die-hard-banner.mp4';$('.hero-art').prepend(banner);bannerObserver=new IntersectionObserver(syncBanner,{threshold:0});bannerObserver.observe($('.hero'));syncBanner();}
  $('#banner-toggle').onclick=()=>{bannerPaused=!bannerPaused;syncBanner();$('#banner-toggle').textContent=bannerPaused?'▷ Play preview':'Ⅱ Pause preview';$('#banner-toggle').setAttribute('aria-pressed',String(!bannerPaused));};
 }else enableTilt(false);
 tiltUI();window.scrollTo({top:0,behavior:'instant'});settleTimer=setTimeout(()=>syncMobile(true),300);
}
window.addEventListener('scroll',onScroll,{passive:true});
window.addEventListener('hashchange',()=>{if(!data)return;readRoute();render();});
mobile.addEventListener('change',()=>{if(data)render();});
window.addEventListener('resize',onScroll,{passive:true});
document.addEventListener('visibilitychange',()=>{if(document.hidden){controllers.forEach(c=>c.stop());banner?.pause();}else{syncMobile();syncCarousel();syncBanner();}});
document.addEventListener('keydown',e=>{if(e.key==='Escape')controllers.forEach(c=>c.stop());});
if(motionDebugEnabled)import('./motion-debug.mjs?v=11').then(({mountMotionDebug})=>mountMotionDebug({
 read:()=>({...sensorReadings,state:tiltState,motion,mobile:mobile.matches,mode,x:tiltX,y:tiltY,card:nearest()?.inspectMotion()}),
 retry:()=>enableTilt(true),
 recenter:()=>{tiltBase=null;tiltX=tiltY=0;controllers.forEach(c=>c.sensor(0,0));}
})).catch(()=>announce('The motion diagnostic panel could not load. Please refresh.'));
try{const response=await fetch('manifest.json?v=12');if(!response.ok)throw Error('manifest');data=await response.json();readRoute();render();}catch{$('#content').innerHTML='<p class="loading">The collection couldn’t load. Please refresh to try again.</p>';}
