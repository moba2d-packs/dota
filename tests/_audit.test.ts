/** THROWAWAY: audit of bot role inference across the pack. */
import { describe, it } from 'vitest';
import { data } from '../pack';
import * as barrel from '../spells/index';

// --- core's rules, restated here ONLY for this throwaway measurement ---
const R = {
  None: 0, Damage: 1, Poke: 2, Burst: 4, Dash: 8, Escape: 16, Cc: 32,
  Heal: 64, Shield: 128, Buff: 256, Zone: 512, Summon: 1024, Ultimate: 2048,
};
const NAMES = Object.entries(R).filter(([, v]) => v !== 0);
const has = (m: number, r: number) => (m & r) !== 0;
const BURST_MANA = 40, POKE_RANGE = 400;
const infer = (t: string, range: number, team: string | undefined, mana: number): number => {
  const burst = mana >= BURST_MANA ? R.Burst : 0;
  switch (t) {
    case 'SELF': return mana === 0 ? R.Buff : R.Buff | R.Shield;
    case 'UNIT': return team === 'ALLY' ? R.Heal | R.Shield : R.Damage | R.Cc | burst;
    case 'POINT': return range >= POKE_RANGE ? R.Damage | R.Poke | burst : R.Damage | R.Zone | burst;
    default: return range >= POKE_RANGE ? R.Damage | R.Poke | burst : R.Damage | burst;
  }
};
const S = {
  DAMAGE: 10, POKE: 6, BURST: 14, CC: 12, SUPPORT: 20, SUPPORT_WASTED: -5,
  ESCAPE: 25, ESCAPE_WASTED: -10, DASH_GAPCLOSE: 6, DASH_WASTED: -4,
  BUFF: 5, ZONE: 8, ULTIMATE: 6,
};
interface Sit {
  name: string; hasTarget: boolean; inReach: boolean; lowTarget: boolean;
  focus: boolean; healthPct: number; retreat: boolean; beyondAttack: boolean;
}
const SITS: Sit[] = [
  { name: 'poke',     hasTarget: true,  inReach: true,  lowTarget: false, focus: true,  healthPct: 1,    retreat: false, beyondAttack: true },
  { name: 'execute',  hasTarget: true,  inReach: true,  lowTarget: true,  focus: true,  healthPct: 1,    retreat: false, beyondAttack: true },
  { name: 'melee',    hasTarget: true,  inReach: true,  lowTarget: false, focus: true,  healthPct: 1,    retreat: false, beyondAttack: false },
  { name: 'gapclose', hasTarget: true,  inReach: false, lowTarget: false, focus: true,  healthPct: 1,    retreat: false, beyondAttack: true },
  { name: 'hurt',     hasTarget: true,  inReach: true,  lowTarget: false, focus: true,  healthPct: 0.3,  retreat: false, beyondAttack: true },
  { name: 'retreat',  hasTarget: false, inReach: false, lowTarget: false, focus: false, healthPct: 0.2,  retreat: true,  beyondAttack: false },
  { name: 'roam',     hasTarget: false, inReach: true,  lowTarget: false, focus: false, healthPct: 1,    retreat: false, beyondAttack: false },
];
const score = (mask: number, knownReach: boolean, s: Sit): number => {
  if (s.hasTarget && !s.inReach && !has(mask, R.Dash)) return -Infinity;
  let n = 0;
  if (has(mask, R.Damage) && s.hasTarget) n += S.DAMAGE;
  if (s.hasTarget && has(mask, R.Poke) && s.beyondAttack) n += S.POKE;
  if (has(mask, R.Burst) && s.hasTarget && s.lowTarget) n += S.BURST;
  if (has(mask, R.Cc) && s.hasTarget && s.focus) n += S.CC;
  if (has(mask, R.Heal) || has(mask, R.Shield)) n += s.healthPct < 0.5 ? S.SUPPORT : S.SUPPORT_WASTED;
  if (has(mask, R.Escape)) n += s.retreat ? S.ESCAPE : S.ESCAPE_WASTED;
  if (has(mask, R.Dash)) n += s.hasTarget && !s.inReach ? S.DASH_GAPCLOSE : S.DASH_WASTED;
  if (has(mask, R.Buff)) n += S.BUFF;
  if (has(mask, R.Zone) && s.inReach && knownReach) n += S.ZONE;
  if (has(mask, R.Ultimate)) n += S.ULTIMATE;
  return n;
};
const RETREAT_ROLES = R.Escape | R.Heal | R.Shield;

const NO_MATCH_RULES = { cooldownMultiplier: 1, manaFree: false };

describe('AUDIT', () => {
  it('dumps the role table', () => {
    const rows: string[] = [];
    const classes = barrel as unknown as Record<string, new (o: unknown) => any>;
    for (const champ of (data.champions ?? []).filter(c => (c as any).playable)) {
      const ids: string[] = (champ as any).spells ?? [];
      const kit: { id: string; mask: number; tagged: boolean; known: boolean; best: Record<string, number> }[] = [];
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        const Cls = classes[id];
        if (!Cls) { rows.push(`!! ${id} not in barrel`); continue; }
        let sp: any;
        try { sp = new Cls({ game: { matchRules: NO_MATCH_RULES } }); }
        catch (e) { rows.push(`!! ${id} construct: ${(e as Error).message.slice(0, 90)}`); continue; }
        let targeting = 'DIRECTION', range: number | undefined, team: string | undefined;
        try { targeting = sp.castSpec.targeting; } catch { /* throws when unset */ }
        try { range = sp.declaredRange; } catch { /* ignore */ }
        try { team = sp.targetingRequest?.targetTeam; } catch { /* ignore */ }
        const mana = typeof sp.manaCost === 'number' ? sp.manaCost : 0;
        const tagged = (Cls as any).aiRoles !== undefined;
        const slot = i + 1;
        let mask = tagged ? (Cls as any).aiRoles : infer(targeting, range ?? 0, team, mana);
        if (slot === 4) mask |= R.Ultimate;
        const known = range !== undefined;
        const best: Record<string, number> = {};
        for (const s of SITS) {
          if (s.retreat) {
            const ok = has(mask, RETREAT_ROLES) && !has(mask, R.Ultimate) && range === undefined;
            best[s.name] = ok ? score(mask, known, s) : -Infinity;
          } else best[s.name] = score(mask, known, s);
        }
        kit.push({ id, mask, tagged, known, best });
        const label = NAMES.filter(([, v]) => has(mask, v)).map(([k]) => k).join('|');
        const bestAny = Math.max(...Object.values(best));
        rows.push(
          `${(champ as any).id}\t${id}\tslot${slot}\t${targeting}\trange=${range ?? '-'}\tmana=${mana}\t` +
          `${tagged ? 'TAGGED' : 'infer '}\t${label}\tbest=${bestAny}\t` +
          Object.entries(best).map(([k, v]) => `${k}:${v === -Infinity ? 'x' : v}`).join(' ')
        );
      }
      // ultimate vs the rest, in the same situation
      const ult = kit.find(k => k.id === ids[3]);
      if (ult) {
        for (const s of SITS) {
          const others = kit.filter(k => k !== ult).map(k => k.best[s.name]);
          const bestOther = others.length ? Math.max(...others) : -Infinity;
          if (ult.best[s.name] > -Infinity && bestOther > 0 && ult.best[s.name] < bestOther) {
            rows.push(`  ~ ${(champ as any).id} R loses '${s.name}': ${ult.best[s.name]} vs ${bestOther}`);
          }
        }
      }
    }
    // eslint-disable-next-line no-console
    console.log('\n' + rows.join('\n'));
  });
});
