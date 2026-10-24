#!/usr/bin/env python3
"""Extract UW1 data tables to JSON.

Usage:
  python3 -I extract_uw1.py --objects OBJECTS.DAT --levark LEV.ARK --items items.h --out DIR

Reads:
  OBJECTS.DAT  (docs/FORMATS.md "OBJECTS.DAT"; uw1/src/include/object.h, critter.h)
  LEV.ARK      (docs/FORMATS.md "LEV.ARK"; uw1/src/include/level.h, object.h)
  items.h      (uw1/src/include/items.h, only for item names)

Writes DIR/objects.json and DIR/level-monsters.json. No game data is bundled with
the tool; the two outputs are derived from the shipped, pristine DATA files.
"""
import argparse, json, re, struct, sys, os

# ---------------------------------------------------------------- items.h names
def load_item_names(path):
    names = {}
    for m in re.finditer(r"#define\s+ITEM_(\w+)\s+0x([0-9A-Fa-f]+)", open(path).read()):
        names[int(m.group(2), 16)] = m.group(1)
    return names

def pretty(name):
    # ITEM_GOBLIN_46 -> "Goblin (0x46)" keeps the repo's disambiguating suffix visible
    m = re.match(r"^(.*)_([0-9A-F]{2})$", name)
    words = (m.group(1) if m else name).replace("_", " ").title()
    return f"{words} (0x{m.group(2)})" if m else words

# ---------------------------------------------------------------- OBJECTS.DAT
SKILL_NAMES = ["Attack", "Defense", "Barehand", "Sword", "Axe", "Mace", "Missile", "Mana", "Lore",
               "Casting", "Traps", "Search", "Track", "Stealth", "Repair", "Charisma", "Pick Lock",
               "Acrobat", "Appraise", "Swimming"]

def s8(b):
    return b - 256 if b > 127 else b

