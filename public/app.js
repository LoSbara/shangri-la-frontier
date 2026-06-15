// ── Config ────────────────────────────────────────────────────────────────────
const API = 'http://localhost:3000/api';

// ── State ─────────────────────────────────────────────────────────────────────
let busy = false;
let currentState   = null;
let worldMapZones  = [];
let bestiaryFilter = 'all';
let shopTab        = 'buy';

// ── DOM ───────────────────────────────────────────────────────────────────────
const chatMessages    = document.getElementById('chat-messages');
const chatInput       = document.getElementById('chat-input');
const sendBtn         = document.getElementById('send-btn');
const resetBtn        = document.getElementById('reset-btn');
const openStatsModal  = document.getElementById('open-stats-modal');
const statPointsBox   = document.getElementById('stat-points-box');
const openSkillsModal = document.getElementById('open-skills-modal');
const mapBtn          = document.getElementById('map-btn');
const bestiaryBtn     = document.getElementById('bestiary-btn');
const shopBtn         = document.getElementById('shop-btn');

marked.setOptions({ breaks: true });

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  addSystemMsg('Connessione al server in corso…');
  try {
    const [state, mapData] = await Promise.all([apiFetch('/state'), apiFetch('/world-map')]);
    currentState  = state;
    worldMapZones = mapData.zones || [];
    updateUI(state);

    if (!state.profile.name) {
      clearSystemMsgs();
      await sendToGM('Inizia il gioco.');
    } else {
      clearSystemMsgs();
      const log = state.gameState.session_log || [];
      const SKIP = new Set(['Inizia il gioco.']);
      log.forEach(({ role, content }) => {
        if (role === 'user' && !SKIP.has(content)) addPlayerMsg(content, true);
        else if (role === 'assistant') addGMMsg(content, true);
      });
      if (log.length) { addSystemMsg('— sessione precedente caricata —'); scrollBottom(); }
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

// ── Send ──────────────────────────────────────────────────────────────────────
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
  } catch (e) { addSystemMsg(`⚠ ${e.message}`); }
});

