import type { Config } from "../config";
import { MemoryStore } from "./memory";
import { PostgresStore } from "./postgres";
import type { Store } from "./store";

export async function createStore(config: Config): Promise<Store> {
  const store: Store = config.databaseUrl
    ? new PostgresStore(config.databaseUrl)
    : new MemoryStore();
  await store.init();
  return store;
}

export type { Store, RoomRecord, DocState } from "./store";
