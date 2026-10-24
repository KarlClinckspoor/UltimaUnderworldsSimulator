#!/usr/bin/env python3
"""Reference reader for an Ultima Underworld 2 save's PLAYER.DAT.

Usage: python3 -I read_playerdat.py PLAYER.DAT [--json]

Layout (docs/FORMATS.md "PLAYER.DAT", uw2/src/include/player.h, sys/MISCUTIL.C):
  byte 0        key = name[0] ^ 0xAA
  bytes 1..     struct Player, 0x37D bytes, enciphered 0x50 bytes at a time by xor_xor_table
                with the table build_xor_table makes from the key
  0x37E         word: number of saved objects + 1 (plain)
  0x380         the inventory workspace (plain): player object 0x1B, cursor object 8,
                0x1C slot words at +0x23 (file 0x3A3), saved objects 8 bytes each from +0x5B (file 0x3E3)
"""
import json, struct, sys

REC = 0x37D
WS = 1 + REC + 2            # 0x380
SKILLS = ["Attack", "Defense", "Barehand", "Sword", "Axe", "Mace", "Missile", "Mana", "Lore", "Casting",
          "Traps", "Search", "Track", "Stealth", "Repair", "Charisma", "Pick Lock", "Acrobat", "Appraise", "Swimming"]
RUNES = ["An", "Bet", "Corp", "Des", "Ex", "Flam", "Grav", "Hur", "In", "Jux", "Kal", "Lor", "Mani", "Nox", "Ort",
         "Por", "Quas", "Rel", "Sanct", "Tym", "Uus", "Vas", "Wis", "Ylem"]


def build_xor_table(key):
    """MISCUTIL.C build_xor_table: all arithmetic mod 256."""
    tab = [0] * 0x50
    key = (key + 0x71) & 0xFF
    for i in range(0x3C, 0x50):
        key = (key + i + 2) & 0xFF; tab[i] = key
    for i in range(0x50):
        key = (key + 6) & 0xFF; tab[i] = key
    for i in range(0x10):
        key = (key + 7) & 0xFF; tab[i * 5] = key
    for i in range(4):
        key = (key + 0x29) & 0xFF; tab[i * 12] = key
    for i in range(11):
        key = (key + 0x49) & 0xFF; tab[i * 7] = key
    return tab


def xor_block(src, tab):
    """xor_xor_table: dst[0] = src[0] ^ key[0]; dst[i] = src[i] ^ (key[i] + dst[i-1] + src[i-1])."""
    n = len(src)
    if n < 2:
        return bytes(src)
    dst = bytearray(n)
    dst[0] = src[0] ^ tab[0]
    for i in range(1, n):
        dst[i] = src[i] ^ ((tab[i] + dst[i - 1] + src[i - 1]) & 0xFF)
    return bytes(dst)


def decode_record(data):
    key = data[0]
    tab = build_xor_table(key)
    enc = data[1:1 + REC]
    out = b"".join(xor_block(enc[o:o + 0x50], tab) for o in range(0, len(enc), 0x50))
    return key, out


def obj8(data, n):
    off = WS + 0x5B + 8 * n
    idw, _pos, qn, ol = struct.unpack_from("<HHHH", data, off)
    return {"saved_index": n, "item_id": idw & 0x1FF, "is_quant": (idw >> 15) & 1, "enchanted": (idw >> 12) & 1,
            "flag11": (idw >> 11) & 1, "quality": qn & 0x3F, "next": qn >> 6, "owner": ol & 0x3F, "link": ol >> 6}