// ── UI Update ─────────────────────────────────────────────────────────────────
function updateUI({ profile, inventory, skills, gameState: gs }) {
  if (!profile) return;

  document.getElementById('player-name').textContent  = profile.name || '—';
  document.getElementById('player-job').textContent   = profile.job  || '?';
  document.getElementById('player-level').textContent = `Lv.${profile.level}`;
  document.getElementById('player-money').textContent = `${profile.money} R`;

  setBar('hp',  profile.stats.HP.current,  profile.stats.HP.max);
  setBar('mp',  profile.stats.MP.current,  profile.stats.MP.max);
  setBar('stm', profile.stats.STM.current, profile.stats.STM.max);
  setBar('exp', profile.experience,        profile.experience_to_next);

  document.getElementById('res-hp')
    .classList.toggle('res-low', profile.stats.HP.current / profile.stats.HP.max < 0.25);

  const bon = inventory.stat_bonuses_from_equipment || {};
  for (const s of ['STR','DEX','AGI','TEC','VIT','LUC']) {
    const el = document.getElementById(`sv-${s}`);
    if (!el) continue;
    const total = (profile.stats[s] || 0) + (bon[s] || 0);
    el.textContent = total;
    el.style.color = bon[s] > 0 ? 'var(--stm)' : 'var(--text-bright)';
  }

  const pts = profile.stat_points_available || 0;
  document.getElementById('stat-points-box').classList.toggle('hidden', pts === 0);
  document.getElementById('stat-points-count').textContent = pts;
  openStatsModal.classList.toggle('hidden', pts === 0);

  const inCombat = gs.combat_active;
  const locEl = document.getElementById('location-text');
  locEl.textContent = (inCombat ? '⚔ ' : '🏙 ') + (gs.location || '—');
  locEl.classList.toggle('in-combat', inCombat);

  // Negozio: abilita solo in safe zone e se personaggio creato
  shopBtn.disabled = !profile.name || gs.zone_type !== 'safe_zone';

  const quests = gs.quests_active || [];
  document.getElementById('quest-section').style.display = quests.length ? '' : 'none';
  document.getElementById('quest-list').innerHTML =
    quests.map(q => `<div class="quest-item">${q}</div>`).join('');

  renderEnemy(inCombat ? gs.current_enemy : null);
  renderCombatLog(gs.combat_log_entries || [], inCombat);
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

// ── Enemy ─────────────────────────────────────────────────────────────────────
function renderEnemy(enemy) {
  const panel = document.getElementById('combat-panel');
  if (!enemy) { panel.classList.add('hidden'); return; }
  panel.classList.remove('hidden');
  document.getElementById('enemy-name').textContent = enemy.name || '?';
  document.getElementById('enemy-tier').textContent = `Tier ${enemy.tier || '?'}`;
  const hpCur = enemy.hp?.current ?? 0, hpMax = enemy.hp?.max ?? 1;
  document.getElementById('bar-enemy-hp').style.width = Math.max(0, Math.min(100, (hpCur/hpMax)*100)) + '%';
  document.getElementById('enemy-hp-val').textContent = `${hpCur}/${hpMax}`;
  const details = document.getElementById('enemy-details');
  if (enemy.revealed) {
    const tags = (enemy.weaknesses||[]).map(w=>`<span class="weakness-tag">${w}</span>`).join('');
    details.innerHTML = `<div>STR ${enemy.stats?.STR??'?'} | AGI ${enemy.stats?.AGI??'?'} | Res. ${enemy.stats?.resistenza??0}%</div>${tags?`<div style="margin-top:4px">${tags}</div>`:''}`;
  } else {
    details.innerHTML = '<div><em>non analizzato</em></div>';
  }
}

// ── Combat Log ────────────────────────────────────────────────────────────────
const CL_ICONS = { damage_taken:'💥', heal:'💚', mp_change:'🔷', stm_cost:'⚡', exp_gain:'⭐', enemy_damage:'⚔', money:'💰' };

function renderCombatLog(entries, inCombat) {
  const panel = document.getElementById('combat-log-panel');
  const list  = document.getElementById('combat-log-list');
  panel.classList.toggle('hidden', !inCombat && entries.length === 0);
  if (!entries.length) {
    list.innerHTML = '<div style="font-size:10px;color:var(--text-dim);font-style:italic;padding:3px">Nessun evento ancora.</div>';
    return;
  }
  list.innerHTML = entries.slice(-6).map(entry => {
    const evHtml = (entry.events || []).map(ev => {
      const icon    = CL_ICONS[ev.type] || '·';
      const cssType = ev.type.replace(/_/g, '-');
      return `<div class="cl-event cl-${cssType}"><span class="cl-icon">${icon}</span><span class="cl-text">${ev.text}</span></div>`;
    }).join('');
    return `<div class="cl-entry"><div class="cl-turn">T.${entry.n}</div>${evHtml}</div>`;
  }).join('');
  list.scrollTop = list.scrollHeight;
}

// ── Equipment ─────────────────────────────────────────────────────────────────
const SLOT_LABELS = { weapon:'ARMA',offhand:'SEC.',head:'TESTA',chest:'TORSO',legs:'GAMBE',boots:'STIV.',accessory_1:'ACC.1',accessory_2:'ACC.2' };

function renderEquipment(equipped) {
  document.getElementById('equipment-slots').innerHTML =
    Object.entries(SLOT_LABELS).map(([key, label]) => {
      const item = equipped[key];
      return `<div class="equip-slot"><span class="equip-slot-name">${label}</span>${item?`<span class="equip-slot-item">${item.name}</span>`:`<span class="equip-slot-empty">vuoto</span>`}</div>`;
    }).join('');
}

function renderSkills(loadout, maxSlots) {
  const cards = loadout.map(sk => {
    const cost = Object.entries(sk.cost||{}).map(([k,v])=>`${k}:${v}`).join('  ');
    return `<div class="skill-card"><div class="skill-card-name">${sk.name}</div><div class="skill-card-cost">${cost}</div>${sk.effect?`<div class="skill-card-effect">${sk.effect}</div>`:''}</div>`;
  });
  for (let i = 0; i < Math.max(0, maxSlots - loadout.length); i++) cards.push(`<div class="skill-slot-empty">slot vuoto</div>`);
  document.getElementById('skill-slots').innerHTML = cards.join('');
}

function renderBag(bag) {
  const el = document.getElementById('bag-list');
  if (!bag.length) { el.innerHTML = '<div class="bag-empty">borsa vuota</div>'; return; }
  el.innerHTML = bag.map(item => {
    const name = item.name || item, qty = item.quantity;
    return `<div class="bag-item"><span>${name}</span>${qty>1?`<span class="bag-item-qty">×${qty}</span>`:''}</div>`;
  }).join('');
}

// ── Chat ──────────────────────────────────────────────────────────────────────
function addGMMsg(narrative, isHistory=false) {
  const div = document.createElement('div');
  div.className = `message msg-gm${isHistory?' history':''}`;
  div.innerHTML = `<div class="msg-label">GM — SHANGRI-LA FRONTIER</div><div>${marked.parse(narrative)}</div>`;
  chatMessages.appendChild(div); scrollBottom();
}
function addPlayerMsg(text, isHistory=false) {
  const div = document.createElement('div');
  div.className = `message msg-player${isHistory?' history':''}`;
  div.textContent = text;
  chatMessages.appendChild(div); scrollBottom();
}
function addSystemMsg(text) {
  const div = document.createElement('div');
  div.className = 'message msg-system';
  div.textContent = text;
  chatMessages.appendChild(div); scrollBottom();
}
function addTyping() {
  const div = document.createElement('div');
  div.className = 'message msg-gm';
  div.innerHTML = `<div class="msg-label">GM — SHANGRI-LA FRONTIER</div><div class="typing-dots"><span></span><span></span><span></span></div>`;
  chatMessages.appendChild(div); scrollBottom();
  return div;
}
function clearSystemMsgs() { chatMessages.querySelectorAll('.msg-system').forEach(e=>e.remove()); }
function scrollBottom() { chatMessages.scrollTop = chatMessages.scrollHeight; }

// ── Input ─────────────────────────────────────────────────────────────────────
function enableInput()  { chatInput.disabled=false; sendBtn.disabled=false; chatInput.focus(); }
function disableInput() { chatInput.disabled=true;  sendBtn.disabled=true; }

// ── Level Up ──────────────────────────────────────────────────────────────────
function showLevelUp(level) {
  const toast = document.getElementById('levelup-toast');
  document.getElementById('lu-level').textContent = `Lv.${level}`;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 3400);
}

