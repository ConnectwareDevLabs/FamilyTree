// ══════════════════════════════════════════════════════
//  TREE SEARCH
// ══════════════════════════════════════════════════════
function onTreeSrchInput() {
  const q = (document.getElementById('treeSrch').value||'').toLowerCase().trim();
  const dd = document.getElementById('treeSrchDD');
  if(!dd) return;
  if(q.length < 2) { hideTreeSrchDD(); return; }
  
  const results = [];
  allTrees().forEach(t => {
    (t.members || []).forEach(m => {
      if (fn(m).toLowerCase().includes(q)) {
        results.push({ member: m, tree: t });
      }
    });
  });

  if(results.length === 0) {
    dd.innerHTML = '<div class="p-3 text-muted text-center" style="font-size:.9rem;">No matches across any trees</div>';
    dd.style.display = 'block';
    return;
  }
  
  dd.innerHTML = results.slice(0, 25).map(res => {
    const m = res.member;
    const t = res.tree;
    const isCurrent = t.id === APP.activeTreeId;
    const isF = m.gender === 'female';
    return `<div class="list-item" style="cursor:pointer;padding:10px 14px;border-bottom:1px solid #f0f0f0;" onclick="locateMemberCrossTree('${t.id}', ${m.id})">
      <div class="list-av${isF?' f':''}" style="width:36px;height:36px;font-size:1.2rem;">${m.photo?`<img src="${m.photo}">`:(isF?'👩':'👨')}</div>
      <div style="flex:1;min-width:0;margin-left:10px;">
        <div class="lname" style="font-size:.95rem;font-weight:600;">${fn(m)}${m.deceased?' ✝':''}</div>
        <div style="font-size:.78rem;color:#666;display:flex;gap:6px;align-items:center;margin-top:2px;">
          <span style="background:#f0e6ff;color:var(--p);padding:2px 8px;border-radius:10px;font-weight:600;">${t.name}</span>
          ${isCurrent ? '<span style="color:#28a745;font-weight:600;">• Active Tree</span>' : ''}
        </div>
      </div>
    </div>`;
  }).join('');
  dd.style.display = 'block';
}

function locateMemberCrossTree(treeId, memberId) {
  hideTreeSrchDD();
  const inp = document.getElementById('treeSrch');
  if (inp) inp.value = '';

  if (APP.activeTreeId !== treeId) {
    switchTree(treeId);
    setTimeout(() => {
      locateAndHighlightMember(memberId);
    }, 150);
  } else {
    locateAndHighlightMember(memberId);
  }
}

function hideTreeSrchDD() {
  const dd = document.getElementById('treeSrchDD');
  if(dd) dd.style.display = 'none';
}

function locateAndHighlightMember(id) {
  hideTreeSrchDD();
  const inp = document.getElementById('treeSrch');
  if(inp) inp.value = '';
  
  const wrap = document.getElementById('canvasWrap');
  if (!wrap) return;

  let el = document.querySelector(`.node[data-id="${id}"]`);
  
  if (!el && DB.collapsed && DB.collapsed.length > 0) {
    DB.collapsed = [];
    renderTree();
    el = document.querySelector(`.node[data-id="${id}"]`);
    showToast('Expanded branches to find member');
  }
  
  if (!el) {
    showToast('Member not found on canvas');
    return;
  }
  
  const targetX = parseFloat(el.style.left) + 45; // NW/2
  const targetY = parseFloat(el.style.top) + 50;  // NH/2
  
  panX = wrap.clientWidth/2 - targetX * zoomScale;
  panY = wrap.clientHeight/2 - targetY * zoomScale;
  applyTransform();
  
  const card = el.querySelector('.node-card');
  if(card) {
    card.classList.remove('highlight-blink');
    void card.offsetWidth;
    card.classList.add('highlight-blink');
    setTimeout(() => card.classList.remove('highlight-blink'), 3000);
  }
}

