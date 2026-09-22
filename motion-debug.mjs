// Opt-in, on-device diagnostics. No readings are sent to a server.
export function mountMotionDebug({read,retry,recenter}){
 const panel=document.createElement('aside');panel.id='motion-debug';panel.setAttribute('aria-label','Phone motion diagnostics');
 Object.assign(panel.style,{position:'fixed',bottom:'10px',left:'10px',right:'10px',maxWidth:'440px',zIndex:1000,padding:'14px',border:'1px solid #8c7dc4',borderRadius:'12px',background:'#15141df5',color:'#fff',font:'12px/1.5 system-ui',boxShadow:'0 4px 30px #0008'});
 panel.innerHTML='<div style="display:flex;justify-content:space-between;align-items:center"><strong>Phone motion check</strong><button data-close style="background:none;padding:3px 8px" aria-label="Close diagnostics">×</button></div><strong data-status style="display:block;margin:5px 0;color:#d0c1ff"></strong><pre data-values style="font:11px/1.5 monospace;white-space:pre-wrap;margin:5px 0"></pre><div style="display:flex;gap:8px"><button data-enable style="background:#68578e;border-radius:6px;padding:8px 12px">Enable sensor</button><button data-center style="background:#34303e;border-radius:6px;padding:8px 12px">Recenter</button></div>';
 document.body.append(panel);
 const number=n=>Number.isFinite(n)?n.toFixed(1):'—';
 function update(){
  const s=read(),fresh=s.count>0&&Date.now()-s.lastAt<1500;
  let status=!s.mobile?'Phone layout is not active':!s.motion?'Motion is off':s.mode!=='parallax'?'Choose Parallax to test':fresh&&s.accepted>0?'Live sensor data':fresh?'Sensor data arrives, but the effect is not using it':s.count?'Sensor readings have stopped':'No sensor readings received';
  panel.querySelector('[data-status]').textContent=status;
  panel.querySelector('[data-values]').textContent=`Readings: ${s.count} · Used by effect: ${s.accepted}\nPhone angles: side ${number(s.gamma)}° / forward ${number(s.beta)}°\nEffect input: ${number(s.x)} / ${number(s.y)}\nLayer movement: ${number(s.card?.dx)}px / ${number(s.card?.dy)}px\nEvents: ${s.events} · App state: ${s.state} · ${s.card?.label||'No visible artwork'}`;
 }
 panel.querySelector('[data-enable]').onclick=()=>retry();
 panel.querySelector('[data-center]').onclick=()=>{recenter();update();};
 const timer=setInterval(update,200);panel.querySelector('[data-close]').onclick=()=>{clearInterval(timer);panel.remove();};update();
}
