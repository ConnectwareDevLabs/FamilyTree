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


