require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const Groq = require('groq-sdk');

const app = express();
const PORT = process.env.PORT || 3000;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const MODEL = 'llama-3.3-70b-versatile';

if (!GROQ_API_KEY) {
  console.error('❌  GROQ_API_KEY mancante nel file .env');
  process.exit(1);
}

const groq = new Groq({ apiKey: GROQ_API_KEY });
const DATA_DIR = path.join(__dirname, 'data');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readData(filename) {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, filename), 'utf-8'));
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

// ─── System Prompt ────────────────────────────────────────────────────────────

function buildSystemPrompt(profile, inventory, skills, gameState) {
  const isNew = !profile.name;
  const loadout = gameState.skill_loadout || [];
  const equip = inventory.equipped || {};

  const equipLines = Object.entries(equip)
    .map(([slot, item]) => `  ${slot}: ${item ? item.name : 'vuoto'}`)
    .join('\n');

  const loadoutLines = loadout.length
    ? loadout.map(s => `  - ${s.name} | Costo: ${JSON.stringify(s.cost)} | ${s.effect}`).join('\n')
    : '  (nessuna skill equipaggiata)';

  const questLines = (gameState.quests_active || []).join(', ') || 'nessuna';

  let stateBlock = isNew
    ? `## PERSONAGGIO NON CREATO — AVVIA CREAZIONE
Guida il giocatore passo per passo:
1. Presentati come il Sistema di Shangri-La Frontier e descrivi la città di partenza Crysta
2. Chiedi il nome del personaggio
3. Proponi le classi:
   - Mercenario: STR+5, VIT+3 — combattente frontale resistente
   - Scout: DEX+5, AGI+3 — veloce, preciso, schivate
   - Mago: TEC+5, LUC+3 — skill potenti, drop rari
   - Custom: distribuzione libera dei 15 punti + 8 bonus classe
4. Chiedi come distribuire i punti rimanenti nelle stat (STR/DEX/AGI/TEC/VIT/LUC)
5. Quando il giocatore conferma tutto, aggiorna state_updates.player con il profilo completo:
{
  "name": "NomeGiocatore",
  "job": "Mercenario",
  "stats": {
    "HP": {"current": 100, "max": 100},
    "MP": {"current": 50, "max": 50},
    "STM": {"current": 100, "max": 100},
    "STR": 15, "DEX": 10, "AGI": 10, "TEC": 10, "VIT": 13, "LUC": 10
  },
  "stat_points_available": 0
}`
    : `## PERSONAGGIO: ${profile.name} — ${profile.job || '?'} — Lv.${profile.level}

HP: ${profile.stats.HP.current}/${profile.stats.HP.max} | MP: ${profile.stats.MP.current}/${profile.stats.MP.max} | STM: ${profile.stats.STM.current}/${profile.stats.STM.max}
STR: ${totalStat(profile, inventory, 'STR')} | DEX: ${totalStat(profile, inventory, 'DEX')} | AGI: ${totalStat(profile, inventory, 'AGI')}
TEC: ${totalStat(profile, inventory, 'TEC')} | VIT: ${totalStat(profile, inventory, 'VIT')} | LUC: ${totalStat(profile, inventory, 'LUC')}
EXP: ${profile.experience}/${profile.experience_to_next} | Denaro: ${profile.money} R
Punti stat disponibili: ${profile.stat_points_available || 0}

Equipaggiamento:
${equipLines}

Skill loadout (${loadout.length}/${profile.skill_slots} slot usati):
${loadoutLines}

Posizione: ${gameState.location} (${gameState.zone_type})
Quest attive: ${questLines}`;

  if (!isNew && gameState.combat_active && gameState.current_enemy) {
    const e = gameState.current_enemy;
    const statsLine = e.revealed
      ? `STR ${e.stats?.STR ?? '?'} | AGI ${e.stats?.AGI ?? '?'} | Resistenza ${e.stats?.resistenza ?? 0}% | Debolezze: ${e.weaknesses?.join(', ') || 'nessuna'}`
      : 'stat non ancora analizzate';
    stateBlock += `\n\n⚔ COMBATTIMENTO ATTIVO
Nemico: ${e.name} (Tier ${e.tier ?? '?'}, Lv.${e.level ?? '?'}) — HP: ${e.hp?.current ?? '?'}/${e.hp?.max ?? '?'}
${statsLine}`;
  }

  return `Sei il Game Master di SHANGRI-LA FRONTIER, un VRMMO testuale hardcore. Rispondi sempre in italiano.
Ogni esito è determinato dalle statistiche del personaggio. Non inventare numeri: usa le stat attuali per calcolare tutto.

${stateBlock}

## LORE
- Moneta: Ragne (R) | I giocatori sono chiamati "Hunters"
- Tier mob: F < E < D < C < B < A < S < SS < SSS (boss unici, scenari irripetibili)
- Scenari "Unique": one-shot ad alto rischio e ricompensa, attivati da LUC alta

## FORMULE DI GIOCO
- Danno fisico = (STR_totale + bonus_arma) × moltiplicatore_skill × (1 − resistenza_nemico/100)
- % Schivata = AGI_player / (AGI_player + AGI_nemico) × 100
- % Critico = LUC / 10 → critico = danno × 1.5
- Analisi = clamp((TEC + LUC) / 20 × 100, 30, 100)% di informazioni rivelate
- Level up: ogni EXP_to_next raggiunta → +10 HP max, +5 MP max, +5 STM max, +3 punti stat, +1 skill slot ogni 5 livelli

## FORMATO RISPOSTA — OBBLIGATORIO JSON
Rispondi SEMPRE con un json valido, senza testo fuori dal JSON:
{
  "narrative": "Narrazione immersiva in italiano. Usa **grassetto** per danni/numeri critici, *corsivo* per atmosfera ed effetti visivi. Sii cinematico e dettagliato.",
  "state_updates": {
    "player": {
      "stats": { "HP": { "current": 85 }, "STM": { "current": 70 } },
      "experience": 125,
      "money": 450
    },
    "game_state": {
      "location": "Nuova Zona",
      "zone_type": "combat_zone",
      "quests_active": ["nome quest"]
    }
  },
  "new_skills": [],
  "ui_events": []
}

REGOLE state_updates:
- Per HP/MP/STM usa SEMPRE { "current": N } mai solo il numero
- Per stat base (STR, DEX ecc.) usa solo il numero: { "STR": 15 }
- Ometti state_updates se nulla cambia
- ui_events può contenere: "level_up", "skill_unlocked", "item_found"
- Se il giocatore sblocca una nuova skill, includila in new_skills con: id, name, type, requirements, cost, effect

## GESTIONE COMBATTIMENTO
Per iniziare uno scontro:
"game_state": { "combat_active": true, "zone_type": "combat_zone", "current_enemy": { "name": "Nome", "tier": "D", "level": 5, "hp": { "current": 80, "max": 80 }, "stats": { "STR": 12, "AGI": 8, "resistenza": 10 }, "weaknesses": [], "revealed": false } }
Per aggiornare HP nemico durante il combattimento:
"game_state": { "current_enemy": { "hp": { "current": 45 } } }
Per rivelare stat nemico dopo Analisi:
"game_state": { "current_enemy": { "revealed": true, "weaknesses": ["fuoco"] } }
Per terminare il combattimento:
"game_state": { "combat_active": false, "zone_type": "safe_zone", "current_enemy": null }`;
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

app.post('/api/chat', async (req, res) => {
  const { message } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'Messaggio vuoto' });

  try {
    const profile = readData('player_profile.json');
    const inventory = readData('inventory.json');
    const skills = readData('skills_library.json');
    const gameState = readData('game_state.json');

    const history = (gameState.session_log || []).slice(-28);
    const systemPrompt = buildSystemPrompt(profile, inventory, skills, gameState);

    const completion = await groq.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        ...history.map(h => ({ role: h.role, content: h.content })),
        { role: 'user', content: message },
      ],
      temperature: 0.85,
      max_tokens: 2000,
      response_format: { type: 'json_object' },
    });

    const rawContent = completion.choices[0]?.message?.content ?? '{}';
    let parsed;
    try {
      parsed = JSON.parse(rawContent);
    } catch {
      parsed = { narrative: rawContent };
    }

    const narrative = parsed.narrative || '(risposta non valida dal GM)';
    const uiEvents = Array.isArray(parsed.ui_events) ? parsed.ui_events : [];

    // Apply state updates
    if (parsed.state_updates?.player) deepMerge(profile, parsed.state_updates.player);
    if (parsed.state_updates?.inventory) deepMerge(inventory, parsed.state_updates.inventory);
    if (parsed.state_updates?.game_state) deepMerge(gameState, parsed.state_updates.game_state);

    // Level up check
    checkLevelUp(profile).forEach(e => {
      if (!uiEvents.includes(e)) uiEvents.push(e);
    });

    // New skills
    if (Array.isArray(parsed.new_skills)) {
      for (const sk of parsed.new_skills) {
        if (sk?.id && !skills.skills.find(s => s.id === sk.id)) {
          skills.skills.push({ ...sk, learned: true });
        }
      }
      writeData('skills_library.json', skills);
    }

    // Persist
    writeData('player_profile.json', profile);
    writeData('inventory.json', inventory);

    gameState.session_log = [
      ...(gameState.session_log || []).slice(-27),
      { role: 'user', content: message },
      { role: 'assistant', content: narrative },
    ];
    writeData('game_state.json', gameState);

    res.json({
      narrative,
      ui_events: uiEvents,
      state: {
        profile: readData('player_profile.json'),
        inventory: readData('inventory.json'),
        skills: readData('skills_library.json'),
        gameState: readData('game_state.json'),
      },
    });

  } catch (err) {
    console.error('Chat error:', err?.message ?? err);
    const status = err?.status === 429 ? 429 : err?.status === 401 ? 401 : 500;
    const msg = {
      429: 'Rate limit Groq raggiunto. Aspetta qualche secondo e riprova.',
      401: 'API key Groq non valida. Controlla il file .env.',
    };
    res.status(status).json({ error: msg[status] ?? err.message });
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
      stat_points_available: 15, money: 500, skill_slots: 4,
    });
    writeData('inventory.json', {
      equipped: { weapon: null, offhand: null, head: null, chest: null, legs: null, boots: null, accessory_1: null, accessory_2: null },
      stat_bonuses_from_equipment: { STR: 0, DEX: 0, AGI: 0, TEC: 0, VIT: 0, LUC: 0, HP_bonus: 0, MP_bonus: 0, STM_bonus: 0 },
      bag: [],
    });
    writeData('game_state.json', {
      location: 'Crysta — Città di Partenza', zone_type: 'safe_zone',
      quests_active: [], quests_completed: [], unique_scenario_flags: {},
      combat_active: false, current_enemy: null, skill_loadout: [], session_log: [],
    });
    res.json({ ok: true });
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
  writeData('player_profile.json', profile);
  res.json({ profile });
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

app.listen(PORT, () => {
  console.log(`\n🎮  Shangri-La Frontier  →  http://localhost:${PORT}\n`);
});
