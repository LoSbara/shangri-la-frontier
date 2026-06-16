# Shangri-La Frontier — Stato del Progetto

> Documento di riferimento completo per discussioni sull'avanzamento del progetto.  
> Ultimo aggiornamento: 2026-06-16 | Commit: `aca8d9b`

---

## 1. Cos'è il progetto

Un **VRMMO play-by-chat testuale hardcore** ispirato a *Shangri-La Frontier*. Il giocatore (Giacomo) interagisce con un Game Master AI (Claude/LLM via Groq) che narra l'avventura in italiano e aggiorna in tempo reale lo stato del personaggio su file JSON.

La filosofia di design è: **nessun automatismo magico**. Ogni esito dipende dalle statistiche nel JSON. Il GM legge i file prima di ogni risposta e aggiorna tutto in modo coerente.

---

## 2. Stack Tecnico

```
Backend:   Node.js + Express
AI:        Groq API — modello llama-3.3-70b-versatile (JSON mode forzato)
Frontend:  Vanilla JS + HTML + CSS (no framework)
Storage:   File JSON locali in /data/
Porta:     3000
Repo:      https://github.com/LoSbara/shangri-la-frontier
```

---

## 3. Struttura File

```
Shanfro/
├── server.js               # Backend Express (1551 righe)
├── CLAUDE.md               # Istruzioni sistema per il GM AI
├── .env                    # GROQ_API_KEY
├── public/
│   ├── index.html          # UI (365 righe)
│   ├── app.js              # Frontend JS (1603 righe)
│   └── style.css           # Stili (1972 righe)
└── data/
    ├── player_profile.json   # Stato personaggio
    ├── inventory.json        # Equipaggiamento e borsa
    ├── game_state.json       # Posizione, quest, log sessione
    ├── skills_library.json   # 249 skill (sbloccate/da sbloccare)
    ├── bestiary.json         # Nemici incontrati
    ├── npcs.json             # NPC persistenti
    ├── titles.json           # 15 titoli ottenibili
    ├── unique_events.json    # 8 eventi unici one-shot
    ├── unique_items.json     # 10 oggetti leggendari/epici
    ├── unique_monsters.json  # 8 boss unici
    └── slots/               # Slot di salvataggio (save1-3)
```

---

## 4. Architettura — Flusso di una richiesta chat

```
Player digita messaggio
        │
        ▼
  POST /api/chat
        │
        ├── readData(player_profile, inventory, skills, game_state, npcs)
        ├── buildSystemPrompt(...)   ← costruisce contesto completo per l'LLM
        ├── Groq API call (JSON mode) ← llama-3.3-70b-versatile
        │       risponde con: { narrative, state_updates, bag_add, new_skills, ui_events, ... }
        │
        ├── deepMerge(profile, state_updates.player)
        ├── deepMerge(gameState, state_updates.game_state)
        ├── checkLevelUp(profile)
        ├── checkSkillUnlocks(profile, skills)
        ├── checkTitles(profile, skills)
        ├── gestione bag_add / appraise_item / reputation_delta / npc_add / npc_update
        │
        ├── writeData(player_profile, inventory, skills, game_state, npcs)
        └── res.json({ narrative, newSkills, newTitles, ... })
```

**Nota critica — `deepMerge`**: gli array vengono **sostituiti interamente**, non concatenati. Per aggiungere oggetti alla borsa si usa `bag_add` (array separato), non `state_updates.inventory.bag`.

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
      "appraised": false,          // ← oggetti non valutati: stat nascoste in UI
      "enhancement_level": 0       // ← 0-5, +1 stat per livello
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
  "unique_scenario_flags": {},     // { "gladiatore_antico_completato": true }
  "combat_active": false,
  "current_enemy": null,           // vedi sotto
  "skill_loadout": [],             // skill equipaggiate (max skill_slots)
  "session_log": []                // storico messaggi GM/player
}

