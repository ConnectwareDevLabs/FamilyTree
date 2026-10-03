// ══════════════════════════════════════════════════════
//  AUTH & SSO & PROFILE LINKING & INVITATIONS
// ══════════════════════════════════════════════════════
var currentUser = null;
var activeInviteToken = null;
var activeInviteDetails = null;

function initAuth() {
  const saved = localStorage.getItem('familyroot_auth');
  if (saved) {
    try {
      currentUser = JSON.parse(saved);
      updateAuthUI();
    } catch(e) { currentUser = null; }
  } else {
    updateAuthUI();
  }

  // Check URL parameters for Invite Token (?inviteToken=inv_...)
  const urlParams = new URLSearchParams(window.location.search);
  const token = urlParams.get('inviteToken');
  if (token) {
    checkInviteToken(token);
  }
}

function updateAuthUI() {
  const btn = document.getElementById('authUserBtn');
  const wrap = document.getElementById('authUserWrap');
  const nameEl = document.getElementById('authUserName');
  const emailEl = document.getElementById('authUserEmail');
  const avatarEl = document.getElementById('authAvatar');

  if (currentUser) {
    if (btn) btn.style.display = 'none';
    if (wrap) wrap.style.display = 'inline-block';
    if (nameEl) nameEl.textContent = currentUser.name || 'User';
    if (emailEl) emailEl.textContent = currentUser.email || '';
    if (avatarEl) avatarEl.textContent = currentUser.avatar || '👤';
  } else {
    if (btn) btn.style.display = 'inline-block';
    if (wrap) wrap.style.display = 'none';
  }
}

function openLoginModal() {
  getM('loginModal').show();
}

async function handleSSOLogin(provider) {
  const mockNames = {
    Google: 'Vikya Rao',
    Microsoft: 'Vikyath K. Rao',
    Apple: 'Vikyath Rao'
  };
  const mockEmails = {
    Google: 'vikyath.rao@gmail.com',
    Microsoft: 'vikyath.rao@outlook.com',
    Apple: 'vikyath.rao@apple.com'
  };

  const name = mockNames[provider] || 'Family Member';
  const email = mockEmails[provider] || 'user@example.com';
  const avatar = provider === 'Google' ? '🌐' : (provider === 'Microsoft' ? '💼' : '🍎');

  currentUser = {
    provider: provider,
    name: name,
    email: email,
    avatar: avatar
  };

  localStorage.setItem('familyroot_auth', JSON.stringify(currentUser));
  updateAuthUI();
  closeM('loginModal');

  // Sync with Cloudflare Workers API if available
  if (typeof API !== 'undefined') {
    try {
      const res = await API.loginSSO(name, email, provider, avatar);
      if (res && res.user) {
        currentUser.id = res.user.id;
        localStorage.setItem('familyroot_auth', JSON.stringify(currentUser));
      }
    } catch (err) {}
  }

  showToast(`Signed in with ${provider}!`);

  if (activeInviteToken) {
    executeClaimInvite();
  } else {
    setTimeout(openLinkMemberModal, 350);
  }
}

async function handleEmailLogin(e) {
  if (e) e.preventDefault();
  const email = document.getElementById('loginEmailInput').value.trim();
  const name = document.getElementById('loginNameInput').value.trim();

  if (!email || !name) {
    showToast('Please provide both name and email');
    return;
  }

  currentUser = {
    provider: 'Email',
    name: name,
    email: email,
    avatar: '👤'
  };

  localStorage.setItem('familyroot_auth', JSON.stringify(currentUser));
  updateAuthUI();
  closeM('loginModal');

  if (typeof API !== 'undefined') {
    try {
      const res = await API.loginSSO(name, email, 'Email');
      if (res && res.user) {
        currentUser.id = res.user.id;
        localStorage.setItem('familyroot_auth', JSON.stringify(currentUser));
      }
    } catch (err) {}
  }

  showToast(`Signed in as ${name}!`);

  if (activeInviteToken) {
    executeClaimInvite();
  } else {
    setTimeout(openLinkMemberModal, 350);
  }
}

