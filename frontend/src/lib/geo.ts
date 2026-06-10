const GEO_ALIASES: Record<string, string> = {
  "AUSTRALIA": "AU",
  "AUS": "AU",
  "SINGAPORE": "SG",
  "SIN": "SG",
  "USA": "US",
  "UNITED STATES": "US",
  "UNITED STATES OF AMERICA": "US",
  "VIETNAM": "VN", 
  "VIET": "VN",
};

export function resolveGeo(geo: string): string {
  const upper = geo.trim().toUpperCase();
  return GEO_ALIASES[upper] ?? upper;
}
