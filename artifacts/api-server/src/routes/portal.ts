import { Router, type NextFunction, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { and, asc, desc, eq, ilike, inArray, or } from "drizzle-orm";
import {
  db,
  clientsTable,
  serviceTypesTable,
  servicesTable,
  updatesTable,
  usersTable,
} from "@workspace/db";
import {
  CreateAdminClientBody,
  CreateAdminServiceBody,
  CreateAdminUpdateBody,
  CreateServiceTypeBody,
  UpdateAdminClientBody,
  UpdateAdminServiceBody,
  UpdateAdminUpdateBody,
  UpdateClientProfileBody,
  UpdateServiceTypeBody,
} from "@workspace/api-zod";
import { logger } from "../lib/logger";

const router = Router();
type AuthedRequest = Request & { portalUser?: PortalUserContext };
type PortalRole = "admin" | "client";
type PortalUserContext = {
  id: number;
  clerkId: string;
  name: string;
  email: string;
  role: PortalRole;
  clientId: number | null;
};

function todayEAT(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function daysUntil(endDate: string): number {
  const today = Date.parse(`${todayEAT()}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  return Math.round((end - today) / 86_400_000);
}

function dateForDb(value: Date | string): string {
  return typeof value === "string" ? value : value.toISOString().slice(0, 10);
}

function statusFor(endDate: string): "active" | "expiring_soon" | "expired" {
  const days = daysUntil(endDate);
  if (days < 0) return "expired";
  if (days <= 7) return "expiring_soon";
  return "active";
}

function serializeService(row: {
  service: typeof servicesTable.$inferSelect;
  client: typeof clientsTable.$inferSelect | null;
  serviceType: typeof serviceTypesTable.$inferSelect | null;
}) {
  const daysRemaining = daysUntil(row.service.endDate);
  return {
    id: String(row.service.id),
    clientId: String(row.service.clientId),
    clientName: row.client?.fullName ?? "Unknown client",
    serviceTypeId: String(row.service.serviceTypeId),
    serviceTypeName: row.serviceType?.name ?? "Other",
    serviceName: row.service.serviceName,
    startDate: row.service.startDate,
    endDate: row.service.endDate,
    price: row.service.price === null ? null : Number(row.service.price),
    status: statusFor(row.service.endDate),
    daysRemaining: daysRemaining < 0 ? null : daysRemaining,
    notes: row.service.notes,
  };
}

function serializeClient(
  row: typeof clientsTable.$inferSelect,
  serviceCount: number,
) {
  return {
    id: String(row.id),
    clientId: row.clientId,
    fullName: row.fullName,
    phone: row.phone,
    email: row.email,
    location: row.location,
    notes: row.notes,
    status: row.status as "active" | "inactive",
    registeredAt: row.registeredAt.toISOString(),
    serviceCount,
  };
}

function serializeUpdate(row: typeof updatesTable.$inferSelect) {
  return {
    id: String(row.id),
    slug: row.slug,
    title: row.title,
    content: row.content,
    imageUrl: row.imageUrl,
    linkUrl: row.linkUrl,
    visibility: row.visibility as "public" | "client_only",
    publishStatus: row.publishStatus as "published" | "draft",
    publishedAt: row.publishedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function findPortalUser(clerkId: string): Promise<PortalUserContext | null> {
  const [row] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId)).limit(1);
  if (!row) return null;
  return {
    id: row.id,
    clerkId: row.clerkId,
    name: row.name,
    email: row.email,
    role: row.role === "admin" ? "admin" : "client",
    clientId: row.clientId,
  };
}

async function ensurePortalUser(req: Request): Promise<PortalUserContext | null> {
  const auth = getAuth(req);
  const clerkId = auth.userId;
  if (!clerkId) return null;
  const existing = await findPortalUser(clerkId);
  if (existing) return existing;

  const claims = (auth.sessionClaims ?? {}) as Record<string, unknown>;
  const email = typeof claims.email === "string" ? claims.email : `${clerkId}@portal.local`;
  const name = typeof claims.name === "string" ? claims.name : "Nutterx user";
  const [matchingClient] = await db
    .select()
    .from(clientsTable)
    .where(eq(clientsTable.email, email))
    .limit(1);
  const [existingUser] = await db.select({ id: usersTable.id }).from(usersTable).limit(1);
  const role: PortalRole = existingUser ? "client" : "admin";
  const [created] = await db
    .insert(usersTable)
    .values({
      clerkId,
      name: matchingClient?.fullName ?? name,
      email,
      role,
      clientId: matchingClient?.id ?? null,
    })
    .returning();
  return {
    id: created.id,
    clerkId: created.clerkId,
    name: created.name,
    email: created.email,
    role,
    clientId: created.clientId,
  };
}

async function requireUser(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await ensurePortalUser(req);
    if (!user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    (req as AuthedRequest).portalUser = user;
    next();
  } catch (error) {
    logger.error({ err: error }, "Unable to resolve portal user");
    res.status(500).json({ error: "Unable to resolve account" });
  }
}

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const user = (req as AuthedRequest).portalUser;
  if (user?.role !== "admin") {
    res.status(403).json({ error: "Administrator access required" });
    return;
  }
  next();
}

async function serviceRows(where?: ReturnType<typeof and>) {
  const query = db
    .select({
      service: servicesTable,
      client: clientsTable,
      serviceType: serviceTypesTable,
    })
    .from(servicesTable)
    .leftJoin(clientsTable, eq(servicesTable.clientId, clientsTable.id))
    .leftJoin(serviceTypesTable, eq(servicesTable.serviceTypeId, serviceTypesTable.id));
  const rows = where ? await query.where(where) : await query;
  return rows.map(serializeService);
}

async function countsByClient() {
  const rows = await db.select({ id: clientsTable.id }).from(clientsTable);
  const counts = new Map<number, number>();
  for (const client of rows) counts.set(client.id, 0);
  const serviceRowsForCount = await db.select({ clientId: servicesTable.clientId }).from(servicesTable);
  for (const row of serviceRowsForCount) counts.set(row.clientId, (counts.get(row.clientId) ?? 0) + 1);
  return counts;
}

router.get("/auth/me", requireUser, (req, res) => {
  const user = (req as AuthedRequest).portalUser!;
  res.json({
    id: user.clerkId,
    role: user.role,
    name: user.name,
    email: user.email,
    clientId: user.clientId === null ? null : String(user.clientId),
  });
});

router.get("/admin/summary", requireUser, requireAdmin, async (_req, res) => {
  try {
    const [clients, services, updates] = await Promise.all([
      db.select().from(clientsTable),
      serviceRows(),
      db.select().from(updatesTable).orderBy(desc(updatesTable.createdAt)).limit(5),
    ]);
    const attentionItems = services
      .filter((service) => service.status !== "active")
      .sort((a, b) => (a.daysRemaining ?? -999) - (b.daysRemaining ?? -999))
      .slice(0, 8)
      .map((service) => ({
        service,
        reason: service.status === "expired" ? "Expired service" : "Expires within 7 days",
      }));
    res.json({
      totalClients: clients.filter((client) => client.status === "active").length,
      activeServices: services.filter((service) => service.status === "active").length,
      expiringSoon: services.filter((service) => service.status === "expiring_soon").length,
      expiredServices: services.filter((service) => service.status === "expired").length,
      attentionItems,
      recentUpdates: updates.map(serializeUpdate),
    });
  } catch (error) {
    logger.error({ err: error }, "Unable to load admin summary");
    res.status(500).json({ error: "Unable to load dashboard summary" });
  }
});

router.get("/admin/clients", requireUser, requireAdmin, async (req, res) => {
  try {
    const query = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const serviceTypeId = typeof req.query.serviceTypeId === "string" ? Number(req.query.serviceTypeId) : undefined;
    let clients = await db.select().from(clientsTable).orderBy(asc(clientsTable.fullName));
    if (query) {
      const lower = query.toLowerCase();
      clients = clients.filter((client) =>
        [client.fullName, client.phone, client.email, client.clientId].some((field) => field.toLowerCase().includes(lower)),
      );
    }
    if (status === "inactive" || status === "active") clients = clients.filter((client) => client.status === status);
    if (status === "expiring_soon" || status === "expired") {
      const serviceRowsForClients = await serviceRows(
        serviceTypeId ? eq(servicesTable.serviceTypeId, serviceTypeId) : undefined,
      );
      const ids = new Set(
        serviceRowsForClients.filter((service) => service.status === status).map((service) => Number(service.clientId)),
      );
      clients = clients.filter((client) => ids.has(client.id));
    } else if (serviceTypeId) {
      const serviceRowsForClients = await serviceRows(eq(servicesTable.serviceTypeId, serviceTypeId));
      const ids = new Set(serviceRowsForClients.map((service) => Number(service.clientId)));
      clients = clients.filter((client) => ids.has(client.id));
    }
    const counts = await countsByClient();
    res.json(clients.map((client) => serializeClient(client, counts.get(client.id) ?? 0)));
  } catch (error) {
    logger.error({ err: error }, "Unable to list clients");
    res.status(500).json({ error: "Unable to list clients" });
  }
});

router.post("/admin/clients", requireUser, requireAdmin, async (req, res) => {
  try {
    const body = CreateAdminClientBody.parse(req.body);
    const [client] = await db
      .insert(clientsTable)
      .values({
        clientId: body.clientId,
        fullName: body.fullName,
        phone: body.phone,
        email: body.email,
        location: body.location ?? null,
        notes: body.notes ?? null,
      })
      .returning();
    res.status(201).json(serializeClient(client, 0));
  } catch (error) {
    logger.error({ err: error }, "Unable to create client");
    res.status(400).json({ error: "Unable to create client" });
  }
});

router.get("/admin/clients/:id", requireUser, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, id)).limit(1);
    if (!client) {
      res.status(404).json({ error: "Client not found" });
      return;
    }
    const services = await serviceRows(eq(servicesTable.clientId, id));
    res.json({ ...serializeClient(client, services.length), services });
  } catch (error) {
    logger.error({ err: error }, "Unable to load client detail");
    res.status(500).json({ error: "Unable to load client" });
  }
});

router.patch("/admin/clients/:id", requireUser, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const body = UpdateAdminClientBody.parse(req.body);
    const [client] = await db
      .update(clientsTable)
      .set(body)
      .where(eq(clientsTable.id, id))
      .returning();
    if (!client) {
      res.status(404).json({ error: "Client not found" });
      return;
    }
    const counts = await countsByClient();
    res.json(serializeClient(client, counts.get(client.id) ?? 0));
  } catch (error) {
    logger.error({ err: error }, "Unable to update client");
    res.status(400).json({ error: "Unable to update client" });
  }
});

router.delete("/admin/clients/:id", requireUser, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    await db.delete(servicesTable).where(eq(servicesTable.clientId, id));
    await db.delete(usersTable).where(eq(usersTable.clientId, id));
    await db.delete(clientsTable).where(eq(clientsTable.id, id));
    res.status(204).send();
  } catch (error) {
    logger.error({ err: error }, "Unable to delete client");
    res.status(400).json({ error: "Unable to delete client" });
  }
});

router.get("/admin/services", requireUser, requireAdmin, async (req, res) => {
  try {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const serviceTypeId = typeof req.query.serviceTypeId === "string" ? Number(req.query.serviceTypeId) : undefined;
    let services = await serviceRows(serviceTypeId ? eq(servicesTable.serviceTypeId, serviceTypeId) : undefined);
    if (status === "active" || status === "expiring_soon" || status === "expired") {
      services = services.filter((service) => service.status === status);
    }
    res.json(services);
  } catch (error) {
    logger.error({ err: error }, "Unable to list services");
    res.status(500).json({ error: "Unable to list services" });
  }
});

router.post("/admin/services", requireUser, requireAdmin, async (req, res) => {
  try {
    const body = CreateAdminServiceBody.parse(req.body);
    const [service] = await db
      .insert(servicesTable)
      .values({
        clientId: Number(body.clientId),
        serviceTypeId: Number(body.serviceTypeId),
        serviceName: body.serviceName,
        startDate: dateForDb(body.startDate),
        endDate: dateForDb(body.endDate),
        price: body.price === null || body.price === undefined ? null : String(body.price),
        notes: body.notes ?? null,
      })
      .returning();
    const [serialized] = await serviceRows(eq(servicesTable.id, service.id));
    res.status(201).json(serialized);
  } catch (error) {
    logger.error({ err: error }, "Unable to create service");
    res.status(400).json({ error: "Unable to create service" });
  }
});

router.patch("/admin/services/:id", requireUser, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const body = UpdateAdminServiceBody.parse(req.body);
    const [service] = await db
      .update(servicesTable)
      .set({
        ...(body.serviceTypeId ? { serviceTypeId: Number(body.serviceTypeId) } : {}),
        ...(body.serviceName ? { serviceName: body.serviceName } : {}),
        ...(body.startDate ? { startDate: dateForDb(body.startDate) } : {}),
        ...(body.endDate ? { endDate: dateForDb(body.endDate) } : {}),
        ...(body.price !== undefined ? { price: body.price === null ? null : String(body.price) } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
      })
      .where(eq(servicesTable.id, id))
      .returning();
    if (!service) {
      res.status(404).json({ error: "Service not found" });
      return;
    }
    const [serialized] = await serviceRows(eq(servicesTable.id, service.id));
    res.json(serialized);
  } catch (error) {
    logger.error({ err: error }, "Unable to update service");
    res.status(400).json({ error: "Unable to update service" });
  }
});

router.delete("/admin/services/:id", requireUser, requireAdmin, async (req, res) => {
  try {
    await db.delete(servicesTable).where(eq(servicesTable.id, Number(req.params.id)));
    res.status(204).send();
  } catch (error) {
    logger.error({ err: error }, "Unable to delete service");
    res.status(400).json({ error: "Unable to delete service" });
  }
});

router.get("/admin/service-types", requireUser, requireAdmin, async (_req, res) => {
  try {
    const rows = await db.select().from(serviceTypesTable).orderBy(asc(serviceTypesTable.name));
    res.json(rows.map((row) => ({ id: String(row.id), name: row.name, description: row.description, active: row.active })));
  } catch (error) {
    logger.error({ err: error }, "Unable to list service types");
    res.status(500).json({ error: "Unable to list service types" });
  }
});

router.post("/admin/service-types", requireUser, requireAdmin, async (req, res) => {
  try {
    const body = CreateServiceTypeBody.parse(req.body);
    const [row] = await db.insert(serviceTypesTable).values(body).returning();
    res.status(201).json({ id: String(row.id), name: row.name, description: row.description, active: row.active });
  } catch (error) {
    logger.error({ err: error }, "Unable to create service type");
    res.status(400).json({ error: "Unable to create service type" });
  }
});

router.patch("/admin/service-types/:id", requireUser, requireAdmin, async (req, res) => {
  try {
    const body = UpdateServiceTypeBody.parse(req.body);
    const [row] = await db.update(serviceTypesTable).set(body).where(eq(serviceTypesTable.id, Number(req.params.id))).returning();
    if (!row) {
      res.status(404).json({ error: "Service type not found" });
      return;
    }
    res.json({ id: String(row.id), name: row.name, description: row.description, active: row.active });
  } catch (error) {
    logger.error({ err: error }, "Unable to update service type");
    res.status(400).json({ error: "Unable to update service type" });
  }
});

router.delete("/admin/service-types/:id", requireUser, requireAdmin, async (req, res) => {
  try {
    await db.update(serviceTypesTable).set({ active: false }).where(eq(serviceTypesTable.id, Number(req.params.id)));
    res.status(204).send();
  } catch (error) {
    logger.error({ err: error }, "Unable to deactivate service type");
    res.status(400).json({ error: "Unable to deactivate service type" });
  }
});

router.get("/admin/updates", requireUser, requireAdmin, async (_req, res) => {
  try {
    const rows = await db.select().from(updatesTable).orderBy(desc(updatesTable.updatedAt));
    res.json(rows.map(serializeUpdate));
  } catch (error) {
    logger.error({ err: error }, "Unable to list updates");
    res.status(500).json({ error: "Unable to list updates" });
  }
});

function makeSlug(title: string): string {
  return `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 42)}-${Math.random().toString(36).slice(2, 8)}`;
}

router.post("/admin/updates", requireUser, requireAdmin, async (req, res) => {
  try {
    const body = CreateAdminUpdateBody.parse(req.body);
    const publishedAt = body.publishStatus === "published" ? new Date() : null;
    const [row] = await db
      .insert(updatesTable)
      .values({ ...body, slug: makeSlug(body.title), publishedAt })
      .returning();
    res.status(201).json(serializeUpdate(row));
  } catch (error) {
    logger.error({ err: error }, "Unable to create update");
    res.status(400).json({ error: "Unable to create update" });
  }
});

router.patch("/admin/updates/:id", requireUser, requireAdmin, async (req, res) => {
  try {
    const body = UpdateAdminUpdateBody.parse(req.body);
    const [existing] = await db.select().from(updatesTable).where(eq(updatesTable.id, Number(req.params.id))).limit(1);
    if (!existing) {
      res.status(404).json({ error: "Update not found" });
      return;
    }
    const [row] = await db
      .update(updatesTable)
      .set({
        ...body,
        publishedAt:
          body.publishStatus === "published"
            ? existing.publishedAt ?? new Date()
            : body.publishStatus === "draft"
              ? null
              : existing.publishedAt,
        updatedAt: new Date(),
      })
      .where(eq(updatesTable.id, existing.id))
      .returning();
    res.json(serializeUpdate(row));
  } catch (error) {
    logger.error({ err: error }, "Unable to update announcement");
    res.status(400).json({ error: "Unable to update announcement" });
  }
});

router.delete("/admin/updates/:id", requireUser, requireAdmin, async (req, res) => {
  try {
    await db.delete(updatesTable).where(eq(updatesTable.id, Number(req.params.id)));
    res.status(204).send();
  } catch (error) {
    logger.error({ err: error }, "Unable to delete announcement");
    res.status(400).json({ error: "Unable to delete announcement" });
  }
});

router.get("/updates/:slug", async (req, res) => {
  try {
    const [row] = await db
      .select()
      .from(updatesTable)
      .where(and(eq(updatesTable.slug, req.params.slug), eq(updatesTable.visibility, "public"), eq(updatesTable.publishStatus, "published")))
      .limit(1);
    if (!row) {
      res.status(404).json({ error: "Update not found" });
      return;
    }
    res.json(serializeUpdate(row));
  } catch (error) {
    logger.error({ err: error }, "Unable to load public update");
    res.status(500).json({ error: "Unable to load update" });
  }
});

router.get("/client/services", requireUser, async (req, res) => {
  try {
    const user = (req as AuthedRequest).portalUser!;
    if (!user.clientId) {
      res.json([]);
      return;
    }
    res.json(await serviceRows(eq(servicesTable.clientId, user.clientId)));
  } catch (error) {
    logger.error({ err: error }, "Unable to list client services");
    res.status(500).json({ error: "Unable to load services" });
  }
});

router.get("/client/updates", requireUser, async (_req, res) => {
  try {
    const rows = await db
      .select()
      .from(updatesTable)
      .where(and(eq(updatesTable.publishStatus, "published"), or(eq(updatesTable.visibility, "public"), eq(updatesTable.visibility, "client_only"))))
      .orderBy(desc(updatesTable.publishedAt));
    res.json(rows.map(serializeUpdate));
  } catch (error) {
    logger.error({ err: error }, "Unable to list client updates");
    res.status(500).json({ error: "Unable to load updates" });
  }
});

router.get("/client/profile", requireUser, async (req, res) => {
  try {
    const user = (req as AuthedRequest).portalUser!;
    if (!user.clientId) {
      res.status(404).json({ error: "Client profile not found" });
      return;
    }
    const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, user.clientId)).limit(1);
    if (!client) {
      res.status(404).json({ error: "Client profile not found" });
      return;
    }
    const counts = await countsByClient();
    res.json(serializeClient(client, counts.get(client.id) ?? 0));
  } catch (error) {
    logger.error({ err: error }, "Unable to load client profile");
    res.status(500).json({ error: "Unable to load profile" });
  }
});

router.patch("/client/profile", requireUser, async (req, res) => {
  try {
    const user = (req as AuthedRequest).portalUser!;
    if (!user.clientId) {
      res.status(404).json({ error: "Client profile not found" });
      return;
    }
    const body = UpdateClientProfileBody.parse(req.body);
    const [client] = await db.update(clientsTable).set(body).where(eq(clientsTable.id, user.clientId)).returning();
    if (!client) {
      res.status(404).json({ error: "Client profile not found" });
      return;
    }
    const counts = await countsByClient();
    res.json(serializeClient(client, counts.get(client.id) ?? 0));
  } catch (error) {
    logger.error({ err: error }, "Unable to update client profile");
    res.status(400).json({ error: "Unable to update profile" });
  }
});

export default router;