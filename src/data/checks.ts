// UW2's skill_check call sites outside combat, with the rule each one applies to the grade.
// Sources are uw2/src in abedegno/underworld-exhumed; each entry names its file and line.
import { gradeProbs, pPass } from '../core/skillcheck';
import { faceProbs } from '../core/randdist';
import { maxWeight, type Character } from '../core/character';
import { armour as ARMOUR, SK, weapons, worldOf } from './gameData';
import { fmt, h, pct } from '../ui/dom';
import { C, groupedBars } from '../ui/charts';
import type { Check, GameTiming } from '../ui/checkTypes';

export const TIMING: GameTiming = {
  game: 'UW2', checkSeconds: 20, manaEvery: 3, hpEvery: 30,
  source: 'INTERACT.C:118 runs duration_check (PLAYTIME.C) once every 20 seconds of game time (game_clock >> 8 counts seconds).',
  manaNote: 'No mana comes back in the Scintillus Academy (levels 41-48), except on its first level and the far side (x ≥ 25) of its eighth.',
};

const durabilityItems: [number, string][] = [
  ...weapons.slice(0, 15).map((w) => [w.durability, `${w.name} (${w.durability})`] as [number, string]),
  ...ARMOUR.filter((a) => a.durability < 255 && !a.name.startsWith('item')).map((a) => [a.durability, `${a.name} (${a.durability})`] as [number, string]),
].sort((a, b) => a[0] - b[0]);

const world = (c: Character) => worldOf(c.dungeonLevel);
const SKILL = 30, ATTR = 30;