// ── Modal helpers ─────────────────────────────────────────────────────────────
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(overlay.id); });
});

// ────────────────────────────────────────────────────────────────────────────
// MAPPA DEL MONDO
// ────────────────────────────────────────────────────────────────────────────
const ZONE_COLORS = { safe:'#3b82f6', combat:'#ef4444', dungeon:'#a78bfa', boss:'#f59e0b' };

function getCurrentZone() {
  if (!currentState || !worldMapZones.length) return null;
  const loc = (currentState.gameState.location || '').toLowerCase();
  return worldMapZones.find(z => loc.includes(z.name.toLowerCase()));
}

function buildMapSVG(zones, currentId) {
  const drawnConns = new Set();
  let paths = '';
  for (const z of zones) {
    for (const connId of (z.connections || [])) {
      const key = [z.id, connId].sort().join('|');
      if (drawnConns.has(key)) continue;
      drawnConns.add(key);
      const t = zones.find(z2 => z2.id === connId);
      if (t) paths += `<line x1="${z.x}" y1="${z.y}" x2="${t.x}" y2="${t.y}" stroke="#1c1c35" stroke-width="2" stroke-linecap="round"/>`;
    }
  }

  let nodes = '';
  for (const z of zones) {
    const color   = ZONE_COLORS[z.type] || '#5c5fe8';
    const isCurr  = z.id === currentId;
    const opacity = isCurr ? 0.35 : 0.12;

    nodes += `<g class="map-zone-group" onclick="mapZoneClick('${z.id}')" style="cursor:pointer">`;

    if (isCurr) {
      nodes += `<circle cx="${z.x}" cy="${z.y}" r="${z.r+10}" fill="none" stroke="${color}" stroke-width="1.5" opacity="0.4">
        <animate attributeName="r" values="${z.r+8};${z.r+14};${z.r+8}" dur="2s" repeatCount="indefinite"/>
        <animate attributeName="opacity" values="0.4;0.05;0.4" dur="2s" repeatCount="indefinite"/>
      </circle>`;
    }

    nodes += `<circle class="zone-bg" cx="${z.x}" cy="${z.y}" r="${z.r}" fill="${color}" fill-opacity="${opacity}" stroke="${color}" stroke-width="${isCurr?2.5:1.5}" stroke-opacity="0.9"/>`;

    // Tier label inside circle
    const fontSize = z.tier === 'HUB' ? 8 : 7;
    nodes += `<text x="${z.x}" y="${z.y+3}" text-anchor="middle" fill="${color}" font-size="${fontSize}" font-family="monospace" font-weight="bold" pointer-events="none">${z.tier}</text>`;

    // Zone name below
    const nameY = z.y + z.r + 13;
    nodes += `<text x="${z.x}" y="${nameY}" text-anchor="middle" fill="${isCurr ? '#e0e4f8' : '#6a6e90'}" font-size="9" font-family="sans-serif" font-weight="${isCurr?'bold':'normal'}" pointer-events="none">${z.name}</text>`;

    nodes += `<title>${z.name} — ${z.subtitle}</title></g>`;
  }

  return `<svg viewBox="0 0 500 450" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">
    <rect width="500" height="450" fill="#08080f"/>
    ${paths}${nodes}
  </svg>`;
}

