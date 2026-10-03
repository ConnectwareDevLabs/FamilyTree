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

