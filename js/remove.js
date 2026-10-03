// ══════════════════════════════════════════════════════
//  REMOVE
// ══════════════════════════════════════════════════════
function askRm(id){ rmId=id; document.getElementById('rmTxt').textContent='Remove "'+fn(gm(id))+'" from the tree?'; getM('rmModal').show(); }
function confirmRm(){
  const id=rmId;
  DB.members.forEach(m=>{
    m.childIds=(m.childIds||[]).filter(x=>x!==id);
    m.parentIds=(m.parentIds||[]).filter(x=>x!==id);
    if(m.spouseId===id) m.spouseId=null;
    if(Array.isArray(m.spouseIds)) m.spouseIds=m.spouseIds.filter(x=>x!==id);
  });
  DB.members=DB.members.filter(m=>m.id!==id);
  if(selId===id) selId=null;
  save(); closeM('rmModal'); showToast('Member removed');
  if(curView==='tree') { renderTree(); }
  else if(curView==='graph') { renderGraph(); setTimeout(fitGraphToScreen, 50); }
  else { renderList(); }
}

