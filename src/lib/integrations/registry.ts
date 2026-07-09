import { SupabaseClient } from "@supabase/supabase-js";
import { IntegrationProvider, SyncResult, TestConnectionResult } from "./types";
import { syncHevyWorkouts, testHevyConnection } from "./hevy";

/**
 * Provider name → implementation. Adding Garmin/Strava/Whoop later means
 * adding one entry here (plus its own lib/integrations/<name>/ folder) —
 * routes and UI never branch on provider name themselves.
 */
export const integrationRegistry: Record<
  IntegrationProvider,
  {
    testConnection: (apiKey: string) => Promise<TestConnectionResult>;
    sync: (supabase: SupabaseClient, userId: string) => Promise<SyncResult>;
  }
> = {
  hevy: { testConnection: testHevyConnection, sync: syncHevyWorkouts },
};