function openMapModal() {
  const currentZone = getCurrentZone();
  document.getElementById('map-svg-container').innerHTML =
    buildMapSVG(worldMapZones, currentZone?.id || null);
  document.getElementById('modal-map').classList.remove('hidden');
}

function mapZoneClick(zoneId) {
  const zone = worldMapZones.find(z => z.id === zoneId);
  if (!zone) return;
  const curr = getCurrentZone();
  if (curr?.id === zoneId) return;
  if (!confirm(`Spostarsi verso "${zone.name}"?`)) return;
  closeModal('modal-map');
  addPlayerMsg(`Voglio spostarmi verso ${zone.name}.`);
  sendToGM(`Voglio spostarmi verso ${zone.name}.`);
}

mapBtn.addEventListener('click', openMapModal);

// ────────────────────────────────────────────────────────────────────────────
// BESTIARIO
// ────────────────────────────────────────────────────────────────────────────
function tierClass(tier) {
  const t = (tier || '?')[0].toUpperCase();
  return ['F','E','D','C','B','A','S'].includes(t) ? `tier-${t}` : 'tier-F';
}

async function openBestiaryModal() {
  document.getElementById('modal-bestiary').classList.remove('hidden');
  renderBestiaryLoading();
  try {
    const data = await apiFetch('/bestiary');
    renderBestiaryContent(data.entries || []);
  } catch (e) {
    document.getElementById('bestiary-list').innerHTML =
      `<div class="bestiary-empty">⚠ ${e.message}</div>`;
  }
}

function renderBestiaryLoading() {
  document.getElementById('bestiary-filters').innerHTML = '';
  document.getElementById('bestiary-list').innerHTML =
    '<div class="bestiary-empty">Caricamento…</div>';
}

function renderBestiaryContent(entries) {
  // Build tier filter buttons
  const tiers = ['all', ...new Set(entries.map(e => (e.tier || '?')[0].toUpperCase()))];
  document.getElementById('bestiary-filters').innerHTML = tiers.map(t =>
    `<button class="filter-btn${t === bestiaryFilter ? ' active' : ''}" onclick="setBestiaryFilter('${t}')">${t === 'all' ? 'Tutti' : 'Tier ' + t}</button>`
  ).join('');

  const filtered = bestiaryFilter === 'all'
    ? entries
    : entries.filter(e => (e.tier || '?')[0].toUpperCase() === bestiaryFilter);

  if (!filtered.length) {
    document.getElementById('bestiary-list').innerHTML =
      `<div class="bestiary-empty">${entries.length === 0 ? 'Nessun nemico incontrato ancora. Esplora il mondo!' : 'Nessun nemico per questo filtro.'}</div>`;
    return;
  }

  document.getElementById('bestiary-list').innerHTML = filtered.map(entry => {
    const weakTags = (entry.weaknesses || []).map(w => `<span class="tag">${w}</span>`).join('');
    const statsLine = entry.stats
      ? `STR ${entry.stats.STR??'?'} | AGI ${entry.stats.AGI??'?'} | Res. ${entry.stats.resistenza??0}%${weakTags ? ' — ' + weakTags : ''}`
      : `<span class="bestiary-unknown">stat sconosciute — usa Analisi in combattimento</span>`;

    return `<div class="bestiary-card">
      <div class="bestiary-tier ${tierClass(entry.tier)}">${entry.tier || '?'}</div>
      <div class="bestiary-info">
        <div class="bestiary-name">${entry.name}</div>
        <div class="bestiary-meta">Lv.${entry.level || '?'} &nbsp;|&nbsp; HP max: ${entry.hp_max || '?'} &nbsp;|&nbsp; Incontri: ${entry.encounters || 0} &nbsp;|&nbsp; Sconfitti: ${entry.defeated || 0}</div>
        <div class="bestiary-stats">${statsLine}</div>
      </div>
    </div>`;
  }).join('');
}

