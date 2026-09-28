import { bindFanout, publishRemote } from "./valkey";

export type Envelope = {
  type: string;
  ts: string;
  body: unknown;
};

type Listener = (env: Envelope) => void;

class Hub {
  private listeners = new Map<string, Set<Listener>>();

  subscribe(userId: string, fn: Listener) {
    let set = this.listeners.get(userId);
    if (!set) {
      set = new Set();
      this.listeners.set(userId, set);
    }
    set.add(fn);
    return () => {
      set!.delete(fn);
      if (set!.size === 0) this.listeners.delete(userId);
    };
  }

  deliver(userId: string, env: Envelope) {
    this.listeners.get(userId)?.forEach((fn) => {
      try {
        fn(env);
      } catch {
        /* ignore slow clients */
      }
    });
  }

  publish(userId: string, env: Envelope) {
    this.deliver(userId, env);
    publishRemote(userId, env);
  }

  publishMany(ids: string[], env: Envelope) {
    for (const id of ids) this.publish(id, env);
  }
}

class Presence {
  private last = new Map<string, number>();
  private counts = new Map<string, number>();
  private ttl = 45_000;

  heartbeat(userId: string) {
    this.last.set(userId, Date.now());
  }

  enter(userId: string) {
    const n = (this.counts.get(userId) || 0) + 1;
    this.counts.set(userId, n);
    this.last.set(userId, Date.now());
    return n === 1;
  }

  exit(userId: string) {
    const n = (this.counts.get(userId) || 1) - 1;
    if (n <= 0) {
      this.counts.delete(userId);
      this.last.delete(userId);
      return true;
    }
    this.counts.set(userId, n);
    return false;
  }

  leave(userId: string) {
    this.counts.delete(userId);
    this.last.delete(userId);
  }

  online(userId: string) {
    const t = this.last.get(userId);
    return !!t && Date.now() - t < this.ttl;
  }
}

const g = globalThis as typeof globalThis & {
  __samalHub?: Hub;
  __samalPresence?: Presence;
};

export const hub = (g.__samalHub ??= new Hub());
export const presence = (g.__samalPresence ??= new Presence());

bindFanout((userId, env) => hub.deliver(userId, env));

export function envelope(type: string, body: unknown): Envelope {
  return { type, ts: new Date().toISOString(), body };
}
