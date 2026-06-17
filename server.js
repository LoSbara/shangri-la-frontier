require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const path       = require('path');
const fs         = require('fs');
const { OpenAI } = require('openai');
const app   = express();
const PORT               = process.env.PORT           || 3000;
const MODEL              = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';
const MAX_SESSION_HISTORY = 12; // max messaggi in session_log (rolling window — tiene snello il blocco dinamico)

const deepseek = new OpenAI({
  apiKey:  process.env.DEEPSEEK_API_KEY,
  baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
});

// FIFO queue — serializza le richieste /api/chat per evitare race condition sui file JSON
let chatTail = Promise.resolve();

const SUBCLASS_NAMES = {
  berserker: 'Berserker', guardian: 'Guardiano', blade_master: 'Lama Assoluta',
  acrobat: 'Acrobata', shadow: 'Ombra', duelist: 'Duelista',
  supreme_analyst: 'Analista Supremo', manipulator: 'Manipolatore',
  artificer: 'Artefice', sovereign: 'Sovereigno',
  // Sacerdote
  guaritore: 'Guaritore', esorcista: 'Esorcista', oracolo: 'Oracolo',
  // Ingegnere
  meccanico: 'Meccanico', alchimista: 'Alchimista', inventore: 'Inventore',
};

const ADV_CLASS_NAMES = {
  war_god: 'Dio della Guerra', blood_reaper: 'Mietitore di Sangue',
  living_fortress: 'Fortezza Vivente', iron_champion: 'Campione di Ferro',
  sword_saint: 'Santo della Spada', dual_blade: 'Maestro Doppia Lama',
  sky_dancer: 'Danzatore del Cielo', tempest: 'Tempesta',
  absolute_phantom: 'Fantasma Assoluto', illusory_blade: 'Lama Illusoria',
  master_fencer: 'Schermidore Maestro', eternal_champion: 'Campione Eterno',
  override_master: 'Override Master', precision_tactician: 'Tattico di Precisione',
  curse_weaver: 'Tessitore di Maledizioni', dominator: 'Dominatore',
  construct_master: 'Maestro dei Costrutti', trap_specialist: 'Specialista Trappole',
  world_ruler: 'Signore del Mondo', living_legend: 'Leggenda Vivente',
  // Sacerdote T3
  angelo_custode: 'Angelo Custode', fonte_vita: 'Fonte di Vita',
  cavaliere_luce: 'Cavaliere della Luce', giustiziere_sacro: 'Giustiziere Sacro',
  prescelto: 'Prescelto del Destino', veggente_abissi: 'Veggente degli Abissi',
  // Ingegnere T3
  mastro_ingegnere: 'Mastro Ingegnere', macchinista_guerra: 'Macchinista di Guerra',
  grande_alchimista: 'Grande Alchimista', trasmutatore: 'Trasmutatore',
  genio_creativo: 'Genio Creativo', golem_master: 'Golem Master',
};

const SUBCLASS_COMPAT = {
  'Mercenario': ['berserker', 'guardian', 'blade_master', 'sovereign'],
  'Scout':      ['acrobat', 'shadow', 'duelist', 'sovereign'],
  'Mago':       ['supreme_analyst', 'manipulator', 'artificer', 'sovereign'],
  'Sacerdote':  ['guaritore', 'esorcista', 'oracolo', 'sovereign'],
  'Ingegnere':  ['meccanico', 'alchimista', 'inventore', 'sovereign'],
};

const ADV_CLASS_COMPAT = {
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
  // Sacerdote T2 → T3
  guaritore:  ['angelo_custode', 'fonte_vita'],
  esorcista:  ['cavaliere_luce', 'giustiziere_sacro'],
  oracolo:    ['prescelto', 'veggente_abissi'],
  // Ingegnere T2 → T3
  meccanico:  ['mastro_ingegnere', 'macchinista_guerra'],
  alchimista: ['grande_alchimista', 'trasmutatore'],
  inventore:  ['genio_creativo', 'golem_master'],
};

// Requisiti statistiche minime per sbloccare T2 (basate sui punti iniziali + bonus classe)
const SUBCLASS_REQUIREMENTS = {
  'Mercenario': { STR: 15, VIT: 12 },
  'Scout':      { DEX: 15, AGI: 13 },
  'Mago':       { TEC: 15, LUC: 12 },
  'Sacerdote':  { VIT: 15, LUC: 12 },
  'Ingegnere':  { TEC: 15, STR: 12 },
};

// Requisiti statistiche minime per sbloccare T3 (più elevati, livello 20)
const ADV_CLASS_REQUIREMENTS = {
  'Mercenario': { STR: 25, VIT: 18 },
  'Scout':      { DEX: 25, AGI: 20 },
  'Mago':       { TEC: 25, LUC: 18 },
  'Sacerdote':  { VIT: 25, LUC: 18 },
  'Ingegnere':  { TEC: 25, STR: 18 },
};

const REP_FACTIONS = [
  ['hunters_guild', 'Gilda'],
  ['merchants',     'Mercanti'],
  ['city_guard',    'Guardie'],
  ['scholars',      'Studiosi'],
  ['underground',   'Sotterranei'],
];

function repLabel(val) {
  if (val <= -51) return 'Nemico';
  if (val <= -11) return 'Diffidente';
  if (val <=  10) return 'Neutrale';
  if (val <=  50) return 'Amico';
  return 'Alleato';
}


function autoBackup(profile, gameState, uiEvents) {
  try {
    const shouldBackup = uiEvents.includes('level_up') ||
                         uiEvents.includes('quest_completed') ||
                         uiEvents.includes('unique_event_completed');
    if (!shouldBackup) return;
    const BACKUP_DIR = path.join(__dirname, 'data', 'backups');
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const prefix = `${(profile.name || 'player').replace(/\s+/g, '_')}_lv${profile.level}_${ts}`;
    fs.writeFileSync(path.join(BACKUP_DIR, `${prefix}_profile.json`), JSON.stringify(profile, null, 2));
    fs.writeFileSync(path.join(BACKUP_DIR, `${prefix}_gamestate.json`), JSON.stringify(gameState, null, 2));
    const files = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.json')).sort();
    if (files.length > 40) files.slice(0, files.length - 40).forEach(f => { try { fs.unlinkSync(path.join(BACKUP_DIR, f)); } catch {} });
  } catch { /* non-critical */ }
}
const DATA_DIR  = path.join(__dirname, 'data');
const WORLD_DIR = path.join(DATA_DIR, 'world');
if (!fs.existsSync(WORLD_DIR)) fs.mkdirSync(WORLD_DIR, { recursive: true });
const SAVE_DIR  = path.join(DATA_DIR, 'save');
if (!fs.existsSync(SAVE_DIR))  fs.mkdirSync(SAVE_DIR,  { recursive: true });
const SLOTS_DIR = path.join(__dirname, 'data', 'slots');
if (!fs.existsSync(SLOTS_DIR)) fs.mkdirSync(SLOTS_DIR, { recursive: true });
const SLOT_FILES = ['player_profile.json', 'inventory.json', 'game_state.json', 'skills_library.json', 'bestiary.json', 'npcs.json'];

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readData(filename) {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, filename), 'utf-8'));
}

// Lettura difensiva: se il JSON è corrotto tenta ripristino dal .bak
function readDataSafe(filename) {
  try {
    return readData(filename);
  } catch {
    const bakPath = path.join(DATA_DIR, filename + '.bak');
    if (fs.existsSync(bakPath)) {
      console.error(`⚠️  [SERVER] Critico: ${filename} corrotto! Ripristino di emergenza eseguito con successo dal backup .bak.`);
      const bak = JSON.parse(fs.readFileSync(bakPath, 'utf-8'));
      fs.writeFileSync(path.join(DATA_DIR, filename), JSON.stringify(bak, null, 2));
      return bak;
    }
    throw new Error(`${filename} corrotto e backup .bak assente — impossibile avviare il turno.`);
  }
}

function writeData(filename, data) {
  fs.writeFileSync(path.join(DATA_DIR, filename), JSON.stringify(data, null, 2));
}

