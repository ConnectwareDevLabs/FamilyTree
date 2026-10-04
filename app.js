// ── data.js ──
// ══════════════════════════════════════════════════════════════════
//  FamilyRoot — app.js
//  ------------------------------------------------------------------
//  All behaviour and state for the FamilyRoot family-tree app. Pairs
//  with index.html (structure/markup) and styles.css (visuals).
//
//  Everything is persisted to the browser's localStorage — there is
//  no backend/server. See MULTI-TREE STORAGE below for the exact
//  shape that gets saved.
//
//  Rough map of this file, top to bottom:
//    1. DATA / MULTI-TREE STORAGE  — load/save, the APP object
//    2. TREE MANAGEMENT            — create/switch/rename/duplicate/delete trees
//    3. Generic prompt/confirm     — modal replacements for window.prompt/confirm
//    4. COLLAPSE / EXPAND          — hide/show a branch's descendants
//    5. PEOPLE DIRECTORY           — reusing one real person across trees
//    6. VIEWS                     — tree canvas vs. plain list
//    7. TREE LAYOUT               — the recursive positioning algorithm
//    8. LIST VIEW
//    9. NODE CLICK → ACTIONS       — the action-grid popup
//   10. ADD / EDIT MEMBER          — the member form + save logic
//   11. "THEIR FAMILY" quick-add   — describe mother/father/spouse/siblings/
//                                    children for a brand-new person in one go
//   12. VIEW MEMBER                — read-only profile + photo gallery
//   13. REMOVE MEMBER
//   14. SHARE / EXPORT / IMPORT / BACKUP / RESTORE
//   15. UTILS                     — small DOM helpers, incl. the shared
//                                    floating search dropdown (see note below)
//   16. PAN & ZOOM                — the free-panning/zoomable canvas
//   17. DRAG TO REORDER SIBLINGS  — drag a child left/right to resequence
//   18. BOOT
//
//  NOTE on the floating search dropdown: every "reuse an existing
//  person" live-search field (First Name, Mother/Father/Spouse,
//  Sibling/Child rows, and the multi-child modal) renders its results
//  through ONE shared element appended directly to <body> (see
//  ensureFloatDD / showFloatDropdown / hideFloatDropdown), instead of
//  a dropdown nested inside the form. Reason: memberModal and
//  multiChildModal both use Bootstrap's .modal-dialog-scrollable,
//  which sets overflow:hidden on .modal-content and overflow-y:auto
//  on .modal-body — a normally-positioned dropdown gets silently
//  clipped by that (the search still runs, the results just never
//  become visible). The shared floating element is positioned with
//  `position:fixed` coordinates computed from the triggering input's
//  getBoundingClientRect(), which sidesteps any ancestor's overflow
//  entirely.
// ══════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════
//  DATA  — persisted to localStorage
// ══════════════════════════════════════════════════════
/*
  Member shape (one entry in a tree's `members` array):
  {
    id: number,                    // unique WITHIN this tree only
    personId: string,              // globally unique — same real person
                                    // can appear in multiple trees under
                                    // the same personId ("reuse" feature)
    firstName, lastName,
    gender: 'male' | 'female',
    dob: string,                   // 'YYYY-MM-DD' or ''
    phone, email, address, occupation,
    hobbies: string,
    bio: string,                   // free-text biography
    deceased: boolean,
    deathDate: string,             // only meaningful when deceased is true
    photo: string|null,            // data URL — the current profile picture
    photos: string[],              // data URLs — full photo gallery
    childOrder: number|undefined,  // birth-order among siblings; only set
                                    // on members who ARE someone's child
                                    // (never on spouses or root members)
    spouseId: number|null,
    parentIds: number[],           // 0, 1, or 2 entries
    childIds:  number[]
  }

  Tree rules:
  - A person can have ONE spouse (bidirectional).
  - Children are linked to both parents (the one you click + their spouse).
  - Parents sit ABOVE the member (grandparents above parents etc.)
  - Siblings share the same parent(s), appear in the same row as the member,
    ordered left-to-right by childOrder (see sortByOrder / uniqueChildren).
  - The tree is re-computed from scratch each render using a recursive layout.
*/

// ══════════════════════════════════════════════════════
//  MULTI-TREE STORAGE
//  APP.trees: { treeId: { id, name, updatedAt, nextId, members:[], collapsed:[] } }
//  Each member gets a stable personId — used to "reuse" the same person
//  (their name/DOB/phone/etc.) across different saved trees.
// ══════════════════════════════════════════════════════
let APP = { trees:{}, activeTreeId:null };
let DB;              // always === APP.trees[APP.activeTreeId]
let curView = 'tree';
let selId = null;
let viewId = null;
let rmId  = null;

function genPersonId(){ return 'p_'+Date.now().toString(36)+Math.random().toString(36).slice(2,7); }
function genTreeId(){ return 't_'+Date.now().toString(36)+Math.random().toString(36).slice(2,6); }
const allTrees = () => Object.values(APP.trees);

function save(){ saveApp(); }
function saveApp(){
  if(DB) DB.updatedAt = Date.now();
  localStorage.setItem('familyRoot_app_v1', JSON.stringify(APP));
  updCt();
}
function load(){
  try{
    const r = localStorage.getItem('familyRoot_app_v1');
    if(r){
      APP = JSON.parse(r);
    } else {
      // First run on this device with the new multi-tree format — migrate
      // any older single-tree data so nothing gets lost.
      let legacy=null;
      try{ const lr=localStorage.getItem('familyRoot_v3'); if(lr) legacy=JSON.parse(lr); }catch(e){}
      const id=genTreeId();
      const members=(legacy&&legacy.members)?legacy.members:[];
      members.forEach(m=>{ if(!m.personId) m.personId=genPersonId(); });
      APP={ trees:{ [id]:{ id, name:'My Family Tree', updatedAt:Date.now(),
        nextId:(legacy&&legacy.nextId)||1, members, collapsed:(legacy&&legacy.collapsed)||[] } },
        activeTreeId:id };
    }
  }catch(e){
    const id=genTreeId();
    APP={ trees:{ [id]:{ id,name:'My Family Tree',updatedAt:Date.now(),nextId:1,members:[],collapsed:[] } }, activeTreeId:id };
  }
  if(!APP.trees || Object.keys(APP.trees).length===0){
    const id=genTreeId();
    APP.trees={ [id]:{ id,name:'My Family Tree',updatedAt:Date.now(),nextId:1,members:[],collapsed:[] } };
    APP.activeTreeId=id;
  }
  if(!APP.activeTreeId || !APP.trees[APP.activeTreeId]) APP.activeTreeId=Object.keys(APP.trees)[0];
  
  const urlParams = new URLSearchParams(window.location.search);
  const tId = urlParams.get('treeId');
  if(tId && APP.trees[tId]) {
    APP.activeTreeId = tId;
  }

  DB=APP.trees[APP.activeTreeId];
  if(!Array.isArray(DB.collapsed)) DB.collapsed=[];
  (DB.members||[]).forEach(m=>{ if(!m.personId) m.personId=genPersonId(); });
  repairSpouseLinks();
  normalizeCollapsed();
  updCt();
  updateTreeBadge();
}
// One-way/asymmetric spouseId (A points to B, but B doesn't point back to A)
// draws a stray spouse connector to whoever A's spouseId happens to point
// at — including a sibling, if ids ever got reused/corrupted. Only a
// mutual (A<->B) link is trusted anywhere in the app; this scrubs any
// broken half-links in every tree, every time the app loads.
function repairSpouseLinks(){
  let fixed=0;
  allTrees().forEach(t=>{
    (t.members||[]).forEach(m=>{
      if(!m.spouseId) return;
      const sp=(t.members||[]).find(x=>x.id===m.spouseId);
      if(!sp || sp.spouseId!==m.id){ m.spouseId=null; fixed++; }
    });
  });
  if(fixed) saveApp();
}



// ── trees.js ──
// ══════════════════════════════════════════════════════
//  TREE MANAGEMENT (save / switch / rename / duplicate / delete)
// ══════════════════════════════════════════════════════
function updateTreeBadge(){
  const el=document.getElementById('brandTreeName');
  if(el) el.innerHTML=(DB&&DB.name?DB.name:'FamilyRoot')+' <span style="font-size:.65rem;opacity:.75;">▾</span>';
}
function openTreesModal(){ renderTreesList(); getM('treesModal').show(); }
function timeAgo(ts){
  if(!ts) return 'just now';
  const s=Math.floor((Date.now()-ts)/1000);
  if(s<60) return 'just now';
  const m=Math.floor(s/60); if(m<60) return m+'m ago';
  const h=Math.floor(m/60); if(h<24) return h+'h ago';
  const d=Math.floor(h/24); if(d<30) return d+'d ago';
  return new Date(ts).toLocaleDateString();
}
function renderTreesList(){
  const ids=Object.keys(APP.trees).sort((a,b)=>(APP.trees[b].updatedAt||0)-(APP.trees[a].updatedAt||0));
  document.getElementById('treesList').innerHTML=ids.map(id=>{
    const t=APP.trees[id];
    const isActive=id===APP.activeTreeId;
    const n=(t.members||[]).length;
    return `<div class="list-item rounded-3" style="${isActive?'background:var(--pp);':''}cursor:pointer;" onclick="switchTreeAndClose('${id}')">
      <span style="font-size:1.4rem">${isActive?'🌳':'📁'}</span>
      <div style="flex:1;min-width:0;">
        <div class="lname">${t.name}${isActive?' <span style="color:var(--p);font-size:.7rem;font-weight:700;">· current</span>':''}</div>
        <div class="lrel">${n} member${n!==1?'s':''} · updated ${timeAgo(t.updatedAt)}</div>
      </div>
      <div style="display:flex;gap:2px;flex-shrink:0;">
        <button class="ib" style="color:var(--p);" onclick="event.stopPropagation();promptRenameTree('${id}')" title="Rename">✏️</button>
        <button class="ib" style="color:var(--p);" onclick="event.stopPropagation();duplicateTree('${id}')" title="Duplicate">📋</button>
        <button class="ib" style="color:#c0392b;" onclick="event.stopPropagation();confirmDeleteTree('${id}')" title="Delete">🗑️</button>
      </div>
    </div>`;
  }).join('');
}
function switchTree(id){
  if(!APP.trees[id]) return;
  tempSubTreeHeadId = null;
  if(typeof updateSubTreeBanner === 'function') updateSubTreeBanner(null);
  APP.activeTreeId=id; DB=APP.trees[id];
  selId=null; viewId=null;
  saveApp(); updateTreeBadge();
  if(curView==='tree') { renderTree(); setTimeout(fitToScreen, 0); } else if(curView==='graph') { renderGraph(); setTimeout(fitGraphToScreen, 50); } else renderList();
}
function switchTreeAndClose(id){ switchTree(id); closeM('treesModal'); showToast('Switched to "'+APP.trees[id].name+'"'); }
function newTree(name){
  const id=genTreeId();
  APP.trees[id]={ id, name:(name||'New Tree').trim()||'New Tree', updatedAt:Date.now(), nextId:1, members:[], collapsed:[] };
  APP.activeTreeId=id; DB=APP.trees[id];
  selId=null; viewId=null;
  saveApp(); updateTreeBadge();
  if(curView==='tree') { renderTree(); setTimeout(fitToScreen, 0); } else if(curView==='graph') { renderGraph(); setTimeout(fitGraphToScreen, 50); } else renderList();
}
function promptNewTree(){
  closeM('treesModal');
  setTimeout(()=>{
    showPrompt('Name this family tree', 'New Family Tree', name=>{
      if(!name){ openTreesModal(); return; }
      newTree(name);
      showToast('Created "'+DB.name+'"');
    });
  }, 300);
}
function promptRenameTree(id){
  const t=APP.trees[id]; if(!t) return;
  closeM('treesModal');
  setTimeout(()=>{
    showPrompt('Rename tree', t.name, name=>{
      if(!name){ openTreesModal(); return; }
      t.name=name; t.updatedAt=Date.now();
      saveApp(); updateTreeBadge();
      openTreesModal();
      showToast('Renamed!');
    });
  }, 300);
}
function duplicateTree(id){
  const src=APP.trees[id]; if(!src) return;
  const nid=genTreeId();
  const copy=JSON.parse(JSON.stringify(src));
  copy.id=nid; copy.name=src.name+' (Copy)'; copy.updatedAt=Date.now();
  APP.trees[nid]=copy;
  saveApp(); renderTreesList();
  showToast('Duplicated "'+src.name+'"');
}
function confirmDeleteTree(id){
  if(Object.keys(APP.trees).length<=1){ showToast("Can't delete your only tree"); return; }
  const t=APP.trees[id]; if(!t) return;
  closeM('treesModal');
  setTimeout(()=>{
    showConfirm('Delete "'+t.name+'"?', 'This cannot be undone.', ()=>{
      delete APP.trees[id];
      if(APP.activeTreeId===id){
        const nid=Object.keys(APP.trees)[0];
        APP.activeTreeId=nid; DB=APP.trees[nid];
      }
      selId=null; viewId=null;
      saveApp(); updateTreeBadge();
      if(curView==='tree') { renderTree(); setTimeout(fitToScreen, 0); } else if(curView==='graph') { renderGraph(); setTimeout(fitGraphToScreen, 50); } else renderList();
      showToast('Tree deleted');
    }, 'Delete');
  }, 300);
}

// ── Generic modal-based replacements for window.prompt()/confirm() ──
// Some embedded/in-app browsers silently block native JS dialogs, which
// made buttons that relied on them look broken. These use the app's own
// Bootstrap modals instead, which always work.
let promptCallback=null, confirmCallback=null;
function showPrompt(title, defaultValue, callback, inputType, placeholder){
  document.getElementById('promptTitle').textContent=title;
  const inp=document.getElementById('promptInput');
  inp.value=defaultValue||'';
  inp.type=inputType||'text';
  inp.placeholder=placeholder||'';
  promptCallback=callback;
  getM('promptModal').show();
  setTimeout(()=>inp.focus(),300);
}
function submitPrompt(){
  const val=document.getElementById('promptInput').value.trim();
  closeM('promptModal');
  const cb=promptCallback; promptCallback=null;
  if(cb) cb(val);
}
function showConfirm(title, text, callback, okLabel){
  document.getElementById('confirmTitle').textContent=title;
  document.getElementById('confirmTxt').textContent=text||'';
  document.getElementById('confirmOkBtn').textContent=okLabel||'Confirm';
  confirmCallback=callback;
  getM('confirmModal').show();
}
function submitConfirm(){
  closeM('confirmModal');
  const cb=confirmCallback; confirmCallback=null;
  if(cb) cb();
}




// ── collapse.js ──
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




// ── person.js ──
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



// ── views.js ──
// ══════════════════════════════════════════════════════
//  VIEWS & NAVIGATION
// ══════════════════════════════════════════════════════
var tempSubTreeHeadId = null;

function getSubTreeMemberIds(headId) {
  const head = gm(headId);
  if (!head) return new Set();
  const subIds = new Set();

  function collect(mId) {
    const m = gm(mId);
    if (!m || subIds.has(mId)) return;
    subIds.add(mId);
    
    // add mutual spouses
    const sps = mSpouses(m);
    sps.forEach(sp => {
      if (!subIds.has(sp.id)) {
        subIds.add(sp.id);
      }
    });

    // add children
    const kids = uniqueChildren(m, sps[0]);
    kids.forEach(kId => collect(kId));
  }

  collect(headId);
  return subIds;
}

function viewSubTree(headId) {
  tempSubTreeHeadId = headId;
  const m = gm(headId);
  const sp = m ? mSpouse(m) : null;
  const tag = m ? (m.subFamily || (sp && sp.subFamily)) : null;
  const name = (tag && tag.name) ? tag.name : (m ? familyLabel(headOf(m, sp), tag) : 'Sub-Tree');

  updateSubTreeBanner(name);
  if (typeof closeM === 'function') closeM('subFamilyModal');
  if (typeof closeM === 'function') closeM('actModal');

  if (curView === 'tree') {
    renderTree();
    setTimeout(fitToScreen, 0);
  } else if (curView === 'graph') {
    renderGraph();
    setTimeout(fitGraphToScreen, 50);
  } else {
    renderList();
  }

  showToast('Viewing isolated sub-tree: ' + name);
}

function clearSubTree() {
  if (!tempSubTreeHeadId) return;
  tempSubTreeHeadId = null;
  updateSubTreeBanner(null);

  if (curView === 'tree') {
    renderTree();
    setTimeout(fitToScreen, 0);
  } else if (curView === 'graph') {
    renderGraph();
    setTimeout(fitGraphToScreen, 50);
  } else {
    renderList();
  }

  showToast('Returned to full family tree view');
}

