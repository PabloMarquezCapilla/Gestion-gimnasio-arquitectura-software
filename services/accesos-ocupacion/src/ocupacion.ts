export interface CacheTicket { token: string; deadline: number }
export interface CacheLookup { ticket: CacheTicket; value?: number; ageMs?: number }
export interface OcupacionCache {
  lookup(sedeId: string): Promise<CacheLookup>;
  store(sedeId: string, ticket: CacheTicket, value: number): Promise<boolean>;
  invalidate(sedeId: string): Promise<void>;
  close(): Promise<void>;
}
const buckets = [.001, .005, .01, .025, .05, .1, .25, .5, 1, 3, 10];
class Histogram {
  count = 0; sum = 0; counts = buckets.map(() => 0);
  observe(value: number) { this.count++; this.sum += value; buckets.forEach((b, i) => { if (value <= b) this.counts[i]++; }); }
  text(name: string, labels: string) {
    return ['# TYPE ' + name + ' histogram', ...buckets.map((b, i) => `${name}_bucket{${labels},le="${b}"} ${this.counts[i]}`),
      `${name}_bucket{${labels},le="+Inf"} ${this.count}`, `${name}_count{${labels}} ${this.count}`, `${name}_sum{${labels}} ${this.sum}`].join('\n');
  }
}
export class OcupacionMetrics {
  hit = 0; miss = 0; bypass = 0; errors = 0; invalidations = 0; invalidationErrors = 0; storesRejected = 0;
  mongoQueries = 0; mongoLoads = 0;
  readonly duration = new Histogram(); readonly age = new Histogram();
  text(labels: string) {
    const counters: Record<string, number> = {
      accesos_cache_hits_total: this.hit, accesos_cache_misses_total: this.miss, accesos_cache_bypass_total: this.bypass,
      accesos_cache_errors_total: this.errors, accesos_cache_invalidations_total: this.invalidations,
      accesos_cache_invalidation_errors_total: this.invalidationErrors, accesos_cache_stores_rejected_total: this.storesRejected,
      accesos_occupancy_mongo_queries_total: this.mongoQueries, accesos_occupancy_mongo_loads_total: this.mongoLoads,
      accesos_occupancy_mongo_counts_avoided_total: this.hit,
    };
    return [...Object.entries(counters).map(([name, value]) => `# TYPE ${name} counter\n${name}{${labels}} ${value}`),
      this.duration.text('accesos_occupancy_duration_seconds', labels), this.age.text('accesos_cache_age_seconds', labels)].join('\n');
  }
}

export class OcupacionReader {
  readonly metrics = new OcupacionMetrics();
  constructor(private readonly source: (sedeId: string) => Promise<number>, private readonly cache?: OcupacionCache) {}
  async read(sedeId: string, warn: (codigo: string) => void = () => {}): Promise<number> {
    const start = performance.now(); let lookup: CacheLookup | undefined;
    try {
      if (this.cache) {
        try {
          lookup = await this.cache.lookup(sedeId);
          if (lookup.value !== undefined) {
            this.metrics.hit++; this.metrics.age.observe((lookup.ageMs ?? 0) / 1000); return lookup.value;
          }
          this.metrics.miss++;
        } catch { this.metrics.errors++; this.metrics.bypass++; warn('CACHE_LECTURA_FALLIDA'); }
      } else this.metrics.bypass++;
      this.metrics.mongoLoads++;
      const value = await this.source(sedeId);
      if (this.cache && lookup) {
        try { if (!await this.cache.store(sedeId, lookup.ticket, value)) this.metrics.storesRejected++; }
        catch { this.metrics.errors++; warn('CACHE_ESCRITURA_FALLIDA'); }
      }
      return value;
    } finally { this.metrics.duration.observe((performance.now() - start) / 1000); }
  }
  async invalidate(sedeId: string, warn: (codigo: string) => void = () => {}) {
    if (!this.cache) return;
    this.metrics.invalidations++;
    try { await this.cache.invalidate(sedeId); }
    catch { this.metrics.errors++; this.metrics.invalidationErrors++; warn('CACHE_INVALIDACION_FALLIDA'); }
  }
}
