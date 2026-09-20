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

  publish(userId: string, env: Envelope) {
    this.listeners.get(userId)?.forEach((fn) => {
      try {
        fn(env);
      } catch {
        /* ignore slow clients */
      }
    });
  }

  publishMany(ids: string[], env: Envelope) {
    for (const id of ids) this.publish(id, env);
  }
}

class Presence {
  private last = new Map<string, number>();
  private ttl = 45_000;

  heartbeat(userId: string) {
    this.last.set(userId, Date.now());
  }

  leave(userId: string) {
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

export function envelope(type: string, body: unknown): Envelope {
  return { type, ts: new Date().toISOString(), body };
}
