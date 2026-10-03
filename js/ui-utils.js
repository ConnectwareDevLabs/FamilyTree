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

