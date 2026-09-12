/** Postgres unique_violation, whether raised directly by pg or wrapped by Drizzle. */
export function isUniqueViolation(err: unknown): boolean {
  const code = (e: unknown) => (typeof e === "object" && e !== null ? (e as { code?: unknown }).code : undefined);
  return code(err) === "23505" || code((err as { cause?: unknown })?.cause) === "23505";
}
