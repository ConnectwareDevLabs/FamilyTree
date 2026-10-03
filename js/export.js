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

