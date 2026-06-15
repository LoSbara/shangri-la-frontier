// ── Config ────────────────────────────────────────────────────────────────────
const API = 'http://localhost:3000/api';

// ── State ─────────────────────────────────────────────────────────────────────
let busy = false;
let currentState = null; // snapshot per i modal

// ── DOM ───────────────────────────────────────────────────────────────────────
const chatMessages   = document.getElementById('chat-messages');
const chatInput      = document.getElementById('chat-input');
const sendBtn        = document.getElementById('send-btn');
const resetBtn       = document.getElementById('reset-btn');
const openStatsModal = document.getElementById('open-stats-modal');
const statPointsBox  = document.getElementById('stat-points-box');
const openSkillsModal= document.getElementById('open-skills-modal');

marked.setOptions({ breaks: true });

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  addSystemMsg('Connessione al server in corso…');
  try {
    const state = await apiFetch('/state');
    currentState = state;
    updateUI(state);

    if (!state.profile.name) {
      clearSystemMsgs();
      await sendToGM('Inizia il gioco.');
    } else {
      clearSystemMsgs();
      // Ricarica la chat history dal session_log
      const log = state.gameState.session_log || [];
      const SKIP = new Set(['Inizia il gioco.']);
      log.forEach(({ role, content }) => {
        if (role === 'user' && !SKIP.has(content)) addPlayerMsg(content, true);
        else if (role === 'assistant') addGMMsg(content, true);
      });
      if (log.length) {
        addSystemMsg('— sessione precedente caricata —');
        scrollBottom();
      }
      enableInput();
    }
  } catch {
    clearSystemMsgs();
    addSystemMsg('⚠ Impossibile connettersi al server. Assicurati che sia in esecuzione su porta 3000.');
  }
}

// ── API ───────────────────────────────────────────────────────────────────────
async function apiFetch(path, opts = {}) {
  const res = await fetch(API + path, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw Object.assign(new Error(err.error || 'Errore server'), { status: res.status });
  }
  return res.json();
}

async function sendToGM(message) {
  if (busy) return;
  busy = true;
  disableInput();
  const typingEl = addTyping();
  try {
    const data = await apiFetch('/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    typingEl.remove();
    addGMMsg(data.narrative);
    currentState = data.state;
    updateUI(data.state);
    if (data.ui_events?.includes('level_up')) showLevelUp(data.state.profile.level);
  } catch (e) {
    typingEl.remove();
    addSystemMsg(`⚠ ${e.message}`);
  } finally {
    busy = false;
    enableInput();
  }
}

// ── Handle Send ───────────────────────────────────────────────────────────────
async function handleSend() {
  const text = chatInput.value.trim();
  if (!text || busy) return;
  chatInput.value = '';
  addPlayerMsg(text);
  await sendToGM(text);
}

sendBtn.addEventListener('click', handleSend);
chatInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
});

resetBtn.addEventListener('click', async () => {
  if (!confirm('Vuoi davvero iniziare una nuova partita? Tutti i progressi saranno cancellati.')) return;
  try {
    await apiFetch('/reset', { method: 'POST' });
    chatMessages.innerHTML = '';
    currentState = null;
    addSystemMsg('Nuova partita avviata…');
    await sendToGM('Inizia il gioco.');
  } catch (e) {
    addSystemMsg(`⚠ ${e.message}`);
  }
});

