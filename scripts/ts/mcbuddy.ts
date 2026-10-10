// mcbuddy.ts — typed PTC client for the mcbuddy bridge.
// Run directly with Node 26 (native type stripping): no build step.
import net from 'node:net';

export const PORT = Number(process.env.MCBUDDY_PORT || 25731);
export const HOST = '127.0.0.1';

export interface Vec3 { x: number; y: number; z: number }
export interface AgentStatus {
  tick: number;
  agent: {
    spawned: boolean; name: string; dimension: string;
    pos: Vec3 & { chunk_x: number; chunk_z: number };
    health: number; gamemode: string; selected_slot: number; hotbar: string[];
  } | null;
  others: { name: string; x: number; y: number; z: number; dist: number }[];
  pause: { client_paused: boolean; server_paused: boolean; keep_ticking_while_paused: boolean; dev_writes: boolean };
  event_cursor: number;
}
export interface ColumnRow { y: number; block: string }
export interface ColumnResult { x: number; z: number; loaded: boolean; column?: string[] }

export class Bridge {
  private sock: net.Socket | null = null;
  private buf = '';
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  private nextId = 1;

  async connect(timeoutMs = 60_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      try { await this.dial(); return; }
      catch (e: any) {
        if (Date.now() > deadline) throw new Error(`bridge unreachable on ${HOST}:${PORT}: ${e.message}`);
        await sleep(1000);
      }
    }
  }

  private dial(): Promise<void> {
    return new Promise((resolve, reject) => {
      const s = net.connect(PORT, HOST);
      s.setEncoding('utf8');
      const fail = (e: Error) => { s.destroy(); reject(e); };
      s.once('error', fail);
      s.once('connect', () => {
        s.off('error', fail);
        s.on('data', (c) => this.onData(c));
        s.on('close', () => { this.sock = null; });
        s.on('error', () => { });
        this.sock = s;
        resolve();
      });
    });
  }

  private onData(chunk: string): void {
    this.buf += chunk;
    let i: number;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).trim();
      this.buf = this.buf.slice(i + 1);
      if (!line) continue;
      let msg: any; try { msg = JSON.parse(line); } catch { continue; }
      const p = this.pending.get(msg.id);
      if (p) {
        this.pending.delete(msg.id);
        clearTimeout(p.timer);
        msg.error ? p.reject(new Error(msg.error.message ?? JSON.stringify(msg.error))) : p.resolve(msg.result);
      }
    }
  }

  async call<T = any>(method: string, params: Record<string, unknown> = {}, timeoutMs = 9000): Promise<T> {
    if (!this.sock) throw new Error('not connected');
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} timeout`)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.sock!.write(JSON.stringify({ id, method, params }) + '\n');
    });
  }

  async rawCall<T = any>(method: string, params: Record<string, unknown> = {}, tries = 4): Promise<T> {
    for (let a = 1; ; a++) {
      try { return await this.call<T>(method, params); }
      catch (e: any) {
        if (a >= tries) throw e;
        await sleep(500 * a);
      }
    }
  }

  close(): void { this.sock?.destroy(); }
}

export const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

// ---- domain helpers (all retry internally) ----

export async function status(b: Bridge): Promise<AgentStatus> {
  return b.rawCall<AgentStatus>('status');
}

export async function column(b: Bridge, x: number, z: number, y0: number, y1: number): Promise<ColumnRow[] | null> {
  const r = await b.rawCall<ColumnResult>('world.column', { x, z, y0, y1 }).catch(() => null);
  if (!r?.loaded || !r.column) return null;
  return r.column.map(row => { const [ys, block] = row.split(' '); return { y: Number(ys), block: block.replace('block.minecraft.', '') }; });
}

export function groundOf(rows: ColumnRow[] | null): number | null {
  if (!rows) return null;
  let g: number | null = null;
  for (const { y, block } of rows) {
    if (isTreePart(block)) continue;
    if (!isAirish(block)) g = y;
  }
  return g;
}

const GROUND_COVER = new Set(['air', 'short_grass', 'tall_grass', 'fern', 'dandelion', 'poppy', 'snow', 'leaf_litter']);
export const isAirish = (block: string): boolean => GROUND_COVER.has(block);
export const isTreePart = (block: string): boolean =>
  block.includes('leaves') || block.includes('_log') || block === 'leaf_litter' || block.includes('wood');

export async function teleport(b: Bridge, x: number, y: number, z: number): Promise<void> {
  const r = await b.rawCall<{ moved: boolean; reason?: string }>('agent.teleport', { x, y, z });
  if (!r.moved) throw new Error(`teleport refused: ${r.reason}`);
}

export interface PlaceResult { placed: boolean; skipped?: string }

export async function place(b: Bridge, x: number, y: number, z: number, standY = y): Promise<PlaceResult> {
  for (let t = 0; t < 4; t++) {
    const r = await b.rawCall<{ placed: boolean; reason?: string; within_reach?: boolean }>('agent.place', { x, y, z });
    if (r.placed) return { placed: true };
    const reason = r.reason ?? '';
    if (reason.includes('no solid neighbour')) return { placed: false, skipped: reason };
    if (r.within_reach === false || reason.includes('empty hand')) {
      const spots: [number, number][] = [[1.5, 0.5], [-1.5, 0.5], [0.5, 1.5], [0.5, -1.5], [2.5, 0.5], [0.5, -2.5]];
      const sp = spots[t % spots.length];
      await teleport(b, x + sp[0], standY + 1, z + sp[1]).catch(() => { });
    }
    await sleep(150);
  }
  return { placed: false, skipped: 'gave up' };
}

export async function breakBlock(b: Bridge, x: number, y: number, z: number): Promise<boolean> {
  const r = await b.rawCall<{ broken: boolean }>('agent.break', { x, y, z });
  return !!r.broken;
}

export async function freecamOn(b: Bridge, pos: Vec3, look: Vec3): Promise<void> {
  const { yaw, pitch } = lookYawPitch(pos, look);
  await b.call('camera.on', { ...pos, yaw, pitch });
}
export async function freecamOff(b: Bridge): Promise<void> {
  await b.call('camera.off', {});
}
export async function shot(b: Bridge, file: string, downscale = 2): Promise<void> {
  const fs = await import('node:fs');
  const r = await b.call<{ data_base64: string; bytes: number }>('camera.shot', { downscale });
  fs.writeFileSync(file, Buffer.from(r.data_base64, 'base64'));
}

export function lookYawPitch(p: Vec3, t: Vec3): { yaw: number; pitch: number } {
  const dx = t.x - p.x, dy = t.y - p.y, dz = t.z - p.z;
  return {
    yaw: Math.atan2(dz, dx) * 180 / Math.PI - 90,
    pitch: -Math.atan2(dy, Math.hypot(dx, dz)) * 180 / Math.PI,
  };
}