// ══════════════════════════════════════════════════════
//  MEMBER INVITATION & PROFILE CLAIMING ENGINE
// ══════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════
//  MEMBER INVITATION & PROFILE CLAIMING ENGINE (STABLE LOCAL MODE)
// ══════════════════════════════════════════════════════
async function checkInviteToken(token) {
  activeInviteToken = token;
  try {
    const raw = atob(token);
    const details = JSON.parse(raw);
    if (details && details.memberId) {
      activeInviteDetails = {
        valid: true,
        treeName: details.treeName || 'Family Tree',
        inviterName: details.inviterName || 'A family member',
        targetMemberName: details.memberName || 'Member',
        treeId: details.treeId,
        memberId: details.memberId,
        assignedRole: 'editor'
      };
      showClaimInviteModal(activeInviteDetails);
      return;
    }
  } catch (e) {}

  if (typeof API !== 'undefined') {
    try {
      const res = await API.validateInviteToken(token);
      if (res.valid) {
        activeInviteDetails = res;
        showClaimInviteModal(res);
      }
    } catch (err) {}
  }
}

function showClaimInviteModal(details) {
  const modalEl = document.getElementById('claimInviteModal');
  if (!modalEl) return;

  const treeEl = document.getElementById('inviteTreeName');
  const memberEl = document.getElementById('inviteMemberName');
  const roleEl = document.getElementById('inviteRoleBadge');

  if (treeEl) treeEl.textContent = details.treeName || 'Family Tree';
  if (memberEl) memberEl.textContent = details.targetMemberName || 'your member card';
  if (roleEl) roleEl.textContent = (details.assignedRole || 'editor').toUpperCase();

  getM('claimInviteModal').show();
}

function confirmClaimInvite() {
  if (!currentUser) {
    openLoginModal();
    showToast('Please sign in or create an account to accept invitation');
    return;
  }
  executeClaimInvite();
}

async function executeClaimInvite() {
  if (!activeInviteDetails) {
    closeM('claimInviteModal');
    return;
  }

  if (!currentUser) {
    openLoginModal();
    showToast('Please sign in to accept the family tree invitation');
    return;
  }

  const details = activeInviteDetails;
  showToast(`Profile claimed! Linked to ${details.targetMemberName}`);
  closeM('claimInviteModal');

  currentUser.linkedTreeId = details.treeId;
  currentUser.linkedMemberId = details.memberId;
  localStorage.setItem('familyroot_auth', JSON.stringify(currentUser));

  if (details.treeId && typeof switchTree === 'function' && APP.trees[details.treeId]) {
    switchTree(details.treeId);
  }
  activeInviteToken = null;
  activeInviteDetails = null;
}

async function generateMemberInvite(memberId) {
  const m = gm(memberId);
  if (!m) return;

  const email = m.email || (currentUser ? currentUser.email : '');

  const invitePayload = {
    treeId: APP.activeTreeId,
    treeName: DB ? DB.name : 'Family Tree',
    memberId: memberId,
    memberName: fn(m),
    inviterName: currentUser ? currentUser.name : 'Family Member',
    email: email,
    ts: Date.now()
  };

  const token = btoa(JSON.stringify(invitePayload));
  const inviteUrl = window.location.origin + window.location.pathname + '?inviteToken=' + encodeURIComponent(token);

  if (navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      showToast(`Invite link copied to clipboard for ${fn(m)}!`);
      return;
    } catch (e) {}
  }

  showToast(`Invite link created for ${fn(m)}!`);
}

function openLinkMemberModal() {
  if (!currentUser) {
    openLoginModal();
    return;
  }

  const badge = document.getElementById('linkUserEmailBadge');
  if (badge) badge.textContent = currentUser.email;

  const treeSel = document.getElementById('linkTreeSel');
  if (treeSel) {
    const trees = allTrees();
    treeSel.innerHTML = trees.map(t => `<option value="${t.id}" ${t.id === APP.activeTreeId ? 'selected' : ''}>${t.name} (${(t.members||[]).length} members)</option>`).join('');
  }

  const input = document.getElementById('linkMemberInput');
  const hidden = document.getElementById('linkMemberIdHidden');
  if (input) input.value = '';
  if (hidden) hidden.value = '';

  if (currentUser.linkedMemberId && currentUser.linkedTreeId) {
    const targetTree = APP.trees[currentUser.linkedTreeId] || DB;
    const m = (targetTree.members || []).find(x => x.id === currentUser.linkedMemberId);
    if (m && input && hidden) {
      input.value = fn(m);
      hidden.value = m.id;
    }
  }

  getM('linkMemberModal').show();
}

