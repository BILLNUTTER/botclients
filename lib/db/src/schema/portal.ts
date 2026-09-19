import {
  boolean,
  date,
  index,
  integer,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const usersTable = pgTable(
  "portal_users",
  {
    id: serial("id").primaryKey(),
    clerkId: text("clerk_id").notNull(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    role: text("role").notNull().default("client"),
    clientId: integer("client_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("portal_users_clerk_id_idx").on(table.clerkId),
    index("portal_users_client_id_idx").on(table.clientId),
  ],
);

export const clientsTable = pgTable(
  "portal_clients",
  {
    id: serial("id").primaryKey(),
    clientId: text("client_id").notNull(),
    fullName: text("full_name").notNull(),
    phone: text("phone").notNull(),
    email: text("email").notNull(),
    location: text("location"),
    notes: text("notes"),
    passwordHash: text("password_hash"),
    status: text("status").notNull().default("active"),
    registeredAt: timestamp("registered_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("portal_clients_client_id_idx").on(table.clientId),
    index("portal_clients_email_idx").on(table.email),
    index("portal_clients_status_idx").on(table.status),
  ],
);

export const serviceTypesTable = pgTable(
  "portal_service_types",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    active: boolean("active").notNull().default(true),
  },
  (table) => [uniqueIndex("portal_service_types_name_idx").on(table.name)],
);

export const servicesTable = pgTable(
  "portal_services",
  {
    id: serial("id").primaryKey(),
    clientId: integer("client_id").notNull(),
    serviceTypeId: integer("service_type_id").notNull(),
    serviceName: text("service_name").notNull(),
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }).notNull(),
    price: numeric("price", { precision: 12, scale: 2 }),
    notes: text("notes"),
  },
  (table) => [
    index("portal_services_client_id_idx").on(table.clientId),
    index("portal_services_service_type_id_idx").on(table.serviceTypeId),
    index("portal_services_end_date_idx").on(table.endDate),
  ],
);

export const updatesTable = pgTable(
  "portal_updates",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    imageUrl: text("image_url"),
    linkUrl: text("link_url"),
    visibility: text("visibility").notNull().default("public"),
    publishStatus: text("publish_status").notNull().default("draft"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("portal_updates_slug_idx").on(table.slug),
    index("portal_updates_publish_status_idx").on(table.publishStatus),
    index("portal_updates_published_at_idx").on(table.publishedAt),
  ],
);

export const insertUserSchema = createInsertSchema(usersTable);
export const insertClientSchema = createInsertSchema(clientsTable);
export const insertServiceTypeSchema = createInsertSchema(serviceTypesTable);
export const insertServiceSchema = createInsertSchema(servicesTable);
export const insertUpdateSchema = createInsertSchema(updatesTable);

export type PortalUser = typeof usersTable.$inferSelect;
export type Client = typeof clientsTable.$inferSelect;
export type ServiceType = typeof serviceTypesTable.$inferSelect;
export type Service = typeof servicesTable.$inferSelect;
export type PortalUpdate = typeof updatesTable.$inferSelect;