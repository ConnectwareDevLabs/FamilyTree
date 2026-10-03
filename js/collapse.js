// ══════════════════════════════════════════════════════
//  COLLAPSE / EXPAND a branch
// ══════════════════════════════════════════════════════
function toggleCollapse(id){
  DB.collapsed = DB.collapsed || [];
  const i = DB.collapsed.indexOf(id);
  if(i>-1) DB.collapsed.splice(i,1); else DB.collapsed.push(id);
  save();
  renderTree();
}

// ══════════════════════════════════════════════════════
//  SUB-FAMILY TAGGING
//  Tap the small button on a spouse connector to tag that couple's
//  branch (e.g. "The Bangalore Raos" / place / nickname). Once tagged,
//  collapsing that couple shows one wide placeholder card summarising
//  everyone hidden underneath, instead of just an arrow.
//  The tag itself is stored on EACH spouse's member record, keyed to
//  their personId — and propagated via syncPersonEverywhere so it
//  follows that person into every other tree they appear in too,
//  exactly like the "reuse a person" feature elsewhere in the app.
// ══════════════════════════════════════════════════════
function openSubFamily(aId, bId){
  const a=gm(aId), b=bId?gm(bId):null;
  const existing=(a&&a.subFamily)||(b&&b.subFamily);
  sf('sfCoupleA', aId); sf('sfCoupleB', bId||'');
  sf('sfName', existing?existing.name:'');
  sf('sfPlace', existing?existing.place:'');
  sf('sfNick', existing?existing.nickname:'');
  document.getElementById('sfTitle').textContent = existing ? 'Edit Sub-Family Tag' : 'Tag as Sub-Family';
  document.getElementById('sfRemoveBtn').style.display = existing ? '' : 'none';
  getM('subFamilyModal').show();
}
function saveSubFamily(){
  const name=document.getElementById('sfName').value.trim();
  if(!name){ showToast('Family name is required'); return; }
  const tag={ name, place:document.getElementById('sfPlace').value.trim(), nickname:document.getElementById('sfNick').value.trim() };
  const aId=parseInt(document.getElementById('sfCoupleA').value);
  const bIdRaw=document.getElementById('sfCoupleB').value;
  const bId=bIdRaw?parseInt(bIdRaw):null;
  const a=gm(aId), b=bId?gm(bId):null;
  if(a){ a.subFamily={...tag}; syncPersonEverywhere(a.personId, { subFamily:{...tag} }); }
  if(b){ b.subFamily={...tag}; syncPersonEverywhere(b.personId, { subFamily:{...tag} }); }
  save();
  closeM('subFamilyModal');
  if(curView==='tree') renderTree();
  showToast('Family tagged!');
}
function removeSubFamily(){
  const aId=parseInt(document.getElementById('sfCoupleA').value);
  const bIdRaw=document.getElementById('sfCoupleB').value;
  const bId=bIdRaw?parseInt(bIdRaw):null;
  const a=gm(aId), b=bId?gm(bId):null;
  if(a){ a.subFamily=null; syncPersonEverywhere(a.personId, { subFamily:null }); }
  if(b){ b.subFamily=null; syncPersonEverywhere(b.personId, { subFamily:null }); }
  save();
  closeM('subFamilyModal');
  if(curView==='tree') renderTree();
  showToast('Tag removed');
}

function updCt(){
  const n=DB.members.length;
  const t=n+' member'+(n!==1?'s':'');
  document.getElementById('topCt').textContent=t;
  document.getElementById('sbCt').textContent=t;
}
function gm(id){ return (DB && DB.members) ? DB.members.find(m=>m.id===id) : null; }
function fn(m){ return m ? (m.firstName + (m.lastName ? ' ' + m.lastName : '')) : '—'; }
// Only a MUTUAL spouse link is trusted.

function mSpouses(m){
  if (!m) return [];
  const list = [];
  const ids = Array.isArray(m.spouseIds) ? m.spouseIds : (m.spouseId ? [m.spouseId] : []);
  ids.forEach(sid => {
    const s = gm(sid);
    if(s && (s.spouseId === m.id || (Array.isArray(s.spouseIds) && s.spouseIds.includes(m.id)))) {
      list.push(s);
    }
  });
  return list;
}
function mSpouse(m){ const sps = mSpouses(m); return sps.length > 0 ? sps[0] : null; }

