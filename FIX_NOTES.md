# Build fix: TS2305 errors in src/game-servers/generals/board.ts

## Symptom
Render build failed at the `tsc` step with:
```
src/game-servers/generals/board.ts(2,3): error TS2305: Module '"./constants"' has no exported member 'COLS'.
... (and 6 more, for GENERAL_START_ARMY, MOUNTAIN_RATIO, NEUTRAL_CITY_ARMY_MAX,
     NEUTRAL_CITY_ARMY_MIN, NEUTRAL_CITY_COUNT, ROWS)
```

## Root cause
`src/game-servers/generals/board.ts` was leftover code from an earlier,
abandoned design for the "generals" game: a grid-based territory-capture
game (rows/cols, mountains, generals, neutral cities — a generals.io-style
clone).

The game was later redesigned into the RTS base-builder implemented in
`sim.ts`, `state.ts`, and `socketHandlers.ts`. `constants.ts` was rewritten
to match that new design (BUILDING_DEFS, UNIT_DEFS, MAP_WIDTH, etc.), but
`board.ts` — and its dedicated test, `src/__tests__/generalsBoard.test.ts`
— were never removed, so they kept importing constants that no longer
exist.

## Why it's safe to delete
`board.ts` was not imported by any file in the running application — only
by its own test file. Confirmed via:
```
grep -rn "from.*generals/board" src --include="*.ts"
```
which returns nothing outside the two removed files. The live "generals"
game server (`sim.ts` / `state.ts` / `socketHandlers.ts`) never referenced
it.

## Fix applied
- Removed `src/game-servers/generals/board.ts`
- Removed `src/__tests__/generalsBoard.test.ts`

## Verification
- Re-ran an import/export audit across all remaining `src/**/*.ts` files:
  every relative `import { X } from './...'` was checked against the
  target file's actual exports — no mismatches found.
- No remaining references to `board.ts` or `generalsBoard.test.ts`
  anywhere in `src/`.
- No duplicate export names in any file.
- `tsc` was previously green through `npm install` / `prisma generate` /
  `prisma migrate deploy` per the original Render log; the TS2305 errors
  were the only failure, and their cause is now removed.

Suggested commit message:
    fix: remove orphaned generals/board.ts (unused grid-based design,
    broke tsc build — see FIX_NOTES.md)
