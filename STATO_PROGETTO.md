# Shangri-La Frontier — Stato del Progetto

> Documento di riferimento completo per discussioni sull'avanzamento del progetto.  
> Ultimo aggiornamento: 2026-06-17 (sessione 22 — Multi-user isolation, Game Over/Respawn autorevole, World Flags in prefix cache)

---

## 1. Cos'è il progetto

Un **VRMMO play-by-chat testuale hardcore** ispirato a *Shangri-La Frontier*. Il giocatore (Giacomo) interagisce con un Game Master AI che narra l'avventura in italiano e aggiorna in tempo reale lo stato del personaggio su file JSON.

La filosofia di design è: **nessun automatismo magico**. Ogni esito dipende dalle statistiche nel JSON. Il GM legge i file prima di ogni risposta e aggiorna tutto in modo coerente.

---

## 2. Stack Tecnico

```
Backend:   Node.js + Express
AI:        DeepSeek v4-flash via OpenAI SDK (baseURL: api.deepseek.com, JSON mode, streaming)
Frontend:  Vanilla JS + HTML + CSS (no framework)
Storage:   File JSON locali in /data/
Porta:     3000
Repo:      https://github.com/LoSbara/shangri-la-frontier
```

**Perché DeepSeek v4-flash:** migrazione da Ollama locale (qwen2.5:7b insufficiente per instruction following complesso) a API cloud. DeepSeek supporta prefix caching nativo (context caching per ridurre costi e latenza), JSON mode forzato (`response_format: { type: 'json_object' }`), streaming con `stream_options: { include_usage: true }`.

**Gestione context window e caching:** prompt strutturato a 3 livelli per massimizzare il prefix cache hit di DeepSeek:
- **Livello 1** (statico): regole gioco, lore, schema JSON — invariante tra turni
- **Livello 2** (semi-statico): personaggio, equipaggiamento, skill, lore zona — cambia raramente → cache hit alto
- **Livello 3** (dinamico): HP/MP/STM correnti, location, stato combattimento — cambia ad ogni turno
- Rolling window history: `MAX_SESSION_HISTORY = 12` messaggi in `session_log`
- Logging automatico token: input totali, cached tokens, % hit rate per ogni turno

**Streaming SSE (implementato):** `POST /api/chat` ora usa `text/event-stream`. Il frontend riceve token in tempo reale durante la generazione — la bolla del GM appare immediatamente e si riempie progressivamente.

---

## 3. Struttura File

```
Shanfro/
├── server.js               # Backend Express (~1900 righe)
├── CLAUDE.md               # Istruzioni sistema per il GM AI
├── .env                    # DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL, DEEPSEEK_MODEL, PORT
├── public/
│   ├── index.html          # UI
│   ├── app.js              # Frontend JS
│   └── style.css           # Stili
└── data/
    ├── player_profile.json   # Stato personaggio (+ skill_cooldowns)
    ├── inventory.json        # Equipaggiamento e borsa
    ├── game_state.json       # Posizione, quest, log sessione, context_memo
    ├── travel_diary.json     # Diario di viaggio permanente (entries narrative)
    ├── skills_library.json   # Skill (base + T2 + T3)
    ├── quests_database.json  # Database quest con obiettivi e rewards
    ├── dungeons.json         # Database dungeon con stanze e connessioni
    ├── bestiary.json         # Nemici incontrati
    ├── npcs.json             # NPC persistenti
    ├── shop.json             # Assortimento negozio corrente
    ├── titles.json           # 15 titoli ottenibili
    ├── world_map.json        # Zone della mappa mondiale
    ├── unique_events.json    # 8 eventi unici one-shot
    ├── unique_items.json     # 10 oggetti leggendari/epici
    ├── unique_monsters.json  # 8 boss unici
    ├── monsters_catalog.json # Drop table e parti anatomiche (dati statici design, separati da bestiary.json)
    ├── recipes_catalog.json  # Database ricette crafting statiche (5 ricette, stat_variance per appraisal)
    └── monsters_catalog.json # (aggiornato S21) include "Guardiano Antico" con phase_triggers A-tier boss
    ├── world/               # Lore zone statiche (es. bosco_novizi.json)
    ├── save/                # World state per-player mutable ([player_id]_world_state.json)
    ├── backups/             # Snapshot automatici su level_up / unique event
    └── slots/               # Slot di salvataggio (save1-3)
```

---

## 4. Architettura — Flusso di una richiesta chat

```
Player digita messaggio
        │
        ▼
  POST /api/chat  (Content-Type: text/event-stream — SSE)
        │
        ├── readData(player_profile, inventory, skills, game_state, npcs)
        ├── buildSystemPrompt(...)   ← include: personaggio, stripBagForAI(borsa),
        │                              context_memo, diaryBlock, CAMPI JSON RISPOSTA
        │                              (compatto, ~2600 token totali)
        │
        ├── ollamaChatStream(messages, { format: GM_RESPONSE_SCHEMA })
        │       Ollama streaming NDJSON → estrazione real-time del campo "narrative"
        │       → emit SSE: data: {"type":"token","text":"..."}  (per ogni token narrativo)
        │
        ├── (quando stream completo) JSON.parse(fullBuffer)
        │       parsed = { narrative, state_updates, bag_add, new_skills, ui_events,
        │                  context_memo, diary_entry, battle_tags, reputation_delta,
        │                  npc_add, npc_update, appraise_item }
        │       ← tutti i campi top-level (bag_add, reputation_delta, ecc.)
        │
        ├── salva context_memo → game_state.context_memo
        ├── salva diary_entry → travel_diary.json (se evento significativo)
        ├── deepMerge(profile, state_updates.player)
        ├── deepMerge(gameState, state_updates.game_state)
        ├── applica bag_add / appraise_item / reputation_delta / npc_add / npc_update
        ├── checkLevelUp / checkSkillUnlocks / checkTitles / checkQuestProgress
        │
        ├── writeData(player_profile, inventory, skills, game_state, npcs, diary)
        └── emit SSE: data: {"type":"done", narrative, ui_events, state, ...}
```

**Nota critica — `deepMerge`**: gli array vengono **sostituiti interamente**, non concatenati. Per aggiungere oggetti alla borsa si usa `bag_add` (top-level nel JSON di risposta), non `state_updates.inventory.bag`.

**Nota — campi top-level**: `bag_add`, `reputation_delta`, `npc_add`, `npc_update`, `appraise_item`, `diary_entry`, `battle_tags` sono tutti al livello radice del JSON di risposta GM (non dentro `state_updates`). Il server mantiene compatibilità con `state_updates.*` come fallback.

---

## 5. Modelli Dati (JSON Schema)