export const CHECKS: Check[] = [
  { id: 'casting', label: 'Casting a spell', where: 'RUNES.C:238', value: (c) => c.skills[SK.Casting], target: (_, p) => 3 * p,
    vName: 'Casting', tName: '3 × circle', vCap: SKILL,
    param: { label: 'circle', min: 1, max: 8, def: 1 },
    effect: '1 or 2: the spell is cast · 0: "The incantation failed", no mana spent · −1: backfire: mana spent and ⌊circle/2⌋d8 damage, never below 3 HP.',
    about: 'Rolled once per cast, after the spell passes its other gates: character level ≥ 2 × circle − 1, mana ≥ 3 × circle, and in Britannia (levels 1-8) no circle above 3. A critical casts exactly like a success. UW2 drops UW1\'s +5 and raises the target from 2 × circle to 3 × circle, so casting is harder.',
    tex: String.raw`\begin{gathered}\V{v} = \V{\text{Casting}},\qquad \T{t} = \T{3c},\qquad g = \operatorname{check}(\V{v}, \T{t})\\[4pt]
\text{result} = \begin{cases}\text{cast} & g \ge 1\\ \text{fizzle (no mana spent)} & g = 0\\ \text{backfire: } \lfloor c/2\rfloor\text{d}8 \text{ damage, HP} \ge 3 & g = -1\end{cases}\end{gathered}`,
    py: `value = casting                # the Casting skill
target = 3 * circle
g = skill_check(value, target)
if g >= 1:   result = "cast"       # success and critical success alike
elif g == 0: result = "fizzle"     # "The incantation failed", no mana spent
else:        result = "backfire"   # mana spent, (circle // 2) d8 damage, HP kept >= 3`,
    extra: castingTable },
  { id: 'track', label: 'Track (skill key)', where: 'SPELLS2.C:613', value: (c) => c.skills[SK.Track], target: (_, p) => 15 - p,
    vName: 'Track', tName: '15 − noise', vCap: SKILL,
    param: { label: 'creature noise', min: 0, max: 15, def: 10 },
    effect: '≥ 1: the creature is counted in its direction · 2: it is also named · ≤ 0: not noticed.',
    about: 'One check per creature within 8 squares of you when you use the Track skill. A noisy creature (a high noise value in its creature record) lowers the target. UW2 has no Detect Monster spell.',
    tex: String.raw`\begin{gathered}\V{v} = \V{\text{Track}},\qquad \T{t} = \T{15 - \text{noise}},\qquad g = \operatorname{check}(\V{v}, \T{t})\\[4pt]
\text{counted if } g \ge 1,\qquad \text{named if } g = 2\end{gathered}`,
    py: `value = track
target = 15 - creature_noise
g = skill_check(value, target)
counted = g > 0     # adds 1 to that direction's count
named = g == 2      # the creature's name may be shown for that direction`,
  },
  { id: 'lore', label: 'Lore: looking at an item', where: 'INTERACT.C:547', value: (c) => c.skills[SK.Lore], target: () => 8,
    vName: 'Lore', tName: '8', vCap: SKILL,
    effect: 'Lore level = grade + 1, at least 1: critical success 3 (identified), success 2 ("magical"), anything else 1.',
    about: 'Rolled when you look at an object you have not identified yet. The object remembers the best lore level reached, so looking again can only improve it. Lore levels (LOOK.C): 1 shows the plain description; 2 adds "magical" to an enchanted item; 3 identifies it: the enchantment\'s name, its charges, curses and poisoned potions. Only the critical success identifies an item, which is why it is the grade that matters here. UW1 uses target 10.',
    tex: String.raw`\begin{gathered}\V{v} = \V{\text{Lore}},\qquad \T{t} = \T{8},\qquad g = \operatorname{check}(\V{v}, \T{t})\\[4pt]
\text{lore} = \max\bigl(1,\ g + 1,\ \text{lore already on the object}\bigr)\end{gathered}`,
    py: `value = lore
target = 8
g = skill_check(value, target)
level = max(1, g + 1, object_lore)    # 1 plain, 2 "magical", 3 identified`,
    extra: loreLevels },
  { id: 'lore-barter', label: 'Lore: barter (their goods)', where: 'BARTER.C:368', value: (c) => c.skills[SK.Lore], target: () => 20,
    vName: 'Lore', tName: '20', vCap: SKILL,
    effect: 'Lore level 2 ("magical") on success or critical success, else 1. Never 3: trading never identifies their goods.',
    about: 'Looking at an item on the trader\'s side of the barter screen (side 0). The check is against 20 and only tells you whether the item is magical; you cannot identify the other party\'s goods by looking.',
    tex: String.raw`\begin{gathered}\V{v} = \V{\text{Lore}},\qquad \T{t} = \T{20},\qquad g = \operatorname{check}(\V{v}, \T{t})\\[4pt]
\text{lore} = 1 + [g \ge 1]\end{gathered}`,
    py: `value = lore
target = 20
level = 1 + (skill_check(value, target) > 0)   # 1 plain, 2 "magical"`,
  },
  { id: 'lore-barter15', label: 'Lore: barter (your goods)', where: 'BARTER.C:369', value: (c) => c.skills[SK.Lore], target: () => 15,
    vName: 'Lore', tName: '15', vCap: SKILL,
    effect: 'Lore level 1 + grade: critical success 3 (identified), success 2, failure 1, critical failure 0 (as plain as 1).',
    about: 'Looking at an item on your side of the barter screen. Against 15, and a critical success identifies the item, so a trade window is a way to identify your own goods.',
    tex: String.raw`\begin{gathered}\V{v} = \V{\text{Lore}},\qquad \T{t} = \T{15},\qquad g = \operatorname{check}(\V{v}, \T{t})\\[4pt]
\text{lore} = 1 + g\end{gathered}`,
    py: `value = lore
target = 15
level = 1 + skill_check(value, target)   # 0 or 1 plain, 2 "magical", 3 identified`,
  },
  { id: 'look-trigger', label: 'Hidden look trigger', where: 'TRIGGER.C:107', value: (c) => c.skills[SK.Search], target: (_, p) => p,
    vName: 'Search', tName: "trigger's z", vCap: SKILL,
    param: { label: "trigger's z", min: 1, max: 127, def: 8 },
    effect: '≥ 1: the look trigger fires · ≤ 0: nothing happens.',
    about: 'A look trigger (type 5) placed with a height z above 0 only fires for you when a Search check against z succeeds; at z 0 it always fires. The Reveal spell runs the same check with a value of 45.',
    tex: String.raw`\begin{gathered}\V{v} = \V{\text{Search}},\qquad \T{t} = \T{z},\qquad \text{fires} \iff \operatorname{check}(\V{v}, \T{t}) \ge 1\end{gathered}`,
    py: `value = search
target = trigger_z
fires = skill_check(value, target) > 0`,
  },
  { id: 'detect-trap', label: 'Search: detect a trap', where: 'SKILLS.C:885', value: (c) => c.skills[SK.Search], target: (c) => 10 + 2 * world(c),
    vName: 'Search', tName: '10 + 2 × world', vCap: SKILL,
    effect: '≥ 1: the trap is found and you are offered to disarm it · ≤ 0: not found.',
    about: 'The target grows by 2 with each world (8 levels to a world): 10 in Britannia, 12 in the Prison Tower, 14 in Killorn Keep and so on. Set the dungeon level in the character panel.',
    tex: String.raw`\V{v} = \V{\text{Search}},\qquad \T{t} = \T{10 + 2w},\qquad \text{found} \iff \operatorname{check}(\V{v}, \T{t}) \ge 1`,
    py: `value = search
target = 10 + 2 * world      # world = (dungeon_level - 1) // 8
found = skill_check(value, target) > 0`,
  },
  { id: 'detect-spell', label: 'Detect Trap spell', where: 'SPELLS.C:862', value: () => 45, target: (c) => 10 + 2 * world(c),
    vName: '45 (spell)', tName: '10 + 2 × world', vCap: 45,
    effect: 'As the Search check, with a fixed value of 45: certain everywhere.',
    tex: String.raw`\V{v} = \V{45},\qquad \T{t} = \T{10 + 2w},\qquad \text{found} \iff \operatorname{check}(\V{v}, \T{t}) \ge 1`,
    py: `value = 45
target = 10 + 2 * world
found = skill_check(value, target) > 0`,
  },
  { id: 'disarm', label: 'Traps: disarm', where: 'SKILLS.C:923', value: (c) => c.skills[SK.Traps], target: (c) => 8 + world(c),
    vName: 'Traps', tName: '8 + world', vCap: SKILL,
    effect: '≥ 1: removed · 0: "Unable to defuse trap", try again · −1: the trap goes off.',
    tex: String.raw`\begin{gathered}\V{v} = \V{\text{Traps}},\qquad \T{t} = \T{8 + w},\qquad g = \operatorname{check}(\V{v}, \T{t})\\[4pt]
\text{result} = \begin{cases}\text{removed} & g \ge 1\\ \text{unable} & g = 0\\ \text{set off} & g = -1\end{cases}\end{gathered}`,
    py: `value = traps
target = 8 + world
g = skill_check(value, target)
result = "removed" if g > 0 else "unable" if g == 0 else "set off"`,
  },
  { id: 'remove-trap', label: 'Remove Trap spell', where: 'SPELLS.C:846', value: () => 45, target: (c) => 8 + world(c),
    vName: '45 (spell)', tName: '8 + world', vCap: 45,
    effect: 'As disarm, with a fixed value of 45. A detection roll before it (45 against 10 + 2 × world) only stops the spell on a 0.',
    tex: String.raw`\V{v} = \V{45},\qquad \T{t} = \T{8 + w}`,
    py: `value = 45
target = 8 + world
g = skill_check(value, target)   # as disarm`,
  },
  { id: 'lockpick', label: 'Pick Lock', where: 'OBJUSE.C:325', value: (c) => c.skills[SK['Pick Lock']] + 1, target: (_, p) => 3 * p,
    vName: 'Pick Lock + 1', tName: "3 × lock's z", vCap: SKILL + 1,
    param: { label: "lock's z", min: 0, max: 15, def: 3 },
    effect: '≥ 1: opens · 0: fails, try again · −1: a fumble: DEX against 20 saves the pick (≥ 1), else "You broke your pick".',
    about: 'Each try with a lockpick. A lock at z 15 never opens, and z 14 fails outright for a value below 32, so it is out of reach of Pick Lock (30 + 1).',
    tex: String.raw`\begin{gathered}\V{v} = \V{\text{Pick Lock} + 1},\qquad \T{t} = \T{3z},\qquad g = \operatorname{check}(\V{v}, \T{t})\\[4pt]
\text{result} = \begin{cases}\text{opens} & g \ge 1\\ \text{fails} & g = 0\\ \text{breaks unless } \operatorname{check}(\text{DEX}, 20) \ge 1 & g = -1\end{cases}\end{gathered}`,
    py: `value = pick_lock + 1
target = 3 * z
if z == 15 or (z == 14 and value < 32): result = "never opens"
else:
    g = skill_check(value, target)
    if g > 0: result = "opens"
    elif g == 0: result = "fails"
    else: result = "fumble, pick kept" if skill_check(dex, 20) > 0 else "pick broken"`,
    extra: lockNote },
  { id: 'open-spell', label: 'Open spell', where: 'SPELLS.C:856', value: () => 45, target: (_, p) => 3 * p,
    vName: '45 (spell)', tName: "3 × lock's z", vCap: 45,
    param: { label: "lock's z", min: 0, max: 15, def: 10 },
    effect: '≥ 1: opens (45 passes the z 14 guard). Mana is spent either way.',
    tex: String.raw`\V{v} = \V{45},\qquad \T{t} = \T{3z},\qquad \text{opens} \iff \operatorname{check}(\V{v}, \T{t}) \ge 1`,
    py: `value = 45
target = 3 * z
opens = skill_check(value, target) > 0`,
  },
  { id: 'repair', label: 'Repair at an anvil', where: 'WORLDEV.C:1013', value: (c) => c.skills[SK.Repair], target: (_, p) => p,
    vName: 'Repair', tName: "the item's durability", vCap: SKILL,
    param: { label: 'item durability', min: 1, max: 60, def: 5, options: durabilityItems },
    effect: '2: full repair · 1: +3 + Repair/5 quality · 0: nothing · −1: destroyed if (rand() & 63) > quality + Repair, else −(4 + rand() & 7) quality.',
    about: 'One attempt takes 3 × durability − Repair − quality/2 minutes (at least 15). The target is the item\'s durability from its weapon or armour record, so sturdy items are harder to mend.',
    tex: String.raw`\begin{gathered}\V{v} = \V{s} = \V{\text{Repair}},\qquad \T{t} = \T{\text{durability}},\qquad g = \operatorname{check}(\V{v}, \T{t})\\[4pt]
q' = \begin{cases}63 & g = 2\\ q + 3 + \lfloor \V{s}/5 \rfloor & g = 1\\ q & g = 0\\ \text{destroyed} & g = -1,\ x > q + \V{s},\ x \sim U\{0..63\}\\ q - (4 + y),\ y \sim U\{0..7\} & g = -1 \text{ otherwise}\end{cases}\end{gathered}`,
    py: `value = repair
target = durability
g = skill_check(value, target)
if g == 2:   q = 63
elif g == 1: q = min(63, q + 3 + value // 5)
elif g == -1:
    if (rand() & 63) > q + value: destroyed = True
    else: q = max(0, q - (4 + (rand() & 7)))   # 0 also destroys it
minutes = max(15, 3 * target - value - q // 2)`,
    extra: repairTable },
  { id: 'swim', label: 'Swimming (drowning)', where: 'PLAYTIME.C:228', value: (c) => c.skills[SK.Swimming], target: (_, p) => p,
    vName: 'Swimming', tName: 'load = weight × 32 / max weight', vCap: SKILL,
    param: { label: 'load = weight × 32 / max weight', min: 0, max: 32, def: 4 },
    effect: 'Each duration check in deep water: a failure or critical failure raises swim_count; once it passes 0x78 a second roll hurts you unless it is a critical success.',
    about: 'Entering deep water sets swim_count to 0x60 (96), and it never falls while you stay in. Every duration check (20 s) rolls Swimming against your load: a critical failure adds 4d4 and a failure 3d4. Once swim_count passes 0x78 (120), every check also rolls a second time: hurt = 2 − grade, and the damage is 2d(hurt + 2), so a critical success is the only safe roll. Leaving the water resets it.',
    tex: String.raw`\begin{gathered}\V{v} = \V{\text{Swimming}},\qquad \T{t} = \T{\lfloor 32\,\text{weight} / \text{max weight}\rfloor}\\[4pt]
g_1 = \operatorname{check}(\V{v}, \T{t}):\quad \text{count} \mathrel{+}= \begin{cases}4\text{d}4 & g_1 = -1\\ 3\text{d}4 & g_1 = 0\\ 0 & g_1 \ge 1\end{cases}\qquad(\text{count} < \texttt{0x8C})\\[4pt]
\text{if count} > \texttt{0x78}:\quad h = 2 - \operatorname{check}(\V{v}, \T{t}),\qquad \text{HP} \mathrel{-}= \begin{cases}2\text{d}(h + 2) & h > 0\\ 0 & h = 0\end{cases}\end{gathered}`,
    py: `value = swimming
target = weight * 32 // max_weight        # the load, 0..32
# every 20 s in deep water; count starts at 0x60 when you enter it
g = skill_check(value, target)
if g < 1 and count < 0x8C:
    count += rollem(3 - g, 4)            # 3d4 or 4d4
if count > 0x78:
    hurt = 2 - skill_check(value, target)
    if hurt:
        hp -= rollem(2, hurt + 2)        # 2d3, 2d4 or 2d5`,
    timed: 'drown', extra: swimNote },
  { id: 'fall', label: 'Acrobat: falling', where: 'PHYSICS.C:610', value: (c) => c.skills[SK.Acrobat], target: (_, p) => 2 * p,
    vName: 'Acrobat', tName: '2 × fall damage', vCap: SKILL,
    param: { label: 'fall damage', min: 1, max: 40, def: 5 },
    effect: '≥ 1: the damage is cut to damage × (30 − Acrobat) / 30 · otherwise full damage. Damage of 3 or less is ignored either way.',
    about: 'On landing, the damage is the impact over 256, doubled while still moving vertically. There is no fall damage at all in the Ethereal Void (levels 65-72).',
    tex: String.raw`\begin{gathered}\V{v} = \V{a} = \V{\text{Acrobat}},\qquad \T{t} = \T{2d}\\[4pt]
d' = \begin{cases}\lfloor d\,(30 - \V{a}) / 30 \rfloor & \operatorname{check}(\V{v}, \T{t}) \ge 1\\ d & \text{otherwise}\end{cases},\qquad \text{HP} \mathrel{-}= d' \text{ if } d' > 3\end{gathered}`,
    py: `value = acrobat
target = 2 * damage
if skill_check(value, target) > 0:
    damage = damage * (30 - value) // 30
if damage > 3:
    hp -= damage`,
  },
  { id: 'ice', label: 'Acrobat: thin ice', where: 'TRIGGER.C:1181', value: (c) => c.skills[SK.Acrobat], target: (_, p) => (p > 20 ? p : 0),
    vName: 'Acrobat', tName: 'weight / 12 if above 20, else 0', vCap: SKILL,
    param: { label: 'carried weight / 12', min: 0, max: 60, def: 10 },
    effect: 'Only a critical failure breaks the ice under you (the tile drops one step).',
    tex: String.raw`\V{v} = \V{\text{Acrobat}},\qquad \T{t} = \T{\begin{cases}\lfloor \text{weight}/12 \rfloor & > 20\\ 0 & \text{else}\end{cases}},\qquad \text{breaks} \iff \operatorname{check}(\V{v}, \T{t}) = -1`,
    py: `value = acrobat
w = weight // 12
target = w if w > 20 else 0
breaks = skill_check(value, target) < 0`,
  },
  { id: 'skill-trap', label: 'Skill trap', where: 'TRIGGER.C:378', value: (_, p) => p, target: () => 15,
    vName: 'the attribute or skill', tName: '3 × owner', vCap: null,
    param: { label: 'attribute or skill value', min: 0, max: 40, def: 15 },
    effect: '≥ 1 passes: the trap runs its other branch · ≤ 0: the chain goes on as normal.',
    about: 'A scripted condition in the map. The trap\'s quality picks the value: 0..2 STR, DEX, INT; 3 a fixed 15; 4 and up a skill. A trap with heading 1 rolls value against 3 × owner; any other heading compares them outright (value ≥ 3 × owner). Owner is taken as 5 here (target 15); type in another target for other traps.',
    tex: String.raw`\V{v} = \V{\text{attribute or skill}},\qquad \T{t} = \T{3\,\text{owner}},\qquad \text{passes} \iff \operatorname{check}(\V{v}, \T{t}) \ge 1`,
    py: `value = attribute_or_skill
target = 3 * trap_owner
passes = skill_check(value, target) > 0   # heading 1; otherwise value >= target`,
  },
  { id: 'mana-regen', label: 'Mana regeneration', where: 'PLAYTIME.C:134', value: (c) => c.skills[SK.Mana], target: () => 10,
    vName: 'Mana', tName: '10', vCap: SKILL,
    effect: 'Every 60 s: success +1 mana, critical success +2, otherwise nothing.',
    about: 'Every third duration check, so once a minute of game time, the Mana skill is rolled against 10 and a positive grade is added to your mana, up to the maximum. Resting regenerates more (a separate rule, not shown).',
    tex: String.raw`\V{v} = \V{\text{Mana skill}},\qquad \T{t} = \T{10},\qquad \Delta\text{mana} = \max\bigl(0,\ \operatorname{check}(\V{v}, \T{t})\bigr)\ \text{ every } 3 \times 20\,\text{s}`,
    py: `value = mana_skill
target = 10
# every third duration check (60 s)
mana = min(max_mana, mana + max(0, skill_check(value, target)))`,
    timed: 'mana' },
  { id: 'hp-regen', label: 'HP regeneration', where: 'PLAYTIME.C:148', value: (c) => c.str, target: () => 15,
    vName: 'STR', tName: '15', vCap: ATTR,
    effect: 'Every 10 minutes: success or critical success +1 HP, otherwise nothing.',
    about: 'Every 30th duration check, so every 10 minutes of game time, strength is rolled against 15 and a pass heals 1 HP, up to the maximum. A critical success heals no more than a success. Sleeping heals much faster (a separate rule, not shown). UW1 rolls every 24th check.',
    tex: String.raw`\V{v} = \V{\text{STR}},\qquad \T{t} = \T{15},\qquad \Delta\text{HP} = [\operatorname{check}(\V{v}, \T{t}) \ge 1]\ \text{ every } 30 \times 20\,\text{s}`,
    py: `value = strength
target = 15
# every 30th duration check (10 minutes)
if skill_check(value, target) > 0:
    hp = min(max_hp, hp + 1)`,
    timed: 'hp' },
  { id: 'mushroom', label: 'Mushroom', where: 'USEITEMS.C:222', value: (c) => c.int, target: () => 20,
    vName: 'INT', tName: '20', vCap: ATTR,
    effect: 'Any grade but 0 (so critical failure too) gives 0, 1 or 2 mana; you also hallucinate (shrooms + 1, up to 3) whatever the roll.',
    about: 'The code tests the grade as a truth value, if (skill_check(INT, 20)), so −1 counts as a pass and only a plain failure (0) gives nothing. This is almost certainly a slip for > 0, but it is what the game does. The mana is rand() × 3 / 0x8000: 0, 1 or 2, about a third each, so a passed roll can still give nothing.',
    tex: String.raw`\begin{gathered}\V{v} = \V{\text{INT}},\qquad \T{t} = \T{20},\qquad g = \operatorname{check}(\V{v}, \T{t})\\[4pt]
\Delta\text{mana} = \begin{cases}\lfloor 3\,\texttt{rand()} / 32768 \rfloor \in \{0, 1, 2\} & g \ne 0\\ 0 & g = 0\end{cases}\end{gathered}`,
    py: `value = intelligence
target = 20
if skill_check(value, target):        # true for -1, 1 and 2: only 0 fails
    mana = min(max_mana, mana + rand() * 3 // 0x8000)
shrooms = min(3, shrooms + 1)`,
    extra: mushroomNote },
  { id: 'drunk', label: 'Drink', where: 'USEITEMS.C:307', value: (c) => c.str, target: (_, p) => p,
    vName: 'STR', tName: 'drunk level', vCap: ATTR,
    param: { label: 'drunk level', min: 0, max: 63, def: 10 },
    effect: '−1: you pass out and sleep · 0: you wobble for drunk / 6 · 1: nothing · 2: +2 HP.',
    about: 'An alcoholic drink first adds its strength to your drunk level (up to 63), then rolls STR against the new level. The drunk level falls by 1 every 10 minutes.',
    tex: String.raw`\begin{gathered}\V{v} = \V{\text{STR}},\qquad \T{t} = \T{\text{drunk}},\qquad g = \operatorname{check}(\V{v}, \T{t})\\[4pt]
\begin{cases}\text{sleep} & g = -1\\ \text{wobble for } \lfloor \T{\text{drunk}} / 6 \rfloor & g = 0\\ \text{nothing} & g = 1\\ +2\ \text{HP} & g = 2\end{cases}\end{gathered}`,
    py: `drunk = min(63, drunk + drink_strength)
value = strength
target = drunk
g = skill_check(value, target)
if g == -1: sleep()
elif g == 0: wobble(drunk // 6)
elif g == 2: hp = min(max_hp, hp + 2)`,
  },
  { id: 'halluc', label: 'Hallucination (special attack)', where: 'SPELLS.C:980', value: (c) => c.int, target: () => 20,
    vName: 'INT', tName: '20', vCap: ATTR,
    effect: '≥ 1 resists a mind blast · ≤ 0: you hallucinate (as after mushrooms). Already hallucinating, you are not affected again.',
    tex: String.raw`\V{v} = \V{\text{INT}},\qquad \T{t} = \T{20},\qquad \text{resisted} \iff \operatorname{check}(\V{v}, \T{t}) \ge 1`,
    py: `value = intelligence
target = 20
resisted = shrooms > 0 or skill_check(value, target) > 0`,
  },
  { id: 'chargen', label: 'Character creation (one check)', where: 'SKILLS.C:143', value: (_, p) => p, target: () => 20,
    vName: 'prime attribute', tName: '20', vCap: null,
    param: { label: 'prime attribute', min: 10, max: 30, def: 20 },
    effect: 'Each grade (−1..2) is added to the skill: three checks for a new skill, two for one already held.',
    about: 'When you pick a skill at character creation it gets a base (3 for a new skill), attribute / divisor, a random bonus, then two or three rolls of the governing attribute against 20, each adding its grade, capped at 30.',
    tex: String.raw`\text{skill} \mathrel{+}= \sum_{i=1}^{n} \operatorname{check}(\V{\text{attribute}}, \T{20}),\qquad n = 3 \text{ (new) or } 2`,
    py: `value = prime_attribute
target = 20
for _ in range(rolls):          # 3 for a new skill, 2 for one already held
    skill += skill_check(value, target)
skill = min(skill, 30)`,
    extra: chargenDist },
];

