import { MongoClient, type Collection, type Db, type Document } from "mongodb";
import crypto from "node:crypto";

export type MongoClientRecord = {
  _id: string;
  clientId: string;
  fullName: string;
  phone: string;
  email: string;
  location: string | null;
  notes: string | null;
  status: "active" | "inactive";
  registeredAt: Date;
};

export type MongoServiceType = {
  _id: string;
  name: string;
  description: string | null;
  active: boolean;
};

export type MongoService = {
  _id: string;
  clientId: string;
  serviceTypeId: string;
  serviceName: string;
  startDate: string;
  endDate: string;
  price: number | null;
  notes: string | null;
};

export type MongoUpdate = {
  _id: string;
  slug: string;
  title: string;
  content: string;
  imageUrl: string | null;
  linkUrl: string | null;
  visibility: "public" | "client_only";
  publishStatus: "published" | "draft";
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

let clientPromise: Promise<MongoClient> | null = null;

export async function mongoDb(): Promise<Db> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not configured");
  if (!clientPromise) {
    clientPromise = new MongoClient(uri, {
      tls: true,
      serverSelectionTimeoutMS: 10_000,
      connectTimeoutMS: 10_000,
    }).connect();
  }
  return (await clientPromise).db();
}

export function mongoCollection<T extends Document>(db: Db, name: string): Collection<T> {
  return db.collection<T>(name);
}

export function newId(): string {
  return crypto.randomUUID();
}

export function signAdminSession(username: string, expiresAt: number): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not configured");
  const payload = `${username}:${expiresAt}`;
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return `${payload}:${signature}`;
}

export function verifyAdminSession(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const parts = value.split(":");
  if (parts.length !== 3) return null;
  const [username, expiresAtText, signature] = parts;
  const expiresAt = Number(expiresAtText);
  if (!username || !Number.isFinite(expiresAt) || expiresAt < Date.now() || !signature) return null;
  const expected = signAdminSession(username, expiresAt);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected.split(":").at(-1) ?? "");
  if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) return null;
  return username;
}