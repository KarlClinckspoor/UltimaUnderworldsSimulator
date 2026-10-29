#!/usr/bin/env python3
"""NPC names from a pristine STRINGS.PAK: block 7 (conversations), entry whoami + 0x10, as
LOOK.C's CritterLook reads them for 'a <attitude> <kind> named <Name>'. Same layout in UW1 and UW2.

Usage: python3 -I npc_names.py DATA/STRINGS.PAK > npc-names.json
"""
import json, struct, sys


def load(path):
    """STRINGS.PAK: a Huffman tree, then blocks of strings ('|' ends each)."""
    d = open(path, 'rb').read()
    n = struct.unpack_from('<H', d, 0)[0]
    nodes = [d[2 + 4 * i: 6 + 4 * i] for i in range(n)]
    o = 2 + 4 * n
    nb = struct.unpack_from('<H', d, o)[0]; o += 2
    blocks = {}
    for i in range(nb):
        bn, off = struct.unpack_from('<HI', d, o + 6 * i)
        blocks[bn] = off

    def block(bn):
        off = blocks[bn]
        cnt = struct.unpack_from('<H', d, off)[0]
        offs = struct.unpack_from(f'<{cnt}H', d, off + 2)
        base = off + 2 + 2 * cnt
        out = []
        for so in offs:
            pos = base + so; bit = 7; s = []
            while True:
                node = n - 1
                while nodes[node][2] != 0xFF:
                    b = (d[pos] >> bit) & 1
                    bit -= 1
                    if bit < 0:
                        bit = 7; pos += 1
                    node = nodes[node][3] if b else nodes[node][2]
                ch = nodes[node][0]
                if ch == ord('|') or len(s) >= 512:
                    break
                s.append(chr(ch))
            out.append(''.join(s))
        return out
    return block


if __name__ == '__main__':
    b7 = load(sys.argv[1])(7)
    names = {w: b7[w + 0x10].strip() for w in range(1, 256) if w + 0x10 < len(b7) and b7[w + 0x10].strip()}
    print(json.dumps({'source': 'STRINGS.PAK block 7, entry whoami + 0x10 (LOOK.C CritterLook)', 'names': names}, indent=1))
