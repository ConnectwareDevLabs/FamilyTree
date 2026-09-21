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
  DB=APP.trees[APP.activeTreeId];
  if(!Array.isArray(DB.collapsed)) DB.collapsed=[];
  (DB.members||[]).forEach(m=>{ if(!m.personId) m.personId=genPersonId(); });
  updCt();
  updateTreeBadge();
}

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
  APP.activeTreeId=id; DB=APP.trees[id];
  selId=null; viewId=null;
  saveApp(); updateTreeBadge();
  if(curView==='tree') renderTree(); else renderList();
}
function switchTreeAndClose(id){ switchTree(id); closeM('treesModal'); showToast('Switched to "'+APP.trees[id].name+'"'); }
function newTree(name){
  const id=genTreeId();
  APP.trees[id]={ id, name:(name||'New Tree').trim()||'New Tree', updatedAt:Date.now(), nextId:1, members:[], collapsed:[] };
  APP.activeTreeId=id; DB=APP.trees[id];
  selId=null; viewId=null;
  saveApp(); updateTreeBadge();
  if(curView==='tree') renderTree(); else renderList();
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
      if(curView==='tree') renderTree(); else renderList();
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
function updCt(){
  const n=DB.members.length;
  const t=n+' member'+(n!==1?'s':'');
  document.getElementById('topCt').textContent=t;
  document.getElementById('sbCt').textContent=t;
}
const gm = id => DB.members.find(m=>m.id===id);
const fn = m => m?(m.firstName+(m.lastName?' '+m.lastName:'')):'—';

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

// ══════════════════════════════════════════════════════
//  VIEWS
// ══════════════════════════════════════════════════════
function setView(v){
  curView=v;
  document.getElementById('canvasWrap').style.display = v==='tree'?'':'none';
  document.getElementById('listView').style.display   = v==='list'?'block':'none';
  if(v==='tree') renderTree(); else renderList();
}
function toggleView(){ setView(curView==='tree'?'list':'tree'); }

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

function renderTree(){
  const inner  = document.getElementById('innerWrap');
  const svg    = document.getElementById('treeSvg');
  const empty  = document.getElementById('emptyState');

  // Remove old nodes (keep SVG)
  Array.from(inner.querySelectorAll('.node')).forEach(n=>n.remove());
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
  const isCollapsed = (m, sp) => collapsedSet.has(m.id) || (sp && collapsedSet.has(sp.id));

  // ── 1. Identify root generation ──────────────────
  // Root = member whose parentIds are empty OR none of their parents exist in DB
  const allIds = new Set(DB.members.map(m=>m.id));
  const isRoot = m => !(m.parentIds||[]).some(pid=>allIds.has(pid));

  // Collect unique root "heads" (ignore spouses of roots, they get placed alongside)
  const visited = new Set();
  const roots = DB.members.filter(m=>{
    if(!isRoot(m)) return false;

    // If this member has no parents but their spouse does, the spouse's
    // ancestry is the real root of the couple. Rendering this member as
    // another root would split/duplicate the family tree.
    const sp = m.spouseId ? gm(m.spouseId) : null;
    const spouseHasParents = sp &&
      (sp.parentIds || []).some(pid => allIds.has(pid));

    if(spouseHasParents) return false;

    // If both spouses are roots, render the couple only once.
    return !(sp && isRoot(sp) && sp.id < m.id);
  });

  // ── 2. Compute layout ────────────────────────────
  const positions = {}; // id → {x,y}
  const lines = [];     // drawing instructions

  // Measure the total pixel width a subtree rooted at `id` needs
  function measure(id, seen){
    if(seen.has(id)) return NW;
    seen.add(id);
    const m=gm(id); if(!m) return NW;
    const sp=m.spouseId?gm(m.spouseId):null;
    if(sp) seen.add(sp.id);
    const coupleW = NW + (sp ? SGAP+NW : 0);
    if(isCollapsed(m, sp)) return coupleW;

    // Children = union of both spouses' childIds, deduplicated
    const childIds = uniqueChildren(m, sp).filter(cid=>!seen.has(cid)&&gm(cid));
    if(childIds.length===0) return coupleW;

    const childrenW = childIds.reduce((sum,cid,i)=>
      sum + measure(cid, new Set([...seen])) + (i>0?HGAP:0), 0);
    return Math.max(coupleW, childrenW);
  }

  // Place unit for `id` with top-left corner at (x, y). Returns {x,y} of couple centre.
  function place(id, x, y, seen){
    if(seen.has(id)) return null;
    seen.add(id);
    const m=gm(id); if(!m) return null;
    const sp=m.spouseId?gm(m.spouseId):null;
    if(sp) seen.add(sp.id);

    const coupleW = NW + (sp ? SGAP+NW : 0);
    const branchCollapsed = isCollapsed(m, sp);
    const childIds = branchCollapsed ? [] : uniqueChildren(m, sp).filter(cid=>!seen.has(cid)&&gm(cid));

    // Measure children total width
    let childrenW = 0;
    const childSeenClone = new Set([...seen]);
    childIds.forEach((cid,i)=>{
      childrenW += measure(cid, new Set([...childSeenClone])) + (i>0?HGAP:0);
    });

    const unitW = Math.max(coupleW, childrenW);

    // Centre the couple within unitW
    const coupleLeft = x + (unitW - coupleW)/2;
    positions[id] = { x: coupleLeft, y };
    if(sp) positions[sp.id] = { x: coupleLeft + NW + SGAP, y };

    const coupleMidX = coupleLeft + coupleW/2;

    // Spouse connector
    if(sp){
      lines.push({ type:'spouse', x1: coupleLeft+NW, x2: coupleLeft+NW+SGAP, y: y+38 });
    }

    // Children
    if(childIds.length>0){
      const childY = y + NH + VGAP;
      // Lay out children left-to-right centred under the couple
      const childSeenPlace = new Set([...seen]);
      const childWidths = childIds.map(cid=>measure(cid, new Set([...childSeenPlace])));
      const totalChildW = childWidths.reduce((s,w,i)=>s+w+(i>0?HGAP:0),0);
      let cx = x + (unitW - totalChildW)/2;

      const childMidXs = [];
      childIds.forEach((cid,i)=>{
        const result = place(cid, cx, childY, seen);
        // child mid X = centre of that child's couple
        const cm=gm(cid), csp=cm.spouseId?gm(cm.spouseId):null;
        const cCoupleW=NW+(csp?SGAP+NW:0);
        const cUnitW=childWidths[i];
        const cCoupleLeft=cx+(cUnitW-cCoupleW)/2;
        childMidXs.push(cCoupleLeft + cCoupleW/2);
        cx += childWidths[i] + HGAP;
      });

      lines.push({
        type:'children',
        parentMidX: coupleMidX,
        parentBottomY: y+NH,
        childTopY: childY,
        childMidXs
      });
    }

    return coupleMidX;
  }

  // Place all root groups side by side
  let cx = PAD;
  const placedSeen = new Set();
  roots.forEach(root=>{
    if(placedSeen.has(root.id)) return;

    // Snapshot of who was already placed BEFORE this root — used below to
    // detect a child that belongs to this root but got placed by an
    // earlier root instead (this happens when that child is someone's
    // spouse, e.g. "Mom" was already placed next to "Dad" because they
    // are married — her own parents still need a connector line to her).
    const preSeen = new Set(placedSeen);

    const w = measure(root.id, new Set([...placedSeen]));
    place(root.id, cx, PAD, placedSeen);

    const rootPos = positions[root.id];
    if(rootPos && !isCollapsed(root, root.spouseId?gm(root.spouseId):null)){
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

  // ── 3. Compute canvas size ───────────────────────
  let maxX=100, maxY=100;
  Object.values(positions).forEach(p=>{
    maxX=Math.max(maxX, p.x+NW+PAD);
    maxY=Math.max(maxY, p.y+NH+PAD);
  });
  inner.style.width  = maxX+'px';
  inner.style.height = maxY+'px';
  svg.setAttribute('width',  maxX);
  svg.setAttribute('height', maxY);

  // ── 4. Draw SVG lines ────────────────────────────
  let svgContent='';
  lines.forEach(l=>{
    if(l.type==='spouse'){
      // Horizontal line between spouse cards + dot in centre
      const mx=(l.x1+l.x2)/2;
      svgContent+=`<line x1="${l.x1}" y1="${l.y}" x2="${l.x2}" y2="${l.y}" stroke="#9D4EDD" stroke-width="2.5"/>`;
      svgContent+=`<circle cx="${mx}" cy="${l.y}" r="5" fill="#9D4EDD"/>`;
    } else if(l.type==='inlaw'){
      // Dashed elbow connecting a parent couple to their child who is
      // already positioned elsewhere (placed there via marriage).
      const midY = l.y1 + (l.y2 - l.y1)/2;
      svgContent+=`<line x1="${l.x1}" y1="${l.y1}" x2="${l.x1}" y2="${midY}" stroke="#9D4EDD" stroke-width="2.5" stroke-dasharray="5,4"/>`;
      svgContent+=`<line x1="${l.x1}" y1="${midY}" x2="${l.x2}" y2="${midY}" stroke="#9D4EDD" stroke-width="2.5" stroke-dasharray="5,4"/>`;
      svgContent+=`<line x1="${l.x2}" y1="${midY}" x2="${l.x2}" y2="${l.y2}" stroke="#9D4EDD" stroke-width="2.5" stroke-dasharray="5,4"/>`;
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
    const id=parseInt(idStr);
    const m=gm(id); if(!m) return;
    const isF=m.gender==='female';
    const hasCh=(m.childIds||[]).length>0;

    const div=document.createElement('div');
    div.className='node'+(selId===id?' sel':'');
    div.dataset.id=id;
    div.style.left=pos.x+'px';
    div.style.top =pos.y+'px';
    div.onclick=()=>nodeClick(id);
    if((m.parentIds||[]).length>0) attachNodeDrag(div, id);

    const collapsedHere = hasCh && collapsedSet.has(id);
    div.innerHTML=`
      <div class="node-card">
        ${hasCh?`<div class="exp-dot" title="${collapsedHere?'Expand':'Collapse'} branch" onclick="event.stopPropagation();toggleCollapse(${id})">${collapsedHere?'▶':'▼'}</div>`:''}
        <div class="node-photo${isF?' f':''}">${m.photo?`<img src="${m.photo}">`:(isF?'👩':'👨')}</div>
        <div class="node-name">${fn(m)}${m.deceased?' <span title="Deceased" style="opacity:.6;">✝</span>':''}</div>
      </div>`;
    inner.appendChild(div);
  });

  setTimeout(fitToScreen, 0);
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
  const set=new Set([...(m.childIds||[]), ...(sp?(sp.childIds||[]):[])] );
  return sortByOrder([...set]);
}

// ══════════════════════════════════════════════════════
//  LIST VIEW
// ══════════════════════════════════════════════════════
function renderList(){
  const q=(document.getElementById('srch').value||'').toLowerCase();
  const list=DB.members.filter(m=>fn(m).toLowerCase().includes(q));
  document.getElementById('listBody').innerHTML=list.length===0
    ?'<div class="text-center text-muted p-4">No members found</div>'
    :list.map(m=>{
      const isF=m.gender==='female';
      const rels=[];
      if(m.spouseId) rels.push('Married');
      if((m.childIds||[]).length) rels.push((m.childIds.length)+' child'+(m.childIds.length>1?'ren':''));
      if((m.parentIds||[]).length) rels.push('Parents recorded');
      return `<div class="list-item" onclick="nodeClick(${m.id})">
        <div class="list-av${isF?' f':''}">${m.photo?`<img src="${m.photo}">`:(isF?'👩':'👨')}</div>
        <div><div class="lname">${fn(m)}${m.deceased?' ✝':''}</div><div class="lrel">${rels.join(' · ')||'Member'}</div></div>
      </div>`;
    }).join('');
}

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
    { e:'💑', l:'Add Spouse',  fn:`addRel(${id},'spouse')`,  dis: hasSp },
    { e:'👶', l:'Add Child',   fn:`addRel(${id},'child')`,   dis: false },
    { e:'👨‍👩‍👧‍👦', l:'Add Multiple Children', fn:`openMultiChild(${id})`, dis: false },
    { e:'👦', l:'Add Brother', fn:`addRel(${id},'brother')`, dis: false },
    { e:'👧', l:'Add Sister',  fn:`addRel(${id},'sister')`,  dis: false },
    { e:'ℹ️', l:'View Info',   fn:`viewMember(${id})`,       dis: false },
    { e:'✏️', l:'Edit Info',   fn:`openEdit(${id})`,         dis: false },
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

function addRel(targetId, relType){
  clrForm();
  sf('mmId',''); sf('mmRel', targetId); sf('mmRelType', relType); sf('mmPersonId','');
  showReuseBox(true);
  showQaFamilyBox(false);
  document.getElementById('mmTitle').textContent='Add '+cap(relType);
  // Sensible gender pre-fill
  const tg=gm(targetId);
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
        addParent(nm, tgt);
      } else if(rt==='spouse'){
        // Link spouses
        tgt.spouseId=nm.id; nm.spouseId=tid;
        // New spouse inherits children
        nm.childIds=[...(tgt.childIds||[])];
        nm.childIds.forEach(cid=>{ const c=gm(cid); if(c&&!c.parentIds.includes(nm.id)) c.parentIds.push(nm.id); });
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
  if(curView==='tree') renderTree(); else renderList();
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
  child.parentIds.push(parent.id);
  // Also link to spouse
  if(parent.spouseId){
    const sp=gm(parent.spouseId);
    if(sp){ if(!sp.childIds.includes(child.id)) sp.childIds.push(child.id); child.parentIds.push(sp.id); }
  }
}

// ══════════════════════════════════════════════════════
//  ADD MULTIPLE CHILDREN AT ONCE
// ══════════════════════════════════════════════════════
let mcRowCount=0;
let mcPicked={}; // rowIdx -> full record of the existing person picked for that row
function openMultiChild(targetId){
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
  if(curView==='tree') renderTree(); else renderList();
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
  });
  DB.members=DB.members.filter(m=>m.id!==id);
  if(selId===id) selId=null;
  save(); closeM('rmModal'); showToast('Member removed');
  if(curView==='tree') renderTree(); else renderList();
}

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
  saveApp(); updateTreeBadge();
  setView('tree');
  showToast('Backup restored!');
}

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

// ══════════════════════════════════════════════════════
//  BOOT
// ══════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════
//  PAN & ZOOM (infinite canvas)
//  The tree canvas is no longer bound to a native scrollbar — it's a
//  freely draggable/zoomable layer, so you can pan around and zoom in
//  or out without hitting a hard edge. The ⛶ button snaps back to a
//  view that fits the whole tree on screen.
// ══════════════════════════════════════════════════════
let zoomScale=1, panX=0, panY=0;
let isPanning=false, panMoved=false, panStartX=0, panStartY=0, panOrigX=0, panOrigY=0;
let pinchStartDist=0, pinchStartScale=1;

function applyTransform(){
  const zl=document.getElementById('zoomLayer');
  if(zl) zl.style.transform='translate('+panX+'px,'+panY+'px) scale('+zoomScale+')';
}
function clampZoom(z){ return Math.min(2.5, Math.max(0.2, z)); }

function fitToScreen(){
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

  // Touch drag + pinch zoom
  wrap.addEventListener('touchstart', e=>{
    if(e.touches.length===1){
      isPanning=true; panMoved=false;
      panStartX=e.touches[0].clientX; panStartY=e.touches[0].clientY;
      panOrigX=panX; panOrigY=panY;
    } else if(e.touches.length===2){
      isPanning=false;
      pinchStartDist=touchDist(e.touches);
      pinchStartScale=zoomScale;
    }
  }, {passive:true});

  wrap.addEventListener('touchmove', e=>{
    if(e.touches.length===1 && isPanning){
      const dx=e.touches[0].clientX-panStartX, dy=e.touches[0].clientY-panStartY;
      if(Math.abs(dx)>6||Math.abs(dy)>6) panMoved=true;
      if(panMoved){ panX=panOrigX+dx; panY=panOrigY+dy; applyTransform(); }
    } else if(e.touches.length===2){
      const dist=touchDist(e.touches);
      if(pinchStartDist>0){ zoomScale=clampZoom(pinchStartScale*(dist/pinchStartDist)); applyTransform(); }
    }
  }, {passive:true});

  wrap.addEventListener('touchend', ()=>{ isPanning=false; });

  function touchDist(t){ const dx=t[0].clientX-t[1].clientX, dy=t[0].clientY-t[1].clientY; return Math.sqrt(dx*dx+dy*dy); }

  // Mouse wheel / trackpad zoom (desktop)
  wrap.addEventListener('wheel', e=>{
    e.preventDefault();
    zoomScale=clampZoom(zoomScale + (e.deltaY>0?-0.08:0.08));
    applyTransform();
  }, {passive:false});

  window.addEventListener('resize', ()=>{ if(curView==='tree') fitToScreen(); });
})();

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

// ══════════════════════════════════════════════════════
//  BOOT
// ══════════════════════════════════════════════════════
load();
renderTree();
