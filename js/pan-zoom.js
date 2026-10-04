// ══════════════════════════════════════════════════════
//  PAN & ZOOM (infinite canvas — Phone & Desktop Engine)
// ══════════════════════════════════════════════════════
let zoomScale=1, panX=0, panY=0;
let isPanning=false, panMoved=false, panStartX=0, panStartY=0, panOrigX=0, panOrigY=0;
let pinchStartDist=0, pinchStartScale=1, pinchCenter={x:0, y:0};

function applyTransform(){
  const zl=document.getElementById('zoomLayer');
  if(zl) zl.style.transform='translate('+panX+'px,'+panY+'px) scale('+zoomScale+')';
}
function clampZoom(z){ return Math.min(3.0, Math.max(0.15, z)); }

function fitToScreen(){
  if (typeof curView !== 'undefined' && curView === 'graph') { fitGraphToScreen(); return; }

  const wrap=document.getElementById('canvasWrap');
  const inner=document.getElementById('innerWrap');
  if(!wrap || !inner) return;
  const iw=inner.offsetWidth, ih=inner.offsetHeight;
  if(!iw || !ih){ zoomScale=1; panX=0; panY=0; applyTransform(); return; }
  const availW=wrap.clientWidth-24, availH=wrap.clientHeight-24;
  const scale=Math.min(1, availW/iw, availH/ih);
  zoomScale=scale>0?scale:1;
  panX=Math.max(12,(wrap.clientWidth-iw*zoomScale)/2);
  panY=12;
  applyTransform();
}

(function initPanZoom(){
  const wrap=document.getElementById('canvasWrap');
  if(!wrap) return;

  // Mouse drag
  wrap.addEventListener('mousedown', e=>{
    if(e.button!==0) return;
    isPanning=true; panMoved=false;
    panStartX=e.clientX; panStartY=e.clientY;
    panOrigX=panX; panOrigY=panY;
    wrap.classList.add('grabbing');
  });
  window.addEventListener('mousemove', e=>{
    if(!isPanning) return;
    const dx=e.clientX-panStartX, dy=e.clientY-panStartY;
    if(Math.abs(dx)>6||Math.abs(dy)>6) panMoved=true;
    if(panMoved){ panX=panOrigX+dx; panY=panOrigY+dy; applyTransform(); }
  });
  window.addEventListener('mouseup', ()=>{ isPanning=false; wrap.classList.remove('grabbing'); });

  // Swallow the click that follows a real drag, so it doesn't also open a node
  wrap.addEventListener('click', e=>{
    if(panMoved){ e.stopPropagation(); e.preventDefault(); panMoved=false; }
  }, true);

  function touchDist(t){
    const dx=t[0].clientX-t[1].clientX, dy=t[0].clientY-t[1].clientY;
    return Math.sqrt(dx*dx+dy*dy);
  }
  function touchMid(t){
    return { x:(t[0].clientX+t[1].clientX)/2, y:(t[0].clientY+t[1].clientY)/2 };
  }

  // Touch drag + pinch zoom (Mobile phone support)
  wrap.addEventListener('touchstart', e=>{
    if(e.target.closest('.node-photo, .node-name, .exp-dot, .btn')) return;
    if(e.touches.length===1){
      isPanning=true; panMoved=false;
      panStartX=e.touches[0].clientX; panStartY=e.touches[0].clientY;
      panOrigX=panX; panOrigY=panY;
    } else if(e.touches.length===2){
      isPanning=false;
      pinchStartDist=touchDist(e.touches);
      pinchStartScale=zoomScale;
      pinchCenter=touchMid(e.touches);
    }
  }, {passive:false});

  wrap.addEventListener('touchmove', e=>{
    if(e.touches.length===1 && isPanning){
      if(e.cancelable) e.preventDefault();
      const dx=e.touches[0].clientX-panStartX, dy=e.touches[0].clientY-panStartY;
      if(Math.abs(dx)>4||Math.abs(dy)>4) panMoved=true;
      if(panMoved){ panX=panOrigX+dx; panY=panOrigY+dy; applyTransform(); }
    } else if(e.touches.length===2){
      if(e.cancelable) e.preventDefault();
      const dist=touchDist(e.touches);
      if(pinchStartDist>0){
        const mid=touchMid(e.touches);
        const newZoom=clampZoom(pinchStartScale*(dist/pinchStartDist));
        const factor=newZoom/zoomScale;
        panX = mid.x - factor * (mid.x - panX);
        panY = mid.y - factor * (mid.y - panY);
        zoomScale = newZoom;
        applyTransform();
      }
    }
  }, {passive:false});

  wrap.addEventListener('touchend', e=>{
    if(e.touches.length===1){
      isPanning=true; panMoved=false;
      panStartX=e.touches[0].clientX; panStartY=e.touches[0].clientY;
      panOrigX=panX; panOrigY=panY;
    } else {
      isPanning=false;
    }
  });

  // Mouse wheel / trackpad zoom (desktop)
  wrap.addEventListener('wheel', e=>{
    e.preventDefault();
    const rect = wrap.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.08 : 0.92;
    const newZoom = clampZoom(zoomScale * factor);
    const ratio = newZoom / zoomScale;
    panX = mouseX - ratio * (mouseX - panX);
    panY = mouseY - ratio * (mouseY - panY);
    zoomScale = newZoom;
    applyTransform();
  }, {passive:false});

  window.addEventListener('resize', ()=>{ if(curView==='tree') fitToScreen(); });
})();
