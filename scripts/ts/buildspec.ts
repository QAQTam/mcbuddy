// buildspec.ts — the "design" as pure data: site / footprint / openings / pillars / roof / materials.
// No bridge calls, no predicates: a spec is a plain JSON-able object.
//
// Coordinate conventions (all relative, so a spec is site-independent):
//   dx, dz  — offsets from site.x0 / site.z0, inclusive ranges
//   y       — offsets from Y0 = site.groundTopY + 1 (the foundation top level)
// Roof tiers use explicit rects (no expand/inset math), so the `expand = -inset`
// sign trap from house #1 cannot occur by construction.

export interface Rect { x0: number; x1: number; z0: number; z1: number }

export interface BuildSpec {
  name: string;
  site: { x0: number; z0: number; groundTopY: number };
  footprint: { fx: number; fz: number };
  wallHeight: number;
  /** block name without the minecraft: namespace */
  materials: { foundation: string; wall: string; pillar: string; roof: string; ridge: string };
  /** material -> hotbar slot for agent.give */
  slots: Record<string, number>;
  /** full-height columns (wallHeight + 1) */
  pillars: { dx: number; dz: number }[];
  /** door gaps: opening cells h = 1..height */
  doors: { dx: number; dz: number; height: number }[];
  /** window gaps: single cells at Y0 + y */
  windows: { dx: number; dz: number; y: number }[];
  /** horizontal slabs, bottom-up */
  roofTiers: { y: number; rect: Rect; mat: 'roof' | 'ridge' }[];
}

// ---- house #2 (superflat world) — mirrors the previous hardcoded design in build-flat.ts ----

const FX = 19, FZ = 20;

export const house2: BuildSpec = {
  name: 'house2',
  site: { x0: 14, z0: -14, groundTopY: -60 }, // superflat; override site via CLI in build-flat.ts
  footprint: { fx: FX, fz: FZ },
  wallHeight: 3,
  materials: { foundation: 'stone', wall: 'diorite', pillar: 'deepslate', roof: 'stone', ridge: 'deepslate' },
  slots: { stone: 0, diorite: 1, deepslate: 2 },
  pillars: [
    // corners
    { dx: 0, dz: 0 }, { dx: 0, dz: FZ - 1 }, { dx: FX - 1, dz: 0 }, { dx: FX - 1, dz: FZ - 1 },
    // east/west wall mid points
    { dx: 0, dz: 9 }, { dx: 0, dz: 10 }, { dx: FX - 1, dz: 9 }, { dx: FX - 1, dz: 10 },
    // north/south wall points
    { dx: 4, dz: 0 }, { dx: FX - 5, dz: 0 }, { dx: 4, dz: FZ - 1 }, { dx: FX - 5, dz: FZ - 1 },
  ],
  doors: [
    { dx: 9, dz: 0, height: 2 },
    { dx: 10, dz: 0, height: 2 },
  ],
  windows: [
    // south face (dz=0); window level y=2
    ...[3, 6, 12, 15].map(dx => ({ dx, dz: 0, y: 2 })),
    // north face (dz=FZ-1)
    ...[3, 6, 12, 15].map(dx => ({ dx, dz: FZ - 1, y: 2 })),
    // west face (dx=0); dz=10 is a pillar, so only 5 and 14
    ...[5, 14].map(dz => ({ dx: 0, dz, y: 2 })),
    // east face (dx=FX-1)
    ...[5, 14].map(dz => ({ dx: FX - 1, dz, y: 2 })),
  ],
  roofTiers: [
    { y: 4, rect: { x0: -1, x1: FX, z0: -1, z1: FZ }, mat: 'roof' },          // tier1 21x22 overhang
    { y: 5, rect: { x0: 1, x1: FX - 2, z0: 1, z1: FZ - 2 }, mat: 'roof' },    // tier2 17x18
    { y: 6, rect: { x0: 7, x1: 11, z0: 1, z1: FZ - 2 }, mat: 'ridge' },       // ridge 5x18
  ],
};

/** shallow-copy a spec with a different site (CLI overrides) */
export function withSite(spec: BuildSpec, x0: number, z0: number, groundTopY?: number): BuildSpec {
  return {
    ...spec,
    site: { x0, z0, groundTopY: groundTopY ?? spec.site.groundTopY },
  };
}
