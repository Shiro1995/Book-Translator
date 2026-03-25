/**
 * In-memory LRU cache with TTL eviction.
 * Can be swapped for Redis-backed cache for production scaling.
 */

import crypto from "crypto";
import { logger } from "../lib/logger.js";

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class MemoryCache<T = unknown> {
  private readonly cache = new Map<string, CacheEntry<T>>();
  private readonly maxSize: number;
  private readonly ttlMs: number;
  private hits = 0;
  private misses = 0;

  constructor(maxSize = 500, ttlSeconds = 3600) {
    this.maxSize = maxSize;
    this.ttlMs = ttlSeconds * 1000;
  }

  /** Generate a deterministic cache key from params */
  static hashKey(parts: Record<string, string | number | undefined>): string {
    const input = Object.entries(parts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v ?? ""}`)
      .join("|");

    return crypto.createHash("sha256").update(input).digest("hex").slice(0, 16);
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);

    if (!entry) {
      this.misses++;
      return undefined;
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.misses++;
      return undefined;
    }

    this.hits++;

    // Move to end for LRU behavior
    this.cache.delete(key);
    this.cache.set(key, entry);

    return entry.value;
  }

  set(key: string, value: T) {
    // Evict oldest entries if at capacity
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }

    this.cache.set(key, {
      value,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  /** Get cache statistics */
  stats() {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hits: this.hits,
      misses: this.misses,
      hitRate: this.hits + this.misses > 0
        ? (this.hits / (this.hits + this.misses) * 100).toFixed(1) + "%"
        : "n/a",
    };
  }

  /** Remove expired entries */
  prune() {
    const now = Date.now();
    let pruned = 0;

    for (const [key, entry] of this.cache) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        pruned++;
      }
    }

    if (pruned > 0) {
      logger.debug("Cache pruned", { pruned, remaining: this.cache.size });
    }
  }
}