### 5.1 `player_profile.json`
```json
{
  "name": "Giacomino",
  "job": "Scout",
  "level": 1,
  "experience": 0,
  "experience_to_next": 100,
  "stats": {
    "HP": { "current": 100, "max": 100 },
    "MP": { "current": 50, "max": 50 },
    "STM": { "current": 100, "max": 100 },
    "STR": 10, "DEX": 18, "AGI": 15,
    "TEC": 10, "VIT": 10, "LUC": 15
  },
  "stat_points_available": 0,
  "money": 100,
  "skill_slots": 4,
  "subclass": null,
  "advanced_class": null,
  "titles": [],
  "status_effects": [],
  "reputation": {
    "hunters_guild": 0, "merchants": 0,
    "city_guard": 0, "scholars": 0, "underground": 0
  },
  "action_counters": {
    "enemies_defeated": 0, "dodges": 0, "criticals": 0,
    "enemies_analyzed": 0, "zones_visited": ["Crysta"],
    "max_money": 500, "elite_kills": 0,
    "unique_completed": 0, "max_skills_in_combat": 0,
    "near_death_survives": 0
  }
}
```

### 5.2 `inventory.json`
```json
{
  "equipped": {
    "weapon": null, "offhand": null, "head": null,
    "chest": null, "legs": null, "boots": null,
    "accessory_1": null, "accessory_2": null
  },
  "stat_bonuses_from_equipment": {
    "STR": 0, "DEX": 0, "AGI": 0, "TEC": 0,
    "VIT": 0, "LUC": 0, "HP_bonus": 0, "MP_bonus": 0, "STM_bonus": 0
  },
  "bag": [
    {
      "id": "lama_misteriosa",
      "name": "Lama dall'Aspetto Insolito",
      "type": "weapon",
      "slot": "weapon",
      "stat_bonus": { "TEC": 4 },
      "rarity": "raro",
      "price": 200,
      "appraised": false,       // oggetti non valutati: stat nascoste in UI
      "enhancement_level": 0    // 0-5, +1 stat per livello
    }
  ]
}
```

### 5.3 `game_state.json`
```json
{
  "location": "Crysta",
  "sub_location": "Mercato dei Tesori",
  "zone_type": "safe_zone",
  "quests_active": [],
  "quests_completed": [],
  "unique_scenario_flags": {},
  "combat_active": false,
  "current_enemy": null,
  "skill_loadout": [],
  "session_log": [],            // ultimi 4 messaggi (2 scambi) per context window
  "context_memo": "",           // memoria di lavoro della scena corrente (aggiornata dal GM)
  "current_dungeon_id": null,   // dungeon attivo
  "current_room_id": null,      // stanza corrente nel dungeon
  "rooms_visited": [],          // stanze visitate nel dungeon
  "counters": {}
}
```

### 5.4 `travel_diary.json`
```json
{
  "entries": [
    {
      "id": 1,
      "location": "Crysta",
      "sub_location": "Bottega di Goro",
      "summary": "Ho incontrato Goro il Fabbro, un veterano burbero ma onesto. Mi ha venduto una spada d'acciaio a 190R dopo una trattativa. Ha accennato a materiali rari nelle miniere di Aokara.",
      "npcs": ["goro_fabbro"]
    }
  ]
}
```

Il GM scrive una voce solo per eventi significativi: prima visita a un luogo, boss sconfitti, lore importante, NPC memorabili, svolte narrative. Il server inietta nel system prompt solo le voci rilevanti per la zona corrente (max 2) + l'ultima voce in assoluto per continuità.

### 5.5 `quests_database.json`
```json
{
  "quests": [
    {
      "id": "quest_id",
      "name": "Nome Quest",
      "description": "Descrizione",
      "status": "disponibile",       // disponibile | attiva | completata
      "objectives": [
        { "id": "obj_1", "description": "Uccidi 5 lupi", "type": "kill",
          "target": "Lupo", "required": 5, "current": 0 }
      ],
      "rewards": { "exp": 200, "money": 100, "items": [] },
      "prerequisite_quests": [],
      "min_level": 1,
      "location": "Crysta"
    }
  ]
}
```

### 5.6 `dungeons.json`
```json
{
  "dungeons": [
    {
      "id": "dungeon_id",
      "name": "Nome Dungeon",
      "location": "Crysta",
      "rooms": [
        {
          "id": "room_01",
          "name": "Ingresso",
          "type": "combat",     // combat | trap | puzzle | boss | reward | empty
          "description": "...",
          "connections": ["room_02", "room_03"],
          "visited": false
        }
      ]
    }
  ]
}
```

---

## 6. Sistema Memoria AI (Context Management)

Il problema principale è il context window limitato (4096 token con Ollama locale). La soluzione usa tre livelli di memoria:

### 6.1 History verbatim (breve termine)
- Ultimi 4 messaggi (2 scambi GM↔player) inclusi nel prompt
- Sufficiente per ricordare la risposta immediata precedente
- Memorizzato in `game_state.session_log`

### 6.2 Context Memo (medio termine)
- Campo `game_state.context_memo` — stringa aggiornata dal GM ad ogni turno
- Contiene: accordi presi, stato trattative, info emerse, obiettivi attivi
- Stile telegrafico: "Goro ha offerto spada 220R → player ha proposto 180R. Goro accetta 190R."
- Sostituisce la necessità di storia verbatim lunga
- Incluso nel system prompt sotto `## FILO NARRATIVO ATTUALE`

### 6.3 Diario di Viaggio (lungo termine / permanente)
- File `data/travel_diary.json` — array di entry narrative
- Il GM scrive entry solo per eventi significativi (prima visita, boss, lore, NPC importanti)
- 2-3 frasi in prima persona, stile diaristico
- Il server inietta nel prompt solo le entry rilevanti per la zona corrente
- Consultabile via `GET /api/diary`
- Persiste tra sessioni — è la "memoria episodica" dell'avventura

---

## 7. Formule di Gioco

```
Danno fisico   = (STR_totale + bonus_arma) × moltiplicatore_skill × (1 − resistenza/100)
totalStat()    = stat_base + stat_bonuses_from_equipment[stat]
% Schivata     = AGI_player / (AGI_player + AGI_nemico) × 100
% Critico base = LUC / 10    →  critico = danno × 1.5
Analisi        = clamp((TEC + LUC) / 20 × 100, 30, 100)%
Valutazione    = Math.random()*100 < Math.max(20, Math.min(90, TEC*5))
Sconto negozio = merchants_rep > 80 → 20% | > 50 → 10% | > 20 → 5%

Level up (ogni EXP_to_next raggiunta):
  HP max +10, MP max +5, STM max +5
  stat_points_available +3
  ogni 5 livelli: skill_slots +1
  EXP_to_next = level × 100
```

---

## 8. Sistemi Implementati

### 8.1 Chat con GM AI
Il sistema core. Il GM riceve un system prompt (~2600 token) con tutto lo stato del personaggio, poi risponde con **JSON strutturato in streaming**. Il formato è imposto da `GM_RESPONSE_SCHEMA` passato a Ollama come parametro `format` (structured output — il modello non può deviare dalla struttura).