// current_enemy durante il combattimento:
{
  "name": "Lupo Selvatico", "tier": "D", "level": 3,
  "hp": { "current": 45, "max": 80 },
  "stats": { "STR": 10, "AGI": 8, "resistenza": 5 },
  "weaknesses": ["fuoco"],
  "revealed": true
}
```

### 5.4 Oggetto nella borsa — Skill
```json
{
  "id": "colpo_preciso",
  "name": "Colpo Preciso",
  "type": "physical",
  "branch": "DEX",
  "requirements": { "stats": { "DEX": 12 } },
  "cost": { "STM": 15 },
  "effect": "Attacco preciso. Danno = DEX × 1.8. +20% critico.",
  "learned": false
}
```

---

## 6. Formule di Gioco

```
Danno fisico   = (STR_totale + bonus_arma) × moltiplicatore_skill × (1 − resistenza/100)
Danno totale   = totalStat(profile, inventory, 'STR')  ← somma stat base + equipaggiamento
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

## 7. Sistemi Implementati

### 7.1 Chat con GM AI
Il sistema core. Il GM riceve un system prompt con tutto lo stato del personaggio, poi risponde **esclusivamente in JSON**:

```json
{
  "narrative": "Narrazione in markdown italiano...",
  "state_updates": {
    "player": { "stats": { "HP": { "current": 85 } }, "money": 475 },
    "game_state": { "location": "Foresta di Aokara", "combat_active": true }
  },
  "bag_add": [{ "id": "pozione_01", "name": "Pozione di Cura", ... }],
  "new_skills": [],
  "ui_events": ["level_up", "skill_unlocked"],
  "counters": { "dodges": 1, "criticals": 0 },
  "reputation_delta": { "hunters_guild": 5 },
  "npc_add": { "id": "goro_fabbro", "name": "Goro il Fabbro", "relationship": 10 },
  "appraise_item": { "bag_index": 0 }
}
```

### 7.2 Sistema Statistiche e Level Up
- 6 stat principali: STR, DEX, AGI, TEC, VIT, LUC
- `stat_points_available` distribuibili liberamente dall'UI
- Level up automatico lato server al superamento di `experience_to_next`
- `totalStat(profile, inventory, stat)` calcola stat effettiva (base + equipment bonus)

### 7.3 Albero delle Classi (3 tier)

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

### 7.4 Libreria Skill (249 totali)

| Branch | Skill | Tipo Requisito |
|--------|-------|----------------|
| `base` | 3 | Nessuno (default) |
| `STR/DEX/AGI/TEC/VIT/LUC` | 4 ciascuno (24 tot) | Stat minima |
| `unique` | 1 | Titolo speciale |
| `sacerdote_base` | 4 | `job: "Sacerdote"` |
| `ingegnere_base` | 4 | `job: "Ingegnere"` |
| `special` | 5 | Contatori `action_counters` |
| T2 (13 branch) | 5 ciascuno (65 tot) | `subclass` |
| T3 (32 branch) | 4 ciascuno (128 tot) | `advanced_class` |

**Requisiti di unlock (in `checkSkillUnlocks`):**
- `requirements.stats` — stat minime
- `requirements.subclass` — specializzazione T2
- `requirements.advanced_class` — classe avanzata T3
- `requirements.job` — classe base specifica
- `requirements.skill` — skill prerequisito
- `requirements.title` — titolo guadagnato
- `requirements.counter` — `{ "enemies_defeated": 20 }` ecc.

**Skill Speciali (branch `special`) — unlock da contatori:**
```
spe_colpo_leggendario  → enemies_defeated >= 20
spe_sangue_antichi     → enemies_defeated >= 30
spe_linguaggio_mostri  → enemies_analyzed >= 10
spe_fortuna_cacciatore → unique_completed >= 3
spe_risurrezione_fallen→ near_death_survives >= 5
```

### 7.5 Inventario e Borsa
- Slot equipaggiamento: `weapon, offhand, head, chest, legs, boots, accessory_1, accessory_2`
- `/api/equip` e `/api/unequip` aggiornano `equipped` e ricalcolano `stat_bonuses_from_equipment`
- Rarità: comune < non_comune < raro < epico < leggendario
- Consumabili: `type: "consumable"` → pulsante "Usa" in UI
- Materiali: `type: "material"` → usati per potenziamento