function updateSubTreeBanner(title) {
  let banner = document.getElementById('subTreeBanner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'subTreeBanner';
    banner.style.cssText = 'position:fixed;top:56px;left:0;right:0;z-index:999;background:linear-gradient(90deg,#7b2fbe,#9d4edd);color:#fff;box-shadow:0 2px 8px rgba(0,0,0,0.15);display:none;align-items:center;justify-content:space-between;padding:8px 16px;font-size:0.9rem;';
    document.body.appendChild(banner);
  }

  if (title) {
    banner.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="font-size:1.1rem;">👁️</span>
        <span>Viewing isolated sub-tree: <strong>${title}</strong></span>
      </div>
      <button class="btn btn-sm btn-light rounded-pill px-3 fw-semibold text-primary" onclick="clearSubTree()">Exit Sub-Tree View ✕</button>
    `;
    banner.style.display = 'flex';
  } else {
    banner.style.display = 'none';
  }
}

function viewSubTreeFromModal() {
  const aIdRaw = document.getElementById('sfCoupleA').value;
  if (!aIdRaw) return;
  const aId = parseInt(aIdRaw);
  viewSubTree(aId);
}
function setView(v){
  curView = v;
  const canvasWrap = document.getElementById('canvasWrap');
  const graphWrap  = document.getElementById('graphWrap');
  const listView   = document.getElementById('listView');
  const treeSrch   = document.getElementById('treeSearchWrap');

  if(canvasWrap) canvasWrap.style.display = (v==='tree') ? 'block' : 'none';
  if(graphWrap)  graphWrap.style.display  = (v==='graph') ? 'block' : 'none';
  if(listView)   listView.style.display   = (v==='list') ? 'block' : 'none';
  if(treeSrch)   treeSrch.style.display   = (v==='tree' || v==='graph') ? 'block' : 'none';

  const pills = document.querySelectorAll('.view-pill');
  pills.forEach(p => {
    p.classList.toggle('active', p.dataset.view === v);
  });

  if(v==='tree') {
    renderTree();
    setTimeout(fitToScreen, 0);
  } else if(v==='graph') {
    renderGraph(); setTimeout(fitGraphToScreen, 50);
  } else {
    renderList();
  }
}

function toggleView(){
  if(curView === 'tree') setView('graph');
  else if(curView === 'graph') setView('list');
  else setView('tree');
}


// ── layout.js ──
// ══════════════════════════════════════════════════════
//  TREE LAYOUT
//
//  Strategy:
//  1. Find the TRUE root generation (members with no parents in DB).
//  2. Build the tree TOP-DOWN: roots at top, children below them.
//  3. Each "unit" = member + optional spouse side-by-side.
//  4. Layout is recursive: measure widths bottom-up, place top-down.
//  5. SVG lines connect everything.
// ══════════════════════════════════════════════════════
const NW=90, NH=100, HGAP=18, SGAP=14, VGAP=64, PAD=30;
const PHW=140; // width of the collapsed "sub-family" placeholder card (wider than a normal node)

function renderTree(){
  const inner  = document.getElementById('innerWrap');
  const svg    = document.getElementById('treeSvg');
  const empty  = document.getElementById('emptyState');

  // Remove old nodes (keep SVG)
  Array.from(inner.querySelectorAll('.node, .spouse-tag-btn')).forEach(n=>n.remove());
  svg.innerHTML='';

  if(DB.members.length===0){
    empty.style.display='flex';
    inner.style.width='0'; inner.style.height='0';
    zoomScale=1; panX=0; panY=0; applyTransform();
    return;
  }
  empty.style.display='none';

  // Nodes whose children are hidden (collapsed branch)
  const collapsedSet = new Set(DB.collapsed||[]);
  const isCollapsed = (m, sp) => collapsedSet.has(headOf(m, sp).id); // husband/head controls the family
  const birthCollapsed = new Set((DB.collapsed||[]).filter(k=>typeof k==='string'&&k.startsWith('b:')).map(k=>parseInt(k.slice(2))));

  // ── 1. Identify root generation ──────────────────
  // Root = member whose parentIds are empty OR none of their parents exist in DB
  const allIds = new Set(DB.members.map(m=>m.id));

  let subTreeMemberIds = null;
  let subRootHeadId = null;
  let subRootSpouseId = null;
  if (typeof tempSubTreeHeadId !== 'undefined' && tempSubTreeHeadId !== null) {
    subTreeMemberIds = getSubTreeMemberIds(tempSubTreeHeadId);
    const headM = gm(tempSubTreeHeadId);
    if (headM) {
      const sp = mSpouse(headM);
      const rootH = headOf(headM, sp);
      const rootSp = rootH ? mSpouse(rootH) : null;
      subRootHeadId = rootH ? rootH.id : null;
      subRootSpouseId = rootSp ? rootSp.id : null;
    }
  }

  // A wife whose birth side is collapsed is treated as having no visible parents
  const isRoot = m => {
    if (subTreeMemberIds) {
      return m.id === subRootHeadId || (subRootSpouseId !== null && m.id === subRootSpouseId);
    }
    return !((m.parentIds||[]).some(pid=>allIds.has(pid)) && !birthCollapsed.has(m.id));
  };

  const membersToRender = subTreeMemberIds ? DB.members.filter(m => subTreeMemberIds.has(m.id)) : DB.members;

  // Collect unique root "heads" (ignore spouses of roots, they get placed alongside)
  const visited = new Set();
  const roots = membersToRender.filter(m=>{

    if(!isRoot(m)) return false;

    // If this member has no parents but their spouse does, the spouse's
    // ancestry is the real root of the couple. Rendering this member as
    // another root would split/duplicate the family tree.
    const sp = m.spouseId ? gm(m.spouseId) : null;
    const spouseHasParents = sp && !isRoot(sp);

    if(spouseHasParents) return false;

    // If both spouses are roots, render the couple only once.
    return !(sp && isRoot(sp) && sp.id < m.id);
  });

  // ── 2. Compute layout ────────────────────────────
  const positions = {};    // id → {x,y}
  const lines = [];        // SVG drawing instructions
  const placeholders = []; // collapsed+tagged sub-family cards to render instead of hidden descendants
  const spouseButtons = []; // the small 🏷️ tag/untag button sitting on each spouse connector

  // ── Wives whose birth-family side is collapsed ──
  // Everyone on her side (except her own couple + descendants) is hidden and
  // replaced by ONE placeholder card linked to her with a dashed line.
  function collectBlock(id, seen, out){
    const m=gm(id); if(!m || seen.has(id)) return;
    seen.add(id); out.push(id);
    const sp=mSpouse(m);
    if(sp && !seen.has(sp.id)){ seen.add(sp.id); out.push(sp.id); }
    uniqueChildren(m, sp).forEach(cid=>collectBlock(cid, seen, out));
  }
  const protect = new Set();
  const collapsedWives = DB.members.filter(w=>{
    const sp=mSpouse(w);
    return birthCollapsed.has(w.id) && sp && headOf(w,sp)!==w && hasBirthFamily(w);
  });
  collapsedWives.forEach(w=>{ protect.add(w.id); protect.add(mSpouse(w).id); });
  const hiddenGroups = collapsedWives.map(w=>{
    let top=w, guard=0;
    for(;;){
      const ps=(top.parentIds||[]).map(gm).filter(p=>p && !protect.has(p.id));
      if(!ps.length || guard++>50) break;
      top=ps.find(p=>hasBirthFamily(p)) || ps[0];
    }
    if(top===w) return null;
    const ids=[]; collectBlock(top.id, new Set(protect), ids);
    if(!ids.length) return null;
    const par=(w.parentIds||[]).map(gm).filter(Boolean);
    const father=par.find(p=>p.gender==='male') || par[0];
    const fsp=mSpouse(father);
    return { wId:w.id, set:new Set(ids), count:ids.length, placed:false, x:0,
             name: familyLabel(father, father.subFamily || (fsp&&fsp.subFamily)) };
  }).filter(Boolean);

  // Counts every distinct person (children, their spouses, grandchildren...)
  // hidden underneath a collapsed couple — used for the placeholder's
  // "N members" label. Ignores collapse state of nested branches, since
  // we want the TRUE total, not however much is currently expanded.
  function countDescendants(id, seen){
    const m=gm(id); if(!m || seen.has(id)) return 0;
    seen.add(id);
    let count=1;
    const sp=(m.spouseId&&gm(m.spouseId)&&gm(m.spouseId).spouseId===m.id)?gm(m.spouseId):null; // only trust MUTUAL spouse links
    if(sp && !seen.has(sp.id)){ seen.add(sp.id); count++; }
    uniqueChildren(m, sp).filter(cid=>!seen.has(cid)).forEach(cid=>{ count+=countDescendants(cid, seen); });
    return count;
  }
  function countHiddenDescendants(m, sp){
    const seen=new Set([m.id]); if(sp) seen.add(sp.id);
    let total=0;
    uniqueChildren(m, sp).forEach(cid=>{ total+=countDescendants(cid, seen); });
    return total;
  }

  // Measure the total pixel width a subtree rooted at `id` needs
    function measure(id, seen){
    if(seen.has(id)) return NW;
    seen.add(id);
    const m=gm(id); if(!m) return NW;
    const sps = mSpouses(m);
    sps.forEach(s => seen.add(s.id));
    const coupleW = NW * (1 + sps.length) + SGAP * sps.length;
    
    const childIds = uniqueChildren(m, sps[0]).filter(cid => !seen.has(cid) && gm(cid));
    const branchCollapsed = isCollapsed(m, sps[0]);
    if(branchCollapsed) return Math.max(coupleW, PHW);

    if(childIds.length===0) return coupleW;

    const childrenW = childIds.reduce((sum, cid, i) =>
      sum + measure(cid, new Set([...seen])) + (i > 0 ? HGAP : 0), 0);
    return Math.max(coupleW, childrenW);
  }

  // Place unit for `id` with top-left corner at (x, y). Returns {x,y} of couple centre.
    function place(id, x, y, seen){
    if(seen.has(id)) return null;
    seen.add(id);
    const m=gm(id); if(!m) return null;
    const sps = mSpouses(m);
    sps.forEach(s => seen.add(s.id));

    const coupleW = NW * (1 + sps.length) + SGAP * sps.length;
    const allKids = uniqueChildren(m, sps[0]).filter(cid => !seen.has(cid) && gm(cid));
    const branchCollapsed = isCollapsed(m, sps[0]);
    const tag = branchCollapsed ? { name: familyLabel(headOf(m, sps[0]), m.subFamily || (sps[0] && sps[0].subFamily)) } : null;
    const childIds = branchCollapsed ? [] : allKids;

    if(branchCollapsed) {
      const unitW = Math.max(coupleW, PHW);
      const phX = x + (unitW - PHW) / 2;
      const phY = y;
      const count = countHiddenDescendants(m, sps[0]) + 1 + sps.length;
      placeholders.push({ key: headOf(m, sps[0]).id, x: phX, y: phY, tag, count });
      
      positions[id] = { x: phX + (PHW-NW)/2, y: phY, isPlaceholder: true };
      sps.forEach(s => { positions[s.id] = { x: phX + (PHW-NW)/2, y: phY, isPlaceholder: true }; });
      return x + unitW/2;
    }

    let childrenW = 0;
    const childSeenClone = new Set([...seen]);
    childIds.forEach((cid, i) => {
      childrenW += measure(cid, new Set([...childSeenClone])) + (i > 0 ? HGAP : 0);
    });

    const unitW = Math.max(coupleW, childrenW);
    const coupleLeft = x + (unitW - coupleW) / 2;

    let membersToPlace = [m, ...sps];
    if (sps.length === 1 && m.gender === 'female' && sps[0].gender !== 'female') {
      membersToPlace = [sps[0], m];
    }

    membersToPlace.forEach((mem, idx) => {
      positions[mem.id] = { x: coupleLeft + idx * (NW + SGAP), y };
    });

    for (let i = 0; i < membersToPlace.length - 1; i++) {
      const memA = membersToPlace[i];
      const memB = membersToPlace[i + 1];
      const posXA = positions[memA.id].x;
      const midX = posXA + NW + SGAP / 2, midY = y + 38;
      lines.push({ type: 'spouse', x1: posXA + NW, x2: posXA + NW + SGAP, y: midY });
      spouseButtons.push({ x: midX, y: midY, aId: memA.id, bId: memB.id, tagged: !!(memA.subFamily || memB.subFamily) });
    }

    const coupleMidX = coupleLeft + coupleW / 2;

    if(childIds.length > 0){
      const childY = y + NH + VGAP;
      const childSeenPlace = new Set([...seen]);
      const childWidths = childIds.map(cid => measure(cid, new Set([...childSeenPlace])));
      const totalChildW = childWidths.reduce((s, w, i) => s + w + (i > 0 ? HGAP : 0), 0);
      let cx = x + (unitW - totalChildW) / 2;

      const childMidXs = [];
      childIds.forEach((cid, i) => {
        const result = place(cid, cx, childY, seen);
        const cm = gm(cid), csps = mSpouses(cm);
        const cCoupleW = NW * (1 + csps.length) + SGAP * csps.length;
        const cUnitW = childWidths[i];
        const cCoupleLeft = cx + (cUnitW - cCoupleW) / 2;
        childMidXs.push(cCoupleLeft + cCoupleW / 2);
        cx += childWidths[i] + HGAP;
      });

            lines.push({
        type: 'children',
        parentMidX: coupleMidX,
        parentBottomY: y + NH,
        childTopY: childY,
        childMidXs: childMidXs
      });
    }

    return coupleMidX;
  }

  // Place all root groups side by side
  let cx = PAD;
  const placedSeen = new Set();
  const addBirthPlaceholder = g=>{
    g.placed=true; g.x=cx;
    placeholders.push({ key:'b:'+g.wId, x:cx, y:PAD, tag:{name:g.name}, count:g.count });
    cx += PHW + HGAP*2;
  };
  roots.forEach(root=>{
    if(placedSeen.has(root.id)) return;
    // This root belongs to a collapsed birth-family side → one placeholder instead
    const grp=hiddenGroups.find(g=>g.set.has(root.id) || (root.spouseId && g.set.has(root.spouseId)));
    if(grp){ if(!grp.placed) addBirthPlaceholder(grp); return; }

    // Snapshot of who was already placed BEFORE this root — used below to
    // detect a child that belongs to this root but got placed by an
    // earlier root instead (this happens when that child is someone's
    // spouse, e.g. "Mom" was already placed next to "Dad" because they
    // are married — her own parents still need a connector line to her).
    const preSeen = new Set(placedSeen);

    const w = measure(root.id, new Set([...placedSeen]));
    place(root.id, cx, PAD, placedSeen);

    const rootPos = positions[root.id];
    if(rootPos && !isCollapsed(root, mSpouse(root))){
      const sp = root.spouseId ? gm(root.spouseId) : null;
      const coupleW = NW + (sp ? SGAP+NW : 0);
      const coupleMidX = rootPos.x + coupleW/2;
      uniqueChildren(root, sp).forEach(cid=>{
        // This child was already positioned by a previous root (a spouse
        // link) — draw a connector to their existing spot instead of
        // silently dropping the relationship.
        if(preSeen.has(cid) && positions[cid]){
          const cp=positions[cid];
          lines.push({ type:'inlaw', x1:coupleMidX, y1:rootPos.y+NH, x2:cp.x+NW/2, y2:cp.y });
        }
      });
    }

    cx += w + HGAP*2;
  });
  hiddenGroups.forEach(g=>{ if(!g.placed) addBirthPlaceholder(g); });
  // Dashed link from each birth-family placeholder to its wife
  hiddenGroups.forEach(g=>{
    const wp=positions[g.wId]; if(!wp) return;
    const x1=g.x+PHW/2, x2=wp.x+NW/2;
    if(wp.y>PAD+NH+10) lines.push({ type:'inlaw', x1, y1:PAD+NH, x2, y2:wp.y });
    else lines.push({ type:'above', x1, x2, y:PAD-16, y1:PAD, y2:wp.y });
  });

  // ── 3. Compute canvas size ───────────────────────
  let maxX=100, maxY=100;
  Object.values(positions).forEach(p=>{
    maxX=Math.max(maxX, p.x+NW+PAD);
    maxY=Math.max(maxY, p.y+NH+PAD);
  });
  placeholders.forEach(ph=>{ maxX=Math.max(maxX, ph.x+PHW+PAD); maxY=Math.max(maxY, ph.y+NH+PAD); });
  inner.style.width  = maxX+'px';
  inner.style.height = maxY+'px';
  svg.setAttribute('width',  maxX);
  svg.setAttribute('height', maxY);

  // ── 4. Draw SVG lines ────────────────────────────
  let svgContent='';
  lines.forEach(l=>{
    if(l.type==='spouse'){
      // Horizontal line between spouse cards. The little dot/tag button at
      // its centre is now a real clickable element (see spouseButtons
      // below), not drawn here.
      svgContent+=`<line x1="${l.x1}" y1="${l.y}" x2="${l.x2}" y2="${l.y}" stroke="#9D4EDD" stroke-width="2.5"/>`;
    } else if(l.type==='inlaw'){
      // Dashed elbow connecting a parent couple to their child who is
      // already positioned elsewhere (placed there via marriage).
      const midY = l.y1 + (l.y2 - l.y1)/2;
      svgContent+=`<line x1="${l.x1}" y1="${l.y1}" x2="${l.x1}" y2="${midY}" stroke="#9D4EDD" stroke-width="2.5" stroke-dasharray="5,4"/>`;
      svgContent+=`<line x1="${l.x1}" y1="${midY}" x2="${l.x2}" y2="${midY}" stroke="#9D4EDD" stroke-width="2.5" stroke-dasharray="5,4"/>`;
      svgContent+=`<line x1="${l.x2}" y1="${midY}" x2="${l.x2}" y2="${l.y2}" stroke="#9D4EDD" stroke-width="2.5" stroke-dasharray="5,4"/>`;
    } else if(l.type==='above'){
      svgContent+=`<line x1="${l.x1}" y1="${l.y1}" x2="${l.x1}" y2="${l.y}" stroke="#9D4EDD" stroke-width="2.5" stroke-dasharray="5,4"/>`;
      svgContent+=`<line x1="${l.x1}" y1="${l.y}" x2="${l.x2}" y2="${l.y}" stroke="#9D4EDD" stroke-width="2.5" stroke-dasharray="5,4"/>`;
      svgContent+=`<line x1="${l.x2}" y1="${l.y}" x2="${l.x2}" y2="${l.y2}" stroke="#9D4EDD" stroke-width="2.5" stroke-dasharray="5,4"/>`;
    } else if(l.type==='children'){
      const stemY    = l.parentBottomY + 10;
      const midY     = l.parentBottomY + VGAP/2;
      const childTopY= l.childTopY - 10;

      // Vertical stem down from parent couple centre
      svgContent+=`<line x1="${l.parentMidX}" y1="${stemY}" x2="${l.parentMidX}" y2="${midY}" stroke="#9D4EDD" stroke-width="2.5"/>`;

      if(l.childMidXs.length===1){
        // Single child: straight line
        const cx=l.childMidXs[0];
        svgContent+=`<line x1="${l.parentMidX}" y1="${midY}" x2="${cx}" y2="${midY}" stroke="#9D4EDD" stroke-width="2.5"/>`;
        svgContent+=`<line x1="${cx}" y1="${midY}" x2="${cx}" y2="${childTopY}" stroke="#9D4EDD" stroke-width="2.5"/>`;
      } else {
        // Horizontal bar spanning all children
        const leftX  = Math.min(...l.childMidXs);
        const rightX = Math.max(...l.childMidXs);
        svgContent+=`<line x1="${leftX}" y1="${midY}" x2="${rightX}" y2="${midY}" stroke="#9D4EDD" stroke-width="2.5"/>`;
        l.childMidXs.forEach(cx=>{
          svgContent+=`<line x1="${cx}" y1="${midY}" x2="${cx}" y2="${childTopY}" stroke="#9D4EDD" stroke-width="2.5"/>`;
        });
      }
    }
  });
  svg.innerHTML=svgContent;

  // ── 5. Render nodes ──────────────────────────────
  Object.entries(positions).forEach(([idStr,pos])=>{
    if(pos.isPlaceholder) return;
    const id=parseInt(idStr);
    const m=gm(id); if(!m) return;
    const isF=m.gender==='female';
    const nsp=mSpouse(m);
    const isHead=headOf(m,nsp)===m;
    // Husband (or a lone parent) controls the family's children; a wife only
    // gets a control if she has her own birth family — and it only affects that.
    const canCollapse=isHead && (uniqueChildren(m,nsp).some(c=>gm(c)) || nsp || m.subFamily);
    const hasBirth=!isHead && hasBirthFamily(m);
    const extSrc=(!isHead && !hasBirth) ? findBirthSource(m) : null;

    const div=document.createElement('div');
    div.className='node'+(selId===id?' sel':'');
    div.dataset.id=id;
    div.style.left=pos.x+'px';
    div.style.top =pos.y+'px';
    div.onclick=()=>nodeClick(id);
    if((m.parentIds||[]).length>0) attachNodeDrag(div, id);

    const collapsedHere = canCollapse && collapsedSet.has(id);
    const birthHere = hasBirth && birthCollapsed.has(id);

    // Only a woman born in THIS tree (has parents in this tree) triggers a daughter branch icon on her husband card
    const wifeInCouple = isF ? m : (nsp && nsp.gender === 'female' ? nsp : null);
    const isDaughterBornHere = wifeInCouple && (wifeInCouple.parentIds || []).some(pid => gm(pid));

    const daughterBranch = (isHead && isDaughterBornHere) ? (findDaughterBranchTree(m) || (nsp ? findDaughterBranchTree(nsp) : null)) : null;

    let branchHTML = '';
    if (daughterBranch) {
      branchHTML = `<div class="exp-dot branch" title="Open branched family tree &quot;${(daughterBranch.tree.name||'').replace(/"/g,'')}&quot;" onclick="event.stopPropagation();switchTree('${daughterBranch.tree.id}')">🌳</div>`;
    } else if (isDaughterBornHere && isHead && !canCollapse) {
      branchHTML = `<div class="exp-dot branch" title="Branch off family tree" onclick="event.stopPropagation();handleDaughterBranchClick(${id})">▼</div>`;
    }

    div.innerHTML=`
      <div class="node-card">
        ${canCollapse?`<div class="exp-dot" title="${collapsedHere?'Expand':'Collapse'} branch" onclick="event.stopPropagation();toggleCollapse(${id})">${collapsedHere?'▶':'▼'}</div>`:''}
        ${hasBirth?`<div class="exp-dot birth" title="${birthHere?'Expand':'Collapse'} her family side" onclick="event.stopPropagation();toggleCollapse('b:${id}')">${birthHere?'▶':'▲'}</div>`:''}
        ${extSrc?`<div class="exp-dot birth" title="Open her family side in &quot;${(extSrc.tree.name||'').replace(/"/g,'')}&quot;" onclick="event.stopPropagation();switchTree('${extSrc.tree.id}')">🌳</div>`:''}
        ${branchHTML}
        <div class="node-photo${isF?' f':''}">${m.photo?`<img src="${m.photo}">`:(isF?'👩':'👨')}</div>
        <div class="node-name">${fn(m)}${m.deceased?' <span title="Deceased" style="opacity:.6;">✝</span>':''}</div>
      </div>`;
    inner.appendChild(div);
  });

  // ── 6. Render spouse tag/untag buttons ───────────
  spouseButtons.forEach(sb=>{
    const btn=document.createElement('div');
    btn.className='spouse-tag-btn'+(sb.tagged?' tagged':'');
    btn.style.left=sb.x+'px';
    btn.style.top =sb.y+'px';
    btn.title=sb.tagged?'Edit sub-family tag':'Tag this couple as a sub-family';
    btn.textContent=sb.tagged?'🏷️':'';
    btn.onclick=(e)=>{ e.stopPropagation(); openSubFamily(sb.aId, sb.bId); };
    inner.appendChild(btn);
  });

  // ── 7. Render collapsed sub-family placeholder cards ─────────────
  placeholders.forEach(ph=>{
    const div=document.createElement('div');
    div.className='node';
    if(typeof ph.key === 'number') div.dataset.id = ph.key;
    div.style.left=ph.x+'px';
    div.style.top =ph.y+'px';
    div.style.width=PHW+'px';
    div.onclick=()=>{
      if(suppressNextNodeClick){ suppressNextNodeClick=false; return; }
      toggleCollapse(ph.key);
    };
    
    if(typeof ph.key === 'number') {
      const hm = gm(ph.key);
      if(hm && (hm.parentIds||[]).length > 0) attachNodeDrag(div, ph.key);
    }

    const isNumKey = typeof ph.key === 'number';

    div.innerHTML=`
      <div class="node-card placeholder-card d-flex flex-column align-items-center justify-content-center p-2 text-center" style="position:relative;">
        <div class="ph-icon">🏷️</div>
        <div class="ph-name fw-bold small text-truncate" style="max-width:100%;">${ph.tag.name}</div>
        <div class="ph-count text-muted" style="font-size:0.75rem;">${ph.count} member${ph.count!==1?'s':''}</div>
        <div class="d-flex gap-1 mt-2">
          <button class="btn btn-xs btn-primary rounded-pill px-2 py-0" style="font-size:0.7rem;" onclick="event.stopPropagation();toggleCollapse(${isNumKey ? ph.key : `'${ph.key}'`})">Expand</button>
          ${isNumKey ? `<button class="btn btn-xs btn-outline-primary rounded-pill px-2 py-0" style="font-size:0.7rem;" onclick="event.stopPropagation();viewSubTree(${ph.key})">👁️ View</button>` : ''}
        </div>
      </div>`;
    inner.appendChild(div);
  });
}

function sortByOrder(ids){
  return [...ids].sort((a,b)=>{
    const ma=gm(a), mb=gm(b);
    const oa=(ma&&ma.childOrder!=null)?ma.childOrder:9999;
    const ob=(mb&&mb.childOrder!=null)?mb.childOrder:9999;
    if(oa!==ob) return oa-ob;
    return a-b; // stable fallback: creation order
  });
}
function uniqueChildren(m, sp){
  const sps = mSpouses(m);
  const set = new Set(m.childIds || []);
  sps.forEach(s => (s.childIds || []).forEach(cid => set.add(cid)));
  if (sp && sp.childIds) sp.childIds.forEach(cid => set.add(cid));
  return sortByOrder([...set]);
}



// ── list.js ──
// ══════════════════════════════════════════════════════
//  LIST VIEW
// ══════════════════════════════════════════════════════
function renderList(){
  const q=(document.getElementById('srch').value||'').toLowerCase().trim();
  const subTreeIds = (typeof tempSubTreeHeadId !== 'undefined' && tempSubTreeHeadId !== null) ? getSubTreeMemberIds(tempSubTreeHeadId) : null;
  const results = [];
  allTrees().forEach(t => {
    (t.members || []).forEach(m => {
      if (subTreeIds && t.id === APP.activeTreeId && !subTreeIds.has(m.id)) return;
      if (subTreeIds && t.id !== APP.activeTreeId) return; // in sub-tree mode, scope to sub-tree only
      if (!q || fn(m).toLowerCase().includes(q)) {
        results.push({ member: m, tree: t });
      }
    });
  });

  document.getElementById('listBody').innerHTML=results.length===0
    ?'<div class="text-center text-muted p-4">No members found</div>'
    :results.map(res=>{
      const m = res.member;
      const t = res.tree;
      const isF = m.gender === 'female';
      const isCurrent = t.id === APP.activeTreeId;
      const rels = [];
      if(m.spouseId) rels.push('Married');
      if((m.childIds||[]).length) rels.push((m.childIds.length)+' child'+(m.childIds.length>1?'ren':''));
      if((m.parentIds||[]).length) rels.push('Parents recorded');
      return `<div class="list-item" style="cursor:pointer;" onclick="locateMemberCrossTree('${t.id}', ${m.id})">
        <div class="list-av${isF?' f':''}">${m.photo?`<img src="${m.photo}">`:(isF?'👩':'👨')}</div>
        <div style="flex:1;min-width:0;">
          <div class="lname" style="font-weight:600;">${fn(m)}${m.deceased?' ✝':''}</div>
          <div class="lrel">${rels.join(' · ')||'Member'}</div>
          <div style="font-size:.75rem;color:#888;margin-top:2px;">
            <span style="background:#f0e6ff;color:var(--p);padding:1px 6px;border-radius:10px;font-weight:600;">${t.name}</span>
            ${isCurrent ? ' <span style="color:#28a745;font-weight:600;">• Active Tree</span>' : ''}
          </div>
        </div>
      </div>`;
    }).join('');
}



// ── actions.js ──
// ══════════════════════════════════════════════════════
//  NODE CLICK → ACTIONS
// ══════════════════════════════════════════════════════
function nodeClick(id){
  if(suppressNextNodeClick){ suppressNextNodeClick=false; return; }
  selId=id;
  if(curView==='tree') renderTree();
  openAct(id);
}

function openAct(id){
  const m=gm(id);
  const hasSp=!!m.spouseId;
  const pCount=(m.parentIds||[]).length;
  document.getElementById('actTitle').textContent=fn(m);
  const acts=[
    { e:'👴', l:'Add Father',  fn:`addRel(${id},'father')`,  dis: pCount>=2 },
    { e:'👵', l:'Add Mother',  fn:`addRel(${id},'mother')`,  dis: pCount>=2 },
    { e:'💑', l:'Add Spouse',  fn:`addRel(${id},'spouse')`,  dis: false },
    { e:'👶', l:'Add Child',   fn:`addRel(${id},'child')`,   dis: false },
    { e:'👨‍👩‍👧‍👦', l:'Add Multiple Children', fn:`openMultiChild(${id})`, dis: false },
    { e:'👦', l:'Add Brother', fn:`addRel(${id},'brother')`, dis: false },
    { e:'👧', l:'Add Sister',  fn:`addRel(${id},'sister')`,  dis: false },
    { e:'ℹ️', l:'View Info',   fn:`viewMember(${id})`,       dis: false },
    { e:'✏️', l:'Edit Info',   fn:`openEdit(${id})`,         dis: false },
    { e:'👁️', l:'View Sub-Tree', fn:`viewSubTree(${id})`,     dis: false },
    { e:'🌳', l:'Family',      fn:`openFamilyTrees(${id})`,  dis: false },
    { e:'✂️', l:'Branch off Family', fn:`promptMoveFamily(${id})`, dis: false },
    { e:'🗑️', l:'Remove',      fn:`askRm(${id})`,            dis: false },
  ];
  document.getElementById('actGrid').innerHTML=acts.map(a=>
    `<div class="act-btn${a.dis?' dis':''}" onclick="closeM('actModal');${a.fn}">
      <div class="act-ic">${a.e}</div>
      <div class="act-lbl">${a.l}</div>
    </div>`
  ).join('');
  getM('actModal').show();
}

function openFamilyTrees(id){
  const m=gm(id);
  if(!m || !m.personId) {
    showToast('This member is only in the current tree.');
    return;
  }
  const trees = allTrees().filter(t => (t.members||[]).some(x => x.personId === m.personId));
  if(trees.length <= 1) {
    showToast('This member is only in the current tree.');
    return;
  }
  
  // Reuse treesModal to show just these trees
  const html = trees.map(t=>{
    const isActive = t.id === APP.activeTreeId;
    const n=(t.members||[]).length;
    return `<div class="list-item rounded-3" style="${isActive?'background:var(--pp);':''}cursor:pointer;" onclick="switchTreeAndClose('${t.id}')">
      <span style="font-size:1.4rem">${isActive?'🌳':'📁'}</span>
      <div style="flex:1;min-width:0;">
        <div class="lname">${t.name}${isActive?' <span style="color:var(--p);font-size:.7rem;font-weight:700;">· current</span>':''}</div>
        <div class="lrel">${n} member${n!==1?'s':''} · updated ${timeAgo(t.updatedAt)}</div>
      </div>
    </div>`;
  }).join('');
  
  document.getElementById('treesList').innerHTML = html;
  getM('treesModal').show();
}

function collectBranch(rootId) {
  const m = gm(rootId);
  if(!m) return [];
  const sp = m.spouseId ? gm(m.spouseId) : null;
  const ids = new Set();
  
  function traverse(nodeId) {
     if(ids.has(nodeId)) return;
     ids.add(nodeId);
     const n = gm(nodeId);
     if(!n) return;
     const nsp = n.spouseId ? gm(n.spouseId) : null;
     if(nsp && !ids.has(nsp.id)) {
        ids.add(nsp.id);
        (nsp.childIds||[]).forEach(traverse);
     }
     (n.childIds||[]).forEach(traverse);
  }
  
  (m.childIds||[]).forEach(traverse);
  if(sp) (sp.childIds||[]).forEach(traverse);
  
  return Array.from(ids);
}

function promptMoveFamily(id) {
   const m = gm(id);
   if (!m) return;
   const descIds = collectBranch(id);
   if(descIds.length === 0) {
      showToast(fn(m) + ' has no descendants to branch off.');
      return;
   }
   
   showConfirm('Branch off Family?', 
      `This will move ${fn(m)}'s descendants (${descIds.length} members) to a new tree. ${fn(m)} will remain here as a branch point.`, 
      () => moveFamilyToNewTree(id, descIds), 'Branch Off');
}

