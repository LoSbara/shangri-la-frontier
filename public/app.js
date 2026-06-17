// ── Config ────────────────────────────────────────────────────────────────────
const API = 'http://localhost:3000/api';

// ── State ─────────────────────────────────────────────────────────────────────
let busy            = false;
let waitingForGM    = false;
let currentState    = null;
let worldMapZones   = [];
let bestiaryFilter  = 'all';
let diaryCache      = [];
let diaryZoneFilter = '';
let shopTab         = 'buy';
let prevCombatState = false;
let pinnedQuestId   = null;
let questsCache     = [];

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
const diaryBtn        = document.getElementById('diary-btn');
const shopBtn         = document.getElementById('shop-btn');
const craftBtn        = document.getElementById('craft-btn');
const questsBtn       = document.getElementById('quests-btn');

marked.setOptions({ breaks: true });

// ── Class Data ────────────────────────────────────────────────────────────────
const SUBCLASS_DATA = {
  berserker:       { name: 'Berserker',          color: '#ef4444', flavor: 'Potenza bruta e furia scatenata. Più danni, più rischi.',                           skills: ['Furia Berserker','Prezzo di Sangue','Rampaggio','Ultima Resistenza (P)','Urlo di Guerra'] },
  guardian:        { name: 'Guardiano',           color: '#3b82f6', flavor: 'Difesa impenetrabile e contrattacchi devastanti.',                                  skills: ['Postura di Ferro','Riflesso del Danno','Bastione','Protezione Assoluta (P)','Postura Contrattacco'] },
  blade_master:    { name: 'Lama Assoluta',       color: '#a78bfa', flavor: 'Tecnica pura. Ogni colpo è calcolato al millimetro.',                               skills: ['Colpo Focalizzato','Kata della Spada','Risonanza della Lama','Filo Perfetto (P)','Colpo Decisivo'] },
  acrobat:         { name: 'Acrobata',            color: '#10b981', flavor: 'Velocità e agilità aerea. Schiva, poi colpisci.',                                   skills: ['Cascata','Riposizionamento','Danza del Vento','Maestria Aerea (P)','Volo Libero'] },
  shadow:          { name: 'Ombra',               color: '#6366f1', flavor: 'Invisibilità e colpi letali. Nessuno sa quando colpirà.',                            skills: ['Nascondersi','Colpo Letale','Passo d\'Ombra','Istinto del Predatore (P)','Uccisione Evasiva'] },
  duelist:         { name: 'Duelista',            color: '#f59e0b', flavor: 'Maestro del duello 1v1. Ogni parata è un\'opportunità.',                            skills: ['Parata-Riposte','Pressione della Lama (P)','Postura Perfetta','Catena di Riposte','Disarmo'] },
  supreme_analyst: { name: 'Analista Supremo',    color: '#06b6d4', flavor: 'Conosce il nemico meglio del nemico stesso. Informazione = potere.',                skills: ['Analisi Completa','Copia Skill','Contro-Build','Riconoscimento Pattern (P)','Sfruttamento (P)'] },
  manipulator:     { name: 'Manipolatore',        color: '#ec4899', flavor: 'Status, veleni, maledizioni. Il nemico si autodistrugge.',                          skills: ['Trama Velenosa','Confusione','Maledizione del Campo','Amplificazione Debuff (P)','Catena di Status'] },
  artificer:       { name: 'Artefice',            color: '#f97316', flavor: 'Costrutti, trappole e barriere. Combatte con la tecnologia.',                       skills: ['Disponi Costrutto','Posa Trappola','Campo Barriera','Ingegnere (P)','Overclocking'] },
  sovereign:       { name: 'Sovereigno',          color: '#eab308', flavor: 'Nessun limite di classe. Adattabilità totale e potere bilanciato.',                 skills: ['Aura del Sovereigno','Combattimento Adattivo','Colpo Bilanciato','Versatilità (P)','Volontà del Sovereigno'] },
  // Sacerdote
  guaritore:       { name: 'Guaritore',           color: '#86efac', flavor: 'Cura, rigenerazione, barriere. La vita è la tua arma.',                            skills: ['Cura Maggiore','Rigenerazione','Purificazione','Barriera Sacra','Empatia Divina (P)'] },
  esorcista:       { name: 'Esorcista',           color: '#fde68a', flavor: 'Luce sacra, catene divine, esorcismi. La morte degli spiriti.',                    skills: ['Lampo Sacro','Catene della Luce','Esorcismo','Aura Purificante (P)','Sigillo d\'Esorcismo'] },
  oracolo:         { name: 'Oracolo',             color: '#c4b5fd', flavor: 'Profezie, fortuna e sfortuna. Il destino è nelle tue mani.',                       skills: ['Profezia','Fortuna Condivisa','Visione del Futuro','Sfortuna del Nemico','Destino Segnato (P)'] },
  // Ingegnere
  meccanico:       { name: 'Meccanico',           color: '#94a3b8', flavor: 'Torrette, scudi meccanici, potenziamenti. La macchina combatte per te.',           skills: ['Disponi Torretta','Scudo Meccanico','Motore di Combattimento (P)','Riparazione di Campo','Potenziamento Meccanico'] },
  alchimista:      { name: 'Alchimista',          color: '#6ee7b7', flavor: 'Acidi, elisir, trasmutazioni. La chimica è devastante.',                           skills: ['Bomba Acida','Elisir di Combattimento','Trasmutazione','Nebbia Alchemica','Catalisi (P)'] },
  inventore:       { name: 'Inventore',           color: '#fb923c', flavor: 'Gadget, razzi, tute rinforzate. La creatività supera la forza bruta.',             skills: ['Gadget Esplosivo','Razzo da Battaglia','Tuta Rinforzata (P)','Auto-Riparazione','Iperboost'] },
};

const ADVANCED_CLASS_DATA = {
  war_god:             { name: 'Dio della Guerra',        color: '#ef4444', subclass: 'berserker',       flavor: 'La furia divina incarnata. Distrugge tutto.',                            skills: ['Stato del Dio della Guerra','Rampaggio Divino','Sfida alla Morte (P)','Annientamento'] },
  blood_reaper:        { name: 'Mietitore di Sangue',     color: '#dc2626', subclass: 'berserker',       flavor: 'Si nutre del sangue nemico. Più danni subisce, più è pericoloso.',       skills: ['Banchetto di Sangue (P)','Emorragia','Furia Sanguinaria (P)','Marea Cremisi'] },
  living_fortress:     { name: 'Fortezza Vivente',        color: '#3b82f6', subclass: 'guardian',        flavor: 'Immune, riflette, respira. Impossibile da abbattere.',                   skills: ['Muro Assoluto','Spine','Postura del Titano','Immortalità (P)'] },
  iron_champion:       { name: 'Campione di Ferro',       color: '#1d4ed8', subclass: 'guardian',        flavor: 'Ogni battaglia lo rende più forte. Veterano eterno.',                    skills: ['Contro di Ferro','Carica Fortezza','Indissolubile','Veterano di Guerra (P)'] },
  sword_saint:         { name: 'Santo della Spada',       color: '#a78bfa', subclass: 'blade_master',    flavor: 'La perfezione con la lama. Un colpo può finire tutto.',                  skills: ['Spirito della Spada','Taglio del Vuoto','Maestria della Spada (P)','Taglio Finale'] },
  dual_blade:          { name: 'Maestro Doppia Lama',     color: '#7c3aed', subclass: 'blade_master',    flavor: 'Due lame, infiniti colpi. La danza della morte.',                        skills: ['Estrazione Doppia','Lame Uragano','Flusso Doppio (P)','Danza Finale'] },
  sky_dancer:          { name: 'Danzatore del Cielo',     color: '#10b981', subclass: 'acrobat',         flavor: 'Domina i cieli. Nessuno riesce a colpirlo dall\'alto.',                  skills: ['Cascata Infinita','Dominio del Cielo','Finalizzatore Aereo','Corpo del Vento (P)'] },
  tempest:             { name: 'Tempesta',                color: '#059669', subclass: 'acrobat',         flavor: 'Si muove come una tempesta. AoE devastante e inarrestabile.',            skills: ['Turbine','Sentiero della Tempesta','Colpo Ciclone','Uccisione in Movimento (P)'] },
  absolute_phantom:    { name: 'Fantasma Assoluto',       color: '#6366f1', subclass: 'shadow',          flavor: 'Invisibile finché non uccide. La morte non si vede arrivare.',           skills: ['Stealth Perfetto','Uccisione Sparizione','Camminata Fantasma (P)','Sentenza di Morte'] },
  illusory_blade:      { name: 'Lama Illusoria',          color: '#4338ca', subclass: 'shadow',          flavor: 'Clone, illusioni, caos. Il nemico non sa dove colpire.',                 skills: ['Clone d\'Ombra','Colpo Miraggio','Esercito Fantasma','Eco (P)'] },
  master_fencer:       { name: 'Schermidore Maestro',     color: '#f59e0b', subclass: 'duelist',         flavor: 'Ogni attacco nemico è un\'opportunità. Contatore supremo.',              skills: ['Parata Impeccabile','Tempesta di Riposte','Valzer della Lama','Re del Contro (P)'] },
  eternal_champion:    { name: 'Campione Eterno',         color: '#d97706', subclass: 'duelist',         flavor: 'Ogni vittoria lo rende più forte. Non può essere fermato.',              skills: ['Serie di Vittorie (P)','Colpo del Campione','Volontà Eterna (P)','Duello Leggendario'] },
  override_master:     { name: 'Override Master',         color: '#06b6d4', subclass: 'supreme_analyst', flavor: 'Ruba skill, copia nemici, prende il controllo. Impossibile da prevedere.',skills: ['Furto di Skill','Combattimento Specchio','Adattamento (P)','Override Totale'] },
  precision_tactician: { name: 'Tattico di Precisione',  color: '#0891b2', subclass: 'supreme_analyst', flavor: 'Calcola l\'attacco perfetto. Ogni colpo è matematicamente ottimale.',    skills: ['Formula di Combattimento','Punto di Pressione','Genio Tattico (P)','Fine Inevitabile'] },
  curse_weaver:        { name: 'Tessitore di Maledizioni',color: '#ec4899', subclass: 'manipulator',     flavor: 'Maledizioni che si amplificano. La morte lenta è la sua arte.',           skills: ['Trama Maledetta','Amplifica Maledizione','Fatalità (P)','Maledizione Finale'] },
  dominator:           { name: 'Dominatore',              color: '#be185d', subclass: 'manipulator',     flavor: 'Controlla la mente nemica. I nemici combattono per lui.',                skills: ['Maestro dei Burattini','Rottura Mentale','Dominazione (P)','Controllo Assoluto'] },
  construct_master:    { name: 'Maestro dei Costrutti',   color: '#f97316', subclass: 'artificer',       flavor: 'Esercito di costrutti. Non combatte da solo.',                           skills: ['Costrutto Maestro','Costrutti Doppi','Link Costrutto (P)','Costrutto Omega'] },
  trap_specialist:     { name: 'Specialista Trappole',    color: '#ea580c', subclass: 'artificer',       flavor: 'L\'intera mappa è la sua arma. I nemici non vanno da nessuna parte.',   skills: ['Rete di Trappole','Trappola Esplosiva','Maestro delle Trappole (P)','Labirinto di Trappole'] },
  world_ruler:         { name: 'Signore del Mondo',       color: '#eab308', subclass: 'sovereign',       flavor: 'Potere totale. +20% a tutto e comandi assoluti.',                        skills: ['Autorità del Mondo','Colpo Omni','Crescita Sovereigna (P)','Ordine del Mondo'] },
  living_legend:       { name: 'Leggenda Vivente',        color: '#ca8a04', subclass: 'sovereign',       flavor: 'I titoli diventano potere. Ogni impresa aumenta il danno.',              skills: ['Aura della Leggenda','Racconto Eroico (P)','Leggendario (P)','Fine dell\'Era'] },
  // Sacerdote T3
  angelo_custode:      { name: 'Angelo Custode',          color: '#bbf7d0', subclass: 'guaritore',       flavor: 'Resurrezione, invulnerabilità, cura totale. La morte ti evita.',          skills: ['Resurrezione (P)','Cura Celestiale','Scudo Angelico (P)','Grazia Divina'] },
  fonte_vita:          { name: 'Fonte di Vita',           color: '#86efac', subclass: 'guaritore',       flavor: 'Cura continua, overflow, vita senza limiti.',                             skills: ['Torrente di Vita','Overflow di Cura','Benedizione di Massa (P)','Vita Eterna'] },
  cavaliere_luce:      { name: 'Cavaliere della Luce',    color: '#fef08a', subclass: 'esorcista',       flavor: 'Sacro e fisico fusi. Un guerriero divino.',                               skills: ['Lancia di Luce','Armatura di Luce (P)','Crociata','Giudizio Finale'] },
  giustiziere_sacro:   { name: 'Giustiziere Sacro',       color: '#fde047', subclass: 'esorcista',       flavor: 'I debuffati muoiono. La luce giudica.',                                   skills: ['Caccia Sacra (P)','Sentenza Divina','Purgatorio','Ira dei Cieli'] },
  prescelto:           { name: 'Prescelto del Destino',   color: '#d8b4fe', subclass: 'oracolo',         flavor: 'Critico garantito, destino resettato, fato manipolato.',                  skills: ['Tiro del Destino (P)','Occhio del Fato','Scelta del Destino','Colpo Predetto'] },
  veggente_abissi:     { name: 'Veggente degli Abissi',   color: '#a855f7', subclass: 'oracolo',         flavor: 'Caos, paradossi, futuro alterato. La realtà cede.',                      skills: ['Visione del Caos','Futuro Alterato (P)','Paradosso Temporale','Fine Scritta'] },
  // Ingegnere T3
  mastro_ingegnere:    { name: 'Mastro Ingegnere',         color: '#cbd5e1', subclass: 'meccanico',       flavor: 'Doppia torretta, esoscheletro, fortezza. La macchina perfetta.',           skills: ['Doppia Torretta','Esoscheletro di Guerra','Ingegnere Supremo (P)','Fortezza Mobile'] },
  macchinista_guerra:  { name: 'Macchinista di Guerra',    color: '#94a3b8', subclass: 'meccanico',       flavor: 'Carro, bombe a catena, devastazione totale.',                             skills: ['Carro d\'Assalto','Bomba a Catena','Sistema d\'Armi (P)','Devastazione Meccanica'] },
  grande_alchimista:   { name: 'Grande Alchimista',        color: '#34d399', subclass: 'alchimista',      flavor: 'Pietra filosofale, trasmutazioni totali, pozioni divine.',                 skills: ['Pietra Filosofale','Trasmutazione Universale','Maestro delle Pozioni (P)','Acido Finale'] },
  trasmutatore:        { name: 'Trasmutatore',             color: '#10b981', subclass: 'alchimista',      flavor: 'Il dolore diventa potere. La materia obbedisce.',                         skills: ['Conversione di Materia (P)','Fusione Elementale','Rigenesi','Grande Opera'] },
  genio_creativo:      { name: 'Genio Creativo',           color: '#fb923c', subclass: 'inventore',       flavor: 'Invenzioni supreme, overload, paradossi tecnologici.',                    skills: ['Invenzione Suprema','Overload Tecnologico','Mente Brillante (P)','Paradosso dell\'Inventore'] },
  golem_master:        { name: 'Golem Master',             color: '#f97316', subclass: 'inventore',       flavor: 'Golem omega, fusione, corpo di ferro. L\'uomo macchina.',                  skills: ['Golem da Combattimento','Fusione con il Golem','Corpo di Ferro (P)','Golem Omega'] },
};

