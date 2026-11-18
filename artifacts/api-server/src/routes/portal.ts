import { Router, type NextFunction, type Request, type Response } from "express";
import { type Db, type Filter } from "mongodb";
import { createHash, timingSafeEqual } from "node:crypto";
import {
  CreateAdminClientBody,
  CreateAdminServiceBody,
  CreateAdminServicePlanBody,
  CreateAdminUpdateBody,
  CreateServiceTypeBody,
  ClearAdminServiceAssignmentsResponse,
  CreateAdminServicePlanResponse,
  ListPublicClientsResponse,
  ListAdminServiceCatalogResponse,
  LookupPublicClientAccountBody,
  LookupPublicClientAccountResponse,
  UpdateAdminClientBody,
  UpdateAdminServiceBody,
  UpdateAdminServicePlanBody,
  UpdateAdminServicePlanResponse,
  UpdateAdminUpdateBody,
  UpdateClientProfileBody,
  UpdateServiceTypeBody,
} from "@workspace/api-zod";
import {
  mongoCollection,
  mongoDb,
  newId,
  signAdminSession,
  verifyAdminSession,
  type MongoClientRecord,
  type MongoSharedService,
  type MongoService,
  type MongoServiceType,
  type MongoUpdate,
} from "../lib/mongo";
import { logger } from "../lib/logger";

const router = Router();
const ADMIN_COOKIE = "nutterx_admin_session";
type PortalRole = "admin" | "client";
type PortalUserContext = {
  id: string;
  clerkId: string;
  name: string;
  email: string;
  role: PortalRole;
  clientId: string | null;
};
type AuthedRequest = Request & { portalUser?: PortalUserContext };

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
  return typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}

function statusFor(endDate: string): "active" | "expiring_soon" | "expired" {
  const days = daysUntil(endDate);
  if (days < 0) return "expired";
  if (days <= 7) return "expiring_soon";
  return "active";
}

function normalizeServiceName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en");
}

function makeSharedServiceId(serviceName: string, endDate: string): string {
  const key = `${normalizeServiceName(serviceName)}\u0000${endDate}`;
  return `shared_${createHash("sha256").update(key).digest("hex")}`;
}

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: number }).code === 11000;
}

let sharedServiceMigration: Promise<void> | null = null;

async function migrateLegacyServices(db: Db): Promise<void> {
  const assignments = mongoCollection<MongoService>(db, "services");
  const plans = mongoCollection<MongoSharedService>(db, "service_catalog");
  await plans.createIndex({ normalizedName: 1, endDate: 1 }, { unique: true, name: "unique_shared_service_expiry" });
  const legacyRows = await assignments.find({ sharedServiceId: { $exists: false } }).toArray();
  const groups = new Map<string, { serviceName: string; normalizedName: string; endDate: string; ids: string[] }>();

  for (const row of legacyRows) {
    const serviceName = row.serviceName?.trim().replace(/\s+/g, " ");
    if (!serviceName || !row.endDate) continue;
    const endDate = dateForDb(row.endDate);
    const normalizedName = normalizeServiceName(serviceName);
    const key = `${normalizedName}\u0000${endDate}`;
    const group = groups.get(key) ?? { serviceName, normalizedName, endDate, ids: [] };
    group.ids.push(row._id);
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    const existing = await plans.findOne({ normalizedName: group.normalizedName, endDate: group.endDate });
    const id = existing?._id ?? makeSharedServiceId(group.serviceName, group.endDate);
    const now = new Date();
    try {
      await plans.updateOne(
        { _id: id },
        {
          $setOnInsert: {
            serviceName: group.serviceName,
            normalizedName: group.normalizedName,
            endDate: group.endDate,
            createdAt: now,
            updatedAt: now,
          },
        },
        { upsert: true },
      );
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
    }
    await assignments.updateMany(
      { _id: { $in: group.ids }, sharedServiceId: { $exists: false } },
      { $set: { sharedServiceId: id } },
    );
  }
}

async function ensureSharedServiceMigration(db: Db): Promise<void> {
  if (!sharedServiceMigration) {
    sharedServiceMigration = migrateLegacyServices(db).catch((error: unknown) => {
      sharedServiceMigration = null;
      throw error;
    });
  }
  await sharedServiceMigration;
}