function moveFamilyToNewTree(id, descIds) {
   const m = gm(id);
   const sp = m.spouseId ? gm(m.spouseId) : null;
   
   const treeName = sp ? `${sp.firstName} & ${m.firstName} Family` : `${m.firstName}'s Family`;
   const newId = genTreeId();
   
   const newMembers = [];
   let nextLocalId = 1;
   const idMap = new Map();
   
   const copyM = JSON.parse(JSON.stringify(m));
   copyM.id = nextLocalId++;
   copyM.parentIds = [];
   idMap.set(m.id, copyM.id);
   newMembers.push(copyM);
   
   if (sp) {
      const copySp = JSON.parse(JSON.stringify(sp));
      copySp.id = nextLocalId++;
      copySp.parentIds = [];
      idMap.set(sp.id, copySp.id);
      newMembers.push(copySp);
   }
   
   descIds.forEach(did => {
      const d = gm(did);
      if(!d) return;
      const copyD = JSON.parse(JSON.stringify(d));
      copyD.id = nextLocalId++;
      idMap.set(d.id, copyD.id);
      newMembers.push(copyD);
   });
   
   newMembers.forEach(nm => {
      if (nm.spouseId && idMap.has(nm.spouseId)) nm.spouseId = idMap.get(nm.spouseId);
      else nm.spouseId = null;
      
      nm.parentIds = (nm.parentIds||[]).map(pid => idMap.get(pid)).filter(Boolean);
      nm.childIds = (nm.childIds||[]).map(cid => idMap.get(cid)).filter(Boolean);
   });
   
   APP.trees[newId] = {
      id: newId,
      name: treeName,
      updatedAt: Date.now(),
      nextId: nextLocalId,
      members: newMembers,
      collapsed: []
   };
   
   const mHasParents = (m.parentIds||[]).length > 0;
   const spHasParents = sp ? (sp.parentIds||[]).length > 0 : false;
   const keepsRoots = mHasParents || spHasParents;
   
   if (keepsRoots) {
      DB.members = DB.members.filter(x => !descIds.includes(x.id));
      m.childIds = [];
      if(sp) sp.childIds = [];
   } else {
      DB.members = DB.members.filter(x => !descIds.includes(x.id) && x.id !== m.id && (!sp || x.id !== sp.id));
   }
   
   normalizeCollapsed();
   switchTree(newId);
}