**Architettura SSE dual-phase:**
1. Frontend fa `fetch('/api/chat')` e apre uno stream SSE
2. Server chiama `ollamaChatStream` con `format: GM_RESPONSE_SCHEMA`
3. I token del campo `narrative` vengono estratti in real-time e inviati come `{"type":"token","text":"..."}`
4. Al termine, il JSON completo viene parsato, tutto lo stato aggiornato, e inviato `{"type":"done",...}`
5. Il frontend riempie la bolla GM progressivamente mentre i token arrivano

**Schema risposta GM (`GM_RESPONSE_SCHEMA`):**
```json
{
  "narrative": "Narrazione in markdown italiano...",
  "state_updates": {
    "player": { "stats": { "HP": { "current": 85 } }, "money": 475 },
    "game_state": { "location": "Foresta di Aokara", "combat_active": true }
  },
  "bag_add": [{ "id": "pozione_01", "name": "Pozione di Cura", "type": "consumable", "slot": null, "stat_bonus": {}, "rarity": "comune", "price": 50 }],
  "new_skills": [],
  "ui_events": ["level_up", "skill_unlocked"],
  "battle_tags": ["player_dodge", "player_critical", "skill_used:colpo_preciso"],
  "reputation_delta": { "hunters_guild": 5 },
  "npc_add": { "id": "goro_fabbro", "name": "Goro il Fabbro", "relationship": 10 },
  "context_memo": "Da Goro il Fabbro. Vuole 190R per la spada. Player ha 100R — troppo poco.",
  "diary_entry": { "location": "Crysta", "sub_location": "Bottega di Goro",
                   "summary": "Ho incontrato Goro...", "npcs": ["goro_fabbro"] },
  "appraise_item": { "item_id": "lama_misteriosa" }
}
```

**Nota**: tutti i campi tranne `state_updates` sono al livello radice del JSON (non dentro `state_updates`). Il server gestisce compatibilità legacy `state_updates.*` come fallback.

### 8.2 Sistema Statistiche e Level Up
- 6 stat principali: STR, DEX, AGI, TEC, VIT, LUC
- `stat_points_available` distribuibili liberamente dall'UI
- Level up automatico lato server al superamento di `experience_to_next`
- `totalStat(profile, inventory, stat)` calcola stat effettiva (base + equipment bonus)

### 8.3 Albero delle Classi (3 tier)

```
Classe Base (T0)           →  Specializzazione (T2)      →  Classe Avanzata (T3)
─────────────────────────────────────────────────────────────────────────────────
Mercenario (STR15/VIT13)   → Berserker                   → Dio della Guerra / Mietitore di Sangue
                           → Guardiano                   → Fortezza Vivente / Campione di Ferro
                           → Lama Assoluta               → Santo della Spada / Maestro Doppia Lama
                           → Sovereigno*                 → Signore del Mondo / Leggenda Vivente

Scout (DEX15/AGI13)        → Acrobata                    → Danzatore del Cielo / Tempesta
                           → Ombra                       → Fantasma Assoluto / Lama Illusoria
                           → Duelista                    → Schermidore Maestro / Campione Eterno
                           → Sovereigno*

Mago (TEC15/LUC13)         → Analista Supremo            → Override Master / Tattico di Precisione
                           → Manipolatore                → Tessitore di Maledizioni / Dominatore
                           → Artefice                    → Maestro dei Costrutti / Specialista Trappole
                           → Sovereigno*

Sacerdote (VIT15/LUC13)    → Guaritore                   → Angelo Custode / Fonte di Vita
                           → Esorcista                   → Cavaliere della Luce / Giustiziere Sacro
                           → Oracolo                     → Prescelto del Destino / Veggente degli Abissi
                           → Sovereigno*

Ingegnere (TEC15/STR13)    → Meccanico                   → Mastro Ingegnere / Macchinista di Guerra
                           → Alchimista                  → Grande Alchimista / Trasmutatore
                           → Inventore                   → Genio Creativo / Golem Master
                           → Sovereigno*

* Sovereigno: disponibile a tutte le classi (multiclasse bilanciato)
```

**Totale classi:** 5 base → 16 T2 (13 uniche + Sovereigno condiviso) → 32 T3

**Requisiti stat per avanzamento (validati server-side con `totalStat`):**
- T2 (lv.10): Mercenario STR 15/VIT 12 | Scout DEX 15/AGI 13 | Mago TEC 15/LUC 12 | Sacerdote VIT 15/LUC 12 | Ingegnere TEC 15/STR 12
- T3 (lv.20): soglie più alte (+10 sulla stat primaria, +6 sulla secondaria vs T2)
- Errore leggibile in UI: `"Requisiti stat non soddisfatti per la specializzazione: DEX 15, AGI 13"`

### 8.4 Libreria Skill

| Branch | Skill | Tipo Requisito |
|--------|-------|----------------|
| `base` | 3 | Nessuno (default) |
| `STR/DEX/AGI/TEC/VIT/LUC` | 4 ciascuno (24 tot) | Stat minima |
| `unique` | 1 | Titolo speciale |
| `sacerdote_base` | 4 | `job: "Sacerdote"` |
| `ingegnere_base` | 4 | `job: "Ingegnere"` |
| `special` | 5 | Contatori `action_counters` |
| T2 (16 branch) | 5 ciascuno (80 tot) | `subclass` |
| T3 (32 branch) | 4 ciascuno (128 tot) | `advanced_class` |

**Totale skills in libreria: 249** (verificato — nessun branch mancante)

`checkSkillUnlocks()` ora supporta: `req.level`, `req.stats`, `req.skill`, `req.title`, `req.subclass`, `req.advanced_class`, `req.job`, `req.counter`

**Skill Speciali (branch `special`) — unlock da contatori:**
```
spe_colpo_leggendario  → enemies_defeated >= 20
spe_sangue_antichi     → enemies_defeated >= 30
spe_linguaggio_mostri  → enemies_analyzed >= 10
spe_fortuna_cacciatore → unique_completed >= 3
spe_risurrezione_fallen→ near_death_survives >= 5
```

### 8.5 Inventario e Borsa
- Slot equipaggiamento: `weapon, offhand, head, chest, legs, boots, accessory_1, accessory_2`
- `/api/equip` e `/api/unequip` aggiornano `equipped` e ricalcolano `stat_bonuses_from_equipment`
- Rarità: comune < non_comune < raro < epico < leggendario
- Consumabili: `type: "consumable"` → pulsante "Usa" in UI
- Materiali: `type: "material"` → usati per potenziamento

### 8.6 Potenziamento Armi (+1…+5)
Endpoint: `POST /api/enhance`  
Costo: `50 × (enhancement_level + 1)²` Ragne + 1 materiale  
Effetto: +1 a ogni stat_bonus dell'oggetto per livello  
UI: pulsante ✦ su ogni oggetto potenziabile (se ci sono materiali in borsa)

### 8.7 Valutazione Oggetti (Appraisal)
Oggetti con `appraised: false` mostrano `?` in UI al posto delle stat.  
Il player usa `POST /api/appraise-item`.  
Check: `Math.random()*100 < Math.max(20, Math.min(90, TEC*5))`  
Il GM può rivelare oggetti narrativamente via `state_updates.appraise_item`.

