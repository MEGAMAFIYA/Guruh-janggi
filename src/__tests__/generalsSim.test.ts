/**
 * Unit tests for the Generals RTS simulation (src/game-servers/generals/sim.ts).
 * Pure functions operating on an in-memory world — no Prisma/network mocking.
 */
import {
  BUILDING_DEFS,
  P1_BASE,
  P2_BASE,
  STARTING_RESOURCE,
  UNIT_DEFS,
} from '../game-servers/generals/constants';
import {
  BuildingInstance,
  UnitInstance,
  createWorld,
  issueMoveOrder,
  placeBuilding,
  queueUnit,
  scoreOf,
  tick,
} from '../game-servers/generals/sim';

describe('createWorld', () => {
  it('spawns one Command Center per player with starting resources', () => {
    const world = createWorld(1000);
    const buildings = Array.from(world.buildings.values());
    expect(buildings).toHaveLength(2);
    expect(buildings.filter((b) => b.kind === 'commandCenter')).toHaveLength(2);
    expect(world.resources.player1).toBe(STARTING_RESOURCE);
    expect(world.resources.player2).toBe(STARTING_RESOURCE);
    expect(world.units.size).toBe(0);
  });
});

describe('placeBuilding', () => {
  it('rejects building too far from any owned building', () => {
    const world = createWorld(1000);
    const result = placeBuilding(world, 'player1', 'barracks', P2_BASE.x, P2_BASE.y, 1000);
    expect(result.ok).toBe(false);
  });

  it('rejects building without enough resource', () => {
    const world = createWorld(1000);
    world.resources.player1 = 10; // barracks costs 150
    const result = placeBuilding(world, 'player1', 'barracks', P1_BASE.x, P1_BASE.y + 100, 1000);
    expect(result.ok).toBe(false);
  });

  it('deducts cost and creates an under-construction building near the base', () => {
    const world = createWorld(1000);
    const before = world.resources.player1;
    const result = placeBuilding(world, 'player1', 'barracks', P1_BASE.x, P1_BASE.y + 100, 1000);
    expect(result.ok).toBe(true);
    expect(world.resources.player1).toBe(before - BUILDING_DEFS.barracks.cost);
    const barracks = Array.from(world.buildings.values()).find((b) => b.kind === 'barracks');
    expect(barracks).toBeDefined();
    expect(barracks?.constructionEndsAt).not.toBeNull();
  });

  it('rejects overlapping an existing building', () => {
    const world = createWorld(1000);
    const first = placeBuilding(world, 'player1', 'barracks', P1_BASE.x, P1_BASE.y + 100, 1000);
    expect(first.ok).toBe(true);
    const second = placeBuilding(world, 'player1', 'barracks', P1_BASE.x + 5, P1_BASE.y + 100, 1000);
    expect(second.ok).toBe(false);
  });
});

describe('queueUnit', () => {
  function buildAndFinishBarracks(world: ReturnType<typeof createWorld>, now: number): BuildingInstance {
    placeBuilding(world, 'player1', 'barracks', P1_BASE.x, P1_BASE.y + 100, now);
    const barracks = Array.from(world.buildings.values()).find((b) => b.kind === 'barracks') as BuildingInstance;
    // Simulate construction completing.
    tick(world, now + BUILDING_DEFS.barracks.buildTimeMs + 1, BUILDING_DEFS.barracks.buildTimeMs + 1);
    return barracks;
  }

  it('rejects training at a building still under construction', () => {
    const world = createWorld(1000);
    placeBuilding(world, 'player1', 'barracks', P1_BASE.x, P1_BASE.y + 100, 1000);
    const barracks = Array.from(world.buildings.values()).find((b) => b.kind === 'barracks') as BuildingInstance;
    const result = queueUnit(world, 'player1', barracks.id, 'soldier', 1000);
    expect(result.ok).toBe(false);
  });

  it('rejects training by someone who does not own the building', () => {
    const world = createWorld(1000);
    const barracks = buildAndFinishBarracks(world, 1000);
    const result = queueUnit(world, 'player2', barracks.id, 'soldier', 5000);
    expect(result.ok).toBe(false);
  });

  it('queues a soldier and deducts cost once the building is complete', () => {
    const world = createWorld(1000);
    const barracks = buildAndFinishBarracks(world, 1000);
    const before = world.resources.player1;
    const result = queueUnit(world, 'player1', barracks.id, 'soldier', 5000);
    expect(result.ok).toBe(true);
    expect(world.resources.player1).toBe(before - UNIT_DEFS.soldier.cost);
    expect(barracks.queue).toHaveLength(1);
  });

  it('spawns the unit once training time elapses', () => {
    const world = createWorld(1000);
    const barracks = buildAndFinishBarracks(world, 1000);
    queueUnit(world, 'player1', barracks.id, 'soldier', 5000);
    expect(world.units.size).toBe(0);
    tick(world, 5000 + UNIT_DEFS.soldier.trainTimeMs + 1, UNIT_DEFS.soldier.trainTimeMs + 1);
    expect(world.units.size).toBe(1);
    const unit = Array.from(world.units.values())[0];
    expect(unit.ownerId).toBe('player1');
    expect(unit.kind).toBe('soldier');
  });
});

