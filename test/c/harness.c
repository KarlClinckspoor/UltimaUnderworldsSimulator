/* C cross-check harness (plan sections 6 and B10). The functions below are copied
   verbatim from abedegno/underworld-exhumed, UW2 sources (uw2/src/game/SKILLCHK.C
   skill_check and the arithmetic of player_get_exp, combat/COMBAT.C pickloc, the dice of
   do_damage and the poison-weapon term of frp_check, combat/DAMAGE.C check_res,
   critter/AI.C should_i_flee, sys/UTIL.C rollem); only rand() is replaced by a queue
   of chosen values so every input can be enumerated. Prints one JSON object. */
#include <stdio.h>

typedef long int32;
static int q[16];
static int qi;
static int fake_rand(void) { return q[qi++ & 15]; }
#define rand fake_rand
#define DMG_MAGIC 3

/* ---- SKILLCHK.C */
int skill_check(int value, int target)
{
    int score;

    score = value - target;
    score += rand() % 31;
    if (score > 28)
        return 2;
    if (score > 15)
        return 1;
    if (score > 2)
        return 0;
    return -1;
}

/* ---- UTIL.C */
int rollem(int dice, register int sides)
{
    register int total = dice;

    if (sides > 0 && dice > 0)
        while (dice--)
            total += (int)(((int32)rand() * sides) / 0x8000L);
    return total;
}

/* ---- COMBAT.C */
int pickloc(int dz, int dtop, int az, int atop)
{
    int dmid;
    int amid;

    dmid = (dz + dtop) >> 1;
    amid = (az + atop) >> 1;
    if (dz + 1 > amid)
        return 2;
    if (dtop - 1 < amid)
        return 3;
    if (amid < dmid) {
        if (rand() % 2)
            return 2;
    } else if (rand() % 3 == 0)
        return 3;
    if (rand() % 3)
        return 0;
    return 1;
}

/* the dice part of do_damage */
int damage_dice(int damage)
{
    int quot, rem;
    if (damage < 2)
        damage = 2;
    quot = damage / 6;
    rem = damage % 6;
    damage = 0;
    if (quot != 0)
        damage = rollem(quot, 6);
    if (rem != 0)
        damage += rollem(1, rem);
    return damage;
}

/* ---- DAMAGE.C:210 (res passed in instead of ComObjData[OBJ_ITEM(obj)].resist) */
unsigned char check_res(unsigned char res, unsigned char damage, unsigned char type)
{
    if (type & res)
    {
        if (type & DMG_MAGIC)
        {
            if (rand() % 3 < (res & 3))
                return 0;
            type = type & 0xFC;
        }
        if (res & type)
            return 0;
    }
    if ((type & 8 && res & 0x20) || (type & 0x20 && res & 8 && (res & 0x28) != 0x28))
    {
        if (damage < 0x7F)
            damage = damage << 1;
        else
            damage = 0xFF;
    }
    return damage;
}

/* ---- SKILLCHK.C:63 player_get_exp, the arithmetic on a gain n for a player of `level`
   on dungeon level PlayerLevel with experience exp (the panel and skill-point side effects
   left out). Returns the new experience. int is 16 bits in the game: emulated with short. */
typedef unsigned long uint32;
uint32 get_exp_after(short n, int level, int PlayerLevel, uint32 exp)
{
    uint32 pexp = exp;
    if (n > 0)
        n = (n + rand() % 2) / 2;
    if (n < 0)
    {
        if (-n > pexp)
            pexp = 0;
        else
            pexp += n;
        return pexp;
    }
    if (((PlayerLevel - 1) / 8 * 2 + 2) < level)
        n = n / 2 + 1;
    if (pexp + n > 0x7FFF0L)
        return pexp;
    pexp += n;
    return pexp;
}

/* ---- COMBAT.C:942 player_killed_a's amount for creature exp `cexp`, powerful or not */
short killed_exp(int cexp, int powerful)
{
    short exp;
    exp = cexp;
    exp = exp * 4 + rollem(2, exp);
    if (powerful)
        exp = (int32)exp * (rand() % 24 + 24) / 16;
    return exp;
}

/* ---- COMBAT.C:320 frp_check's Poison Weapon term */
short poison_damage(short damage, int casting)
{
    damage += damage * (casting + 30) / 40;
    return damage;
}