function setBestiaryFilter(tier) {
  bestiaryFilter = tier;
  openBestiaryModal();
}

bestiaryBtn.addEventListener('click', openBestiaryModal);

// ────────────────────────────────────────────────────────────────────────────
// NEGOZIO
// ────────────────────────────────────────────────────────────────────────────
const RARITY_LABELS = { comune:'Comune', non_comune:'Non comune', raro:'Raro', epico:'Epico' };

async function openShopModal() {
  if (!currentState) return;
  const { gameState: gs } = currentState;
  if (gs.zone_type !== 'safe_zone') { addSystemMsg('Il negozio è disponibile solo nelle città.'); return; }

  document.getElementById('modal-shop').classList.remove('hidden');
  document.getElementById('shop-location').textContent = gs.location || '—';
  switchShopTab('buy');
  renderShopLoading();

  try {
    const shop = await apiFetch('/shop');
    // Se il negozio è già per questa location, mostralo direttamente
    if (shop.location === gs.location && shop.items?.length) {
      renderShop(shop);
    } else {
      await generateShop();
    }
  } catch { await generateShop(); }
}

async function generateShop() {
  renderShopLoading();
  try {
    const shop = await apiFetch('/shop/generate', { method: 'POST' });
    renderShop(shop);
  } catch (e) {
    document.getElementById('shop-buy-panel').innerHTML = `<div class="shop-empty">⚠ ${e.message}</div>`;
  }
}

function renderShopLoading() {
  document.getElementById('shop-buy-panel').innerHTML  = '<div class="shop-loading">Generazione listino in corso…</div>';
  document.getElementById('shop-sell-panel').innerHTML = '';
  document.getElementById('shop-title').textContent = 'NEGOZIO';
}

function renderShop(shop) {
  document.getElementById('shop-title').textContent = shop.shop_name || 'NEGOZIO';

  const money = currentState?.profile?.money || 0;
  const buyItems = (shop.items || []);

  document.getElementById('shop-buy-panel').innerHTML = buyItems.length
    ? buyItems.map((item, i) => {
        const canAfford = money >= item.price;
        const bonusStr  = Object.entries(item.stat_bonus || {}).map(([k,v])=>`${k}+${v}`).join(' ');
        return `<div class="shop-item">
          <div class="shop-item-rarity rarity-${item.rarity || 'comune'}"></div>
          <div class="shop-item-info">
            <div class="shop-item-name">${item.name} <small style="color:var(--text-dim);font-weight:400">${RARITY_LABELS[item.rarity]||''}</small></div>
            <div class="shop-item-desc">${item.description || ''}</div>
            ${bonusStr ? `<div class="shop-item-bonus">${bonusStr}</div>` : ''}
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px">
            <span class="shop-item-price">${item.price} R</span>
            <button class="shop-buy-btn" ${canAfford?'':'disabled'} onclick="buyItem('${item.id}')">Acquista</button>
          </div>
        </div>`;
      }).join('')
    : '<div class="shop-empty">Nessun oggetto disponibile.</div>';

  renderSellPanel();
}