function serializeSharedService(row: MongoSharedService, assignedClientCount: number) {
  const remaining = daysUntil(row.endDate);
  return {
    id: row._id,
    serviceName: row.serviceName,
    endDate: row.endDate,
    status: statusFor(row.endDate),
    daysRemaining: remaining < 0 ? null : remaining,
    assignedClientCount,
  };
}

function serializeClient(row: MongoClientRecord, serviceCount: number) {
  return {
    id: row._id,
    clientId: row.clientId,
    fullName: row.fullName,
    phone: row.phone,
    email: row.email,
    location: row.location,
    notes: row.notes,
    status: row.status,
    registeredAt: row.registeredAt.toISOString(),
    serviceCount,
  };
}

function serializeUpdate(row: MongoUpdate) {
  return {
    id: row._id,
    slug: row.slug,
    title: row.title,
    content: row.content,
    imageUrl: row.imageUrl,
    linkUrl: row.linkUrl,
    visibility: row.visibility,
    publishStatus: row.publishStatus,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function serviceRows(filter: Filter<MongoService> = {}) {
  const db = await mongoDb();
  await ensureSharedServiceMigration(db);
  const [services, clients, types, plans] = await Promise.all([
    mongoCollection<MongoService>(db, "services").find(filter).sort({ endDate: 1 }).toArray(),
    mongoCollection<MongoClientRecord>(db, "clients").find({}).toArray(),
    mongoCollection<MongoServiceType>(db, "service_types").find({}).toArray(),
    mongoCollection<MongoSharedService>(db, "service_catalog").find({}).toArray(),
  ]);
  const clientsById = new Map(clients.map((client) => [client._id, client]));
  const typesById = new Map(types.map((type) => [type._id, type]));
  const plansById = new Map(plans.map((plan) => [plan._id, plan]));
  return services.map((service) => {
    const plan = service.sharedServiceId ? plansById.get(service.sharedServiceId) : undefined;
    const endDate = plan?.endDate ?? service.endDate ?? todayEAT();
    const daysRemaining = daysUntil(endDate);
    return {
      id: service._id,
      clientId: service.clientId,
      sharedServiceId: service.sharedServiceId ?? "",
      clientName: clientsById.get(service.clientId)?.fullName ?? "Unknown client",
      serviceTypeId: service.serviceTypeId ?? "",
      serviceTypeName: service.serviceTypeId ? typesById.get(service.serviceTypeId)?.name ?? "Other" : "",
      serviceName: plan?.serviceName ?? service.serviceName ?? "Service",
      startDate: service.startDate ?? todayEAT(),
      endDate,
      price: service.price ?? null,
      status: statusFor(endDate),
      daysRemaining: daysRemaining < 0 ? null : daysRemaining,
      notes: service.notes ?? null,
    };
  });
}

async function countsByClient() {
  const db = await mongoDb();
  const rows = await mongoCollection<MongoService>(db, "services").find({}).toArray();
  const counts = new Map<string, number>();
  for (const service of rows) counts.set(service.clientId, (counts.get(service.clientId) ?? 0) + 1);
  return counts;
}

function adminContext(req: Request): PortalUserContext | null {
  const session = verifyAdminSession(req.cookies?.[ADMIN_COOKIE]);
  if (!session) return null;
  return { id: "admin", clerkId: "admin", name: "Nutterx Administrator", email: "Administrator", role: "admin", clientId: null };
}

function requireUser(req: Request, res: Response, next: NextFunction) {
  const user = adminContext(req);
  if (!user) {
    res.status(401).json({ error: "Administrator login required" });
    return;
  }
  (req as AuthedRequest).portalUser = user;
  next();
}

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if ((req as AuthedRequest).portalUser?.role !== "admin") {
    res.status(403).json({ error: "Administrator access required" });
    return;
  }
  next();
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const publicLookupFailures = new Map<string, { count: number; resetAt: number }>();

function normalizeClientName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en");
}

function normalizeClientPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.startsWith("254") ? `0${digits.slice(3)}` : digits;
}

function publicLookupKey(ip: string, fullName: string): string {
  return `${ip}:${normalizeClientName(fullName)}`;
}