### 7.6 Potenziamento Armi (+1…+5)
Endpoint: `POST /api/enhance`  
Costo: `50 × (enhancement_level + 1)²` Ragne + 1 materiale  
Effetto: +1 a ogni stat_bonus dell'oggetto per livello  
UI: pulsante ✦ su ogni oggetto potenziabile (se ci sono materiali in borsa)

### 7.7 Valutazione Oggetti (Appraisal)
Oggetti con `appraised: false` mostrano `?` in UI al posto delle stat.  
Il player usa `POST /api/appraise-item`.  
Check: `Math.random()*100 < Math.max(20, Math.min(90, TEC*5))`  
Il GM può rivelare oggetti narrativamente via `state_updates.appraise_item`.

### 7.8 Effetti di Stato
Il GM invia l'**array completo** degli stati attivi (sostituisce il precedente):
```json
"status_effects": [
  { "id": "uid", "name": "Avvelenato", "icon": "🟢", "type": "debuff",
    "turns_remaining": 3, "value": 5, "color": "#22c55e" }
]
```
UI: pill colorati sopra il pannello laterale (nascosti quando array vuoto).

### 7.9 Reputazione Fazioni
5 fazioni: `hunters_guild, merchants, city_guard, scholars, underground`  
Range: -100…+100 | Label: Nemico / Diffidente / Neutrale / Amico / Alleato  
Il GM invia **delta** via `reputation_delta: { "hunters_guild": 10 }`.  
Effetto gameplay: sconto negozio con `merchants` reputazione alta.  
UI: barre di progressione nel pannello laterale.

### 7.10 NPC Persistenti
Stored in `data/npcs.json`.  
Il GM crea/aggiorna via `npc_add` / `npc_update` nel JSON di risposta.  
Ogni NPC: `{ id, name, faction, relationship (-100..100), notes, last_seen, location }`  
UI: modal 👤 con card NPC, barra relazione, badge "qui ora" se NPC è nella zona corrente.  
Il system prompt include gli NPC presenti nella zona corrente.

### 7.11 Sistema Titoli (15 titoli)
Sbloccati automaticamente da `checkTitles()` dopo ogni risposta chat.  
Condizioni: nemici sconfitti, schivate, critici, zone visitate, livello, ecc.  
Ricompense: stat bonus, skill slots extra, skill speciali.  
Esempio: `unique_slayer` (1 unique completato) → +3 STR/AGI/LUC + skill `vorpal_soul`.

### 7.12 Negozio
- `GET /api/shop` — lista oggetti
- `POST /api/shop/generate` — GM genera assortimento dinamico
- `POST /api/shop/buy` — acquisto con controllo fondi e sconto reputazione
- `POST /api/shop/sell` — vendita (50% del prezzo base)

### 7.13 Bestiario
`data/bestiary.json` — nemici incontrati persistono con tier, level, weaknesses.  
Modal 📖 in UI con lista filtrata.

### 7.14 Mappa del Mondo
`GET /api/world-map` + `PUT /api/world-map`  
Zones con `name, description, zone_type, connections[]`.  
Modal mappa in UI con zone cliccabili.

### 7.15 Slot di Salvataggio (3 slot)
Copia snapshot di tutti i file JSON nella cartella `data/slots/slot{1-3}/`.  
File inclusi: `player_profile, inventory, game_state, skills_library, bestiary, npcs`.  
Endpoint: `GET /slots`, `POST /slots/:id/save`, `POST /slots/:id/load`, `DELETE /slots/:id`.

### 7.16 Modalità GM
`POST /api/gm-mode` + `POST /api/gm-respond` — interfaccia diretta con il GM senza passare per la chat player. Usato per comandi speciali o debug narrativo.

### 7.17 Export Sessione
`GET /api/export` — scarica il log della sessione come file JSON.

---

## 8. Contenuto One-Shot (Unique)

### 8.1 Events Unici (8)