describe('issueMoveOrder', () => {
  it('only moves units owned by the caller', () => {
    const world = createWorld(1000);
    const mine: UnitInstance = {
      id: 'u1', ownerId: 'player1', kind: 'soldier', x: 0, y: 0,
      hp: 50, maxHp: 50, moveTarget: null, attackTargetId: null, lastAttackAt: 0,
    };
    const theirs: UnitInstance = {
      id: 'u2', ownerId: 'player2', kind: 'soldier', x: 0, y: 0,
      hp: 50, maxHp: 50, moveTarget: null, attackTargetId: null, lastAttackAt: 0,
    };
    world.units.set(mine.id, mine);
    world.units.set(theirs.id, theirs);

    issueMoveOrder(world, 'player1', ['u1', 'u2'], 100, 100);
    expect(mine.moveTarget).toEqual({ x: 100, y: 100 });
    expect(theirs.moveTarget).toBeNull();
  });
});

describe('tick — movement and combat', () => {
  function makeUnit(id: string, owner: 'player1' | 'player2', x: number, y: number): UnitInstance {
    return {
      id, ownerId: owner, kind: 'soldier', x, y,
      hp: UNIT_DEFS.soldier.hp, maxHp: UNIT_DEFS.soldier.hp,
      moveTarget: null, attackTargetId: null, lastAttackAt: 0,
    };
  }

  it('moves a unit toward its move target at its defined speed', () => {
    const world = createWorld(1000);
    const u = makeUnit('u1', 'player1', 0, 0);
    world.units.set(u.id, u);
    issueMoveOrder(world, 'player1', ['u1'], 1000, 0);

    tick(world, 2000, 1000); // 1 second of simulated time
    expect(u.x).toBeCloseTo(UNIT_DEFS.soldier.speed, 0);
    expect(u.y).toBeCloseTo(0, 5);
  });

  it('engages and damages an enemy unit that comes within range instead of continuing to move', () => {
    const world = createWorld(1000);
    const attacker = makeUnit('u1', 'player1', 0, 0);
    const defender = makeUnit('u2', 'player2', 20, 0); // well within attackRange (55)
    world.units.set(attacker.id, attacker);
    world.units.set(defender.id, defender);
    issueMoveOrder(world, 'player1', ['u1'], 1000, 0);

    tick(world, 2000, 1000);
    expect(attacker.x).toBe(0); // stayed put to fight instead of marching past
    expect(defender.hp).toBeLessThan(UNIT_DEFS.soldier.hp);
  });

  it('respects attack cooldown — no damage on a second tick that arrives too soon', () => {
    const world = createWorld(1000);
    const attacker = makeUnit('u1', 'player1', 0, 0);
    const defender = makeUnit('u2', 'player2', 20, 0);
    world.units.set(attacker.id, attacker);
    world.units.set(defender.id, defender);

    tick(world, 1000, 100);
    const hpAfterFirstHit = defender.hp;
    expect(hpAfterFirstHit).toBeLessThan(UNIT_DEFS.soldier.hp);

    tick(world, 1050, 50); // well inside the cooldown window
    expect(defender.hp).toBe(hpAfterFirstHit);
  });

  it('removes a unit once its hp drops to zero or below', () => {
    const world = createWorld(1000);
    const attacker = makeUnit('u1', 'player1', 0, 0);
    const defender = makeUnit('u2', 'player2', 20, 0);
    defender.hp = 1;
    world.units.set(attacker.id, attacker);
    world.units.set(defender.id, defender);

    tick(world, 1000, 100);
    expect(world.units.has('u2')).toBe(false);
  });

  it('declares the opponent the winner once a player has zero Command Centers', () => {
    const world = createWorld(1000);
    const cc = Array.from(world.buildings.values()).find((b) => b.ownerId === 'player2') as BuildingInstance;
    cc.hp = 1;
    const attacker = makeUnit('u1', 'player1', cc.x, cc.y);
    world.units.set(attacker.id, attacker);

    const result = tick(world, 1000, 100);
    expect(result.ended).toBe(true);
    if (result.ended) {
      expect(result.winner).toBe('player1');
      expect(result.reason).toBe('destroyed');
    }
  });
});

describe('scoreOf', () => {
  it('counts live units and buildings owned by a player', () => {
    const world = createWorld(1000);
    world.units.set('u1', {
      id: 'u1', ownerId: 'player1', kind: 'soldier', x: 0, y: 0,
      hp: 10, maxHp: 10, moveTarget: null, attackTargetId: null, lastAttackAt: 0,
    });
    const s = scoreOf(world, 'player1');
    expect(s.units).toBe(1);
    expect(s.buildings).toBe(1); // the starting Command Center
  });
});