const CLASS_SUBCLASS_MAP = {
  'Mercenario': ['berserker', 'guardian', 'blade_master', 'sovereign'],
  'Scout':      ['acrobat', 'shadow', 'duelist', 'sovereign'],
  'Mago':       ['supreme_analyst', 'manipulator', 'artificer', 'sovereign'],
  'Sacerdote':  ['guaritore', 'esorcista', 'oracolo', 'sovereign'],
  'Ingegnere':  ['meccanico', 'alchimista', 'inventore', 'sovereign'],
};

const SUBCLASS_ADV_MAP = {
  berserker:       ['war_god', 'blood_reaper'],
  guardian:        ['living_fortress', 'iron_champion'],
  blade_master:    ['sword_saint', 'dual_blade'],
  acrobat:         ['sky_dancer', 'tempest'],
  shadow:          ['absolute_phantom', 'illusory_blade'],
  duelist:         ['master_fencer', 'eternal_champion'],
  supreme_analyst: ['override_master', 'precision_tactician'],
  manipulator:     ['curse_weaver', 'dominator'],
  artificer:       ['construct_master', 'trap_specialist'],
  sovereign:       ['world_ruler', 'living_legend'],
  guaritore:       ['angelo_custode', 'fonte_vita'],
  esorcista:       ['cavaliere_luce', 'giustiziere_sacro'],
  oracolo:         ['prescelto', 'veggente_abissi'],
  meccanico:       ['mastro_ingegnere', 'macchinista_guerra'],
  alchimista:      ['grande_alchimista', 'trasmutatore'],
  inventore:       ['genio_creativo', 'golem_master'],
};

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  addSystemMsg('Connessione al server in corso…');
  try {
    const [state, mapData] = await Promise.all([apiFetch('/state'), apiFetch('/world-map')]);
    currentState  = state;
    worldMapZones = mapData.zones || [];
    updateUI(state);
    fetchAndCacheQuests();

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

// ── UI Lock (Modulo 3: anti rage-click) ──────────────────────────────────────
function lockUI() {
  document.body.classList.add('ui-locked');
  chatInput.disabled = true;
  sendBtn.disabled   = true;
}

function unlockUI() {
  document.body.classList.remove('ui-locked');
  enableInput();
}

// ── Sync Toast (Modulo 3: SSE recovery) ──────────────────────────────────────
function showSyncToast(msg) {
  let toast = document.getElementById('sync-error-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'sync-error-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg || 'Errore di sincronizzazione. Ripristino del collegamento con il server centrale…';
  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), 5000);
}