// The "husband" of a couple: the one who controls the family's expand/collapse.
// (lone person → themself; if genders don't decide it, the lower id wins)
function headOf(m, sp){
  if(!sp) return m;
  if(m.gender==='male' && sp.gender!=='male') return m;
  if(sp.gender==='male' && m.gender!=='male') return sp;
  return m.id<sp.id?m:sp;
}
function hasBirthFamily(m){ return (m.parentIds||[]).some(pid=>gm(pid)); }
// Placeholder name: the sub-family tag if one exists, else "<husband's name> Family"
function familyLabel(head, tag){ return (tag&&tag.name) ? tag.name : fn(head)+' Family'; }
// Collapse keys: a number = that husband's own family (children) is collapsed;
// 'b:<wifeId>' = that wife's birth-family side is collapsed.
// Older data may hold a wife's id — move it to her husband.
// Parent/child links must be two-way. The layout draws children from childIds,
// but the collapse buttons look at parentIds — if only one side was saved, a
// wife's birth family showed on the chart yet she got no button. Fix both ways.
function repairParentLinks(){
  allTrees().forEach(t=>{
    const ms=t.members||[], byId=new Map(ms.map(m=>[m.id,m]));
    ms.forEach(p=>{
      (p.childIds||[]).forEach(cid=>{ const c=byId.get(cid);
        if(c){ if(!Array.isArray(c.parentIds)) c.parentIds=[]; if(!c.parentIds.includes(p.id)) c.parentIds.push(p.id); } });
      (p.parentIds||[]).forEach(pid=>{ const q=byId.get(pid);
        if(q){ if(!Array.isArray(q.childIds)) q.childIds=[]; if(!q.childIds.includes(p.id)) q.childIds.push(p.id); } });
    });
  });
}
// A wife may have NO parents in this tree but be linked (same personId) to a
// record in ANOTHER tree where her parents are recorded — that's her birth family.
function findBirthSource(m){
  if(!m || !m.personId) return null;
  for(const t of allTrees()){
    if(t.id===APP.activeTreeId) continue;
    const ms=t.members||[];
    const rec=ms.find(x=>x.personId===m.personId);
    if(rec && (rec.parentIds||[]).some(pid=>ms.some(y=>y.id===pid))) return { tree:t, rec };
  }
  return null;
}
// Copies her birth-family side (parents, siblings, their families) from the
// other tree into this one, keeping personIds so everyone stays linked.
function importBirthFamily(id){
  const w=gm(id), found=w&&findBirthSource(w); if(!found) return;
  showConfirm('Bring in '+fn(w)+"'s family?", 'Copy her parents and siblings from "'+found.tree.name+'" into this tree?', ()=>{
    const sm=found.tree.members, byId=new Map(sm.map(x=>[x.id,x])), srcW=found.rec;
    const mutual=m=>{ const x=m.spouseId?byId.get(m.spouseId):null; return (x&&x.spouseId===m.id)?x:null; };
    let top=srcW, guard=0;
    for(;;){
      const ps=(top.parentIds||[]).map(i=>byId.get(i)).filter(Boolean);
      if(!ps.length || guard++>50) break;
      top=ps.find(p=>(p.parentIds||[]).some(i=>byId.has(i))) || ps[0];
    }
    const seen=new Set([srcW.id]); const wsp=mutual(srcW); if(wsp) seen.add(wsp.id);
    const ids=[];
    (function col(i){
      const m=byId.get(i); if(!m||seen.has(i)) return;
      seen.add(i); ids.push(i);
      const sp=mutual(m); if(sp&&!seen.has(sp.id)){ seen.add(sp.id); ids.push(sp.id); }
      new Set([...(m.childIds||[]), ...(sp?(sp.childIds||[]):[])]).forEach(col);
    })(top.id);
    const map=new Map([[srcW.id, w]]);
    ids.forEach(i=>{
      const m=byId.get(i);
      const ex=m.personId && DB.members.find(x=>x.personId===m.personId);
      if(ex){ map.set(i,ex); return; }
      const c=JSON.parse(JSON.stringify(m));
      c.id=DB.nextId++; c.spouseId=null; c.parentIds=[]; c.childIds=[];
      DB.members.push(c); map.set(i,c);
    });
    if(w.childOrder==null && srcW.childOrder!=null) w.childOrder=srcW.childOrder;
    const link=(par,ch)=>{
      if(!par||!ch||par===ch) return;
      if(!ch.parentIds.includes(par.id)) ch.parentIds.push(par.id);
      if(!par.childIds.includes(ch.id)) par.childIds.push(ch.id);
    };
    ids.forEach(i=>{
      const m=byId.get(i), nm=map.get(i);
      const sp=mutual(m), nsp=sp&&map.get(sp.id);
      if(nsp && !nm.spouseId && !nsp.spouseId){ nm.spouseId=nsp.id; nsp.spouseId=nm.id; }
      (m.childIds||[]).forEach(ci=>link(nm, map.get(ci)));
    });
    save(); renderTree();
    showToast("Brought in "+fn(w)+"'s family");
  }, 'Bring in');
}