// ── UI Update ─────────────────────────────────────────────────────────────────
function updateUI({ profile, inventory, skills, gameState: gs }) {
  if (!profile) return;

  // Header
  document.getElementById('player-name').textContent  = profile.name || '—';
  document.getElementById('player-job').textContent   = profile.job  || '?';
  document.getElementById('player-level').textContent = `Lv.${profile.level}`;
  document.getElementById('player-money').textContent = `${profile.money} R`;

  // Bars
  setBar('hp',  profile.stats.HP.current,  profile.stats.HP.max);
  setBar('mp',  profile.stats.MP.current,  profile.stats.MP.max);
  setBar('stm', profile.stats.STM.current, profile.stats.STM.max);
  setBar('exp', profile.experience,        profile.experience_to_next);

  // Low HP
  document.getElementById('res-hp')
    .classList.toggle('res-low', profile.stats.HP.current / profile.stats.HP.max < 0.25);

  // Stats
  const bon = inventory.stat_bonuses_from_equipment || {};
  for (const s of ['STR','DEX','AGI','TEC','VIT','LUC']) {
    const el = document.getElementById(`sv-${s}`);
    if (!el) continue;
    const total = (profile.stats[s] || 0) + (bon[s] || 0);
    el.textContent = total;
    el.style.color = bon[s] > 0 ? 'var(--stm)' : 'var(--text-bright)';
  }

  // Punti stat
  const pts = profile.stat_points_available || 0;
  document.getElementById('stat-points-box').classList.toggle('hidden', pts === 0);
  document.getElementById('stat-points-count').textContent = pts;
  openStatsModal.classList.toggle('hidden', pts === 0);

  // Location
  const inCombat = gs.combat_active;
  const locEl = document.getElementById('location-text');
  locEl.textContent = (inCombat ? '⚔ ' : '🏙 ') + (gs.location || '—');
  locEl.classList.toggle('in-combat', inCombat);

  // Quests
  const quests = gs.quests_active || [];
  const qSec = document.getElementById('quest-section');
  qSec.style.display = quests.length ? '' : 'none';
  document.getElementById('quest-list').innerHTML =
    quests.map(q => `<div class="quest-item">${q}</div>`).join('');

  // Combat panel
  renderEnemy(inCombat ? gs.current_enemy : null);

  // Right panel
  renderEquipment(inventory.equipped || {});
  renderSkills(gs.skill_loadout || [], profile.skill_slots || 4);
  renderBag(inventory.bag || []);
}

function setBar(name, current, max) {
  const fill = document.getElementById(`bar-${name}`);
  const val  = document.getElementById(`${name}-val`);
  if (!fill || !val) return;
  const pct = max > 0 ? Math.max(0, Math.min(100, (current / max) * 100)) : 0;
  fill.style.width = pct + '%';
  val.textContent = `${current}/${max}`;
}

// ── Enemy Panel ───────────────────────────────────────────────────────────────
function renderEnemy(enemy) {
  const panel = document.getElementById('combat-panel');
  if (!enemy) { panel.classList.add('hidden'); return; }
  panel.classList.remove('hidden');

  document.getElementById('enemy-name').textContent = enemy.name || '?';
  document.getElementById('enemy-tier').textContent = `Tier ${enemy.tier || '?'}`;

  const hpCur = enemy.hp?.current ?? 0;
  const hpMax = enemy.hp?.max ?? 1;
  const pct   = Math.max(0, Math.min(100, (hpCur / hpMax) * 100));
  document.getElementById('bar-enemy-hp').style.width = pct + '%';
  document.getElementById('enemy-hp-val').textContent = `${hpCur}/${hpMax}`;

  const details = document.getElementById('enemy-details');
  if (enemy.revealed) {
    const weakTags = (enemy.weaknesses || [])
      .map(w => `<span class="weakness-tag">${w}</span>`).join('');
    details.innerHTML = `
      <div>STR ${enemy.stats?.STR ?? '?'} | AGI ${enemy.stats?.AGI ?? '?'} | Res. ${enemy.stats?.resistenza ?? 0}%</div>
      ${weakTags ? `<div style="margin-top:4px">${weakTags}</div>` : ''}`;
  } else {
    details.innerHTML = '<div><em>non analizzato</em></div>';
  }
}

// ── Equipment ─────────────────────────────────────────────────────────────────
const SLOT_LABELS = {
  weapon:'ARMA', offhand:'SEC.', head:'TESTA', chest:'TORSO',
  legs:'GAMBE', boots:'STIV.', accessory_1:'ACC.1', accessory_2:'ACC.2',
};

function renderEquipment(equipped) {
  document.getElementById('equipment-slots').innerHTML =
    Object.entries(SLOT_LABELS).map(([key, label]) => {
      const item = equipped[key];
      return `<div class="equip-slot">
        <span class="equip-slot-name">${label}</span>
        ${item
          ? `<span class="equip-slot-item">${item.name}</span>`
          : `<span class="equip-slot-empty">vuoto</span>`}
      </div>`;
    }).join('');
}

// ── Skills ────────────────────────────────────────────────────────────────────
function renderSkills(loadout, maxSlots) {
  const cards = loadout.map(sk => {
    const costStr = Object.entries(sk.cost || {}).map(([k,v]) => `${k}:${v}`).join('  ');
    return `<div class="skill-card">
      <div class="skill-card-name">${sk.name}</div>
      <div class="skill-card-cost">${costStr}</div>
      ${sk.effect ? `<div class="skill-card-effect">${sk.effect}</div>` : ''}
    </div>`;
  });
  const emptyCount = Math.max(0, maxSlots - loadout.length);
  for (let i = 0; i < emptyCount; i++) cards.push(`<div class="skill-slot-empty">slot vuoto</div>`);
  document.getElementById('skill-slots').innerHTML = cards.join('');
}