// ── syncHUD (Modulo 1: ripristino HUD da /api/sync) ──────────────────────────
// Riallinea l'interfaccia allo stato server senza toccare la chat history.
// Chiamata: (a) fine boot in init(), (b) recovery dopo timeout SSE.
async function syncHUD(quiet = false) {
  try {
    const data = await apiFetch('/sync');
    if (!data.profile) return;
    // Aggiorna currentState conservando skills (non restituita da /api/sync)
    currentState = {
      ...(currentState || {}),
      profile:   data.profile,
      inventory: data.inventory,
      gameState: data.gameState,
    };
    updateUI(currentState);
    updatePlayerHUD(data.profile, data.inventory, data.gameState);
    renderTacticalTension(data.gameState?.tactical_tension || 0, data.gameState?.combat_active);
    renderParty(data.gameState?.party || []);
    if (data.announcements?.length) renderAnnouncements(data.announcements);
    if (!quiet) console.log('[syncHUD] HUD riallineato allo stato server (turn_id:', data.gameState?.current_turn_id, ')');
  } catch (e) {
    if (!quiet) console.error('[syncHUD] Fallito:', e.message);
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
const SSE_TOKEN_TIMEOUT_MS = 15_000; // 15 s senza token → recovery

async function sendToGM(message) {
  if (busy) return;
  busy = true;
  lockUI(); // Modulo 3: blocca tutti i pulsanti di interazione al primo click

  // Crea subito la bolla GM per lo streaming progressivo
  const div = document.createElement('div');
  div.className = 'message msg-gm';
  div.innerHTML = '<div class="msg-label">GM — SHANGRI-LA FRONTIER</div><div class="msg-stream-body"></div>';
  chatMessages.appendChild(div);
  scrollBottom();
  const bodyDiv = div.querySelector('.msg-stream-body');
  bodyDiv.innerHTML = '<div class="typing-dots"><span></span><span></span><span></span></div>';

  let keepBusy    = false;
  let narrativeText = '';
  let soundPlayed = false;
  let sseTimedOut = false;
  let tokenWatchdogId = null;
  let timeoutReject   = null;

  // Modulo 2: calcola il turn_id atteso (current + 1) per l'idempotency server-side
  const turn_id = (currentState?.gameState?.current_turn_id || 0) + 1;

  // Promessa che si rigetta al timeout SSE — usata in Promise.race con reader.read()
  const sseTimeoutPromise = new Promise((_, reject) => { timeoutReject = reject; });

  function resetTokenWatchdog() {
    clearTimeout(tokenWatchdogId);
    tokenWatchdogId = setTimeout(() => {
      sseTimedOut = true;
      timeoutReject(new Error('SSE_TIMEOUT'));
    }, SSE_TOKEN_TIMEOUT_MS);
  }

  try {
    const response = await fetch(API + '/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, turn_id }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(err.error || 'Errore server');
    }

    const reader  = response.body.getReader();
    const decoder = new TextDecoder();
    let sseBuffer = '';

    resetTokenWatchdog(); // avvia il primo watchdog prima del primo read

    while (true) {
      let readResult;
      try {
        // Modulo 3: gara tra il prossimo chunk e il timeout — vince il più veloce
        readResult = await Promise.race([reader.read(), sseTimeoutPromise]);
      } catch (e) {
        // Il timeout ha vinto → uscita controllata dal catch esterno
        throw e;
      }

      const { done, value } = readResult;
      if (done) break;
      sseBuffer += decoder.decode(value, { stream: true });

      const parts = sseBuffer.split('\n\n');
      sseBuffer = parts.pop();

      for (const part of parts) {
        if (!part.startsWith('data: ')) continue;
        let data;
        try { data = JSON.parse(part.slice(6)); } catch { continue; }

        if (data.type === 'token') {
          resetTokenWatchdog(); // reset watchdog ad ogni token ricevuto
          if (!soundPlayed) { playSound('message'); soundPlayed = true; }
          narrativeText += data.text;
          bodyDiv.innerHTML = marked.parse(narrativeText);
          scrollBottom();
        } else if (data.type === 'gm_mode') {
          div.remove();
          if (data.state) { currentState = data.state; updateUI(data.state); }
          keepBusy = true;
          showGMRespondPanel();
        } else if (data.type === 'combat_log') {
          renderCombatTicker(data.logs || []);
        } else if (data.type === 'done') {
          clearTimeout(tokenWatchdogId); // stream concluso — disattiva il watchdog
          if (!narrativeText && data.narrative) {
            if (!soundPlayed) { playSound('message'); soundPlayed = true; }
            narrativeText = data.narrative;
            bodyDiv.innerHTML = marked.parse(narrativeText);
          }
          currentState = data.state;
          updateUI(data.state);
          updatePlayerHUD(data.state.profile, data.state.inventory, data.state.gameState);
          if (data.tactical_tension !== undefined) renderTacticalTension(data.tactical_tension, data.state.gameState?.combat_active);
          if (data.party) renderParty(data.party);
          dispatchUIEvents(data.ui_events || []);
          if (data.ui_events?.includes('level_up')) showLevelUp(data.state.profile.level);
          if (data.ui_events?.includes('skill_unlocked') && data.new_skills?.length) {
            showSkillUnlocked(data.new_skills[data.new_skills.length - 1].name);
          }
          if (data.new_titles?.length) {
            data.new_titles.forEach((t, i) => setTimeout(() => showTitleUnlocked(t), i * 1200));
          }
          if (data.completed_quests?.length) {
            data.completed_quests.forEach((q, i) => setTimeout(() => showQuestCompleted(q), i * 1400));
            fetchAndCacheQuests();
          }
          if (data.ui_events?.includes('subclass_available')) setTimeout(() => openSubclassModal(), 1000);
          if (data.ui_events?.includes('advanced_class_available')) setTimeout(() => openAdvancedClassModal(), 1000);
          scrollBottom();
        } else if (data.type === 'error') {
          throw new Error(data.error);
        }
      }
    }
  } catch (e) {
    clearTimeout(tokenWatchdogId);
    if (!narrativeText) div.remove();

    if (sseTimedOut || e.message === 'SSE_TIMEOUT') {
      // Modulo 3 — SSE Auto-Recovery: riallinea l'HUD allo stato server e sblocca l'input
      showSyncToast();
      await syncHUD(true);
    } else {
      addSystemMsg(`⚠ ${e.message}`);
    }
  } finally {
    clearTimeout(tokenWatchdogId);
    busy = false;
    if (!keepBusy) unlockUI(); // Modulo 3: riabilita tutti i pulsanti
  }
}

function dispatchUIEvents(events) {
  events.forEach(ev => {
    if (ev === 'SCREEN_SHAKE') {
      document.body.classList.add('ui-shake');
      setTimeout(() => document.body.classList.remove('ui-shake'), 700);
    } else if (ev === 'RED_FLASH' || ev === 'HEAL_EFFECT') {
      const overlay = document.createElement('div');
      overlay.className = ev === 'RED_FLASH' ? 'ui-red-flash' : 'ui-heal-flash';
      overlay.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9999;';
      document.body.appendChild(overlay);
      setTimeout(() => overlay.remove(), 600);
    } else if (ev.startsWith('PART_BROKEN_')) {
      const part = ev.slice('PART_BROKEN_'.length).toLowerCase();
      showPartBreakToast(part);
    } else if (ev === 'loot_obtained') {
      const bagEl = document.getElementById('bag-list');
      if (bagEl) { bagEl.classList.add('loot-flash'); setTimeout(() => bagEl.classList.remove('loot-flash'), 800); }
    } else if (ev === 'puzzle_solved') {
      showPartBreakToast('puzzle risolto', '#3b82f6', '🧩');
    } else if (ev === 'GOLDEN_GLOW') {
      const overlay = document.createElement('div');
      overlay.className = 'ui-golden-flash';
      overlay.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9999;';
      document.body.appendChild(overlay);
      setTimeout(() => overlay.remove(), 900);
      showPartBreakToast('OVERDRIVE!', '#eab308', '⚡');
    } else if (ev === 'ENEMY_STAGGERED') {
      document.body.classList.add('ui-shake');
      setTimeout(() => document.body.classList.remove('ui-shake'), 700);
      showPartBreakToast('STAGGER!', '#a78bfa', '💫');
    } else if (ev.startsWith('NPC_HIT_')) {
      const npcId = ev.slice('NPC_HIT_'.length);
      const card  = document.querySelector(`[data-npc-id="${npcId}"]`);
      if (card) { card.classList.add('party-hit-flash'); setTimeout(() => card.classList.remove('party-hit-flash'), 600); }
    } else if (ev === 'PLAYER_DEATH') {
      const overlay = document.createElement('div');
      overlay.id = 'death-overlay';
      overlay.style.cssText = 'position:fixed;inset:0;background:#000;opacity:0;z-index:99999;pointer-events:none;transition:opacity 0.8s ease;display:flex;align-items:center;justify-content:center;';
      overlay.innerHTML = '<div style="color:#ef4444;font-size:32px;font-weight:900;letter-spacing:4px;text-transform:uppercase;opacity:0;transition:opacity 0.4s 0.4s">GAME OVER</div>';
      document.body.appendChild(overlay);
      requestAnimationFrame(() => {
        overlay.style.opacity = '1';
        setTimeout(() => { overlay.querySelector('div').style.opacity = '1'; }, 400);
        setTimeout(() => {
          overlay.style.opacity = '0';
          setTimeout(() => overlay.remove(), 900);
        }, 3200);
      });
    } else if (ev === 'WEAPON_BROKEN') {
      showPartBreakToast('ARMA SPEZZATA!', '#6b7280', '⚒');
      const weapSlot = document.querySelector('[data-slot="weapon"]');
      if (weapSlot) { weapSlot.classList.add('weapon-broken-flash'); setTimeout(() => weapSlot.classList.remove('weapon-broken-flash'), 1200); }
    } else if (ev.startsWith('BOSS_PHASE_')) {
      const phase = ev.slice('BOSS_PHASE_'.length);
      showPartBreakToast(`FASE ${phase}!`, '#dc2626', '⚡');
      document.body.classList.add('ui-shake');
      setTimeout(() => document.body.classList.remove('ui-shake'), 700);
    } else if (ev.startsWith('BOUNTY_READY_')) {
      const questId = ev.slice('BOUNTY_READY_'.length);
      showPartBreakToast(`Taglia completata!`, '#f59e0b', '📋');
      console.log('[Bounty] Quest pronta:', questId);
    }
  });
}

function showPartBreakToast(part, color = '#ef4444', icon = '💥') {
  const el = document.createElement('div');
  el.className = 'part-break-toast';
  el.style.setProperty('--toast-color', color);
  el.innerHTML = `${icon} <strong>${part.toUpperCase()}</strong>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 400); }, 2500);
}

// ── Tactical Tension Bar ──────────────────────────────────────────────────────
function renderTacticalTension(tension, inCombat) {
  let wrapper = document.getElementById('tension-wrapper');
  if (!inCombat) { if (wrapper) wrapper.style.display = 'none'; return; }
  if (!wrapper) {
    wrapper = document.createElement('div');
    wrapper.id = 'tension-wrapper';
    wrapper.innerHTML = `
      <div class="tension-label">⚡ Tensione Tattica <span id="tension-val">0</span>/100</div>
      <div class="tension-bar-track"><div id="tension-bar-fill" class="tension-bar-fill"></div></div>`;
    const combatPanel = document.getElementById('combat-panel');
    if (combatPanel) combatPanel.appendChild(wrapper);
    else document.body.appendChild(wrapper);
  }
  wrapper.style.display = '';
  const fill = document.getElementById('tension-bar-fill');
  const val  = document.getElementById('tension-val');
  const pct  = Math.max(0, Math.min(100, tension));
  if (fill) { fill.style.width = pct + '%'; fill.classList.toggle('tension-high', pct >= 80); }
  if (val)  val.textContent = pct;
}

// ── Party Panel ───────────────────────────────────────────────────────────────
function renderParty(party) {
  let panel = document.getElementById('party-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'party-panel';
    panel.className = 'party-panel';
    const sidebar = document.getElementById('sidebar') || document.body;
    sidebar.appendChild(panel);
  }
  if (!party || party.length === 0) { panel.style.display = 'none'; return; }
  panel.style.display = '';
  panel.innerHTML = '<div class="party-panel-title">👥 Alleati</div>' + party.map(npc => {
    const hpPct = npc.max_hp > 0 ? Math.max(0, Math.min(100, (npc.hp / npc.max_hp) * 100)) : 0;
    return `<div class="party-member-card" data-npc-id="${npc.npc_id}">
      <div class="party-member-name">${npc.name}</div>
      <div class="party-bar-track"><div class="party-bar-fill" style="width:${hpPct}%"></div></div>
      <div class="party-hp-val">${npc.hp}/${npc.max_hp} HP</div>
    </div>`;
  }).join('');
}

// ── Craft Modal ───────────────────────────────────────────────────────────────
async function openCraftModal() {
  let modal = document.getElementById('craft-modal');
  if (modal) { modal.classList.remove('hidden'); return; }

  modal = document.createElement('div');
  modal.id = 'craft-modal';
  modal.className = 'craft-modal-overlay';
  modal.innerHTML = `
    <div class="craft-modal">
      <div class="craft-modal-header">
        <span>⚒ Bottega di Goro</span>
        <button class="craft-modal-close" onclick="document.getElementById('craft-modal').classList.add('hidden')">✕</button>
      </div>
      <div id="craft-recipe-list" class="craft-recipe-list"><em>Caricamento ricette…</em></div>
    </div>`;
  document.body.appendChild(modal);

  try {
    const data = await apiFetch('/api/recipes');
    const listEl = document.getElementById('craft-recipe-list');
    if (!data.recipes || data.recipes.length === 0) {
      listEl.innerHTML = '<em>Nessuna ricetta disponibile.</em>';
      return;
    }
    listEl.innerHTML = data.recipes.map(r => {
      const reqHtml = Object.entries(r.required)
        .map(([id, qty]) => `<span class="craft-ing">${qty}× ${id.replace(/_/g,' ')}</span>`)
        .join(' ');
      const costHtml = r.money_cost ? `<span class="craft-ing">💰 ${r.money_cost} R</span>` : '';
      const btnClass = r.can_craft ? 'craft-btn' : 'craft-btn craft-btn-disabled';
      const btnAttr  = r.can_craft ? `onclick="craftItem('${r.id}')"` : 'disabled';
      return `<div class="craft-recipe-card ${r.can_craft ? '' : 'craft-unavailable'}">
        <div class="craft-recipe-name">${r.name}</div>
        <div class="craft-recipe-req">${reqHtml}${costHtml}</div>
        <div class="craft-recipe-desc">${r.description || ''}</div>
        <button class="${btnClass}" ${btnAttr}>Forgia</button>
      </div>`;
    }).join('');
  } catch (e) {
    const listEl = document.getElementById('craft-recipe-list');
    if (listEl) listEl.innerHTML = `<em>⚠ Errore: ${e.message}</em>`;
  }
}

async function craftItem(recipeId) {
  try {
    const result = await apiFetch('/api/craft', { method: 'POST', body: JSON.stringify({ recipe_id: recipeId }) });
    document.getElementById('craft-modal')?.classList.add('hidden');
    addSystemMsg(`⚒ ${result.message || 'Oggetto forgiato!'}`);
    if (result.state) { currentState = result.state; updateUI(result.state); }
  } catch (e) {
    addSystemMsg(`⚠ Craft fallito: ${e.message}`);
  }
}

// Appraisal professionale (con tariffa, stat variance, possibili proprietà speciali)
async function appraiseItem(bagIndex) {
  try {
    const result = await apiFetch('/api/appraise', { method: 'POST', body: JSON.stringify({ bag_index: bagIndex }) });
    const item = result.item;
    let msg = `🔮 "${item.name}" valutato (-${result.fee} R).`;
    if (result.special === 'cursed')     msg += ' ⚠ MALEDETTO — non rimovibile senza purificazione!';
    if (result.special === 'restricted') msg += ' ⛓ Vincolo del Predatore — armatura annullata!';
    addSystemMsg(msg);
    if (result.profile && result.inventory) {
      currentState = { ...currentState, profile: result.profile, inventory: result.inventory };
      updateUI(currentState);
    }
  } catch (e) {
    addSystemMsg(`⚠ Valutazione fallita: ${e.message}`);
  }
}

async function repairItem(slot) {
  try {
    const result = await apiFetch('/api/repair', { method: 'POST', body: JSON.stringify({ slot }) });
    addSystemMsg(`🔧 "${result.item.name}" riparata (-${result.repairCost} R, 1× frammento_ferro).`);
    if (result.profile && result.inventory) {
      currentState = { ...currentState, profile: result.profile, inventory: result.inventory };
      updateUI(currentState);
    }
  } catch (e) {
    addSystemMsg(`⚠ Riparazione fallita: ${e.message}`);
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

  document.getElementById('player-name').textContent = profile.name || '—';
  const classLabel = profile.advanced_class
    ? ADVANCED_CLASS_DATA[profile.advanced_class]?.name
    : profile.subclass
    ? SUBCLASS_DATA[profile.subclass]?.name
    : (profile.job || '?');
  document.getElementById('player-job').textContent = classLabel;
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
  if (inCombat && !prevCombatState) playSound('combat_start');
  prevCombatState = inCombat;

  // Aggiorna badge GM mode
  const gmBtn = document.getElementById('gm-mode-btn');
  if (gmBtn) gmBtn.classList.toggle('active', !!gs.gm_mode);

  const locEl = document.getElementById('location-text');
  const cityLine = (inCombat ? '⚔ ' : '🏙 ') + (gs.location || '—');
  const subLine  = gs.sub_location ? `\n📍 ${gs.sub_location}` : '';
  locEl.textContent = cityLine + subLine;
  locEl.classList.toggle('in-combat', inCombat);

  // Negozio e Bottega: abilita solo in safe zone e se personaggio creato
  shopBtn.disabled  = !profile.name || gs.zone_type !== 'safe_zone';
  if (craftBtn) craftBtn.disabled = !profile.name || gs.zone_type !== 'safe_zone';

  const quests = gs.quests_active || [];
  document.getElementById('quest-section').style.display = quests.length ? '' : 'none';
  updatePinnedQuestHUD(profile);

  renderEnemy(inCombat ? gs.current_enemy : null);
  renderCombatLog(gs.combat_log_entries || [], inCombat);
  renderEquipment(inventory.equipped || {});
  renderSkills(gs.skill_loadout || [], profile.skill_slots || 4, profile.skill_cooldowns || {});
  renderBag(inventory.bag || []);
  renderTitles(profile.titles || []);
  renderStatusEffects(profile.status_effects || []);
  renderReputation(profile.reputation || {});
}

function setBar(name, current, max) {
  const fill = document.getElementById(`bar-${name}`);
  const val  = document.getElementById(`${name}-val`);
  if (!fill || !val) return;
  const pct = max > 0 ? Math.max(0, Math.min(100, (current / max) * 100)) : 0;
  fill.style.width = pct + '%';
  val.textContent = `${current}/${max}`;
}

// ── Titles ────────────────────────────────────────────────────────────────────
function renderTitles(titles) {
  const section = document.getElementById('titles-section');
  const list    = document.getElementById('titles-list');
  if (!section || !list) return;
  if (!titles.length) { section.style.display = 'none'; return; }
  section.style.display = '';
  list.innerHTML = titles.slice(-5).map(t =>
    `<div class="title-badge">${t.name}</div>`
  ).join('');
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
  const bag = currentState?.inventory?.bag || [];
  const hasMaterials = bag.some(it => it.type === 'material');
  document.getElementById('equipment-slots').innerHTML =
    Object.entries(SLOT_LABELS).map(([key, label]) => {
      const item = equipped[key];
      if (!item) return `<div class="equip-slot" data-slot="${key}"><span class="equip-slot-name">${label}</span><span class="equip-slot-empty">vuoto</span></div>`;
      const enh = item.enhancement_level || 0;
      const canEnh = hasMaterials && item.type !== 'consumable' && enh < 5;
      const enhBadge = enh > 0 ? ` <span class="bag-enhance-badge">+${enh}</span>` : '';
      const cursedBadge = item.cursed ? ` <span class="cursed-badge" title="Maledetto">💀</span>` : '';
      // Barra durabilità per armi
      let durBar = '';
      if (item.type === 'weapon') {
        const maxDur = item.max_durability || 40;
        const curDur = item.broken ? 0 : (item.durability ?? maxDur);
        const durPct = maxDur > 0 ? Math.max(0, Math.min(100, (curDur / maxDur) * 100)) : 100;
        const durClass = item.broken ? 'dur-broken' : curDur <= maxDur * 0.25 ? 'dur-low' : '';
        const hasMat = bag.some(it => it.id === 'frammento_ferro');
        const inSafe = currentState?.gameState?.zone_type === 'safe_zone';
        const canRepair = (item.broken || curDur < maxDur) && hasMat && inSafe;
        durBar = `<div class="dur-bar-track" title="${curDur}/${maxDur} durabilità">
          <div class="dur-bar-fill ${durClass}" style="width:${durPct}%"></div>
        </div>${canRepair ? `<button class="repair-btn" onclick="repairItem('${key}')" title="Ripara">🔧</button>` : ''}`;
      }
      return `<div class="equip-slot${item.broken ? ' slot-broken' : ''}" data-slot="${key}">
        <span class="equip-slot-name">${label}</span>
        <span class="equip-slot-item">${item.name}${enhBadge}${cursedBadge}</span>
        ${durBar}
        <div style="display:flex;gap:3px">
          ${canEnh ? `<button class="equip-enh-btn" onclick="enhanceItem('${key}',null)" title="Potenzia">✦</button>` : ''}
          <button class="equip-unequip-btn" onclick="unequipItem('${key}')" title="Rimuovi">✕</button>
        </div>
      </div>`;
    }).join('');
}

function renderSkills(loadout, maxSlots, cooldowns = {}) {
  const cards = loadout.map(sk => {
    const cost      = Object.entries(sk.cost||{}).map(([k,v])=>`${k}:${v}`).join('  ');
    const cd        = cooldowns[sk.id] || 0;
    const onCd      = cd > 0;
    const cdOverlay = onCd
      ? `<div class="skill-cd-overlay">${cd}T</div>`
      : '';
    return `<div class="skill-card${onCd ? ' skill-on-cd' : ''}">
      ${cdOverlay}
      <div class="skill-card-name">${sk.name}</div>
      <div class="skill-card-cost">${cost}</div>
      ${sk.effect ? `<div class="skill-card-effect">${sk.effect}</div>` : ''}
    </div>`;
  });
  for (let i = 0; i < Math.max(0, maxSlots - loadout.length); i++) cards.push(`<div class="skill-slot-empty">slot vuoto</div>`);
  document.getElementById('skill-slots').innerHTML = cards.join('');
}

// Aggiorna HUD vitali, borsa e skill con cooldown — chiamata separata nel done handler
function updatePlayerHUD(profile, inventory, gameState) {
  if (!profile?.stats) return;
  setBar('hp',  profile.stats.HP.current,  profile.stats.HP.max);
  setBar('mp',  profile.stats.MP.current,  profile.stats.MP.max);
  setBar('stm', profile.stats.STM.current, profile.stats.STM.max);
  renderBag(inventory?.bag || []);
  renderSkills(gameState?.skill_loadout || [], profile.skill_slots || 4, profile.skill_cooldowns || {});
}

function renderBag(bag) {
  const el = document.getElementById('bag-list');
  if (!bag.length) { el.innerHTML = '<div class="bag-empty">borsa vuota</div>'; return; }
  el.innerHTML = bag.map((item, i) => {
    const name = item.name || item;
    const qty  = item.quantity;
    const isUnknown    = item.appraised === false;
    const isConsumable = item.type === 'consumable';
    const isEquippable = item.slot && item.slot !== 'null' && !isConsumable;

    const enh = item.enhancement_level || 0;
    const hasMaterials = !isUnknown && (currentState?.inventory?.bag || []).some(it => it.type === 'material');
    const canEnhance   = !isUnknown && !isConsumable && item.type !== 'material' && enh < 5 && hasMaterials;

    let actionBtn = '';
    if (isUnknown) {
      actionBtn = `<button class="bag-item-btn bag-appraise-btn" onclick="appraiseItem(${i})">Valuta</button>`;
    } else if (isConsumable) {
      actionBtn = `<button class="bag-item-btn bag-use-btn" onclick="useItem(${i})">Usa</button>`;
    } else if (isEquippable) {
      actionBtn = `<button class="bag-item-btn bag-equip-btn" onclick="equipItem(${i})">Equipa</button>`;
    } else if (item.type === 'material') {
      actionBtn = `<span class="bag-material-tag">materiale</span>`;
    }
    if (canEnhance) {
      actionBtn += `<button class="bag-item-btn bag-enhance-btn" onclick="enhanceItem(null,${i})" title="Potenzia">✦</button>`;
    }

    const nameHtml = isUnknown
      ? `${name} <span class="bag-unknown-badge">?</span>`
      : enh > 0
        ? `${name} <span class="bag-enhance-badge">+${enh}</span>`
        : name;

    return `<div class="bag-item${isUnknown ? ' bag-item-unknown' : ''}">
      <div class="bag-item-main">
        <span class="bag-item-name">${nameHtml}</span>
        ${qty > 1 ? `<span class="bag-item-qty">×${qty}</span>` : ''}
      </div>
      ${actionBtn}
    </div>`;
  }).join('');
}

// ── Status Effects ────────────────────────────────────────────────────────────
const STATUS_TYPE_CLASS = { buff: 'status-buff', debuff: 'status-debuff' };

function renderStatusEffects(effects) {
  const section = document.getElementById('status-effects-section');
  const list    = document.getElementById('status-effects-list');
  if (!section || !list) return;
  if (!effects || !effects.length) { section.style.display = 'none'; return; }
  section.style.display = '';
  list.innerHTML = effects.map(s => {
    const cls = STATUS_TYPE_CLASS[s.type] || 'status-debuff';
    return `<div class="status-pill ${cls}" style="--status-color:${s.color || '#ef4444'}">
      <span class="status-pill-dot"></span>
      <span class="status-pill-name">${s.name}</span>
      <span class="status-pill-turns">${s.turns_remaining}t</span>
    </div>`;
  }).join('');
}

// ── Reputation ────────────────────────────────────────────────────────────────
const REP_FACTIONS_UI = [
  { id: 'hunters_guild', label: 'Gilda Cacciatori' },
  { id: 'merchants',     label: 'Mercanti' },
  { id: 'city_guard',    label: 'Guardie' },
  { id: 'scholars',      label: 'Studiosi' },
  { id: 'underground',   label: 'Sotterranei' },
];

function repLabelUI(val) {
  if (val <= -51) return { text: 'Nemico',     color: '#ef4444' };
  if (val <= -11) return { text: 'Diffidente', color: '#f59e0b' };
  if (val <=  10) return { text: 'Neutrale',   color: '#6b7280' };
  if (val <=  50) return { text: 'Amico',      color: '#3b82f6' };
  return             { text: 'Alleato',     color: '#22c55e' };
}

function renderReputation(reputation) {
  const section = document.getElementById('reputation-section');
  const list    = document.getElementById('reputation-list');
  if (!section || !list) return;
  const rep = reputation || {};
  const hasAny = REP_FACTIONS_UI.some(f => (rep[f.id] || 0) !== 0);
  if (!hasAny) { section.style.display = 'none'; return; }
  section.style.display = '';
  list.innerHTML = REP_FACTIONS_UI.map(f => {
    const val = rep[f.id] || 0;
    const { text, color } = repLabelUI(val);
    const pct = Math.max(0, Math.min(100, (val + 100) / 2));
    return `<div class="rep-row">
      <span class="rep-name">${f.label}</span>
      <div class="rep-bar-track"><div class="rep-bar-fill" style="width:${pct}%;background:${color}"></div></div>
      <span class="rep-label" style="color:${color}">${text}</span>
    </div>`;
  }).join('');
}

// ── Enhancement ───────────────────────────────────────────────────────────────
async function enhanceItem(slot, bagIndex) {
  if (!currentState) return;
  const bag = currentState.inventory.bag || [];
  const materialIndices = bag.map((it, i) => ({ it, i })).filter(({ it }) => it.type === 'material');
  if (!materialIndices.length) { addSystemMsg('⚠ Nessun materiale in borsa per il potenziamento.'); return; }

  const matList = materialIndices.map(({ it, i }) => `[${i}] ${it.name} (${it.rarity})`).join('\n');
  const matChoice = prompt(`Scegli il materiale da usare (inserisci il numero indice):\n${matList}`);
  if (matChoice === null) return;
  const matIdx = parseInt(matChoice);
  if (isNaN(matIdx) || !materialIndices.find(m => m.i === matIdx)) { addSystemMsg('⚠ Indice materiale non valido.'); return; }

  const body = slot
    ? { slot, material_bag_index: matIdx }
    : { bag_index: bagIndex, material_bag_index: matIdx };

  try {
    const data = await apiFetch('/enhance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    currentState.profile   = data.profile;
    currentState.inventory = data.inventory;
    updateUI(currentState);
    addSystemMsg(`✦ ${data.itemName} potenziato a +${data.newLevel} (-${data.cost} R).`);
    if (data.profile.money <= 50) addSystemMsg('⚠ Ragne in esaurimento.');
  } catch (e) { addSystemMsg(`⚠ ${e.message}`); }
}

async function appraiseItem(index) {
  try {
    const data = await apiFetch('/appraise-item', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bag_index: index }),
    });
    if (data.result === 'success') {
      currentState.inventory = data.inventory;
      updateUI(currentState);
      addSystemMsg(`✓ ${data.text}`);
      if (data.item) addSystemMsg(`→ ${data.item.name}: ${Object.entries(data.item.stat_bonus || {}).map(([k,v])=>`${k} +${v}`).join(', ') || 'nessun bonus stat'} (${data.item.rarity})`);
    } else {
      addSystemMsg(`⚠ ${data.text}`);
    }
  } catch (e) { addSystemMsg(`⚠ ${e.message}`); }
}

// ── Equip / Unequip / Use ─────────────────────────────────────────────────────
async function equipItem(index) {
  try {
    const data = await apiFetch('/equip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bag_index: index }),
    });
    currentState.profile   = data.profile;
    currentState.inventory = data.inventory;
    updateUI(currentState);
    addSystemMsg(`Equipaggiato: ${data.itemName}`);
  } catch (e) { addSystemMsg(`⚠ ${e.message}`); }
}

async function unequipItem(slot) {
  try {
    const data = await apiFetch('/unequip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slot }),
    });
    currentState.profile   = data.profile;
    currentState.inventory = data.inventory;
    updateUI(currentState);
    addSystemMsg(`${data.itemName} rimosso dall'equipaggiamento.`);
  } catch (e) { addSystemMsg(`⚠ ${e.message}`); }
}

async function useItem(index) {
  try {
    const data = await apiFetch('/use-item', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bag_index: index }),
    });
    currentState.profile   = data.profile;
    currentState.inventory = data.inventory;
    updateUI(currentState);
    if (data.effects?.hp > 0) playSound('heal');
    const suffix = data.effects_text ? ` (${data.effects_text})` : '';
    addSystemMsg(`${data.itemName} usato.${suffix}`);
  } catch (e) { addSystemMsg(`⚠ ${e.message}`); }
}