function deepMerge(target, source) {
  if (!source || typeof source !== 'object') return target;
  for (const key of Object.keys(source)) {
    if (Array.isArray(source[key])) {
      target[key] = source[key];
    } else if (source[key] !== null && typeof source[key] === 'object') {
      if (!target[key] || typeof target[key] !== 'object') target[key] = {};
      deepMerge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}

function totalStat(profile, inventory, stat) {
  const base = profile.stats[stat] ?? 0;
  const bonus = inventory.stat_bonuses_from_equipment?.[stat] ?? 0;
  return base + bonus;
}

function recalcEquipmentBonuses(inventory) {
  const bonuses = { STR: 0, DEX: 0, AGI: 0, TEC: 0, VIT: 0, LUC: 0, HP_bonus: 0, MP_bonus: 0, STM_bonus: 0 };
  for (const item of Object.values(inventory.equipped || {})) {
    if (!item) continue;
    for (const [stat, val] of Object.entries(item.stat_bonus || {})) {
      if (stat in bonuses) bonuses[stat] += Number(val) || 0;
    }
  }
  inventory.stat_bonuses_from_equipment = bonuses;
}

// ─── Unique Event Trigger Check ───────────────────────────────────────────────

function checkUniqueEventTriggers(profile, inventory, gameState) {
  if (gameState.combat_active) return null; // mai interrompere un combattimento
  let eventsData;
  try { eventsData = readData('unique_events.json'); } catch { return null; }

  const flags    = gameState.unique_scenario_flags || {};
  const counters = profile.action_counters || {};
  const rep      = profile.reputation || {};

  for (const event of (eventsData.events || [])) {
    if (flags[event.flag]) continue; // già completato/attivato
    const req = event.requirements || {};

    // Zona: lista esatta
    if (req.locations && !req.locations.includes(gameState.location)) continue;
    // Zona: contains (es. "Aokara")
    if (req.location_includes && !(gameState.location || '').includes(req.location_includes)) continue;
    // Sub-location contains (es. "Taverna")
    if (req.sub_location_includes && !(gameState.sub_location || '').toLowerCase().includes(req.sub_location_includes.toLowerCase())) continue;
    // Zone type esatto o escluso
    if (req.zone_type     && gameState.zone_type !== req.zone_type) continue;
    if (req.not_zone_type && gameState.zone_type === req.not_zone_type) continue;
    // Livello minimo
    if (req.level && profile.level < req.level) continue;
    // Statistiche (con bonus equip)
    if (req.stats) {
      const ok = Object.entries(req.stats).every(([s, v]) => totalStat(profile, inventory, s) >= v);
      if (!ok) continue;
    }
    // Reputazione >= soglia
    if (req.reputation) {
      const ok = Object.entries(req.reputation).every(([f, v]) => (rep[f] || 0) >= v);
      if (!ok) continue;
    }
    // Reputazione > 0 (soglia positiva)
    if (req.reputation_positive) {
      const ok = Object.entries(req.reputation_positive).every(([f, v]) => (rep[f] || 0) >= v);
      if (!ok) continue;
    }
    // Contatori
    if (req.counters) {
      const ok = Object.entries(req.counters).every(([key, val]) => {
        const c = counters[key];
        return Array.isArray(c) ? c.length >= val : (c || 0) >= val;
      });
      if (!ok) continue;
    }

    return event; // primo evento che soddisfa tutti i requisiti
  }
  return null;
}

// ─── Dungeon System ───────────────────────────────────────────────────────────

function getDungeonContext(gameState) {
  if (gameState.zone_type !== 'dungeon' || !gameState.current_dungeon_id) return null;
  let data;
  try { data = readData('dungeons.json'); } catch { return null; }
  const dungeon = (data.dungeons || []).find(d => d.id === gameState.current_dungeon_id);
  if (!dungeon) return null;
  const room = (dungeon.rooms || []).find(r => r.id === gameState.current_room_id);
  return room ? { dungeon, room } : { dungeon, room: dungeon.rooms[0] };
}

function validateDungeonMove(gameState, targetRoomId) {
  const ctx = getDungeonContext(gameState);
  if (!ctx) return false;
  return (ctx.room.connections || []).includes(targetRoomId);
}

// ─── Quest Progress Check ─────────────────────────────────────────────────────

function checkQuestProgress(profile, inventory, gameState) {
  let db;
  try { db = readData('quests_database.json'); } catch { return []; }

  const completed = [];
  const counters  = profile.action_counters || {};
  const stillActive = [];

  for (const questId of (gameState.quests_active || [])) {
    const quest = (db.quests || []).find(q => q.id === questId);
    if (!quest) { stillActive.push(questId); continue; }

    const raw = counters[quest.target_counter];
    const current = Array.isArray(raw) ? raw.length : (raw || 0);

    if (current >= quest.target_value) {
      // Eroga reward lato server
      profile.experience = (profile.experience || 0) + (quest.rewards.exp    || 0);
      profile.money      = (profile.money      || 0) + (quest.rewards.money  || 0);
      if (quest.rewards.stat_points) {
        profile.stat_points_available = (profile.stat_points_available || 0) + quest.rewards.stat_points;
      }
      if (Array.isArray(quest.rewards.items)) {
        inventory.bag = inventory.bag || [];
        for (const item of quest.rewards.items) {
          inventory.bag.push({ ...item, id: item.id || `qr_${questId}`, quantity: 1, appraised: true });
        }
      }
      gameState.quests_completed = gameState.quests_completed || [];
      if (!gameState.quests_completed.includes(questId)) gameState.quests_completed.push(questId);
      completed.push(quest);
    } else {
      stillActive.push(questId);
    }
  }

  gameState.quests_active = stillActive;
  return completed;
}

// ─── System Prompt ────────────────────────────────────────────────────────────

function buildUnlockableBlock(profile, skills) {
  const learned = new Set(skills.skills.filter(s => s.unlocked_by_default || s.learned).map(s => s.id));
  const available = skills.skills.filter(sk => {
    if (learned.has(sk.id) || sk.unlocked_by_default) return false;
    const req = sk.requirements || {};
    if (req.level          && profile.level < req.level) return false;
    if (req.stats && !Object.entries(req.stats).every(([s, v]) => (profile.stats[s] || 0) >= v)) return false;
    if (req.skill          && !learned.has(req.skill)) return false;
    if (req.title          && !(profile.titles || []).some(t => t.id === req.title)) return false;
    if (req.subclass       && profile.subclass       !== req.subclass)       return false;
    if (req.advanced_class && profile.advanced_class !== req.advanced_class) return false;
    if (req.job            && profile.job            !== req.job)            return false;
    if (req.counter) {
      const [cKey, cVal] = Object.entries(req.counter)[0];
      if ((profile.action_counters?.[cKey] || 0) < Number(cVal)) return false;
    }
    return true;
  });
  return available.length
    ? available.map(sk => `  - ${sk.name} [${sk.branch}] | costo: ${JSON.stringify(sk.cost)} | ${sk.effect}`).join('\n')
    : '  (nessuna — distribuisci punti stat o guadagna titoli)';
}

function stripBagForAI(bag) {
  return (bag || []).map(it => ({
    id:         it.id,
    name:       it.name,
    type:       it.type,
    slot:       it.slot  || null,
    stat_bonus: it.stat_bonus || {},
    rarity:     it.rarity,
    ...(it.enhancement_level ? { enh: it.enhancement_level } : {}),
    ...(it.appraised === false ? { appraised: false } : {}),
  }));
}

function buildDiaryBlock(gameState) {
  let diary;
  try { diary = readData('travel_diary.json'); } catch { return ''; }
  const entries = diary.entries || [];
  if (!entries.length) return '';
  const loc = gameState.location;
  const byLoc = entries.filter(e => e.location === loc).slice(-2);
  const last = entries[entries.length - 1];
  const toShow = byLoc.slice();
  if (last && last.location !== loc && !toShow.find(e => e.id === last.id)) toShow.push(last);
  if (!toShow.length) return '';
  const lines = toShow.map(e =>
    `• [${e.location}${e.sub_location ? ' › ' + e.sub_location : ''}] ${e.summary}`
  ).join('\n');
  return `\n## DIARIO DI VIAGGIO (memorie rilevanti per la scena)\n${lines}\n`;
}

function locationToZoneFile(location) {
  return (location || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')  // rimuove accenti
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

// Applica i battle_tags come fonte di verità matematica sullo stato,
// partendo dallo snapshot PRE-TURNO per immunizzarsi da allucinazioni numeriche dell'AI.
function processBattleTags(tags, profile, inventory, skills, gameState, snap, uiEvents) {
  for (const tag of tags) {
    try {
      // ── BAG_ADD / BAG_REMOVE ─────────────────────────────────────────────────
      const bagM = tag.match(/^BAG_(ADD|REMOVE)_(.+)_(\d+)$/);
      if (bagM) {
        const op = bagM[1], itemId = bagM[2], qty = Math.max(1, parseInt(bagM[3], 10));
        inventory.bag = inventory.bag || [];
        if (op === 'ADD') {
          const existing = inventory.bag.find(it => it.id === itemId);
          if (existing) {
            existing.quantity = (existing.quantity || 1) + qty;
          } else {
            inventory.bag.push({
              id: itemId, name: itemId.replace(/_/g, ' '), type: 'misc',
              slot: null, stat_bonus: {}, rarity: 'comune',
              price: 0, quantity: qty, appraised: true,
            });
          }
        } else {
          const idx = inventory.bag.findIndex(it => it.id === itemId);
          if (idx >= 0) {
            const avail = inventory.bag[idx].quantity || 1;
            if (avail <= qty) inventory.bag.splice(idx, 1);
            else inventory.bag[idx].quantity = avail - qty;
          }
          // item non trovato → noop difensivo
        }
        continue;
      }

      // ── STATUS_ADD_[id]_[duration]_[potency] ─────────────────────────────────
      const statusAddM = tag.match(/^STATUS_ADD_(.+)_(\d+)_(\d+)$/);
      if (statusAddM) {
        const id = statusAddM[1], duration = parseInt(statusAddM[2], 10), potency = parseInt(statusAddM[3], 10);
        if (id && !isNaN(duration) && !isNaN(potency)) {
          profile.status_effects = (profile.status_effects || []).filter(e => e.id !== id);
          const isHeal = /REGEN|RIGENERAZIONE/i.test(id);
          profile.status_effects.push({
            id, name: id.replace(/_/g, ' '),
            type: isHeal ? 'buff' : 'debuff',
            turns_remaining: duration, value: potency,
            icon: isHeal ? '💚' : '⚠', color: isHeal ? '#22c55e' : '#ef4444',
          });
        }
        continue;
      }

      // ── STATUS_REMOVE_[id] ───────────────────────────────────────────────────
      const statusRemoveM = tag.match(/^STATUS_REMOVE_(.+)$/);
      if (statusRemoveM) {
        const id = statusRemoveM[1];
        profile.status_effects = (profile.status_effects || []).filter(e => e.id !== id);
        continue;
      }

      // ── QUEST_START_[quest_id] ───────────────────────────────────────────────
      if (tag.startsWith('QUEST_START_')) {
        const questId = tag.slice('QUEST_START_'.length);
        if (!questId) continue;
        profile.quests = profile.quests || { active: {}, completed: {} };
        if (!profile.quests.active?.[questId] && !profile.quests.completed?.[questId]) {
          profile.quests.active[questId] = { stage: 1, objectives: {} };
          uiEvents.push('quest_started');
        }
        continue;
      }

      // ── QUEST_PROGRESS_[objective_key]_[qty] ─────────────────────────────────
      const questProgressM = tag.match(/^QUEST_PROGRESS_(.+)_(\d+)$/);
      if (questProgressM) {
        const objKey = questProgressM[1], amount = parseInt(questProgressM[2], 10);
        profile.quests = profile.quests || { active: {}, completed: {} };
        for (const [questId, quest] of Object.entries(profile.quests.active || {})) {
          const obj = quest.objectives?.[objKey];
          if (!obj) continue;
          obj.current = Math.min(obj.target, (obj.current || 0) + amount);
          const allDone = Object.values(quest.objectives).every(o => (o.current || 0) >= o.target);
          if (allDone) {
            profile.quests.completed = profile.quests.completed || {};
            profile.quests.completed[questId] = { ...quest, completed: true };
            delete profile.quests.active[questId];
            if (!uiEvents.includes('quest_completed')) uiEvents.push('quest_completed');
          }
        }
        continue;
      }

      // ── SKILL_USE_[skill_id] ─────────────────────────────────────────────────
      if (tag.startsWith('SKILL_USE_')) {
        const skillId = tag.slice('SKILL_USE_'.length);
        if (!skillId) continue;
        const skillDef = skills?.skills?.find(s => s.id === skillId);
        if (!skillDef) continue;
        const cost    = skillDef.cost || {};
        const mpCost  = cost.mp  || 0;
        const stmCost = cost.stm || 0;
        const cdTurns = skillDef.cooldown_turns || 0;
        profile.skill_cooldowns = profile.skill_cooldowns || {};
        const currentCD = profile.skill_cooldowns[skillId] || 0;
        const canUse = currentCD === 0
          && profile.stats.MP.current  >= mpCost
          && profile.stats.STM.current >= stmCost;
        if (canUse) {
          profile.stats.MP.current  = Math.max(0, profile.stats.MP.current  - mpCost);
          profile.stats.STM.current = Math.max(0, profile.stats.STM.current - stmCost);
          if (cdTurns > 0) profile.skill_cooldowns[skillId] = cdTurns;
        } else {
          if (!uiEvents.includes('skill_error')) uiEvents.push('skill_error');
          console.warn(`[SKILL] "${skillId}" bloccata — CD:${currentCD} | MP:${profile.stats.MP.current}/${mpCost} | STM:${profile.stats.STM.current}/${stmCost}`);
        }
        continue;
      }

      // ── COMBAT_HIT_PLAYER_[monster_id]_[attack_type] ─────────────────────────
      // Il server calcola il danno da Monster_STR e Player_VIT (fonte di verità)
      if (tag.startsWith('COMBAT_HIT_PLAYER_')) {
        const enemy     = gameState.current_enemy;
        const monsterSTR = enemy?.stats?.STR ?? 8;
        const playerVIT  = totalStat(profile, inventory, 'VIT');
        const defense    = Math.floor(playerVIT / 3);
        const damage     = Math.max(1, monsterSTR - defense);
        profile.stats.HP.current = Math.max(0, profile.stats.HP.current - damage);
        console.log(`[COMBAT→Player] MonsterSTR:${monsterSTR} − DEF:${defense} = ${damage} danno (HP: ${profile.stats.HP.current}/${profile.stats.HP.max})`);
        if (!uiEvents.includes('SCREEN_SHAKE')) uiEvents.push('SCREEN_SHAKE');
        if (damage >= 10) uiEvents.push('RED_FLASH');
        continue;
      }

      // ── COMBAT_HIT_ENEMY_[monster_id]_[skill_id] ─────────────────────────────
      // Il server calcola il danno da STR/TEC + skill_multiplier e resistenza nemica
      if (tag.startsWith('COMBAT_HIT_ENEMY_')) {
        const enemy = gameState.current_enemy;
        if (!enemy?.hp) continue;
        // Identifica skill_id scorrendo il suffisso dal fondo
        const suffix = tag.slice('COMBAT_HIT_ENEMY_'.length);
        const parts  = suffix.split('_');
        let skillDef = null;
        for (let j = 1; j < parts.length; j++) {
          const tryId = parts.slice(j).join('_');
          const found = skills?.skills?.find(s => s.id === tryId && (s.unlocked_by_default || s.learned));
          if (found) { skillDef = found; break; }
        }
        const playerSTR  = totalStat(profile, inventory, 'STR');
        const playerTEC  = totalStat(profile, inventory, 'TEC');
        const baseAtk    = skillDef ? (skillDef.damage_type === 'tec' ? playerTEC : playerSTR) : playerSTR;
        const skillMult  = skillDef?.damage_multiplier ?? 1.0;
        const resistenza = enemy.stats?.resistenza ?? 0;
        const rawDmg     = Math.floor(baseAtk * skillMult);
        const damage     = Math.max(1, rawDmg - Math.floor(rawDmg * resistenza / 100));
        enemy.hp.current = Math.max(0, enemy.hp.current - damage);
        console.log(`[COMBAT→Enemy] PlayerATK:${rawDmg} − Res:${resistenza}% = ${damage} danno (EnemyHP: ${enemy.hp.current}/${enemy.hp.max})`);
        continue;
      }

      // ── Tag numerici: PLAYER_HP_-15 / ENEMY_HP_-30 / GOLD_GAIN_50 ───────────
      const numM = tag.match(/^([A-Z]+)_([A-Z]+)_([+-]?\d+)$/);
      if (!numM) continue;
      const entity = numM[1], field = numM[2], delta = parseInt(numM[3], 10);
      if (isNaN(delta)) continue;

      if (entity === 'PLAYER') {
        if (field === 'HP')
          profile.stats.HP.current  = Math.max(0, Math.min(profile.stats.HP.max,  snap.HP  + delta));
        else if (field === 'MP')
          profile.stats.MP.current  = Math.max(0, Math.min(profile.stats.MP.max,  snap.MP  + delta));
        else if (field === 'STM')
          profile.stats.STM.current = Math.max(0, Math.min(profile.stats.STM.max, snap.STM + delta));
      } else if (entity === 'ENEMY' && gameState.current_enemy?.hp) {
        if (field === 'HP')
          gameState.current_enemy.hp.current = Math.max(0, (snap.enemyHP ?? gameState.current_enemy.hp.current) + delta);
      } else if (entity === 'GOLD') {
        if (field === 'GAIN')
          profile.money = Math.max(0, snap.money + Math.abs(delta));
        else if (field === 'LOSE' || field === 'SPEND')
          profile.money = Math.max(0, snap.money - Math.abs(delta));
      } else if (entity === 'EXP' && field === 'GAIN') {
        profile.experience = snap.exp + Math.abs(delta);
      }
    } catch { /* tag malformato — ignora difensivamente */ }
  }
}

// Applica gli effetti di stato attivi a inizio turno (tick).
// Restituisce array di { id, effect, amount } per il log/serverDirectives.
function tickStatusEffects(profile) {
  const effects = profile.status_effects || [];
  if (!effects.length) return [];
  const DAMAGE_RE = /POISON|VELENO|AVVELENATO|BLEED|SANGUINAMENTO|BURN|BRUCIATO|FUOCO/i;
  const HEAL_RE   = /REGEN|RIGENERAZIONE/i;
  const ticked = [];
  const survived = [];

  for (const eff of effects) {
    const potency = eff.value ?? eff.potency ?? 0;
    const id = String(eff.id || '');
    if (potency > 0) {
      if (DAMAGE_RE.test(id)) {
        profile.stats.HP.current = Math.max(0, profile.stats.HP.current - potency);
        ticked.push({ id, effect: 'damage', amount: potency });
      } else if (HEAL_RE.test(id)) {
        profile.stats.HP.current = Math.min(profile.stats.HP.max, profile.stats.HP.current + potency);
        ticked.push({ id, effect: 'heal', amount: potency });
      }
    }
    const remaining = (eff.turns_remaining ?? eff.duration_turns ?? 1) - 1;
    if (remaining > 0) survived.push({ ...eff, turns_remaining: remaining });
  }
  profile.status_effects = survived;
  return ticked;
}

// Decrementa di 1 i cooldown attivi a inizio turno.
function tickCooldowns(profile) {
  const cds = profile.skill_cooldowns || {};
  for (const id of Object.keys(cds)) {
    if (cds[id] > 0) cds[id]--;
  }
  profile.skill_cooldowns = cds;
}

function sanitizeGMResponse(raw) {
  if (!raw || typeof raw !== 'object') raw = {};
  raw.narrative = (
    typeof raw.narrative  === 'string' ? raw.narrative  :
    typeof raw.narrazione === 'string' ? raw.narrazione :
    typeof raw.response   === 'string' ? raw.response   :
    typeof raw.text       === 'string' ? raw.text       :
    '(risposta non valida dal GM)'
  );
  if (!Array.isArray(raw.ui_events))   raw.ui_events   = [];
  if (!Array.isArray(raw.battle_tags)) raw.battle_tags = [];
  return raw;
}

function buildSystemPrompt(profile, inventory, skills, gameState, serverDirectives = '', worldData = {}) {
  const isNew = !profile.name;
  // Conta quante risposte del GM ci sono già nel log per capire in quale passo siamo
  const gmTurns = (gameState.session_log || []).filter(e => e.role === 'assistant').length;
  const memoBlock = gameState.context_memo
    ? `\n## FILO NARRATIVO ATTUALE\n${gameState.context_memo}\n`
    : '';
  const diaryBlock = buildDiaryBlock(gameState);
  const loadout = gameState.skill_loadout || [];
  const equip = inventory.equipped || {};

  const equipLines = Object.entries(equip)
    .map(([slot, item]) => `  ${slot}: ${item ? item.name : 'vuoto'}`)
    .join('\n');

  const bag = stripBagForAI(inventory.bag);
  const bagLines = bag.length
    ? bag.map((it, i) => {
        const unknown = it.appraised === false;
        const extra = unknown
          ? ` [NON VALUTATO — stat reali: ${JSON.stringify(it.stat_bonus)}, rarità: ${it.rarity}]`
          : '';
        return `  [${i}] ${it.name} (${it.type}${it.slot ? ', slot:' + it.slot : ''})${extra}`;
      }).join('\n')
    : '  (borsa vuota)';

  const loadoutLines = loadout.length
    ? loadout.map(s => `  - ${s.name} | Costo: ${JSON.stringify(s.cost)} | ${s.effect}`).join('\n')
    : '  (nessuna skill equipaggiata)';

  const questLines = (gameState.quests_active || []).join(', ') || 'nessuna';

  const statusLine = (profile.status_effects || []).length
    ? 'Stati attivi: ' + (profile.status_effects || []).map(s => s.name + '(' + s.turns_remaining + 't' + (s.value ? ',val:' + s.value : '') + ')').join(' | ')
    : 'Nessuno stato attivo';
  const _rep = profile.reputation || {};
  const repLine = 'Reputazione: ' + REP_FACTIONS.map(function(f) { return f[1] + ':' + repLabel(_rep[f[0]] || 0); }).join(' | ');
  let npcBlock = '';
  try {
    const npcsData = readData('npcs.json');
    const relevant = (npcsData.npcs || []).filter(n => n.last_seen === gameState.location || n.location === gameState.location);
    if (relevant.length) {
      npcBlock = '\n\n## NPC IN QUESTA ZONA\n' + relevant.map(n => '- ' + n.name + ' [' + (n.faction || '—') + '] Rel: ' + repLabel(n.relationship || 0) + (n.notes ? ' — ' + n.notes : '')).join('\n');
    }
  } catch {}

  let stateBlock = isNew
    ? (gmTurns === 0
      ? `## CREAZIONE PERSONAGGIO — PASSO 1
ISTRUZIONE: Sei al PRIMO turno. Presenta l'ambientazione di Shangri-La Frontier e la città di Crysta in modo evocativo (3-4 frasi). Termina OBBLIGATORIAMENTE con la domanda: "Come vuoi chiamare il tuo personaggio?" Non menzionare ancora le classi.`

      : gmTurns === 1
      ? `## CREAZIONE PERSONAGGIO — PASSO 2
ISTRUZIONE: Il giocatore ha appena fornito il suo nome nel messaggio corrente. Estrai il nome esatto.
Se il messaggio contiene anche una scelta di classe, crea il profilo completo adesso (vedi STAT sotto). Altrimenti presenta le classi e chiedi di sceglierne una.

CLASSI DISPONIBILI (usa ESATTAMENTE questi nomi nel JSON per il campo "job"):
- Mercenario — guerriero frontale
- Scout      — veloce e preciso
- Mago       — skill potenti e drop rari
- Sacerdote  — cura e magia sacra
- Ingegnere  — costrutti e gadget
- Custom     — distribuisci tu stesso i punti stat

STAT DI PARTENZA per ogni classe (valori ESATTI da usare nel JSON):
  Mercenario: "STR":15,"DEX":10,"AGI":10,"TEC":10,"VIT":13,"LUC":10  stat_points_available:10
  Scout:      "STR":10,"DEX":15,"AGI":13,"TEC":10,"VIT":10,"LUC":10  stat_points_available:10
  Mago:       "STR":10,"DEX":10,"AGI":10,"TEC":15,"VIT":10,"LUC":13  stat_points_available:10
  Sacerdote:  "STR":10,"DEX":10,"AGI":10,"TEC":10,"VIT":15,"LUC":13  stat_points_available:10
  Ingegnere:  "STR":13,"DEX":10,"AGI":10,"TEC":15,"VIT":10,"LUC":10  stat_points_available:10
  Custom:     "STR":10,"DEX":10,"AGI":10,"TEC":10,"VIT":10,"LUC":10  stat_points_available:18

Quando crei il profilo imposta state_updates.player con (esempio Scout):
{"name":"<nome>","job":"Scout","level":1,"experience":0,"experience_to_next":100,
 "stats":{"HP":{"current":100,"max":100},"MP":{"current":50,"max":50},"STM":{"current":100,"max":100},
          "STR":10,"DEX":15,"AGI":13,"TEC":10,"VIT":10,"LUC":10},
 "stat_points_available":10,"money":500,"skill_slots":4}
NON chiedere dove mettere i punti stat — il giocatore li assegna da solo tramite UI.`

      : `## CREAZIONE PERSONAGGIO — PASSO 3
ISTRUZIONE: Il giocatore sta scegliendo la classe nel messaggio corrente. Il nome lo ha già fornito in un turno precedente — cercalo nella storia della conversazione.
Determina la classe dal messaggio corrente, recupera il nome dalla storia, poi crea subito il profilo completo.

STAT DI PARTENZA per ogni classe (valori ESATTI da usare nel JSON):
  Mercenario: "STR":15,"DEX":10,"AGI":10,"TEC":10,"VIT":13,"LUC":10  stat_points_available:10
  Scout:      "STR":10,"DEX":15,"AGI":13,"TEC":10,"VIT":10,"LUC":10  stat_points_available:10
  Mago:       "STR":10,"DEX":10,"AGI":10,"TEC":15,"VIT":10,"LUC":13  stat_points_available:10
  Sacerdote:  "STR":10,"DEX":10,"AGI":10,"TEC":10,"VIT":15,"LUC":13  stat_points_available:10
  Ingegnere:  "STR":13,"DEX":10,"AGI":10,"TEC":15,"VIT":10,"LUC":10  stat_points_available:10
  Custom:     "STR":10,"DEX":10,"AGI":10,"TEC":10,"VIT":10,"LUC":10  stat_points_available:18

Imposta state_updates.player con (esempio Mago):
{"name":"<nome>","job":"Mago","level":1,"experience":0,"experience_to_next":100,
 "stats":{"HP":{"current":100,"max":100},"MP":{"current":50,"max":50},"STM":{"current":100,"max":100},
          "STR":10,"DEX":10,"AGI":10,"TEC":15,"VIT":10,"LUC":13},
 "stat_points_available":10,"money":500,"skill_slots":4}
NON chiedere dove mettere i punti stat — il giocatore li assegna da solo tramite UI.`
    )
    : null;  // personaggio esistente: gestito tramite semiStaticBlock + dynamicBlock

  // ── Livello 2: semi-statico (cambia raramente → massimizza cache prefix DeepSeek) ──
  let semiStaticBlock = '';
  // ── Livello 3: dinamico (cambia ad ogni turno) ──────────────────────────────────────
  let dynamicBlock = stateBlock || '';  // creazione: tutto dinamico

  if (!isNew) {
    const classChain = [
      profile.job,
      profile.subclass       ? SUBCLASS_NAMES[profile.subclass]           : null,
      profile.advanced_class ? ADV_CLASS_NAMES[profile.advanced_class]    : null,
    ].filter(Boolean).join(' → ');

    // Blocco lore zona — nel Livello 2 (semi-statico) per massimizzare il cache hit
    // I mostri con is_dead:true (world state per-player) sono filtrati dalla lista
    const liveMonsters = (worldData.available_monsters || []).filter(m => !m.is_dead);
    const worldBlock = worldData.zone_name
      ? `## LORE ZONA: ${worldData.zone_name}\n` +
        `${worldData.sub_location_lore || ''}\n` +
        (liveMonsters.length
          ? 'Mostri in zona: ' + liveMonsters.map(
              m => `${m.name} (HP:${m.hp ?? '?'}, Tier:${m.danger_level ?? '?'}, EXP:${m.exp_drop ?? '?'}, Oro:${m.gold_drop ?? '?'})`
            ).join(' | ')
          : '(nessun mostro vivo in questa zona)') + '\n\n'
      : '';

    semiStaticBlock = `${worldBlock}## PERSONAGGIO: ${profile.name} — ${classChain} — Lv.${profile.level}
STR: ${totalStat(profile, inventory, 'STR')} | DEX: ${totalStat(profile, inventory, 'DEX')} | AGI: ${totalStat(profile, inventory, 'AGI')}
TEC: ${totalStat(profile, inventory, 'TEC')} | VIT: ${totalStat(profile, inventory, 'VIT')} | LUC: ${totalStat(profile, inventory, 'LUC')}
Punti stat disponibili: ${profile.stat_points_available || 0}
Titoli: ${(profile.titles || []).map(t => t.name).join(', ') || '—'}
${repLine}

Equipaggiamento:
${equipLines}

Borsa:
${bagLines}

Skill loadout (${loadout.length}/${profile.skill_slots} slot usati):
${loadoutLines}

Quest attive: ${questLines}

## SKILL SBLOCCABILI (requisiti soddisfatti, non ancora apparse)
Puoi suggerire organicamente queste skill quando il giocatore esegue azioni coerenti:
${buildUnlockableBlock(profile, skills)}${npcBlock}`;

    dynamicBlock = `HP: ${profile.stats.HP.current}/${profile.stats.HP.max} | MP: ${profile.stats.MP.current}/${profile.stats.MP.max} | STM: ${profile.stats.STM.current}/${profile.stats.STM.max}
EXP: ${profile.experience}/${profile.experience_to_next} | Denaro: ${profile.money} R
${statusLine}
Zona: ${gameState.location}${gameState.sub_location ? ' ▸ ' + gameState.sub_location : ''} (${gameState.zone_type})`;

    if (gameState.combat_active && gameState.current_enemy) {
      const e = gameState.current_enemy;
      const combatStatsLine = e.revealed
        ? `STR ${e.stats?.STR ?? '?'} | AGI ${e.stats?.AGI ?? '?'} | Resistenza ${e.stats?.resistenza ?? 0}% | Debolezze: ${e.weaknesses?.join(', ') || 'nessuna'}`
        : 'stat non ancora analizzate';
      dynamicBlock += `\n\n⚔ COMBATTIMENTO ATTIVO
Nemico: ${e.name} (Tier ${e.tier ?? '?'}, Lv.${e.level ?? '?'}) — HP: ${e.hp?.current ?? '?'}/${e.hp?.max ?? '?'}
${combatStatsLine}`;
    }
  }

  const stateSections = isNew
    ? dynamicBlock
    : `## STATO PERSONAGGIO\n${semiStaticBlock}\n\n---\n## STATO CORRENTE\n${dynamicBlock}`;

  return `Sei il Game Master di SHANGRI-LA FRONTIER, un VRMMO testuale hardcore. Rispondi SEMPRE in italiano.
REGOLA ASSOLUTA: Il gioco si chiama "Shangri-La Frontier". La città di partenza si chiama "Crysta". NON inventare mai altri nomi di mondi, città o ambientazioni. Ogni esito è determinato dalle statistiche: non inventare numeri.

## LORE
- Moneta: Ragne (R) | I giocatori sono chiamati "Hunters"
- Tier mob: F < E < D < C < B < A < S < SS < SSS (boss unici, scenari irripetibili)
- Scenari "Unique": one-shot ad alto rischio e ricompensa, attivati da LUC alta

## SCHEMA RISPOSTA JSON (OBBLIGATORIO)
"narrative" DEVE essere la PRIMA chiave del JSON. Struttura minima:
{"narrative":"...","context_memo":"...","state_updates":{...},"bag_add":[...],...}

Interfaccia GMResponse:
  narrative:         string   // narrazione markdown — SEMPRE presente, SEMPRE prima chiave
  context_memo?:     string   // memo telegrafico fatti chiave. Accumula, non cancellare.
  state_updates?:    { player?: {stats?,money?,status_effects?,...}, game_state?: {location?,combat_active?,current_enemy?,...} }
  bag_add?:          Array<{id,name,type,slot,stat_bonus,rarity,price,appraised?}>  // MAI usare state_updates.inventory.bag
  appraise_item?:    { item_id?: string } | { bag_index?: number }
  battle_tags?:      string[]  // OBBLIGATORI ad ogni azione meccanica — formato rigido, il server li elabora matematicamente:
                               // "PLAYER_HP_-15" "PLAYER_MP_-10" "PLAYER_STM_-5" "PLAYER_HP_+20"
                               // "ENEMY_HP_-30" "GOLD_GAIN_50" "GOLD_LOSE_30" "EXP_GAIN_100"
  ui_events?:        string[]  // effetti visivi istantanei nel client: "SCREEN_SHAKE" "RED_FLASH" "HEAL_EFFECT"
  reputation_delta?: { hunters_guild?,merchants?,city_guard?,scholars?,underground?: number }  // SEMPRE delta, mai assoluto
  npc_add?:          { id,name,faction,relationship,notes }  // id stabile snake_case
  npc_update?:       { id, ...campi da aggiornare }
  diary_entry?:      { location,sub_location?,summary,npcs? }  // solo eventi significativi
  new_skills?:       Array<SkillObject>

REGOLE:
- money: sempre totale finale, mai negativo
- HP/MP/STM: sempre {current:N}
- location: cambia solo a nuova zona-mappa; sub_location cambia liberamente
- Oggetti a potenziale nascosto: aggiungi "appraised":false — l'UI mostra "?" al player
- Per rivelare oggetto: appraise_item:{item_id:"xxx"} a top-level

## GESTIONE COMBATTIMENTO
Per iniziare uno scontro:
"game_state": { "combat_active": true, "zone_type": "combat_zone", "current_enemy": { "name": "Nome", "tier": "D", "level": 5, "hp": { "current": 80, "max": 80 }, "stats": { "STR": 12, "AGI": 8, "resistenza": 10 }, "weaknesses": [], "revealed": false } }
Per aggiornare HP nemico durante il combattimento:
"game_state": { "current_enemy": { "hp": { "current": 45 } } }
Per rivelare stat nemico dopo Analisi:
"game_state": { "current_enemy": { "revealed": true, "weaknesses": ["fuoco"] } }
Per terminare il combattimento:
"game_state": { "combat_active": false, "zone_type": "safe_zone", "current_enemy": null }

BATTLE TAGS — il server li elabora matematicamente come fonte di verità (ignora valori assoluti in state_updates per HP/MP/STM/money/exp/bag):
  Skill (il server verifica CD e risorse — se bloccata: nessun consumo + "SKILL_ERROR" al client):
    "SKILL_USE_[skill_id]"     → attiva skill (es. "SKILL_USE_fendente_rapido")
  Danni e risorse:
    "PLAYER_HP_-N"             → danno subito (es. "PLAYER_HP_-15")
    "PLAYER_HP_+N"             → guarigione (es. "PLAYER_HP_+20")
    "PLAYER_MP_-N"             → MP consumati
    "PLAYER_STM_-N"            → STM consumata
    "ENEMY_HP_-N"              → danno inflitto al nemico
    "GOLD_GAIN_N"              → oro ricevuto (drop/reward)
    "GOLD_LOSE_N"              → oro speso
    "EXP_GAIN_N"               → EXP guadagnata
  Borsa (validazione lato server — quantità mai negative):
    "BAG_ADD_[item_id]_N"      → aggiunge N unità di item_id (es. "BAG_ADD_dente_goblin_2")
    "BAG_REMOVE_[item_id]_N"   → rimuove N unità (es. "BAG_REMOVE_pozione_salute_1")
  Effetti di stato (tick automatico ogni turno):
    "STATUS_ADD_[ID]_[dur]_[pot]" → applica stato (es. "STATUS_ADD_VELENO_3_5" = 3 turni, 5 HP/turno)
    "STATUS_REMOVE_[ID]"          → rimuove stato (es. "STATUS_REMOVE_VELENO")
  Quest:
    "QUEST_START_[quest_id]"   → avvia una quest nel profilo del giocatore
    "QUEST_PROGRESS_[obj]_N"   → avanza obiettivo N volte (es. "QUEST_PROGRESS_kill_goblin_1")
  Calcolatore combattimento autorevole (danno calcolato da stats, non da AI — usa QUESTI invece di PLAYER_HP_-N / ENEMY_HP_-N in combattimento):
    "COMBAT_HIT_PLAYER_[monster_id]_[attack_type]" → server calcola Danno = max(1, Monster_STR − floor(Player_VIT/3)) e lo sottrae agli HP del player
    "COMBAT_HIT_ENEMY_[monster_id]_[skill_id]"     → server calcola Danno = max(1, floor(STR×mult) × (1−resistenza%)) e lo sottrae agli HP del nemico
    Esempi: "COMBAT_HIT_PLAYER_goblin_artiglio"  |  "COMBAT_HIT_ENEMY_goblin_fendente_rapido"
UI EVENTS — effetti visivi istantanei nel client:
  "SCREEN_SHAKE"  → scuote lo schermo (colpo subito, esplosione)
  "RED_FLASH"     → flash rosso (danno grave)
  "HEAL_EFFECT"   → flash verde (guarigione significativa)

## RICERCA OGGETTI CON POTENZIALE NASCOSTO
Usa TEC (cerca attivamente) o LUC (ci inciampa). Soglie: <8 nulla | 8-11 comune | 12-15 interessante | 16-19 raro | 20+ eccezionale. Non rivelare la rarità reale: usa linguaggio vago. Prezzo venditore ≠ valore reale.

AGGIUNGERE OGGETTI A POTENZIALE NASCOSTO (stat reali presenti, ma nascoste al player in UI):
"bag_add": [
  { "id": "lama_misteriosa", "name": "Lama dall'Aspetto Insolito", "appraised": false, "type": "weapon", "slot": "weapon", "stat_bonus": { "TEC": 4 }, "rarity": "raro", "price": 200, "description": "Incisioni rune sul bordo." }
]
Con "appraised": false l'UI mostra "?" al posto delle stat e un pulsante "Valuta". Il GM può rivelare l'oggetto via narrazione inviando a top-level:
"appraise_item": { "item_id": "lama_misteriosa" }
oppure: "appraise_item": { "bag_index": 0 }

## EFFETTI DI STATO

Per applicare o modificare gli stati del player, includi in state_updates.player.status_effects l'ARRAY COMPLETO degli stati attivi (sostituisce il precedente):
[{ "id": "uid_univoco", "name": "Avvelenato", "icon": "🟢", "type": "debuff", "turns_remaining": 3, "value": 5, "color": "#22c55e" }]
Per rimuovere tutti gli stati: "status_effects": []
Tipi e colori consigliati:
- avvelenato: color "#22c55e", value = HP persi per turno
- bruciato:   color "#ef4444", value = HP persi per turno
- stordito:   color "#f59e0b", value = penalità AGI
- potenziato: color "#3b82f6", type "buff", value = bonus STR/ATK
- difesa_alta: color "#3b82f6", type "buff", value = riduzione danni
- maledetto:  color "#a78bfa", type "debuff"
Ogni turno di combattimento decrementa turns_remaining. A 0 rimuovi lo stato dall'array.
Gli effetti HP (veleno, fuoco) applicali manualmente sulle stat HP: calcola i danni e aggiorna HP current nello stesso turno.

## REPUTAZIONE FAZIONI

Quando il player compie azioni che influenzano le fazioni, includi:
"state_updates": { "reputation_delta": { "hunters_guild": 10, "merchants": -5 } }
(usa SEMPRE deltas, non valori assoluti — la reputazione va da -100 a +100)
Fazioni: hunters_guild, merchants, city_guard, scholars, underground
Esempi: aiutare un cacciatore +5..+20 hunters_guild | rubare da un mercante -10..-30 merchants | difendere un civile +5 city_guard | tradire la gilda -20 hunters_guild

## NPC PERSISTENTI

Quando incontri un NPC nuovo, includi in state_updates:
"npc_add": { "id": "fabbro_crysta", "name": "Goro il Fabbro", "faction": "merchants", "relationship": 5, "notes": "Specializzato in armi pesanti, prezzo onesto" }
Per aggiornare uno esistente: "npc_update": { "id": "fabbro_crysta", "relationship": 20, "notes": "Ha offerto uno sconto dopo il favore" }
L'id deve essere stabile e univoco (snake_case). Non cambiarlo tra le interazioni.
Se interagisci con un NPC già in memoria, rifletti la sua relazione attuale nella narrazione.

## MATERIALI PER POTENZIAMENTO ARMI

I materiali sono oggetti con "type": "material". Usali in bag_add come drop da nemici o trovati al mercato:
"bag_add": [{ "id": "pietra_01", "name": "Pietra di Affilatura", "type": "material", "slot": null, "stat_bonus": {}, "rarity": "comune", "price": 30, "description": "Perfeziona il filo di una lama." }]
Materiali comuni: Pietra di Affilatura, Resina di Rinforzo, Filo di Ferro Puro
Materiali rari: Cristallo Arcano, Metallo Stellare, Essenza del Chaos

## EVENTI UNICI (UNIQUE SCENARIOS)

Gli eventi unici sono one-shot irripetibili ad alto rischio/ricompensa. Dati in data/unique_events.json.
COME ATTIVARE: quando le condizioni trigger sono soddisfatte (LUC, reputazione, contatori, zona) e il giocatore è in una situazione narrativamente adatta, puoi attivare l'evento.
COME NARRARE: presenta l'hook narrativo, poi conduci l'evento normalmente come qualsiasi altro scenario.
QUANDO COMPLETATO: imposta il flag dell'evento in game_state.unique_scenario_flags:
"game_state": { "unique_scenario_flags": { "gladiatore_antico_completato": true } }
E incrementa il contatore:
"counters": { "unique_completed": 1 }
RICOMPENSE: alla fine dell'evento assegna exp, money, e se previsto aggiungi la skill in new_skills o l'oggetto in bag_add con rarity "leggendario" o "epico".

Elenco eventi disponibili (controlla data/unique_events.json per i dettagli completi):
- gladiatore_antico: Zona Crysta, REP hunters_guild >= 20, LUC >= 13
- rovine_primordiali: Prima visita Foresta di Aokara, LUC >= 15
- mercante_fantasma: Pernottamento in taverna, LUC >= 16
- cripta_del_re: Zona Crysta sotterranei, TEC >= 14, enemies_defeated >= 10
- specchio_del_doppio: Livello >= 10, qualsiasi dungeon
- il_collezionista: enemies_analyzed >= 5, mercati
- trono_dei_cacciatori: REP hunters_guild >= 50
- voce_del_caos: near_death_survives >= 3, REP underground > 0

## OGGETTI UNICI E LEGGENDARI

Gli oggetti unici (rarity "leggendario" o "epico" con id specifico) sono in data/unique_items.json.
Puoi assegnarli come ricompense di eventi unici o come drop rarissimi. Usa sempre bag_add.
Trattali narrativamente come oggetti con storia e importanza nel mondo.
Oggetti disponibili: corona_del_re_perduto, insegna_del_campione, frammento_specchio, mantello_ombra_assoluta, amuleto_rinascita, cristallo_arcano_potenziato, stivali_vento_eterno, guanti_del_colosseo, tomo_del_fondatore, lama_ancestrale.

## MOSTRI UNICI (BOSS SSS/SS)

I mostri unici sono descritti in data/unique_monsters.json. Ogni boss ha meccaniche speciali multi-fase.
COME USARLI: rispetta le mechanic speciali descritte nel file. Sono boss con regole proprie che rendono il combattimento diverso dal normale.
Esempi di meccaniche:
- Re Perduto: a 50% HP diventa fantasma (armi fisiche → 50% danno)
- Entità del Caos: resistenze cambiano ogni turno, rigenera se non attaccata
- Il Doppio: usa le skill del player, immune al tipo più usato
Quando un boss unico appare, descrivilo in modo cinematico. Non è un nemico normale.

## SKILL SPECIALI (branch: special)

Alcune skill si sbloccano tramite contatori invece di stat/classe:
- spe_colpo_leggendario: enemies_defeated >= 20
- spe_sangue_antichi: enemies_defeated >= 30
- spe_linguaggio_mostri: enemies_analyzed >= 10
- spe_fortuna_cacciatore: unique_completed >= 3
- spe_risurrezione_fallen: near_death_survives >= 5
Queste skill vengono sbloccate automaticamente dal sistema quando i contatori vengono aggiornati.
Puoi anche assegnarle direttamente come ricompensa evento tramite new_skills.

---
${stateSections}
${memoBlock}${diaryBlock}${serverDirectives ? '\n\n' + serverDirectives : ''}`;
}

// ─── Level Up ─────────────────────────────────────────────────────────────────

function checkLevelUp(profile) {
  const events = [];
  while (profile.experience >= profile.experience_to_next) {
    profile.experience -= profile.experience_to_next;
    profile.level += 1;
    profile.experience_to_next = profile.level * 100;
    profile.stats.HP.max += 10;
    profile.stats.HP.current = profile.stats.HP.max;
    profile.stats.MP.max += 5;
    profile.stats.MP.current = profile.stats.MP.max;
    profile.stats.STM.max += 5;
    profile.stats.STM.current = profile.stats.STM.max;
    profile.stat_points_available = (profile.stat_points_available || 0) + 3;
    if (profile.level % 5 === 0) profile.skill_slots += 1;
    events.push('level_up');
  }
  return events;
}

// ─── Skill Auto-Unlock ────────────────────────────────────────────────────────

function checkSkillUnlocks(profile, skills) {
  const learned = new Set(skills.skills.filter(s => s.unlocked_by_default || s.learned).map(s => s.id));
  const newUnlocks = [];
  for (const sk of skills.skills) {
    if (learned.has(sk.id) || sk.unlocked_by_default) continue;
    const req = sk.requirements || {};
    if (req.level          && profile.level < req.level) continue;
    if (req.stats) {
      const met = Object.entries(req.stats).every(([s, v]) => (profile.stats[s] || 0) >= v);
      if (!met) continue;
    }
    if (req.skill          && !learned.has(req.skill)) continue;
    if (req.title          && !(profile.titles || []).some(t => t.id === req.title)) continue;
    if (req.subclass       && profile.subclass       !== req.subclass)       continue;
    if (req.advanced_class && profile.advanced_class !== req.advanced_class) continue;
    if (req.job            && profile.job            !== req.job)            continue;
    if (req.counter) {
      const [cKey, cVal] = Object.entries(req.counter)[0];
      if ((profile.action_counters?.[cKey] || 0) < Number(cVal)) continue;
    }
    sk.learned = true;
    learned.add(sk.id);
    newUnlocks.push(sk);
  }
  return newUnlocks;
}

// ─── Title System ─────────────────────────────────────────────────────────────

function checkTitles(profile, skills) {
  let titlesData;
  try { titlesData = readData('titles.json'); } catch { return []; }

  const earnedIds  = new Set((profile.titles || []).map(t => t.id));
  const learnedCnt = skills.skills.filter(s => s.unlocked_by_default || s.learned).length;
  const counters   = profile.action_counters || {};
  const newTitles  = [];

  for (const title of titlesData.titles) {
    if (earnedIds.has(title.id)) continue;
    const c = title.condition;
    let met = false;

    if      (c.enemies_defeated    !== undefined && (counters.enemies_defeated    || 0) >= c.enemies_defeated)    met = true;
    else if (c.dodges               !== undefined && (counters.dodges               || 0) >= c.dodges)              met = true;
    else if (c.criticals            !== undefined && (counters.criticals            || 0) >= c.criticals)           met = true;
    else if (c.enemies_analyzed     !== undefined && (counters.enemies_analyzed     || 0) >= c.enemies_analyzed)    met = true;
    else if (c.zones_visited        !== undefined && (counters.zones_visited?.length|| 0) >= c.zones_visited)       met = true;
    else if (c.max_money            !== undefined && (counters.max_money            || 0) >= c.max_money)           met = true;
    else if (c.elite_kills          !== undefined && (counters.elite_kills          || 0) >= c.elite_kills)         met = true;
    else if (c.unique_completed     !== undefined && (counters.unique_completed     || 0) >= c.unique_completed)    met = true;
    else if (c.max_skills_in_combat !== undefined && (counters.max_skills_in_combat || 0) >= c.max_skills_in_combat)met = true;
    else if (c.near_death_survives  !== undefined && (counters.near_death_survives  || 0) >= c.near_death_survives) met = true;
    else if (c.skills_unlocked      !== undefined && learnedCnt                              >= c.skills_unlocked)   met = true;
    else if (c.level                !== undefined && profile.level                           >= c.level)             met = true;

    if (!met) continue;

    profile.titles = profile.titles || [];
    profile.titles.push({ id: title.id, name: title.name });
    earnedIds.add(title.id);

    // Apply stat rewards
    if (title.rewards?.stats) {
      for (const [stat, val] of Object.entries(title.rewards.stats)) {
        if (['STR','DEX','AGI','TEC','VIT','LUC'].includes(stat)) {
          profile.stats[stat] = (profile.stats[stat] || 0) + val;
        }
      }
    }
    if (title.rewards?.skill_slots) {
      profile.skill_slots = (profile.skill_slots || 4) + title.rewards.skill_slots;
    }
    // Skill reward handled after writeData in caller
    newTitles.push(title);
  }
  return newTitles;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get('/api/state', (req, res) => {
  try {
    res.json({
      profile: readData('player_profile.json'),
      inventory: readData('inventory.json'),
      skills: readData('skills_library.json'),
      gameState: readData('game_state.json'),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/chat', (req, res) => {
  chatTail = chatTail.then(async () => {
  const { message } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'Messaggio vuoto' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const sendEvent = (data) => res.write('data: ' + JSON.stringify(data) + '\n\n');

  try {
    const profile   = readDataSafe('player_profile.json');
    const inventory = readData('inventory.json');
    const skills    = readData('skills_library.json');
    const gameState = readData('game_state.json');

    // Modalità GM umano: salta l'AI, salva il messaggio, segnala al frontend
    if (gameState.gm_mode) {
      gameState.session_log = [...(gameState.session_log || []).slice(-(MAX_SESSION_HISTORY - 1)), { role: 'user', content: message }];
      writeData('game_state.json', gameState);
      sendEvent({ type: 'gm_mode', state: { profile, inventory, skills, gameState } });
      return res.end();
    }

    // ── Tick inizio turno (prima dello snapshot) ─────────────────────────────
    const tickedEffects = tickStatusEffects(profile);
    tickCooldowns(profile);

    const history = (gameState.session_log || []).slice(-MAX_SESSION_HISTORY);
    let serverDirectives = '';

    if (tickedEffects.length > 0) {
      const tickLines = tickedEffects
        .map(t => `${t.id}: ${t.effect === 'damage' ? '-' : '+'}${t.amount} HP`)
        .join(', ');
      serverDirectives += `[⏱ TICK EFFETTI STATO] A inizio turno i seguenti effetti hanno agito automaticamente: ${tickLines}. Riflettilo nella narrazione prima dell'azione del giocatore.\n\n`;
    }

    const triggeredEvent = checkUniqueEventTriggers(profile, inventory, gameState);
    if (triggeredEvent) {
      serverDirectives +=
        `[⚡ EVENTO UNICO OBBLIGATORIO — ID: "${triggeredEvent.id}" — "${triggeredEvent.name}"]\n` +
        `Ignora parzialmente l'input del giocatore per questo turno: devi introdurre il seguente scenario unico nella narrazione.\n` +
        `Hook: "${triggeredEvent.narrative_hook}"\n` +
        `Quando l'evento è completato includi in state_updates.game_state: ` +
        `{ "unique_scenario_flags": { "${triggeredEvent.flag}": true } }\n\n`;
    }

    const dungCtx = getDungeonContext(gameState);
    if (dungCtx) {
      const { dungeon, room } = dungCtx;
      const connList = (room.connections || []).join(', ') || 'nessuna';
      serverDirectives +=
        `[🗺️ DUNGEON: ${dungeon.name} — Stanza: "${room.name}" (${room.id}) — tipo: ${room.type}]\n` +
        `${room.description_blueprint}\n` +
        `Stanze raggiungibili: ${connList}\n`;
      if (room.type === 'trap')   serverDirectives += `Richiedi un check di ${room.trap_stat || 'AGI'} (DC ${room.trap_dc || 12}). Fallire infligge ${room.trap_damage || 15} danni.\n`;
      if (room.type === 'puzzle') serverDirectives += `Richiedi un check di ${room.puzzle_stat || 'TEC'} (DC ${room.puzzle_dc || 12}) per risolvere il puzzle senza conseguenze.\n`;
      if (room.type === 'boss')   serverDirectives += `Stanza boss — descrivi l'ingresso in modo cinematico e avvia il combattimento.\n`;
      if (room.type === 'reward') serverDirectives += `Stanza ricompensa — usa bag_add per assegnare un tesoro adeguato al livello del dungeon.\n`;
      serverDirectives +=
        `Quando il giocatore si sposta, aggiorna state_updates.game_state con: { "current_room_id": "<id_stanza>" }. ` +
        `ID validi: ${connList}.\n\n`;
    }

    // Carica stato mondo per-player (save file mutable > fallback file statico)
    let worldData = {};
    let worldStatePath = null;
    if (profile.name) {
      try {
        const staticWorld = readData(`world/${locationToZoneFile(gameState.location)}.json`);
        const playerId    = profile.name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
        worldStatePath    = path.join(SAVE_DIR, `${playerId}_world_state.json`);
        try {
          const saved = JSON.parse(fs.readFileSync(worldStatePath, 'utf-8'));
          if (saved._zone === gameState.location) {
            worldData = saved;
          } else {
            // Cambio zona: init nuovo save file per la nuova zona
            worldData = { ...staticWorld, _zone: gameState.location, _player: playerId };
            fs.writeFileSync(worldStatePath, JSON.stringify(worldData, null, 2));
          }
        } catch {
          // Prima visita: crea il save file dal file statico
          worldData = { ...staticWorld, _zone: gameState.location, _player: playerId };
          fs.writeFileSync(worldStatePath, JSON.stringify(worldData, null, 2));
        }
      } catch { worldData = {}; }
    } else {
      try { worldData = readData(`world/${locationToZoneFile(gameState.location)}.json`); } catch { worldData = {}; }
    }

    const systemPrompt = buildSystemPrompt(profile, inventory, skills, gameState, serverDirectives, worldData);

    const messages = [
      { role: 'system', content: systemPrompt },
      ...history.map(h => ({ role: h.role === 'assistant' ? 'assistant' : 'user', content: h.content })),
      { role: 'user', content: message },
    ];

    // ── Streaming Phase ───────────────────────────────────────────────────────
    const stream = await deepseek.chat.completions.create({
      model: MODEL,
      messages,
      stream: true,
      stream_options: { include_usage: true },
      response_format: { type: 'json_object' },
      temperature: 0.85,
      max_tokens: 4096,
    });

    let fullBuffer = '';
    let narrativeStartIdx = -1;
    let narrativeScanPos = 0;
    let narrativeEnded = false;
    let streamComplete = false;
    let lastUsage = null;

    for await (const chunk of stream) {
      if (chunk.usage) lastUsage = chunk.usage;  // ultimo chunk porta i totali
      const token = chunk.choices[0]?.delta?.content || '';
      if (!token) continue;
      fullBuffer += token;

      if (!narrativeEnded) {
        if (narrativeStartIdx < 0) {
          for (const m of ['"narrative":"', '"narrative": "']) {
            const idx = fullBuffer.indexOf(m);
            if (idx >= 0) { narrativeStartIdx = idx + m.length; narrativeScanPos = 0; break; }
          }
        }
        if (narrativeStartIdx >= 0) {
          let newText = '';
          let i = narrativeStartIdx + narrativeScanPos;
          while (i < fullBuffer.length) {
            const c = fullBuffer[i];
            if (c === '\\') {
              if (i + 1 >= fullBuffer.length) break;
              const next = fullBuffer[i + 1];
              if (next === 'u') {
                if (i + 5 >= fullBuffer.length) break;  // aspetta 4 cifre hex
                const hex = fullBuffer.slice(i + 2, i + 6);
                if (/^[0-9a-fA-F]{4}$/.test(hex)) { newText += String.fromCodePoint(parseInt(hex, 16)); i += 6; }
                else                               { newText += '?'; i += 2; }
              } else if (next === '"')  { newText += '"';  i += 2; }
              else if (next === 'n')    { newText += '\n'; i += 2; }
              else if (next === 't')    { newText += '\t'; i += 2; }
              else if (next === '\\')   { newText += '\\'; i += 2; }
              else if (next === 'r')    { newText += '\r'; i += 2; }
              else                      { newText += next;  i += 2; }
            } else if (c === '"') {
              narrativeEnded = true; i++; break;
            } else { newText += c; i++; }
          }
          narrativeScanPos = i - narrativeStartIdx;
          if (newText) sendEvent({ type: 'token', text: newText });
        }
      }
    }

    streamComplete = true;

    // ── Usage / Cache Hit Rate ────────────────────────────────────────────────
    if (lastUsage) {
      const promptTok  = lastUsage.prompt_tokens     || 0;
      const outputTok  = lastUsage.completion_tokens || 0;
      const cachedTok  = lastUsage.prompt_tokens_details?.cached_tokens || 0;
      const hitPct     = promptTok > 0 ? ((cachedTok / promptTok) * 100).toFixed(1) : '0.0';
      console.log(
        `📊 [DEEPSEEK USAGE] — Turno Completato\n` +
        `├── Input Totale:  ${promptTok} token\n` +
        `├── Cache Hit:     ${cachedTok} token (${hitPct}%)\n` +
        `└── Output:        ${outputTok} token`
      );
    }

    // ── Parse Complete Response ───────────────────────────────────────────────
    console.log('[GM RAW]', fullBuffer.slice(0, 300));
    let parsed;
    try { parsed = JSON.parse(fullBuffer); } catch (e) { console.error('[GM JSON]', e.message); parsed = {}; }
    parsed = sanitizeGMResponse(parsed);
    console.log('[GM KEYS]', Object.keys(parsed));

    const narrative = parsed.narrative;
    const uiEvents  = parsed.ui_events;

    // Snapshot pre-update
    const prevCombatActive  = gameState.combat_active;
    const prevEnemyName     = gameState.current_enemy?.name     || null;
    const prevEnemyTier     = gameState.current_enemy?.tier     || null;
    const prevEnemyRevealed = gameState.current_enemy?.revealed || false;
    const prevLocation      = gameState.location;
    const snapHP      = profile.stats.HP.current;
    const snapMP      = profile.stats.MP.current;
    const snapSTM     = profile.stats.STM.current;
    const snapEXP     = profile.experience;
    const snapMoney   = profile.money;
    const snapEnemyHP = gameState.current_enemy?.hp?.current ?? null;

    // Validate dungeon room transition BEFORE deepMerge
    if (parsed.state_updates?.game_state?.current_room_id && gameState.zone_type === 'dungeon') {
      const targetRoom = parsed.state_updates.game_state.current_room_id;
      if (!validateDungeonMove(gameState, targetRoom)) {
        console.warn(`[Dungeon] Spostamento non valido verso "${targetRoom}" rifiutato.`);
        delete parsed.state_updates.game_state.current_room_id;
      }
    }

    // Apply state updates
    if (parsed.context_memo) gameState.context_memo = parsed.context_memo;
    if (parsed.diary_entry?.summary) {
      try {
        const diary = readData('travel_diary.json');
        diary.entries = diary.entries || [];
        diary.entries.push({
          id: diary.entries.length + 1,
          location: parsed.diary_entry.location || gameState.location,
          sub_location: parsed.diary_entry.sub_location || gameState.sub_location || '',
          summary: parsed.diary_entry.summary,
          npcs: parsed.diary_entry.npcs || [],
        });
        writeData('travel_diary.json', diary);
      } catch { /* non-critical */ }
    }
    if (parsed.state_updates?.player)     deepMerge(profile,    parsed.state_updates.player);
    if (parsed.state_updates?.inventory)  deepMerge(inventory,  parsed.state_updates.inventory);
    if (parsed.state_updates?.game_state) deepMerge(gameState,  parsed.state_updates.game_state);

    // Auto-set stanza iniziale quando si entra in un dungeon senza current_room_id
    if (gameState.zone_type === 'dungeon' && gameState.current_dungeon_id && !gameState.current_room_id) {
      try {
        const dData = readData('dungeons.json');
        const dung  = (dData.dungeons || []).find(d => d.id === gameState.current_dungeon_id);
        if (dung?.rooms?.length > 0) gameState.current_room_id = dung.rooms[0].id;
      } catch {}
    }
    // Traccia stanze visitate
    if (gameState.zone_type === 'dungeon' && gameState.current_room_id) {
      gameState.rooms_visited = gameState.rooms_visited || [];
      if (!gameState.rooms_visited.includes(gameState.current_room_id)) {
        gameState.rooms_visited.push(gameState.current_room_id);
      }
    }

    // bag_add — top-level (schema) con fallback state_updates per compat
    const bagAddItems = parsed.bag_add || parsed.state_updates?.bag_add;
    if (bagAddItems) {
      const toAdd = Array.isArray(bagAddItems) ? bagAddItems : [bagAddItems];
      inventory.bag = inventory.bag || [];
      toAdd.forEach((item, i) => {
        if (!item?.name) return;
        inventory.bag.push({
          id:          item.id          || `gm_${Date.now()}_${i}`,
          name:        item.name,
          type:        item.type        || 'misc',
          slot:        item.slot        || null,
          stat_bonus:  item.stat_bonus  || {},
          description: item.description || '',
          rarity:      item.rarity      || 'comune',
          price:       item.price       || 50,
          quantity:    item.quantity    || 1,
          appraised:   item.appraised   === false ? false : true,
        });
      });
    }

    // appraise_item — top-level con fallback
    const appraiseData = parsed.appraise_item || parsed.state_updates?.appraise_item;
    if (appraiseData) {
      let idx = -1;
      if (appraiseData.bag_index !== undefined) idx = Number(appraiseData.bag_index);
      else if (appraiseData.item_id) idx = inventory.bag.findIndex(it => it.id === appraiseData.item_id);
      if (idx >= 0 && idx < (inventory.bag || []).length) inventory.bag[idx].appraised = true;
    }

    // reputation_delta — top-level con fallback
    const repDelta = parsed.reputation_delta || parsed.state_updates?.reputation_delta;
    if (repDelta) {
      profile.reputation = profile.reputation || {};
      for (const [faction, delta] of Object.entries(repDelta)) {
        profile.reputation[faction] = Math.max(-100, Math.min(100, (profile.reputation[faction] || 0) + Number(delta)));
      }
    }

    // NPC add/update — top-level con fallback
    const npcPayload = parsed.npc_add || parsed.npc_update || parsed.state_updates?.npc_add || parsed.state_updates?.npc_update;
    if (npcPayload) {
      let npcsData;
      try { npcsData = readData('npcs.json'); } catch { npcsData = { npcs: [] }; }
      const updates = Array.isArray(npcPayload) ? npcPayload : [npcPayload];
      for (const upd of updates) {
        if (!upd?.id) continue;
        const idx = npcsData.npcs.findIndex(n => n.id === upd.id);
        if (idx >= 0) {
          npcsData.npcs[idx] = { ...npcsData.npcs[idx], ...upd, last_seen: gameState.location };
        } else {
          npcsData.npcs.push({
            id: upd.id, name: upd.name || upd.id,
            faction: upd.faction || '', location: upd.location || gameState.location,
            relationship: upd.relationship ?? 0, notes: upd.notes || '',
            last_seen: gameState.location,
          });
        }
      }
      writeData('npcs.json', npcsData);
    }

    // Denaro mai negativo
    if (profile.money < 0) profile.money = 0;

    // Bestiary tracking
    try {
      const bestiary   = readData('bestiary.json');
      const currEnemy  = gameState.current_enemy;
      const currName   = currEnemy?.name || null;
      const newEnemy   = currName && currName !== prevEnemyName;
      const combatOver = prevCombatActive && !gameState.combat_active;

      if (newEnemy) {
        let entry = bestiary.entries.find(e => e.name === currName);
        if (!entry) {
          entry = { name: currName, tier: currEnemy.tier || '?', level: currEnemy.level || '?',
            hp_max: currEnemy.hp?.max || null, stats: null, weaknesses: [], encounters: 0, defeated: 0 };
          bestiary.entries.push(entry);
        }
        entry.encounters = (entry.encounters || 0) + 1;
      }
      if (currEnemy?.revealed && currName) {
        const entry = bestiary.entries.find(e => e.name === currName);
        if (entry) { entry.stats = currEnemy.stats; entry.weaknesses = currEnemy.weaknesses || []; }
      }
      if (combatOver && prevEnemyName) {
        const entry = bestiary.entries.find(e => e.name === prevEnemyName);
        if (entry) entry.defeated = (entry.defeated || 0) + 1;
      }
      writeData('bestiary.json', bestiary);
    } catch { /* non-critical */ }

    // ── Battle Tags Engine — applica delta matematici come fonte di verità ────
    if (parsed.battle_tags.length > 0) {
      processBattleTags(parsed.battle_tags, profile, inventory, skills, gameState, {
        HP: snapHP, MP: snapMP, STM: snapSTM,
        money: snapMoney, exp: snapEXP,
        enemyHP: snapEnemyHP,
      }, uiEvents);
    }

    // World state persistence: segna il nemico come morto se HP → 0
    if (worldStatePath && gameState.current_enemy?.hp?.current <= 0 && gameState.current_enemy?.name) {
      try {
        const ws       = JSON.parse(fs.readFileSync(worldStatePath, 'utf-8'));
        const monsters = ws.available_monsters || [];
        const mIdx     = monsters.findIndex(m => m.name === gameState.current_enemy.name);
        if (mIdx >= 0 && !monsters[mIdx].is_dead) {
          monsters[mIdx].is_dead = true;
          ws.available_monsters  = monsters;
          fs.writeFileSync(worldStatePath, JSON.stringify(ws, null, 2));
          console.log(`[WorldState] ${gameState.current_enemy.name} segnato is_dead:true in ${path.basename(worldStatePath)}`);
        }
      } catch { /* non-critical */ }
    }

    // ── Action counter tracking ───────────────────────────────────────────────
    const counters = profile.action_counters || {};

    if (Array.isArray(parsed.battle_tags)) {
      for (const tag of parsed.battle_tags) {
        if (tag === 'player_dodge')    counters.dodges    = (counters.dodges    || 0) + 1;
        if (tag === 'player_critical') counters.criticals = (counters.criticals || 0) + 1;
        if (tag.startsWith('skill_used:')) {
          const ids = tag.slice('skill_used:'.length).split(',').filter(Boolean);
          counters.max_skills_in_combat = Math.max(counters.max_skills_in_combat || 0, ids.length);
        }
      }
    } else if (parsed.state_updates?.counters) {
      const aiCounters = parsed.state_updates.counters;
      if (aiCounters.dodges)    counters.dodges    = (counters.dodges    || 0) + Number(aiCounters.dodges);
      if (aiCounters.criticals) counters.criticals = (counters.criticals || 0) + Number(aiCounters.criticals);
      if (Array.isArray(aiCounters.skills_used_this_combat)) {
        counters.max_skills_in_combat = Math.max(counters.max_skills_in_combat || 0, aiCounters.skills_used_this_combat.length);
      }
    }

    if (prevCombatActive && !gameState.combat_active && prevEnemyName) {
      counters.enemies_defeated = (counters.enemies_defeated || 0) + 1;
      const eliteTiers = ['B','A','S','SS','SSS'];
      if (eliteTiers.some(t => (prevEnemyTier || '').includes(t))) {
        counters.elite_kills = (counters.elite_kills || 0) + 1;
      }
      if (profile.stats.HP.current > 0 && profile.stats.HP.current / profile.stats.HP.max < 0.10) {
        counters.near_death_survives = (counters.near_death_survives || 0) + 1;
      }
    }
    if (gameState.current_enemy?.revealed && !prevEnemyRevealed && prevEnemyName) {
      counters.enemies_analyzed = (counters.enemies_analyzed || 0) + 1;
    }
    if (gameState.location && gameState.location !== prevLocation) {
      counters.zones_visited = counters.zones_visited || [];
      if (!counters.zones_visited.includes(gameState.location)) {
        counters.zones_visited.push(gameState.location);
      }
    }
    if (profile.money > (counters.max_money || 0)) counters.max_money = profile.money;
    const prevUniqueCompleted = counters.unique_completed || 0;
    counters.unique_completed = Object.values(gameState.unique_scenario_flags || {}).filter(Boolean).length;
    profile.action_counters = counters;

    // ── Quest Progress ────────────────────────────────────────────────────────
    const completedQuests = checkQuestProgress(profile, inventory, gameState);
    if (completedQuests.length > 0) {
      completedQuests.forEach(q => {
        uiEvents.push('quest_completed');
        checkLevelUp(profile).forEach(e => { if (!uiEvents.includes(e)) uiEvents.push(e); });
      });
    }

    // ── Unique event completion tracking ──────────────────────────────────────
    if (counters.unique_completed > prevUniqueCompleted) {
      uiEvents.push('unique_event_completed');
    }

    // ── Titles & skill unlocks ────────────────────────────────────────────────
    const newTitles    = checkTitles(profile, skills);
    const serverSkills = checkSkillUnlocks(profile, skills);

    for (const t of newTitles) {
      if (t.rewards?.skill) {
        const sk = skills.skills.find(s => s.id === t.rewards.skill);
        if (sk) { sk.learned = true; serverSkills.push(sk); }
      }
    }
    if (newTitles.length || serverSkills.length) writeData('skills_library.json', skills);

    newTitles.forEach(() => uiEvents.push('title_unlocked'));
    serverSkills.forEach(sk => {
      if (!uiEvents.includes('skill_unlocked')) uiEvents.push('skill_unlocked');
      if (!parsed.new_skills) parsed.new_skills = [];
      if (!parsed.new_skills.find(s => s.id === sk.id)) parsed.new_skills.push(sk);
    });

    checkLevelUp(profile).forEach(e => { if (!uiEvents.includes(e)) uiEvents.push(e); });

    if (profile.name && profile.level >= 10 && !profile.subclass && !uiEvents.includes('subclass_available'))
      uiEvents.push('subclass_available');
    if (profile.name && profile.level >= 20 && profile.subclass && !profile.advanced_class && !uiEvents.includes('advanced_class_available'))
      uiEvents.push('advanced_class_available');

    // Combat log tracking
    try {
      const logEntries = Array.isArray(gameState.combat_log_entries) ? gameState.combat_log_entries : [];
      const events = [];
      const hpDelta    = profile.stats.HP.current  - snapHP;
      const mpDelta    = profile.stats.MP.current  - snapMP;
      const stmDelta   = profile.stats.STM.current - snapSTM;
      const expDelta   = profile.experience        - snapEXP;
      const moneyDelta = profile.money             - snapMoney;
      const enemyHPNow = gameState.current_enemy?.hp?.current ?? null;
      const enemyDelta = (snapEnemyHP !== null && enemyHPNow !== null) ? enemyHPNow - snapEnemyHP : null;

      if (hpDelta  !== 0) events.push({ type: hpDelta < 0 ? 'damage_taken' : 'heal', text: `HP ${hpDelta > 0 ? '+' : ''}${hpDelta} (${snapHP}→${profile.stats.HP.current})` });
      if (mpDelta  !== 0) events.push({ type: 'mp_change',   text: `MP ${mpDelta > 0 ? '+' : ''}${mpDelta}` });
      if (stmDelta !== 0) events.push({ type: 'stm_cost',    text: `STM ${stmDelta > 0 ? '+' : ''}${stmDelta}` });
      if (expDelta  > 0)  events.push({ type: 'exp_gain',    text: `+${expDelta} EXP` });
      if (enemyDelta !== null && enemyDelta !== 0) events.push({ type: 'enemy_damage', text: `Nemico HP ${enemyDelta > 0 ? '+' : ''}${enemyDelta} (${snapEnemyHP}→${enemyHPNow})` });

      if (events.length > 0) {
        logEntries.push({ n: logEntries.length + 1, events });
        if (logEntries.length > 30) logEntries.shift();
        gameState.combat_log_entries = logEntries;
      }
      if (prevCombatActive && !gameState.combat_active) gameState.combat_log_entries = [];
    } catch { /* non-critical */ }

    // New skills from AI
    if (Array.isArray(parsed.new_skills)) {
      for (const sk of parsed.new_skills) {
        if (sk?.id && !skills.skills.find(s => s.id === sk.id)) {
          skills.skills.push({ ...sk, learned: true });
        }
      }
      writeData('skills_library.json', skills);
    }

    // Scrittura atomica: solo se lo stream si è concluso senza errori
    if (!streamComplete) {
      sendEvent({ type: 'error', error: 'Stream interrotto prima del completamento' });
      return res.end();
    }

    autoBackup(profile, gameState, uiEvents);

    // Snapshot .bak preventivo — protegge da crash durante la writeData
    try { fs.copyFileSync(path.join(DATA_DIR, 'player_profile.json'), path.join(DATA_DIR, 'player_profile.json.bak')); } catch { /* non-critico al primo avvio */ }
    writeData('player_profile.json', profile);
    writeData('inventory.json', inventory);
    gameState.session_log = [
      ...(gameState.session_log || []).slice(-(MAX_SESSION_HISTORY - 2)),
      { role: 'user', content: message },
      { role: 'assistant', content: narrative },
    ];
    writeData('game_state.json', gameState);

    sendEvent({
      type: 'done',
      narrative,
      ui_events: uiEvents,
      new_skills: parsed.new_skills || [],
      new_titles: newTitles,
      completed_quests: completedQuests.map(q => ({ id: q.id, name: q.name, rewards: q.rewards })),
      triggered_event: triggeredEvent ? { id: triggeredEvent.id, name: triggeredEvent.name } : null,
      dungeon_room: dungCtx ? { id: dungCtx.room.id, name: dungCtx.room.name, type: dungCtx.room.type } : null,
      state: {
        profile:   readData('player_profile.json'),
        inventory: readData('inventory.json'),
        skills:    readData('skills_library.json'),
        gameState: readData('game_state.json'),
      },
    });
    res.end();

  } catch (err) {
    console.error('Chat error:', err?.message ?? err);
    sendEvent({ type: 'error', error: err.message || 'Errore interno del server' });
    res.end();
  }
  }).catch(() => {});
});

app.get('/api/diary', (req, res) => {
  try {
    const diary = readData('travel_diary.json');
    res.json(diary);
  } catch {
    res.json({ entries: [] });
  }
});

// Reset per nuova partita (mantiene i file ma azzera il contenuto)
app.post('/api/reset', (req, res) => {
  try {
    writeData('player_profile.json', {
      name: '', job: '', level: 1, experience: 0, experience_to_next: 100,
      stats: {
        HP: { current: 100, max: 100 }, MP: { current: 50, max: 50 }, STM: { current: 100, max: 100 },
        STR: 10, DEX: 10, AGI: 10, TEC: 10, VIT: 10, LUC: 10,
      },
      stat_points_available: 0, money: 500, skill_slots: 4,
      subclass: null, advanced_class: null,
      titles: [],
      status_effects: [],
      reputation: { hunters_guild: 0, merchants: 0, city_guard: 0, scholars: 0, underground: 0 },
      action_counters: {
        enemies_defeated: 0, dodges: 0, criticals: 0, enemies_analyzed: 0,
        zones_visited: ['Crysta — Città di Partenza'],
        max_money: 500, elite_kills: 0, unique_completed: 0,
        max_skills_in_combat: 0, near_death_survives: 0,
      },
    });
    try { writeData('npcs.json', { npcs: [] }); } catch {}
    // Reset learned state on all non-default skills
    try {
      const skills = readData('skills_library.json');
      skills.skills.forEach(sk => { if (!sk.unlocked_by_default) delete sk.learned; });
      writeData('skills_library.json', skills);
    } catch { /* non-critical */ }
    writeData('inventory.json', {
      equipped: { weapon: null, offhand: null, head: null, chest: null, legs: null, boots: null, hands: null, accessory_1: null, accessory_2: null },
      stat_bonuses_from_equipment: { STR: 0, DEX: 0, AGI: 0, TEC: 0, VIT: 0, LUC: 0, HP_bonus: 0, MP_bonus: 0, STM_bonus: 0 },
      bag: [],
    });
    writeData('game_state.json', {
      location: 'Crysta', sub_location: '', zone_type: 'safe_zone',
      quests_active: [], quests_completed: [], unique_scenario_flags: {},
      combat_active: false, current_enemy: null, skill_loadout: [], session_log: [],
      current_dungeon_id: null, current_room_id: null, rooms_visited: [], context_memo: '',
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/quest/start — aggiunge una quest all'elenco attive
app.post('/api/quest/start', (req, res) => {
  const { quest_id } = req.body;
  if (!quest_id) return res.status(400).json({ error: 'quest_id mancante' });
  try {
    let db;
    try { db = readData('quests_database.json'); } catch { return res.status(404).json({ error: 'quests_database.json non trovato' }); }
    const quest = (db.quests || []).find(q => q.id === quest_id);
    if (!quest) return res.status(404).json({ error: `Quest "${quest_id}" non trovata` });

    const gameState = readData('game_state.json');
    if ((gameState.quests_active || []).includes(quest_id)) return res.status(409).json({ error: 'Quest già attiva' });
    if ((gameState.quests_completed || []).includes(quest_id)) return res.status(409).json({ error: 'Quest già completata' });

    gameState.quests_active = [...(gameState.quests_active || []), quest_id];
    writeData('game_state.json', gameState);
    res.json({ ok: true, quest: { id: quest.id, name: quest.name, description: quest.description, target_counter: quest.target_counter, target_value: quest.target_value } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/quests — lista quest disponibili, attive e completate
app.get('/api/quests', (req, res) => {
  try {
    const db        = readData('quests_database.json');
    const gameState = readData('game_state.json');
    const profile   = readData('player_profile.json');
    const counters  = profile.action_counters || {};

    const quests = (db.quests || []).map(q => {
      const raw     = counters[q.target_counter];
      const current = Array.isArray(raw) ? raw.length : (raw || 0);
      const status  = (gameState.quests_completed || []).includes(q.id) ? 'completed'
                    : (gameState.quests_active    || []).includes(q.id) ? 'active'
                    : 'available';
      return { ...q, current_value: current, status };
    });
    res.json({ quests });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/dungeon/enter — entra in un dungeon e imposta la stanza iniziale
app.post('/api/dungeon/enter', (req, res) => {
  const { dungeon_id } = req.body;
  if (!dungeon_id) return res.status(400).json({ error: 'dungeon_id mancante' });
  try {
    const data = readData('dungeons.json');
    const dungeon = (data.dungeons || []).find(d => d.id === dungeon_id);
    if (!dungeon) return res.status(404).json({ error: `Dungeon "${dungeon_id}" non trovato` });

    const gameState = readData('game_state.json');
    gameState.zone_type         = 'dungeon';
    gameState.current_dungeon_id = dungeon_id;
    gameState.current_room_id    = dungeon.rooms[0]?.id || null;
    gameState.rooms_visited      = gameState.current_room_id ? [gameState.current_room_id] : [];
    writeData('game_state.json', gameState);

    const firstRoom = dungeon.rooms[0] || {};
    res.json({ ok: true, dungeon_name: dungeon.name, room: { id: firstRoom.id, name: firstRoom.name, type: firstRoom.type, connections: firstRoom.connections } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dungeon/map — mappa del dungeon corrente (stanze visitate)
app.get('/api/dungeon/map', (req, res) => {
  try {
    const gameState = readData('game_state.json');
    if (gameState.zone_type !== 'dungeon' || !gameState.current_dungeon_id) {
      return res.json({ in_dungeon: false });
    }
    const data    = readData('dungeons.json');
    const dungeon = (data.dungeons || []).find(d => d.id === gameState.current_dungeon_id);
    if (!dungeon) return res.json({ in_dungeon: false });

    const visited = new Set(gameState.rooms_visited || []);
    const rooms   = dungeon.rooms.map(r => ({
      id: r.id, name: r.name, type: r.type,
      connections: r.connections,
      visited: visited.has(r.id),
      current: r.id === gameState.current_room_id,
    }));
    res.json({ in_dungeon: true, dungeon_name: dungeon.name, current_room_id: gameState.current_room_id, rooms });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/allocate — spendi punti stat
app.post('/api/allocate', (req, res) => {
  const { allocations } = req.body;
  if (!allocations || typeof allocations !== 'object') {
    return res.status(400).json({ error: 'allocations mancanti' });
  }
  const profile = readData('player_profile.json');
  const total = Object.values(allocations).reduce((sum, v) => sum + Number(v), 0);
  if (total > (profile.stat_points_available || 0)) {
    return res.status(400).json({ error: 'Punti insufficienti' });
  }
  const valid = ['STR', 'DEX', 'AGI', 'TEC', 'VIT', 'LUC'];
  for (const [stat, amount] of Object.entries(allocations)) {
    if (valid.includes(stat) && Number(amount) > 0) {
      profile.stats[stat] = (profile.stats[stat] || 0) + Number(amount);
    }
  }
  profile.stat_points_available -= total;

  const skills    = readData('skills_library.json');
  const newSkills = checkSkillUnlocks(profile, skills);
  const newTitles = checkTitles(profile, skills);

  for (const t of newTitles) {
    if (t.rewards?.skill) {
      const sk = skills.skills.find(s => s.id === t.rewards.skill);
      if (sk) { sk.learned = true; newSkills.push(sk); }
    }
  }

  if (newSkills.length || newTitles.length) writeData('skills_library.json', skills);
  writeData('player_profile.json', profile);

  const subclass_available    = profile.level >= 10 && !profile.subclass;
  const advanced_class_available = profile.level >= 20 && profile.subclass && !profile.advanced_class;
  res.json({ profile, new_skills: newSkills, new_titles: newTitles, subclass_available, advanced_class_available });
});

// POST /api/subclass — scegli specializzazione (Lv.10+)
app.post('/api/subclass', (req, res) => {
  const { subclass_id } = req.body;
  if (!subclass_id) return res.status(400).json({ error: 'subclass_id mancante' });

  try {
    const profile = readData('player_profile.json');
    if (!profile.name) return res.status(400).json({ error: 'Personaggio non creato' });
    if (profile.level < 10) return res.status(400).json({ error: 'Livello 10 richiesto per la specializzazione' });
    if (profile.subclass) return res.status(400).json({ error: 'Specializzazione già scelta' });

    const inventory = readData('inventory.json');
    const statReqs = SUBCLASS_REQUIREMENTS[profile.job] || {};
    const statsMet = Object.entries(statReqs).every(([s, v]) => totalStat(profile, inventory, s) >= v);
    if (!statsMet) {
      const needed = Object.entries(statReqs).map(([s, v]) => `${s} ${v}`).join(', ');
      return res.status(400).json({ error: `Requisiti stat non soddisfatti per la specializzazione: ${needed}` });
    }

    const allowed = SUBCLASS_COMPAT[profile.job] || Object.keys(SUBCLASS_NAMES);
    if (!allowed.includes(subclass_id)) return res.status(400).json({ error: 'Specializzazione non disponibile per questa classe' });

    profile.subclass = subclass_id;

    const skills    = readData('skills_library.json');
    const newSkills = checkSkillUnlocks(profile, skills);
    const newTitles = checkTitles(profile, skills);
    if (newSkills.length || newTitles.length) writeData('skills_library.json', skills);
    writeData('player_profile.json', profile);

    res.json({
      profile,
      new_skills: newSkills,
      new_titles: newTitles,
      subclass_name: SUBCLASS_NAMES[subclass_id] || subclass_id,
      state: {
        profile: readData('player_profile.json'),
        inventory: readData('inventory.json'),
        skills: readData('skills_library.json'),
        gameState: readData('game_state.json'),
      },
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/advanced-class — scegli classe avanzata (Lv.20+)
app.post('/api/advanced-class', (req, res) => {
  const { advanced_class_id } = req.body;
  if (!advanced_class_id) return res.status(400).json({ error: 'advanced_class_id mancante' });

  try {
    const profile = readData('player_profile.json');
    if (!profile.name) return res.status(400).json({ error: 'Personaggio non creato' });
    if (profile.level < 20) return res.status(400).json({ error: 'Livello 20 richiesto per la classe avanzata' });
    if (!profile.subclass) return res.status(400).json({ error: 'Specializzazione non ancora scelta' });
    if (profile.advanced_class) return res.status(400).json({ error: 'Classe avanzata già scelta' });

    const inventory = readData('inventory.json');
    const statReqs = ADV_CLASS_REQUIREMENTS[profile.job] || {};
    const statsMet = Object.entries(statReqs).every(([s, v]) => totalStat(profile, inventory, s) >= v);
    if (!statsMet) {
      const needed = Object.entries(statReqs).map(([s, v]) => `${s} ${v}`).join(', ');
      return res.status(400).json({ error: `Requisiti stat non soddisfatti per la classe avanzata: ${needed}` });
    }

    const allowed = ADV_CLASS_COMPAT[profile.subclass] || [];
    if (!allowed.includes(advanced_class_id)) return res.status(400).json({ error: 'Classe avanzata non compatibile con la tua specializzazione' });

    profile.advanced_class = advanced_class_id;

    const skills    = readData('skills_library.json');
    const newSkills = checkSkillUnlocks(profile, skills);
    const newTitles = checkTitles(profile, skills);
    if (newSkills.length || newTitles.length) writeData('skills_library.json', skills);
    writeData('player_profile.json', profile);

    res.json({
      profile,
      new_skills: newSkills,
      new_titles: newTitles,
      advanced_class_name: ADV_CLASS_NAMES[advanced_class_id] || advanced_class_id,
      state: {
        profile: readData('player_profile.json'),
        inventory: readData('inventory.json'),
        skills: readData('skills_library.json'),
        gameState: readData('game_state.json'),
      },
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/world-map
app.get('/api/world-map', (req, res) => {
  try { res.json(readData('world_map.json')); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/bestiary
app.get('/api/bestiary', (req, res) => {
  try { res.json(readData('bestiary.json')); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/shop
app.get('/api/shop', (req, res) => {
  try { res.json(readData('shop.json')); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/npcs
app.get('/api/npcs', (req, res) => {
  try {
    let data;
    try { data = readData('npcs.json'); } catch { data = { npcs: [] }; }
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/unique-events', (req, res) => {
  try {
    let data;
    try { data = readData('unique_events.json'); } catch { data = { events: [] }; }
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/unique-items', (req, res) => {
  try {
    let data;
    try { data = readData('unique_items.json'); } catch { data = { items: [] }; }
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/unique-monsters', (req, res) => {
  try {
    let data;
    try { data = readData('unique_monsters.json'); } catch { data = { monsters: [] }; }
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/enhance — potenzia un oggetto (+1 enhancement_level, costo materiale + Ragne)
app.post('/api/enhance', (req, res) => {
  const { slot, bag_index, material_bag_index } = req.body;
  if (material_bag_index === undefined || material_bag_index < 0) {
    return res.status(400).json({ error: 'material_bag_index mancante' });
  }
  try {
    const profile   = readData('player_profile.json');
    const inventory = readData('inventory.json');
    const bag       = inventory.bag || [];

    if (material_bag_index >= bag.length) return res.status(400).json({ error: 'Materiale non in borsa' });
    const material = bag[material_bag_index];
    if (material.type !== 'material') return res.status(400).json({ error: 'L\'oggetto selezionato non è un materiale' });

    let item, itemSource;
    if (slot) {
      item = inventory.equipped[slot];
      itemSource = 'equipped';
      if (!item) return res.status(404).json({ error: 'Nessun oggetto in questo slot' });
    } else if (bag_index !== undefined) {
      if (bag_index >= bag.length || bag_index === material_bag_index) return res.status(400).json({ error: 'Indice oggetto non valido' });
      item = bag[bag_index];
      itemSource = 'bag';
    } else {
      return res.status(400).json({ error: 'Specifica slot o bag_index' });
    }

    if (item.type === 'consumable' || item.type === 'material') return res.status(400).json({ error: 'Questo tipo di oggetto non può essere potenziato' });
    if ((item.enhancement_level || 0) >= 5) return res.status(400).json({ error: 'Potenziamento massimo raggiunto (+5)' });

    const currentLevel = item.enhancement_level || 0;
    const moneyCost = 50 * Math.pow(currentLevel + 1, 2);
    if (profile.money < moneyCost) return res.status(400).json({ error: `Servono ${moneyCost} R (hai ${profile.money} R)` });

    // Apply enhancement: +1 to all combat stat bonuses
    item.enhancement_level = currentLevel + 1;
    const sb = item.stat_bonus || {};
    const combatStats = ['STR','DEX','AGI','TEC','VIT','LUC'];
    const keys = Object.keys(sb).filter(k => combatStats.includes(k));
    if (keys.length > 0) keys.forEach(k => { sb[k] = (sb[k] || 0) + 1; });
    else sb['STR'] = 1;
    item.stat_bonus = sb;

    profile.money -= moneyCost;

    // Remove material
    if (material.quantity > 1) bag[material_bag_index].quantity -= 1;
    else bag.splice(material_bag_index, 1);

    if (itemSource === 'equipped') {
      inventory.equipped[slot] = item;
      recalcEquipmentBonuses(inventory);
    }
    inventory.bag = bag;

    writeData('player_profile.json', profile);
    writeData('inventory.json', inventory);
    res.json({ profile, inventory, itemName: item.name, newLevel: item.enhancement_level, cost: moneyCost });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/appraise-item — tenta di identificare un oggetto non valutato (check TEC)
app.post('/api/appraise-item', (req, res) => {
  const { bag_index } = req.body;
  if (bag_index === undefined || bag_index < 0) return res.status(400).json({ error: 'Indice non valido' });
  try {
    const profile   = readData('player_profile.json');
    const inventory = readData('inventory.json');
    const bag       = inventory.bag || [];
    if (bag_index >= bag.length) return res.status(400).json({ error: 'Oggetto non in borsa' });

    const item = bag[bag_index];
    if (item.appraised !== false) return res.status(400).json({ error: 'Oggetto già identificato' });

    const tec = (profile.stats.TEC || 0) + (inventory.stat_bonuses_from_equipment?.TEC || 0);
    const roll = Math.floor(Math.random() * 100);
    const threshold = Math.max(20, Math.min(90, tec * 5));

    let result, text;
    if (roll < threshold) {
      item.appraised = true;
      inventory.bag[bag_index] = item;
      writeData('inventory.json', inventory);
      result = 'success';
      text = `TEC ${tec} — il tuo occhio non ti tradisce. L'oggetto è stato identificato.`;
    } else {
      result = 'fail';
      text = `TEC ${tec} — non riesci a comprenderne la natura. Servono più esperienza tecnica o un esperto.`;
    }

    res.json({ result, text, item: result === 'success' ? item : null, inventory: readData('inventory.json') });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/shop/generate — genera listino negozio via Gemini
app.post('/api/shop/generate', async (req, res) => {
  try {
    const profile   = readData('player_profile.json');
    const gameState = readData('game_state.json');

    const prompt = `Sei il gestore di un negozio in "${gameState.location}" di Shangri-La Frontier.
Il cliente è ${profile.name || 'uno Hunter'} (${profile.job || '?'}, Lv.${profile.level}) con ${profile.money} R.
Genera 7 oggetti in vendita bilanciati per il suo livello. Mix consigliato:
- 1-2 armi (slot: weapon o offhand) con stat_bonus.STR o DEX
- 1-2 armature (slot: head/chest/legs/boots) con stat_bonus.VIT
- 1 accessorio (slot: accessory_1) con bonus misti
- 2 consumabili (type: consumable, slot: null) come pozioni HP o MP. Per consumabili usa stat_bonus con chiavi HP_restore, MP_restore o STM_restore (es. {"HP_restore": 50}).
Rarità: comune (cheap), non_comune (moderate), raro (expensive).
Rispondi con json valido:
{
  "shop_name": "Nome evocativo del negozio",
  "items": [
    { "id": "uid_unico", "name": "Nome", "description": "Breve desc.", "type": "weapon|armor|accessory|consumable", "slot": "weapon|offhand|head|chest|legs|boots|accessory_1|null", "price": 100, "rarity": "comune|non_comune|raro", "stat_bonus": {} }
  ]
}`;

    const resp = await deepseek.chat.completions.create({
      model: MODEL,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.7,
      max_tokens: 1200,
    });
    const raw = resp.choices[0]?.message?.content || '{}';
    const parsed = JSON.parse(raw);
    const shop = {
      shop_name: parsed.shop_name || 'Negozio',
      location: gameState.location,
      items: (parsed.items || []).map((item, i) => ({ ...item, id: item.id || `item_${i}` })),
    };
    writeData('shop.json', shop);
    res.json(shop);
  } catch (err) {
    console.error('Shop generate error:', err?.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/shop/buy
app.post('/api/shop/buy', (req, res) => {
  const { item_id } = req.body;
  try {
    const profile = readData('player_profile.json');
    const inventory = readData('inventory.json');
    const shop = readData('shop.json');

    const item = shop.items.find(i => i.id === item_id);
    if (!item) return res.status(404).json({ error: 'Oggetto non trovato' });
    const merchantsRep = profile.reputation?.merchants || 0;
    const discount = merchantsRep > 80 ? 0.20 : merchantsRep > 50 ? 0.10 : merchantsRep > 20 ? 0.05 : 0;
    const finalPrice = Math.max(1, Math.floor(item.price * (1 - discount)));
    if (profile.money < finalPrice) return res.status(400).json({ error: 'Ragne insufficienti' });

    profile.money -= finalPrice;
    inventory.bag = inventory.bag || [];
    inventory.bag.push({ id: item.id, name: item.name, description: item.description,
      type: item.type, slot: item.slot, stat_bonus: item.stat_bonus || {}, rarity: item.rarity, quantity: 1, appraised: true });

    writeData('player_profile.json', profile);
    writeData('inventory.json', inventory);
    res.json({ profile, inventory });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/equip — equipa oggetto dalla borsa
app.post('/api/equip', (req, res) => {
  const { bag_index } = req.body;
  if (bag_index === undefined || bag_index < 0) return res.status(400).json({ error: 'Indice non valido' });
  try {
    const profile   = readData('player_profile.json');
    const inventory = readData('inventory.json');
    const bag       = inventory.bag || [];
    if (bag_index >= bag.length) return res.status(400).json({ error: 'Oggetto non in borsa' });

    const item = bag[bag_index];
    if (!item.slot || item.slot === 'null' || item.slot === null) return res.status(400).json({ error: 'Oggetto non equipaggiabile' });

    const slot = item.slot;
    const currentlyEquipped = inventory.equipped[slot];
    if (currentlyEquipped) bag.push(currentlyEquipped);

    bag.splice(bag_index, 1);
    inventory.equipped[slot] = item;
    inventory.bag = bag;

    recalcEquipmentBonuses(inventory);
    writeData('player_profile.json', profile);
    writeData('inventory.json', inventory);
    res.json({ profile, inventory, itemName: item.name, slot });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/unequip — rimuove oggetto equipaggiato e lo mette in borsa
app.post('/api/unequip', (req, res) => {
  const { slot } = req.body;
  const validSlots = ['weapon','offhand','head','chest','legs','boots','accessory_1','accessory_2'];
  if (!validSlots.includes(slot)) return res.status(400).json({ error: 'Slot non valido' });
  try {
    const profile   = readData('player_profile.json');
    const inventory = readData('inventory.json');
    const item      = inventory.equipped[slot];
    if (!item) return res.status(400).json({ error: 'Nessun oggetto equipaggiato in questo slot' });

    inventory.bag = inventory.bag || [];
    inventory.bag.push(item);
    inventory.equipped[slot] = null;

    recalcEquipmentBonuses(inventory);
    writeData('player_profile.json', profile);
    writeData('inventory.json', inventory);
    res.json({ profile, inventory, itemName: item.name });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/use-item — usa consumabile dalla borsa
app.post('/api/use-item', (req, res) => {
  const { bag_index } = req.body;
  if (bag_index === undefined || bag_index < 0) return res.status(400).json({ error: 'Indice non valido' });
  try {
    const profile   = readData('player_profile.json');
    const inventory = readData('inventory.json');
    const bag       = inventory.bag || [];
    if (bag_index >= bag.length) return res.status(400).json({ error: 'Oggetto non in borsa' });

    const item = bag[bag_index];
    if (item.type !== 'consumable') return res.status(400).json({ error: 'Solo i consumabili possono essere usati' });

    const sb = item.stat_bonus || {};
    const hpR  = Number(sb.HP_restore  || sb.hp_restore  || 0);
    const mpR  = Number(sb.MP_restore  || sb.mp_restore  || 0);
    const stmR = Number(sb.STM_restore || sb.stm_restore || 0);

    const effects = {};
    if (hpR > 0 || mpR > 0 || stmR > 0) {
      if (hpR > 0)  { const p = profile.stats.HP.current;  profile.stats.HP.current  = Math.min(profile.stats.HP.max,  p + hpR);  effects.hp  = profile.stats.HP.current  - p; }
      if (mpR > 0)  { const p = profile.stats.MP.current;  profile.stats.MP.current  = Math.min(profile.stats.MP.max,  p + mpR);  effects.mp  = profile.stats.MP.current  - p; }
      if (stmR > 0) { const p = profile.stats.STM.current; profile.stats.STM.current = Math.min(profile.stats.STM.max, p + stmR); effects.stm = profile.stats.STM.current - p; }
    } else {
      const p = profile.stats.HP.current;
      profile.stats.HP.current = Math.min(profile.stats.HP.max, p + 30);
      effects.hp = profile.stats.HP.current - p;
    }

    const parts = [];
    if (effects.hp  > 0) parts.push(`+${effects.hp} HP`);
    if (effects.mp  > 0) parts.push(`+${effects.mp} MP`);
    if (effects.stm > 0) parts.push(`+${effects.stm} STM`);
    const effects_text = parts.join(', ');

    if (item.quantity && item.quantity > 1) {
      bag[bag_index].quantity -= 1;
    } else {
      bag.splice(bag_index, 1);
    }
    inventory.bag = bag;

    writeData('player_profile.json', profile);
    writeData('inventory.json', inventory);
    res.json({ profile, inventory, itemName: item.name, effects, effects_text });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/shop/sell
app.post('/api/shop/sell', (req, res) => {
  const { item_index, source } = req.body; // source: 'bag'
  try {
    const profile = readData('player_profile.json');
    const inventory = readData('inventory.json');

    const bag = inventory.bag || [];
    if (item_index < 0 || item_index >= bag.length) return res.status(400).json({ error: 'Indice non valido' });

    const item = bag[item_index];
    const sellPrice = Math.max(1, Math.floor((item.price || 50) * 0.5));
    profile.money += sellPrice;
    bag.splice(item_index, 1);
    inventory.bag = bag;

    writeData('player_profile.json', profile);
    writeData('inventory.json', inventory);
    res.json({ profile, inventory, sellPrice, itemName: item.name });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/skill-loadout — aggiorna skill loadout
app.post('/api/skill-loadout', (req, res) => {
  const { skill_ids } = req.body;
  if (!Array.isArray(skill_ids)) {
    return res.status(400).json({ error: 'skill_ids deve essere un array' });
  }
  const profile = readData('player_profile.json');
  const skills = readData('skills_library.json');
  const gameState = readData('game_state.json');
  if (skill_ids.length > (profile.skill_slots || 4)) {
    return res.status(400).json({ error: `Massimo ${profile.skill_slots} skill nel loadout` });
  }
  gameState.skill_loadout = skill_ids
    .map(id => skills.skills.find(s => s.id === id))
    .filter(Boolean);
  writeData('game_state.json', gameState);
  res.json({
    skill_loadout: gameState.skill_loadout,
    gameState: readData('game_state.json'),
  });
});

// ── Mappa: salva modifiche ─────────────────────────────────────────────────────

app.put('/api/world-map', (req, res) => {
  const { zones } = req.body;
  if (!Array.isArray(zones)) return res.status(400).json({ error: 'zones deve essere un array' });
  try {
    const map = readData('world_map.json');
    map.zones = zones;
    writeData('world_map.json', map);
    res.json({ ok: true, zones });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Modalità GM umano ──────────────────────────────────────────────────────────

app.post('/api/gm-mode', (req, res) => {
  try {
    const gs = readData('game_state.json');
    gs.gm_mode = !gs.gm_mode;
    writeData('game_state.json', gs);
    res.json({ gm_mode: gs.gm_mode });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/gm-respond', (req, res) => {
  const { narrative } = req.body;
  if (!narrative?.trim()) return res.status(400).json({ error: 'Narrative vuota' });
  try {
    const gs = readData('game_state.json');
    gs.session_log = [...(gs.session_log || []).slice(-27), { role: 'assistant', content: narrative.trim() }];
    writeData('game_state.json', gs);
    res.json({
      narrative: narrative.trim(),
      state: { profile: readData('player_profile.json'), inventory: readData('inventory.json'), skills: readData('skills_library.json'), gameState: readData('game_state.json') },
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Export sessione ────────────────────────────────────────────────────────────

app.get('/api/export', (req, res) => {
  try {
    const profile   = readData('player_profile.json');
    const gameState = readData('game_state.json');
    const log       = gameState.session_log || [];

    const lines = [
      `# Shangri-La Frontier — Sessione`,
      ``,
      `**Personaggio:** ${profile.name || '—'} · ${profile.job || '?'} · Lv.${profile.level}`,
      `**Posizione:** ${gameState.location || '—'}`,
      `**Denaro:** ${profile.money} R | **EXP:** ${profile.experience}/${profile.experience_to_next}`,
      ``,
      `---`,
      ``,
    ];

    log.forEach(({ role, content }) => {
      if (role === 'user')           lines.push(`**Hunter:** ${content}`, ``);
      else if (role === 'assistant') lines.push(`**GM:** ${content}`, ``);
    });

    const filename = `shanfro-${(profile.name || 'session').toLowerCase().replace(/\s+/g, '-')}.md`;
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(lines.join('\n'));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Save Slots ─────────────────────────────────────────────────────────────────

function getSlotMeta(id) {
  try {
    const pp   = JSON.parse(fs.readFileSync(path.join(SLOTS_DIR, `slot_${id}`, 'player_profile.json'), 'utf-8'));
    const stat = fs.statSync(path.join(SLOTS_DIR, `slot_${id}`, 'player_profile.json'));
    return { id, empty: !pp.name, name: pp.name || null, job: pp.job || null, level: pp.level || 1, money: pp.money || 0, last_saved: stat.mtime.toISOString() };
  } catch {
    return { id, empty: true };
  }
}

app.get('/api/slots', (req, res) => {
  res.json([1, 2, 3].map(getSlotMeta));
});

app.post('/api/slots/:id/save', (req, res) => {
  const { id } = req.params;
  if (!['1', '2', '3'].includes(id)) return res.status(400).json({ error: 'Slot non valido' });
  try {
    const dir = path.join(SLOTS_DIR, `slot_${id}`);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    for (const file of SLOT_FILES) {
      const src = path.join(DATA_DIR, file);
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dir, file));
    }
    res.json({ ok: true, meta: getSlotMeta(id) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/slots/:id/load', (req, res) => {
  const { id } = req.params;
  if (!['1', '2', '3'].includes(id)) return res.status(400).json({ error: 'Slot non valido' });
  try {
    const dir = path.join(SLOTS_DIR, `slot_${id}`);
    for (const file of SLOT_FILES) {
      const src = path.join(dir, file);
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(DATA_DIR, file));
    }
    res.json({
      profile:   readData('player_profile.json'),
      inventory: readData('inventory.json'),
      skills:    readData('skills_library.json'),
      gameState: readData('game_state.json'),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/slots/:id', (req, res) => {
  const { id } = req.params;
  if (!['1', '2', '3'].includes(id)) return res.status(400).json({ error: 'Slot non valido' });
  try {
    const dir = path.join(SLOTS_DIR, `slot_${id}`);
    if (fs.existsSync(dir)) {
      for (const file of SLOT_FILES) {
        const fp = path.join(dir, file);
        if (fs.existsSync(fp)) fs.unlinkSync(fp);
      }
    }
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.listen(PORT, () => {
  console.log(`\n🎮  Shangri-La Frontier  →  http://localhost:${PORT}\n`);
});
