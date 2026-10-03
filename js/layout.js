// ══════════════════════════════════════════════════════
//  TREE LAYOUT
//
//  Strategy:
//  1. Find the TRUE root generation (members with no parents in DB).
//  2. Build the tree TOP-DOWN: roots at top, children below them.
//  3. Each "unit" = member + optional spouse side-by-side.
//  4. Layout is recursive: measure widths bottom-up, place top-down.
//  5. SVG lines connect everything.
// ══════════════════════════════════════════════════════
const NW=90, NH=100, HGAP=18, SGAP=14, VGAP=64, PAD=30;
const PHW=140; // width of the collapsed "sub-family" placeholder card (wider than a normal node)

function renderTree(){
  const inner  = document.getElementById('innerWrap');
  const svg    = document.getElementById('treeSvg');
  const empty  = document.getElementById('emptyState');

  // Remove old nodes (keep SVG)
  Array.from(inner.querySelectorAll('.node, .spouse-tag-btn')).forEach(n=>n.remove());
  svg.innerHTML='';

  if(DB.members.length===0){
    empty.style.display='flex';
    inner.style.width='0'; inner.style.height='0';
    zoomScale=1; panX=0; panY=0; applyTransform();
    return;
  }
  empty.style.display='none';

  // Nodes whose children are hidden (collapsed branch)
  const collapsedSet = new Set(DB.collapsed||[]);
  const isCollapsed = (m, sp) => collapsedSet.has(headOf(m, sp).id); // husband/head controls the family
  const birthCollapsed = new Set((DB.collapsed||[]).filter(k=>typeof k==='string'&&k.startsWith('b:')).map(k=>parseInt(k.slice(2))));

  // ── 1. Identify root generation ──────────────────
  // Root = member whose parentIds are empty OR none of their parents exist in DB
  const allIds = new Set(DB.members.map(m=>m.id));

  let subTreeMemberIds = null;
  let subRootHeadId = null;
  let subRootSpouseId = null;
  if (typeof tempSubTreeHeadId !== 'undefined' && tempSubTreeHeadId !== null) {
    subTreeMemberIds = getSubTreeMemberIds(tempSubTreeHeadId);
    const headM = gm(tempSubTreeHeadId);
    if (headM) {
      const sp = mSpouse(headM);
      const rootH = headOf(headM, sp);
      const rootSp = rootH ? mSpouse(rootH) : null;
      subRootHeadId = rootH ? rootH.id : null;
      subRootSpouseId = rootSp ? rootSp.id : null;
    }
  }

  // A wife whose birth side is collapsed is treated as having no visible parents
  const isRoot = m => {
    if (subTreeMemberIds) {
      return m.id === subRootHeadId || (subRootSpouseId !== null && m.id === subRootSpouseId);
    }
    return !((m.parentIds||[]).some(pid=>allIds.has(pid)) && !birthCollapsed.has(m.id));
  };

  const membersToRender = subTreeMemberIds ? DB.members.filter(m => subTreeMemberIds.has(m.id)) : DB.members;

  // Collect unique root "heads" (ignore spouses of roots, they get placed alongside)
  const visited = new Set();
  const roots = membersToRender.filter(m=>{

    if(!isRoot(m)) return false;

    // If this member has no parents but their spouse does, the spouse's
    // ancestry is the real root of the couple. Rendering this member as
    // another root would split/duplicate the family tree.
    const sp = m.spouseId ? gm(m.spouseId) : null;
    const spouseHasParents = sp && !isRoot(sp);

    if(spouseHasParents) return false;

    // If both spouses are roots, render the couple only once.
    return !(sp && isRoot(sp) && sp.id < m.id);
  });

  // ── 2. Compute layout ────────────────────────────
  const positions = {};    // id → {x,y}
  const lines = [];        // SVG drawing instructions
  const placeholders = []; // collapsed+tagged sub-family cards to render instead of hidden descendants
  const spouseButtons = []; // the small 🏷️ tag/untag button sitting on each spouse connector

  // ── Wives whose birth-family side is collapsed ──
  // Everyone on her side (except her own couple + descendants) is hidden and
  // replaced by ONE placeholder card linked to her with a dashed line.
  function collectBlock(id, seen, out){
    const m=gm(id); if(!m || seen.has(id)) return;
    seen.add(id); out.push(id);
    const sp=mSpouse(m);
    if(sp && !seen.has(sp.id)){ seen.add(sp.id); out.push(sp.id); }
    uniqueChildren(m, sp).forEach(cid=>collectBlock(cid, seen, out));
  }
  const protect = new Set();
  const collapsedWives = DB.members.filter(w=>{
    const sp=mSpouse(w);
    return birthCollapsed.has(w.id) && sp && headOf(w,sp)!==w && hasBirthFamily(w);
  });
  collapsedWives.forEach(w=>{ protect.add(w.id); protect.add(mSpouse(w).id); });
  const hiddenGroups = collapsedWives.map(w=>{
    let top=w, guard=0;
    for(;;){
      const ps=(top.parentIds||[]).map(gm).filter(p=>p && !protect.has(p.id));
      if(!ps.length || guard++>50) break;
      top=ps.find(p=>hasBirthFamily(p)) || ps[0];
    }
    if(top===w) return null;
    const ids=[]; collectBlock(top.id, new Set(protect), ids);
    if(!ids.length) return null;
    const par=(w.parentIds||[]).map(gm).filter(Boolean);
    const father=par.find(p=>p.gender==='male') || par[0];
    const fsp=mSpouse(father);
    return { wId:w.id, set:new Set(ids), count:ids.length, placed:false, x:0,
             name: familyLabel(father, father.subFamily || (fsp&&fsp.subFamily)) };
  }).filter(Boolean);

  // Counts every distinct person (children, their spouses, grandchildren...)
  // hidden underneath a collapsed couple — used for the placeholder's
  // "N members" label. Ignores collapse state of nested branches, since
  // we want the TRUE total, not however much is currently expanded.
  function countDescendants(id, seen){
    const m=gm(id); if(!m || seen.has(id)) return 0;
    seen.add(id);
    let count=1;
    const sp=(m.spouseId&&gm(m.spouseId)&&gm(m.spouseId).spouseId===m.id)?gm(m.spouseId):null; // only trust MUTUAL spouse links
    if(sp && !seen.has(sp.id)){ seen.add(sp.id); count++; }
    uniqueChildren(m, sp).filter(cid=>!seen.has(cid)).forEach(cid=>{ count+=countDescendants(cid, seen); });
    return count;
  }
  function countHiddenDescendants(m, sp){
    const seen=new Set([m.id]); if(sp) seen.add(sp.id);
    let total=0;
    uniqueChildren(m, sp).forEach(cid=>{ total+=countDescendants(cid, seen); });
    return total;
  }

  // Measure the total pixel width a subtree rooted at `id` needs
    function measure(id, seen){
    if(seen.has(id)) return NW;
    seen.add(id);
    const m=gm(id); if(!m) return NW;
    const sps = mSpouses(m);
    sps.forEach(s => seen.add(s.id));
    const coupleW = NW * (1 + sps.length) + SGAP * sps.length;
    
    const childIds = uniqueChildren(m, sps[0]).filter(cid => !seen.has(cid) && gm(cid));
    const branchCollapsed = isCollapsed(m, sps[0]);
    if(branchCollapsed) return Math.max(coupleW, PHW);

    if(childIds.length===0) return coupleW;

    const childrenW = childIds.reduce((sum, cid, i) =>
      sum + measure(cid, new Set([...seen])) + (i > 0 ? HGAP : 0), 0);
    return Math.max(coupleW, childrenW);
  }

  // Place unit for `id` with top-left corner at (x, y). Returns {x,y} of couple centre.
    function place(id, x, y, seen){
    if(seen.has(id)) return null;
    seen.add(id);
    const m=gm(id); if(!m) return null;
    const sps = mSpouses(m);
    sps.forEach(s => seen.add(s.id));

    const coupleW = NW * (1 + sps.length) + SGAP * sps.length;
    const allKids = uniqueChildren(m, sps[0]).filter(cid => !seen.has(cid) && gm(cid));
    const branchCollapsed = isCollapsed(m, sps[0]);
    const tag = branchCollapsed ? { name: familyLabel(headOf(m, sps[0]), m.subFamily || (sps[0] && sps[0].subFamily)) } : null;
    const childIds = branchCollapsed ? [] : allKids;

    if(branchCollapsed) {
      const unitW = Math.max(coupleW, PHW);
      const phX = x + (unitW - PHW) / 2;
      const phY = y;
      const count = countHiddenDescendants(m, sps[0]) + 1 + sps.length;
      placeholders.push({ key: headOf(m, sps[0]).id, x: phX, y: phY, tag, count });
      
      positions[id] = { x: phX + (PHW-NW)/2, y: phY, isPlaceholder: true };
      sps.forEach(s => { positions[s.id] = { x: phX + (PHW-NW)/2, y: phY, isPlaceholder: true }; });
      return x + unitW/2;
    }

    let childrenW = 0;
    const childSeenClone = new Set([...seen]);
    childIds.forEach((cid, i) => {
      childrenW += measure(cid, new Set([...childSeenClone])) + (i > 0 ? HGAP : 0);
    });

    const unitW = Math.max(coupleW, childrenW);
    const coupleLeft = x + (unitW - coupleW) / 2;

    let membersToPlace = [m, ...sps];
    if (sps.length === 1 && m.gender === 'female' && sps[0].gender !== 'female') {
      membersToPlace = [sps[0], m];
    }

    membersToPlace.forEach((mem, idx) => {
      positions[mem.id] = { x: coupleLeft + idx * (NW + SGAP), y };
    });

    for (let i = 0; i < membersToPlace.length - 1; i++) {
      const memA = membersToPlace[i];
      const memB = membersToPlace[i + 1];
      const posXA = positions[memA.id].x;
      const midX = posXA + NW + SGAP / 2, midY = y + 38;
      lines.push({ type: 'spouse', x1: posXA + NW, x2: posXA + NW + SGAP, y: midY });
      spouseButtons.push({ x: midX, y: midY, aId: memA.id, bId: memB.id, tagged: !!(memA.subFamily || memB.subFamily) });
    }

    const coupleMidX = coupleLeft + coupleW / 2;

    if(childIds.length > 0){
      const childY = y + NH + VGAP;
      const childSeenPlace = new Set([...seen]);
      const childWidths = childIds.map(cid => measure(cid, new Set([...childSeenPlace])));
      const totalChildW = childWidths.reduce((s, w, i) => s + w + (i > 0 ? HGAP : 0), 0);
      let cx = x + (unitW - totalChildW) / 2;

      const childMidXs = [];
      childIds.forEach((cid, i) => {
        const result = place(cid, cx, childY, seen);
        const cm = gm(cid), csps = mSpouses(cm);
        const cCoupleW = NW * (1 + csps.length) + SGAP * csps.length;
        const cUnitW = childWidths[i];
        const cCoupleLeft = cx + (cUnitW - cCoupleW) / 2;
        childMidXs.push(cCoupleLeft + cCoupleW / 2);
        cx += childWidths[i] + HGAP;
      });

            lines.push({
        type: 'children',
        parentMidX: coupleMidX,
        parentBottomY: y + NH,
        childTopY: childY,
        childMidXs: childMidXs
      });
    }

    return coupleMidX;
  }

  // Place all root groups side by side
  let cx = PAD;
  const placedSeen = new Set();
  const addBirthPlaceholder = g=>{
    g.placed=true; g.x=cx;
    placeholders.push({ key:'b:'+g.wId, x:cx, y:PAD, tag:{name:g.name}, count:g.count });
    cx += PHW + HGAP*2;
  };
  roots.forEach(root=>{
    if(placedSeen.has(root.id)) return;
    // This root belongs to a collapsed birth-family side → one placeholder instead
    const grp=hiddenGroups.find(g=>g.set.has(root.id) || (root.spouseId && g.set.has(root.spouseId)));
    if(grp){ if(!grp.placed) addBirthPlaceholder(grp); return; }

    // Snapshot of who was already placed BEFORE this root — used below to
    // detect a child that belongs to this root but got placed by an
    // earlier root instead (this happens when that child is someone's
    // spouse, e.g. "Mom" was already placed next to "Dad" because they
    // are married — her own parents still need a connector line to her).
    const preSeen = new Set(placedSeen);

    const w = measure(root.id, new Set([...placedSeen]));
    place(root.id, cx, PAD, placedSeen);

    const rootPos = positions[root.id];
    if(rootPos && !isCollapsed(root, mSpouse(root))){
      const sp = root.spouseId ? gm(root.spouseId) : null;
      const coupleW = NW + (sp ? SGAP+NW : 0);
      const coupleMidX = rootPos.x + coupleW/2;
      uniqueChildren(root, sp).forEach(cid=>{
        // This child was already positioned by a previous root (a spouse
        // link) — draw a connector to their existing spot instead of
        // silently dropping the relationship.
        if(preSeen.has(cid) && positions[cid]){
          const cp=positions[cid];
          lines.push({ type:'inlaw', x1:coupleMidX, y1:rootPos.y+NH, x2:cp.x+NW/2, y2:cp.y });
        }
      });
    }

    cx += w + HGAP*2;
  });
  hiddenGroups.forEach(g=>{ if(!g.placed) addBirthPlaceholder(g); });
  // Dashed link from each birth-family placeholder to its wife
  hiddenGroups.forEach(g=>{
    const wp=positions[g.wId]; if(!wp) return;
    const x1=g.x+PHW/2, x2=wp.x+NW/2;
    if(wp.y>PAD+NH+10) lines.push({ type:'inlaw', x1, y1:PAD+NH, x2, y2:wp.y });
    else lines.push({ type:'above', x1, x2, y:PAD-16, y1:PAD, y2:wp.y });
  });

  // ── 3. Compute canvas size ───────────────────────
  let maxX=100, maxY=100;
  Object.values(positions).forEach(p=>{
    maxX=Math.max(maxX, p.x+NW+PAD);
    maxY=Math.max(maxY, p.y+NH+PAD);
  });
  placeholders.forEach(ph=>{ maxX=Math.max(maxX, ph.x+PHW+PAD); maxY=Math.max(maxY, ph.y+NH+PAD); });
  inner.style.width  = maxX+'px';
  inner.style.height = maxY+'px';
  svg.setAttribute('width',  maxX);
  svg.setAttribute('height', maxY);

  // ── 4. Draw SVG lines ────────────────────────────
  let svgContent='';
  lines.forEach(l=>{
    if(l.type==='spouse'){
      // Horizontal line between spouse cards. The little dot/tag button at
      // its centre is now a real clickable element (see spouseButtons
      // below), not drawn here.
      svgContent+=`<line x1="${l.x1}" y1="${l.y}" x2="${l.x2}" y2="${l.y}" stroke="#9D4EDD" stroke-width="2.5"/>`;
    } else if(l.type==='inlaw'){
      // Dashed elbow connecting a parent couple to their child who is
      // already positioned elsewhere (placed there via marriage).
      const midY = l.y1 + (l.y2 - l.y1)/2;
      svgContent+=`<line x1="${l.x1}" y1="${l.y1}" x2="${l.x1}" y2="${midY}" stroke="#9D4EDD" stroke-width="2.5" stroke-dasharray="5,4"/>`;
      svgContent+=`<line x1="${l.x1}" y1="${midY}" x2="${l.x2}" y2="${midY}" stroke="#9D4EDD" stroke-width="2.5" stroke-dasharray="5,4"/>`;
      svgContent+=`<line x1="${l.x2}" y1="${midY}" x2="${l.x2}" y2="${l.y2}" stroke="#9D4EDD" stroke-width="2.5" stroke-dasharray="5,4"/>`;
    } else if(l.type==='above'){
      svgContent+=`<line x1="${l.x1}" y1="${l.y1}" x2="${l.x1}" y2="${l.y}" stroke="#9D4EDD" stroke-width="2.5" stroke-dasharray="5,4"/>`;
      svgContent+=`<line x1="${l.x1}" y1="${l.y}" x2="${l.x2}" y2="${l.y}" stroke="#9D4EDD" stroke-width="2.5" stroke-dasharray="5,4"/>`;
      svgContent+=`<line x1="${l.x2}" y1="${l.y}" x2="${l.x2}" y2="${l.y2}" stroke="#9D4EDD" stroke-width="2.5" stroke-dasharray="5,4"/>`;
    } else if(l.type==='children'){
      const stemY    = l.parentBottomY + 10;
      const midY     = l.parentBottomY + VGAP/2;
      const childTopY= l.childTopY - 10;

      // Vertical stem down from parent couple centre
      svgContent+=`<line x1="${l.parentMidX}" y1="${stemY}" x2="${l.parentMidX}" y2="${midY}" stroke="#9D4EDD" stroke-width="2.5"/>`;

      if(l.childMidXs.length===1){
        // Single child: straight line
        const cx=l.childMidXs[0];
        svgContent+=`<line x1="${l.parentMidX}" y1="${midY}" x2="${cx}" y2="${midY}" stroke="#9D4EDD" stroke-width="2.5"/>`;
        svgContent+=`<line x1="${cx}" y1="${midY}" x2="${cx}" y2="${childTopY}" stroke="#9D4EDD" stroke-width="2.5"/>`;
      } else {
        // Horizontal bar spanning all children
        const leftX  = Math.min(...l.childMidXs);
        const rightX = Math.max(...l.childMidXs);
        svgContent+=`<line x1="${leftX}" y1="${midY}" x2="${rightX}" y2="${midY}" stroke="#9D4EDD" stroke-width="2.5"/>`;
        l.childMidXs.forEach(cx=>{
          svgContent+=`<line x1="${cx}" y1="${midY}" x2="${cx}" y2="${childTopY}" stroke="#9D4EDD" stroke-width="2.5"/>`;
        });
      }
    }
  });
  svg.innerHTML=svgContent;

  // ── 5. Render nodes ──────────────────────────────
  Object.entries(positions).forEach(([idStr,pos])=>{
    if(pos.isPlaceholder) return;
    const id=parseInt(idStr);
    const m=gm(id); if(!m) return;
    const isF=m.gender==='female';
    const nsp=mSpouse(m);
    const isHead=headOf(m,nsp)===m;
    // Husband (or a lone parent) controls the family's children; a wife only
    // gets a control if she has her own birth family — and it only affects that.
    const canCollapse=isHead && (uniqueChildren(m,nsp).some(c=>gm(c)) || nsp || m.subFamily);
    const hasBirth=!isHead && hasBirthFamily(m);
    const extSrc=(!isHead && !hasBirth) ? findBirthSource(m) : null;

    const div=document.createElement('div');
    div.className='node'+(selId===id?' sel':'');
    div.dataset.id=id;
    div.style.left=pos.x+'px';
    div.style.top =pos.y+'px';
    div.onclick=()=>nodeClick(id);
    if((m.parentIds||[]).length>0) attachNodeDrag(div, id);

    const collapsedHere = canCollapse && collapsedSet.has(id);
    const birthHere = hasBirth && birthCollapsed.has(id);

    // Only a woman born in THIS tree (has parents in this tree) triggers a daughter branch icon on her husband card
    const wifeInCouple = isF ? m : (nsp && nsp.gender === 'female' ? nsp : null);
    const isDaughterBornHere = wifeInCouple && (wifeInCouple.parentIds || []).some(pid => gm(pid));

    const daughterBranch = (isHead && isDaughterBornHere) ? (findDaughterBranchTree(m) || (nsp ? findDaughterBranchTree(nsp) : null)) : null;

    let branchHTML = '';
    if (daughterBranch) {
      branchHTML = `<div class="exp-dot branch" title="Open branched family tree &quot;${(daughterBranch.tree.name||'').replace(/"/g,'')}&quot;" onclick="event.stopPropagation();switchTree('${daughterBranch.tree.id}')">🌳</div>`;
    } else if (isDaughterBornHere && isHead && !canCollapse) {
      branchHTML = `<div class="exp-dot branch" title="Branch off family tree" onclick="event.stopPropagation();handleDaughterBranchClick(${id})">▼</div>`;
    }

    div.innerHTML=`
      <div class="node-card">
        ${canCollapse?`<div class="exp-dot" title="${collapsedHere?'Expand':'Collapse'} branch" onclick="event.stopPropagation();toggleCollapse(${id})">${collapsedHere?'▶':'▼'}</div>`:''}
        ${hasBirth?`<div class="exp-dot birth" title="${birthHere?'Expand':'Collapse'} her family side" onclick="event.stopPropagation();toggleCollapse('b:${id}')">${birthHere?'▶':'▲'}</div>`:''}
        ${extSrc?`<div class="exp-dot birth" title="Open her family side in &quot;${(extSrc.tree.name||'').replace(/"/g,'')}&quot;" onclick="event.stopPropagation();switchTree('${extSrc.tree.id}')">🌳</div>`:''}
        ${branchHTML}
        <div class="node-photo${isF?' f':''}">${m.photo?`<img src="${m.photo}">`:(isF?'👩':'👨')}</div>
        <div class="node-name">${fn(m)}${m.deceased?' <span title="Deceased" style="opacity:.6;">✝</span>':''}</div>
      </div>`;
    inner.appendChild(div);
  });

  // ── 6. Render spouse tag/untag buttons ───────────
  spouseButtons.forEach(sb=>{
    const btn=document.createElement('div');
    btn.className='spouse-tag-btn'+(sb.tagged?' tagged':'');
    btn.style.left=sb.x+'px';
    btn.style.top =sb.y+'px';
    btn.title=sb.tagged?'Edit sub-family tag':'Tag this couple as a sub-family';
    btn.textContent=sb.tagged?'🏷️':'';
    btn.onclick=(e)=>{ e.stopPropagation(); openSubFamily(sb.aId, sb.bId); };
    inner.appendChild(btn);
  });

  // ── 7. Render collapsed sub-family placeholder cards ─────────────
  placeholders.forEach(ph=>{
    const div=document.createElement('div');
    div.className='node';
    if(typeof ph.key === 'number') div.dataset.id = ph.key;
    div.style.left=ph.x+'px';
    div.style.top =ph.y+'px';
    div.style.width=PHW+'px';
    div.onclick=()=>{
      if(suppressNextNodeClick){ suppressNextNodeClick=false; return; }
      toggleCollapse(ph.key);
    };
    
    if(typeof ph.key === 'number') {
      const hm = gm(ph.key);
      if(hm && (hm.parentIds||[]).length > 0) attachNodeDrag(div, ph.key);
    }

    const isNumKey = typeof ph.key === 'number';

    div.innerHTML=`
      <div class="node-card placeholder-card d-flex flex-column align-items-center justify-content-center p-2 text-center" style="position:relative;">
        <div class="ph-icon">🏷️</div>
        <div class="ph-name fw-bold small text-truncate" style="max-width:100%;">${ph.tag.name}</div>
        <div class="ph-count text-muted" style="font-size:0.75rem;">${ph.count} member${ph.count!==1?'s':''}</div>
        <div class="d-flex gap-1 mt-2">
          <button class="btn btn-xs btn-primary rounded-pill px-2 py-0" style="font-size:0.7rem;" onclick="event.stopPropagation();toggleCollapse(${isNumKey ? ph.key : `'${ph.key}'`})">Expand</button>
          ${isNumKey ? `<button class="btn btn-xs btn-outline-primary rounded-pill px-2 py-0" style="font-size:0.7rem;" onclick="event.stopPropagation();viewSubTree(${ph.key})">👁️ View</button>` : ''}
        </div>
      </div>`;
    inner.appendChild(div);
  });
}

function sortByOrder(ids){
  return [...ids].sort((a,b)=>{
    const ma=gm(a), mb=gm(b);
    const oa=(ma&&ma.childOrder!=null)?ma.childOrder:9999;
    const ob=(mb&&mb.childOrder!=null)?mb.childOrder:9999;
    if(oa!==ob) return oa-ob;
    return a-b; // stable fallback: creation order
  });
}
function uniqueChildren(m, sp){
  const sps = mSpouses(m);
  const set = new Set(m.childIds || []);
  sps.forEach(s => (s.childIds || []).forEach(cid => set.add(cid)));
  if (sp && sp.childIds) sp.childIds.forEach(cid => set.add(cid));
  return sortByOrder([...set]);
}

