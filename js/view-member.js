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