| ID | Trigger | Boss | Ricompensa Principale |
|----|---------|------|----------------------|
| `gladiatore_antico` | Crysta, REP gilda ≥20, LUC ≥13 | Gladiatore Antico (A, Lv15) | Skill: Colpo Leggendario |
| `rovine_primordiali` | Prima visita Aokara, LUC ≥15 | Entità Primordiale (SS, Lv25) | Skill: Sangue degli Antichi |
| `mercante_fantasma` | Taverna, LUC ≥16 | — | Accesso shop leggendario |
| `cripta_del_re` | Crysta, TEC ≥14, nemici ≥10 | Re Perduto (SS, Lv20) | Oggetto: Corona del Re Perduto |
| `specchio_del_doppio` | Lv ≥10, dungeon | Il Doppio (S, Lv+5) | +3 punti stat + Frammento Specchio |
| `il_collezionista` | Bestiary ≥5 analizzati | — | Denaro + REP studiosi |
| `trono_dei_cacciatori` | REP gilda ≥50 | Campione Gilda (S, Lv20) | Oggetto: Insegna del Campione |
| `voce_del_caos` | Near-death ≥3, REP underground >0 | Entità del Caos (SSS, Lv30) | Skill: Risurrezione del Fallen |

### 8.2 Oggetti Leggendari (10)

| ID | Slot | Stat Bonus | Source |
|----|------|-----------|--------|
| `corona_del_re_perduto` | head | STR+3, VIT+5, LUC+3 | cripta_del_re |
| `insegna_del_campione` | accessory_1 | STR+4, AGI+4, DEX+2 | trono_dei_cacciatori |
| `frammento_specchio` | accessory_2 | TEC+6, LUC+4 | specchio_del_doppio |
| `mantello_ombra_assoluta` | chest | AGI+6, DEX+4, VIT-2 | mercante_fantasma |
| `amuleto_rinascita` | accessory_2 | VIT+5, HP+50 | mercante_fantasma |
| `cristallo_arcano_potenziato` | accessory_1 | TEC+8, MP+30 | guardiano_torre |
| `stivali_vento_eterno` | boots | AGI+8, DEX+3 | drop raro |
| `guanti_del_colosseo` | hands | STR+7, VIT+3 | gladiatore_antico |
| `tomo_del_fondatore` | offhand | TEC+5, LUC+5, MP+20 | boss finale |
| `lama_ancestrale` | weapon | STR+6, DEX+6, TEC+4 | drop SSS |

### 8.3 Boss Unici (8)

| Nome | Tier | Lv | HP | Meccanica Speciale |
|------|------|----|----|--------------------|
| Gladiatore Antico | A | 15 | 600 | Contrattacca ogni parata ×2 |
| Re Perduto | SS | 20 | 1200 | A 50% HP → modalità fantasma (fisico -50%) |
| Entità Primordiale | SS | 25 | 2000 | Debuff casuale ogni turno; a 30% copia skill player |
| Il Doppio | S | player+5 | player×1.2 | Usa stesse skill del player; immune al tipo più usato |
| Campione della Gilda | S | 20 | 900 | Cambia pattern ogni 3 turni (3 fasi) |
| Entità del Caos | SSS | 30 | 5000 | Resistenze mutanti; regen 5% se non attaccata |
| Guardiano Torre Cristallo | SS | 18 | 1500 | Immune fisico; 5 crepe → resistenza -50% |
| Ombra del Fondatore | SSS | 50 | 10000 | 5 fasi; fase finale replica primo combattimento |

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
| GET | `/api/unique-events` | Catalogo eventi unici |
| GET | `/api/unique-items` | Catalogo oggetti leggendari |
| GET | `/api/unique-monsters` | Catalogo boss unici |
| POST | `/api/enhance` | Potenzia oggetto (+1 livello) |
| POST | `/api/appraise-item` | Valuta oggetto non identificato |
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
│  Top bar: [↺ Reset] [💾 Slot] [📤 Export] [📖 Bestiary] [👤 NPC] [🗺 Map]│
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
│ 👤 PERSONAGGIO   │                                   │ 📚 ALBERO SKILL   │
│  nome, classe,   │                                   │  branch filtrati  │
│  livello, EXP    │                                   │  per classe       │
│  stat (clicc.)   │                                   │                   │
│  punti stat      │                                   │                   │
└──────────────────┴──────────────────────────────────┴───────────────────┘
```

**Modali attivi:**
- Distribuzione punti stat
- Selezione specializzazione T2
- Selezione classe avanzata T3
- Bestiario
- NPC persistenti
- Mappa del mondo
- Slot di salvataggio
- Negozio

---

## 11. Stato Attuale del Personaggio

```
Nome:     Giacomino
Classe:   Scout  (Lv 1, 0/100 EXP)
Subclass: nessuna
Soldi:    100 R