function onLinkMemberSearchInput() {
  const treeSel = document.getElementById('linkTreeSel');
  const input = document.getElementById('linkMemberInput');
  const dd = document.getElementById('linkMemberSuggestionsDD');

  if (!treeSel || !input || !dd) return;

  const q = input.value.toLowerCase().trim();

  // ONLY visible when typing (q.length > 0)
  if (!q || q.length === 0) {
    dd.style.display = 'none';
    dd.innerHTML = '';
    return;
  }

  const treeId = treeSel.value;
  const targetTree = APP.trees[treeId] || DB;
  const members = targetTree.members || [];

  const matches = members.filter(m => fn(m).toLowerCase().includes(q));

  if (matches.length === 0) {
    dd.innerHTML = '<div class="p-3 text-muted text-center small">No members match your search</div>';
    dd.style.display = 'block';
    return;
  }

  dd.innerHTML = matches.map(m => {
    const isF = m.gender === 'female';
    const escapedName = fn(m).replace(/'/g, "\\'");
    return `<div class="d-flex align-items-center gap-2 p-2 border-bottom hover-bg-light" style="cursor:pointer;" onclick="selectLinkMemberSuggestion(${m.id}, '${escapedName}')">
      <div class="rounded-circle d-flex align-items-center justify-content-center" style="width:32px;height:32px;background:${isF?'#fce4ec':'#ede7f6'};overflow:hidden;flex-shrink:0;">
        ${m.photo ? `<img src="${m.photo}" style="width:100%;height:100%;object-fit:cover;">` : (isF ? '👩' : '👨')}
      </div>
      <div style="flex:1;min-width:0;">
        <div class="fw-semibold text-dark small" style="line-height:1.2;">${fn(m)}</div>
        <div class="text-muted" style="font-size:0.75rem;">${m.email ? `📧 ${m.email}` : 'No email listed'}</div>
      </div>
    </div>`;
  }).join('');

  dd.style.display = 'block';
}

function selectLinkMemberSuggestion(id, name) {
  const input = document.getElementById('linkMemberInput');
  const hidden = document.getElementById('linkMemberIdHidden');
  const dd = document.getElementById('linkMemberSuggestionsDD');

  if (input) input.value = name;
  if (hidden) hidden.value = id;
  if (dd) dd.style.display = 'none';
}

function hideLinkMemberSuggestions() {
  const dd = document.getElementById('linkMemberSuggestionsDD');
  if (dd) dd.style.display = 'none';
}

function confirmLinkMember() {
  if (!currentUser) return;

  const treeSel = document.getElementById('linkTreeSel');
  const hidden = document.getElementById('linkMemberIdHidden');
  const input = document.getElementById('linkMemberInput');

  if (!treeSel || !input) return;

  const selectedTreeId = treeSel.value;
  let selectedMemberId = parseInt(hidden ? hidden.value : '');

  const targetTree = APP.trees[selectedTreeId];
  if (!targetTree) return;

  const members = targetTree.members || [];

  if (isNaN(selectedMemberId) && input.value.trim()) {
    const typedName = input.value.trim().toLowerCase();
    const matched = members.find(x => fn(x).toLowerCase() === typedName || x.firstName.toLowerCase() === typedName);
    if (matched) selectedMemberId = matched.id;
  }

  if (isNaN(selectedMemberId)) {
    showToast('Please select a valid member profile from suggestions');
    return;
  }

  const m = members.find(x => x.id === selectedMemberId);
  if (!m) {
    showToast('Selected member not found');
    return;
  }

  m.email = currentUser.email;

  if (m.personId && typeof syncPersonEverywhere === 'function') {
    syncPersonEverywhere(m.personId, { email: currentUser.email });
  }

  currentUser.linkedTreeId = selectedTreeId;
  currentUser.linkedMemberId = m.id;
  localStorage.setItem('familyroot_auth', JSON.stringify(currentUser));

  switchTree(selectedTreeId);
  save();
  closeM('linkMemberModal');
  showToast(`Profile linked to ${fn(m)}! Email updated to ${currentUser.email}`);
}

function logoutUser() {
  currentUser = null;
  localStorage.removeItem('familyroot_auth');
  updateAuthUI();
  showToast('Signed out');
}