### 8.8 Effetti di Stato
Il GM invia l'**array completo** degli stati attivi (sostituisce il precedente):
```json
"status_effects": [
  { "id": "uid", "name": "Avvelenato", "icon": "🟢", "type": "debuff",
    "turns_remaining": 3, "value": 5, "color": "#22c55e" }
]
```
UI: pill colorati sopra il pannello laterale (nascosti quando array vuoto).

### 8.9 Reputazione Fazioni
5 fazioni: `hunters_guild, merchants, city_guard, scholars, underground`  
Range: -100…+100 | Label: Nemico / Diffidente / Neutrale / Amico / Alleato  
Il GM invia **delta** via `reputation_delta: { "hunters_guild": 10 }`.  
Effetto gameplay: sconto negozio con `merchants` reputazione alta.  
UI: barre di progressione nel pannello laterale.

### 8.10 NPC Persistenti
Stored in `data/npcs.json`.  
Il GM crea/aggiorna via `npc_add` / `npc_update` nel JSON di risposta.  
Ogni NPC: `{ id, name, faction, relationship (-100..100), notes, last_seen, location }`  
UI: modal 👤 con card NPC, barra relazione, badge "qui ora" se NPC è nella zona corrente.  
Il system prompt include gli NPC presenti nella zona corrente.

### 8.11 Sistema Titoli (15 titoli)
Sbloccati automaticamente da `checkTitles()` dopo ogni risposta chat.  
Condizioni: nemici sconfitti, schivate, critici, zone visitate, livello, ecc.  
Ricompense: stat bonus, skill slots extra, skill speciali.

### 8.12 Negozio
- `GET /api/shop` — lista oggetti
- `POST /api/shop/generate` — GM genera assortimento dinamico
- `POST /api/shop/buy` — acquisto con controllo fondi e sconto reputazione
- `POST /api/shop/sell` — vendita (50% del prezzo base)

### 8.13 Quest Tracker
- `quests_database.json` — database quest con obiettivi tipizzati (kill, collect, visit, talk, craft)
- `GET /api/quests` — lista quest con stato corrente
- `POST /api/quest/start` — attiva una quest
- Progresso obiettivi aggiornato dal server dopo ogni risposta chat (`checkQuestProgress`)
- UI: modal 📜 con sezioni Attive / Disponibili / Completate, barra progresso per obiettivo
- HUD pin nel pannello sinistro: mostra la quest selezionata con barra progresso compatta
- Toast animato a schermo quando una quest viene completata

### 8.14 Sistema Dungeon
- `dungeons.json` — database dungeon con stanze e connessioni
- Ogni stanza ha tipo: `combat | trap | puzzle | boss | reward | empty`
- `POST /api/dungeon/enter` — entra in un dungeon, imposta stanza iniziale
- `GET /api/dungeon/map` — mappa del dungeon corrente con stato stanze visitate
- Il GM aggiorna `current_room_id` in `state_updates.game_state` quando il player si sposta
- UI mappa: modal con SVG generato via BFS layout — nodi rettangolari colorati per tipo, archi connessioni, stanza corrente evidenziata con animazione pulse. Si apre automaticamente al posto della mappa mondiale quando il player è in un dungeon.

### 8.15 Bestiario
`data/bestiary.json` — nemici incontrati persistono con tier, level, weaknesses.  
Modal 📖 in UI con lista filtrata.

### 8.16 Mappa del Mondo
`GET /api/world-map` + `PUT /api/world-map`  
Zone con `name, description, zone_type, connections[]`.  
Modal mappa in UI con zone SVG cliccabili (sostituita dalla mappa dungeon quando in dungeon).

### 8.17 Slot di Salvataggio (3 slot)
Snapshot di tutti i file JSON in `data/slots/slot{1-3}/`.  
Endpoint: `GET /slots`, `POST /slots/:id/save`, `POST /slots/:id/load`, `DELETE /slots/:id`.

### 8.18 Modalità GM
`POST /api/gm-mode` + `POST /api/gm-respond` — interfaccia diretta con il GM senza AI. Usato per debug narrativo o override manuali.

### 8.19 Crafting & Appraisal (Bottega di Goro)
- `data/recipes_catalog.json` — 5 ricette statiche con `required` (ingredienti), `money_cost`, `result`, `npc_required`, opzionale `stat_variance`
- `GET /api/recipes` — lista ricette con flag `can_craft` (controlla borsa + denaro in tempo reale)
- `POST /api/craft { recipe_id }` — consuma ingredienti atomicamente, produce item, inietta `pending_narrative_events` per narrazione GM turno successivo
- Oggetti con `stat_variance` prodotti con `appraised: false` — stat nascosta finché non valutata
- UI: modal ⚒ "Bottega di Goro" (bottone nella top bar, abilitato solo in safe zone)

### 8.20 Tactical Tension Bar + Overdrive/Stagger
- `gameState.tactical_tension` (0–100 int) — accumulato durante `processBattleTags`
- Accumulo: critico giocatore → +15, part break → +40; ricevere danno → -10
- A 100: se causa = part_break → `ENEMY_STAGGERED` (nemico salta attacco quel turno); altrimenti → `PLAYER_OVERDRIVE` (danno ×1.5, UI GOLDEN_GLOW)
- Pattern `pending_combat_state` (mirror di `pending_narrative_events`): stato salvato fine turno, consumato inizio turno successivo prima della chiamata AI
- `overdrive_multiplier`: flag transitorio in gameState, consumato al primo `COMBAT_HIT_ENEMY` del turno
- `enemy_staggered_this_turn`: flag transitorio, impedisce pre-computo attacco nemico, eliminato dopo `processBattleTags`
- UI: barra gradiente sotto il pannello combattimento, pulsante a 80+ (giallo→rosso pulsante), flash dorato OVERDRIVE, shake STAGGER

### 8.25 Multi-User Isolation & Concurrent FIFO Queues (Sessione 22)
- `chatTail` globale → `chatTails = {}` (mappa per-utente); ogni richiesta accodata su `chatTails[username]`
- Header `X-User-Id` estratto da middleware (`req.username`, default `'default'`, sanitizzato)
- `USER_DATA_FILES` = set di file isolati per utente: `player_profile.json`, `inventory.json`, `game_state.json`, `skills_library.json`, `bestiary.json`, `npcs.json`, `travel_diary.json`
- `getUserDir(username)` crea `data/save/<username>/` con seed dai file globali al primo accesso
- `readUD(u,f)`, `readUDSafe(u,f)`, `writeUD(u,f,d)`, `bakUD(u,f)` — helpers per-utente con fallback .bak
- `userIO(username)` — factory object `{ read, readSafe, write, bak }` usato in tutti i ~32 endpoint
- File globali (shop.json, world_map.json, cataloghi statici) restano su `DATA_DIR` con `readData`/`writeData`

