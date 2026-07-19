export interface Env {
  DATABASE_URL: string;
  // Using untyped DurableObjectNamespace to avoid workers-types brand constraint
  JOB_RUNNER: DurableObjectNamespace;
}

export interface JobSettings {
  concurrency: number;
  timeoutMs: number;
  retryCount: number;
  autoProbe: boolean;
  perHostConcurrency: number;
}