function renderSellPanel() {
  const bag = currentState?.inventory?.bag || [];
  document.getElementById('shop-sell-panel').innerHTML = bag.length
    ? bag.map((item, i) => {
        const sellPrice = Math.max(1, Math.floor((item.price || 50) * 0.5));
        return `<div class="shop-item">
          <div class="shop-item-rarity rarity-${item.rarity || 'comune'}"></div>
          <div class="shop-item-info">
            <div class="shop-item-name">${item.name || item}</div>
            <div class="shop-item-desc">${item.description || ''}</div>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px">
            <span class="shop-item-price" style="color:var(--stm)">${sellPrice} R</span>
            <button class="shop-sell-btn" onclick="sellItem(${i})">Vendi</button>
          </div>
        </div>`;
      }).join('')
    : '<div class="shop-empty">La borsa è vuota.</div>';
}

async function buyItem(itemId) {
  try {
    const data = await apiFetch('/shop/buy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: itemId }),
    });
    // Aggiorna state locale
    currentState.profile   = data.profile;
    currentState.inventory = data.inventory;
    updateUI(currentState);
    document.getElementById('player-money').textContent = `${data.profile.money} R`;
    // Ricarica shop per aggiornare i pulsanti afford
    const shop = await apiFetch('/shop');
    renderShop(shop);
    addSystemMsg(`Acquistato con successo!`);
  } catch (e) { addSystemMsg(`⚠ ${e.message}`); }
}

async function sellItem(index) {
  try {
    const data = await apiFetch('/shop/sell', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_index: index }),
    });
    currentState.profile   = data.profile;
    currentState.inventory = data.inventory;
    updateUI(currentState);
    renderSellPanel();
    const shop = await apiFetch('/shop');
    renderShop(shop);
    addSystemMsg(`"${data.itemName}" venduto per ${data.sellPrice} R.`);
  } catch (e) { addSystemMsg(`⚠ ${e.message}`); }
}

function switchShopTab(tab) {
  shopTab = tab;
  document.getElementById('tab-buy').classList.toggle('active', tab === 'buy');
  document.getElementById('tab-sell').classList.toggle('active', tab === 'sell');
  document.getElementById('shop-buy-panel').classList.toggle('hidden', tab !== 'buy');
  document.getElementById('shop-sell-panel').classList.toggle('hidden', tab !== 'sell');
  if (tab === 'sell') renderSellPanel();
}

shopBtn.addEventListener('click', openShopModal);
document.getElementById('shop-refresh-btn').addEventListener('click', generateShop);

// ────────────────────────────────────────────────────────────────────────────
// MODAL STAT ALLOCATION
// ────────────────────────────────────────────────────────────────────────────
const STAT_DESCS = { STR:'Danno fisico e peso', DEX:'Precisione e velocità', AGI:'Schivata e movimento', TEC:'Combo e skill speciali', VIT:'Resistenza ai danni', LUC:'Critico e drop rari' };
let saAlloc = {};

function openStatModal() {
  if (!currentState) return;
  const { profile } = currentState;
  const pts = profile.stat_points_available || 0;
  if (pts === 0) return;
  saAlloc = {};
  document.getElementById('sa-remaining').textContent = pts;
  document.getElementById('sa-grid').innerHTML = ['STR','DEX','AGI','TEC','VIT','LUC'].map(stat => `
    <div class="sa-row">
      <span class="sa-stat-name">${stat}</span>
      <span class="sa-stat-desc">${STAT_DESCS[stat]}</span>
      <div class="sa-controls">
        <button class="sa-btn" id="sa-minus-${stat}" onclick="saChange('${stat}',-1)" disabled>−</button>
        <span class="sa-current" id="sa-cur-${stat}">${profile.stats[stat]}</span>
        <button class="sa-btn" id="sa-plus-${stat}"  onclick="saChange('${stat}',1)">+</button>
        <span class="sa-added" id="sa-add-${stat}"></span>
      </div>
    </div>`).join('');
  document.getElementById('modal-stats').classList.remove('hidden');
}