// ── Chat ──────────────────────────────────────────────────────────────────────
function addGMMsg(narrative, isHistory=false) {
  if (!isHistory) playSound('message');
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
  playSound('levelup');
  const toast = document.getElementById('levelup-toast');
  document.getElementById('lu-level').textContent = `Lv.${level}`;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 3400);
}

function showSkillUnlocked(skillName) {
  playSound('message');
  const toast = document.getElementById('skill-toast');
  document.getElementById('skill-toast-name').textContent = skillName || '—';
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 3000);
}

function showTitleUnlocked(title) {
  playSound('levelup');
  const toast = document.getElementById('title-toast');
  document.getElementById('title-toast-name').textContent = title?.name || '—';
  const rewardEl = document.getElementById('title-toast-reward');
  const stats = title?.rewards?.stats || {};
  const parts = Object.entries(stats).map(([k, v]) => `${k} +${v}`);
  rewardEl.textContent = parts.length ? parts.join(' · ') : '';
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 4000);
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
  const gs = currentState?.gameState;
  if (gs?.zone_type === 'dungeon' && gs?.current_dungeon_id) {
    renderDungeonMap(gs);
  } else {
    const currentZone = getCurrentZone();
    document.getElementById('map-modal-title').textContent = 'MAPPA DEL MONDO';
    document.getElementById('map-legend-bar').innerHTML =
      '<span class="legend-dot safe"></span>Città <span class="legend-dot combat"></span>Zona combat <span class="legend-dot dungeon"></span>Dungeon <span class="legend-dot boss"></span>Boss';
    document.getElementById('map-edit-btn').style.display = '';
    document.getElementById('map-modal-sub').textContent = 'Clicca su una zona per spostarti';
    document.getElementById('map-svg-container').innerHTML =
      buildMapSVG(worldMapZones, currentZone?.id || null);
  }
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
if (craftBtn) craftBtn.addEventListener('click', openCraftModal);

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
    const data = await apiFetch('/allocate', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({allocations:saAlloc}) });
    const freshState = await apiFetch('/state');
    currentState = freshState;
    updateUI(freshState);
    closeModal('modal-stats');
    addSystemMsg(`Punti distribuiti: ${Object.entries(saAlloc).filter(([,v])=>v>0).map(([k,v])=>`${k}+${v}`).join(', ')}`);
    if (data.new_skills?.length) {
      data.new_skills.forEach((sk, i) => setTimeout(() => showSkillUnlocked(sk.name), i * 800));
    }
    if (data.new_titles?.length) {
      data.new_titles.forEach((t, i) => setTimeout(() => showTitleUnlocked(t), (data.new_skills?.length || 0) * 800 + i * 1200));
    }
    if (data.subclass_available)       setTimeout(() => openSubclassModal(),       1200);
    if (data.advanced_class_available) setTimeout(() => openAdvancedClassModal(), 1200);
  } catch (e) { addSystemMsg(`⚠ ${e.message}`); closeModal('modal-stats'); }
}

