import { searchGeoPlaces, type GeoPlace } from "./api";

export type { GeoPlace };

// Thin debounced wrapper around GET /geo/search — the geo reference table can
// hold thousands of rows, so autocomplete is a real server-side search rather
// than filtering an already-fetched list client-side.
let debounceTimer: ReturnType<typeof setTimeout> | undefined;

export function debouncedSearchGeoPlaces(
  query: string,
  onResult: (places: GeoPlace[]) => void,
  opts?: { countryCode?: string; delayMs?: number },
): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(async () => {
    const places = await searchGeoPlaces(query, opts?.countryCode);
    onResult(places);
  }, opts?.delayMs ?? 200);
}