def parse_objects(data, item_names):
    if len(data) != 0xDE2:
        raise SystemExit(f"OBJECTS.DAT: expected 0xDE2 bytes, got {len(data):#x}")

    def nm(i):
        return pretty(item_names[i]) if i in item_names else f"item 0x{i:02X}"

    out = {"source": "OBJECTS.DAT", "size": len(data), "header_word": struct.unpack_from("<H", data, 0)[0]}

    # melee weapons, 16 x 8 at 0x002; item id = index (0x00..0x0F)
    w = []
    for i in range(16):
        r = data[0x002 + 8 * i: 0x002 + 8 * i + 8]
        w.append({"index": i, "item_id": i, "name": nm(i),
                  "damage_slash": r[0], "damage_bash": r[1], "damage_stab": r[2],
                  "min_charge": r[3], "speed": r[4], "max_charge": r[5],
                  "skill": r[6], "skill_name": SKILL_NAMES[r[6]] if r[6] < 20 else None,
                  "durability": r[7]})
    out["melee_weapons"] = w

    # missiles and launchers, 16 x 3 at 0x082; item id = 0x10 + index
    m = []
    for i in range(16):
        r = data[0x082 + 3 * i: 0x082 + 3 * i + 3]
        m.append({"index": i, "item_id": 0x10 + i, "name": nm(0x10 + i),
                  "damage": r[0], "type": r[1], "ammo": s8(r[2]),
                  # missile_thwack passes -ammo as the damage type bits (OBJPHYS.C missile_newhit)
                  "damage_type": (-s8(r[2])) & 0xFF if s8(r[2]) < 0 else None})
    out["missiles"] = m

    # armour and wearables, 32 x 4 at 0x0B2; item id = 0x20 + index
    cats = {0: "shield", 1: "body armour", 3: "leggings", 4: "gloves", 5: "boots", 8: "hat", 9: "ring"}
    a = []
    for i in range(32):
        r = data[0x0B2 + 4 * i: 0x0B2 + 4 * i + 4]
        a.append({"index": i, "item_id": 0x20 + i, "name": nm(0x20 + i),
                  "protection": r[0], "durability": r[1], "byte2": r[2],
                  "category": r[3], "category_name": cats.get(r[3])})
    out["armour"] = a

    # creatures, 64 x 0x30 at 0x132; item id = 0x40 + index
    c = []
    for i in range(64):
        r = data[0x132 + 0x30 * i: 0x132 + 0x30 * i + 0x30]
        attacks = []
        for k in range(3):
            chance, dmg, prob = s8(r[0x13 + 3 * k]), r[0x14 + 3 * k], r[0x15 + 3 * k]
            attacks.append({"chance": chance, "damage": dmg, "prob": prob})
        word0d = r[0x0D] | (r[0x0E] << 8)
        rec = {
            "index": i, "item_id": 0x40 + i, "name": nm(0x40 + i),
            "armour": list(r[0x00:0x04]),
            "avghit": r[0x04],
            "str": r[0x05], "dex": r[0x06], "int": r[0x07],
            "death": r[0x08] & 7, "blood": (r[0x08] >> 3) & 3, "corpse": (r[0x08] >> 5) & 7,
            "race": r[0x09],
            "passive": r[0x0A] & 1, "remains": (r[0x0A] >> 2) & 7,
            "swims": (r[0x0A] >> 6) & 1, "flier": (r[0x0A] >> 7) & 1,
            "speed": r[0x0B], "run": r[0x0C],
            "level": word0d & 0xF, "shrewd": (word0d >> 4) & 0xF,
            "haggle": (word0d >> 8) & 0xF, "patience": (word0d >> 12) & 0xF,
            "sound": r[0x10] & 0xF, "armour_kind": (r[0x10] >> 4) & 3, "weapon_kind": (r[0x10] >> 6) & 3,
            "equip": s8(r[0x11]),
            "defence": s8(r[0x12]),
            "attacks": attacks,
            "range": (r[0x1C] >> 4) & 0xF,
            "nerve": r[0x1C] & 0xF,   # critter.h b1C_0: should_i_flee's nerve, acceptable_danger
            "noise": r[0x1D] & 0xF, "visibility": (r[0x1D] >> 4) & 0xF,
            "hearing": r[0x1E] & 0xF, "sight": (r[0x1E] >> 4) & 0xF,
            "lazy": r[0x1F] & 0xF, "alert": (r[0x1F] >> 4) & 0xF,
            # arms[0].item is a 7-bit item id: 0x10..0x1F is a missile it fires (Missile[id & 15]),
            # 0x00..0x0F a melee weapon it is shown holding (AI.C crit_offense tests item >> 4 == CLASS_MISSILE)
            "arms": [{"present": r[0x20 + k] & 1, "item": r[0x20 + k] >> 1,
                      "name": nm(r[0x20 + k] >> 1) if (r[0x20 + k] & 1) else None,
                      "fires_missile": bool((r[0x20 + k] & 1) and (r[0x20 + k] >> 1) >> 4 == 1)} for k in range(2)],
            "fires_missile_index": ((r[0x20] >> 1) & 15) if ((r[0x20] & 1) and ((r[0x20] >> 1) >> 4) == 1) else None,
            # effective armour for hit zones 0..3: 255 means "use zone 0" (COMBAT.C:364)
            "armour_by_zone": [r[k] if r[k] != 0xFF else r[0] for k in range(4)],
            "offensive_spells_flag": r[0x2D] & 1,   # critter.h b2D_0: crit_offense only tries spell attacks when set
            "exp": struct.unpack_from("<h", r, 0x28)[0],
            "spells": list(r[0x2A:0x2D]),
            "caster": r[0x2D] >> 1,
            "locks": r[0x2E],
            "raw_hex": r.hex(),
        }
        c.append(rec)
    out["creatures"] = c

    # containers 16 x 3 at 0xD32
    cont = []
    for i in range(16):
        r = data[0xD32 + 3 * i: 0xD32 + 3 * i + 3]
        cont.append({"index": i, "capacity": r[0], "mask": struct.unpack_from("<h", r, 1)[0]})
    out["containers"] = cont
    # lights 16 x 2 at 0xD62
    out["lights"] = [{"index": i, "burn_rate": data[0xD62 + 2 * i], "brightness": data[0xD62 + 2 * i + 1]}
                     for i in range(16)]
    # food 16 x 1 at 0xD82
    out["food"] = [{"index": i, "nutrition": s8(data[0xD82 + i])} for i in range(16)]
    # trigger modes 16 x 1 at 0xD92
    out["trigger_modes"] = [data[0xD92 + i] for i in range(16)]
    # animation classes 16 x 4 at 0xDA2
    out["animation_classes"] = [{"index": i, "flags": struct.unpack_from("<H", data, 0xDA2 + 4 * i)[0],
                                 "start_frame": data[0xDA2 + 4 * i + 2], "frames": data[0xDA2 + 4 * i + 3]}
                                for i in range(16)]
    return out