### 8.26 Game Over & Respawn Autorevole (Sessione 22)
- In `processBattleTags` → `COMBAT_HIT_PLAYER`: se `HP.current ≤ 0` dopo il danno:
  - Penalità: -20% oro corrente
  - HP impostato a 1 (minimo vitale)
  - Combattimento azzerato: `combat_active=false`, `current_enemy=null`, `threat_table={}`, `tactical_tension=0`
  - Teleport: `location='Crysta'`, `sub_location='Locanda della Città d'Inizio'`, `zone_type='safe_zone'`
  - Inietta `[💀 PLAYER_DIED_RESPAWN_ACTIVE]` in `pending_narrative_events` (narrazione obbligatoria dissoluzione/respawn)
  - UI event `PLAYER_DEATH` → dissolvenza a nero + "GAME OVER" rosso per 3.2s poi fade-out

### 8.27 World Flags & Prefix Cache Livello 2 (Sessione 22)
- `profile.flags = {}` inizializzato nel profilo (e in `/api/reset`)
- Al kill di un mostro con `is_boss: true` o `is_unique: true` in `monsters_catalog.json`: imposta `profile.flags[<name>_defeated] = true`
- `buildSystemPrompt` accetta `npcsData` e `worldFlagsBlock` come parametri (no read interna se forniti)
- `worldFlagsBlock` inserito nel **Livello 2 semi-statico** del prompt: cambia solo al kill boss, massimizzando il prefix cache hit di DeepSeek; se `guardiano_antico_del_bosco_defeated` → inietta testo narrativo permanente sullo stato del mondo

### 8.22 Appraisal API & Oggetti Vincolati/Maledetti (Sessione 21)
- `POST /api/appraise { bag_index }` — valutazione professionale a 30R: svela stat variance, applica proprietà speciali a oggetti `is_unique`
- Proprietà speciali: `cursed: true` (impossibile rimuovere senza Oggetto di Purificazione) o `restrictions: { max_armor_pieces: 0 }` (Vincolo del Predatore — difesa armatura annullata)
- Probabilità basate su LUC del giocatore; oggetti normali solo `appraised: true`
- `POST /api/unequip` ora blocca oggetti maledetti restituendo errore `cursed: true`; con Oggetto di Purificazione in borsa la maledizione viene rimossa automaticamente
- Server inietta `[EQUIP_RESTRICTION_ACTIVE: NO_ARMOR]` e `[CURSED_ITEM_EQUIPPED]` in `serverDirectives` prima di ogni chiamata AI
- `COMBAT_HIT_PLAYER`: se `max_armor_pieces: 0` è attivo, i bonus VIT dagli slot armatura sono esclusi dal calcolo difesa
- `getEquipRestrictions(inventory)` — helper che aggrega i vincoli da tutti gli slot equipaggiati

