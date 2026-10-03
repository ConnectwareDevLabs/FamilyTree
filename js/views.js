// ══════════════════════════════════════════════════════
//  VIEWS & NAVIGATION
// ══════════════════════════════════════════════════════
var tempSubTreeHeadId = null;

function getSubTreeMemberIds(headId) {
  const head = gm(headId);
  if (!head) return new Set();
  const subIds = new Set();

  function collect(mId) {
    const m = gm(mId);
    if (!m || subIds.has(mId)) return;
    subIds.add(mId);
    
    // add mutual spouses
    const sps = mSpouses(m);
    sps.forEach(sp => {
      if (!subIds.has(sp.id)) {
        subIds.add(sp.id);
      }
    });

    // add children
    const kids = uniqueChildren(m, sps[0]);
    kids.forEach(kId => collect(kId));
  }

  collect(headId);
  return subIds;
}

function viewSubTree(headId) {
  tempSubTreeHeadId = headId;
  const m = gm(headId);
  const sp = m ? mSpouse(m) : null;
  const tag = m ? (m.subFamily || (sp && sp.subFamily)) : null;
  const name = (tag && tag.name) ? tag.name : (m ? familyLabel(headOf(m, sp), tag) : 'Sub-Tree');

  updateSubTreeBanner(name);
  if (typeof closeM === 'function') closeM('subFamilyModal');
  if (typeof closeM === 'function') closeM('actModal');

  if (curView === 'tree') {
    renderTree();
    setTimeout(fitToScreen, 0);
  } else if (curView === 'graph') {
    renderGraph();
    setTimeout(fitGraphToScreen, 50);
  } else {
    renderList();
  }

  showToast('Viewing isolated sub-tree: ' + name);
}

function clearSubTree() {
  if (!tempSubTreeHeadId) return;
  tempSubTreeHeadId = null;
  updateSubTreeBanner(null);

  if (curView === 'tree') {
    renderTree();
    setTimeout(fitToScreen, 0);
  } else if (curView === 'graph') {
    renderGraph();
    setTimeout(fitGraphToScreen, 50);
  } else {
    renderList();
  }

  showToast('Returned to full family tree view');
}

function updateSubTreeBanner(title) {
  let banner = document.getElementById('subTreeBanner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'subTreeBanner';
    banner.style.cssText = 'position:fixed;top:56px;left:0;right:0;z-index:999;background:linear-gradient(90deg,#7b2fbe,#9d4edd);color:#fff;box-shadow:0 2px 8px rgba(0,0,0,0.15);display:none;align-items:center;justify-content:space-between;padding:8px 16px;font-size:0.9rem;';
    document.body.appendChild(banner);
  }

  if (title) {
    banner.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="font-size:1.1rem;">👁️</span>
        <span>Viewing isolated sub-tree: <strong>${title}</strong></span>
      </div>
      <button class="btn btn-sm btn-light rounded-pill px-3 fw-semibold text-primary" onclick="clearSubTree()">Exit Sub-Tree View ✕</button>
    `;
    banner.style.display = 'flex';
  } else {
    banner.style.display = 'none';
  }
}

function viewSubTreeFromModal() {
  const aIdRaw = document.getElementById('sfCoupleA').value;
  if (!aIdRaw) return;
  const aId = parseInt(aIdRaw);
  viewSubTree(aId);
}
function setView(v){
  curView = v;
  const canvasWrap = document.getElementById('canvasWrap');
  const graphWrap  = document.getElementById('graphWrap');
  const listView   = document.getElementById('listView');
  const treeSrch   = document.getElementById('treeSearchWrap');

  if(canvasWrap) canvasWrap.style.display = (v==='tree') ? 'block' : 'none';
  if(graphWrap)  graphWrap.style.display  = (v==='graph') ? 'block' : 'none';
  if(listView)   listView.style.display   = (v==='list') ? 'block' : 'none';
  if(treeSrch)   treeSrch.style.display   = (v==='tree' || v==='graph') ? 'block' : 'none';

  const pills = document.querySelectorAll('.view-pill');
  pills.forEach(p => {
    p.classList.toggle('active', p.dataset.view === v);
  });

  if(v==='tree') {
    renderTree();
    setTimeout(fitToScreen, 0);
  } else if(v==='graph') {
    renderGraph(); setTimeout(fitGraphToScreen, 50);
  } else {
    renderList();
  }
}

function toggleView(){
  if(curView === 'tree') setView('graph');
  else if(curView === 'graph') setView('list');
  else setView('tree');
}
