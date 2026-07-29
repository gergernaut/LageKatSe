import type { Role, RoomPublic } from "@lagekatse/shared";

/** Everything the client needs after a successful join. */
export interface Session {
  token: string;
  sid: string;
  name: string;
  roles: Role[];
  room: RoomPublic;
}