// ── member-form.js ──
// ══════════════════════════════════════════════════════
//  ADD / EDIT MEMBER
// ══════════════════════════════════════════════════════
function openAddRoot(){
  clrForm();
  sf('mmId',''); sf('mmRel',''); sf('mmRelType',''); sf('mmPersonId','');
  showReuseBox(true);
  showOrderBox(false);
  showQaFamilyBox(true);
  document.getElementById('mmTitle').textContent='Add Member';
  getM('memberModal').show();
}

function branchDaughterTree(id, relType) {
  const m = gm(id);
  if (!m) return;
  
  let targetTree = allTrees().find(t => t.id !== APP.activeTreeId && (t.members||[]).some(x => x.personId === m.personId));
  
  if (!targetTree) {
    const sp = m.spouseId ? gm(m.spouseId) : null;
    const treeName = sp ? `${sp.firstName} & ${m.firstName} Family` : `${m.firstName}'s Family`;
    const newId = genTreeId();
    
    const dCopy = JSON.parse(JSON.stringify(m));
    dCopy.id = 1;
    dCopy.parentIds = [];
    dCopy.childIds = [];
    dCopy.spouseId = sp ? 2 : null;
    dCopy.childOrder = null;
    
    const members = [dCopy];
    
    if (sp) {
      const spCopy = JSON.parse(JSON.stringify(sp));
      spCopy.id = 2;
      spCopy.parentIds = [];
      spCopy.childIds = [];
      spCopy.spouseId = 1;
      spCopy.childOrder = null;
      members.push(spCopy);
    }
    
    APP.trees[newId] = {
      id: newId,
      name: treeName,
      updatedAt: Date.now(),
      nextId: 3,
      members: members,
      collapsed: []
    };
    targetTree = APP.trees[newId];
    saveApp();
    showToast(`Branched family tree created: ${targetTree.name}`);
  } else {
    // Tree already exists — ensure spouse is present in target tree if available
    const sp = m.spouseId ? gm(m.spouseId) : null;
    if (sp && sp.personId) {
      const tMembers = targetTree.members || [];
      let targetDaughter = tMembers.find(x => x.personId === m.personId);
      let targetSpouse = tMembers.find(x => x.personId === sp.personId);
      
      if (!targetSpouse && targetDaughter) {
        const spCopy = JSON.parse(JSON.stringify(sp));
        spCopy.id = targetTree.nextId++;
        spCopy.parentIds = [];
        spCopy.childIds = [];
        spCopy.spouseId = targetDaughter.id;
        spCopy.childOrder = null;
        tMembers.push(spCopy);
        targetDaughter.spouseId = spCopy.id;
        targetTree.updatedAt = Date.now();
        saveApp();
      }
    }
    showToast(`Linked reference to branch tree: ${targetTree.name}`);
  }

  if (relType === 'switch' || relType === 'child' || relType === 'multi-child') {
    switchTree(targetTree.id);
    const newM = targetTree.members.find(x => x.personId === m.personId);
    if (newM) {
      setTimeout(() => {
        if (relType === 'multi-child') {
          openMultiChild(newM.id);
        } else if (relType === 'child') {
          addRel(newM.id, 'child');
        }
      }, 150);
    }
  }
}

function addRel(targetId, relType){
  const tg=gm(targetId);
  if (tg && tg.gender === 'female' && (tg.parentIds||[]).some(pid=>gm(pid)) && relType === 'child') {
    branchDaughterTree(targetId, 'child');
    return;
  }

  clrForm();
  sf('mmId',''); sf('mmRel', targetId); sf('mmRelType', relType); sf('mmPersonId','');
  showReuseBox(true);
  showQaFamilyBox(false);
  document.getElementById('mmTitle').textContent='Add '+cap(relType);
  // Sensible gender pre-fill
  if(relType==='mother'||relType==='sister') sf('mGender','female');
  else if(relType==='spouse') sf('mGender', tg?.gender==='male'?'female':'male');
  else sf('mGender','male');

  // Birth order only makes sense when the new person becomes someone's child
  const isChildRel=(relType==='child'||relType==='brother'||relType==='sister');
  showOrderBox(isChildRel);
  if(isChildRel) sf('mOrder', nextOrderFor(targetId, relType));

  getM('memberModal').show();
}
function nextOrderFor(targetId, relType){
  const tgt=gm(targetId);
  if(!tgt) return 1;
  if(relType==='child'){
    const sp=tgt.spouseId?gm(tgt.spouseId):null;
    const count=new Set([...(tgt.childIds||[]), ...(sp?(sp.childIds||[]):[])]).size;
    return count+1;
  }
  if(relType==='brother'||relType==='sister'){
    const pid=(tgt.parentIds||[])[0];
    const p=pid?gm(pid):null;
    return (p?(p.childIds||[]).length:0)+1;
  }
  return 1;
}
function showOrderBox(show){
  const box=document.getElementById('orderBox');
  if(box) box.style.display=show?'':'none';
}

function openEdit(id){
  const m=gm(id);
  sf('mmId',id); sf('mmRel',''); sf('mmRelType',''); sf('mmPersonId','');
  showReuseBox(false);
  showQaFamilyBox(false);
  document.getElementById('mmTitle').textContent='Edit Member';
  sf('mFirst',m.firstName); sf('mLast',m.lastName||'');
  document.getElementById('mGender').value=m.gender;
  sf('mDob',m.dob||''); sf('mPhone',m.phone||'');
  sf('mEmail',m.email||''); sf('mAddr',m.address||'');
  sf('mOcc',m.occupation||'');
  const isChild=(m.parentIds||[]).length>0;
  showOrderBox(isChild);
  if(isChild) sf('mOrder', m.childOrder!=null?m.childOrder:'');
  sf('mHobbies',m.hobbies||''); sf('mBio',m.bio||'');
  document.getElementById('mDeceased').checked=!!m.deceased;
  sf('mDeathDate',m.deathDate||'');
  toggleDeathField();
  tempPhoto=m.photo||null;
  renderFormPhotoPreview();
  getM('memberModal').show();
}
function toggleDeathField(){
  const box=document.getElementById('deathDateBox');
  box.style.display=document.getElementById('mDeceased').checked?'':'none';
}

function saveMember(){
  const first=document.getElementById('mFirst').value.trim();
  if(!first){ showToast('First name is required'); return; }
  const data={
    firstName:first, lastName:document.getElementById('mLast').value.trim(),
    gender:document.getElementById('mGender').value,
    dob:document.getElementById('mDob').value,
    phone:document.getElementById('mPhone').value.trim(),
    email:document.getElementById('mEmail').value.trim(),
    address:document.getElementById('mAddr').value.trim(),
    occupation:document.getElementById('mOcc').value.trim(),
    hobbies:document.getElementById('mHobbies').value.trim(),
    bio:document.getElementById('mBio').value.trim(),
    deceased:document.getElementById('mDeceased').checked,
    deathDate:document.getElementById('mDeceased').checked?document.getElementById('mDeathDate').value:'',
    photo: tempPhoto || null,
  };
  const orderBoxVisible=document.getElementById('orderBox').style.display!=='none';
  if(orderBoxVisible){
    const ov=parseInt(document.getElementById('mOrder').value);
    data.childOrder=isNaN(ov)?0:ov;
  }

  const editId=document.getElementById('mmId').value;
  let needsSyncConfirm=false;
  if(editId){
    const existing=gm(parseInt(editId));
    Object.assign(existing, data);
    if(tempPhoto){
      if(!Array.isArray(existing.photos)) existing.photos=[];
      if(!existing.photos.includes(tempPhoto)) existing.photos.unshift(tempPhoto);
    }
    needsSyncConfirm = !!(existing.personId && personTreeCount(existing.personId)>1);
    showToast(first+' updated!');
  } else {
    const importedPersonId=document.getElementById('mmPersonId').value;
    let photos = tempPhoto?[tempPhoto]:[];
    if(importedPersonId && reuseSourcePhotos && Array.isArray(reuseSourcePhotos.photos)){
      reuseSourcePhotos.photos.forEach(p=>{ if(!photos.includes(p)) photos.push(p); });
    }
    const nm={ id:DB.nextId++, personId: importedPersonId||genPersonId(), ...data, photos, spouseId:null, parentIds:[], childIds:[] };
    DB.members.push(nm);
    reuseSourcePhotos=null;
    const tid=parseInt(document.getElementById('mmRel').value);
    const rt=document.getElementById('mmRelType').value;
    const tgt=tid?gm(tid):null;

    if(tgt && rt){
      if(rt==='child'){
        // New child of tgt (and tgt's spouse)
        addChild(tgt, nm);
      } else if(rt==='father'||rt==='mother'){
        // New parent of tgt
        addParent(nm, tgt);      } else if(rt==='spouse'){
        // Link spouses (supporting multiple spouses/wives)
        if(!Array.isArray(tgt.spouseIds)) tgt.spouseIds = tgt.spouseId ? [tgt.spouseId] : [];
        if(!tgt.spouseIds.includes(nm.id)) tgt.spouseIds.push(nm.id);
        tgt.spouseId = tgt.spouseIds[0];

        if(!Array.isArray(nm.spouseIds)) nm.spouseIds = nm.spouseId ? [nm.spouseId] : [];
        if(!nm.spouseIds.includes(tgt.id)) nm.spouseIds.push(tgt.id);
        nm.spouseId = nm.spouseIds[0];

        // New spouse inherits children
        nm.childIds=[...(tgt.childIds||[])];
        nm.childIds.forEach(cid=>{ const c=gm(cid); if(c&&!c.parentIds.includes(nm.id)) c.parentIds.push(nm.id); });

        // Auto branch-off if target or new member is a daughter of the current tree
        const isDaughter = (x) => x && (x.parentIds||[]).some(pid => gm(pid));
        const daughter = (tgt.gender==='female' && isDaughter(tgt)) ? tgt : ((nm.gender==='female' && isDaughter(nm)) ? nm : null);
        if (daughter) {
          setTimeout(() => {
            branchDaughterTree(daughter.id, 'spouse_auto');
          }, 150);
        }
      } else if(rt==='brother'||rt==='sister'){
        // Sibling: same parents as tgt
        nm.parentIds=[...(tgt.parentIds||[])];
        nm.parentIds.forEach(pid=>{ const p=gm(pid); if(p&&!p.childIds.includes(nm.id)) p.childIds.push(nm.id); });
        // If tgt has no recorded parents, they are standalone siblings (no link needed, tree shows them as separate roots)
      }
    }

    // Brand-new standalone person: wire up mother/father/spouse/siblings/children
    // described in the "Their Family" section, if it was used.
    qaProcessFamily(nm);

    showToast(first+' added!');
  }
  save();
  closeM('memberModal');
  if(curView==='tree') { renderTree(); } else if(curView==='graph') { renderGraph(); } else { renderList(); }
  if(needsSyncConfirm){
    const personId=gm(parseInt(editId)).personId;
    setTimeout(()=>{
      showConfirm('Update everywhere?','This person is linked in other trees too — update their info in all of them?', ()=>{
        syncPersonEverywhere(personId, data);
      }, 'Update All');
    }, 300);
  }
}

function addChild(parent, child){
  if(!parent.childIds.includes(child.id)) parent.childIds.push(child.id);
  if(!child.parentIds.includes(parent.id)) child.parentIds.push(parent.id);
  
  // Link child to all spouses of parent
  const sps = mSpouses(parent);
  sps.forEach(sp => {
    if(!sp.childIds.includes(child.id)) sp.childIds.push(child.id);
    if(!child.parentIds.includes(sp.id)) child.parentIds.push(sp.id);
  });
}



// ── multi-child.js ──
// ══════════════════════════════════════════════════════
//  ADD MULTIPLE CHILDREN AT ONCE
// ══════════════════════════════════════════════════════
let mcRowCount=0;
let mcPicked={}; // rowIdx -> full record of the existing person picked for that row
function openMultiChild(targetId){
  const tg=gm(targetId);
  if (tg && tg.gender === 'female' && (tg.parentIds||[]).some(pid=>gm(pid))) {
    branchDaughterTree(targetId, 'multi-child');
    return;
  }
  sf('mcTargetId', targetId);
  document.getElementById('mcRows').innerHTML='';
  mcRowCount=0; mcPicked={};
  addMcRow(); addMcRow(); addMcRow();
  getM('multiChildModal').show();
}
function addMcRow(){
  mcRowCount++;
  const idx=mcRowCount;
  const div=document.createElement('div');
  div.className='mb-2';
  div.id='mcRow'+idx;
  div.innerHTML=`
    <div class="d-flex gap-2 align-items-center">
      <div style="flex:2;">
        <input class="fc" placeholder="Child's first name" id="mcName${idx}" autocomplete="off"
          oninput="onMcNameInput(${idx})" onfocus="onMcNameInput(${idx})" onblur="setTimeout(hideFloatDropdown,150)">
      </div>
      <select class="fc" id="mcGender${idx}" style="flex:1;max-width:80px;">
        <option value="male">M</option>
        <option value="female">F</option>
      </select>
      <button type="button" class="btn btn-sm btn-link text-danger p-0" style="font-size:1.1rem;" onclick="removeMcRow(${idx})" title="Remove row">✕</button>
    </div>
    <div id="mcChip${idx}" style="display:none;margin-top:4px;background:var(--pp);border-radius:8px;padding:5px 8px;
      align-items:center;justify-content:space-between;font-size:.75rem;">
      <span>🔗 Linked to <b id="mcChipName${idx}"></b></span>
      <button type="button" class="btn btn-sm btn-link text-danger p-0" style="font-size:.72rem;" onclick="clearMcPick(${idx})">Remove link</button>
    </div>`;
  document.getElementById('mcRows').appendChild(div);
}
function removeMcRow(idx){
  const row=document.getElementById('mcRow'+idx);
  if(row) row.remove();
  delete mcPicked[idx];
}
function onMcNameInput(idx){
  const nameInp=document.getElementById('mcName'+idx);
  if(!nameInp) return;
  const q=nameInp.value.trim();
  if(q.length<2){ hideFloatDropdown(); return; }
  const results=searchDirectory(q);
  if(results.length===0){ hideFloatDropdown(); return; }
  showFloatDropdown(nameInp, searchResultsHTML(results, pid=>`pickMcResult(${idx},'${pid}')`));
}
function pickMcResult(idx, personId){
  const rec=findByPersonId(personId);
  if(!rec) return;
  mcPicked[idx]=rec;
  sf('mcName'+idx, rec.firstName||'');
  const gsel=document.getElementById('mcGender'+idx);
  if(gsel) gsel.value=rec.gender||'male';
  hideFloatDropdown();
  const chip=document.getElementById('mcChip'+idx);
  if(chip){ chip.style.display='flex'; document.getElementById('mcChipName'+idx).textContent=fn(rec); }
}
function clearMcPick(idx){
  delete mcPicked[idx];
  const chip=document.getElementById('mcChip'+idx);
  if(chip) chip.style.display='none';
}
function saveMultiChildren(){
  const targetId=parseInt(document.getElementById('mcTargetId').value);
  const tgt=gm(targetId);
  if(!tgt){ showToast('Something went wrong — try again'); return; }
  const sp=tgt.spouseId?gm(tgt.spouseId):null;
  let order=new Set([...(tgt.childIds||[]), ...(sp?(sp.childIds||[]):[])]).size;

  const rows=Array.from(document.getElementById('mcRows').children);
  let added=0;
  rows.forEach(row=>{
    const idx=row.id.replace('mcRow','');
    const nameInp=document.getElementById('mcName'+idx);
    if(!nameInp) return;
    const name=nameInp.value.trim();
    if(!name) return;
    const gender=document.getElementById('mcGender'+idx).value;
    order++;
    const picked=mcPicked[idx];
    const nm = picked ? {
      id:DB.nextId++, personId:picked.personId,
      firstName:name, lastName:picked.lastName||'', gender,
      dob:picked.dob||'', phone:picked.phone||'', email:picked.email||'',
      address:picked.address||'', occupation:picked.occupation||'',
      hobbies:picked.hobbies||'', bio:picked.bio||'',
      deceased:!!picked.deceased, deathDate:picked.deathDate||'',
      photo:picked.photo||null, photos:picked.photos?[...picked.photos]:[],
      childOrder:order, spouseId:null, parentIds:[], childIds:[]
    } : {
      id:DB.nextId++, personId:genPersonId(), firstName:name, lastName:'', gender,
      dob:'', phone:'', email:'', address:'', occupation:'', hobbies:'', bio:'',
      deceased:false, deathDate:'', photo:null, photos:[], childOrder:order,
      spouseId:null, parentIds:[], childIds:[]
    };
    DB.members.push(nm);
    addChild(tgt, nm);
    added++;
  });

  if(added===0){ showToast("Enter at least one child's name"); return; }
  mcPicked={};
  save();
  closeM('multiChildModal');
  if(curView==='tree') { renderTree(); } else if(curView==='graph') { renderGraph(); } else { renderList(); }
  showToast(added+' child'+(added>1?'ren':'')+' added!');
}