router.post("/admin/login", (req, res) => {
  const ip = req.ip || "unknown";
  const current = loginAttempts.get(ip);
  const now = Date.now();
  if (current && current.resetAt > now && current.count >= 6) {
    res.status(429).json({ error: "Too many attempts. Try again in 15 minutes." });
    return;
  }
  const key = typeof req.body?.key === "string" ? req.body.key : "";
  const expectedKey = process.env.NUTTERX_ADMIN_PASSWORD ?? "";
  if (!expectedKey || !safeEqual(key, expectedKey)) {
    loginAttempts.set(ip, current && current.resetAt > now ? { ...current, count: current.count + 1 } : { count: 1, resetAt: now + 15 * 60 * 1000 });
    res.status(401).json({ error: "Invalid administrator key" });
    return;
  }
  loginAttempts.delete(ip);
  const expiresAt = Date.now() + 8 * 60 * 60 * 1000;
  res.cookie(ADMIN_COOKIE, signAdminSession("admin", expiresAt), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 8 * 60 * 60 * 1000,
  });
  res.json({ id: "admin", role: "admin", name: "Nutterx Administrator", email: "Administrator", clientId: null });
});

router.get("/public/clients", async (_req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    const db = await mongoDb();
    const clients = await mongoCollection<MongoClientRecord>(db, "clients")
      .find({ status: "active" }, { projection: { fullName: 1, _id: 0 } })
      .sort({ fullName: 1 })
      .toArray();
    res.json(ListPublicClientsResponse.parse(clients.map((client) => ({ name: client.fullName }))));
  } catch (error) {
    logger.error({ err: error }, "Unable to list public active clients");
    res.status(503).json({ error: "Active client list is temporarily unavailable" });
  }
});

router.post("/public/client-account", async (req, res): Promise<void> => {
  res.set("Cache-Control", "private, no-store");
  const parsed = LookupPublicClientAccountBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter the selected name and registered phone number." });
    return;
  }

  const fullName = parsed.data.fullName.trim().replace(/\s+/g, " ");
  const phone = normalizeClientPhone(parsed.data.phone);
  if (!/^\d{7,15}$/.test(phone)) {
    res.status(400).json({ error: "Enter the selected name and registered phone number." });
    return;
  }

  const key = publicLookupKey(req.ip || "unknown", fullName);
  const now = Date.now();
  const failures = publicLookupFailures.get(key);
  if (failures && failures.resetAt > now && failures.count >= 8) {
    res.status(429).json({ error: "Too many attempts. Try again in 15 minutes." });
    return;
  }

  try {
    const db = await mongoDb();
    const clients = await mongoCollection<MongoClientRecord>(db, "clients")
      .find({ status: "active" }, { projection: { fullName: 1, phone: 1 } })
      .toArray();
    const client = clients.find((candidate) =>
      normalizeClientName(candidate.fullName) === normalizeClientName(fullName) &&
      normalizeClientPhone(candidate.phone) === phone
    );

    if (!client) {
      const current = publicLookupFailures.get(key);
      publicLookupFailures.set(
        key,
        current && current.resetAt > now
          ? { ...current, count: current.count + 1 }
          : { count: 1, resetAt: now + 15 * 60 * 1000 },
      );
      res.status(401).json({ error: "We could not verify those account details." });
      return;
    }

    publicLookupFailures.delete(key);
    const services = await serviceRows({ clientId: client._id });
    res.json(LookupPublicClientAccountResponse.parse({
      fullName: client.fullName,
      services: services.map((service) => ({
        serviceName: service.serviceName,
        startDate: service.startDate,
        endDate: service.endDate,
        amountPaid: service.price,
        status: service.status,
        daysRemaining: service.daysRemaining,
      })),
    }));
  } catch (error) {
    logger.error({ err: error }, "Unable to verify public client account");
    res.status(503).json({ error: "Account details are temporarily unavailable." });
  }
});

router.get("/admin/session", (req, res) => {
  const user = adminContext(req);
  if (!user) {
    res.status(401).json({ error: "Administrator login required" });
    return;
  }
  res.json({ id: user.clerkId, role: user.role, name: user.name, email: user.email, clientId: null });
});

router.post("/admin/logout", (req, res) => {
  res.clearCookie(ADMIN_COOKIE);
  res.status(204).send();
});

