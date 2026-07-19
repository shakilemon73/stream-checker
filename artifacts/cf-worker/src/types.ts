export interface Env {
  DATABASE_URL: string;
}

export interface JobSettings {
  concurrency: number;
  timeoutMs: number;
  retryCount: number;
  autoProbe: boolean;
  perHostConcurrency: number;
}
