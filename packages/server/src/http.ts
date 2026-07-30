import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ROLES } from "@lagekatse/shared";
import { signSession } from "./auth";
import type { Config } from "./config";
import { HttpError, RoomService, toPublic } from "./rooms";

const createSchema = z.object({
  name: z
    .string({ required_error: "Bitte eine Bezeichnung der Lage angeben." })
    .trim()
    .min(1, "Bitte eine Bezeichnung der Lage angeben.")
    .max(120, "Bezeichnung ist zu lang (max. 120 Zeichen)."),
  password: z.string().min(1).max(200, "Raum-Passwort ist zu lang (max. 200 Zeichen).").optional(),
  settings: z.object({ allowMonitorChat: z.boolean() }).partial().optional(),
});

const joinSchema = z.object({
  name: z
    .string({ required_error: "Bitte einen Anzeigenamen angeben." })
    .trim()
    .min(1, "Bitte einen Anzeigenamen angeben.")
    .max(80, "Anzeigename ist zu lang (max. 80 Zeichen)."),
  roles: z.array(z.enum(ROLES)).min(1, "Bitte mindestens eine Rolle wählen."),
  password: z.string().max(200).optional(),
});

export function registerRoutes(app: FastifyInstance, deps: { rooms: RoomService; config: Config }): void {
  const { rooms, config } = deps;

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
