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

