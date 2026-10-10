#!/usr/bin/env node
// Brute-force client for mcbuddy's TCP bridge (NDJSON over 127.0.0.1:<port>).
// Usage:
//   node scripts/bridge-client.mjs smoke            # full end-to-end sequence
//   node scripts/bridge-client.mjs call <method> [jsonParams]
//   node scripts/bridge-client.mjs watch            # poll events.poll forever
// No dependencies; Node >= 18.

import net from 'node:net';

const PORT = Number(process.env.MCBUDDY_PORT || 25731);
const HOST = '127.0.0.1';
const TOKEN = process.env.MCBUDDY_TOKEN || '';

class Bridge {
  constructor() {
    this.socket = null;
    this.buffer = '';
    this.pending = new Map();
    this.nextId = 1;
  }

  async connect(timeoutMs = 60_000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      try {
        await this.#dial();
        return;
      } catch (err) {
        if (Date.now() > deadline) throw new Error(`bridge not reachable on ${HOST}:${PORT}: ${err.message}`);
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  #dial() {
    return new Promise((resolve, reject) => {
      const socket = net.connect(PORT, HOST);
      socket.setEncoding('utf8');
      const fail = (err) => { socket.destroy(); reject(err); };
      socket.once('error', fail);
      socket.once('connect', () => {
        socket.off('error', fail);
        socket.on('data', (chunk) => this.#onData(chunk));
        socket.on('close', () => {
          for (const p of this.pending.values()) p.reject(new Error('connection closed'));
          this.pending.clear();
          this.socket = null;
        });
        socket.on('error', () => {});
        this.socket = socket;
        resolve();
      });
    });
  }

  #onData(chunk) {
    this.buffer += chunk;
    let idx;
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      const p = this.pending.get(msg.id);
      if (p) {
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message ?? JSON.stringify(msg.error)));
        else p.resolve(msg.result);
      }
    }
  }

  call(method, params = {}, timeoutMs = 6000) {
    const id = this.nextId++;
    const body = { id, method, params };
    if (TOKEN) body.token = TOKEN;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method}: timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      this.socket.write(JSON.stringify(body) + '\n');
    });
  }

  close() { this.socket?.destroy(); }
}

const j = (v) => JSON.stringify(v);

async function smoke() {
  const bridge = new Bridge();
  process.stdout.write(`connecting to ${HOST}:${PORT} ... `);
  await bridge.connect();
  console.log('ok');

  const ping = await bridge.call('ping');
  console.log('ping ->', j(ping));

  const status = await bridge.call('status');
  console.log('status ->', j(status));

  const pos = status?.agent?.spawned ? status.agent.pos : null;
  if (pos) {
    const target = { x: pos.x + 3, y: pos.y, z: pos.z };
    console.log(`agent.walk_to -> ${j(target)}`);
    const walk = await bridge.call('agent.walk_to', target, 20_000);
    console.log('walk accepted ->', j(walk));
    await new Promise((r) => setTimeout(r, 4000));
    console.log('events ->', j(await bridge.call('events.poll', {})));
  } else {
    console.log('(agent not spawned; skipping walk test)');
  }

  bridge.close();
  console.log('smoke done');
}

async function main() {
  const [, , cmd, ...rest] = process.argv;
  if (cmd === 'smoke' || cmd === undefined) return smoke();
  if (cmd === 'call') {
    const bridge = new Bridge();
    await bridge.connect();
    const params = rest[1] ? JSON.parse(rest[1]) : {};
    console.log(j(await bridge.call(rest[0], params)));
    bridge.close();
    return;
  }
  if (cmd === 'watch') {
    const bridge = new Bridge();
    await bridge.connect();
    console.log('polling events.poll every 2s; Ctrl-C to stop');
    setInterval(async () => {
      try { console.log(j(await bridge.call('events.poll', {}))); }
      catch (e) { console.error(e.message); }
    }, 2000);
    return;
  }
  console.error('unknown command:', cmd);
  process.exitCode = 2;
}

main().catch((err) => { console.error('FAIL:', err.message); process.exit(1); });