def enchantment_of(data, count, o):
    """decode_obj_spell (obj/USEITEMS.C): a quantity object with the enchanted bit carries its spell in
    link; otherwise the first spell object (0x120..0x12F) in its contents chain."""
    sp = None
    if o["is_quant"] and o["enchanted"]:
        sp = o
    elif not o["is_quant"] and o["link"]:
        j, seen = o["link"], 0
        while j and j < count and seen < 64:
            c = obj8(data, j)
            if c["item_id"] >> 4 == 0x12:
                sp = c; break
            j = c["next"]; seen += 1
    if sp is None:
        return None
    link = (sp["link"] << 6) | sp["owner"]
    ln = link >> 6
    if sp["flag11"]:
        major = (ln & 0x1FF) >> 6
        return {"charged": True, "major": -1 if major == 0 else major + 12, "effect": ln & 0x3F}
    return {"charged": False, "major": (ln & 0x1FF) >> 4, "effect": ln & 0xF}


def read_player_dat(data):
    if len(data) < WS:
        raise SystemExit(f"too short: {len(data)} bytes")
    key, rec = decode_record(data)
    count = struct.unpack_from("<H", data, 1 + REC)[0]
    problems = []
    if (rec[0] ^ 0xAA) != key:
        problems.append("key != name[0] ^ 0xAA")
    expected = WS + 0x5B + 8 * count
    if len(data) != expected:
        problems.append(f"length {len(data)} != {expected}")
    name = rec[:0x1E].split(b"\0")[0].decode("latin-1")
    u16 = lambda o: struct.unpack_from("<H", rec, o)[0]
    skills = list(rec[0x21:0x21 + 20])
    bag = rec[0x44:0x47]
    runes = [r for r in range(24) if (bag[r >> 3] >> (7 - (r & 7))) & 1]
    w60 = u16(0x60)
    b65 = rec[0x65]
    equipment = {}
    pack_ignored = 0
    for s in range(0x1C):
        v = struct.unpack_from("<H", data, WS + 0x23 + 2 * s)[0]
        n = v >> 6
        if not n:
            continue
        if s >= 11:
            pack_ignored += 1; continue
        if n >= count:
            problems.append(f"slot {s} -> object {n} >= count {count}"); continue
        o = obj8(data, n)
        o["slot"] = s
        o["enchantment"] = enchantment_of(data, count, o)
        equipment[s] = o
    return {
        "name": name, "str": rec[0x1E], "dex": rec[0x1F], "int": rec[0x20],
        "skills": dict(zip(SKILLS, skills)),
        "health": rec[0x35], "max_health": rec[0x36], "mana": rec[0x37], "max_mana": rec[0x38],
        "hunger": rec[0x39], "fatigue": rec[0x3A], "level": rec[0x3D],
        "active_spells": [u16(0x3E + 2 * i) for i in range(3)],
        "runes": [RUNES[r] for r in runes], "rune_indices": runes,
        "shelf": [RUNES[r] if r < 24 else None for r in rec[0x47:0x4A]],
        "weight": u16(0x4A), "max_weight": u16(0x4C),
        "exp_raw": struct.unpack_from("<I", rec, 0x4E)[0], "skill_points": rec[0x52], "skill_points_earned": rec[0x53],
        "saved_level": struct.unpack_from("<h", rec, 0x5C)[0],
        "world": (struct.unpack_from("<h", rec, 0x5C)[0] - 1) // 8 if rec[0x5C] else None,
        "drawn": w60 & 1, "poison": (w60 >> 1) & 0xF, "n_active_spells": (w60 >> 5) & 0xF,
        "light": rec[0x64], "lefty": b65 & 1, "female": (b65 >> 1) & 1, "body": (b65 >> 2) & 7, "pclass": (b65 >> 5) & 7,
        "easy": rec[0x301], "paralyzed": rec[0x305], "swim_count": rec[0x307],
        "game_clock": struct.unpack_from("<I", rec, 0x369)[0],
        "workspace_hp": data[WS + 8], "count": count, "equipment": equipment,
        "pack_slots_ignored": pack_ignored, "problems": problems,
    }


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        print(__doc__); sys.exit(1)
    p = read_player_dat(open(args[0], "rb").read())
    if "--json" in sys.argv:
        print(json.dumps(p, indent=1))
    else:
        for k, v in p.items():
            print(f"{k}: {v}")
