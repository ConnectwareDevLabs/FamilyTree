// ══════════════════════════════════════════════════════
//  DRAG A CHILD TO REORDER SIBLINGS (eldest ↔ youngest)
//  Only nodes with recorded parents are draggable (spouses and root
//  members are excluded — same rule as the Birth Order field). Dragging
//  is horizontal-only in spirit: on drop, every sibling's final X
//  position decides the new left-to-right (= birth) order.
// ══════════════════════════════════════════════════════
let dragNode=null;            // {id, div, startClientX, startClientY, origLeft, origTop, moved}
let suppressNextNodeClick=false;

function attachNodeDrag(div, id){
  div.addEventListener('mousedown', e=>{
    if(e.button!==0) return;
    startNodeDrag(id, div, e.clientX, e.clientY);
    e.stopPropagation(); // don't also start a canvas pan
  });
  div.addEventListener('touchstart', e=>{
    if(e.touches.length!==1) return;
    startNodeDrag(id, div, e.touches[0].clientX, e.touches[0].clientY);
    e.stopPropagation();
  }, {passive:true});
}
function startNodeDrag(id, div, clientX, clientY){
  dragNode={
    id, div,
    startClientX:clientX, startClientY:clientY,
    origLeft:parseFloat(div.style.left)||0, origTop:parseFloat(div.style.top)||0,
    moved:false
  };
}
function nodeDragMove(clientX, clientY){
  if(!dragNode) return;
  const dx=(clientX-dragNode.startClientX)/zoomScale;
  const dy=(clientY-dragNode.startClientY)/zoomScale;
  if(Math.abs(dx)>4 || Math.abs(dy)>4) dragNode.moved=true;
  if(dragNode.moved){
    dragNode.div.style.left=(dragNode.origLeft+dx)+'px';
    dragNode.div.style.top =(dragNode.origTop +dy)+'px';
    dragNode.div.classList.add('dragging');
  }
}
function nodeDragEnd(){
  if(!dragNode) return;
  const { id, div, moved } = dragNode;
  div.classList.remove('dragging');
  if(moved){
    suppressNextNodeClick=true; // this was a drag, not a tap — don't open the action menu
    reorderSiblingsByPosition(id, parseFloat(div.style.left));
  }
  dragNode=null;
}
window.addEventListener('mousemove', e=>{ if(dragNode) nodeDragMove(e.clientX, e.clientY); });
window.addEventListener('mouseup',   ()=>{ if(dragNode) nodeDragEnd(); });
window.addEventListener('touchmove', e=>{ if(dragNode && e.touches.length===1) nodeDragMove(e.touches[0].clientX, e.touches[0].clientY); }, {passive:true});
window.addEventListener('touchend',  ()=>{ if(dragNode) nodeDragEnd(); });

function reorderSiblingsByPosition(draggedId, droppedLeftX){
  const m=gm(draggedId);
  if(!m || !(m.parentIds||[]).length) return;
  const parent=gm(m.parentIds[0]);
  if(!parent) return;
  const sp=parent.spouseId?gm(parent.spouseId):null;
  const siblingIds=uniqueChildren(parent, sp); // current order

  // Use each sibling's CURRENT on-screen x — except the dragged node,
  // which uses where it was actually dropped.
  const withX=siblingIds.map(sid=>{
    if(sid===draggedId) return { id:sid, x:droppedLeftX };
    const el=document.querySelector('.node[data-id="'+sid+'"]');
    return { id:sid, x: el ? parseFloat(el.style.left) : 0 };
  });
  withX.sort((a,b)=>a.x-b.x);
  withX.forEach((p,i)=>{ const sm=gm(p.id); if(sm) sm.childOrder=i+1; });

  save();
  renderTree(); // snaps everyone back to a clean grid in the new order
  showToast('Order updated');
}

