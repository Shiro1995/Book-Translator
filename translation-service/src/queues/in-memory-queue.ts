/**
 * In-memory job queue with concurrency control and job tracking.
 * Can be swapped for BullMQ + Redis for production scaling.
 */

import crypto from "crypto";
import type { JobInfo, JobStatus } from "../types/index.js";
import { logger } from "../lib/logger.js";

export type JobProcessor<TInput, TResult> = (
  jobId: string,
  input: TInput,
  updateProgress: (progress: number) => void,
) => Promise<TResult>;

interface QueuedJob<TInput> {
  jobId: string;
  input: TInput;
  resolve: () => void;
}

export class InMemoryQueue<TInput = unknown, TResult = unknown> {
  private readonly name: string;
  private readonly concurrency: number;
  private readonly jobs = new Map<string, JobInfo<TResult>>();
  private readonly pending: QueuedJob<TInput>[] = [];
  private activeCount = 0;
  private processor: JobProcessor<TInput, TResult> | null = null;

  constructor(name: string, concurrency = 2) {
    this.name = name;
    this.concurrency = concurrency;
  }

  /** Register the job processor function */
  process(fn: JobProcessor<TInput, TResult>) {
    this.processor = fn;
  }

  /** Add a job to the queue, returns job info */
  add(input: TInput, dedupeKey?: string): JobInfo<TResult> {
    // Dedupe: return existing job if same key is already queued/processing
    if (dedupeKey) {
      for (const [, job] of this.jobs) {
        if (
          (job as JobInfo<TResult> & { dedupeKey?: string }).dedupeKey === dedupeKey &&
          (job.status === "queued" || job.status === "processing")
        ) {
          logger.info("Dedupe hit — returning existing job", {
            queue: this.name,
            jobId: job.jobId,
          });
          return job;
        }
      }
    }

    const jobId = crypto.randomUUID();
    const now = Date.now();

    const jobInfo: JobInfo<TResult> & { dedupeKey?: string } = {
      jobId,
      status: "queued",
      createdAt: now,
      updatedAt: now,
      dedupeKey,
    };

    this.jobs.set(jobId, jobInfo);

    // Enqueue and try to drain
    const waitPromise = new Promise<void>((resolve) => {
      this.pending.push({ jobId, input, resolve });
    });

    // Fire-and-forget the wait since drain handles execution
    void waitPromise;
    this.drain();

    logger.info("Job queued", { queue: this.name, jobId });
    return jobInfo;
  }

  /** Get job info by ID */
  getJob(jobId: string): JobInfo<TResult> | undefined {
    return this.jobs.get(jobId);
  }

  /** Cancel a queued job (cannot cancel processing jobs) */
  cancel(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== "queued") return false;

    job.status = "canceled";
    job.updatedAt = Date.now();

    // Remove from pending queue
    const idx = this.pending.findIndex((p) => p.jobId === jobId);
    if (idx !== -1) {
      const [removed] = this.pending.splice(idx, 1);
      removed.resolve();
    }

    logger.info("Job canceled", { queue: this.name, jobId });
    return true;
  }

  /** Get queue stats */
  stats() {
    let queued = 0;
    let processing = 0;
    let completed = 0;
    let failed = 0;

    for (const job of this.jobs.values()) {
      switch (job.status) {
        case "queued": queued++; break;
        case "processing": processing++; break;
        case "completed": completed++; break;
        case "failed": failed++; break;
      }
    }

    return { queued, processing, completed, failed, total: this.jobs.size };
  }

  /** Cleanup old completed/failed jobs (keep last N) */
  cleanup(keepLast = 100) {
    const entries = Array.from(this.jobs.entries())
      .filter(([, j]) => j.status === "completed" || j.status === "failed" || j.status === "canceled")
      .sort((a, b) => a[1].updatedAt - b[1].updatedAt);

    const toRemove = entries.slice(0, Math.max(0, entries.length - keepLast));
    for (const [id] of toRemove) {
      this.jobs.delete(id);
    }
  }

  private drain() {
    while (this.activeCount < this.concurrency && this.pending.length > 0) {
      const queued = this.pending.shift();
      if (!queued) break;

      const job = this.jobs.get(queued.jobId);
      if (!job || job.status === "canceled") {
        queued.resolve();
        continue;
      }

      this.activeCount++;
      job.status = "processing";
      job.updatedAt = Date.now();

      void this.executeJob(queued.jobId, queued.input)
        .finally(() => {
          this.activeCount--;
          queued.resolve();
          this.drain();
        });
    }
  }

  private async executeJob(jobId: string, input: TInput) {
    const job = this.jobs.get(jobId);
    if (!job || !this.processor) return;

    const startTime = Date.now();

    try {
      const result = await this.processor(jobId, input, (progress) => {
        job.progress = progress;
        job.updatedAt = Date.now();
      });

      job.status = "completed";
      job.result = result;
      job.progress = 100;
      job.updatedAt = Date.now();

      const durationMs = Date.now() - startTime;
      logger.info("Job completed", { queue: this.name, jobId, durationMs });
    } catch (error) {
      job.status = "failed";
      job.error = error instanceof Error ? error.message : "Unknown error";
      job.updatedAt = Date.now();

      const durationMs = Date.now() - startTime;
      logger.error("Job failed", {
        queue: this.name,
        jobId,
        durationMs,
        error: job.error,
      });
    }

    // Periodic cleanup
    if (this.jobs.size > 200) this.cleanup(100);
  }
}
