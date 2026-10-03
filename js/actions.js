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