/* ---- AI.C */
unsigned char should_i_flee(unsigned char maxhp, unsigned char hp, unsigned char nerve,
                            unsigned char damage)
{
    register unsigned r;

    if (maxhp * 3 >> 2 < hp)
        return 0;
    if (maxhp >> 3 > hp)
        return 0;
    if (maxhp >> 1 < damage)
        return 1;
    if (maxhp == 0)
        return 0;
    r = (hp << 4) / maxhp + rand() % 4;
    if (0xF - nerve < r)
        return 0;
    return 1;
}

static unsigned lcg = 12345;
static int lcg15(void) { lcg = lcg * 1103515245u + 12345u; return (lcg >> 16) & 0x7FFF; }

int main(void)
{
    int d, r, i, g, a, b, n;
    static const int tops[] = { 9, 14, 18, 20, 23, 28, 32 };
    static const int maxhps[] = { 0, 5, 8, 20, 21, 45, 80, 200 };
    static const int nerves[] = { 0, 5, 8, 15 };
    static const int dmgs[] = { 0, 3, 10, 40, 100 };
    static const int types[] = { 3, 4, 8, 0x0B, 0x10, 0x23, 0x40, 0x43 };

    printf("{\"skill_check\":[");
    for (d = -80; d <= 80; d++) {
        int c[4] = { 0, 0, 0, 0 };
        for (r = 0; r < 32768; r++) { q[0] = r; qi = 0; c[skill_check(d, 0) + 1]++; }
        printf("%s[%d,%d,%d,%d]", d == -80 ? "" : ",", c[0], c[1], c[2], c[3]);
    }
    printf("],\"pickloc\":\"");
    for (i = 0; i < 7; i++)
        for (a = 0; a <= 40; a++)
            for (b = 0; b <= 20; b += 20)
                for (r = 0; r < 36; r++) {
                    q[0] = r / 6; q[1] = r % 6; q[2] = (r * 7) % 6; qi = 0;
                    printf("%d", pickloc(0, tops[i], a, a + b));
                }
    printf("\",\"flee\":\"");
    for (i = 0; i < 8; i++)
        for (g = 0; g <= maxhps[i] + 2; g++)
            for (a = 0; a < 4; a++)
                for (b = 0; b < 5; b++)
                    for (r = 0; r < 4; r++) {
                        q[0] = r; qi = 0;
                        printf("%d", should_i_flee(maxhps[i], g, nerves[a], dmgs[b]));
                    }
    printf("\",\"check_res\":\"");
    for (i = 0; i < 256; i++)
        for (a = 0; a < 8; a++)
            for (r = 0; r < 3; r++) {
                q[0] = r; qi = 0;
                printf("%d", check_res(i, 10, types[a]) ? 1 : 0);
            }
    printf("\",\"get_exp\":[");
    for (d = 0, n = 0; d < 3 * 4 * 4; d++) {
        static const int ns[] = { 0, 1, 7, 100, -5, -1000, 32767 };
        static const int levels[] = { 1, 3, 5, 16 };
        static const int plevels[] = { 1, 9, 41, 73 };
        static const uint32 exps[] = { 0, 4, 96000, 524270 };
        for (i = 0; i < 7; i++)
            for (r = 0; r < 2; r++) {
                q[0] = r; qi = 0;
                printf("%s%lu", n++ ? "," : "", get_exp_after((short)ns[i], levels[d % 4], plevels[d / 4 % 4], exps[d / 16]));
            }
    }
    printf("],\"killed_exp\":[");
    for (d = 0, n = 0; d < 6; d++) {
        static const int cexps[] = { 0, 5, 29, 438, 999, 1859 };
        for (r = 0; r < 24; r += 23)
            for (a = 0; a < 2; a++) {
                q[0] = 0x3FFF; q[1] = 0x7FFF; q[2] = r; qi = 0;
                printf("%s%d", n++ ? "," : "", killed_exp(cexps[d], a));
            }
    }
    printf("],\"poison\":[");
    for (d = 0, n = 0; d <= 60; d += 3)
        for (a = 0; a <= 30; a += 5)
            printf("%s%d", n++ ? "," : "", poison_damage(d, a));
    printf("],\"dice\":[");
    for (d = 0, n = 0; d <= 60; d++)
        for (r = 0; r < 20; r++) {
            for (i = 0; i < 16; i++) q[i] = lcg15();
            qi = 0;
            printf("%s%d", n++ ? "," : "", damage_dice(d));
        }
    printf("]}\n");
    return 0;
}
