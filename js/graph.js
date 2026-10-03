// ══════════════════════════════════════════════════════
//  SOCIAL GRAPH VIEW (Network Graph Engine — Adaptive Family Spacing)
// ══════════════════════════════════════════════════════
var graphPanX = 0, graphPanY = 0, graphZoom = 1;
var graphNodesData = [];
var graphLinksData = [];
var graphDraggingId = null;

function renderGraph() {
  const container = document.getElementById('graphWrap');
  const svg = document.getElementById('graphSvg');
  const nodesDiv = document.getElementById('graphNodes');
  const emptyState = document.getElementById('graphEmptyState');

  if (!container || !svg || !nodesDiv) return;

  if (!DB || !DB.members || DB.members.length === 0) {
    if (emptyState) emptyState.style.display = 'flex';
    nodesDiv.innerHTML = '';
    svg.innerHTML = '';
    return;
  }
  if (emptyState) emptyState.style.display = 'none';

  const members = (typeof tempSubTreeHeadId !== 'undefined' && tempSubTreeHeadId !== null)
    ? DB.members.filter(m => getSubTreeMemberIds(tempSubTreeHeadId).has(m.id))
    : DB.members;
  const memberMap = new Map(members.map(m => [m.id, m]));

  // 1. Calculate true generation depth for each member via topological BFS
  const genMap = new Map();
  members.forEach(m => {
    const validParents = (m.parentIds || []).filter(pid => memberMap.has(pid));
    if (validParents.length === 0) genMap.set(m.id, 0);
  });

  let changed = true, guard = 0;
  while (changed && guard++ < 30) {
    changed = false;
    members.forEach(m => {
      const validParents = (m.parentIds || []).filter(pid => memberMap.has(pid));
      if (validParents.length > 0) {
        let maxPGen = -1;
        validParents.forEach(pid => {
          if (genMap.has(pid)) maxPGen = Math.max(maxPGen, genMap.get(pid));
        });
        if (maxPGen >= 0) {
          const newGen = maxPGen + 1;
          if (genMap.get(m.id) !== newGen) {
            genMap.set(m.id, newGen);
            changed = true;
          }
        }
      }
    });
  }

  // Ensure all spouses share the same generation rank
  members.forEach(m => {
    const g = genMap.get(m.id) || 0;
    const sps = mSpouses(m);
    sps.forEach(sp => {
      const spG = genMap.get(sp.id) || 0;
      const maxG = Math.max(g, spG);
      genMap.set(m.id, maxG);
      genMap.set(sp.id, maxG);
    });
  });

  // Calculate child count per member/couple
  const getEffectiveChildrenCount = (m) => {
    const c1 = (m.childIds || []).length;
    const sps = mSpouses(m);
    const c2 = sps.reduce((max, sp) => Math.max(max, (sp.childIds || []).length), 0);
    return Math.max(c1, c2);
  };

  // Group nodes by generation for initial horizontal layout
  const genGroups = new Map();
  members.forEach(m => {
    const g = genMap.get(m.id) || 0;
    if (!genGroups.has(g)) genGroups.set(g, []);
    genGroups.get(g).push(m);
  });

  graphNodesData = members.map((m) => {
    const g = genMap.get(m.id) || 0;
    const group = genGroups.get(g) || [m];
    const idxInGroup = group.indexOf(m);
    const chCount = getEffectiveChildrenCount(m);

    // Adaptive initial horizontal spacing: >2 children gets wider 260px gap, <=2 children gets optimal 170px gap
    let cumulativeX = 0;
    for (let i = 0; i < idxInGroup; i++) {
      const prevM = group[i];
      const prevCh = getEffectiveChildrenCount(prevM);
      cumulativeX += (prevCh > 2 || chCount > 2) ? 260 : 170;
    }

    const initialX = (window.innerWidth / 2) - (group.length * 170 / 2) + cumulativeX;
    const initialY = 130 + g * 240;

    return {
      id: m.id,
      member: m,
      gen: g,
      chCount: chCount,
      x: m._gx || initialX,
      y: m._gy || initialY,
      vx: 0,
      vy: 0
    };
  });

  const nodePosMap = new Map(graphNodesData.map(n => [n.id, n]));

  // 2. Build links: Spouses first, then Husband-Centered Parent-Child links
  graphLinksData = [];
  const linkSeen = new Set();

  // Spouses
  members.forEach(m => {
    const sps = mSpouses(m);
    sps.forEach(sp => {
      const key = [Math.min(m.id, sp.id), Math.max(m.id, sp.id)].join('-m-');
      if (!linkSeen.has(key)) {
        linkSeen.add(key);
        graphLinksData.push({ type: 'spouse', source: m.id, target: sp.id, dist: 140 });
      }
    });
  });

  // Parent-Child links: Pick Husband / Male Parent as primary source node if available
  members.forEach(c => {
    const validParents = (c.parentIds || []).map(pid => memberMap.get(pid)).filter(Boolean);
    
    if (validParents.length > 0) {
      const father = validParents.find(p => p.gender === 'male') || validParents[0];
      const pcKey = [father.id, c.id].join('-pc-');
      if (!linkSeen.has(pcKey)) {
        linkSeen.add(pcKey);
        graphLinksData.push({
          type: 'parent-child',
          source: father.id,
          target: c.id,
          dist: 200
        });
      }
    }
  });

  runGraphPhysics(nodePosMap, graphLinksData);

  nodesDiv.innerHTML = graphNodesData.map(n => {
    const m = n.member;
    const isF = m.gender === 'female';
    const isSel = selId === m.id;
    const spCount = mSpouses(m).length;
    const chCount = (m.childIds || []).length;
    return `<div class="graph-node${isF ? ' f' : ''}${isSel ? ' sel' : ''}" 
                 data-id="${m.id}" 
                 style="left:${n.x - 45}px;top:${n.y - 50}px;"
                 onmousedown="startGraphDrag(event, ${m.id})"
                 ontouchstart="startGraphDrag(event, ${m.id})"
                 onclick="nodeClick(${m.id})">
      <div class="graph-node-avatar${isF ? ' f' : ''}">
        ${m.photo ? `<img src="${m.photo}">` : (isF ? '👩' : '👨')}
      </div>
      <div class="graph-node-name">${fn(m)}</div>
      <div class="graph-node-badges">
        ${spCount > 0 ? `<span class="graph-badge" title="${spCount} spouse${spCount>1?'s':''}">💑${spCount>1?spCount:''}</span>` : ''}
        ${chCount > 0 ? `<span class="graph-badge" title="${chCount} children">👶${chCount}</span>` : ''}
      </div>
    </div>`;
  }).join('');

  drawGraphEdges(svg, nodePosMap, graphLinksData);
  initGraphPanZoom();
}