// ── Bag ───────────────────────────────────────────────────────────────────────
function renderBag(bag) {
  const el = document.getElementById('bag-list');
  if (!bag.length) { el.innerHTML = '<div class="bag-empty">borsa vuota</div>'; return; }
  el.innerHTML = bag.map(item => {
    const name = item.name || item;
    const qty  = item.quantity;
    return `<div class="bag-item"><span>${name}</span>${qty > 1 ? `<span class="bag-item-qty">×${qty}</span>` : ''}</div>`;
  }).join('');
}

// ── Chat Messages ─────────────────────────────────────────────────────────────
function addGMMsg(narrative, isHistory = false) {
  const div = document.createElement('div');
  div.className = `message msg-gm${isHistory ? ' history' : ''}`;
  div.innerHTML = `<div class="msg-label">GM — SHANGRI-LA FRONTIER</div><div>${marked.parse(narrative)}</div>`;
  chatMessages.appendChild(div);
  scrollBottom();
}

function addPlayerMsg(text, isHistory = false) {
  const div = document.createElement('div');
  div.className = `message msg-player${isHistory ? ' history' : ''}`;
  div.textContent = text;
  chatMessages.appendChild(div);
  scrollBottom();
}

function addSystemMsg(text) {
  const div = document.createElement('div');
  div.className = 'message msg-system';
  div.textContent = text;
  chatMessages.appendChild(div);
  scrollBottom();
}

function addTyping() {
  const div = document.createElement('div');
  div.className = 'message msg-gm';
  div.innerHTML = `<div class="msg-label">GM — SHANGRI-LA FRONTIER</div><div class="typing-dots"><span></span><span></span><span></span></div>`;
  chatMessages.appendChild(div);
  scrollBottom();
  return div;
}

function clearSystemMsgs() {
  chatMessages.querySelectorAll('.msg-system').forEach(el => el.remove());
}

function scrollBottom() {
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// ── Input Toggle ──────────────────────────────────────────────────────────────
function enableInput() {
  chatInput.disabled = false;
  sendBtn.disabled = false;
  chatInput.focus();
}

function disableInput() {
  chatInput.disabled = true;
  sendBtn.disabled = true;
}

// ── Level Up Toast ────────────────────────────────────────────────────────────
function showLevelUp(level) {
  const toast = document.getElementById('levelup-toast');
  document.getElementById('lu-level').textContent = `Lv.${level}`;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 3400);
}

// ── Modal: Distribuzione Punti Stat ──────────────────────────────────────────
const STAT_DESCS = {
  STR: 'Danno fisico e peso', DEX: 'Precisione e velocità', AGI: 'Schivata e movimento',
  TEC: 'Combo e skill speciali', VIT: 'Resistenza ai danni', LUC: 'Critico e drop rari',
};

let saAlloc = {};

function openStatModal() {
  if (!currentState) return;
  const { profile } = currentState;
  const pts = profile.stat_points_available || 0;
  if (pts === 0) return;

  saAlloc = {};
  document.getElementById('sa-remaining').textContent = pts;

  const grid = document.getElementById('sa-grid');
  grid.innerHTML = ['STR','DEX','AGI','TEC','VIT','LUC'].map(stat => `
    <div class="sa-row">
      <span class="sa-stat-name">${stat}</span>
      <span class="sa-stat-desc">${STAT_DESCS[stat]}</span>
      <div class="sa-controls">
        <button class="sa-btn" id="sa-minus-${stat}" onclick="saChange('${stat}',-1)" disabled>−</button>
        <span class="sa-current" id="sa-cur-${stat}">${profile.stats[stat]}</span>
        <button class="sa-btn" id="sa-plus-${stat}" onclick="saChange('${stat}',1)">+</button>
        <span class="sa-added" id="sa-add-${stat}"></span>
      </div>
    </div>`).join('');

  document.getElementById('modal-stats').classList.remove('hidden');
}

