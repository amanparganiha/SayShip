/** "Habit Tracker Pro!" -> "habit-tracker-pro" */
export function slugify(input: string, maxLength = 40): string {
  const slug = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "");
  return slug || "app";
}