function runGraphPhysics(nodeMap, links) {
  const nodes = Array.from(nodeMap.values());
  const iterations = 100;

  for (let iter = 0; iter < iterations; iter++) {
    // Adaptive Repulsion: Families with >2 children get larger 560px repulsion, <=2 children get compact 360px repulsion
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const n1 = nodes[i];
        const n2 = nodes[j];
        const hasLargeFamily = (n1.chCount > 2 || n2.chCount > 2);
        const maxDist = hasLargeFamily ? 560 : 360;
        const kForce = hasLargeFamily ? 260 : 170;

        const dx = n2.x - n1.x || 1;
        const dy = n2.y - n1.y || 1;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        if (dist < maxDist) {
          const force = (kForce * kForce) / dist;
          const fx = (dx / dist) * force * 0.09;
          const fy = (dy / dist) * force * 0.05;
          n1.vx -= fx; n1.vy -= fy;
          n2.vx += fx; n2.vy += fy;
        }
      }
    }

    links.forEach(l => {
      const source = nodeMap.get(l.source);
      const target = nodeMap.get(l.target);
      if (!source || !target) return;
      const dx = target.x - source.x || 1;
      const dy = target.y - source.y || 1;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const force = (dist - l.dist) * 0.06;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      source.vx += fx; source.vy += fy;
      target.vx -= fx; target.vy -= fy;
    });

    nodes.forEach(n => {
      const targetY = 130 + n.gen * 240;
      n.vy += (targetY - n.y) * 0.08;

      n.vx *= 0.80;
      n.vy *= 0.80;
      n.x += n.vx;
      n.y += n.vy;
      n.member._gx = n.x;
      n.member._gy = n.y;
    });
  }
}

function getCardBorderPoint(sx, sy, tx, ty, hw = 48, hh = 52) {
  const dx = tx - sx;
  const dy = ty - sy;
  if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return { x: sx, y: sy };
  const scale = Math.min(hw / Math.abs(dx || 0.001), hh / Math.abs(dy || 0.001));
  return {
    x: sx + dx * scale,
    y: sy + dy * scale
  };
}

function drawGraphEdges(svg, nodeMap, links) {
  let html = `<defs>
    <marker id="graphArrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#9D4EDD" />
    </marker>
  </defs>`;

  links.forEach(l => {
    const s = nodeMap.get(l.source);
    const t = nodeMap.get(l.target);
    if (!s || !t) return;

    const pStart = getCardBorderPoint(s.x, s.y, t.x, t.y, 48, 52);
    const pEnd   = getCardBorderPoint(t.x, t.y, s.x, s.y, 48, 52);

    if (l.type === 'spouse') {
      const midX = (pStart.x + pEnd.x) / 2;
      const midY = (pStart.y + pEnd.y) / 2;
      html += `<line x1="${pStart.x}" y1="${pStart.y}" x2="${pEnd.x}" y2="${pEnd.y}" stroke="#e0aaff" stroke-width="5" stroke-dasharray="6,3" />`;
      html += `<line x1="${pStart.x}" y1="${pStart.y}" x2="${pEnd.x}" y2="${pEnd.y}" stroke="#7B2FBE" stroke-width="2.5" />`;
      html += `<circle cx="${midX}" cy="${midY}" r="11" fill="#fff" stroke="#7B2FBE" stroke-width="2" />`;
      html += `<text x="${midX}" y="${midY + 4}" font-size="11" text-anchor="middle">💍</text>`;
    } else if (l.type === 'parent-child') {
      const dx = pEnd.x - pStart.x;
      const dy = pEnd.y - pStart.y;
      const cx = (pStart.x + pEnd.x) / 2 - dy * 0.12;
      const cy = (pStart.y + pEnd.y) / 2 + dx * 0.12;

      // Midpoint of quadratic bezier curve for badge placement (t = 0.5)
      const midX = 0.25 * pStart.x + 0.5 * cx + 0.25 * pEnd.x;
      const midY = 0.25 * pStart.y + 0.5 * cy + 0.25 * pEnd.y;

      html += `<path d="M ${pStart.x} ${pStart.y} Q ${cx} ${cy} ${pEnd.x} ${pEnd.y}" stroke="#9D4EDD" stroke-width="2.5" fill="none" marker-end="url(#graphArrow)" opacity="0.85" />`;
      html += `<circle cx="${midX}" cy="${midY}" r="9" fill="#fff" stroke="#9D4EDD" stroke-width="1.5" />`;
      html += `<text x="${midX}" y="${midY + 3}" font-size="9" text-anchor="middle">👶</text>`;
    }
  });

  svg.innerHTML = html;
}