function castingTable(c: Character, _p: number, el: HTMLElement) {
  const t = h('table', { class: 'mini wide' }, h('tr', {}, ...['Circle', 'Target', 'Cast', 'Fizzle (0)', 'Backfire (−1)', 'Backfire damage', 'Allowed?'].map((x) => h('th', {}, x))));
  const mm = ((c.skills[SK.Mana] + 1) * c.int) >> 3;
  for (let circle = 1; circle <= 8; circle++) {
    const g = gradeProbs(c.skills[SK.Casting], 3 * circle);
    const why = [Math.floor((c.level + 1) / 2) < circle ? `level ${2 * circle - 1}` : '', 3 * circle > mm ? `${3 * circle} mana` : '',
      worldOf(c.dungeonLevel) === 0 && circle > 3 ? 'to leave Britannia' : ''].filter(Boolean).join(', ');
    t.append(h('tr', {}, h('td', {}, String(circle)), h('td', { class: 'tgt' }, String(3 * circle)), h('td', {}, pct(g[2] + g[3])), h('td', {}, pct(g[1])),
      h('td', {}, pct(g[0])), h('td', {}, circle >> 1 ? `${circle >> 1}d8, mean ${(4.5 * (circle >> 1)).toFixed(1)}` : 'none'), h('td', { class: why ? 'warn' : '' }, why ? `needs ${why}` : 'yes')));
  }
  el.append(h('p', {}, `Every circle for Casting ${c.skills[SK.Casting]}:`), t);
}
function loreLevels(c: Character, _p: number, el: HTMLElement) {
  const g = gradeProbs(c.skills[SK.Lore], 8);
  el.append(h('p', {}, `Per look with Lore ${c.skills[SK.Lore]}: plain (1) ${pct(g[0] + g[1])} · "magical" (2) ${pct(g[2])} · identified (3) ${pct(g[3])}.`));
}
function lockNote(c: Character, p: number, el: HTMLElement) {
  const v = c.skills[SK['Pick Lock']] + 1;
  if (p >= 15) el.append(h('p', { class: 'warn' }, 'z 15: never opens.'));
  else if (p === 14) el.append(h('p', { class: 'warn' }, `z 14: fails outright for values below 32, so Pick Lock ${c.skills[SK['Pick Lock']]} (+1) never opens it.`));
  else {
    const g = gradeProbs(v, 3 * p);
    const saved = pPass(c.dex, 20);
    el.append(h('p', {}, `Opens ${pct(g[2] + g[3])} of tries; fumbles ${pct(g[0])}, and DEX ${c.dex} against 20 saves the pick ${pct(saved)} of those, so the pick breaks on ${pct(g[0] * (1 - saved))} of tries.`));
  }
}
function repairTable(c: Character, p: number, el: HTMLElement) {
  const sk = c.skills[SK.Repair];
  const g = gradeProbs(sk, p);
  el.append(h('p', {}, `By the item's current quality (the destruction chance depends on it), Repair ${sk}:`));
  const t = h('table', { class: 'mini wide' }, h('tr', {}, ...['Quality', 'Full', `+${3 + Math.trunc(sk / 5)}`, 'Nothing', 'Destroyed', 'Damaged −4..−11', 'Time (min)'].map((x) => h('th', {}, x))));
  for (const q of [5, 15, 30, 45, 60]) {
    const pd = Math.max(0, 63 - (q + sk)) / 64;
    t.append(h('tr', {}, h('td', {}, String(q)), h('td', {}, pct(g[3])), h('td', {}, pct(g[2])), h('td', {}, pct(g[1])), h('td', {}, pct(g[0] * pd)),
      h('td', {}, pct(g[0] * (1 - pd))), h('td', {}, String(Math.max(15, 3 * p - sk - Math.trunc(q / 2))))));
  }
  el.append(t);
}
function swimNote(c: Character, _p: number, el: HTMLElement) {
  el.append(h('p', {}, `Max weight ${maxWeight(c)} (STR × 13 + 300). Load = weight × 32 / max weight: carrying half the maximum gives 16.`));
  const t = h('table', { class: 'mini wide' }, h('tr', {}, ...['Load', 'P(swim_count stays)', 'P(hurt per check, once past 0x78)', 'Mean damage per check, once past 0x78'].map((x) => h('th', {}, x))));
  for (const load of [0, 4, 8, 16, 24, 32]) {
    const g = gradeProbs(c.skills[SK.Swimming], load);
    let ed = 0;
    [-1, 0, 1, 2].forEach((gr, i) => { const hurt = 2 - gr; if (hurt) ed += g[i] * (2 + 2 * faceProbs(hurt + 2).reduce((m, pp, f) => m + pp * f, 0)); });
    t.append(h('tr', {}, h('td', { class: 'tgt' }, String(load)), h('td', {}, pct(g[2] + g[3])), h('td', {}, pct(1 - g[3])), h('td', {}, fmt(ed, 2))));
  }
  el.append(t);
}
function mushroomNote(c: Character, _p: number, el: HTMLElement) {
  const g = gradeProbs(c.int, 20);
  const f = faceProbs(3);
  const mean = f[1] + 2 * f[2];
  el.append(h('p', {}, `With INT ${c.int}: the roll counts ${pct(1 - g[1])} of the time as the code reads (any grade but 0); it would be ${pct(g[2] + g[3])} if only success counted. Expected mana per mushroom: ${fmt((1 - g[1]) * mean, 2)} (as coded) against ${fmt((g[2] + g[3]) * mean, 2)} (as probably meant).`));
}
function chargenDist(_c: Character, p: number, el: HTMLElement) {
  const g = gradeProbs(p, 20);
  const conv = (n: number) => {
    let d = new Map<number, number>([[0, 1]]);
    for (let i = 0; i < n; i++) {
      const nd = new Map<number, number>();
      for (const [s, ps] of d) [-1, 0, 1, 2].forEach((gr, j) => nd.set(s + gr, (nd.get(s + gr) ?? 0) + ps * g[j]));
      d = nd;
    }
    return [...d.entries()].sort((a, b) => a[0] - b[0]);
  };
  const three = conv(3), two = conv(2);
  el.append(h('p', {}, 'Sum of the grades added (before the base, the attribute share and the random bonus):'));
  const box = h('div');
  const cats = Array.from({ length: 10 }, (_, i) => String(i - 3));
  groupedBars(box, cats, [
    { name: 'new skill (3 checks)', color: C.accent, values: cats.map((x) => three.find(([s]) => s === +x)?.[1] ?? 0) },
    { name: 'held skill (2 checks)', color: C.blue, values: cats.map((x) => two.find(([s]) => s === +x)?.[1] ?? 0) }], { yfmt: (v) => pct(v, 1), height: 180 });
  el.append(box);
}
