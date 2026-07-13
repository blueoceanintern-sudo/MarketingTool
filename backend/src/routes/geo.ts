import { Hono } from "hono";
import { searchGeoPlaces } from "../services/geoPlaces";

export const geoRouter = new Hono();

geoRouter.get("/geo/search", async (c) => {
  const q = c.req.query("q") ?? "";
  const country = c.req.query("country") ?? undefined;
  const limitParam = c.req.query("limit");
  const limit = limitParam ? Number(limitParam) : undefined;

  const places = await searchGeoPlaces(q, { countryCode: country, limit });
  const results = places.map((p) => ({
    geoname_id: p.geonameId,
    name: p.name,
    country_code: p.countryCode,
    admin1_name: p.admin1Name,
    feature_code: p.featureCode,
  }));
  return c.json({ results });
});