function startGraphDrag(e, id) {
  e.stopPropagation();
  graphDraggingId = id;
  const nodeEl = document.querySelector(`.graph-node[data-id="${id}"]`);
  if (nodeEl) nodeEl.classList.add('dragging');

  const onMove = (evt) => {
    if (!graphDraggingId) return;
    const clientX = evt.touches ? evt.touches[0].clientX : evt.clientX;
    const clientY = evt.touches ? evt.touches[0].clientY : evt.clientY;

    const wrap = document.getElementById('graphWrap');
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const nx = (clientX - rect.left - graphPanX) / graphZoom;
    const ny = (clientY - rect.top - graphPanY) / graphZoom;

    const n = graphNodesData.find(x => x.id === graphDraggingId);
    if (n) {
      n.x = nx; n.y = ny;
      n.member._gx = nx; n.member._gy = ny;
      const el = document.querySelector(`.graph-node[data-id="${n.id}"]`);
      if (el) {
        el.style.left = (nx - 45) + 'px';
        el.style.top = (ny - 50) + 'px';
      }
      const nodePosMap = new Map(graphNodesData.map(node => [node.id, node]));
      drawGraphEdges(document.getElementById('graphSvg'), nodePosMap, graphLinksData);
    }
  };

  const onEnd = () => {
    if (graphDraggingId) {
      const nodeEl = document.querySelector(`.graph-node[data-id="${graphDraggingId}"]`);
      if (nodeEl) nodeEl.classList.remove('dragging');
      graphDraggingId = null;
    }
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onEnd);
    window.removeEventListener('touchmove', onMove);
    window.removeEventListener('touchend', onEnd);
  };

  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onEnd);
  window.addEventListener('touchmove', onMove, { passive: true });
  window.addEventListener('touchend', onEnd);
}

function initGraphPanZoom() {
  const wrap = document.getElementById('graphWrap');
  if (!wrap || wrap._hasPanZoom) return;
  wrap._hasPanZoom = true;

  let isPan = false, startX = 0, startY = 0;

  wrap.addEventListener('mousedown', e => {
    if (e.target.closest('.graph-node')) return;
    isPan = true;
    startX = e.clientX - graphPanX;
    startY = e.clientY - graphPanY;
    wrap.style.cursor = 'grabbing';
  });

  window.addEventListener('mousemove', e => {
    if (!isPan) return;
    graphPanX = e.clientX - startX;
    graphPanY = e.clientY - startY;
    applyGraphTransform();
  });

  window.addEventListener('mouseup', () => {
    if (isPan) {
      isPan = false;
      wrap.style.cursor = 'grab';
    }
  });

  wrap.addEventListener('wheel', e => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
    const newZoom = Math.min(Math.max(graphZoom * zoomFactor, 0.3), 3.0);
    graphZoom = newZoom;
    applyGraphTransform();
  }, { passive: false });
}

function applyGraphTransform() {
  const layer = document.getElementById('graphZoomLayer');
  if (layer) {
    layer.style.transform = `translate(${graphPanX}px, ${graphPanY}px) scale(${graphZoom})`;
  }
}

function fitGraphToScreen() {
  if (!graphNodesData || graphNodesData.length === 0) return;

  const wrap = document.getElementById('graphWrap');
  if (!wrap) return;

  const rect = wrap.getBoundingClientRect();
  const W = rect.width || window.innerWidth;
  const H = rect.height || window.innerHeight;

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  graphNodesData.forEach(n => {
    if (n.x < minX) minX = n.x;
    if (n.x > maxX) maxX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.y > maxY) maxY = n.y;
  });

  const graphW = (maxX - minX) + 240;
  const graphH = (maxY - minY) + 260;

  const scaleX = W / graphW;
  const scaleY = H / graphH;
  graphZoom = Math.min(Math.max(Math.min(scaleX, scaleY), 0.25), 1.2);

  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;

  graphPanX = (W / 2) - midX * graphZoom;
  graphPanY = (H / 2) - midY * graphZoom;

  applyGraphTransform();
}
