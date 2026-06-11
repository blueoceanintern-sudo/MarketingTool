// Add entries here whenever a common shorthand should resolve to a canonical
// vertical name. The modal shows an inline note whenever an alias fires, so
// users always know what value was actually saved.
const VERTICAL_ALIASES: Record<string, string> = {
  edu: "education",
  tech: "technology"
};

export function resolveVertical(raw: string): { canonical: string; wasAlias: boolean } {
  const lower = raw.trim().toLowerCase();
  const canonical = VERTICAL_ALIASES[lower] ?? lower;
  return { canonical, wasAlias: canonical !== lower };
}
