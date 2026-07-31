import { useEffect, useState } from "react";
import { ACTIVITY_CHANNEL, ACTIVITY_COUNTERS, type ActivityCounters } from "@lagekatse/shared";
import type { Session } from "../session";
import { connectModule } from "./provider";

export function useRoomActivity(session: Session): ActivityCounters {
  const [activity, setActivity] = useState<ActivityCounters>({});

  useEffect(() => {
    const conn = connectModule(session.room.id, ACTIVITY_CHANNEL, session.token);
    const counters = conn.doc.getMap(ACTIVITY_COUNTERS);
    const refresh = () => setActivity(counters.toJSON() as ActivityCounters);
    counters.observe(refresh);
    refresh();

    return () => {
      counters.unobserve(refresh);
      conn.destroy();
    };
  }, [session.room.id, session.token]);

  return activity;
}
