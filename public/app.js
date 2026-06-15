// ── Config ────────────────────────────────────────────────────────────────────
const API = 'http://localhost:3000/api';

// ── State ─────────────────────────────────────────────────────────────────────
let busy = false;

// ── DOM ───────────────────────────────────────────────────────────────────────
const chatMessages = document.getElementById('chat-messages');
const chatInput    = document.getElementById('chat-input');
const sendBtn      = document.getElementById('send-btn');
const resetBtn     = document.getElementById('reset-btn');

// ── Marked config ─────────────────────────────────────────────────────────────
marked.setOptions({ breaks: true });

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  addSystemMsg('Connessione al server in corso…');
  try {
    const state = await apiFetch('/state');
    updateUI(state);

    if (!state.profile.name) {
      clearSystemMsgs();
      await sendToGM('Inizia il gioco.');
    } else {
      clearSystemMsgs();
      addSystemMsg(`Bentornato, ${state.profile.name}. Connessione ripristinata.`);
      enableInput();
    }
  } catch (e) {
    clearSystemMsgs();
    addSystemMsg('⚠ Impossibile connettersi al server. Avvia "npm start" nella cartella Shanfro.');
  }
}

// ── API Helpers ───────────────────────────────────────────────────────────────
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

// ── Send Flow ─────────────────────────────────────────────────────────────────
async function handleSend() {
  const text = chatInput.value.trim();
  if (!text || busy) return;
  chatInput.value = '';
  addPlayerMsg(text);
  await sendToGM(text);
}

sendBtn.addEventListener('click', handleSend);

chatInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
});

resetBtn.addEventListener('click', async () => {
  if (!confirm('Vuoi davvero iniziare una nuova partita? Tutti i progressi saranno cancellati.')) return;
  try {
    await apiFetch('/reset', { method: 'POST' });
    chatMessages.innerHTML = '';
    addSystemMsg('Nuova partita avviata. Reinizializzazione…');
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
  document.getElementById('player-job').textContent   = profile.job || '?';
  document.getElementById('player-level').textContent = `Lv.${profile.level}`;
  document.getElementById('player-money').textContent = `${profile.money} R`;

  // Bars
  setBar('hp',  profile.stats.HP.current,  profile.stats.HP.max);
  setBar('mp',  profile.stats.MP.current,  profile.stats.MP.max);
  setBar('stm', profile.stats.STM.current, profile.stats.STM.max);
  setBar('exp', profile.experience,        profile.experience_to_next);

  // Low HP alert
  const hpPct = profile.stats.HP.current / profile.stats.HP.max;
  document.getElementById('res-hp').classList.toggle('res-low', hpPct < 0.25);

  // Stats
  const bon = inventory.stat_bonuses_from_equipment || {};
  for (const s of ['STR','DEX','AGI','TEC','VIT','LUC']) {
    const el = document.getElementById(`sv-${s}`);
    if (el) {
      const total = (profile.stats[s] || 0) + (bon[s] || 0);
      el.textContent = total;
      el.style.color = bon[s] > 0 ? 'var(--stm)' : 'var(--text-bright)';
    }
  }

  // Stat points
  const pts = profile.stat_points_available || 0;
  const ptsBox = document.getElementById('stat-points-box');
  ptsBox.classList.toggle('hidden', pts === 0);
  document.getElementById('stat-points-count').textContent = pts;

  // Location
  const isSafe = gs.zone_type === 'safe_zone';
  document.getElementById('location-text').textContent =
    (isSafe ? '🏙 ' : '⚔ ') + (gs.location || '—');

  // Quests
  const quests = gs.quests_active || [];
  const qSection = document.getElementById('quest-section');
  qSection.style.display = quests.length ? '' : 'none';
  document.getElementById('quest-list').innerHTML =
    quests.map(q => `<div class="quest-item">${q}</div>`).join('');

  // Equipment
  renderEquipment(inventory.equipped || {});

  // Skills
  renderSkills(gs.skill_loadout || [], profile.skill_slots || 4);

  // Bag
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

// ── Equipment ─────────────────────────────────────────────────────────────────
const SLOT_LABELS = {
  weapon: 'ARMA', offhand: 'SEC.', head: 'TESTA', chest: 'TORSO',
  legs: 'GAMBE', boots: 'STIV.', accessory_1: 'ACC.1', accessory_2: 'ACC.2',
};

function renderEquipment(equipped) {
  const container = document.getElementById('equipment-slots');
  container.innerHTML = Object.entries(SLOT_LABELS).map(([key, label]) => {
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
  const container = document.getElementById('skill-slots');
  const cards = loadout.map(sk => {
    const costStr = Object.entries(sk.cost || {}).map(([k,v]) => `${k}:${v}`).join('  ');
    return `<div class="skill-card">
      <div class="skill-card-name">${sk.name}</div>
      <div class="skill-card-cost">${costStr}</div>
      ${sk.effect ? `<div class="skill-card-effect">${sk.effect}</div>` : ''}
    </div>`;
  });

  const emptyCount = Math.max(0, maxSlots - loadout.length);
  for (let i = 0; i < emptyCount; i++) {
    cards.push(`<div class="skill-slot-empty">slot vuoto</div>`);
  }

  container.innerHTML = cards.join('');
}

// ── Bag ───────────────────────────────────────────────────────────────────────
function renderBag(bag) {
  const container = document.getElementById('bag-list');
  if (!bag.length) {
    container.innerHTML = '<div class="bag-empty">borsa vuota</div>';
    return;
  }
  container.innerHTML = bag.map(item => {
    const name = item.name || item;
    const qty  = item.quantity;
    return `<div class="bag-item">
      <span>${name}</span>
      ${qty > 1 ? `<span class="bag-item-qty">×${qty}</span>` : ''}
    </div>`;
  }).join('');
}

// ── Chat Messages ─────────────────────────────────────────────────────────────
function addGMMsg(narrative) {
  const div = document.createElement('div');
  div.className = 'message msg-gm';
  div.innerHTML = `<div class="msg-label">GM — SHANGRI-LA FRONTIER</div>
    <div>${marked.parse(narrative)}</div>`;
  chatMessages.appendChild(div);
  scrollBottom();
}

function addPlayerMsg(text) {
  const div = document.createElement('div');
  div.className = 'message msg-player';
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
  div.innerHTML = `<div class="msg-label">GM — SHANGRI-LA FRONTIER</div>
    <div class="typing-dots"><span></span><span></span><span></span></div>`;
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

// ── Level Up Toast ────────────────────────────────────────────────────────────
function showLevelUp(level) {
  const toast = document.getElementById('levelup-toast');
  document.getElementById('lu-level').textContent = `Lv.${level}`;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 3200);
}

// ── Input Toggle ──────────────────────────────────────────────────────────────
function enableInput() {
  chatInput.disabled = false;
  sendBtn.disabled   = false;
  chatInput.focus();
}

function disableInput() {
  chatInput.disabled = true;
  sendBtn.disabled   = true;
}

// ── Start ─────────────────────────────────────────────────────────────────────
init();
