/** Provider-agnostic contracts — every fitness integration implements this, not just Hevy. */

export type IntegrationProvider = "hevy";

export interface FitnessIntegration {
  id: string;
  provider: IntegrationProvider;
  status: "connected" | "error" | "disconnected";
  provider_user_id: string | null;
  provider_username: string | null;
  last_synced_at: string | null;
  last_sync_status: string | null;
  last_sync_error: string | null;
}

export interface TestConnectionResult {
  ok: boolean;
  username?: string;
  providerUserId?: string;
  lastWorkoutAt?: string | null;
  /** Always a safe, user-facing message — never the provider's raw error body. */
  error?: string;
}

export interface SyncResult {
  ok: boolean;
  imported: number;
  updated: number;
  deleted: number;
  error?: string;
}

/** What every fitness provider must implement — the rest of the app only sees this. */
export interface FitnessProviderClient {
  testConnection(apiKey: string): Promise<TestConnectionResult>;
}