function saChange(stat, delta) {
  if (!currentState) return;
  const pts = currentState.profile.stat_points_available || 0;
  saAlloc[stat] = (saAlloc[stat] || 0) + delta;
  if (saAlloc[stat] < 0) saAlloc[stat] = 0;

  const totalSpent = Object.values(saAlloc).reduce((a,b) => a+b, 0);
  if (totalSpent > pts) { saAlloc[stat] -= delta; return; }

  const remaining = pts - totalSpent;
  document.getElementById('sa-remaining').textContent = remaining;

  ['STR','DEX','AGI','TEC','VIT','LUC'].forEach(s => {
    const base = currentState.profile.stats[s];
    const added = saAlloc[s] || 0;
    document.getElementById(`sa-cur-${s}`).textContent = base + added;
    const addEl = document.getElementById(`sa-add-${s}`);
    addEl.textContent = added > 0 ? `+${added}` : '';
    document.getElementById(`sa-minus-${s}`).disabled = added === 0;
    document.getElementById(`sa-plus-${s}`).disabled = remaining === 0;
  });
}

async function confirmStatAlloc() {
  const totalSpent = Object.values(saAlloc).reduce((a,b) => a+b, 0);
  if (totalSpent === 0) { closeModal('modal-stats'); return; }

  try {
    const data = await apiFetch('/allocate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ allocations: saAlloc }),
    });
    const freshState = await apiFetch('/state');
    currentState = freshState;
    updateUI(freshState);
    closeModal('modal-stats');
    addSystemMsg(`Punti stat distribuiti: ${Object.entries(saAlloc).filter(([,v])=>v>0).map(([k,v])=>`${k}+${v}`).join(', ')}`);
  } catch (e) {
    addSystemMsg(`⚠ ${e.message}`);
    closeModal('modal-stats');
  }
}

document.getElementById('sa-confirm').addEventListener('click', confirmStatAlloc);
document.getElementById('sa-cancel').addEventListener('click', () => closeModal('modal-stats'));
openStatsModal.addEventListener('click', openStatModal);
statPointsBox.addEventListener('click', openStatModal);

// ── Modal: Gestione Skill Loadout ─────────────────────────────────────────────
let slSelected = new Set();

function openSkillModal() {
  if (!currentState) return;
  const { profile, skills, gameState: gs } = currentState;

  slSelected = new Set((gs.skill_loadout || []).map(s => s.id));

  const available = skills.skills.filter(s => s.unlocked_by_default || s.learned);
  const maxSlots = profile.skill_slots || 4;

  document.getElementById('sl-max').textContent = maxSlots;
  document.getElementById('sl-used').textContent = slSelected.size;

  const list = document.getElementById('sl-list');
  if (!available.length) {
    list.innerHTML = '<div class="sl-empty">Nessuna skill disponibile. Sblocca skill giocando!</div>';
  } else {
    list.innerHTML = available.map(sk => {
      const isSelected = slSelected.has(sk.id);
      const costStr = Object.entries(sk.cost || {}).map(([k,v]) => `${k}:${v}`).join('  ');
      return `<div class="sl-skill${isSelected ? ' selected' : ''}" data-id="${sk.id}" onclick="slToggle('${sk.id}',${maxSlots})">
        <div class="sl-checkbox"></div>
        <div class="sl-info">
          <div class="sl-name">${sk.name}</div>
          <div class="sl-cost">${costStr}</div>
          ${sk.effect ? `<div class="sl-effect">${sk.effect}</div>` : ''}
        </div>
      </div>`;
    }).join('');
  }

  document.getElementById('modal-skills').classList.remove('hidden');
}

function slToggle(id, maxSlots) {
  if (slSelected.has(id)) {
    slSelected.delete(id);
  } else {
    if (slSelected.size >= maxSlots) {
      addSystemMsg(`⚠ Hai già ${maxSlots} skill equipaggiate. Rimuovine una prima.`);
      return;
    }
    slSelected.add(id);
  }

  document.getElementById('sl-used').textContent = slSelected.size;

  document.querySelectorAll('.sl-skill').forEach(el => {
    const elId = el.dataset.id;
    el.classList.toggle('selected', slSelected.has(elId));
  });
}

async function confirmSkillLoadout() {
  try {
    const data = await apiFetch('/skill-loadout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skill_ids: [...slSelected] }),
    });
    const freshState = await apiFetch('/state');
    currentState = freshState;
    updateUI(freshState);
    closeModal('modal-skills');
  } catch (e) {
    addSystemMsg(`⚠ ${e.message}`);
    closeModal('modal-skills');
  }
}

document.getElementById('sl-confirm').addEventListener('click', confirmSkillLoadout);
document.getElementById('sl-cancel').addEventListener('click', () => closeModal('modal-skills'));
openSkillsModal.addEventListener('click', openSkillModal);

// ── Chiudi modal cliccando fuori ──────────────────────────────────────────────
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeModal(overlay.id);
  });
});

function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
}

// ── Start ─────────────────────────────────────────────────────────────────────
init();