### 8.23 Multi-Phase Boss Engine (Sessione 21)
- `phase_triggers` array in `monsters_catalog.json` e in `gameState.current_enemy`
- Ogni trigger: `{ hp_threshold_pct, target_phase, stat_modifiers, clear_threat, scenic_effect, unlock_skills }`
- `processBattleTags()` controlla la soglia HP dopo ogni `COMBAT_HIT_ENEMY`: se `hp_pct ≤ threshold` e `current_phase < target_phase`:
  - Aggiorna `enemy.current_phase`
  - Applica `stat_modifiers` (moltiplicatori su stats esistenti)
  - Se `clear_threat: true`: azzera la `threat_table` (boss libero dall'aggro)
  - Inietta `[⚡ BOSS_PHASE_TRANSITION]` in `pending_narrative_events`
  - Emette `BOSS_PHASE_N` event UI (toast + shake)
- Boss "Guardiano Antico del Bosco" (Tier A) aggiunto a `monsters_catalog.json` con 2 fasi (60% e 20% HP)
- UI: toast "FASE N!" + shake + glow rosso sul pannello combattimento

### 8.24 Durabilità Dinamica Armi (Sessione 21)
- Ogni arma equipaggiata ha `durability` e `max_durability` (default 40); inizializzati al primo equip se assenti
- Degradazione in `processBattleTags` per ogni `COMBAT_HIT_ENEMY`: -1 per colpo; -2 se la parte colpita non è ancora rotta; ×2 se `overdrive_fired_this_turn`
- A `durability ≤ 0`: `broken: true`, `WEAPON_BROKEN` emesso, `pending_narrative_events` iniettato, ATK weapon zeroed
- ATK zeroing: se `weapon.broken`, il bonus STR dell'arma è sottratto da `totalStat` prima del calcolo danno
- `POST /api/repair { slot }` — disponibile solo in safe zone, costa `max_durability × 2.5` R + 1× `frammento_ferro`; ripristina durabilità e rimuove `broken`
- Barra durabilità visuale nel pannello equipaggiamento (verde → giallo pulsante a 25% → grigio se rotta); pulsante 🔧 appare se riparazione disponibile
- `serverDirectives` avvisa l'AI: barra a 25% → warning atmosferico; arma rotta → ingiunzione a narrare disagio tattico

### 8.21 Aggro & Multitarget Combat (Party NPC)
- `gameState.party` — array NPC alleati con `{ npc_id, name, hp, max_hp, vit }`
- `gameState.threat_table` — `{ player: N, [npc_id]: N }` aggiornato ogni turno
- Threat generato da danno inflitto al nemico; PROVOKE tag moltiplica minaccia giocatore ×3
- Pre-AI: calcola target con threat più alta → se NPC, applica danno server-side, inietta `[ENEMY_ATTACK_TARGET]` in `serverDirectives`, emette `NPC_HIT_[npc_id]`
- Reset threat_table e tactical_tension a fine combattimento
- `POST /api/party/add` e `DELETE /api/party/remove`
- UI: party panel con card HP NPC (flash rosso su `NPC_HIT_*` event)

---

## 9. API Endpoints (tutti)

| Metodo | Endpoint | Descrizione |
|--------|----------|-------------|
| GET | `/api/state` | Tutto lo stato corrente (profile, inventory, skills, gameState) |
| POST | `/api/chat` | Invia messaggio al GM AI |
| POST | `/api/reset` | Reset completo del personaggio |
| POST | `/api/allocate` | Distribuisce punti stat |
| POST | `/api/subclass` | Sceglie specializzazione T2 |
| POST | `/api/advanced-class` | Sceglie classe avanzata T3 |
| GET | `/api/world-map` | Mappa del mondo |
| PUT | `/api/world-map` | Aggiorna zone mappa |
| GET | `/api/bestiary` | Bestiario nemici |
| GET | `/api/shop` | Lista negozio |
| POST | `/api/shop/generate` | Genera assortimento dinamico |
| POST | `/api/shop/buy` | Acquista oggetto |
| POST | `/api/shop/sell` | Vendi oggetto |
| GET | `/api/npcs` | Lista NPC persistenti |
| GET | `/api/quests` | Lista quest con stato e progresso |
| POST | `/api/quest/start` | Attiva una quest |
| GET | `/api/diary` | Diario di viaggio (tutte le entry) |
| GET | `/api/dungeon/map` | Mappa dungeon corrente |
| POST | `/api/dungeon/enter` | Entra in un dungeon |
| GET | `/api/unique-events` | Catalogo eventi unici |
| GET | `/api/unique-items` | Catalogo oggetti leggendari |
| GET | `/api/unique-monsters` | Catalogo boss unici |
| POST | `/api/enhance` | Potenzia oggetto (+1 livello) |
| POST | `/api/appraise-item` | Valuta oggetto non identificato |
| GET | `/api/recipes` | Lista ricette crafting con flag can_craft |
| POST | `/api/craft` | Crafta un oggetto (consuma ingredienti) |
| POST | `/api/party/add` | Aggiunge NPC alleato al party |
| DELETE | `/api/party/remove` | Rimuove NPC dal party |
| POST | `/api/appraise` | Valutazione professionale (30R, proprietà speciali) |
| POST | `/api/repair` | Ripara arma/armatura (safe zone, materiali) |
| POST | `/api/equip` | Equipaggia oggetto da borsa |
| POST | `/api/unequip` | Rimuove oggetto equipaggiato |
| POST | `/api/use-item` | Usa consumabile |
| POST | `/api/skill-loadout` | Imposta loadout skill attivo |
| POST | `/api/gm-mode` | Invia comando diretto al GM |
| POST | `/api/gm-respond` | Ricevi risposta GM diretta |
| GET | `/api/export` | Esporta log sessione |
| GET | `/api/slots` | Lista slot di salvataggio |
| POST | `/api/slots/:id/save` | Salva snapshot in slot |
| POST | `/api/slots/:id/load` | Carica snapshot da slot |
| DELETE | `/api/slots/:id` | Elimina slot |

---

## 10. UI — Pannelli e Componenti

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Top bar: [↺][💾][📤][📖 Bestiary][👤 NPC][🗺 Map][📜 Quests][📕 Diary] │
├──────────────────┬──────────────────────────────────┬───────────────────┤
│  LEFT PANEL      │       CHAT / NARRATIVE            │  RIGHT PANEL      │
│                  │                                   │                   │
│ 📊 VITALI        │  [GM messages in markdown]        │ 🎒 EQUIPAGGIAMENTO│
│  HP bar          │  [Player messages]                │  8 slot visivi    │
│  MP bar          │  [System messages]                │                   │
│  STM bar         │                                   │ 💼 BORSA          │
│                  │                                   │  item cards con:  │
│ ⚡ STATI ATTIVI  │                                   │  - stat (o ?)     │
│  pill colorati   │  ┌─────────────────────────────┐ │  - pulsanti Usa/  │
│                  │  │ Input + Invia               │ │    Equipa/Valuta  │
│ 📍 POSIZIONE     │  └─────────────────────────────┘ │  - badge +N enh.  │
│  zona + subzona  │                                   │  - ✦ potenzia     │
│                  │                                   │                   │
│ 🏆 REPUTAZIONE   │                                   │ 🗡 SKILL LOADOUT  │
│  5 barre fazioni │                                   │  skill attive     │
│                  │                                   │                   │
│ 📋 QUEST ATTIVA  │                                   │ 📚 ALBERO SKILL   │
│  HUD pin con     │                                   │  branch filtrati  │
│  barra progresso │                                   │  per classe       │
│                  │                                   │                   │
│ 👤 PERSONAGGIO   │                                   │                   │
│  nome, classe,   │                                   │                   │
│  livello, EXP    │                                   │                   │
│  stat + punti    │                                   │                   │
└──────────────────┴──────────────────────────────────┴───────────────────┘
```

**Modali attivi:**
- Distribuzione punti stat
- Selezione specializzazione T2 / classe avanzata T3 (card con requisiti stat)
- Bestiario
- NPC persistenti
- Mappa del mondo (SVG interattiva)
- Mappa dungeon (SVG BFS — si apre automaticamente in dungeon)
- Quest tracker (Attive / Disponibili / Completate con barre progresso)
- Slot di salvataggio
- Negozio
- **Diario di viaggio** (📕 — entries con filtro testo + select zona, NPC badge, ordine cronologico inverso)

**Toast:** notifica animata a schermo quando una quest viene completata.

---

## 11. Pattern di Codice Chiave

### 11.0 `GM_RESPONSE_SCHEMA` + `ollamaChatStream`
```javascript
// Schema JSON passato a Ollama come parametro format (structured output)
const GM_RESPONSE_SCHEMA = {
  type: 'object', required: ['narrative'],
  properties: {
    narrative, context_memo, state_updates, bag_add, new_skills,
    ui_events, battle_tags, reputation_delta, npc_add, npc_update,
    appraise_item, diary_entry
  }
};

// Variante streaming: ritorna res.body (ReadableStream di NDJSON Ollama)
async function ollamaChatStream(messages, opts) {
  // fetch a /api/chat con stream: true, format: GM_RESPONSE_SCHEMA
  return res.body; // ReadableStream
}
```

Il server legge il ReadableStream riga per riga (NDJSON), accumula i token in `fullBuffer`, e scansiona il campo `"narrative"` carattere per carattere per estrarlo in real-time. Gestisce sia `"narrative":"` che `"narrative": "` (con o senza spazio dopo `:`, dipende dalla generazione del modello).

### 11.05 `stripBagForAI` — riduzione borsa per il prompt
```javascript
function stripBagForAI(bag) {
  return (bag || []).map(it => ({
    id, name, type, slot, stat_bonus, rarity,
    ...(it.enhancement_level ? { enh: it.enhancement_level } : {}),
    ...(it.appraised === false ? { appraised: false } : {}),
    // rimossi: description, price, quantity (non servono all'AI)
  }));
}
```
Riduce ogni item di borsa da ~120 token a ~40 token prima di passarlo al system prompt.

### 11.1 `buildSystemPrompt` — contesto per il GM
La funzione più importante del backend. Costruisce il system prompt (~2600 token totali) con:
- Stato completo del personaggio (HP, stat, titoli, stati, reputazione)
- Equipaggiamento e borsa stripped (`stripBagForAI`) con flag `[NON VALUTATO]` per oggetti non identificati
- Skill loadout e skill sbloccabili (per suggerimenti organici)
- NPC presenti nella zona corrente
- Stato combattimento se attivo
- `context_memo` corrente sotto `## FILO NARRATIVO ATTUALE`
- Voci diario rilevanti sotto `## DIARIO DI VIAGGIO`
- Regole gioco + blocco `## CAMPI JSON RISPOSTA` compatto (13 righe, ~150 token)
- **Rimossi**: `## FORMULE DI GIOCO` (~80 token), `## FORMATO RISPOSTA` con esempio JSON (~350 token), `## AGGIUNGERE OGGETTI` — tutti sostituiti dallo schema strutturato Ollama e dal blocco compatto

### 11.2 `buildDiaryBlock` — iniezione selettiva diario
```javascript
function buildDiaryBlock(gameState) {
  // Carica travel_diary.json
  // Filtra: ultimi 2 entries per la zona corrente + ultima entry in assoluto
  // Restituisce stringa markdown (max ~250 token) o stringa vuota
}
```
Inietta solo voci rilevanti per non sprecare context window.

### 11.3 `deepMerge` — aggiornamento stato
```javascript
function deepMerge(target, source) {
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      if (!target[key]) target[key] = {};
      deepMerge(target[key], source[key]);
    } else {
      target[key] = source[key];  // ARRAY SOSTITUITI COMPLETAMENTE
    }
  }
  return target;
}
```
⚠️ Gli array vengono sostituiti, mai concatenati. Per aggiungere oggetti si usa `bag_add`.

### 11.4 Template literal nesting — trappola nota
I template literal annidati con backtick dentro `${}` chiudono prematuramente il template esterno. Soluzione: precompilare le stringhe con concatenazione prima del template literal.

---

## 12. Limitazioni e Gap Noti

| Area | Problema |
|------|----------|
| **Qualità LLM** | **Problema critico** — qwen2.5:7b non riesce a seguire istruzioni multi-step complesse. Il flusso di creazione personaggio (3 passi) continua a fallire nonostante riscritture del prompt. Il modello tende a ignorare i passi successivi e ripetere il PASSO 1. Vedere sezione 15 per analisi completa. |
| **Context window** | 4096 token (limite RAM Ollama). System prompt ~2600 token → spazio per ~1400 token di storia + user message + risposta. Gestito con context_memo + diario selettivo. |
| **Velocità AI** | qwen2.5:7b locale impiega 20-60 secondi per risposta. Mitigato con SSE streaming (typing animation + token progressivi), ma rimane un'esperienza lenta. |
| **Coerenza GM** | 7b ignora spesso regole secondarie del prompt (battle_tags, sub_location). Le regole critiche (narrative, state_updates) funzionano parzialmente. |
| **Mobile** | Il layout a 3 colonne non è responsive. |
| **Multi-player** | Architettura single-player (file JSON non concurrency-safe). |
| **Auto-save** | Nessun auto-save periodico — backup automatico avviene solo su level_up e unique event. |
| **Dungeon procedurali** | I dungeon devono essere creati a mano in `dungeons.json`. Non c'è generazione procedurale. |
| **Potenziamento oggetti (UI)** | Il pulsante ✦ in UI da verificare in gioco. |

---

## 13. Prossimi Sviluppi Prioritari

> **Blocco critico**: il problema LLM (sezione 15) deve essere risolto prima di sviluppare nuove feature. Un GM che non segue le istruzioni rende inutili tutte le logiche implementate.

1. **[CRITICO] Valutare alternativa LLM** — trovare un modello/provider che segua il prompt multi-step in modo affidabile (vedere sezione 15 per opzioni)
2. **Dungeon procedurali** — generazione automatica stanze da template
3. **Primo dungeon completo** — dungeon starter manuale in `dungeons.json` per testare il sistema
4. **Popolazione `world_map.json`** — zone, connessioni e zone_type per la mappa esplorabile
5. **Bilanciamento drop/economy** — verificare reward quest e drop nemici in gioco

**Completati in sessione 18:**
- ✅ **Migrazione DeepSeek v4-flash** — sostituito Ollama locale con API DeepSeek via OpenAI SDK; `response_format: { type: 'json_object' }`, streaming con `include_usage: true`
- ✅ **3-level prompt split** — Livello 1 (statico) / Livello 2 semi-statico (personaggio + lore zona) / Livello 3 dinamico (HP/MP/STM correnti) per massimizzare prefix cache hit DeepSeek
- ✅ **FIFO queue** — `chatTail = chatTail.then(...).catch(...)` per serializzare richieste concorrenti
- ✅ **Atomic writes** — guard `if (!streamComplete)` prima di tutte le `writeData`, `.bak` preventivo su `player_profile.json`
- ✅ **Unicode stream parser** — gestione `\uXXXX` nel loop di estrazione narrative in streaming
- ✅ **Rolling window** — `MAX_SESSION_HISTORY = 12` su `session_log`
- ✅ **Token logging** — cache hit rate e conteggi DeepSeek loggiati per ogni turno
- ✅ **World Memory dynamic loading** — `readData('world/[zona].json')` iniettato nel Livello 2
- ✅ **Battle Tags Engine** — `processBattleTags` applica delta matematici da snapshot PRE-TURNO (immune ad allucinazioni AI)
- ✅ **UI Events dispatch** — `dispatchUIEvents` con `SCREEN_SHAKE`, `RED_FLASH`, `HEAL_EFFECT` + CSS animations
- ✅ **Loot Engine** — `BAG_ADD/BAG_REMOVE` con controllo quantità server-side
- ✅ **Status Effects tick** — `tickStatusEffects` a inizio turno (danno/cura per turno), `STATUS_ADD/REMOVE` tags
- ✅ **Quest Tracker** — `QUEST_START/PROGRESS` tags, auto-push `quest_completed` UI event
- ✅ **Skill Cooldown Engine** — `SKILL_USE` valida CD + MP + STM server-side; `tickCooldowns` a inizio turno
- ✅ **Atomic Snapshotting** — `readDataSafe` con fallback `.bak` su JSON corrotto; `autoBackup` su level_up/unique
- ✅ **COMBAT_HIT Calculator** (Mod. 1) — tag `COMBAT_HIT_PLAYER_*` e `COMBAT_HIT_ENEMY_*`; danno calcolato da stats reali (Monster_STR, Player_VIT, skill multiplier, resistenza%)
- ✅ **World State Persistence** (Mod. 2) — `/data/save/[player_id]_world_state.json`; init da file statico; aggiornamento `is_dead:true` quando HP nemico → 0; filtro liveMonsters nel Level 2
- ✅ **UI HUD Cooldown** (Mod. 3) — `renderSkills(loadout, maxSlots, cooldowns)` con overlay `XTurni`; `updatePlayerHUD` function; CSS `.skill-on-cd` + `.skill-cd-overlay`

**Completati in sessione 19:**
- ✅ **Drop Tables deterministiche (LUC-based)** — `rollDropTable()` + `getMonsterCatalogEntry()`: formula `chanceEff = min(95, chance × (1 + LUC/100))`; drop iniettati direttamente in `inventory.bag`; evento `[🎁 LOOT]` in `pending_narrative_events` per narrazione al turno successivo; UI event `loot_obtained` con flash animazione borsa
- ✅ **Dungeon Trap/Puzzle pre-computation** — check AGI (trappole: `min(95, max(5, AGI×4))`) e TEC (puzzle: `TEC×5`) eseguiti PRIMA della chiamata AI; risultati iniettati in `serverDirectives` per narrazione coerente; `preUIEvents[]` per `SCREEN_SHAKE`/`RED_FLASH` da falimenti; `rooms_triggered` con chiave compound `[dungeon_id]:[room_id]`
- ✅ **Part Break System** — tag esteso `COMBAT_HIT_ENEMY_[monster_id]_[body_part]_[skill_id]`; parsing a due passi (trova skill_id dal suffisso più lungo, poi body_part tra i token rimanenti vs keys di `enemy.parts`); 50% danno attacco alla parte; al break: `broken: true`, debuff stat permanente applicato all'enemy, `PART_BROKEN_*` UI event, evento `pending_narrative_events` per narrazione obbligatoria turno corrente
- ✅ **`monsters_catalog.json`** — file dati design separato da `bestiary.json`; 5 mostri (Goblin Esploratore, Melma Verde, Lupo Selvatico, Goblin Guerriero, Orso delle Caverne) con drop table e parti anatomiche
- ✅ **`pending_narrative_events`** — array persistito in `game_state`; iniettato all'inizio del turno successivo in `serverDirectives`; svuotato immediatamente dopo l'iniezione
- ✅ **`showPartBreakToast()`** — toast animato CSS con colore/icona configurabili; riutilizzato anche per `puzzle_solved`; CSS `.part-break-toast` con transizione scale+opacity

**Completati in sessione 14:**
- ✅ Creazione personaggio step-aware — `buildSystemPrompt` usa `gmTurns` per emettere PASSO 1 / PASSO 2 / PASSO 3
- ✅ Stat esplicite nel prompt — valori JSON-ready per ogni classe
- ✅ Money mismatch — allineati a 500R
- ✅ Custom class stat_points — `stat_points_available: 18`
- ✅ `unique_event_completed` — snapshot del valore precedente ora corretto
- ✅ `buildUnlockableBlock` — check `req.level` aggiunto
- ✅ Animazione caricamento chat — typing dots nella bolla GM

---

---

## 15. Problema LLM — Analisi e Opzioni

### 15.1 Il problema

Il modello `qwen2.5:7b` è insufficiente per questo caso d'uso. I sintomi osservati in gioco:

- **Ripete sempre l'intro** "Benvenuti nel mondo di Shangri-La Frontier" ad ogni turno, anche dopo che il giocatore ha fornito nome e classe
- **Nomi classi inventati** (Cacciatore, Stregone, Rovinatore) invece di usare quelli elencati nel prompt
- **Istruzioni multi-step ignorate**: il modello non riesce a tenere traccia di "sei al passo 2 di 3"
- **Placeholders letterali nel JSON**: tendenza a emettere `"STR": X` invece di sostituire il valore

Il flusso di creazione personaggio richiede che il modello:
1. Segua istruzioni condizionali in base al turno corrente
2. Recuperi informazioni da turni precedenti (il nome da h[-2])
3. Compili un JSON con valori specifici per la classe scelta

Un modello da 7 miliardi di parametri fatica con tutto questo, soprattutto con un system prompt da ~2600 token che esaurisce gran parte del context window di 4096.

### 15.2 Confronto con la situazione precedente

| | Prima (API Groq) | Ora (Ollama locale) |
|---|---|---|
| **Modello** | Llama 3.1 70B o simile | qwen2.5:7b |
| **Context window** | 8K–128K | 4096 (limite RAM) |
| **Qualità instruction following** | Alta — seguiva prompt complessi | Bassa — ignora condizioni e step |
| **Velocità** | ~2-5 secondi | 20-60 secondi |
| **Costo** | Rate limit (100K TPD Groq free) | Gratuito ma inutilizzabile |
| **JSON accuracy** | Alta | Media-bassa |

### 15.3 Opzioni valutabili

**Opzione A — Modello locale più grande**
- `llama3.1:8b` o `mistral:7b` — qualità simile al 7b attuale, probabilmente insufficiente
- `llama3.1:70b` o `qwen2.5:32b` — richiederebbe 20-40 GB RAM. Non fattibile sulla macchina attuale (13 GB totali)
- **Conclusione**: la RAM è il collo di bottiglia, non il modello specifico

**Opzione B — Tornare a Groq ma con tier pagato**
- Groq Pro: rate limit molto più alto, modelli 70B disponibili (llama-3.1-70b-versatile)
- Costo stimato: $5-20/mese per uso normale
- **Pro**: alta qualità, bassa latenza (~2s), nessun limite hardware
- **Contro**: costo, dipendenza da servizio esterno

**Opzione C — OpenAI API**
- `gpt-4o-mini`: ottimo instruction following, ~$0.15/1M token input, ~$0.60/1M output
- Per una sessione media (~20 turni × ~3000 token/turno): ~$0.02 a sessione
- **Pro**: instruction following eccellente, JSON mode nativo
- **Contro**: costo (basso ma presente), latenza ~1-3s

**Opzione D — Google Gemini API**
- `gemini-1.5-flash`: gratuito fino a 1500 richieste/giorno (15 RPM free tier)
- `gemini-2.0-flash`: veloce, context window 1M token, JSON mode supportato
- **Pro**: free tier generoso, qualità alta, context enorme
- **Contro**: 15 RPM = 15 messaggi/minuto (sufficiente per play-by-chat), possibili latenze

**Opzione E — Anthropic Claude API**
- `claude-haiku-3.5`: veloce, economico (~$0.80/1M input), ottimo instruction following
- **Pro**: eccellente su prompt strutturati e JSON, coerenza altissima
- **Contro**: costo, nessun free tier

### 15.4 Raccomandazione tecnica

Per questo progetto (prompt ~2600 token, JSON strutturato, istruzioni multi-step, italiano), servono almeno **13B-70B parametri** o un modello frontier (GPT-4o, Gemini, Claude).

**Percorso consigliato**:
1. Testare **Gemini 2.0 Flash** (free tier) — context 1M risolverebbe anche il problema della context window
2. Se il free tier è insufficiente per le sessioni, valutare **gpt-4o-mini** per il costo bassissimo

### 15.5 Impatto sull'architettura

Il cambio di provider richiederebbe:
- Sostituire `ollamaChat` / `ollamaChatStream` con il client del nuovo provider
- Il `GM_RESPONSE_SCHEMA` (JSON structured output) è supportato nativamente da OpenAI, Gemini, Anthropic
- Lo **streaming SSE** frontend non va modificato — cambia solo il backend che alimenta lo stream
- Il system prompt rimane invariato — anzi, con più context window si potrebbe espandere

---

## 14. Come Avviare

```bash
cd "Progetti privati/Shanfro"
npm install
node server.js
# → http://localhost:3000
```

Requisiti:
- **Ollama** in esecuzione su `http://localhost:11434`
- **qwen2.5:7b** scaricato: `ollama pull qwen2.5:7b`
- **RAM disponibile**: almeno 5 GB (il modello occupa ~4.7 GB)

Variabili d'ambiente (`.env`):
```
PORT=3000
OLLAMA_MODEL=qwen2.5:7b
OLLAMA_URL=http://localhost:11434
```

**Reset personaggio:** POST `/api/reset` oppure pulsante ↺ in UI.
