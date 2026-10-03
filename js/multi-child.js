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