STR: 10  DEX: 18  AGI: 15
TEC: 10  VIT: 10  LUC: 15

HP: 100/100  MP: 50/50  STM: 100/100
Punti stat disponibili: 0

Equipaggiamento: tutti gli slot vuoti
Borsa: vuota
Skill loadout: vuoto
Titoli: nessuno
Reputazione: tutte Neutra
Zone visitate: Crysta
```

---

## 12. Pattern di Codice Chiave

### 12.1 `buildSystemPrompt` — contesto per il GM
La funzione più importante del backend. Costruisce il system prompt con:
- Stato completo del personaggio (HP, stat, titoli, stati, reputazione)
- Equipaggiamento e borsa (con flag `[NON VALUTATO]` per oggetti non identificati)
- Skill loadout e skill sbloccabili (per suggerimenti organici)
- NPC presenti nella zona corrente
- Stato combattimento se attivo
- Tutte le regole del gioco, formule, e istruzioni formato JSON
- Sezioni dedicate a: effetti stato, reputazione, NPC, potenziamento, valutazione, eventi unici, oggetti leggendari, mostri, skill speciali

### 12.2 `deepMerge` — aggiornamento stato
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

### 12.3 `checkSkillUnlocks` — auto-sblocco skill
```javascript
function checkSkillUnlocks(profile, skills) {
  // Controlla: req.stats, req.skill, req.title, req.subclass,
  //            req.advanced_class, req.job, req.counter
  // Se tutti i requisiti sono soddisfatti → sk.learned = true
}
```

### 12.4 Template literal nesting — trappola nota
I template literal annidati con backtick dentro `${}` chiudono prematuramente il template esterno. Soluzione: precompilare le stringhe con concatenazione prima del template literal.

---

## 13. Limitazioni e Gap Noti

| Area | Problema |
|------|----------|
| **Coerenza GM** | Il GM a volte dimentica di aggiornare i contatori (`counters`) nelle risposte di combattimento |
| **Salvataggio automatico** | Nessun auto-save — se il server crasha, si perde l'ultima sessione |
| **Validazione lato client** | La UI non valida l'affordability degli oggetti prima dell'acquisto (lo fa il server) |
| **Mobile** | Il layout a 3 colonne non è responsive |
| **Dungeon** | Non esiste un sistema dungeon strutturato — tutto è narrativo |
| **Multi-player** | Architettura single-player (file JSON non concurrency-safe) |
| **Slot `hands`** | Il slot `hands` esiste in `unique_items.json` ma non è definito in `inventory.json` |
| **Action counters dal GM** | Il GM deve esplicitamente includere `counters` in ogni risposta di combattimento — se lo dimentica, i titoli e le skill speciali non avanzano |
| **Unique events trigger** | Il trigger degli eventi unici è puramente narrativo (il GM decide) — non c'è controllo automatico lato server |

---

## 14. Possibili Sviluppi Futuri

- **Sistema dungeon strutturato** — mappe a stanze con logica procedurale
- **Combattimento multi-turno visivo** — UI dedicata con HP bar nemico in tempo reale
- **Sistema crafting** — ricette per combinare materiali in oggetti
- **Quest tracker** — UI dedicata con obiettivi tracciati e reward step-by-step
- **Trigger automatici eventi unici** — il server controlla le condizioni e notifica il GM
- **Calendario/tempo** — giorno/notte, stagioni, effetti gameplay
- **Difficoltà adattiva** — il GM scala i nemici al livello corrente
- **Modalità multiplayer** — sessioni separate per profili diversi
- **Backup automatico** — snapshot a ogni level up o evento unico

---

## 15. Come Avviare

```bash
cd "Progetti privati/Shanfro"
cp .env.example .env  # inserire GROQ_API_KEY
npm install
node server.js
# → http://localhost:3000
```

Variabili d'ambiente richieste:
```
GROQ_API_KEY=gsk_...
PORT=3000 (opzionale)
```