# ---------------------------------------------------------------- LEV.ARK
LEVEL_SIZE = 0x7C08
MAGIC = 0x7577   # bytes 'w','u' little endian; FORMATS.md calls it "uw" (0x7577)

def arc_blocks(data):
    n = struct.unpack_from("<H", data, 0)[0]
    offs = list(struct.unpack_from(f"<{n}I", data, 2))
    present = sorted(o for o in offs if o)
    def block(i):
        o = offs[i]
        if not o:
            return None
        nxt = [p for p in present if p > o]
        end = nxt[0] if nxt else len(data)
        return data[o:end]
    return n, offs, block

def obj_fields(b):
    """First 8 bytes (all a static object has)."""
    idw, pos, qn, ol = struct.unpack_from("<HHHH", b, 0)
    return {"id": idw, "item": idw & 0x1FF, "major": (idw >> 6) & 7, "flags": (idw >> 9) & 0xF,
            "enchanted": (idw >> 12) & 1, "invisible": (idw >> 14) & 1, "is_quant": (idw >> 15) & 1,
            "z": pos & 0x7F, "heading": (pos >> 7) & 7, "fine_y": (pos >> 10) & 7, "fine_x": (pos >> 13) & 7,
            "quality": qn & 0x3F, "next": qn >> 6, "owner": ol & 0x3F, "link": ol >> 6}

GOALS = {}  # goal numbers are not named in the sources read; reported as numbers