function saChange(stat, delta) {
  if (!currentState) return;
  const pts = currentState.profile.stat_points_available || 0;
  saAlloc[stat] = Math.max(0, (saAlloc[stat] || 0) + delta);
  const totalSpent = Object.values(saAlloc).reduce((a,b)=>a+b, 0);
  if (totalSpent > pts) { saAlloc[stat] -= delta; return; }
  const remaining = pts - totalSpent;
  document.getElementById('sa-remaining').textContent = remaining;
  ['STR','DEX','AGI','TEC','VIT','LUC'].forEach(s => {
    const base = currentState.profile.stats[s], added = saAlloc[s] || 0;
    document.getElementById(`sa-cur-${s}`).textContent = base + added;
    document.getElementById(`sa-add-${s}`).textContent = added > 0 ? `+${added}` : '';
    document.getElementById(`sa-minus-${s}`).disabled = added === 0;
    document.getElementById(`sa-plus-${s}`).disabled  = remaining === 0;
  });
}

async function confirmStatAlloc() {
  const totalSpent = Object.values(saAlloc).reduce((a,b)=>a+b, 0);
  if (totalSpent === 0) { closeModal('modal-stats'); return; }
  try {
    await apiFetch('/allocate', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({allocations:saAlloc}) });
    const freshState = await apiFetch('/state');
    currentState = freshState;
    updateUI(freshState);
    closeModal('modal-stats');
    addSystemMsg(`Punti distribuiti: ${Object.entries(saAlloc).filter(([,v])=>v>0).map(([k,v])=>`${k}+${v}`).join(', ')}`);
  } catch (e) { addSystemMsg(`⚠ ${e.message}`); closeModal('modal-stats'); }
}

document.getElementById('sa-confirm').addEventListener('click', confirmStatAlloc);
document.getElementById('sa-cancel').addEventListener('click',  () => closeModal('modal-stats'));
openStatsModal.addEventListener('click', openStatModal);
statPointsBox.addEventListener('click',  openStatModal);

// ────────────────────────────────────────────────────────────────────────────
// MODAL SKILL LOADOUT
// ────────────────────────────────────────────────────────────────────────────
let slSelected = new Set();

function openSkillModal() {
  if (!currentState) return;
  const { profile, skills, gameState: gs } = currentState;
  slSelected = new Set((gs.skill_loadout || []).map(s => s.id));
  const available = skills.skills.filter(s => s.unlocked_by_default || s.learned);
  const maxSlots  = profile.skill_slots || 4;
  document.getElementById('sl-max').textContent  = maxSlots;
  document.getElementById('sl-used').textContent = slSelected.size;
  const list = document.getElementById('sl-list');
  if (!available.length) {
    list.innerHTML = '<div class="sl-empty">Nessuna skill disponibile. Sblocca skill giocando!</div>';
  } else {
    list.innerHTML = available.map(sk => {
      const isSelected = slSelected.has(sk.id);
      const cost = Object.entries(sk.cost||{}).map(([k,v])=>`${k}:${v}`).join('  ');
      return `<div class="sl-skill${isSelected?' selected':''}" data-id="${sk.id}" onclick="slToggle('${sk.id}',${maxSlots})">
        <div class="sl-checkbox"></div>
        <div class="sl-info">
          <div class="sl-name">${sk.name}</div>
          <div class="sl-cost">${cost}</div>
          ${sk.effect?`<div class="sl-effect">${sk.effect}</div>`:''}
        </div>
      </div>`;
    }).join('');
  }
  document.getElementById('modal-skills').classList.remove('hidden');
}

function slToggle(id, maxSlots) {
  if (slSelected.has(id)) { slSelected.delete(id); }
  else {
    if (slSelected.size >= maxSlots) { addSystemMsg(`⚠ Massimo ${maxSlots} skill nel loadout.`); return; }
    slSelected.add(id);
  }
  document.getElementById('sl-used').textContent = slSelected.size;
  document.querySelectorAll('.sl-skill').forEach(el => el.classList.toggle('selected', slSelected.has(el.dataset.id)));
}

async function confirmSkillLoadout() {
  try {
    await apiFetch('/skill-loadout', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({skill_ids:[...slSelected]}) });
    const freshState = await apiFetch('/state');
    currentState = freshState;
    updateUI(freshState);
    closeModal('modal-skills');
  } catch (e) { addSystemMsg(`⚠ ${e.message}`); closeModal('modal-skills'); }
}

