import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { canWrite, ROLES } from "@lagekatse/shared";
import { signSession, verifySession } from "./auth";
import type { Config } from "./config";
import { HttpError, RoomService, toPublic } from "./rooms";
import type { RoomHub } from "./sync/room-hub";

const createSchema = z.object({
  name: z
    .string({ error: "Bitte eine Bezeichnung der Lage angeben." })
    .trim()
    .min(1, "Bitte eine Bezeichnung der Lage angeben.")
    .max(120, "Bezeichnung ist zu lang (max. 120 Zeichen)."),
  password: z.string().min(1).max(200, "Raum-Passwort ist zu lang (max. 200 Zeichen).").optional(),
  settings: z.object({ allowMonitorChat: z.boolean() }).partial().optional(),
});

const joinSchema = z.object({
  name: z
    .string({ error: "Bitte einen Anzeigenamen angeben." })
    .trim()
    .min(1, "Bitte einen Anzeigenamen angeben.")
    .max(80, "Anzeigename ist zu lang (max. 80 Zeichen)."),
  roles: z
    .array(z.enum(ROLES), { error: "Bitte mindestens eine Rolle wählen." })
    .min(1, "Bitte mindestens eine Rolle wählen."),
  password: z.string().max(200).optional(),
});

const newEtbEntrySchema = z.object({
  richtung: z.enum(["E", "A", ""]).optional(),
  von: z.string().max(200, "Absender ist zu lang (max. 200 Zeichen).").optional(),
  an: z.string().max(200, "Empfänger ist zu lang (max. 200 Zeichen).").optional(),
  weg: z.enum(["Funk", "Telefon", "Fax", "persönlich", "E-Mail", ""]).optional(),
  inhalt: z.string().max(4000, "Inhalt ist zu lang (max. 4000 Zeichen).").optional(),
  veranlassung: z.string().max(4000, "Veranlassung ist zu lang (max. 4000 Zeichen).").optional(),
});

export function registerRoutes(
  app: FastifyInstance,
  deps: { rooms: RoomService; config: Config; hub: RoomHub },
): void {
  const { rooms, config, hub } = deps;

  app.get("/api/health", async () => ({ ok: true, ts: new Date().toISOString() }));

  app.post("/api/rooms", async (req, reply) => {
    const body = createSchema.parse(req.body);
    const rec = await rooms.create(body);
    return reply.code(201).send({ room: toPublic(rec) });
  });

  app.get<{ Params: { code: string } }>("/api/rooms/:code", async (req, reply) => {
    const rec = await rooms.getByCode(req.params.code);
    if (!rec) {
      return reply.code(404).send({ error: "room_not_found", message: "Kein Stabsraum mit diesem Lobby-Code." });
    }
    return reply.send({ room: toPublic(rec) });
  });

  app.post<{ Params: { code: string } }>("/api/rooms/:code/join", async (req, reply) => {
    const body = joinSchema.parse(req.body);
    const { room, claims } = await rooms.join(req.params.code, body);
    const token = await signSession(claims, config.jwtSecret);
    return reply.send({
      token,
      session: { sid: claims.sid, name: claims.name, roles: claims.roles },
      room: toPublic(room),
    });
  });

  app.post<{ Params: { code: string } }>("/api/rooms/:code/etb/entries", async (req, reply) => {
    const authorization = req.headers.authorization ?? "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
    const claims = await verifySession(token, config.jwtSecret);
    if (!claims) throw new HttpError(401, "unauthorized", "Ungültige oder fehlende Anmeldung.");

    const rec = await rooms.getByCode(req.params.code);
    if (!rec) throw new HttpError(404, "room_not_found", "Kein Stabsraum mit diesem Lobby-Code.");
    if (claims.room !== rec.id) {
      throw new HttpError(403, "room_mismatch", "Die Anmeldung gehört nicht zu diesem Stabsraum.");
    }
    if (
      !canWrite(claims.roles, "etb", {
        allowMonitorChat: rec.settings.allowMonitorChat,
      })
    ) {
      throw new HttpError(403, "forbidden", "Keine Schreibberechtigung für das Einsatztagebuch.");
    }

    const body = newEtbEntrySchema.parse(req.body ?? {});
    const entry = await hub.appendEtbEntry(rec.id, claims.name, body);
    return reply.code(201).send({ entry });
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ error: err.code, message: err.message });
    }
    if (err instanceof z.ZodError) {
      return reply.code(400).send({
        error: "invalid_request",
        message: err.issues.map((i) => i.message).join(" "),
      });
    }
    app.log.error(err);
    return reply.code(500).send({ error: "internal", message: "Interner Serverfehler." });
  });
}