def parse_levels(data, objects, item_names):
    n, offs, block = arc_blocks(data)
    creatures = objects["creatures"]

    def nm(i):
        return pretty(item_names[i]) if i in item_names else f"item 0x{i:02X}"

    levels = []
    problems = []
    for level in range(1, 10):
        blk = block(level - 1)
        if blk is None:
            continue
        if len(blk) != LEVEL_SIZE:
            problems.append(f"level {level}: block length {len(blk):#x}, expected {LEVEL_SIZE:#x}")
            continue
        magic = struct.unpack_from("<H", blk, 0x7C06)[0]
        if magic != MAGIC:
            problems.append(f"level {level}: bad magic {magic:#06x}")
            continue
        nactive, nmobfree, nstaticfree = struct.unpack_from("<HHH", blk, 0x7C00)
        # free lists: entries 0..top are free; stored word is top (entries - 1), -1 when empty
        def s16(v):
            return v - 65536 if v > 32767 else v
        mtop = s16(nmobfree)
        mob_free_entries = struct.unpack_from("<254H", blk, 0x7300)
        free_mob = set(mob_free_entries[: mtop + 1]) if mtop >= 0 else set()

        # tile object chains: which objects are reachable from the map
        tiles = struct.unpack_from("<8192H", blk, 0)
        reach = {}   # object index -> (x, y)
        def mobile_rec(idx):
            return blk[0x4000 + 0x1B * idx: 0x4000 + 0x1B * idx + 0x1B]
        def static_rec(idx):
            return blk[0x5B00 + 8 * (idx - 256): 0x5B00 + 8 * (idx - 256) + 8]
        def rec(idx):
            return mobile_rec(idx) if idx < 256 else static_rec(idx)
        for y in range(64):
            for x in range(64):
                first = tiles[2 * (x + 64 * y) + 1] >> 6
                seen = 0
                idx = first
                while idx and seen < 2000:
                    reach.setdefault(idx, (x, y))
                    idx = obj_fields(rec(idx))["next"]
                    seen += 1

        # static free list: entries are full object indexes (256..1023); entries 0..top are free
        stop = s16(nstaticfree)
        static_free_entries = struct.unpack_from("<768H", blk, 0x74FC)
        free_static = set(static_free_entries[: stop + 1]) if stop >= 0 else set()

        # who points at each object (link of a non-quantity object, or next), among objects in use
        referrers = {}
        for idx in list(range(2, 256)) + list(range(256, 1024)):
            if idx in free_mob or idx in free_static:
                continue
            g = obj_fields(rec(idx))
            if g["item"] == 0 and g["next"] == 0 and g["link"] == 0:
                continue
            if not g["is_quant"] and g["link"]:
                referrers.setdefault(g["link"], []).append((idx, g, "link"))
            if g["next"]:
                referrers.setdefault(g["next"], []).append((idx, g, "next"))

        monsters = []
        stale = []
        for idx in range(2, 256):
            r = mobile_rec(idx)
            f = obj_fields(r)
            if not (0x40 <= f["item"] <= 0x7E):
                continue
            if idx in free_mob:
                stale.append(idx)
                continue
            hp = r[0x08]
            goal_word = struct.unpack_from("<H", r, 0x0B)[0]
            att_word = struct.unpack_from("<H", r, 0x0D)[0]
            home = struct.unpack_from("<H", r, 0x16)[0]
            cr = creatures[f["item"] - 0x40]
            pos = reach.get(idx)
            # inventory chain: link points at first carried object when is_quant is 0
            inv = []
            if not f["is_quant"] and f["link"]:
                j, seen = f["link"], 0
                while j and seen < 64:
                    g = obj_fields(rec(j))
                    inv.append({"index": j, "item_id": g["item"], "name": nm(g["item"])})
                    j = g["next"]
                    seen += 1
            # monsters not on the map are held by a create-object trap (item 0x187), which makes a
            # copy when it fires (TRIGGER.C:297). It does nothing with probability quality/63.
            spawn = None
            if pos is None:
                for (ri, rg, via) in referrers.get(idx, []):
                    if rg["item"] == 0x187 and via == "link":
                        rpos = reach.get(ri)
                        q = rg["quality"]
                        spawn = {"kind": "create_object_trap", "trap_object_index": ri,
                                 "trap_tile": {"x": rpos[0], "y": rpos[1]} if rpos else None,
                                 "trap_quality": q,
                                 "spawn_probability": round(max(0, 63 - q) / 63, 4)}
                        break
                if spawn is None:
                    spawn = {"kind": "unknown",
                             "referenced_by": [{"object_index": ri, "item_id": rg["item"], "via": via}
                                               for (ri, rg, via) in referrers.get(idx, [])]}
            powerful = (att_word >> 10) & 1
            atts = []
            for k, a in enumerate(cr["attacks"]):
                atts.append({
                    "slot": k, "prob": a["prob"],
                    "to_hit_base": a["chance"] + (cr["equip"] >> 1),
                    "damage_base": a["damage"] + cr["str"] // 5,
                    # critter_attack (COMBAT.C:801): powerful adds rand()%6+7 to hit and rand()%12+4 damage
                    "to_hit_powerful_extra": [7, 12] if powerful else None,
                    "damage_powerful_extra": [4, 15] if powerful else None,
                })
            monsters.append({
                "object_index": idx,
                "item_id": f["item"], "creature_index": f["item"] - 0x40,
                "name": cr["name"],
                "tile": {"x": pos[0], "y": pos[1]} if pos else None,
                "placed_on_map": pos is not None,
                "spawn": spawn,
                "home": {"x": (home >> 10) & 0x3F, "y": (home >> 4) & 0x3F},
                "z": f["z"], "heading": f["heading"],
                "hp": hp, "creature_avghit": cr["avghit"],
                # a freshly generated critter gets avghit * (16 + rand % 24) / 32 (CREATURE.C:86), i.e. this range;
                # values outside it were set by the level designer
                "hp_generated_range": [cr["avghit"] * 16 // 32, cr["avghit"] * 39 // 32],
                "hp_authored": not (cr["avghit"] * 16 // 32 <= hp <= cr["avghit"] * 39 // 32),
                "powerful": powerful,
                "goal": goal_word & 0xF, "goal_target": (goal_word >> 4) & 0xFF,
                "old_goal": att_word & 0xF, "attitude": (att_word >> 14) & 3,
                "no_heal": (att_word >> 9) & 1, "summoned": (att_word >> 8) & 1,
                "has_inventory_flag": (att_word >> 12) & 1, "talked_to": (att_word >> 13) & 1,
                "loner": (r[0x0A] >> 7) & 1,
                "whoami": r[0x1A],
                "speed_obj": r[0x13] & 0x7F,
                "damage_taken": r[0x11],
                "combat": {
                    "defence": cr["defence"], "armour": cr["armour"], "avghit": cr["avghit"],
                    "str": cr["str"], "dex": cr["dex"], "int": cr["int"],
                    "equip": cr["equip"], "passive": cr["passive"], "exp": cr["exp"],
                    "range": cr["range"], "speed": cr["speed"], "run": cr["run"],
                    "attacks": atts,
                },
                "inventory": inv,
            })
        by_type = {}
        for m in monsters:
            t = by_type.setdefault(m["creature_index"], {"creature_index": m["creature_index"],
                                                          "item_id": m["item_id"], "name": m["name"],
                                                          "count": 0, "powerful": 0, "hp_values": {}})
            t["count"] += 1
            t["powerful"] += m["powerful"]
            t["hp_values"][str(m["hp"])] = t["hp_values"].get(str(m["hp"]), 0) + 1
        levels.append({
            "level": level,
            "block_index": level - 1,
            "monster_count": len(monsters),
            "placed_count": sum(1 for m in monsters if m["placed_on_map"]),
            "trap_spawned_count": sum(1 for m in monsters if m["spawn"] and m["spawn"]["kind"] == "create_object_trap"),
            "other_offmap_count": sum(1 for m in monsters if m["spawn"] and m["spawn"]["kind"] == "unknown"),
            "free_slots_with_stale_creature_bytes": stale,
            "active_mobs_in_file": nactive,
            "by_type": sorted(by_type.values(), key=lambda t: t["creature_index"]),
            "monsters": monsters,
        })
    return {"source": "LEV.ARK", "blocks_in_archive": n, "problems": problems, "levels": levels}

def parse_spells(spells_c, objects):
    src = open(spells_c).read()
    blk = src[src.index("struct Spell far spells[NUM_SPELLS] = {"):]
    blk = blk[:blk.index("};")]
    ents = re.findall(r"\{\s*0x([0-9A-Fa-f]+),\s*0x([0-9A-Fa-f]+),\s*0x([0-9A-Fa-f]+)\s*\}", blk)
    cls_names = {0: "light", 1: "motion", 2: "armour", 3: "protect", 4: "heal", 5: "missile", 6: "area",
                 7: "single-target area", 8: "create", 9: "backfire", 10: "mana", 11: "special effect (xt)",
                 13: "special", 14: "cutscene"}
    missile_items = [7, 5, 4, 6]       # release_missile: sub 1..4 -> Missile[] index
    out = []
    for i, (c, rn, sub) in enumerate(ents):
        c, rn, sub = int(c, 16), int(rn, 16), int(sub, 16)
        cls = (c & 0xF8) >> 3
        e = {"index": i, "circle": i // 6 + 1 if i < 48 else None, "player_spell": i < 48,
             "class": cls, "class_name": cls_names.get(cls), "minor": sub & 0x3F, "flags": sub & 0xC0,
             "runes_packed": rn, "raw": [c, rn, sub]}
        if cls == 5 and 1 <= (sub & 0x3F) <= 4:
            mi = missile_items[(sub & 0x3F) - 1]
            e["missile_index"] = mi
            e["missile_damage"] = objects["missiles"][mi]["damage"]
            e["missile_type"] = objects["missiles"][mi]["type"]
        rl = unpack_runes(rn)
        e["runes"] = rl
        e["rune_words"] = " ".join(RUNE_NAMES[x] for x in rl)
        if cls == 4:
            e["heal_dice"] = "all" if (sub & 0x3F) == 15 else f"{sub & 0x3F}d8"
        out.append(e)
    return {"source": "uw1/src/combat/SPELLS.C spells[] (code data, same for every player)",
            "notes": ["Spell names are in STRINGS.PAK block 6 and are not parsed; indices 0..47 are the player's, "
                      "six per circle; 48..52 appear only in creature records.",
                      "Creatures pay no mana and have no cooldown: see level-monsters.json notes."],
            "spells": out}

RUNE_NAMES = ["An", "Bet", "Corp", "Des", "Ex", "Flam", "Grav", "Hur", "In", "Jux", "Kal", "Lor", "Mani",
              "Nox", "Ort", "Por", "Quas", "Rel", "Sanct", "Tym", "Uus", "Vas", "Wis", "Ylem"]

def unpack_runes(packed):
    """try_cast (RUNES.C): runes = shelf[0] << 10 | shelf[1] << 5 | shelf[2]; 0x18 is an empty place."""
    rs = [(packed >> 10) & 31, (packed >> 5) & 31, packed & 31]
    return [r for r in rs if r < 24]

def parse_comobj(data, item_names):
    if len(data) != 2 + 512 * 11:
        raise SystemExit(f"COMOBJ.DAT: expected {2 + 512 * 11} bytes, got {len(data)}")
    def nm(i):
        return pretty(item_names[i]) if i in item_names else f"item 0x{i:03X}"
    res_bits = {0x03: "magic (chance: rand%3 < resist&3)", 0x04: "physical", 0x08: "fire", 0x10: "poison",
                0x20: "cold", 0x40: "missiles", 0x80: "undead flag"}
    out = []
    for i in range(512):
        r = data[2 + 11 * i: 2 + 11 * i + 11]
        w1 = r[1] | (r[2] << 8)
        w6 = r[6] | (r[7] << 8)
        w9 = r[9]
        res = r[8]
        out.append({
            "item_id": i, "name": nm(i),
            "height": r[0], "radius": w1 & 7, "animated": (w1 >> 3) & 1, "mass": w1 >> 4,
            "solid": (r[3] >> 1) & 1, "no_hit": (r[3] >> 3) & 1, "pickup": (r[3] >> 5) & 1, "stack": (r[3] >> 6) & 3,
            "value": r[4] | (r[5] << 8),
            "touch": w6 & 1, "usable": (w6 >> 1) & 1, "qualclass": (w6 >> 2) & 3, "light": (w6 >> 4) & 1,
            "bounce": (w6 >> 5) & 15, "fate": (w6 >> 9) & 15, "pickable": (w6 >> 13) & 1, "can_own": (w6 >> 15) & 1,
            "resist": res,
            "resist_names": [n for b, n in res_bits.items() if (res & b) and b != 0x03] + (
                [f"magic {res & 3}/3"] if res & 3 else []),
            "render": w9 & 3, "tenacity": (w9 >> 2) & 15,
            "qualtype": r[10] & 15, "lookable": (r[10] >> 4) & 1,
            "raw_hex": r.hex(),
        })
    return {"source": "COMOBJ.DAT", "size": len(data),
            "notes": ["Field names follow uw1/src/include/object.h struct ComObj (provisional except where cited there).",
                      "resist: check_res (DAMAGE.C) cancels damage whose type bits it shares; the magic bits 0x03 are a chance "
                      "rand()%3 < (resist & 3). qualclass: damage_object shifts damage to the item right by it; 3 = indestructible."],
            "items": out}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--objects", required=True)
    ap.add_argument("--levark", required=True)
    ap.add_argument("--items", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--spells-c", help="uw1/src/combat/SPELLS.C, to emit spells.json")
    ap.add_argument("--comobj", help="COMOBJ.DAT, to emit comobj.json")
    a = ap.parse_args()
    item_names = load_item_names(a.items)
    objects = parse_objects(open(a.objects, "rb").read(), item_names)
    os.makedirs(a.out, exist_ok=True)
    json.dump(objects, open(os.path.join(a.out, "objects.json"), "w"), indent=1)
    if a.comobj:
        json.dump(parse_comobj(open(a.comobj, "rb").read(), item_names), open(os.path.join(a.out, "comobj.json"), "w"), indent=1)
    if a.spells_c:
        json.dump(parse_spells(a.spells_c, objects), open(os.path.join(a.out, "spells.json"), "w"), indent=1)
    lm = parse_levels(open(a.levark, "rb").read(), objects, item_names)
    lm["notes"] = [
        "Per-level monster instances from the pristine LEV.ARK. hp is the object's stored hit points (byte 0x08).",
        "combat.attacks[].to_hit_base = attacks[].chance + equip/2 (critter_attack, COMBAT.C:801); "
        "damage_base = attacks[].damage + STR/5 (COMBAT.C:799). Powerful adds the ranges shown.",
        "Creature names come from the port's items.h (descriptive, with the item id suffix where the original "
        "name repeats); the game's own strings are in STRINGS.PAK, not parsed.",
        "hp is as stored in the file. A critter generated at run time gets avghit * (16 + rand() % 24) / 32 "
        "(CREATURE.C:86); hp_authored marks stored values outside that range. The creature table's STR is 0 for "
        "every creature in this OBJECTS.DAT, so the STR / 5 damage term is always 0 for monsters.",
        "goal, attitude and old_goal are raw numbers; their meaning is not named in the sources read.",
        "placed_on_map: the monster is on a tile's object chain. Otherwise it is held (via its link) by a "
        "create-object trap, item 0x187, which copies it onto the map when it fires; spawn_probability is "
        "(63 - trap_quality) / 63 from TRIGGER.C:297. Free-list slots that still hold creature bytes are not "
        "counted as monsters.",
        "creature records: passive, remains, armour (255 = none at that location?) and similar fields keep the "
        "port's provisional names; see uw1/src/include/critter.h.",
    ]
    json.dump(lm, open(os.path.join(a.out, "level-monsters.json"), "w"), indent=1)
    print("wrote", a.out)
    for L in lm["levels"]:
        print(f"level {L['level']}: {L['monster_count']} monsters, {len(L['by_type'])} types, "
              f"placed {L['placed_count']}, trap-spawned {L['trap_spawned_count']}, other off-map {L['other_offmap_count']}, "
              f"stale free slots {len(L['free_slots_with_stale_creature_bytes'])}")
    for p in lm["problems"]:
        print("PROBLEM", p)

if __name__ == "__main__":
    main()