router.get("/auth/me", requireUser, (req, res) => {
  const user = (req as AuthedRequest).portalUser!;
  res.json({ id: user.clerkId, role: user.role, name: user.name, email: user.email, clientId: user.clientId });
});

router.get("/admin/summary", requireUser, requireAdmin, async (_req, res) => {
  try {
    const db = await mongoDb();
    const [clients, services, updates] = await Promise.all([
      mongoCollection<MongoClientRecord>(db, "clients").find({}).toArray(),
      serviceRows(),
      mongoCollection<MongoUpdate>(db, "updates").find({}).sort({ createdAt: -1 }).limit(5).toArray(),
    ]);
    const attentionItems = services.filter((service) => service.status !== "active").sort((a, b) => (a.daysRemaining ?? -999) - (b.daysRemaining ?? -999)).slice(0, 8).map((service) => ({
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
    const db = await mongoDb();
    const search = typeof req.query.search === "string" ? req.query.search.trim().toLowerCase() : "";
    const status = typeof req.query.status === "string" ? req.query.status : "";
    const serviceTypeId = typeof req.query.serviceTypeId === "string" ? req.query.serviceTypeId : "";
    let clients = await mongoCollection<MongoClientRecord>(db, "clients").find({}).sort({ fullName: 1 }).toArray();
    if (search) clients = clients.filter((client) => [client.fullName, client.phone, client.email, client.clientId].some((field) => field.toLowerCase().includes(search)));
    if (status === "active" || status === "inactive") clients = clients.filter((client) => client.status === status);
    const serviceFilter: Filter<MongoService> = serviceTypeId ? { serviceTypeId } : {};
    if (status === "expiring_soon" || status === "expired") {
      const rows = await serviceRows(serviceFilter);
      const ids = new Set(rows.filter((service) => service.status === status).map((service) => service.clientId));
      clients = clients.filter((client) => ids.has(client._id));
    } else if (serviceTypeId) {
      const rows = await serviceRows(serviceFilter);
      const ids = new Set(rows.map((service) => service.clientId));
      clients = clients.filter((client) => ids.has(client._id));
    }
    const counts = await countsByClient();
    res.json(clients.map((client) => serializeClient(client, counts.get(client._id) ?? 0)));
  } catch (error) {
    logger.error({ err: error }, "Unable to list clients");
    res.status(500).json({ error: "Unable to list clients" });
  }
});

router.post("/admin/clients", requireUser, requireAdmin, async (req, res) => {
  try {
    const body = CreateAdminClientBody.parse(req.body);
    const db = await mongoDb();
    await ensureSharedServiceMigration(db);
    const plan = await mongoCollection<MongoSharedService>(db, "service_catalog").findOne({ _id: body.sharedServiceId });
    if (!plan) {
      res.status(404).json({ error: "Shared service not found" });
      return;
    }
    const id = newId();
    const client: MongoClientRecord = {
      _id: id, clientId: `NX-${id.slice(0, 8).toUpperCase()}`, fullName: body.fullName, phone: body.phone, email: "",
      location: null, notes: null, status: "active", registeredAt: new Date(),
    };
    const service: MongoService = {
      _id: newId(), clientId: id, sharedServiceId: plan._id, serviceTypeId: "",
      startDate: todayEAT(), price: body.amountPaid, notes: null,
    };
    await mongoCollection<MongoClientRecord>(db, "clients").insertOne(client);
    try {
      await mongoCollection<MongoService>(db, "services").insertOne(service);
    } catch (error) {
      await mongoCollection<MongoClientRecord>(db, "clients").deleteOne({ _id: id });
      throw error;
    }
    res.status(201).json(serializeClient(client, 1));
  } catch (error) {
    logger.error({ err: error }, "Unable to create client");
    res.status(400).json({ error: "Unable to create client" });
  }
});

router.get("/admin/clients/:id", requireUser, requireAdmin, async (req, res) => {
  try {
    const db = await mongoDb();
    const client = await mongoCollection<MongoClientRecord>(db, "clients").findOne({ _id: req.params.id });
    if (!client) {
      res.status(404).json({ error: "Client not found" });
      return;
    }
    const services = await serviceRows({ clientId: req.params.id });
    res.json({ ...serializeClient(client, services.length), services });
  } catch (error) {
    logger.error({ err: error }, "Unable to load client detail");
    res.status(500).json({ error: "Unable to load client" });
  }
});

router.patch("/admin/clients/:id", requireUser, requireAdmin, async (req, res) => {
  try {
    const body = UpdateAdminClientBody.parse(req.body);
    const db = await mongoDb();
    const result = await mongoCollection<MongoClientRecord>(db, "clients").findOneAndUpdate({ _id: req.params.id }, { $set: body }, { returnDocument: "after" });
    if (!result) {
      res.status(404).json({ error: "Client not found" });
      return;
    }
    const counts = await countsByClient();
    res.json(serializeClient(result, counts.get(result._id) ?? 0));
  } catch (error) {
    logger.error({ err: error }, "Unable to update client");
    res.status(400).json({ error: "Unable to update client" });
  }
});

router.delete("/admin/clients/:id", requireUser, requireAdmin, async (req, res) => {
  try {
    const db = await mongoDb();
    await Promise.all([
      mongoCollection<MongoService>(db, "services").deleteMany({ clientId: req.params.id }),
      mongoCollection<MongoClientRecord>(db, "clients").deleteOne({ _id: req.params.id }),
    ]);
    res.status(204).send();
  } catch (error) {
    logger.error({ err: error }, "Unable to delete client");
    res.status(400).json({ error: "Unable to delete client" });
  }
});

router.get("/admin/service-catalog", requireUser, requireAdmin, async (_req, res) => {
  try {
    const db = await mongoDb();
    await ensureSharedServiceMigration(db);
    const [plans, assignments] = await Promise.all([
      mongoCollection<MongoSharedService>(db, "service_catalog").find({}).sort({ serviceName: 1, endDate: 1 }).toArray(),
      mongoCollection<MongoService>(db, "services").find({ sharedServiceId: { $exists: true } }, { projection: { clientId: 1, sharedServiceId: 1 } }).toArray(),
    ]);
    const clientsByPlan = new Map<string, Set<string>>();
    for (const assignment of assignments) {
      const planId = assignment.sharedServiceId;
      if (!planId) continue;
      const clientIds = clientsByPlan.get(planId) ?? new Set<string>();
      clientIds.add(assignment.clientId);
      clientsByPlan.set(planId, clientIds);
    }
    res.json(ListAdminServiceCatalogResponse.parse(plans.map((plan) => serializeSharedService(plan, clientsByPlan.get(plan._id)?.size ?? 0))));
  } catch (error) {
    logger.error({ err: error }, "Unable to list shared services");
    res.status(500).json({ error: "Unable to list shared services" });
  }
});

router.post("/admin/service-catalog", requireUser, requireAdmin, async (req, res) => {
  try {
    const body = CreateAdminServicePlanBody.parse(req.body);
    const serviceName = body.serviceName.trim().replace(/\s+/g, " ");
    if (serviceName.length < 2) {
      res.status(400).json({ error: "Service name must contain at least two characters" });
      return;
    }
    const normalizedName = normalizeServiceName(serviceName);
    const endDate = dateForDb(body.endDate);
    const db = await mongoDb();
    await ensureSharedServiceMigration(db);
    const plans = mongoCollection<MongoSharedService>(db, "service_catalog");
    const existing = await plans.findOne({ normalizedName, endDate });
    if (existing) {
      const assignedClientCount = await mongoCollection<MongoService>(db, "services").distinct("clientId", { sharedServiceId: existing._id }).then((ids) => ids.length);
      res.json(CreateAdminServicePlanResponse.parse(serializeSharedService(existing, assignedClientCount)));
      return;
    }

    const now = new Date();
    const planId = newId();
    try {
      await plans.updateOne(
        { _id: planId },
        { $setOnInsert: { serviceName, normalizedName, endDate, createdAt: now, updatedAt: now } },
        { upsert: true },
      );
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
    }
    const plan = await plans.findOne({ normalizedName, endDate });
    if (!plan) throw new Error("Shared service was not saved");
    res.status(201).json(CreateAdminServicePlanResponse.parse(serializeSharedService(plan, 0)));
  } catch (error) {
    logger.error({ err: error }, "Unable to create shared service");
    res.status(400).json({ error: "Unable to create shared service" });
  }
});

router.patch("/admin/service-catalog/:id", requireUser, requireAdmin, async (req, res) => {
  try {
    const body = UpdateAdminServicePlanBody.parse(req.body);
    const db = await mongoDb();
    await ensureSharedServiceMigration(db);
    const plans = mongoCollection<MongoSharedService>(db, "service_catalog");
    const current = await plans.findOne({ _id: req.params.id });
    if (!current) {
      res.status(404).json({ error: "Shared service not found" });
      return;
    }
    const serviceName = (body.serviceName ?? current.serviceName).trim().replace(/\s+/g, " ");
    if (serviceName.length < 2) {
      res.status(400).json({ error: "Service name must contain at least two characters" });
      return;
    }
    const normalizedName = normalizeServiceName(serviceName);
    const endDate = body.endDate ? dateForDb(body.endDate) : current.endDate;
    const duplicate = await plans.findOne({ _id: { $ne: current._id }, normalizedName, endDate });
    if (duplicate) {
      res.status(409).json({ error: "A shared service with this name and expiry already exists" });
      return;
    }
    let updated: MongoSharedService | null;
    try {
      updated = await plans.findOneAndUpdate(
        { _id: current._id },
        { $set: { serviceName, normalizedName, endDate, updatedAt: new Date() } },
        { returnDocument: "after" },
      );
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        res.status(409).json({ error: "A shared service with this name and expiry already exists" });
        return;
      }
      throw error;
    }
    if (!updated) {
      res.status(404).json({ error: "Shared service not found" });
      return;
    }
    const assignedClientCount = await mongoCollection<MongoService>(db, "services").distinct("clientId", { sharedServiceId: updated._id }).then((ids) => ids.length);
    res.json(UpdateAdminServicePlanResponse.parse(serializeSharedService(updated, assignedClientCount)));
  } catch (error) {
    logger.error({ err: error }, "Unable to update shared service");
    res.status(400).json({ error: "Unable to update shared service" });
  }
});

router.delete("/admin/service-assignments", requireUser, requireAdmin, async (_req, res) => {
  try {
    const db = await mongoDb();
    await ensureSharedServiceMigration(db);
    const result = await mongoCollection<MongoService>(db, "services").deleteMany({});
    res.json(ClearAdminServiceAssignmentsResponse.parse({ removedCount: result.deletedCount }));
  } catch (error) {
    logger.error({ err: error }, "Unable to clear client service assignments");
    res.status(500).json({ error: "Unable to clear client service assignments" });
  }
});

router.get("/admin/services", requireUser, requireAdmin, async (req, res) => {
  try {
    const serviceTypeId = typeof req.query.serviceTypeId === "string" ? req.query.serviceTypeId : "";
    let services = await serviceRows(serviceTypeId ? { serviceTypeId } : {});
    const status = typeof req.query.status === "string" ? req.query.status : "";
    if (["active", "expiring_soon", "expired"].includes(status)) services = services.filter((service) => service.status === status);
    res.json(services);
  } catch (error) {
    logger.error({ err: error }, "Unable to list services");
    res.status(500).json({ error: "Unable to list services" });
  }
});

router.post("/admin/services", requireUser, requireAdmin, async (req, res) => {
  try {
    const body = CreateAdminServiceBody.parse(req.body);
    const db = await mongoDb();
    await ensureSharedServiceMigration(db);
    const [client, plan] = await Promise.all([
      mongoCollection<MongoClientRecord>(db, "clients").findOne({ _id: body.clientId }),
      mongoCollection<MongoSharedService>(db, "service_catalog").findOne({ _id: body.sharedServiceId }),
    ]);
    if (!client || !plan) {
      res.status(404).json({ error: "Client or shared service not found" });
      return;
    }
    const duplicate = await mongoCollection<MongoService>(db, "services").findOne({ clientId: body.clientId, sharedServiceId: body.sharedServiceId });
    if (duplicate) {
      res.status(409).json({ error: "This client already has that shared service" });
      return;
    }
    const service: MongoService = {
      _id: newId(), clientId: body.clientId, sharedServiceId: plan._id, serviceTypeId: "",
      startDate: todayEAT(), price: body.price, notes: null,
    };
    await mongoCollection<MongoService>(db, "services").insertOne(service);
    const [serialized] = await serviceRows({ _id: service._id });
    res.status(201).json(serialized);
  } catch (error) {
    logger.error({ err: error }, "Unable to create service");
    res.status(400).json({ error: "Unable to create service" });
  }
});

router.patch("/admin/services/:id", requireUser, requireAdmin, async (req, res) => {
  try {
    const body = UpdateAdminServiceBody.parse(req.body);
    const db = await mongoDb();
    await ensureSharedServiceMigration(db);
    const assignments = mongoCollection<MongoService>(db, "services");
    const current = await assignments.findOne({ _id: req.params.id });
    if (!current) {
      res.status(404).json({ error: "Service assignment not found" });
      return;
    }
    const updates: Partial<MongoService> = {};
    if (body.sharedServiceId !== undefined) {
      const plan = await mongoCollection<MongoSharedService>(db, "service_catalog").findOne({ _id: body.sharedServiceId });
      if (!plan) {
        res.status(404).json({ error: "Shared service not found" });
        return;
      }
      const duplicate = await assignments.findOne({
        _id: { $ne: current._id },
        clientId: current.clientId,
        sharedServiceId: body.sharedServiceId,
      });
      if (duplicate) {
        res.status(409).json({ error: "This client already has that shared service" });
        return;
      }
      updates.sharedServiceId = body.sharedServiceId;
    }
    if (body.price !== undefined) updates.price = body.price;
    if (body.notes !== undefined) updates.notes = body.notes;
    const result = await mongoCollection<MongoService>(db, "services").findOneAndUpdate({ _id: req.params.id }, { $set: updates }, { returnDocument: "after" });
    if (!result) {
      res.status(404).json({ error: "Service not found" });
      return;
    }
    const [serialized] = await serviceRows({ _id: result._id });
    res.json(serialized);
  } catch (error) {
    logger.error({ err: error }, "Unable to update service");
    res.status(400).json({ error: "Unable to update service" });
  }
});

router.delete("/admin/services/:id", requireUser, requireAdmin, async (req, res) => {
  try {
    const db = await mongoDb();
    await mongoCollection<MongoService>(db, "services").deleteOne({ _id: req.params.id });
    res.status(204).send();
  } catch (error) {
    logger.error({ err: error }, "Unable to delete service");
    res.status(400).json({ error: "Unable to delete service" });
  }
});

router.get("/admin/service-types", requireUser, requireAdmin, async (_req, res) => {
  try {
    const db = await mongoDb();
    const rows = await mongoCollection<MongoServiceType>(db, "service_types").find({}).sort({ name: 1 }).toArray();
    res.json(rows.map((row) => ({ id: row._id, name: row.name, description: row.description, active: row.active })));
  } catch (error) {
    logger.error({ err: error }, "Unable to list service types");
    res.status(500).json({ error: "Unable to list service types" });
  }
});

router.post("/admin/service-types", requireUser, requireAdmin, async (req, res) => {
  try {
    const body = CreateServiceTypeBody.parse(req.body);
    const row: MongoServiceType = { _id: newId(), name: body.name, description: body.description ?? null, active: true };
    const db = await mongoDb();
    await mongoCollection<MongoServiceType>(db, "service_types").insertOne(row);
    res.status(201).json({ id: row._id, name: row.name, description: row.description, active: row.active });
  } catch (error) {
    logger.error({ err: error }, "Unable to create service type");
    res.status(400).json({ error: "Unable to create service type" });
  }
});

router.patch("/admin/service-types/:id", requireUser, requireAdmin, async (req, res) => {
  try {
    const body = UpdateServiceTypeBody.parse(req.body);
    const db = await mongoDb();
    const result = await mongoCollection<MongoServiceType>(db, "service_types").findOneAndUpdate({ _id: req.params.id }, { $set: body }, { returnDocument: "after" });
    if (!result) {
      res.status(404).json({ error: "Service type not found" });
      return;
    }
    res.json({ id: result._id, name: result.name, description: result.description, active: result.active });
  } catch (error) {
    logger.error({ err: error }, "Unable to update service type");
    res.status(400).json({ error: "Unable to update service type" });
  }
});

router.delete("/admin/service-types/:id", requireUser, requireAdmin, async (req, res) => {
  try {
    const db = await mongoDb();
    await mongoCollection<MongoServiceType>(db, "service_types").updateOne({ _id: req.params.id }, { $set: { active: false } });
    res.status(204).send();
  } catch (error) {
    logger.error({ err: error }, "Unable to deactivate service type");
    res.status(400).json({ error: "Unable to deactivate service type" });
  }
});

router.get("/admin/updates", requireUser, requireAdmin, async (_req, res) => {
  try {
    const db = await mongoDb();
    const rows = await mongoCollection<MongoUpdate>(db, "updates").find({}).sort({ updatedAt: -1 }).toArray();
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
    const now = new Date();
    const row: MongoUpdate = {
      _id: newId(), slug: makeSlug(body.title), title: body.title, content: body.content, imageUrl: body.imageUrl ?? null,
      linkUrl: body.linkUrl ?? null, visibility: body.visibility, publishStatus: body.publishStatus,
      publishedAt: body.publishStatus === "published" ? now : null, createdAt: now, updatedAt: now,
    };
    const db = await mongoDb();
    await mongoCollection<MongoUpdate>(db, "updates").insertOne(row);
    res.status(201).json(serializeUpdate(row));
  } catch (error) {
    logger.error({ err: error }, "Unable to create update");
    res.status(400).json({ error: "Unable to create update" });
  }
});

router.patch("/admin/updates/:id", requireUser, requireAdmin, async (req, res) => {
  try {
    const body = UpdateAdminUpdateBody.parse(req.body);
    const db = await mongoDb();
    const updates: Partial<MongoUpdate> = { ...body, updatedAt: new Date() };
    const existing = await mongoCollection<MongoUpdate>(db, "updates").findOne({ _id: req.params.id });
    if (!existing) {
      res.status(404).json({ error: "Update not found" });
      return;
    }
    if (body.publishStatus === "published") updates.publishedAt = existing.publishedAt ?? new Date();
    if (body.publishStatus === "draft") updates.publishedAt = null;
    const row = await mongoCollection<MongoUpdate>(db, "updates").findOneAndUpdate({ _id: req.params.id }, { $set: updates }, { returnDocument: "after" });
    res.json(serializeUpdate(row!));
  } catch (error) {
    logger.error({ err: error }, "Unable to update announcement");
    res.status(400).json({ error: "Unable to update announcement" });
  }
});

router.delete("/admin/updates/:id", requireUser, requireAdmin, async (req, res) => {
  try {
    const db = await mongoDb();
    await mongoCollection<MongoUpdate>(db, "updates").deleteOne({ _id: req.params.id });
    res.status(204).send();
  } catch (error) {
    logger.error({ err: error }, "Unable to delete announcement");
    res.status(400).json({ error: "Unable to delete announcement" });
  }
});

router.get("/updates/:slug", async (req, res) => {
  try {
    const db = await mongoDb();
    const row = await mongoCollection<MongoUpdate>(db, "updates").findOne({ slug: req.params.slug, visibility: "public", publishStatus: "published" });
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
    res.json(await serviceRows({ clientId: user.clientId }));
  } catch (error) {
    logger.error({ err: error }, "Unable to list client services");
    res.status(500).json({ error: "Unable to load services" });
  }
});

router.get("/client/updates", requireUser, async (_req, res) => {
  try {
    const db = await mongoDb();
    const rows = await mongoCollection<MongoUpdate>(db, "updates").find({ publishStatus: "published", visibility: { $in: ["public", "client_only"] } }).sort({ publishedAt: -1 }).toArray();
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
    const db = await mongoDb();
    const client = await mongoCollection<MongoClientRecord>(db, "clients").findOne({ _id: user.clientId });
    if (!client) {
      res.status(404).json({ error: "Client profile not found" });
      return;
    }
    const counts = await countsByClient();
    res.json(serializeClient(client, counts.get(client._id) ?? 0));
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
    const db = await mongoDb();
    const client = await mongoCollection<MongoClientRecord>(db, "clients").findOneAndUpdate({ _id: user.clientId }, { $set: body }, { returnDocument: "after" });
    if (!client) {
      res.status(404).json({ error: "Client profile not found" });
      return;
    }
    const counts = await countsByClient();
    res.json(serializeClient(client, counts.get(client._id) ?? 0));
  } catch (error) {
    logger.error({ err: error }, "Unable to update client profile");
    res.status(400).json({ error: "Unable to update profile" });
  }
});

export default router;