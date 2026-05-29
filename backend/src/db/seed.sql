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
  ('Republic Polytechnic', 'education', 'SG', 'https://www.rp.edu.sg', 'cheerio', true, '{}'::json),
  ('TAFE NSW Contact', 'education', 'AU', 'https://www.tafensw.edu.au/contact', 'cheerio', true, '{}'::json),
  ('TAFE Queensland Contact', 'education', 'AU', 'https://tafeqld.edu.au/contact', 'cheerio', true, '{}'::json),
  ('Victoria University Contact', 'education', 'AU', 'https://www.vu.edu.au/contact-us', 'crawl4ai', true, '{}'::json),
  ('RMIT Contact', 'education', 'AU', 'https://www.rmit.edu.au/contact', 'crawl4ai', true, '{}'::json),
  ('University of Newcastle Contact', 'education', 'AU', 'https://www.newcastle.edu.au/contact', 'crawl4ai', true, '{}'::json),
  ('Charles Sturt University Contact', 'education', 'AU', 'https://www.csu.edu.au/contact', 'crawl4ai', true, '{}'::json),
  ('Western Sydney University Contact', 'education', 'AU', 'https://www.westernsydney.edu.au/contactus', 'crawl4ai', true, '{}'::json),
  ('MK Law Melbourne Contact', 'law', 'AU', 'https://www.mklawfirm.com.au/contact/', 'cheerio', true, '{}'::json),
  ('Fitzpatrick Legal Contact', 'law', 'AU', 'https://www.fitzpatricklegal.com.au/contact-us/', 'cheerio', true, '{}'::json),
  ('Bateys Law Firm Contact', 'law', 'AU', 'https://www.bateys.com.au/contact-us/', 'cheerio', true, '{}'::json),
  ('Hall Payne Lawyers Contact', 'law', 'AU', 'https://www.hallpayne.com.au/contact/', 'crawl4ai', true, '{}'::json),
  ('Shine Lawyers Contact', 'law', 'AU', 'https://www.shine.com.au/contact-us', 'crawl4ai', true, '{}'::json),
  ('Maurice Blackburn Contact', 'law', 'AU', 'https://www.mauriceblackburn.com.au/contact-us/', 'crawl4ai', true, '{}'::json),
  ('Pertinent Law Contact', 'law', 'SG', 'https://plaw.sg/contact-us/', 'cheerio', true, '{}'::json),
  ('Shenton Law Practice Contact', 'law', 'SG', 'https://shentonlaw.com.sg/contact.html', 'cheerio', true, '{}'::json),
  ('AGP Law Contact', 'law', 'SG', 'https://agp.com.sg/contact/', 'cheerio', true, '{}'::json),
  ('Tan Peng Chin LLC Contact', 'law', 'SG', 'https://www.tpclaw.com.sg/contact-us/', 'cheerio', true, '{}'::json),
  ('Loh Eben Ong LLP Contact', 'law', 'SG', 'https://law.com.sg/contact/', 'cheerio', true, '{}'::json),
  ('Yuen Law Contact', 'law', 'SG', 'https://yuenlaw.com.sg/', 'crawl4ai', true, '{}'::json),
  ('Infinitus Law Contact', 'law', 'SG', 'https://infinituslaw.com.sg/contact/', 'cheerio', true, '{}'::json),
  ('Farallon Law Contact', 'law', 'SG', 'https://fl.sg/contact-us/', 'cheerio', true, '{}'::json),
  ('Quantum Law Contact', 'law', 'SG', 'https://www.quantumlawcorp.com/contact/', 'cheerio', true, '{}'::json),
  ('Zenith Law Corporation Contact', 'law', 'SG', 'https://zenithlawcorporation.com/contact-us/', 'cheerio', true, '{}'::json),
  ('M and A Law Corporation Contact', 'law', 'SG', 'https://www.mnalawcorp.com/', 'crawl4ai', true, '{}'::json),
  ('HTA Partners Contact', 'law', 'SG', 'https://www.htapartners.com.sg/contacts/', 'cheerio', true, '{}'::json)
ON CONFLICT (url) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Default prompt template — drafting service needs at least one active row to
-- function. Users add new style variants from the /templates admin page.
-- ---------------------------------------------------------------------------
INSERT INTO prompt_templates (name, description, system_prompt, weight, active, created_by)
SELECT
  'Direct & punchy',
  'Short, peer-to-peer cold email. Anchors on one campaign pain point, ends with a clear ask.',
  'You are an expert B2B cold email writer. Given a lead and a campaign context, write a short personalised outreach email.

Rules:
- Maximum 125 words in the email body
- Subject line: under 10 words, no clickbait
- Personalise the tone to the lead''s role (e.g. peer-to-peer for engineers, outcome-driven for executives)
- Use only the lead fields and campaign context provided — never invent details
- If a campaign call-to-action is provided, end the email with that CTA in spirit (rephrase only for natural flow); otherwise fall back to a short call or 15-min chat
- If campaign pain points are provided, anchor the message in ONE of them — the one most relevant to the lead''s role
- No unsubscribe links (added by sender service)
- No pricing, no free trial offers

Respond in this exact JSON format:
{
  "subject": "...",
  "body": "...",
  "confidenceScore": <integer 0-100>
}

confidenceScore reflects how well the email fits the lead and campaign context (100 = perfect fit; low = missing key lead fields OR no campaign context to anchor the message).',
  1,
  true,
  'system'
WHERE NOT EXISTS (SELECT 1 FROM prompt_templates);
