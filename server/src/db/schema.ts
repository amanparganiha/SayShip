import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { GeneratedFile, GenerationMode, Plan } from "@shared/schemas";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  /** Null for guest accounts until they upgrade. Format: scrypt$N$r$p$salt$hash */
  passwordHash: text("password_hash"),
  isGuest: boolean("is_guest").notNull().default(false),
  githubLogin: text("github_login"),
  /** AES-256-GCM encrypted OAuth token (see auth/crypto.ts). */
  githubTokenEnc: text("github_token_enc"),
  createdAt: createdAt(),
});

export const sessions = pgTable(
  "sessions",
  {
    /** sha256 of the cookie token; the raw token is never stored. */
    id: text("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const projects = pgTable(
  "projects",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    prompt: text("prompt").notNull(),
    plan: jsonb("plan").$type<Plan>(),
    /** Capability keys for the generated app's data API (preview data vs. published "live" data). */
    previewKey: text("preview_key").notNull().unique(),
    liveKey: text("live_key").notNull().unique(),
    publishedSlug: text("published_slug").unique(),
    publishedVersion: integer("published_version"),
    /** Lease that allows only one generation run per project at a time, across server instances. */
    runLeaseUntil: timestamp("run_lease_until", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("projects_user_idx").on(t.userId)],
);

export const generations = pgTable(
  "generations",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    mode: text("mode").$type<GenerationMode>().notNull(),
    instruction: text("instruction"),
    summary: text("summary"),
    files: jsonb("files").$type<GeneratedFile[]>().notNull(),
    model: text("model"),
    promptTokens: integer("prompt_tokens").notNull().default(0),
    completionTokens: integer("completion_tokens").notNull().default(0),
    durationMs: integer("duration_ms").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("generations_project_version_uq").on(t.projectId, t.version)],
);

export const usageEvents = pgTable(
  "usage_events",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: integer("project_id").references(() => projects.id, { onDelete: "set null" }),
    mode: text("mode").$type<GenerationMode>().notNull(),
    ok: boolean("ok").notNull(),
    promptTokens: integer("prompt_tokens").notNull().default(0),
    completionTokens: integer("completion_tokens").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("usage_user_created_idx").on(t.userId, t.createdAt)],
);

/** Rows stored by generated apps through the per-app data API (`/data/:appKey/:collection`). */
export const appRecords = pgTable(
  "app_records",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    env: text("env").$type<"preview" | "live">().notNull(),
    collection: text("collection").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("app_records_lookup_idx").on(t.projectId, t.env, t.collection, t.id)],
);

export type User = typeof users.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Generation = typeof generations.$inferSelect;
export type AppRecord = typeof appRecords.$inferSelect;