document.getElementById('sa-confirm').addEventListener('click', confirmStatAlloc);
document.getElementById('sa-cancel').addEventListener('click',  () => closeModal('modal-stats'));
openStatsModal.addEventListener('click', openStatModal);
statPointsBox.addEventListener('click',  openStatModal);

// ────────────────────────────────────────────────────────────────────────────
// SKILL TREE VIEW
// ────────────────────────────────────────────────────────────────────────────
const BASE_BRANCH_LABELS = { base:'Base', STR:'Forza', DEX:'Destrezza', AGI:'Agilità', TEC:'Tecnica', VIT:'Vitalità', LUC:'Fortuna', unique:'Unici', special:'Speciali' };
const BASE_BRANCH_ORDER  = ['base','STR','DEX','AGI','TEC','VIT','LUC','unique','special'];

function renderSkillTree() {
  if (!currentState) return;
  const { profile, skills } = currentState;
  const learnedIds = new Set(skills.skills.filter(s => s.unlocked_by_default || s.learned).map(s => s.id));

  // Dynamic branch order: base + class-base + player's T2/T3 branches
  const branchOrder = [...BASE_BRANCH_ORDER];
  if (profile.job) branchOrder.splice(branchOrder.indexOf('special'), 0, `${profile.job.toLowerCase()}_base`);
  if (profile.subclass)       branchOrder.push(`t2_${profile.subclass}`);
  if (profile.advanced_class) branchOrder.push(`t3_${profile.advanced_class}`);

  // Branch labels including class-base, T2/T3
  const branchLabels = { ...BASE_BRANCH_LABELS };
  if (profile.job) branchLabels[`${profile.job.toLowerCase()}_base`] = `${profile.job} (Base)`;
  if (profile.subclass)       branchLabels[`t2_${profile.subclass}`]       = `${SUBCLASS_DATA[profile.subclass]?.name || profile.subclass} (T2)`;
  if (profile.advanced_class) branchLabels[`t3_${profile.advanced_class}`] = `${ADVANCED_CLASS_DATA[profile.advanced_class]?.name || profile.advanced_class} (T3)`;

  const byBranch = {};
  branchOrder.forEach(b => { byBranch[b] = []; });
  skills.skills.forEach(sk => {
    const b = sk.branch || 'base';
    if (!byBranch[b]) byBranch[b] = [];
    byBranch[b].push(sk);
  });

  return branchOrder
    .filter(b => byBranch[b].length)
    .map(b => {
      const cards = byBranch[b].map(sk => {
        const isLearned = learnedIds.has(sk.id);
        const req = sk.requirements || {};
        const statOk  = !req.stats          || Object.entries(req.stats).every(([s, v]) => (profile.stats[s] || 0) >= v);
        const skillOk = !req.skill          || learnedIds.has(req.skill);
        const titleOk = !req.title          || (profile.titles || []).some(t => t.id === req.title);
        const subclOk = !req.subclass       || profile.subclass       === req.subclass;
        const advclOk = !req.advanced_class || profile.advanced_class === req.advanced_class;
        const avail   = statOk && skillOk && titleOk && subclOk && advclOk;

        const reqParts = [];
        if (req.stats)          Object.entries(req.stats).forEach(([s,v]) => reqParts.push(`${s} ≥ ${v}`));
        if (req.skill)          { const p = skills.skills.find(s2=>s2.id===req.skill); reqParts.push(`Req: ${p?.name||req.skill}`); }
        if (req.title)          reqParts.push('Titolo richiesto');
        if (req.subclass)       reqParts.push(`Spec: ${SUBCLASS_DATA[req.subclass]?.name||req.subclass}`);
        if (req.advanced_class) reqParts.push(`Classe: ${ADVANCED_CLASS_DATA[req.advanced_class]?.name||req.advanced_class}`);

        const costText  = Object.entries(sk.cost||{}).map(([k,v])=>`${k}:${v}`).join(' ');
        const cls       = isLearned ? 'tree-learned' : avail ? 'tree-available' : 'tree-locked';
        const icon      = isLearned ? '✓' : avail ? '◈' : '⬡';
        const isPassive = sk.type === 'passive';

        return `<div class="tree-skill ${cls}">
          <div class="tree-skill-head">
            <span class="tree-skill-icon">${icon}</span>
            <span class="tree-skill-name">${sk.name}</span>
            ${isPassive ? '<span class="tree-passive-tag">P</span>' : ''}
          </div>
          ${costText ? `<div class="tree-skill-cost">${costText}</div>` : ''}
          <div class="tree-skill-effect">${sk.effect}</div>
          ${reqParts.length ? `<div class="tree-skill-req">${reqParts.join(' · ')}</div>` : ''}
        </div>`;
      }).join('');

      // Branch color from class data
      let branchColor = '';
      if (b.startsWith('t2_')) {
        const sc = b.slice(3);
        branchColor = `style="--branch-color:${SUBCLASS_DATA[sc]?.color||'var(--accent)'}"`;
      } else if (b.startsWith('t3_')) {
        const ac = b.slice(3);
        branchColor = `style="--branch-color:${ADVANCED_CLASS_DATA[ac]?.color||'var(--accent)'}"`;
      }

      return `<div class="tree-branch" ${branchColor}>
        <div class="tree-branch-label">${branchLabels[b]}</div>
        ${cards}
      </div>`;
    }).join('');
}

let skillModalTab = 'loadout';

function switchSkillTab(tab) {
  skillModalTab = tab;
  document.getElementById('sk-tab-loadout').classList.toggle('active', tab === 'loadout');
  document.getElementById('sk-tab-tree').classList.toggle('active', tab === 'tree');
  document.getElementById('sl-list').classList.toggle('hidden', tab !== 'loadout');
  document.getElementById('skill-tree-panel').classList.toggle('hidden', tab !== 'tree');
  document.getElementById('modal-skills-actions').classList.toggle('hidden', tab !== 'loadout');
  if (tab === 'tree') {
    document.getElementById('skill-tree-panel').innerHTML = renderSkillTree() || '<div style="color:var(--text-dim);padding:20px;font-style:italic">Nessuna skill disponibile.</div>';
  }
}

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
  skillModalTab = 'loadout';
  document.getElementById('sk-tab-loadout').classList.add('active');
  document.getElementById('sk-tab-tree').classList.remove('active');
  document.getElementById('sl-list').classList.remove('hidden');
  document.getElementById('skill-tree-panel').classList.add('hidden');
  document.getElementById('modal-skills-actions').classList.remove('hidden');
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
// SOUND SYSTEM (Web Audio API sintetizzata, zero file audio)
// ────────────────────────────────────────────────────────────────────────────
let soundEnabled = true;
let _audioCtx    = null;

