import { SignJWT, jwtVerify } from "jose";
import { isRole, type Role, type SessionClaims } from "@lagekatse/shared";

const secretBytes = (secret: string) => new TextEncoder().encode(secret);

export async function signSession(claims: SessionClaims, secret: string): Promise<string> {
  return await new SignJWT({
    sid: claims.sid,
    room: claims.room,
    name: claims.name,
    roles: claims.roles,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(secretBytes(secret));
}

export async function verifySession(token: string, secret: string): Promise<SessionClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretBytes(secret));
    const { sid, room, name, roles } = payload as Record<string, unknown>;
    if (typeof sid !== "string" || typeof room !== "string" || typeof name !== "string") return null;
    if (!Array.isArray(roles) || roles.length === 0 || !roles.every(isRole)) return null;
    return { sid, room, name, roles: roles as Role[] };
  } catch {
    return null;
  }
}
