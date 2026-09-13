import { randomBytes, randomInt } from "node:crypto";

const LOWER_ALNUM = "abcdefghijkmnpqrstuvwxyz23456789"; // no 0/o/1/l to keep ids readable

/** Short, human-friendly random id (e.g. for slugs and guest names). */
export function randomId(length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += LOWER_ALNUM[randomInt(LOWER_ALNUM.length)];
  return out;
}

/** Unguessable capability key (144 bits). */
export function randomKey(prefix: string): string {
  return `${prefix}_${randomBytes(18).toString("base64url")}`;
}

export { slugify } from "@shared/slug";
