import { useEffect, useState } from "react";
import { ACTIVITY_CHANNEL, ACTIVITY_COUNTERS, type ActivityCounters } from "@lagekatse/shared";
import type { Session } from "../session";
import { connectModule } from "./provider";

export interface RoomActivity {
  /** module -> monotonic change counter, as broadcast by the server. */
  counters: ActivityCounters;
  /**
   * True once the initial sync with the server completed. The counters are then
   * the authoritative baseline for a freshly joined client (used to avoid
   * dotting pre-existing activity on first join).
   */
  synced: boolean;
}

export function useRoomActivity(session: Session): RoomActivity {
  const [counters, setCounters] = useState<ActivityCounters>({});
  const [synced, setSynced] = useState(false);

  useEffect(() => {
    setSynced(false);
    const conn = connectModule(session.room.id, ACTIVITY_CHANNEL, session.token);
    const map = conn.doc.getMap(ACTIVITY_COUNTERS);
    const refresh = () => setCounters(map.toJSON() as ActivityCounters);
    map.observe(refresh);
    refresh();

    // Refresh in the same handler so the counters are guaranteed current in the
    // render where `synced` flips true (the baseline reads them there).
    const onSync = (isSynced: boolean) => {
      if (!isSynced) return;
      refresh();
      setSynced(true);
    };
    conn.provider.on("sync", onSync);

    return () => {
      map.unobserve(refresh);
      conn.provider.off("sync", onSync);
      conn.destroy();
    };
  }, [session.room.id, session.token]);

  return { counters, synced };
}