function addParent(parent, child){
  if(!child.parentIds.includes(parent.id)) child.parentIds.push(parent.id);
  if(!parent.childIds.includes(child.id)) parent.childIds.push(child.id);
  // If child already has one parent, auto-spouse the two parents
  if(child.parentIds.length===2){
    const p1=gm(child.parentIds[0]), p2=gm(child.parentIds[1]);
    if(p1&&p2&&!p1.spouseId&&!p2.spouseId){ p1.spouseId=p2.id; p2.spouseId=p1.id; }
  }
}



// ── view-member.js ──
// ══════════════════════════════════════════════════════
//  VIEW MEMBER
// ══════════════════════════════════════════════════════
function viewMember(id){
  viewId=id; const m=gm(id);
  const isF=m.gender==='female';
  document.getElementById('vAv').innerHTML = m.photo ? `<img src="${m.photo}">` : (isF?'👩':'👨');
  document.getElementById('vName').textContent=fn(m)+(m.deceased?' ✝':'');
  document.getElementById('vSub').textContent=(isF?'Female':'Male')+' · '+relLabel(m);
  const tcount=personTreeCount(m.personId);
  const rows=[
    ['📅','Date of Birth',m.dob||'—'],
  ];
  if(m.deceased) rows.push(['🕊️','Date of Death', m.deathDate||'—']);
  rows.push(
    ['📞','Phone',m.phone||'—'],
    ['📧','Email',m.email||'—'],
    ['📍','Address',m.address||'—'],
    ['💼','Occupation',m.occupation||'—'],
    ['🎨','Hobbies / Interests',m.hobbies||'—'],
    ['📖','Biography', m.bio ? m.bio.replace(/\n/g,'<br>') : '—'],
    ['💑','Spouse',m.spouseId?fn(gm(m.spouseId)):'—'],
    ['👶','Children',sortByOrder(m.childIds||[]).map(c=>fn(gm(c))).filter(Boolean).join(', ')||'—'],
    ['👪','Parents',(m.parentIds||[]).map(p=>fn(gm(p))).filter(Boolean).join(', ')||'—'],
    ['🔗','Linked Profile', tcount>1 ? ('Appears in '+tcount+' trees') : 'Only in this tree'],
  );
  document.getElementById('vBody').innerHTML= photoGalleryHTML(m) + rows.map(r=>
    `<div class="irow"><div class="ico">${r[0]}</div>
    <div><div class="ilbl">${r[1]}</div><div class="ival">${r[2]}</div></div></div>`
  ).join('');
  getM('viewModal').show();
}

// ── Photo management (profile photo + gallery) ──────────────────────
function photoGalleryHTML(m){
  const photos=m.photos||[];
  const thumbs=photos.map((p,i)=>`
    <div style="position:relative;flex-shrink:0;">
      <img src="${p}" onclick="setProfilePhoto(${i})" title="Tap to set as profile photo"
        style="width:64px;height:64px;object-fit:cover;border-radius:10px;cursor:pointer;${m.photo===p?'outline:3px solid var(--p);outline-offset:1px;':''}">
      <button onclick="event.stopPropagation();deletePhotoAt(${i})" title="Delete photo"
        style="position:absolute;top:-6px;right:-6px;width:20px;height:20px;border-radius:50%;background:#c0392b;color:#fff;border:2px solid #fff;font-size:.62rem;line-height:1;padding:0;">✕</button>
    </div>`).join('');
  return `<div class="irow" style="align-items:center;">
    <div class="ico">🖼️</div>
    <div style="flex:1;min-width:0;">
      <div class="ilbl">Photos</div>
      <div style="display:flex;gap:8px;overflow-x:auto;padding:6px 2px;">
        ${thumbs}
        <button onclick="triggerAddPhoto()" style="flex-shrink:0;width:64px;height:64px;border-radius:10px;border:2px dashed #ccc;background:#faf8fc;font-size:1.3rem;color:#999;">➕</button>
      </div>
    </div>
  </div>`;
}
function triggerAddPhoto(){ document.getElementById('photoFileInput').click(); }
function handleAddPhoto(ev){
  const file=ev.target.files[0];
  ev.target.value='';
  if(!file || !viewId) return;
  if(!file.type.startsWith('image/')){ showToast('Please choose an image file'); return; }
  showToast('Adding photo…');
  compressImage(file, 900, 0.72).then(dataUrl=>{
    const m=gm(viewId); if(!m) return;
    if(!Array.isArray(m.photos)) m.photos=[];
    m.photos.push(dataUrl);
    if(!m.photo) m.photo=dataUrl; // first photo auto-becomes the profile photo
    save();
    viewMember(viewId);
    if(curView==='tree') renderTree(); else renderList();
    showToast('Photo added!');
  }).catch(err=>{ console.error(err); showToast('Could not process that image'); });
}
function setProfilePhoto(idx){
  const m=gm(viewId); if(!m || !m.photos || !m.photos[idx]) return;
  m.photo=m.photos[idx];
  save();
  viewMember(viewId);
  if(curView==='tree') renderTree(); else renderList();
  showToast('Profile photo updated!');
}
function deletePhotoAt(idx){
  const m=gm(viewId); if(!m || !m.photos || !m.photos[idx]) return;
  showConfirm('Delete this photo?','This cannot be undone.', ()=>{
    const removed=m.photos[idx];
    m.photos.splice(idx,1);
    if(m.photo===removed) m.photo=m.photos[0]||null;
    save();
    viewMember(viewId);
    if(curView==='tree') renderTree(); else renderList();
    showToast('Photo deleted');
  }, 'Delete');
}
// Resizes + compresses an uploaded image client-side (keeps localStorage lean)
function compressImage(file, maxDim, quality){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=e=>{
      const img=new Image();
      img.onload=()=>{
        let w=img.width, h=img.height;
        if(w>maxDim || h>maxDim){
          if(w>h){ h=Math.round(h*maxDim/w); w=maxDim; } else { w=Math.round(w*maxDim/h); h=maxDim; }
        }
        const canvas=document.createElement('canvas');
        canvas.width=w; canvas.height=h;
        canvas.getContext('2d').drawImage(img,0,0,w,h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror=reject;
      img.src=e.target.result;
    };
    reader.onerror=reject;
    reader.readAsDataURL(file);
  });
}

function editCurrent(){ closeM('viewModal'); setTimeout(()=>openEdit(viewId),300); }
function relLabel(m){
  const p=[];
  if((m.childIds||[]).length) p.push('Parent');
  if(m.spouseId) p.push('Married');
  if((m.parentIds||[]).length) p.push('Child');
  return p.join(' · ')||'Member';
}



// ── remove.js ──
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



// ── export.js ──
// ══════════════════════════════════════════════════════
//  SHARE / BACKUP
// ══════════════════════════════════════════════════════
function openShare(){ getM('shareModal').show(); }

// ── Import a family tree from a JSON file ──────────────────────────
// Accepts either this app's own multi-tree export ({trees:{...}}) or an
// older single-tree export ({members:[...], nextId}). Imported trees are
// always added as NEW trees (never overwrite what's already there), and
// every imported member gets a personId (if missing) so they immediately
// work with the "reuse across trees" feature too.
function triggerImport(){ document.getElementById('importFileInput').click(); }

function handleImportFile(ev){
  const file=ev.target.files[0];
  ev.target.value=''; // allow re-selecting the same file later
  if(!file) return;
  if(!/\.json$/i.test(file.name)){ showToast('Please choose a .json file'); return; }
  const reader=new FileReader();
  reader.onload=e=>{
    let data;
    try{ data=JSON.parse(e.target.result); }
    catch(err){ console.error(err); showToast('That file isn\'t valid JSON'); return; }
    importData(data, file.name);
  };
  reader.onerror=()=>showToast('Could not read that file');
  reader.readAsText(file);
}

function importData(data, filename){
  if(!data || typeof data!=='object'){ showToast("This file doesn't look like a FamilyRoot export"); return; }

  let firstNewTreeId=null, importedCount=0;
  const baseName=(filename||'Imported').replace(/\.json$/i,'');

  const buildTree=(name, members, nextId, collapsed)=>{
    const nid=genTreeId();
    const cleanMembers=(members||[]).map(m=>({...m}));
    cleanMembers.forEach(m=>{ if(!m.personId) m.personId=genPersonId(); });
    const maxId=cleanMembers.reduce((mx,m)=>Math.max(mx, m.id||0), 0);
    APP.trees[nid]={
      id:nid,
      name: name || 'Imported Tree',
      updatedAt: Date.now(),
      nextId: nextId || (maxId+1),
      members: cleanMembers,
      collapsed: collapsed || []
    };
    if(!firstNewTreeId) firstNewTreeId=nid;
    importedCount++;
  };

  if(data.trees && typeof data.trees==='object' && Object.keys(data.trees).length){
    // Full multi-tree export from this app
    Object.values(data.trees).forEach(t=>{
      buildTree(t.name, t.members, t.nextId, t.collapsed);
    });
  } else if(Array.isArray(data.members)){
    // Older single-tree export
    buildTree(baseName, data.members, data.nextId, data.collapsed);
  } else {
    showToast("This file doesn't look like a FamilyRoot export");
    return;
  }

  if(firstNewTreeId){
    APP.activeTreeId=firstNewTreeId;
    DB=APP.trees[firstNewTreeId];
  }
  selId=null; viewId=null;
  normalizeCollapsed();
  saveApp(); updateTreeBadge();
  setView('tree');
  showToast('Imported '+importedCount+' tree'+(importedCount!==1?'s':'')+'!');
}