function findDaughterBranchTree(m) {
  if (!m || !m.personId) return null;
  const sp = mSpouse(m);

  // The woman in this couple must be a daughter born in the CURRENT active tree (has parents in current tree)
  const isFM = m.gender === 'female' && (m.parentIds || []).some(pid => gm(pid));
  const isFSp = sp && sp.gender === 'female' && (sp.parentIds || []).some(pid => gm(pid));

  if (!isFM && !isFSp) {
    return null;
  }

  const daughter = isFM ? m : sp;

  for (const t of allTrees()) {
    if (t.id === APP.activeTreeId) continue;
    const ms = t.members || [];
    const rec = ms.find(x => x.personId === daughter.personId);
    if (rec) {
      // If in target tree t she has parents recorded, then t is her birth family tree, NOT a daughter branch tree
      const hasParentsInTarget = (rec.parentIds || []).some(pid => ms.some(y => y.id === pid));
      if (hasParentsInTarget) continue;

      const spRec = sp ? ms.find(x => x.personId === (m === daughter ? (sp && sp.personId) : m.personId)) : null;
      const isRootInTarget = !(rec.parentIds || []).some(pid => ms.some(y => y.id === pid));
      const hasKidsInTarget = (rec.childIds || []).length > 0 || (spRec && (spRec.childIds || []).length > 0);

      if (isRootInTarget || hasKidsInTarget) {
        return { tree: t, rec };
      }
    }
  }
  return null;
}

function handleDaughterBranchClick(id) {
  const m = gm(id);
  if (!m) return;
  const branch = findDaughterBranchTree(m);
  if (branch) {
    switchTree(branch.tree.id);
    showToast('Opened branched family tree: ' + branch.tree.name);
  } else {
    promptCreateDaughterBranch(id);
  }
}

function promptCreateDaughterBranch(id) {
  const m = gm(id);
  if (!m) return;
  const sp = mSpouse(m);
  const daughterName = fn(m);
  const coupleName = sp ? (fn(sp) + ' & ' + daughterName) : daughterName;
  
  showConfirm(
    'Branch off ' + daughterName + "'s Family?",
    'Create a separate family tree for ' + coupleName + '? This will set up a branch tree where you can build their married family line.',
    () => {
      branchDaughterTree(id, 'child');
    },
    'Branch Off'
  );
}

function normalizeCollapsed(){
  repairParentLinks();
  allTrees().forEach(t=>{
    const ms=t.members||[];
    t.collapsed=[...new Set((t.collapsed||[]).map(k=>{
      if(typeof k!=='number') return k;
      const m=ms.find(x=>x.id===k); if(!m) return k;
      const sp=m.spouseId?ms.find(x=>x.id===m.spouseId):null;
      return (sp&&sp.spouseId===m.id)?headOf(m,sp).id:k;
    }))];
  });
}


