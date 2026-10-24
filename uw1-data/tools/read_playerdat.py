#!/usr/bin/env python3
"""Reference reader for a UW1 save's PLAYER.DAT: record, equipment slots 0-10, rune bag.

Usage: python3 -I read_playerdat.py PLAYER.DAT [--objects objects.json] [--items items.h]

This is the spec for the site's TypeScript reader (plan sections 4 and B3) and
produces the expected values for its test fixtures. Layout: docs/FORMATS.md
"PLAYER.DAT"; uw1/src/include/player.h, inv.h, object.h; sys/MISCUTIL.C xorread.
"""
import argparse, json, re, struct, sys

SKILLS = ["Attack", "Defense", "Barehand", "Sword", "Axe", "Mace", "Missile", "Mana", "Lore", "Casting",
          "Traps", "Search", "Track", "Stealth", "Repair", "Charisma", "Pick Lock", "Acrobat", "Appraise",
          "Swimming"]
SLOTS = ["head", "torso", "gloves", "legs", "boots", "shoulder 5", "shoulder 6", "hand 7", "hand 8",
         "ring 9", "ring 10"]
RUNES = ["An", "Bet", "Corp", "Des", "Ex", "Flam", "Grav", "Hur", "In", "Jux", "Kal", "Lor", "Mani",
         "Nox", "Ort", "Por", "Quas", "Rel", "Sanct", "Tym", "Uus", "Vas", "Wis", "Ylem"]
REC = 0xD2          # struct Player length
WS = 1 + REC + 2    # workspace file offset 0xD5


def decode(data):
    key = data[0]
    rec = bytearray(data[1:1 + REC])
    for i in range(REC):
        rec[i] ^= (key + 3 * ((i % 0x50) + 1)) & 0xFF
    count = struct.unpack_from("<H", data, 1 + REC)[0]
    problems = []
    if (rec[0] ^ 0xAA) != key:
        problems.append("key does not match name[0] ^ 0xAA")
    if len(data) != 1 + REC + 2 + 0x5B + 8 * count:
        problems.append(f"length {len(data)} != 1 + 0xD2 + 2 + 0x5B + 8 x {count}")
    return rec, count, problems


def obj8(data, n):
    """Saved object n (1-based) of the workspace: 8 bytes at workspace 0x5B + 8n."""
    off = WS + 0x5B + 8 * n
    idw, pos, qn, ol = struct.unpack_from("<HHHH", data, off)
    return {"saved_index": n, "file_offset": off, "item_id": idw & 0x1FF,
            "is_quant": idw >> 15 & 1, "enchanted": idw >> 12 & 1, "flag11": idw >> 11 & 1,
            "quality": qn & 0x3F, "next": qn >> 6, "owner": ol & 0x3F, "link": ol >> 6}


def enchantment(data, count, o):
    """decode_obj_spell (USEITEMS.C): an enchanted is_quant object carries the spell in its own
    link; otherwise the first spell object (item 0x120-0x12F: MAJOR_SPEC minor 2) in its contents."""
    sp = None
    if o["is_quant"] and o["enchanted"]:
        sp = o
    elif not o["is_quant"] and o["link"]:
        j, seen = o["link"], 0
        while j and j < count and seen < 64:
            c = obj8(data, j)
            if c["item_id"] >> 4 == 0x12:
                sp = c
                break
            j, seen = c["next"], seen + 1
    if sp is None:
        return None
    link = (sp["link"] << 6) | sp["owner"]  # rebuild the 16-bit owner/link word
    ln = link >> 6
    if sp["flag11"]:
        major = (ln & 0x1FF) >> 6
        return {"charged": True, "major": -1 if major == 0 else major + 12, "effect": ln & 0x3F}
    return {"charged": False, "major": (ln & 0x1FF) >> 4, "effect": ln & 0xF}