function exportJSON(){
  const b=new Blob([JSON.stringify(APP,null,2)],{type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(b); a.download='familyroot-all-trees.json'; a.click();
  showToast('Data exported!');
}
function doBackup(){
  try{
    showToast('Preparing backup…');
    const prepared=photosToBinary(APP);
    const bytes=msgpack.encode(prepared); // real binary encoding, not text
    const blob=new Blob([bytes], {type:'application/octet-stream'});
    const d=new Date();
    const stamp=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')
      +'_'+String(d.getHours()).padStart(2,'0')+String(d.getMinutes()).padStart(2,'0');
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob);
    a.download='familyroot-backup-'+stamp+'.msgpack';
    a.click();
    showToast('Backup downloaded!');
  }catch(err){
    console.error(err);
    showToast('Backup failed — try again');
  }
}

// ── Binary JSON (MessagePack) helpers ──────────────────────────────
// A plain JSON backup stores photos as base64 TEXT, which is ~37% bigger
// than the actual image bytes. Here we decode each photo back to its raw
// bytes first, so MessagePack can store them as true binary — smaller,
// and no text/quoting overhead anywhere else in the file either.
function dataUrlToBinary(dataUrl){
  const m=/^data:([^;]+);base64,(.*)$/.exec(dataUrl||'');
  if(!m) return null;
  const bin=atob(m[2]);
  const bytes=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
  return { __img:true, mime:m[1], bytes };
}
function binaryToDataUrl(obj){
  let binary='';
  const bytes = obj.bytes instanceof Uint8Array ? obj.bytes : new Uint8Array(obj.bytes);
  for(let i=0;i<bytes.length;i++) binary+=String.fromCharCode(bytes[i]);
  return 'data:'+obj.mime+';base64,'+btoa(binary);
}
function photosToBinary(app){
  const clone=JSON.parse(JSON.stringify(app)); // structural clone, doesn't touch the live APP
  Object.values(clone.trees||{}).forEach(t=>{
    (t.members||[]).forEach(m=>{
      if(m.photo) m.photo=dataUrlToBinary(m.photo)||m.photo;
      if(Array.isArray(m.photos)) m.photos=m.photos.map(p=>dataUrlToBinary(p)||p);
    });
  });
  return clone;
}
function photosFromBinary(app){
  Object.values(app.trees||{}).forEach(t=>{
    (t.members||[]).forEach(m=>{
      if(m.photo && m.photo.__img) m.photo=binaryToDataUrl(m.photo);
      if(Array.isArray(m.photos)) m.photos=m.photos.map(p=>(p&&p.__img)?binaryToDataUrl(p):p);
    });
  });
  return app;
}

function exportImage(){
  if(DB.members.length===0){ showToast('Add members first'); return; }
  if(curView!=='tree') setView('tree');
  showToast('Exporting as image…');
  setTimeout(()=>{
    const savedScale=zoomScale, savedX=panX, savedY=panY;
    zoomScale=1; panX=0; panY=0; applyTransform();
    const target=document.getElementById('innerWrap');
    html2canvas(target,{backgroundColor:'#F5F0FB',scale:2,useCORS:true}).then(canvas=>{
      zoomScale=savedScale; panX=savedX; panY=savedY; applyTransform();
      canvas.toBlob(blob=>{
        if(!blob){ showToast('Export failed — try again'); return; }
        const a=document.createElement('a');
        a.href=URL.createObjectURL(blob);
        a.download='familyroot-tree.png';
        a.click();
        showToast('Image downloaded!');
      });
    }).catch(err=>{
      zoomScale=savedScale; panX=savedX; panY=savedY; applyTransform();
      console.error(err); showToast('Export failed — try again');
    });
  },200);
}

function exportPDF(){
  if(DB.members.length===0){ showToast('Add members first'); return; }
  if(curView!=='tree') setView('tree');
  showToast('Exporting as PDF…');
  setTimeout(()=>{
    const savedScale=zoomScale, savedX=panX, savedY=panY;
    zoomScale=1; panX=0; panY=0; applyTransform();
    const target=document.getElementById('innerWrap');
    html2canvas(target,{backgroundColor:'#ffffff',scale:2,useCORS:true}).then(canvas=>{
      zoomScale=savedScale; panX=savedX; panY=savedY; applyTransform();
      const imgData=canvas.toDataURL('image/png');
      const w=canvas.width, h=canvas.height;
      const { jsPDF } = window.jspdf;
      const pdf=new jsPDF({orientation:w>h?'landscape':'portrait',unit:'px',format:[w,h]});
      pdf.addImage(imgData,'PNG',0,0,w,h);
      pdf.save('familyroot-tree.pdf');
      showToast('PDF downloaded!');
    }).catch(err=>{
      zoomScale=savedScale; panX=savedX; panY=savedY; applyTransform();
      console.error(err); showToast('Export failed — try again');
    });
  },200);
}
function doRestore(){
  triggerRestore();
}
function triggerRestore(){ document.getElementById('restoreFileInput').click(); }

function handleRestoreFile(ev){
  const file=ev.target.files[0];
  ev.target.value=''; // allow re-selecting the same file next time
  if(!file) return;
  const isBinary=/\.(msgpack|bin)$/i.test(file.name);
  const isJson=/\.json$/i.test(file.name);
  if(!isBinary && !isJson){ showToast('Please choose a .msgpack or .json backup file'); return; }

  const reader=new FileReader();
  if(isBinary){
    reader.onload=e=>{
      try{
        const bytes=new Uint8Array(e.target.result);
        const decoded=msgpack.decode(bytes);
        confirmRestore(photosFromBinary(decoded), file.name);
      }catch(err){
        console.error(err);
        showToast('Could not read that backup file');
      }
    };
    reader.onerror=()=>showToast('Could not read that file');
    reader.readAsArrayBuffer(file);
  } else {
    reader.onload=e=>{
      let data;
      try{ data=JSON.parse(e.target.result); }
      catch(err){ console.error(err); showToast('That file isn\'t valid JSON'); return; }
      if(!data || (!data.trees && !Array.isArray(data.members))){
        showToast("This doesn't look like a FamilyRoot backup");
        return;
      }
      confirmRestore(data, file.name);
    };
    reader.onerror=()=>showToast('Could not read that file');
    reader.readAsText(file);
  }
}

function confirmRestore(data, filename){
  showConfirm(
    'Restore this backup?',
    'This will replace everything currently in the app ('+Object.keys(APP.trees).length+' tree'+(Object.keys(APP.trees).length!==1?'s':'')+') with the contents of "'+filename+'".',
    ()=>restoreFromBackup(data),
    'Restore'
  );
}

function restoreFromBackup(data){
  if(data.trees && typeof data.trees==='object' && Object.keys(data.trees).length){
    APP=data;
    if(!APP.activeTreeId || !APP.trees[APP.activeTreeId]) APP.activeTreeId=Object.keys(APP.trees)[0];
  } else if(Array.isArray(data.members)){
    // Older single-tree backup file
    const id=genTreeId();
    const members=data.members.map(m=>({...m}));
    APP={ trees:{ [id]:{ id, name:'Restored Tree', updatedAt:Date.now(),
      nextId:data.nextId||1, members, collapsed:data.collapsed||[] } }, activeTreeId:id };
  }
  // Safety net: make sure every tree/member has the fields newer app versions expect
  Object.values(APP.trees).forEach(t=>{
    if(!Array.isArray(t.collapsed)) t.collapsed=[];
    (t.members||[]).forEach(m=>{ if(!m.personId) m.personId=genPersonId(); });
  });
  DB=APP.trees[APP.activeTreeId];
  selId=null; viewId=null;
  normalizeCollapsed();
  saveApp(); updateTreeBadge();
  setView('tree');
  showToast('Backup restored!');
}



// ── ui-utils.js ──
// ══════════════════════════════════════════════════════
//  UTILS
// ══════════════════════════════════════════════════════
const getM = id => bootstrap.Modal.getOrCreateInstance(document.getElementById(id));
function closeM(id){ bootstrap.Modal.getInstance(document.getElementById(id))?.hide(); }
function openSidebar(){ document.getElementById('sidebar').classList.add('open'); document.getElementById('overlay').classList.add('show'); }
function closeSidebar(){ document.getElementById('sidebar').classList.remove('open'); document.getElementById('overlay').classList.remove('show'); }
const sf = (id,v) => document.getElementById(id).value=v;
let tempPhoto=null; // the (possibly new) primary photo while the Add/Edit form is open
function clrForm(){
  ['mFirst','mLast','mPhone','mEmail','mAddr','mOcc','mHobbies','mBio','mDeathDate','mOrder'].forEach(id=>sf(id,''));
  sf('mDob',''); document.getElementById('mGender').value='male';
  document.getElementById('mDeceased').checked=false;
  toggleDeathField();
  showOrderBox(false);
  clearReuseLink();
  hideNameDropdown();
  tempPhoto=null; reuseSourcePhotos=null;
  renderFormPhotoPreview();
  qaResetFamilyBox();
}

// ══════════════════════════════════════════════════════
//  "THEIR FAMILY" — describe a brand-new person's whole immediate
//  family (mother, father, spouse, siblings, children) in one form,
//  and auto-position them on the chart accordingly. Every name field
//  has the same live "reuse an existing person" search as elsewhere —
//  typing 2+ characters shows matches from other trees; picking one
//  links that real person instead of creating a duplicate.
// ══════════════════════════════════════════════════════
function showQaFamilyBox(show){
  const box=document.getElementById('qaFamilyBox');
  if(box) box.style.display=show?'':'none';
}
let qaSingle={ mother:null, father:null, spouse:null }; // key -> picked record (or null = typed fresh)
let qaRowCounters={};                                    // prefix -> last row index used
let qaPickedStore={ qaSib:{}, qaChild:{} };               // prefix -> {rowIdx: picked record}

function qaResetFamilyBox(){
  ['qaMother','qaFather','qaSpouse'].forEach(id=>{ sf(id,''); qaHideDropdown(id+'DD'); });
  qaSingle={ mother:null, father:null, spouse:null };
  const sibBox=document.getElementById('qaSibRows'); if(sibBox) sibBox.innerHTML='';
  const chBox=document.getElementById('qaChildRows'); if(chBox) chBox.innerHTML='';
  qaRowCounters={}; qaPickedStore={ qaSib:{}, qaChild:{} }; qaLastResults={};
  showQaFamilyBox(false); // default hidden; openAddRoot() re-shows it
}

// Mother / Father / Spouse — single-field live search
function qaSingleInput(key){
  const inp=document.getElementById('qa'+cap(key));
  if(!inp) return;
  const q=inp.value.trim();
  if(q.length<2){ hideFloatDropdown(); return; }
  const results=searchAnyone(q);
  if(results.length===0){ hideFloatDropdown(); return; }
  showFloatDropdown(inp, searchResultsHTML(results, pid=>`qaPickSingle('${key}','${pid}')`));
}
function qaPickSingle(key, personId){
  const rec=findByPersonId(personId);
  if(!rec) return;
  qaSingle[key]=rec;
  sf('qa'+cap(key), fn(rec));
  hideFloatDropdown();
}

// Siblings / Children — repeatable rows, each with its own live search
function qaAddRow(containerId, prefix){
  const idx=(qaRowCounters[prefix]=(qaRowCounters[prefix]||0)+1);
  const div=document.createElement('div');
  div.className='mb-2';
  div.id=prefix+'Row'+idx;
  div.innerHTML=`
    <div class="d-flex gap-2 align-items-center">
      <div style="flex:2;">
        <input class="fc" placeholder="Name" id="${prefix}Name${idx}" autocomplete="off"
          oninput="qaShowRowDropdown('${prefix}',${idx})" onfocus="qaShowRowDropdown('${prefix}',${idx})"
          onblur="setTimeout(hideFloatDropdown,150)">
      </div>
      <select class="fc" id="${prefix}Gender${idx}" style="flex:1;max-width:80px;">
        <option value="male">M</option><option value="female">F</option>
      </select>
      <button type="button" class="btn btn-sm btn-link text-danger p-0" style="font-size:1.1rem;"
        onclick="document.getElementById('${prefix}Row${idx}').remove()" title="Remove">✕</button>
    </div>`;
  document.getElementById(containerId).appendChild(div);
}
function qaShowRowDropdown(prefix, idx){
  const nameInp=document.getElementById(prefix+'Name'+idx);
  if(!nameInp) return;
  const q=nameInp.value.trim();
  if(q.length<2){ hideFloatDropdown(); return; }
  const results=searchAnyone(q);
  if(results.length===0){ hideFloatDropdown(); return; }
  showFloatDropdown(nameInp, searchResultsHTML(results, pid=>`qaPickRow('${prefix}',${idx},'${pid}')`));
}
function qaPickRow(prefix, idx, personId){
  const rec=findByPersonId(personId);
  if(!rec) return;
  if(!qaPickedStore[prefix]) qaPickedStore[prefix]={};
  qaPickedStore[prefix][idx]=rec;
  sf(prefix+'Name'+idx, rec.firstName||'');
  const gsel=document.getElementById(prefix+'Gender'+idx);
  if(gsel) gsel.value=rec.gender||'male';
  hideFloatDropdown();
}
// Kept as a thin alias — older onblur="qaHideDropdown('someId')" handlers
// still call this by name; the id argument is no longer used since every
// dropdown now shares the one floating element.
function qaHideDropdown(){ hideFloatDropdown(); }

// Turns a typed name (or a picked existing person) into an actual
// tree-member record.
//  - Picked, and that person is already IN THIS TREE → reuse that exact
//    member directly. No duplicate node gets created.
//  - Picked from a DIFFERENT tree → create a new row here that shares
//    their personId (the standard cross-tree "reuse" mechanic).
//  - Freshly typed, no pick → create a minimal new record, fillable
//    later via Edit.
function qaGetOrCreateMember(name, pickedRecord, genderDefault){
  name=(name||'').trim();
  if(!name) return null;
  if(pickedRecord){
    const alreadyHere=DB.members.find(m=>m.personId===pickedRecord.personId);
    if(alreadyHere) return alreadyHere;
    const rec={ id:DB.nextId++, personId:pickedRecord.personId,
      firstName:pickedRecord.firstName||name, lastName:pickedRecord.lastName||'',
      gender:pickedRecord.gender||genderDefault,
      dob:pickedRecord.dob||'', phone:pickedRecord.phone||'', email:pickedRecord.email||'',
      address:pickedRecord.address||'', occupation:pickedRecord.occupation||'',
      hobbies:pickedRecord.hobbies||'', bio:pickedRecord.bio||'',
      deceased:!!pickedRecord.deceased, deathDate:pickedRecord.deathDate||'',
      photo:pickedRecord.photo||null, photos:pickedRecord.photos?[...pickedRecord.photos]:[],
      spouseId:null, parentIds:[], childIds:[]
    };
    DB.members.push(rec);
    return rec;
  }
  const rec={ id:DB.nextId++, personId:genPersonId(), firstName:name, lastName:'',
    gender:genderDefault, dob:'', phone:'', email:'', address:'', occupation:'',
    hobbies:'', bio:'', deceased:false, deathDate:'', photo:null, photos:[],
    spouseId:null, parentIds:[], childIds:[]
  };
  DB.members.push(rec);
  return rec;
}

// Reads the whole Family Connections section and wires up every
// relationship around the newly created person `nm`.
function qaProcessFamily(nm){
  const visible=document.getElementById('qaFamilyBox').style.display!=='none';
  if(!visible) return;

  // Mother / Father
  const motherName=document.getElementById('qaMother').value.trim();
  const fatherName=document.getElementById('qaFather').value.trim();
  const motherMember=motherName?qaGetOrCreateMember(motherName, qaSingle.mother, 'female'):null;
  const fatherMember=fatherName?qaGetOrCreateMember(fatherName, qaSingle.father, 'male'):null;
  if(motherMember) addParent(motherMember, nm);
  if(fatherMember) addParent(fatherMember, nm); // addParent auto-links mother+father as spouses once nm has both

  // Spouse
  const spouseName=document.getElementById('qaSpouse').value.trim();
  if(spouseName){
    const spouseMember=qaGetOrCreateMember(spouseName, qaSingle.spouse, nm.gender==='male'?'female':'male');
    nm.spouseId=spouseMember.id; spouseMember.spouseId=nm.id;
  }

  // Siblings — share nm's parents (whichever of mother/father were given)
  const sharedParents=[motherMember, fatherMember].filter(Boolean);
  const sibRows=document.getElementById('qaSibRows');
  if(sibRows) Array.from(sibRows.children).forEach(row=>{
    const idx=row.id.replace('qaSibRow','');
    const nameInp=document.getElementById('qaSibName'+idx);
    if(!nameInp) return;
    const name=nameInp.value.trim();
    if(!name) return;
    const gender=document.getElementById('qaSibGender'+idx).value;
    const picked=qaPickedStore.qaSib[idx];
    const sibling=qaGetOrCreateMember(name, picked, gender);
    sharedParents.forEach(p=>addParent(p, sibling));
  });

  // Children — of nm (and nm's spouse, if one was just linked above)
  const childRows=document.getElementById('qaChildRows');
  let order=0;
  if(childRows) Array.from(childRows.children).forEach(row=>{
    const idx=row.id.replace('qaChildRow','');
    const nameInp=document.getElementById('qaChildName'+idx);
    if(!nameInp) return;
    const name=nameInp.value.trim();
    if(!name) return;
    const gender=document.getElementById('qaChildGender'+idx).value;
    const picked=qaPickedStore.qaChild[idx];
    const child=qaGetOrCreateMember(name, picked, gender);
    order++;
    child.childOrder=order;
    addChild(nm, child);
  });
}

function handleFormPhoto(ev){
  const file=ev.target.files[0];
  ev.target.value='';
  if(!file) return;
  if(!file.type.startsWith('image/')){ showToast('Please choose an image file'); return; }
  compressImage(file, 900, 0.72).then(dataUrl=>{
    tempPhoto=dataUrl;
    renderFormPhotoPreview();
  }).catch(err=>{ console.error(err); showToast('Could not process that image'); });
}
function removeFormPhoto(){
  tempPhoto=null;
  renderFormPhotoPreview();
}
function renderFormPhotoPreview(){
  const box=document.getElementById('mmPhotoPreview');
  const removeBtn=document.getElementById('mmPhotoRemoveBtn');
  if(!box) return;
  if(tempPhoto){
    box.innerHTML=`<img src="${tempPhoto}" style="width:100%;height:100%;object-fit:cover;">`;
    if(removeBtn) removeBtn.style.display='';
  } else {
    const isF=document.getElementById('mGender').value==='female';
    box.innerHTML = isF?'👩':'👨';
    if(removeBtn) removeBtn.style.display='none';
  }
}
// ── Shared floating "search results" dropdown ────────────────────────
// Every live-search field (main First Name, Mother/Father/Spouse,
// Sibling/Child rows, and the multi-child modal) renders through THIS
// single element rather than a dropdown nested inside the form.
//
// Why: memberModal and multiChildModal both use Bootstrap's
// .modal-dialog-scrollable, which sets overflow:hidden on .modal-content
// and overflow-y:auto on .modal-body. A dropdown positioned normally
// (position:absolute inside the form) gets silently clipped by that —
// the search still runs and the HTML still gets built, it just never
// becomes visible. Appending one shared dropdown directly to <body> and
// positioning it with `fixed` coordinates (via getBoundingClientRect on
// whichever input triggered it) sidesteps that entirely.
let floatDD=null;
function ensureFloatDD(){
  if(floatDD) return floatDD;
  floatDD=document.createElement('div');
  floatDD.id='floatingDropdown';
  floatDD.style.cssText='display:none;position:fixed;background:#fff;border-radius:10px;'
    +'box-shadow:0 8px 22px rgba(0,0,0,.25);z-index:2000;max-height:220px;overflow-y:auto;';
  document.body.appendChild(floatDD);
  return floatDD;
}
function showFloatDropdown(inputEl, itemsHTML){
  const dd=ensureFloatDD();
  const r=inputEl.getBoundingClientRect();
  dd.style.left=r.left+'px';
  dd.style.top=(r.bottom+4)+'px';
  dd.style.width=r.width+'px';
  dd.innerHTML=itemsHTML;
  dd.style.display='block';
}
function hideFloatDropdown(){
  if(floatDD) floatDD.style.display='none';
}
function searchResultsHTML(results, pickAttr){
  return results.map(r=>{
    const isF=r.gender==='female';
    return `<div class="list-item rounded-3" style="padding:8px 10px;" onmousedown="${pickAttr(r.personId)}">
      <div class="list-av${isF?' f':''}" style="width:30px;height:30px;font-size:.95rem;">${isF?'👩':'👨'}</div>
      <div><div style="font-size:.82rem;font-weight:600;">${fn(r)}</div>
      <div style="font-size:.68rem;color:#aaa;">from "${r._treeName}"${r.dob?' · '+r.dob:''}</div></div>
    </div>`;
  }).join('');
}

function showReuseBox(show){
  // reuseBox now just holds the "linked" chip; the search itself lives
  // in the name field's live dropdown. This still gates whether reuse
  // is allowed at all (never during an edit of an existing member).
  reuseAllowed=show;
  const box=document.getElementById('reuseBox');
  if(box) box.style.display = show ? '' : 'none';
  if(!show) hideNameDropdown();
}
// ── "Reuse an existing person" live name search (main name field) ───
// As the user types in the First Name field (add-mode only), a dropdown
// of matching people already in OTHER trees appears live underneath it.
// Picking one copies that person's full profile into the form and tags
// mmPersonId so the new tree-member shares the same personId (see
// PEOPLE DIRECTORY above, and saveMember() below). The same underlying
// idea — search-as-you-type across trees, pick to link — is reused for
// Mother/Father/Spouse/Siblings/Children in the "THEIR FAMILY" section,
// all rendered through the shared floating dropdown (see UTILS).
let reuseAllowed=true;
function onNameInput(){
  if(!reuseAllowed || document.getElementById('mmId').value){ hideFloatDropdown(); return; }
  const inp=document.getElementById('mFirst');
  const q=inp.value.trim();
  if(q.length<2){ hideFloatDropdown(); return; }
  const results=searchDirectory(q);
  if(results.length===0){ hideFloatDropdown(); return; }
  showFloatDropdown(inp, searchResultsHTML(results, pid=>`pickReuse('${pid}')`));
}
function hideNameDropdown(){ hideFloatDropdown(); }
let reuseSourcePhotos=null;
function pickReuse(personId){
  const rec=findByPersonId(personId);
  if(!rec) return;
  sf('mmPersonId', personId);
  sf('mFirst', rec.firstName||''); sf('mLast', rec.lastName||'');
  document.getElementById('mGender').value=rec.gender||'male';
  sf('mDob', rec.dob||''); sf('mPhone', rec.phone||''); sf('mEmail', rec.email||'');
  sf('mAddr', rec.address||''); sf('mOcc', rec.occupation||'');
  sf('mHobbies', rec.hobbies||''); sf('mBio', rec.bio||'');
  document.getElementById('mDeceased').checked=!!rec.deceased;
  sf('mDeathDate', rec.deathDate||'');
  toggleDeathField();
  reuseSourcePhotos={ photo:rec.photo||null, photos:rec.photos||[] };
  tempPhoto=rec.photo||null;
  renderFormPhotoPreview();
  hideNameDropdown();
  const chip=document.getElementById('reuseChip');
  if(chip){ chip.style.display='flex'; document.getElementById('reuseChipName').textContent=fn(rec); }
}
function clearReuseLink(){
  sf('mmPersonId','');
  const chip=document.getElementById('reuseChip');
  if(chip) chip.style.display='none';
}
const cap = s => s.charAt(0).toUpperCase()+s.slice(1);
let tTimer;
function showToast(msg){
  const el=document.getElementById('toastEl');
  el.textContent=msg; el.classList.add('show');
  clearTimeout(tTimer); tTimer=setTimeout(()=>el.classList.remove('show'),2500);
}



// ── pan-zoom.js ──
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


// ── drag-reorder.js ──
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



// ── search.js ──
// ══════════════════════════════════════════════════════
//  TREE SEARCH
// ══════════════════════════════════════════════════════
function onTreeSrchInput() {
  const q = (document.getElementById('treeSrch').value||'').toLowerCase().trim();
  const dd = document.getElementById('treeSrchDD');
  if(!dd) return;
  if(q.length < 2) { hideTreeSrchDD(); return; }
  
  const results = [];
  allTrees().forEach(t => {
    (t.members || []).forEach(m => {
      if (fn(m).toLowerCase().includes(q)) {
        results.push({ member: m, tree: t });
      }
    });
  });

  if(results.length === 0) {
    dd.innerHTML = '<div class="p-3 text-muted text-center" style="font-size:.9rem;">No matches across any trees</div>';
    dd.style.display = 'block';
    return;
  }
  
  dd.innerHTML = results.slice(0, 25).map(res => {
    const m = res.member;
    const t = res.tree;
    const isCurrent = t.id === APP.activeTreeId;
    const isF = m.gender === 'female';
    return `<div class="list-item" style="cursor:pointer;padding:10px 14px;border-bottom:1px solid #f0f0f0;" onclick="locateMemberCrossTree('${t.id}', ${m.id})">
      <div class="list-av${isF?' f':''}" style="width:36px;height:36px;font-size:1.2rem;">${m.photo?`<img src="${m.photo}">`:(isF?'👩':'👨')}</div>
      <div style="flex:1;min-width:0;margin-left:10px;">
        <div class="lname" style="font-size:.95rem;font-weight:600;">${fn(m)}${m.deceased?' ✝':''}</div>
        <div style="font-size:.78rem;color:#666;display:flex;gap:6px;align-items:center;margin-top:2px;">
          <span style="background:#f0e6ff;color:var(--p);padding:2px 8px;border-radius:10px;font-weight:600;">${t.name}</span>
          ${isCurrent ? '<span style="color:#28a745;font-weight:600;">• Active Tree</span>' : ''}
        </div>
      </div>
    </div>`;
  }).join('');
  dd.style.display = 'block';
}

function locateMemberCrossTree(treeId, memberId) {
  hideTreeSrchDD();
  const inp = document.getElementById('treeSrch');
  if (inp) inp.value = '';

  if (APP.activeTreeId !== treeId) {
    switchTree(treeId);
    setTimeout(() => {
      locateAndHighlightMember(memberId);
    }, 150);
  } else {
    locateAndHighlightMember(memberId);
  }
}

function hideTreeSrchDD() {
  const dd = document.getElementById('treeSrchDD');
  if(dd) dd.style.display = 'none';
}

function locateAndHighlightMember(id) {
  hideTreeSrchDD();
  const inp = document.getElementById('treeSrch');
  if(inp) inp.value = '';
  
  const wrap = document.getElementById('canvasWrap');
  if (!wrap) return;

  let el = document.querySelector(`.node[data-id="${id}"]`);
  
  if (!el && DB.collapsed && DB.collapsed.length > 0) {
    DB.collapsed = [];
    renderTree();
    el = document.querySelector(`.node[data-id="${id}"]`);
    showToast('Expanded branches to find member');
  }
  
  if (!el) {
    showToast('Member not found on canvas');
    return;
  }
  
  const targetX = parseFloat(el.style.left) + 45; // NW/2
  const targetY = parseFloat(el.style.top) + 50;  // NH/2
  
  panX = wrap.clientWidth/2 - targetX * zoomScale;
  panY = wrap.clientHeight/2 - targetY * zoomScale;
  applyTransform();
  
  const card = el.querySelector('.node-card');
  if(card) {
    card.classList.remove('highlight-blink');
    void card.offsetWidth;
    card.classList.add('highlight-blink');
    setTimeout(() => card.classList.remove('highlight-blink'), 3000);
  }
}



// ── graph.js ──
// ══════════════════════════════════════════════════════
//  SOCIAL GRAPH VIEW (Network Graph Engine — Adaptive Family Spacing)
// ══════════════════════════════════════════════════════
var graphPanX = 0, graphPanY = 0, graphZoom = 1;
var graphNodesData = [];
var graphLinksData = [];
var graphDraggingId = null;

function renderGraph() {
  const container = document.getElementById('graphWrap');
  const svg = document.getElementById('graphSvg');
  const nodesDiv = document.getElementById('graphNodes');
  const emptyState = document.getElementById('graphEmptyState');

  if (!container || !svg || !nodesDiv) return;

  if (!DB || !DB.members || DB.members.length === 0) {
    if (emptyState) emptyState.style.display = 'flex';
    nodesDiv.innerHTML = '';
    svg.innerHTML = '';
    return;
  }
  if (emptyState) emptyState.style.display = 'none';

  const members = (typeof tempSubTreeHeadId !== 'undefined' && tempSubTreeHeadId !== null)
    ? DB.members.filter(m => getSubTreeMemberIds(tempSubTreeHeadId).has(m.id))
    : DB.members;
  const memberMap = new Map(members.map(m => [m.id, m]));

  // 1. Calculate true generation depth for each member via topological BFS
  const genMap = new Map();
  members.forEach(m => {
    const validParents = (m.parentIds || []).filter(pid => memberMap.has(pid));
    if (validParents.length === 0) genMap.set(m.id, 0);
  });

  let changed = true, guard = 0;
  while (changed && guard++ < 30) {
    changed = false;
    members.forEach(m => {
      const validParents = (m.parentIds || []).filter(pid => memberMap.has(pid));
      if (validParents.length > 0) {
        let maxPGen = -1;
        validParents.forEach(pid => {
          if (genMap.has(pid)) maxPGen = Math.max(maxPGen, genMap.get(pid));
        });
        if (maxPGen >= 0) {
          const newGen = maxPGen + 1;
          if (genMap.get(m.id) !== newGen) {
            genMap.set(m.id, newGen);
            changed = true;
          }
        }
      }
    });
  }

  // Ensure all spouses share the same generation rank
  members.forEach(m => {
    const g = genMap.get(m.id) || 0;
    const sps = mSpouses(m);
    sps.forEach(sp => {
      const spG = genMap.get(sp.id) || 0;
      const maxG = Math.max(g, spG);
      genMap.set(m.id, maxG);
      genMap.set(sp.id, maxG);
    });
  });

  // Calculate child count per member/couple
  const getEffectiveChildrenCount = (m) => {
    const c1 = (m.childIds || []).length;
    const sps = mSpouses(m);
    const c2 = sps.reduce((max, sp) => Math.max(max, (sp.childIds || []).length), 0);
    return Math.max(c1, c2);
  };

  // Group nodes by generation for initial horizontal layout
  const genGroups = new Map();
  members.forEach(m => {
    const g = genMap.get(m.id) || 0;
    if (!genGroups.has(g)) genGroups.set(g, []);
    genGroups.get(g).push(m);
  });

  graphNodesData = members.map((m) => {
    const g = genMap.get(m.id) || 0;
    const group = genGroups.get(g) || [m];
    const idxInGroup = group.indexOf(m);
    const chCount = getEffectiveChildrenCount(m);

    // Adaptive initial horizontal spacing: >2 children gets wider 260px gap, <=2 children gets optimal 170px gap
    let cumulativeX = 0;
    for (let i = 0; i < idxInGroup; i++) {
      const prevM = group[i];
      const prevCh = getEffectiveChildrenCount(prevM);
      cumulativeX += (prevCh > 2 || chCount > 2) ? 260 : 170;
    }

    const initialX = (window.innerWidth / 2) - (group.length * 170 / 2) + cumulativeX;
    const initialY = 130 + g * 240;

    return {
      id: m.id,
      member: m,
      gen: g,
      chCount: chCount,
      x: m._gx || initialX,
      y: m._gy || initialY,
      vx: 0,
      vy: 0
    };
  });

  const nodePosMap = new Map(graphNodesData.map(n => [n.id, n]));

  // 2. Build links: Spouses first, then Husband-Centered Parent-Child links
  graphLinksData = [];
  const linkSeen = new Set();

  // Spouses
  members.forEach(m => {
    const sps = mSpouses(m);
    sps.forEach(sp => {
      const key = [Math.min(m.id, sp.id), Math.max(m.id, sp.id)].join('-m-');
      if (!linkSeen.has(key)) {
        linkSeen.add(key);
        graphLinksData.push({ type: 'spouse', source: m.id, target: sp.id, dist: 140 });
      }
    });
  });

  // Parent-Child links: Pick Husband / Male Parent as primary source node if available
  members.forEach(c => {
    const validParents = (c.parentIds || []).map(pid => memberMap.get(pid)).filter(Boolean);
    
    if (validParents.length > 0) {
      const father = validParents.find(p => p.gender === 'male') || validParents[0];
      const pcKey = [father.id, c.id].join('-pc-');
      if (!linkSeen.has(pcKey)) {
        linkSeen.add(pcKey);
        graphLinksData.push({
          type: 'parent-child',
          source: father.id,
          target: c.id,
          dist: 200
        });
      }
    }
  });

  runGraphPhysics(nodePosMap, graphLinksData);

  nodesDiv.innerHTML = graphNodesData.map(n => {
    const m = n.member;
    const isF = m.gender === 'female';
    const isSel = selId === m.id;
    const spCount = mSpouses(m).length;
    const chCount = (m.childIds || []).length;
    return `<div class="graph-node${isF ? ' f' : ''}${isSel ? ' sel' : ''}" 
                 data-id="${m.id}" 
                 style="left:${n.x - 45}px;top:${n.y - 50}px;"
                 onmousedown="startGraphDrag(event, ${m.id})"
                 ontouchstart="startGraphDrag(event, ${m.id})"
                 onclick="nodeClick(${m.id})">
      <div class="graph-node-avatar${isF ? ' f' : ''}">
        ${m.photo ? `<img src="${m.photo}">` : (isF ? '👩' : '👨')}
      </div>
      <div class="graph-node-name">${fn(m)}</div>
      <div class="graph-node-badges">
        ${spCount > 0 ? `<span class="graph-badge" title="${spCount} spouse${spCount>1?'s':''}">💑${spCount>1?spCount:''}</span>` : ''}
        ${chCount > 0 ? `<span class="graph-badge" title="${chCount} children">👶${chCount}</span>` : ''}
      </div>
    </div>`;
  }).join('');

  drawGraphEdges(svg, nodePosMap, graphLinksData);
  initGraphPanZoom();
}

function runGraphPhysics(nodeMap, links) {
  const nodes = Array.from(nodeMap.values());
  const iterations = 100;

  for (let iter = 0; iter < iterations; iter++) {
    // Adaptive Repulsion: Families with >2 children get larger 560px repulsion, <=2 children get compact 360px repulsion
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const n1 = nodes[i];
        const n2 = nodes[j];
        const hasLargeFamily = (n1.chCount > 2 || n2.chCount > 2);
        const maxDist = hasLargeFamily ? 560 : 360;
        const kForce = hasLargeFamily ? 260 : 170;

        const dx = n2.x - n1.x || 1;
        const dy = n2.y - n1.y || 1;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        if (dist < maxDist) {
          const force = (kForce * kForce) / dist;
          const fx = (dx / dist) * force * 0.09;
          const fy = (dy / dist) * force * 0.05;
          n1.vx -= fx; n1.vy -= fy;
          n2.vx += fx; n2.vy += fy;
        }
      }
    }

    links.forEach(l => {
      const source = nodeMap.get(l.source);
      const target = nodeMap.get(l.target);
      if (!source || !target) return;
      const dx = target.x - source.x || 1;
      const dy = target.y - source.y || 1;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const force = (dist - l.dist) * 0.06;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      source.vx += fx; source.vy += fy;
      target.vx -= fx; target.vy -= fy;
    });

    nodes.forEach(n => {
      const targetY = 130 + n.gen * 240;
      n.vy += (targetY - n.y) * 0.08;

      n.vx *= 0.80;
      n.vy *= 0.80;
      n.x += n.vx;
      n.y += n.vy;
      n.member._gx = n.x;
      n.member._gy = n.y;
    });
  }
}

