import type { Role } from "./roles";

/**
 * One entry in the Stabsraum chat. Stored as plain objects in a Y.Array
 * named "messages" inside the `chat` module document.
 */
export interface ChatMessage {
  id: string;
  authorName: string;
  authorRoles: Role[];
  body: string;
  createdAt: string; // ISO-8601, stamped with server time
}

export const CHAT_ARRAY = "messages" as const;

/**
 * Presence/awareness state each client publishes. Feeds the "who is online"
 * list on the overview page (architecture.md §11).
 */
export interface PresenceState {
  sid: string;
  name: string;
  roles: Role[];
  color: string;
  since: number; // epoch ms
}