def read(data, objects=None, item_names=None):
    rec, count, problems = decode(data)
    u16 = lambda o: struct.unpack_from("<H", rec, o)[0]
    lefty = rec[0x64] & 1
    out = {
        "name": bytes(rec[0:0x1E]).split(b"\0")[0].decode("latin-1"),
        "str": rec[0x1E], "dex": rec[0x1F], "int": rec[0x20],
        "skills": {SKILLS[i]: rec[0x21 + i] for i in range(20)},
        "health": rec[0x35], "max_health": rec[0x36], "mana": rec[0x37], "max_mana": rec[0x38],
        "level": rec[0x3D], "exp_raw": struct.unpack_from("<I", rec, 0x4E)[0],
        "weight": u16(0x4A), "max_weight": u16(0x4C), "easy": rec[0xB4],
        "lefty": lefty, "pclass": rec[0x64] >> 5 & 7,
        "dungeon_level": struct.unpack_from("<h", rec, 0x5C)[0],
        "active_spell_count": (u16(0x5F) >> 6) & 0xF,
        "active_spells": [u16(0x3E + 2 * i) for i in range(3)],
        "problems": problems,
    }
    # rune bag: bit 7 - (rune & 7) of runebag[rune / 8] (RUNES.C add_rune); shelf: 3 rune numbers, 0x18 empty
    bag = rec[0x44:0x47]
    out["runes"] = [RUNES[r] for r in range(24) if bag[r // 8] >> (7 - (r & 7)) & 1]
    out["shelf"] = [RUNES[r] if r < 24 else None for r in rec[0x47:0x4A]]
    # equipment: slot words at workspace 0x23; value >> 6 is the saved-object number
    slots = struct.unpack_from("<28H", data, WS + 0x23)
    eq = {}
    for s in range(11):
        n = slots[s] >> 6
        if not n:
            continue
        o = obj8(data, n)
        if item_names:
            o["name"] = item_names.get(o["item_id"], f"item 0x{o['item_id']:03X}")
        o["enchantment"] = enchantment(data, count, o)
        role = SLOTS[s]
        if s == 8 - lefty:
            role += " (weapon hand)"
        elif s == 7 + lefty:
            role += " (shield hand)"
        eq[role] = o
    out["equipment"] = eq
    out["pack_slots_ignored"] = sum(1 for s in range(11, 28) if slots[s])
    # derived values, as the game computes them (SKILLS.C player_compute, PLAYDATA.C FixPlayerEquips)
    d = {"max_weight": out["str"] * 20,
         "max_hp": 30 + out["level"] * out["str"] // 5,
         "max_mana": (out["skills"]["Mana"] + 1) * out["int"] >> 3}
    if objects:
        arm = [0, 0, 0, 0]
        idx = [3, 0, 1, 2, 2, 0]
        def armor_val(o):
            it = o["item_id"]
            if it < 0x20 or it >= 0x40:
                return 0
            return (o["quality"] * objects["armour"][it - 0x20]["protection"] >> 6) + 1
        for s in range(5):
            n = slots[s] >> 6
            if n:
                arm[idx[s]] += armor_val(obj8(data, n))
        n = slots[7 + lefty] >> 6
        if n:
            o = obj8(data, n)
            if o["item_id"] >> 4 == 3 and 11 <= (o["item_id"] & 15) <= 15:  # MAJOR_HACK minor 3, in-class 11..15
                v = armor_val(o)
                arm[0] += v
                arm[1] += v
        d["armour_by_zone"] = {"torso": arm[0], "gloves": arm[1], "legs_boots": arm[2], "head": arm[3]}
        wskill = 2
        n = slots[8 - lefty] >> 6
        if n:
            o = obj8(data, n)
            if o["item_id"] < 0x10:
                wskill = min(5, max(3, objects["melee_weapons"][o["item_id"]]["skill"]))
        d["defence"] = out["skills"]["Defense"] + (out["skills"][SKILLS[wskill]] >> 1)
        d["defence_weapon_skill"] = SKILLS[wskill]
    out["derived"] = d
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("playerdat")
    ap.add_argument("--objects")
    ap.add_argument("--items")
    a = ap.parse_args()
    names = None
    if a.items:
        names = {int(m.group(2), 16): m.group(1)
                 for m in re.finditer(r"#define\s+ITEM_(\w+)\s+0x([0-9A-Fa-f]+)", open(a.items).read())}
    objs = json.load(open(a.objects)) if a.objects else None
    print(json.dumps(read(open(a.playerdat, "rb").read(), objs, names), indent=1))


if __name__ == "__main__":
    main()
