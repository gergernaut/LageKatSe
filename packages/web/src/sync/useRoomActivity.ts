import { useEffect, useState } from "react";
import {
  ACTIVITY_CHANNEL,
  ACTIVITY_COUNTERS,
  ACTIVITY_SUMMARIES,
  type ActivityCounters,
  type ActivitySummaries,
} from "@lagekatse/shared";
import type { Session } from "../session";
import { connectModule } from "./provider";

export interface RoomActivity {
  /** module -> monotonic change counter, as broadcast by the server. */
  counters: ActivityCounters;
  /** module -> summary of the latest change, as broadcast by the server. */
  summaries: ActivitySummaries;
  /**
   * True once the initial sync with the server completed. The counters are then
   * the authoritative baseline for a freshly joined client (used to avoid
   * dotting pre-existing activity on first join).
   */
  synced: boolean;
}

export function useRoomActivity(session: Session): RoomActivity {
  const [counters, setCounters] = useState<ActivityCounters>({});
  const [summaries, setSummaries] = useState<ActivitySummaries>({});
  const [synced, setSynced] = useState(false);

  useEffect(() => {
    setSynced(false);
    const conn = connectModule(session.room.id, ACTIVITY_CHANNEL, session.token);
    const counterMap = conn.doc.getMap(ACTIVITY_COUNTERS);
    const summaryMap = conn.doc.getMap(ACTIVITY_SUMMARIES);
    const refreshCounters = () => setCounters(counterMap.toJSON() as ActivityCounters);
    const refreshSummaries = () => setSummaries(summaryMap.toJSON() as ActivitySummaries);
    counterMap.observe(refreshCounters);
    summaryMap.observe(refreshSummaries);
    refreshCounters();
    refreshSummaries();

    // Refresh in the same handler so the counters are guaranteed current in the
    // render where `synced` flips true (the baseline reads them there).
    const onSync = (isSynced: boolean) => {
      if (!isSynced) return;
      refreshCounters();
      refreshSummaries();
      setSynced(true);
    };
    conn.provider.on("sync", onSync);

    return () => {
      counterMap.unobserve(refreshCounters);
      summaryMap.unobserve(refreshSummaries);
      conn.provider.off("sync", onSync);
      conn.destroy();
    };
  }, [session.room.id, session.token]);

  return { counters, summaries, synced };
}