function getCardBorderPoint(sx, sy, tx, ty, hw = 48, hh = 52) {
  const dx = tx - sx;
  const dy = ty - sy;
  if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return { x: sx, y: sy };
  const scale = Math.min(hw / Math.abs(dx || 0.001), hh / Math.abs(dy || 0.001));
  return {
    x: sx + dx * scale,
    y: sy + dy * scale
  };
}

function drawGraphEdges(svg, nodeMap, links) {
  let html = `<defs>
    <marker id="graphArrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#9D4EDD" />
    </marker>
  </defs>`;

  links.forEach(l => {
    const s = nodeMap.get(l.source);
    const t = nodeMap.get(l.target);
    if (!s || !t) return;

    const pStart = getCardBorderPoint(s.x, s.y, t.x, t.y, 48, 52);
    const pEnd   = getCardBorderPoint(t.x, t.y, s.x, s.y, 48, 52);

    if (l.type === 'spouse') {
      const midX = (pStart.x + pEnd.x) / 2;
      const midY = (pStart.y + pEnd.y) / 2;
      html += `<line x1="${pStart.x}" y1="${pStart.y}" x2="${pEnd.x}" y2="${pEnd.y}" stroke="#e0aaff" stroke-width="5" stroke-dasharray="6,3" />`;
      html += `<line x1="${pStart.x}" y1="${pStart.y}" x2="${pEnd.x}" y2="${pEnd.y}" stroke="#7B2FBE" stroke-width="2.5" />`;
      html += `<circle cx="${midX}" cy="${midY}" r="11" fill="#fff" stroke="#7B2FBE" stroke-width="2" />`;
      html += `<text x="${midX}" y="${midY + 4}" font-size="11" text-anchor="middle">💍</text>`;
    } else if (l.type === 'parent-child') {
      const dx = pEnd.x - pStart.x;
      const dy = pEnd.y - pStart.y;
      const cx = (pStart.x + pEnd.x) / 2 - dy * 0.12;
      const cy = (pStart.y + pEnd.y) / 2 + dx * 0.12;

      // Midpoint of quadratic bezier curve for badge placement (t = 0.5)
      const midX = 0.25 * pStart.x + 0.5 * cx + 0.25 * pEnd.x;
      const midY = 0.25 * pStart.y + 0.5 * cy + 0.25 * pEnd.y;

      html += `<path d="M ${pStart.x} ${pStart.y} Q ${cx} ${cy} ${pEnd.x} ${pEnd.y}" stroke="#9D4EDD" stroke-width="2.5" fill="none" marker-end="url(#graphArrow)" opacity="0.85" />`;
      html += `<circle cx="${midX}" cy="${midY}" r="9" fill="#fff" stroke="#9D4EDD" stroke-width="1.5" />`;
      html += `<text x="${midX}" y="${midY + 3}" font-size="9" text-anchor="middle">👶</text>`;
    }
  });

  svg.innerHTML = html;
}

function startGraphDrag(e, id) {
  e.stopPropagation();
  graphDraggingId = id;
  const nodeEl = document.querySelector(`.graph-node[data-id="${id}"]`);
  if (nodeEl) nodeEl.classList.add('dragging');

  const onMove = (evt) => {
    if (!graphDraggingId) return;
    const clientX = evt.touches ? evt.touches[0].clientX : evt.clientX;
    const clientY = evt.touches ? evt.touches[0].clientY : evt.clientY;

    const wrap = document.getElementById('graphWrap');
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const nx = (clientX - rect.left - graphPanX) / graphZoom;
    const ny = (clientY - rect.top - graphPanY) / graphZoom;

    const n = graphNodesData.find(x => x.id === graphDraggingId);
    if (n) {
      n.x = nx; n.y = ny;
      n.member._gx = nx; n.member._gy = ny;
      const el = document.querySelector(`.graph-node[data-id="${n.id}"]`);
      if (el) {
        el.style.left = (nx - 45) + 'px';
        el.style.top = (ny - 50) + 'px';
      }
      const nodePosMap = new Map(graphNodesData.map(node => [node.id, node]));
      drawGraphEdges(document.getElementById('graphSvg'), nodePosMap, graphLinksData);
    }
  };

  const onEnd = () => {
    if (graphDraggingId) {
      const nodeEl = document.querySelector(`.graph-node[data-id="${graphDraggingId}"]`);
      if (nodeEl) nodeEl.classList.remove('dragging');
      graphDraggingId = null;
    }
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onEnd);
    window.removeEventListener('touchmove', onMove);
    window.removeEventListener('touchend', onEnd);
  };

  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onEnd);
  window.addEventListener('touchmove', onMove, { passive: true });
  window.addEventListener('touchend', onEnd);
}