function getAudioCtx() {
  if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return _audioCtx;
}

function playNote(freq, type, startTime, duration, gain) {
  try {
    const ctx  = getAudioCtx();
    const osc  = ctx.createOscillator();
    const vol  = ctx.createGain();
    osc.connect(vol);
    vol.connect(ctx.destination);
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime + startTime);
    vol.gain.setValueAtTime(gain, ctx.currentTime + startTime);
    vol.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startTime + duration);
    osc.start(ctx.currentTime + startTime);
    osc.stop(ctx.currentTime + startTime + duration);
  } catch { /* browser senza Web Audio */ }
}

function playSound(type) {
  if (!soundEnabled) return;
  switch (type) {
    case 'message':
      playNote(660, 'sine', 0, 0.12, 0.1);
      break;
    case 'levelup':
      [261, 330, 392, 523, 659].forEach((f, i) => playNote(f, 'sine', i * 0.1, 0.3, 0.25));
      break;
    case 'combat_start':
      playNote(140, 'sawtooth', 0,    0.12, 0.22);
      playNote(110, 'square',   0.06, 0.18, 0.18);
      playNote(185, 'sawtooth', 0.14, 0.22, 0.15);
      break;
    case 'damage':
      playNote(90,  'sawtooth', 0,    0.08, 0.28);
      playNote(65,  'square',   0.06, 0.14, 0.2);
      break;
    case 'heal':
      playNote(523, 'sine', 0,   0.1,  0.14);
      playNote(659, 'sine', 0.1, 0.15, 0.11);
      break;
  }
}

document.getElementById('sound-btn').addEventListener('click', () => {
  soundEnabled = !soundEnabled;
  const btn = document.getElementById('sound-btn');
  btn.textContent = soundEnabled ? '🔊' : '🔇';
  btn.classList.toggle('active', soundEnabled);
  btn.title = soundEnabled ? 'Suoni attivi' : 'Suoni disattivati';
});

// ────────────────────────────────────────────────────────────────────────────
// MODALITÀ GM UMANO
// ────────────────────────────────────────────────────────────────────────────
function showGMRespondPanel() {
  waitingForGM = true;
  document.getElementById('gm-respond-panel').classList.remove('hidden');
  document.getElementById('gm-narrative-input').value = '';
  document.getElementById('gm-narrative-input').focus();
}

function hideGMRespondPanel() {
  waitingForGM = false;
  document.getElementById('gm-respond-panel').classList.add('hidden');
}

document.getElementById('gm-mode-btn').addEventListener('click', async () => {
  try {
    const data = await apiFetch('/gm-mode', { method: 'POST' });
    document.getElementById('gm-mode-btn').classList.toggle('active', data.gm_mode);
    document.getElementById('gm-mode-btn').title = data.gm_mode ? 'Disattiva GM umano' : 'Attiva GM umano';
    addSystemMsg(data.gm_mode ? '🎭 Modalità GM umano attivata.' : '🤖 Modalità AI attivata.');
    if (!data.gm_mode) hideGMRespondPanel();
  } catch (e) { addSystemMsg(`⚠ ${e.message}`); }
});

document.getElementById('gm-respond-btn').addEventListener('click', async () => {
  const narrative = document.getElementById('gm-narrative-input').value.trim();
  if (!narrative) return;
  hideGMRespondPanel();
  try {
    const data = await apiFetch('/gm-respond', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ narrative }),
    });
    addGMMsg(data.narrative);
    currentState = data.state;
    updateUI(data.state);
  } catch (e) { addSystemMsg(`⚠ ${e.message}`); }
  enableInput();
});

// ────────────────────────────────────────────────────────────────────────────
// CONFIGURATORE MAPPA
// ────────────────────────────────────────────────────────────────────────────
let mapConfigZones = [];
let editingZoneId  = undefined; // undefined=niente, null=nuova zona, string=id zona esistente

const ZONE_TYPES = { safe: 'Città / HUB', combat: 'Zona Combat', dungeon: 'Dungeon', boss: 'Boss' };

function openMapConfigurator() {
  mapConfigZones = JSON.parse(JSON.stringify(worldMapZones));
  editingZoneId  = undefined;
  renderConfigModal();
  document.getElementById('modal-map-config').classList.remove('hidden');
}

function renderConfigModal() {
  const listEl = document.getElementById('config-zone-list');

  listEl.innerHTML = mapConfigZones.map(z => `
    <div class="config-zone-row${editingZoneId === z.id ? ' selected' : ''}" onclick="selectZoneEdit('${z.id}')">
      <div class="config-zone-info">
        <span class="config-zone-name">${z.name}</span>
        <span class="config-zone-tier">${z.type} · ${z.tier}</span>
      </div>
      <button class="config-zone-del" onclick="event.stopPropagation();deleteConfigZone('${z.id}')" title="Elimina">✕</button>
    </div>
  `).join('') + `<button class="config-add-btn" onclick="selectZoneEdit(null)">+ Nuova Zona</button>`;

  const formEl = document.getElementById('config-zone-form');
  if (editingZoneId === undefined) {
    formEl.innerHTML = '<div class="config-placeholder">Seleziona una zona da modificare o aggiungi una nuova.</div>';
  } else {
    renderZoneForm(editingZoneId);
  }
}

function selectZoneEdit(id) {
  editingZoneId = id;
  renderConfigModal();
}

function renderZoneForm(id) {
  const formEl = document.getElementById('config-zone-form');
  const zone   = (id !== null) ? mapConfigZones.find(z => z.id === id) : null;
  const others = mapConfigZones.filter(z => z.id !== id);

  const connsHtml = others.length
    ? others.map(z => {
        const checked = zone?.connections?.includes(z.id) ? 'checked' : '';
        return `<label class="conn-label"><input type="checkbox" class="conn-check" value="${z.id}" ${checked}> ${z.name}</label>`;
      }).join('')
    : '<span style="color:var(--text-dim);font-size:11px;font-style:italic">Aggiungi prima altre zone.</span>';

  formEl.innerHTML = `
    <div class="form-title">${zone ? 'MODIFICA: ' + zone.name : 'NUOVA ZONA'}</div>
    <div class="form-row"><label>Nome</label><input id="zf-name" class="form-input" value="${zone?.name || ''}" placeholder="Nome zona"></div>
    <div class="form-row"><label>Sottotitolo</label><input id="zf-sub" class="form-input" value="${zone?.subtitle || ''}" placeholder="es. Zona F–E, Dungeon livello 15+"></div>
    <div class="form-row">
      <label>Tipo</label>
      <select id="zf-type" class="form-input">
        ${Object.entries(ZONE_TYPES).map(([v, l]) => `<option value="${v}"${zone?.type === v ? ' selected' : ''}>${l}</option>`).join('')}
      </select>
    </div>
    <div class="form-row"><label>Tier</label><input id="zf-tier" class="form-input" value="${zone?.tier || 'F'}" placeholder="es. HUB, F-E, B-A, SS"></div>
    <div class="form-row-3">
      <div class="form-row"><label>X (0-500)</label><input id="zf-x" class="form-input" type="number" min="0" max="500" value="${zone?.x ?? 250}"></div>
      <div class="form-row"><label>Y (0-450)</label><input id="zf-y" class="form-input" type="number" min="0" max="450" value="${zone?.y ?? 225}"></div>
      <div class="form-row"><label>Raggio</label><input id="zf-r" class="form-input" type="number" min="10" max="40" value="${zone?.r ?? 18}"></div>
    </div>
    <div class="form-section-label">Connessioni</div>
    <div class="conn-grid">${connsHtml}</div>
    <button class="btn-primary form-save-btn" onclick="saveZoneForm()">Salva Zona</button>
  `;
}

function saveZoneForm() {
  const name = document.getElementById('zf-name')?.value.trim();
  if (!name) { addSystemMsg('⚠ Il nome zona è obbligatorio.'); return; }

  const id = (editingZoneId !== null && editingZoneId !== undefined)
    ? editingZoneId
    : name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');

  const connections = [...document.querySelectorAll('.conn-check:checked')].map(el => el.value);

  const zone = {
    id,
    name,
    subtitle:    document.getElementById('zf-sub')?.value.trim() || '',
    type:        document.getElementById('zf-type')?.value || 'combat',
    tier:        document.getElementById('zf-tier')?.value.trim() || 'F',
    x:           parseInt(document.getElementById('zf-x')?.value) || 250,
    y:           parseInt(document.getElementById('zf-y')?.value) || 225,
    r:           parseInt(document.getElementById('zf-r')?.value) || 18,
    connections,
  };

  const idx = mapConfigZones.findIndex(z => z.id === id);
  if (idx >= 0) mapConfigZones[idx] = zone;
  else          mapConfigZones.push(zone);

  editingZoneId = id;
  renderConfigModal();
  addSystemMsg(`Zona "${name}" aggiornata. Premi "Salva Mappa" per confermare.`);
}

function deleteConfigZone(id) {
  const zone = mapConfigZones.find(z => z.id === id);
  if (!zone || !confirm(`Eliminare la zona "${zone.name}"?`)) return;
  mapConfigZones = mapConfigZones.filter(z => z.id !== id);
  mapConfigZones.forEach(z => { z.connections = (z.connections || []).filter(c => c !== id); });
  if (editingZoneId === id) editingZoneId = undefined;
  renderConfigModal();
}

async function saveMapConfig() {
  try {
    await apiFetch('/world-map', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ zones: mapConfigZones }),
    });
    worldMapZones = JSON.parse(JSON.stringify(mapConfigZones));
    closeModal('modal-map-config');
    addSystemMsg(`✓ Mappa salvata: ${mapConfigZones.length} zone.`);
  } catch (e) { addSystemMsg(`⚠ ${e.message}`); }
}

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

// ────────────────────────────────────────────────────────────────────────────
// SELEZIONE CLASSE (T2 / T3)
// ────────────────────────────────────────────────────────────────────────────
function openSubclassModal() {
  if (!currentState) return;
  if (currentState.profile.subclass) return; // già scelto
  const job  = currentState.profile.job || '';
  const opts = (CLASS_SUBCLASS_MAP[job] || Object.keys(SUBCLASS_DATA));
  const el   = document.getElementById('subclass-options');
  el.innerHTML = opts.map(id => {
    const d = SUBCLASS_DATA[id];
    if (!d) return '';
    return `<div class="class-option-card" onclick="confirmSubclass('${id}')" style="--opt-color:${d.color}">
      <div class="class-opt-color-bar" style="background:${d.color}"></div>
      <div class="class-opt-name">${d.name}</div>
      <div class="class-opt-flavor">${d.flavor}</div>
      <div class="class-opt-skills">${d.skills.map(s=>`<div class="class-opt-skill">◈ ${s}</div>`).join('')}</div>
    </div>`;
  }).join('');
  document.getElementById('modal-subclass').classList.remove('hidden');
}

function openAdvancedClassModal() {
  if (!currentState) return;
  if (currentState.profile.advanced_class) return;
  const subclass = currentState.profile.subclass;
  if (!subclass) return;
  const opts = SUBCLASS_ADV_MAP[subclass] || [];
  const el   = document.getElementById('advanced-class-options');
  el.innerHTML = opts.map(id => {
    const d = ADVANCED_CLASS_DATA[id];
    if (!d) return '';
    return `<div class="class-option-card" onclick="confirmAdvancedClass('${id}')" style="--opt-color:${d.color}">
      <div class="class-opt-color-bar" style="background:${d.color}"></div>
      <div class="class-opt-name">${d.name}</div>
      <div class="class-opt-flavor">${d.flavor}</div>
      <div class="class-opt-skills">${d.skills.map(s=>`<div class="class-opt-skill">◈ ${s}</div>`).join('')}</div>
    </div>`;
  }).join('');
  document.getElementById('modal-advanced-class').classList.remove('hidden');
}

