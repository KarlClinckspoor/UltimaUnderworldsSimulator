// Builds src/data/game.json, the compact game data the site ships, from the full extracts in
// uw2-data/json (made by uw2-data/tools/extract_uw2.py from the pristine UW2 DATA and CRIT files).
// Run: node tools/compact-data.mjs   (npm run data)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const j = (f) => JSON.parse(readFileSync(join(root, 'uw2-data', 'json', f), 'utf8'));
const objects = j('objects.json');
const comobj = j('comobj.json');
const spells = j('spells.json');
const levels = j('level-monsters.json');
const anim = j('animation.json');

const items = comobj.items.map((i) => [i.name, i.height, i.radius, i.resist, i.qualclass]);

const weapons = objects.melee_weapons.map((w) => ({
  id: w.item_id, name: w.name, slash: w.damage_slash, bash: w.damage_bash, stab: w.damage_stab,
  minCharge: w.min_charge, speed: w.speed, maxCharge: w.max_charge, skill: w.skill, durability: w.durability,
}));
const missiles = objects.missiles.map((m) => ({
  id: m.item_id, name: m.name, damage: m.damage, type: m.type, ammo: m.ammo, damageType: m.damage_type,
}));
const armour = objects.armour.map((a) => ({
  id: a.item_id, name: a.name, protection: a.protection, durability: a.durability, category: a.category,
  categoryName: a.category_name,
}));
const creatures = objects.creatures.map((c) => {
  const raw = Buffer.from(c.raw_hex, 'hex');
  return {
    id: c.item_id, name: c.name, armour: c.armour, avghit: c.avghit, str: c.str, dex: c.dex, int: c.int,
    passive: c.passive, flier: c.flier, speed: c.speed, equip: c.equip, defence: c.defence,
    attacks: c.attacks, nerve: c.nerve, arms: c.arms.map((a) => ({ present: a.present, item: a.item })),
    firesMissile: c.fires_missile_index, offensive: c.offensive_spells_flag, exp: c.exp,
    spells: c.spells, caster: c.caster, locks: c.locks, noise: c.noise,
    race: c.race,      // sp_ward_undead: race 0x17 (liches) lose half their HP instead of 255
    poison: raw[0x0f], // b0F: the poison level critter_attack passes; not simulated
    blood: c.blood,
    ignoresFights: (raw[0x0a] >> 1) & 1, // bA_1: critter_mv skips its reaction to being hit
    // CR.AN sequence lengths (AI.C set_cur_seq_len): seq 2 combat stance, 3..5 attacks, 6 cast / fire
    seqLen: anim.creature_sequences[c.index].seq_len,
  };
});
const sp = spells.spells.map((s) => ({
  index: s.index, name: s.name, circle: s.circle, cls: s.class, className: s.class_name, minor: s.minor, flags: s.flags,
  runes: s.runes, words: s.rune_words, missile: s.missile_index ?? null, heal: s.heal_dice ?? null,
}));

// Enemies: one row per level x creature type x stored HP x powerful x attitude (identical
// monsters merge). Each row keeps the object indexes so single monsters stay traceable.
const lv = levels.levels.map((L) => {
  const rows = new Map();
  for (const m of L.monsters) {
    const key = `${m.creature_index}|${m.hp}|${m.powerful}|${m.attitude}`;
    let r = rows.get(key);
    if (!r) {
      r = { c: m.creature_index, hp: m.hp, pw: m.powerful, att: m.attitude, n: 0, placed: 0, trap: 0,
        spawnP: [], objs: [], authored: m.hp_authored ? 1 : 0 };
      rows.set(key, r);
    }
    r.n++;
    if (m.placed_on_map) r.placed++;
    else if (m.spawn && m.spawn.kind === 'create_object_trap') { r.trap++; r.spawnP.push(m.spawn.spawn_probability); }
    r.objs.push(m.object_index);
  }
  const list = [...rows.values()].sort((a, b) => a.c - b.c || a.hp - b.hp || a.pw - b.pw || a.att - b.att);
  for (const r of list) if (!r.spawnP.length) delete r.spawnP;
  return { level: L.level, world: L.world, worldName: L.world_name, levelInWorld: L.level_in_world, rows: list };
});
// The player's swing frames (WEAP.DAT via PANELS.C do_weapload), by lefty and weapon kind
const weaponFrames = anim.weapon_frames.map((w) => ({ lefty: w.lefty, kind: w.weapid, frmtot: w.frmtot, wframe: w.wframe }));

const out = {
  source: 'uw2-data/json (OBJECTS.DAT, COMOBJ.DAT, LEV.ARK, WEAP.DAT, AS.AN, CR.AN, SPELLS.C) via tools/compact-data.mjs',
  itemFields: ['name', 'height', 'radius', 'resist', 'qualclass'],
  items, weapons, missiles, armour, creatures, spells: sp, levels: lv, weaponFrames,
};
mkdirSync(join(root, 'src', 'data'), { recursive: true });
writeFileSync(join(root, 'src', 'data', 'game.json'), JSON.stringify(out));
const n = lv.reduce((s, L) => s + L.rows.reduce((t, r) => t + r.n, 0), 0);
console.log(`wrote src/data/game.json: ${lv.length} levels, ${lv.reduce((s, L) => s + L.rows.length, 0)} rows, ${n} monsters`);