function initGraphPanZoom() {
  const wrap = document.getElementById('graphWrap');
  if (!wrap || wrap._hasPanZoom) return;
  wrap._hasPanZoom = true;

  let isPan = false, startX = 0, startY = 0;
  let pinchStartDist = 0, pinchStartScale = 1;

  wrap.addEventListener('mousedown', e => {
    if (e.target.closest('.graph-node')) return;
    isPan = true;
    startX = e.clientX - graphPanX;
    startY = e.clientY - graphPanY;
    wrap.style.cursor = 'grabbing';
  });

  window.addEventListener('mousemove', e => {
    if (!isPan) return;
    graphPanX = e.clientX - startX;
    graphPanY = e.clientY - startY;
    applyGraphTransform();
  });

  window.addEventListener('mouseup', () => {
    if (isPan) {
      isPan = false;
      wrap.style.cursor = 'grab';
    }
  });

  function touchDist(t) {
    const dx = t[0].clientX - t[1].clientX, dy = t[0].clientY - t[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }
  function touchMid(t) {
    return { x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 };
  }

  // Touch drag + pinch zoom on Social Graph View (Phone support)
  wrap.addEventListener('touchstart', e => {
    if (e.target.closest('.graph-node')) return;
    if (e.touches.length === 1) {
      isPan = true;
      startX = e.touches[0].clientX - graphPanX;
      startY = e.touches[0].clientY - graphPanY;
    } else if (e.touches.length === 2) {
      isPan = false;
      pinchStartDist = touchDist(e.touches);
      pinchStartScale = graphZoom;
    }
  }, { passive: false });

  wrap.addEventListener('touchmove', e => {
    if (e.target.closest('.graph-node') && graphDraggingId) return;
    if (e.touches.length === 1 && isPan) {
      if (e.cancelable) e.preventDefault();
      graphPanX = e.touches[0].clientX - startX;
      graphPanY = e.touches[0].clientY - startY;
      applyGraphTransform();
    } else if (e.touches.length === 2) {
      if (e.cancelable) e.preventDefault();
      const dist = touchDist(e.touches);
      if (pinchStartDist > 0) {
        const mid = touchMid(e.touches);
        const newZoom = Math.min(Math.max(pinchStartScale * (dist / pinchStartDist), 0.15), 3.0);
        const factor = newZoom / graphZoom;
        graphPanX = mid.x - factor * (mid.x - graphPanX);
        graphPanY = mid.y - factor * (mid.y - graphPanY);
        graphZoom = newZoom;
        applyGraphTransform();
      }
    }
  }, { passive: false });

  wrap.addEventListener('touchend', e => {
    if (e.touches.length === 1) {
      isPan = true;
      startX = e.touches[0].clientX - graphPanX;
      startY = e.touches[0].clientY - graphPanY;
    } else {
      isPan = false;
    }
  });

  wrap.addEventListener('wheel', e => {
    e.preventDefault();
    const rect = wrap.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.08 : 0.92;
    const newZoom = Math.min(Math.max(graphZoom * factor, 0.15), 3.0);
    const ratio = newZoom / graphZoom;
    graphPanX = mouseX - ratio * (mouseX - graphPanX);
    graphPanY = mouseY - ratio * (mouseY - graphPanY);
    graphZoom = newZoom;
    applyGraphTransform();
  }, { passive: false });
}

function applyGraphTransform() {
  const layer = document.getElementById('graphZoomLayer');
  if (layer) {
    layer.style.transform = `translate(${graphPanX}px, ${graphPanY}px) scale(${graphZoom})`;
  }
}

function fitGraphToScreen() {
  if (!graphNodesData || graphNodesData.length === 0) return;

  const wrap = document.getElementById('graphWrap');
  if (!wrap) return;

  const rect = wrap.getBoundingClientRect();
  const W = rect.width || window.innerWidth;
  const H = rect.height || window.innerHeight;

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  graphNodesData.forEach(n => {
    if (n.x < minX) minX = n.x;
    if (n.x > maxX) maxX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.y > maxY) maxY = n.y;
  });

  const graphW = (maxX - minX) + 240;
  const graphH = (maxY - minY) + 260;

  const scaleX = W / graphW;
  const scaleY = H / graphH;
  graphZoom = Math.min(Math.max(Math.min(scaleX, scaleY), 0.25), 1.2);

  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;

  graphPanX = (W / 2) - midX * graphZoom;
  graphPanY = (H / 2) - midY * graphZoom;

  applyGraphTransform();
}


// ── auth.js ──
// ══════════════════════════════════════════════════════
//  AUTH & SSO & PROFILE LINKING & INVITATIONS
// ══════════════════════════════════════════════════════
var currentUser = null;
var activeInviteToken = null;
var activeInviteDetails = null;

function initAuth() {
  const saved = localStorage.getItem('familyroot_auth');
  if (saved) {
    try {
      currentUser = JSON.parse(saved);
      updateAuthUI();
    } catch(e) { currentUser = null; }
  } else {
    updateAuthUI();
  }

  // Check URL parameters for Invite Token (?inviteToken=inv_...)
  const urlParams = new URLSearchParams(window.location.search);
  const token = urlParams.get('inviteToken');
  if (token) {
    checkInviteToken(token);
  }
}

function updateAuthUI() {
  const btn = document.getElementById('authUserBtn');
  const wrap = document.getElementById('authUserWrap');
  const nameEl = document.getElementById('authUserName');
  const emailEl = document.getElementById('authUserEmail');
  const avatarEl = document.getElementById('authAvatar');

  if (currentUser) {
    if (btn) btn.style.display = 'none';
    if (wrap) wrap.style.display = 'inline-block';
    if (nameEl) nameEl.textContent = currentUser.name || 'User';
    if (emailEl) emailEl.textContent = currentUser.email || '';
    if (avatarEl) avatarEl.textContent = currentUser.avatar || '👤';
  } else {
    if (btn) btn.style.display = 'inline-block';
    if (wrap) wrap.style.display = 'none';
  }
}

function openLoginModal() {
  getM('loginModal').show();
}

async function handleSSOLogin(provider) {
  const mockNames = {
    Google: 'Vikya Rao',
    Microsoft: 'Vikyath K. Rao',
    Apple: 'Vikyath Rao'
  };
  const mockEmails = {
    Google: 'vikyath.rao@gmail.com',
    Microsoft: 'vikyath.rao@outlook.com',
    Apple: 'vikyath.rao@apple.com'
  };

  const name = mockNames[provider] || 'Family Member';
  const email = mockEmails[provider] || 'user@example.com';
  const avatar = provider === 'Google' ? '🌐' : (provider === 'Microsoft' ? '💼' : '🍎');

  currentUser = {
    provider: provider,
    name: name,
    email: email,
    avatar: avatar
  };

  localStorage.setItem('familyroot_auth', JSON.stringify(currentUser));
  updateAuthUI();
  closeM('loginModal');

  // Sync with Cloudflare Workers API if available
  if (typeof API !== 'undefined') {
    try {
      const res = await API.loginSSO(name, email, provider, avatar);
      if (res && res.user) {
        currentUser.id = res.user.id;
        localStorage.setItem('familyroot_auth', JSON.stringify(currentUser));
      }
    } catch (err) {}
  }

  showToast(`Signed in with ${provider}!`);

  if (activeInviteToken) {
    executeClaimInvite();
  } else {
    setTimeout(openLinkMemberModal, 350);
  }
}

async function handleEmailLogin(e) {
  if (e) e.preventDefault();
  const email = document.getElementById('loginEmailInput').value.trim();
  const name = document.getElementById('loginNameInput').value.trim();

  if (!email || !name) {
    showToast('Please provide both name and email');
    return;
  }

  currentUser = {
    provider: 'Email',
    name: name,
    email: email,
    avatar: '👤'
  };

  localStorage.setItem('familyroot_auth', JSON.stringify(currentUser));
  updateAuthUI();
  closeM('loginModal');

  if (typeof API !== 'undefined') {
    try {
      const res = await API.loginSSO(name, email, 'Email');
      if (res && res.user) {
        currentUser.id = res.user.id;
        localStorage.setItem('familyroot_auth', JSON.stringify(currentUser));
      }
    } catch (err) {}
  }

  showToast(`Signed in as ${name}!`);

  if (activeInviteToken) {
    executeClaimInvite();
  } else {
    setTimeout(openLinkMemberModal, 350);
  }
}

// ══════════════════════════════════════════════════════
//  MEMBER INVITATION & PROFILE CLAIMING ENGINE
// ══════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════
//  MEMBER INVITATION & PROFILE CLAIMING ENGINE (STABLE LOCAL MODE)
// ══════════════════════════════════════════════════════
async function checkInviteToken(token) {
  activeInviteToken = token;
  try {
    const raw = atob(token);
    const details = JSON.parse(raw);
    if (details && details.memberId) {
      activeInviteDetails = {
        valid: true,
        treeName: details.treeName || 'Family Tree',
        inviterName: details.inviterName || 'A family member',
        targetMemberName: details.memberName || 'Member',
        treeId: details.treeId,
        memberId: details.memberId,
        assignedRole: 'editor'
      };
      showClaimInviteModal(activeInviteDetails);
      return;
    }
  } catch (e) {}

  if (typeof API !== 'undefined') {
    try {
      const res = await API.validateInviteToken(token);
      if (res.valid) {
        activeInviteDetails = res;
        showClaimInviteModal(res);
      }
    } catch (err) {}
  }
}

function showClaimInviteModal(details) {
  const modalEl = document.getElementById('claimInviteModal');
  if (!modalEl) return;

  const treeEl = document.getElementById('inviteTreeName');
  const memberEl = document.getElementById('inviteMemberName');
  const roleEl = document.getElementById('inviteRoleBadge');

  if (treeEl) treeEl.textContent = details.treeName || 'Family Tree';
  if (memberEl) memberEl.textContent = details.targetMemberName || 'your member card';
  if (roleEl) roleEl.textContent = (details.assignedRole || 'editor').toUpperCase();

  getM('claimInviteModal').show();
}

function confirmClaimInvite() {
  if (!currentUser) {
    openLoginModal();
    showToast('Please sign in or create an account to accept invitation');
    return;
  }
  executeClaimInvite();
}

async function executeClaimInvite() {
  if (!activeInviteDetails) {
    closeM('claimInviteModal');
    return;
  }

  if (!currentUser) {
    openLoginModal();
    showToast('Please sign in to accept the family tree invitation');
    return;
  }

  const details = activeInviteDetails;
  showToast(`Profile claimed! Linked to ${details.targetMemberName}`);
  closeM('claimInviteModal');

  currentUser.linkedTreeId = details.treeId;
  currentUser.linkedMemberId = details.memberId;
  localStorage.setItem('familyroot_auth', JSON.stringify(currentUser));

  if (details.treeId && typeof switchTree === 'function' && APP.trees[details.treeId]) {
    switchTree(details.treeId);
  }
  activeInviteToken = null;
  activeInviteDetails = null;
}

async function generateMemberInvite(memberId) {
  const m = gm(memberId);
  if (!m) return;

  const email = m.email || (currentUser ? currentUser.email : '');

  const invitePayload = {
    treeId: APP.activeTreeId,
    treeName: DB ? DB.name : 'Family Tree',
    memberId: memberId,
    memberName: fn(m),
    inviterName: currentUser ? currentUser.name : 'Family Member',
    email: email,
    ts: Date.now()
  };

  const token = btoa(JSON.stringify(invitePayload));
  const inviteUrl = window.location.origin + window.location.pathname + '?inviteToken=' + encodeURIComponent(token);

  if (navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      showToast(`Invite link copied to clipboard for ${fn(m)}!`);
      return;
    } catch (e) {}
  }

  showToast(`Invite link created for ${fn(m)}!`);
}

function openLinkMemberModal() {
  if (!currentUser) {
    openLoginModal();
    return;
  }

  const badge = document.getElementById('linkUserEmailBadge');
  if (badge) badge.textContent = currentUser.email;

  const treeSel = document.getElementById('linkTreeSel');
  if (treeSel) {
    const trees = allTrees();
    treeSel.innerHTML = trees.map(t => `<option value="${t.id}" ${t.id === APP.activeTreeId ? 'selected' : ''}>${t.name} (${(t.members||[]).length} members)</option>`).join('');
  }

  const input = document.getElementById('linkMemberInput');
  const hidden = document.getElementById('linkMemberIdHidden');
  if (input) input.value = '';
  if (hidden) hidden.value = '';

  if (currentUser.linkedMemberId && currentUser.linkedTreeId) {
    const targetTree = APP.trees[currentUser.linkedTreeId] || DB;
    const m = (targetTree.members || []).find(x => x.id === currentUser.linkedMemberId);
    if (m && input && hidden) {
      input.value = fn(m);
      hidden.value = m.id;
    }
  }

  getM('linkMemberModal').show();
}

function onLinkMemberSearchInput() {
  const treeSel = document.getElementById('linkTreeSel');
  const input = document.getElementById('linkMemberInput');
  const dd = document.getElementById('linkMemberSuggestionsDD');

  if (!treeSel || !input || !dd) return;

  const q = input.value.toLowerCase().trim();

  // ONLY visible when typing (q.length > 0)
  if (!q || q.length === 0) {
    dd.style.display = 'none';
    dd.innerHTML = '';
    return;
  }

  const treeId = treeSel.value;
  const targetTree = APP.trees[treeId] || DB;
  const members = targetTree.members || [];

  const matches = members.filter(m => fn(m).toLowerCase().includes(q));

  if (matches.length === 0) {
    dd.innerHTML = '<div class="p-3 text-muted text-center small">No members match your search</div>';
    dd.style.display = 'block';
    return;
  }

  dd.innerHTML = matches.map(m => {
    const isF = m.gender === 'female';
    const escapedName = fn(m).replace(/'/g, "\\'");
    return `<div class="d-flex align-items-center gap-2 p-2 border-bottom hover-bg-light" style="cursor:pointer;" onclick="selectLinkMemberSuggestion(${m.id}, '${escapedName}')">
      <div class="rounded-circle d-flex align-items-center justify-content-center" style="width:32px;height:32px;background:${isF?'#fce4ec':'#ede7f6'};overflow:hidden;flex-shrink:0;">
        ${m.photo ? `<img src="${m.photo}" style="width:100%;height:100%;object-fit:cover;">` : (isF ? '👩' : '👨')}
      </div>
      <div style="flex:1;min-width:0;">
        <div class="fw-semibold text-dark small" style="line-height:1.2;">${fn(m)}</div>
        <div class="text-muted" style="font-size:0.75rem;">${m.email ? `📧 ${m.email}` : 'No email listed'}</div>
      </div>
    </div>`;
  }).join('');

  dd.style.display = 'block';
}

function selectLinkMemberSuggestion(id, name) {
  const input = document.getElementById('linkMemberInput');
  const hidden = document.getElementById('linkMemberIdHidden');
  const dd = document.getElementById('linkMemberSuggestionsDD');

  if (input) input.value = name;
  if (hidden) hidden.value = id;
  if (dd) dd.style.display = 'none';
}

function hideLinkMemberSuggestions() {
  const dd = document.getElementById('linkMemberSuggestionsDD');
  if (dd) dd.style.display = 'none';
}

function confirmLinkMember() {
  if (!currentUser) return;

  const treeSel = document.getElementById('linkTreeSel');
  const hidden = document.getElementById('linkMemberIdHidden');
  const input = document.getElementById('linkMemberInput');

  if (!treeSel || !input) return;

  const selectedTreeId = treeSel.value;
  let selectedMemberId = parseInt(hidden ? hidden.value : '');

  const targetTree = APP.trees[selectedTreeId];
  if (!targetTree) return;

  const members = targetTree.members || [];

  if (isNaN(selectedMemberId) && input.value.trim()) {
    const typedName = input.value.trim().toLowerCase();
    const matched = members.find(x => fn(x).toLowerCase() === typedName || x.firstName.toLowerCase() === typedName);
    if (matched) selectedMemberId = matched.id;
  }

  if (isNaN(selectedMemberId)) {
    showToast('Please select a valid member profile from suggestions');
    return;
  }

  const m = members.find(x => x.id === selectedMemberId);
  if (!m) {
    showToast('Selected member not found');
    return;
  }

  m.email = currentUser.email;

  if (m.personId && typeof syncPersonEverywhere === 'function') {
    syncPersonEverywhere(m.personId, { email: currentUser.email });
  }

  currentUser.linkedTreeId = selectedTreeId;
  currentUser.linkedMemberId = m.id;
  localStorage.setItem('familyroot_auth', JSON.stringify(currentUser));

  switchTree(selectedTreeId);
  save();
  closeM('linkMemberModal');
  showToast(`Profile linked to ${fn(m)}! Email updated to ${currentUser.email}`);
}

function logoutUser() {
  currentUser = null;
  localStorage.removeItem('familyroot_auth');
  updateAuthUI();
  showToast('Signed out');
}


// ── boot.js ──
// ══════════════════════════════════════════════════════
//  BOOT
// ══════════════════════════════════════════════════════
load(); initAuth();
renderTree();
setTimeout(fitToScreen, 0);