// ────────────────────────────────────────────────────────────────────────────
// NPC MODAL
// ────────────────────────────────────────────────────────────────────────────
document.getElementById('npc-btn').addEventListener('click', openNpcModal);

async function openNpcModal() {
  document.getElementById('modal-npc').classList.remove('hidden');
  document.getElementById('npc-list').innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-dim);font-style:italic">Caricamento…</div>';
  try {
    const data = await apiFetch('/npcs');
    renderNpcs(data.npcs || []);
  } catch (e) {
    document.getElementById('npc-list').innerHTML = `<div style="padding:20px;text-align:center;color:var(--enemy)">⚠ ${e.message}</div>`;
  }
}

function renderNpcs(npcs) {
  const el = document.getElementById('npc-list');
  if (!npcs.length) {
    el.innerHTML = '<div class="npc-empty">Nessun NPC incontrato ancora. Esplora e parla con gli abitanti del mondo!</div>';
    return;
  }
  const gs = currentState?.gameState;
  el.innerHTML = npcs.map(n => {
    const { text: relText, color: relColor } = repLabelUI(n.relationship || 0);
    const isHere = gs && (n.last_seen === gs.location || n.location === gs.location);
    return `<div class="npc-card${isHere ? ' npc-here' : ''}">
      <div class="npc-card-header">
        <span class="npc-name">${n.name}</span>
        ${isHere ? '<span class="npc-here-badge">qui ora</span>' : ''}
        <span class="npc-faction">${n.faction || '—'}</span>
      </div>
      <div class="npc-rel-row">
        <div class="rep-bar-track" style="flex:1"><div class="rep-bar-fill" style="width:${Math.max(0,Math.min(100,(n.relationship+100)/2))}%;background:${relColor}"></div></div>
        <span class="rep-label" style="color:${relColor}">${relText}</span>
      </div>
      ${n.notes ? `<div class="npc-notes">${n.notes}</div>` : ''}
      ${n.last_seen ? `<div class="npc-last-seen">Ultima volta: ${n.last_seen}</div>` : ''}
    </div>`;
  }).join('');
}

async function confirmSubclass(id) {
  closeModal('modal-subclass');
  try {
    const data = await apiFetch('/subclass', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subclass_id: id }),
    });
    currentState = data.state;
    updateUI(data.state);
    addSystemMsg(`Specializzazione scelta: ${data.subclass_name}`);
    if (data.new_skills?.length) {
      data.new_skills.forEach((sk, i) => setTimeout(() => showSkillUnlocked(sk.name), i * 600));
    }
  } catch (e) { addSystemMsg(`⚠ ${e.message}`); }
}

async function confirmAdvancedClass(id) {
  closeModal('modal-advanced-class');
  try {
    const data = await apiFetch('/advanced-class', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ advanced_class_id: id }),
    });
    currentState = data.state;
    updateUI(data.state);
    addSystemMsg(`Classe avanzata sbloccata: ${data.advanced_class_name}`);
    if (data.new_skills?.length) {
      data.new_skills.forEach((sk, i) => setTimeout(() => showSkillUnlocked(sk.name), i * 600));
    }
  } catch (e) { addSystemMsg(`⚠ ${e.message}`); }
}

// ────────────────────────────────────────────────────────────────────────────
// QUEST TRACKER
// ────────────────────────────────────────────────────────────────────────────

async function fetchAndCacheQuests() {
  try {
    const data = await apiFetch('/quests');
    questsCache = data.quests || [];
  } catch (_) {}
}

function updatePinnedQuestHUD(profile) {
  const box = document.getElementById('quest-pin-display');
  if (!box) return;

  const pinned = questsCache.find(q => q.id === pinnedQuestId);
  const activeIds = currentState?.gameState?.quests_active || [];

  if (!pinned || !activeIds.includes(pinnedQuestId)) {
    // try to auto-pin first active quest if nothing pinned
    if (activeIds.length && questsCache.length) {
      const first = questsCache.find(q => activeIds.includes(q.id));
      if (first) {
        pinnedQuestId = first.id;
        updatePinnedQuestHUD(profile);
        return;
      }
    }
    box.innerHTML = '<div class="quest-pin-none">Nessuna quest in evidenza</div>';
    return;
  }

  const counters = profile?.action_counters || {};
  const cur = counters[pinned.target_counter] || 0;
  const max = pinned.target_value || 1;
  const pct = Math.min(100, Math.round((cur / max) * 100));

  box.innerHTML = `
    <div class="quest-pin-name">${pinned.name}</div>
    <div class="quest-pin-progress">
      <div class="quest-bar-track"><div class="quest-bar-fill" style="width:${pct}%"></div></div>
      <span class="quest-progress-text">${cur}/${max}</span>
    </div>`;
}

async function openQuestsModal() {
  document.getElementById('modal-quests').classList.remove('hidden');
  await fetchAndCacheQuests();
  renderQuestsModal();
}

function renderQuestsModal() {
  const container = document.getElementById('quests-modal-content');
  if (!container) return;

  const gs = currentState?.gameState || {};
  const profile = currentState?.profile || {};
  const activeIds   = gs.quests_active     || [];
  const completedIds= gs.quests_completed  || [];
  const counters    = profile.action_counters || {};

  if (!questsCache.length) {
    container.innerHTML = '<div style="font-size:11px;color:var(--text-dim);text-align:center;padding:20px">Nessuna quest disponibile.</div>';
    return;
  }

  const active    = questsCache.filter(q => activeIds.includes(q.id));
  const completed = questsCache.filter(q => completedIds.includes(q.id));
  const available = questsCache.filter(q => !activeIds.includes(q.id) && !completedIds.includes(q.id));

  let html = '';

  if (active.length) {
    html += '<div class="quest-modal-section-title">ATTIVE</div>';
    html += active.map(q => questCardHTML(q, true, false, counters)).join('');
  }

  if (available.length) {
    html += '<div class="quest-modal-section-title">DISPONIBILI</div>';
    html += available.map(q => questCardHTML(q, false, false, counters)).join('');
  }

  if (completed.length) {
    html += '<div class="quest-modal-section-title">COMPLETATE</div>';
    html += completed.map(q => questCardHTML(q, false, true, counters)).join('');
  }

  container.innerHTML = html;
}

function questCardHTML(q, isActive, isCompleted, counters = {}) {
  const cur = counters[q.target_counter] || 0;
  const max = q.target_value || 1;
  const pct = Math.min(100, Math.round((cur / max) * 100));
  const isPinned = pinnedQuestId === q.id;

  const rewardParts = [];
  if (q.rewards?.exp)         rewardParts.push(`EXP +${q.rewards.exp}`);
  if (q.rewards?.money)       rewardParts.push(`${q.rewards.money} R`);
  if (q.rewards?.stat_points) rewardParts.push(`+${q.rewards.stat_points} stat`);
  if (q.rewards?.items?.length) rewardParts.push(`${q.rewards.items.length} oggetto`);

  const cardClass = `quest-card${isPinned ? ' quest-pinned' : ''}${isCompleted ? ' quest-completed' : ''}`;

  let actions = '';
  if (isActive) {
    actions = `<button class="btn-tiny ${isPinned ? 'quest-pin-active' : ''}" onclick="togglePinQuest('${q.id}')">📌</button>`;
  } else if (!isCompleted) {
    actions = `<button class="quest-start-btn" onclick="startQuest('${q.id}')">Inizia</button>`;
  }

  return `<div class="${cardClass}">
    <div class="quest-card-header">
      <span class="quest-card-name">${q.name}</span>
      ${actions}
    </div>
    <div class="quest-card-desc">${q.description}</div>
    ${isActive ? `<div class="quest-progress-row">
      <div class="quest-bar-track" style="flex:1"><div class="quest-bar-fill" style="width:${pct}%"></div></div>
      <span class="quest-progress-text">${cur}/${max}</span>
    </div>` : ''}
    ${rewardParts.length ? `<div class="quest-rewards">Ricompensa: <span class="quest-rewards-val">${rewardParts.join(' · ')}</span></div>` : ''}
  </div>`;
}

function togglePinQuest(id) {
  pinnedQuestId = (pinnedQuestId === id) ? null : id;
  renderQuestsModal();
  if (currentState?.profile) updatePinnedQuestHUD(currentState.profile);
}

async function startQuest(id) {
  try {
    await apiFetch('/quest/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quest_id: id }),
    });
    await fetchAndCacheQuests();
    if (!pinnedQuestId) { pinnedQuestId = id; }
    renderQuestsModal();
    if (currentState?.profile) updatePinnedQuestHUD(currentState.profile);
  } catch (e) { addSystemMsg(`⚠ ${e.message}`); }
}

function showQuestCompleted(quest) {
  const toast   = document.getElementById('quest-completed-toast');
  const nameEl  = document.getElementById('quest-toast-name');
  const rewEl   = document.getElementById('quest-toast-reward');
  if (!toast) return;

  nameEl.textContent = quest.name || quest;
  const parts = [];
  if (quest.rewards?.exp)   parts.push(`+${quest.rewards.exp} EXP`);
  if (quest.rewards?.money) parts.push(`+${quest.rewards.money} R`);
  rewEl.textContent = parts.join(' · ');

  toast.classList.remove('hidden');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.add('hidden'), 4000);

  if (pinnedQuestId === quest.id) pinnedQuestId = null;
}

questsBtn.addEventListener('click', openQuestsModal);

// ────────────────────────────────────────────────────────────────────────────
// COMBAT TICKER — Modulo 3
// ────────────────────────────────────────────────────────────────────────────

function renderCombatTicker(logs) {
  const panel = document.getElementById('combat-ticker-panel');
  const list  = document.getElementById('combat-ticker-list');
  if (!panel || !list || !logs.length) return;
  panel.classList.remove('hidden');
  const typeClass = { damage_dealt: 'ct-hit', damage_received: 'ct-recv', overdrive: 'ct-over', part_break: 'ct-break' };
  logs.forEach(log => {
    const div = document.createElement('div');
    div.className = 'combat-ticker-entry ' + (typeClass[log.type] || 'ct-misc');
    div.textContent = log.label || '';
    list.appendChild(div);
  });
  list.scrollTop = list.scrollHeight;
  // Nasconde il ticker se il combattimento finisce
  const inCombat = currentState?.gameState?.combat_active;
  if (!inCombat) setTimeout(() => panel.classList.add('hidden'), 3000);
}

// ────────────────────────────────────────────────────────────────────────────
// ANNOUNCE TICKER — Modulo 1
// ────────────────────────────────────────────────────────────────────────────

let _announceTimer = null;

function renderAnnouncements(arr) {
  const ticker = document.getElementById('announce-ticker');
  if (!ticker || !arr.length) return;
  ticker.classList.remove('hidden');
  ticker.innerHTML = arr.slice(-5).map(a => `<span class="announce-item">${a.text}</span>`).join('<span class="announce-sep">◈</span>');
  clearTimeout(_announceTimer);
  _announceTimer = setTimeout(() => ticker.classList.add('hidden'), 12000);
}

// ────────────────────────────────────────────────────────────────────────────
// BOUNTY BOARD — Modulo 2
// ────────────────────────────────────────────────────────────────────────────

