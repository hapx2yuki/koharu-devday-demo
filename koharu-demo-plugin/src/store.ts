/** Memory-only store. Nothing is read from a user's filesystem or account. */
export interface Store {
  get<T>(key: string): Promise<T | null>; set<T>(key: string, value: T): Promise<void>;
  insert<T>(key: string, value: T): Promise<boolean>; compareSet<T>(key: string, expected: T, value: T): Promise<boolean>;
  list<T>(prefix: string): Promise<T[]>; remove(key: string): Promise<void>;
}
export class MemoryStore implements Store {
  private records = new Map<string, string>();
  async get<T>(key: string): Promise<T | null> { const s = this.records.get(key); return s === undefined ? null : JSON.parse(s) as T; }
  async set<T>(key: string, value: T): Promise<void> { this.records.set(key, JSON.stringify(value)); }
  async insert<T>(key: string, value: T): Promise<boolean> { if (this.records.has(key)) return false; this.records.set(key, JSON.stringify(value)); return true; }
  async compareSet<T>(key: string, expected: T, value: T): Promise<boolean> { if (this.records.get(key) !== JSON.stringify(expected)) return false; this.records.set(key, JSON.stringify(value)); return true; }
  async list<T>(prefix: string): Promise<T[]> { return [...this.records].filter(([k]) => k.startsWith(prefix)).map(([, v]) => JSON.parse(v) as T); }
  async remove(key: string): Promise<void> { this.records.delete(key); }
}
