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