document.getElementById('sl-confirm').addEventListener('click', confirmSkillLoadout);
document.getElementById('sl-cancel').addEventListener('click',  () => closeModal('modal-skills'));
openSkillsModal.addEventListener('click', openSkillModal);

// ────────────────────────────────────────────────────────────────────────────
// ESPORTAZIONE SESSIONE
// ────────────────────────────────────────────────────────────────────────────
document.getElementById('export-btn').addEventListener('click', () => {
  window.location.href = API + '/export';
});

// ────────────────────────────────────────────────────────────────────────────
// SLOT DI SALVATAGGIO
// ────────────────────────────────────────────────────────────────────────────
document.getElementById('slots-btn').addEventListener('click', openSlotsModal);

async function openSlotsModal() {
  document.getElementById('modal-slots').classList.remove('hidden');
  document.getElementById('slots-list').innerHTML =
    '<div style="padding:20px;text-align:center;color:var(--text-dim);font-style:italic">Caricamento…</div>';
  try {
    const slots = await apiFetch('/slots');
    renderSlots(slots);
  } catch (e) {
    document.getElementById('slots-list').innerHTML =
      `<div style="padding:20px;text-align:center;color:var(--enemy)">⚠ ${e.message}</div>`;
  }
}

function renderSlots(slots) {
  document.getElementById('slots-list').innerHTML = slots.map(slot => {
    const savedAt = slot.last_saved
      ? new Date(slot.last_saved).toLocaleString('it-IT', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' })
      : null;
    return `<div class="slot-card" id="slot-card-${slot.id}">
      <div class="slot-num">${slot.id}</div>
      <div class="slot-info">
        ${slot.empty
          ? `<div class="slot-empty-label">Slot vuoto</div>`
          : `<div class="slot-name">${slot.name}</div>
             <div class="slot-meta">${slot.job || '?'} · Lv.${slot.level} · ${slot.money} R</div>
             ${savedAt ? `<div class="slot-saved-at">Salvato: ${savedAt}</div>` : ''}`
        }
      </div>
      <div class="slot-actions">
        ${!slot.empty ? `<button class="slot-btn-load" onclick="loadSlot(${slot.id})">Carica</button>` : ''}
        <button class="slot-btn-save" onclick="saveSlot(${slot.id})">Salva qui</button>
        ${!slot.empty ? `<button class="slot-btn-del" onclick="deleteSlot(${slot.id})" title="Elimina">✕</button>` : ''}
      </div>
    </div>`;
  }).join('');
}

async function saveSlot(id) {
  try {
    await apiFetch(`/slots/${id}/save`, { method: 'POST' });
    addSystemMsg(`Partita salvata nello slot ${id}.`);
    const slots = await apiFetch('/slots');
    renderSlots(slots);
  } catch (e) { addSystemMsg(`⚠ ${e.message}`); }
}

async function loadSlot(id) {
  if (!confirm(`Caricare lo slot ${id}? La sessione corrente non salvata andrà persa.`)) return;
  try {
    const newState = await apiFetch(`/slots/${id}/load`, { method: 'POST' });
    currentState = newState;
    chatMessages.innerHTML = '';
    const log = newState.gameState.session_log || [];
    const SKIP = new Set(['Inizia il gioco.']);
    log.forEach(({ role, content }) => {
      if (role === 'user' && !SKIP.has(content)) addPlayerMsg(content, true);
      else if (role === 'assistant') addGMMsg(content, true);
    });
    if (log.length) { addSystemMsg('— slot caricato —'); scrollBottom(); }
    updateUI(newState);
    closeModal('modal-slots');
    enableInput();
    addSystemMsg(`Slot ${id} caricato.`);
  } catch (e) { addSystemMsg(`⚠ ${e.message}`); }
}

async function deleteSlot(id) {
  if (!confirm(`Eliminare lo slot ${id}? Azione irreversibile.`)) return;
  try {
    await apiFetch(`/slots/${id}`, { method: 'DELETE' });
    const slots = await apiFetch('/slots');
    renderSlots(slots);
    addSystemMsg(`Slot ${id} eliminato.`);
  } catch (e) { addSystemMsg(`⚠ ${e.message}`); }
}

// ── Start ─────────────────────────────────────────────────────────────────────
init();
