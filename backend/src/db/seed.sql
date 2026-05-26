-- Shared dev seed data. Idempotent — safe to run multiple times.
-- Run via:  bun run db:seed   (or: psql $DATABASE_URL -f src/db/seed.sql)
--
-- Keep `vertical` lowercase and `geo` uppercase to match the normalization
-- helpers in src/db/schema/tables.ts.

-- INSERT INTO source_registry (name, vertical, geo, url, scraper_type, active, selectors)
-- VALUES
--   ('ICS Singapore Contact',              'education', 'SG', 'https://www.ics.edu.sg/about-us/contact-us',       'cheerio', true, '{}'::json),
--   ('Astor International School Contact', 'education', 'SG', 'https://www.astor.edu.sg/contact',                 'cheerio', true, '{}'::json),
--   ('Furen International School Contact', 'education', 'SG', 'https://www.fis.edu.sg/moreinfo/contact/',         'cheerio', true, '{}'::json),
--   ('AIS Singapore Contact',              'education', 'SG', 'https://www.ais.com.sg/contact-details/',          'cheerio', true, '{}'::json),
--   ('SJI International Contact',          'education', 'SG', 'https://www.sji-international.com.sg/about/contact-us', 'cheerio', true, '{}'::json),
--   ('TAFE Gippsland Contact',             'education', 'AU', 'https://www.tafegippsland.edu.au/contact',         'cheerio', true, '{}'::json),
--   ('TAFE Directors Australia Contact',   'education', 'AU', 'https://tda.edu.au/about-tda/contact-us/',         'cheerio', true, '{}'::json),
--   ('International Schools Database Singapore', 'education', 'SG', 'https://www.international-schools-database.com/in/singapore', 'cheerio', true, '{}'::json),
--   ('Singapore American School', 'education', 'SG', 'https://www.sas.edu.sg', 'cheerio', true, '{}'::json),
--   ('UWC South East Asia', 'education', 'SG', 'https://www.uwcsea.edu.sg', 'cheerio', true, '{}'::json),
--   ('Tanglin Trust School', 'education', 'SG', 'https://www.tts.edu.sg', 'cheerio', true, '{}'::json),
--   ('Dulwich College Singapore', 'education', 'SG', 'https://www.dulwich-singapore.edu.sg', 'cheerio', true, '{}'::json),
--   ('Stamford American International School', 'education', 'SG', 'https://www.sais.edu.sg', 'cheerio', true, '{}'::json),
--   ('One World International School Singapore', 'education', 'SG', 'https://www.owis.org/sg/', 'cheerio', true, '{}'::json),
--   ('Canadian International School Singapore', 'education', 'SG', 'https://www.cis.edu.sg', 'cheerio', true, '{}'::json),
--   ('National University of Singapore', 'education', 'SG', 'https://www.nus.edu.sg', 'cheerio', true, '{}'::json),
--   ('Nanyang Technological University', 'education', 'SG', 'https://www.ntu.edu.sg', 'cheerio', true, '{}'::json),
--   ('Singapore Management University', 'education', 'SG', 'https://www.smu.edu.sg', 'cheerio', true, '{}'::json),
--   ('Singapore Institute of Technology', 'education', 'SG', 'https://www.singaporetech.edu.sg', 'cheerio', true, '{}'::json),
--   ('SIM Global Education', 'education', 'SG', 'https://www.simge.edu.sg', 'cheerio', true, '{}'::json),
--   ('Singapore Polytechnic', 'education', 'SG', 'https://www.sp.edu.sg', 'cheerio', true, '{}'::json),
--   ('Ngee Ann Polytechnic', 'education', 'SG', 'https://www.np.edu.sg', 'cheerio', true, '{}'::json),
--   ('Temasek Polytechnic', 'education', 'SG', 'https://www.tp.edu.sg', 'cheerio', true, '{}'::json),
--   ('Republic Polytechnic', 'education', 'SG', 'https://www.rp.edu.sg', 'cheerio', true, '{}'::json)
-- ON CONFLICT (url) DO NOTHING;

INSERT INTO source_registry (name, vertical, geo, url, scraper_type, active, selectors)
VALUES
  ('ICS Singapore Contact', 'education', 'SG', 'https://www.ics.edu.sg/about-us/contact-us', 'cheerio', true, '{}'::json),

  ('Astor International School Contact', 'education', 'SG', 'https://www.astor.edu.sg/contact', 'cheerio', true, '{}'::json),

  ('Furen International School Contact', 'education', 'SG', 'https://www.fis.edu.sg/moreinfo/contact/', 'cheerio', true, '{}'::json),

  ('AIS Singapore Contact', 'education', 'SG', 'https://www.ais.com.sg/contact-details/', 'cheerio', true, '{}'::json),

  ('SJI International Contact', 'education', 'SG', 'https://www.sji-international.com.sg/about/contact-us', 'cheerio', true, '{}'::json),

  ('TAFE Gippsland Contact', 'education', 'AU', 'https://www.tafegippsland.edu.au/contact', 'cheerio', true, '{}'::json),

  ('TAFE Directors Australia Contact', 'education', 'AU', 'https://tda.edu.au/about-tda/contact-us/', 'cheerio', true, '{}'::json),

  ('International Schools Database Singapore', 'education', 'SG', 'https://www.international-schools-database.com/in/singapore', 'crawl4ai', true, '{}'::json),

  ('Singapore American School', 'education', 'SG', 'https://www.sas.edu.sg', 'crawl4ai', true, '{}'::json),

  ('UWC South East Asia', 'education', 'SG', 'https://www.uwcsea.edu.sg', 'crawl4ai', true, '{}'::json),

  ('Tanglin Trust School', 'education', 'SG', 'https://www.tts.edu.sg', 'cheerio', true, '{}'::json),

  ('Dulwich College Singapore', 'education', 'SG', 'https://www.dulwich-singapore.edu.sg', 'crawl4ai', true, '{}'::json),

  ('Stamford American International School', 'education', 'SG', 'https://www.sais.edu.sg', 'crawl4ai', true, '{}'::json),

  ('One World International School Singapore', 'education', 'SG', 'https://www.owis.org/sg/', 'crawl4ai', true, '{}'::json),

  ('Canadian International School Singapore', 'education', 'SG', 'https://www.cis.edu.sg', 'crawl4ai', true, '{}'::json),

  ('National University of Singapore', 'education', 'SG', 'https://www.nus.edu.sg', 'crawl4ai', true, '{}'::json),

  ('Nanyang Technological University', 'education', 'SG', 'https://www.ntu.edu.sg', 'crawl4ai', true, '{}'::json),

  ('Singapore Management University', 'education', 'SG', 'https://www.smu.edu.sg', 'crawl4ai', true, '{}'::json),

  ('Singapore Institute of Technology', 'education', 'SG', 'https://www.singaporetech.edu.sg', 'crawl4ai', true, '{}'::json),

  ('SIM Global Education', 'education', 'SG', 'https://www.simge.edu.sg', 'cheerio', true, '{}'::json),

  ('Singapore Polytechnic', 'education', 'SG', 'https://www.sp.edu.sg', 'cheerio', true, '{}'::json),

  ('Ngee Ann Polytechnic', 'education', 'SG', 'https://www.np.edu.sg', 'cheerio', true, '{}'::json),

  ('Temasek Polytechnic', 'education', 'SG', 'https://www.tp.edu.sg', 'cheerio', true, '{}'::json),

  ('Republic Polytechnic', 'education', 'SG', 'https://www.rp.edu.sg', 'cheerio', true, '{}'::json)

ON CONFLICT (url) DO NOTHING;
