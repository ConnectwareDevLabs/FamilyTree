// ══════════════════════════════════════════════════════
//  PEOPLE DIRECTORY (reuse a person across different trees)
// ══════════════════════════════════════════════════════
function personTreeCount(personId){
  if(!personId) return 0;
  let c=0;
  allTrees().forEach(t=>(t.members||[]).forEach(m=>{ if(m.personId===personId) c++; }));
  return c;
}
function searchDirectory(q){
  q=(q||'').toLowerCase().trim();
  const inCurrent=new Set(DB.members.map(m=>m.personId).filter(Boolean));
  const seen=new Set();
  const out=[];
  allTrees().forEach(t=>{
    (t.members||[]).forEach(m=>{
      if(!m.personId || inCurrent.has(m.personId) || seen.has(m.personId)) return;
      if(q && !fn(m).toLowerCase().includes(q)) return;
      seen.add(m.personId);
      out.push(Object.assign({}, m, { _treeName:t.name }));
    });
  });
  return out.slice(0,30);
}
// Like searchDirectory, but ALSO includes people already in the current
// tree (flagged _sameTree:true). Used by the "Their Family" quick-add
// fields (Mother/Father/Spouse/Siblings/Children) — when describing a
// new person's relatives, those relatives are very often already
// sitting in this exact tree, so excluding it (like searchDirectory
// does for the main add-member field) would hide the most common case.
function searchAnyone(q){
  q=(q||'').toLowerCase().trim();
  if(!q) return [];
  const seen=new Set();
  const out=[];
  DB.members.forEach(m=>{
    if(!fn(m).toLowerCase().includes(q)) return;
    if(m.personId) seen.add(m.personId);
    out.push(Object.assign({}, m, { _treeName:DB.name, _sameTree:true }));
  });
  allTrees().forEach(t=>{
    if(t.id===APP.activeTreeId) return;
    (t.members||[]).forEach(m=>{
      if(!m.personId || seen.has(m.personId)) return;
      if(!fn(m).toLowerCase().includes(q)) return;
      seen.add(m.personId);
      out.push(Object.assign({}, m, { _treeName:t.name, _sameTree:false }));
    });
  });
  return out.slice(0,30);
}
function findByPersonId(personId){
  for(const t of allTrees()){
    const m=(t.members||[]).find(x=>x.personId===personId);
    if(m) return m;
  }
  return null;
}
function syncPersonEverywhere(personId, data){
  let c=0;
  allTrees().forEach(t=>(t.members||[]).forEach(m=>{
    if(m.personId===personId){ Object.assign(m,data); c++; }
  }));
  saveApp();
  showToast('Updated '+c+' linked profile'+(c!==1?'s':''));
}