async function openBountyBoard() {
  const list = document.getElementById('bounty-list');
  list.innerHTML = '<div style="color:var(--text-dim);font-size:11px;padding:16px">Caricamento…</div>';
  document.getElementById('modal-bounty').classList.remove('hidden');
  try {
    const data = await apiFetch('/quests/catalog');
    const quests = data.quests || [];
    if (!quests.length) { list.innerHTML = '<div style="color:var(--text-dim);font-size:11px;padding:16px">Nessuna taglia disponibile.</div>'; return; }
    const STATUS_LABEL = { available: 'Disponibile', active: 'In corso', ready: 'Pronta!', completed: 'Completata' };
    list.innerHTML = quests.map(q => {
      const bar = q.status === 'active' || q.status === 'ready'
        ? `<div class="bounty-progress-wrap"><div class="bounty-progress-bar" style="width:${Math.round((q.progress / q.quantity_required) * 100)}%"></div></div><div class="bounty-progress-text">${q.progress}/${q.quantity_required}</div>`
        : '';
      const rewardText = [
        q.rewards?.gold ? `${q.rewards.gold} R` : null,
        ...(q.rewards?.items || []).map(i => i.name),
      ].filter(Boolean).join(', ');
      const btn = q.status === 'available'
        ? `<button class="bounty-action-btn" onclick="bountyAccept('${q.id}')">Accetta</button>`
        : q.status === 'ready'
        ? `<button class="bounty-action-btn bounty-claim-btn" onclick="bountyClaim('${q.id}')">Ritira ricompensa</button>`
        : '';
      return `<div class="bounty-card bounty-${q.status}">
        <div class="bounty-card-header">
          <span class="bounty-name">${q.name}</span>
          <span class="bounty-status">${STATUS_LABEL[q.status] || q.status}</span>
        </div>
        <div class="bounty-desc">${q.description}</div>
        ${bar}
        <div class="bounty-reward">Premio: ${rewardText || '—'}</div>
        ${btn}
      </div>`;
    }).join('');
  } catch (e) {
    list.innerHTML = `<div style="color:var(--text-dim);font-size:11px;padding:16px">Errore: ${e.message}</div>`;
  }
}

async function bountyAccept(questId) {
  try {
    await apiFetch('/quests/accept', { method: 'POST', body: JSON.stringify({ quest_id: questId }) });
    openBountyBoard();
  } catch (e) { addSystemMsg(`⚠ ${e.message}`); }
}

async function bountyClaim(questId) {
  try {
    const data = await apiFetch('/quests/claim', { method: 'POST', body: JSON.stringify({ quest_id: questId }) });
    currentState = { ...(currentState || {}), profile: data.profile, inventory: data.inventory };
    updateUI(currentState);
    updatePlayerHUD(data.profile, data.inventory, currentState.gameState);
    openBountyBoard();
    addSystemMsg(`🏆 Taglia completata! +${data.rewards?.gold || 0} R`);
  } catch (e) { addSystemMsg(`⚠ ${e.message}`); }
}

document.getElementById('bounty-btn').addEventListener('click', openBountyBoard);

// ────────────────────────────────────────────────────────────────────────────
// DUNGEON MAP
// ────────────────────────────────────────────────────────────────────────────

const DUNGEON_ICONS = { combat:'⚔', trap:'🪤', puzzle:'◈', boss:'💀', reward:'🎁', empty:'○' };

async function renderDungeonMap(gs) {
  const container = document.getElementById('map-svg-container');
  document.getElementById('map-modal-title').textContent = 'MAPPA DUNGEON';
  document.getElementById('map-edit-btn').style.display = 'none';
  document.getElementById('map-legend-bar').innerHTML =
    '<span style="color:var(--text-dim);font-size:10px">⚔ Combat &nbsp; 🪤 Trappola &nbsp; ◈ Puzzle &nbsp; 💀 Boss &nbsp; 🎁 Tesoro &nbsp; ○ Vuota</span>';
  document.getElementById('map-modal-sub').textContent = 'Mappa del dungeon corrente';

  container.innerHTML = '<div style="color:var(--text-dim);font-size:11px;padding:20px">Caricamento…</div>';

  try {
    const data = await apiFetch('/dungeon/map');
    if (!data.in_dungeon) {
      container.innerHTML = '<div style="color:var(--text-dim);font-size:11px;padding:20px">Nessun dungeon attivo.</div>';
      return;
    }
    const dungeon  = { name: data.dungeon_name, rooms: data.rooms || [] };
    const visitedIds = (data.rooms || []).filter(r => r.visited).map(r => r.id);
    container.innerHTML = buildDungeonSVG(dungeon, data.current_room_id, visitedIds);
  } catch (e) {
    container.innerHTML = `<div style="color:var(--text-dim);font-size:11px;padding:20px">⚠ ${e.message}</div>`;
  }
}

function buildDungeonSVG(dungeon, currentRoomId, visitedIds) {
  if (!dungeon || !dungeon.rooms?.length) return '<div style="color:var(--text-dim);padding:20px">Nessun dungeon attivo.</div>';

  const rooms = dungeon.rooms;
  const W = 500, H = 420;
  const NODE_W = 90, NODE_H = 36, RX = 6;
  const HGAP = 24, VGAP = 48;

  // BFS layout
  const visitedBFS = new Set();
  const levels = [];
  const queue  = [{ id: rooms[0].id, depth: 0 }];
  visitedBFS.add(rooms[0].id);
  while (queue.length) {
    const { id, depth } = queue.shift();
    if (!levels[depth]) levels[depth] = [];
    levels[depth].push(id);
    const room = rooms.find(r => r.id === id);
    for (const nid of (room?.connections || [])) {
      if (!visitedBFS.has(nid)) {
        visitedBFS.add(nid);
        queue.push({ id: nid, depth: depth + 1 });
      }
    }
  }

  // Assign positions
  const pos = {};
  const totalH = levels.length * (NODE_H + VGAP) - VGAP;
  const startY = (H - totalH) / 2;
  for (let d = 0; d < levels.length; d++) {
    const row  = levels[d];
    const totalW = row.length * (NODE_W + HGAP) - HGAP;
    const startX = (W - totalW) / 2;
    for (let i = 0; i < row.length; i++) {
      pos[row[i]] = {
        x: startX + i * (NODE_W + HGAP),
        y: startY + d * (NODE_H + VGAP),
      };
    }
  }

  // Draw edges
  const drawnEdges = new Set();
  let edges = '';
  for (const room of rooms) {
    const p = pos[room.id];
    if (!p) continue;
    for (const nid of (room.connections || [])) {
      const edgeKey = [room.id, nid].sort().join('|');
      if (drawnEdges.has(edgeKey)) continue;
      drawnEdges.add(edgeKey);
      const np = pos[nid];
      if (!np) continue;
      const bothVisited = visitedIds.includes(room.id) && visitedIds.includes(nid);
      edges += `<line x1="${p.x + NODE_W/2}" y1="${p.y + NODE_H/2}" x2="${np.x + NODE_W/2}" y2="${np.y + NODE_H/2}" stroke="${bothVisited ? '#2a2a4a' : '#151530'}" stroke-width="2"/>`;
    }
  }

  // Draw nodes
  let nodes = '';
  for (const room of rooms) {
    const p = pos[room.id];
    if (!p) continue;

    const isCurrent = room.id === currentRoomId;
    const isVisited = visitedIds.includes(room.id);
    const isKnown   = isVisited || isCurrent ||
      (room.connections || []).some(nid => visitedIds.includes(nid) || nid === currentRoomId);

    let fill   = '#0a0a18';
    let stroke = '#1a1a35';
    let textColor = '#2a2a55';

    if (isCurrent) { fill = '#0f0f2f'; stroke = '#5c5fe8'; }
    else if (isVisited) { fill = '#0d0d22'; stroke = '#2a2a55'; }
    else if (isKnown)   { fill = '#090912'; stroke = '#18183a'; textColor = '#3a3a6a'; }

    const icon  = DUNGEON_ICONS[room.type] || '○';
    const label = isKnown ? (room.name.length > 12 ? room.name.slice(0, 12) + '…' : room.name) : '?';

    nodes += `<g>`;
    if (isCurrent) {
      nodes += `<rect x="${p.x - 2}" y="${p.y - 2}" width="${NODE_W + 4}" height="${NODE_H + 4}" rx="${RX + 2}" fill="none" stroke="#5c5fe8" stroke-width="1.5" opacity="0.5"><animate attributeName="opacity" values="0.5;1;0.5" dur="2s" repeatCount="indefinite"/></rect>`;
    }
    nodes += `<rect x="${p.x}" y="${p.y}" width="${NODE_W}" height="${NODE_H}" rx="${RX}" fill="${fill}" stroke="${stroke}" stroke-width="${isCurrent ? 2 : 1}"/>`;
    if (isKnown) {
      nodes += `<text x="${p.x + 10}" y="${p.y + 15}" font-size="12" fill="${isCurrent ? '#a0a0ff' : (isVisited ? '#5a5a9a' : '#3a3a7a')}">${icon}</text>`;
      nodes += `<text x="${p.x + 26}" y="${p.y + 15}" font-size="9" fill="${isCurrent ? '#c0c0ff' : (isVisited ? '#8888bb' : textColor)}" dominant-baseline="middle">${label}</text>`;
    } else {
      nodes += `<text x="${p.x + NODE_W/2}" y="${p.y + NODE_H/2}" font-size="13" fill="#1e1e40" text-anchor="middle" dominant-baseline="middle">?</text>`;
    }
    nodes += `</g>`;
  }

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">
    <rect width="${W}" height="${H}" fill="#050508" rx="8"/>
    ${edges}${nodes}
  </svg>`;
}

// ── Diario di Viaggio ─────────────────────────────────────────────────────────

diaryBtn.addEventListener('click', openDiaryModal);

async function openDiaryModal() {
  document.getElementById('modal-diary').classList.remove('hidden');
  document.getElementById('diary-entries-list').innerHTML =
    '<div class="diary-empty">Caricamento…</div>';

  try {
    const data = await apiFetch('/diary');
    diaryCache = (data.entries || []).slice().reverse(); // più recenti prima
    populateDiaryZoneSelect();
    filterDiary();
  } catch (e) {
    document.getElementById('diary-entries-list').innerHTML =
      `<div class="diary-empty">⚠ ${e.message}</div>`;
  }
}

function populateDiaryZoneSelect() {
  const zones = [...new Set(diaryCache.map(e => e.location).filter(Boolean))].sort();
  const sel = document.getElementById('diary-zone-select');
  sel.innerHTML = '<option value="">Tutte le zone</option>' +
    zones.map(z => `<option value="${z}">${z}</option>`).join('');
  sel.value = diaryZoneFilter;
}

function filterDiary() {
  const searchVal = document.getElementById('diary-search').value.toLowerCase().trim();
  diaryZoneFilter = document.getElementById('diary-zone-select').value;

  const filtered = diaryCache.filter(e => {
    if (diaryZoneFilter && e.location !== diaryZoneFilter) return false;
    if (!searchVal) return true;
    return (e.location || '').toLowerCase().includes(searchVal) ||
           (e.sub_location || '').toLowerCase().includes(searchVal) ||
           (e.summary || '').toLowerCase().includes(searchVal) ||
           (e.npcs || []).some(n => n.toLowerCase().includes(searchVal));
  });

  document.getElementById('diary-subtitle').textContent =
    `${filtered.length} di ${diaryCache.length} eventi`;

  const list = document.getElementById('diary-entries-list');

  if (!diaryCache.length) {
    list.innerHTML = '<div class="diary-empty">Nessun evento registrato ancora.<br>Il diario si riempirà con le tue avventure.</div>';
    return;
  }
  if (!filtered.length) {
    list.innerHTML = '<div class="diary-empty">Nessun evento corrisponde al filtro.</div>';
    return;
  }

  list.innerHTML = filtered.map(e => {
    const npcBadges = (e.npcs || []).map(n => `<span class="diary-npc-badge">${n}</span>`).join('');
    const subLoc = e.sub_location ? `<span class="diary-sublocation">› ${e.sub_location}</span>` : '';
    return `<div class="diary-entry">
      <div class="diary-entry-header">
        <span class="diary-location">${e.location || '—'}</span>
        ${subLoc}
        <span class="diary-entry-id">#${e.id}</span>
      </div>
      <div class="diary-summary">${e.summary || ''}</div>
      ${npcBadges ? `<div class="diary-npcs">${npcBadges}</div>` : ''}
    </div>`;
  }).join('');
}

// ── Start ─────────────────────────────────────────────────────────────────────
init();
