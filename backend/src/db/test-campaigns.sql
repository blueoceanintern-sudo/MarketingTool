
-- ---------------------------------------------------------------------------
-- Dev / test campaigns — three distinct verticals, geos, and personas.
-- ---------------------------------------------------------------------------

-- Standalone-runnable: bootstrap the same 3 target-market geo_places rows as
-- seed.sql (ON CONFLICT-safe) in case this script runs without seed.sql first.
INSERT INTO geo_places (geoname_id, name, ascii_name, country_code, feature_code)
VALUES
  (1880251, 'Singapore', 'Singapore', 'SG', 'PCLI'),
  (2077456, 'Australia', 'Australia', 'AU', 'PCLI'),
  (6252001, 'United States', 'United States', 'US', 'PCLI')
ON CONFLICT (geoname_id) DO NOTHING;

INSERT INTO campaigns (name, vertical, company_size_target, status, description, pain_points, call_to_action)
SELECT
  'AU Healthcare — Patient Enquiry Automation',
  'healthcare',
  'large',
  'active',
  'CompanyBrain sits on top of a hospital or clinic''s patient-facing knowledge base — appointment booking procedures, referral pathways, billing FAQs, specialist wait times — and answers routine patient enquiries instantly, without routing every call through reception or admin staff.',
  ARRAY[
    'Reception staff spend the majority of their shift answering the same patient questions about appointments, referrals, and billing, leaving little capacity for complex patient coordination',
    'After-hours patient enquiries go unanswered until the next morning, causing patients to call back repeatedly or seek care elsewhere',
    'Inconsistent answers from different staff members erode patient trust before they have even attended their first appointment'
  ],
  'Happy to show you a 15-minute walkthrough using your clinic''s own patient information as the knowledge base — worth a look?'
WHERE NOT EXISTS (
  SELECT 1 FROM campaigns WHERE name = 'AU Healthcare — Patient Enquiry Automation'
);

INSERT INTO campaign_geos (campaign_id, geoname_id)
SELECT id, 2077456 FROM campaigns WHERE name = 'AU Healthcare — Patient Enquiry Automation'
ON CONFLICT DO NOTHING;

INSERT INTO campaigns (name, vertical, company_size_target, status, description, pain_points, call_to_action)
SELECT
  'US SaaS — Engineering Team Knowledge Base',
  'technology',
  'medium',
  'active',
  'CompanyBrain indexes a software company''s internal engineering documentation — runbooks, incident post-mortems, architecture decision records, onboarding guides — so engineers get answers instantly without interrupting senior staff or digging through stale Confluence pages.',
  ARRAY[
    'Senior engineers are pulled into the same onboarding and troubleshooting questions repeatedly, draining focus from deep technical work and slowing incident response',
    'Critical operational knowledge lives in the heads of a small number of senior engineers; when they leave or are unavailable, teams stall on decisions that should be routine',
    'New engineers take weeks to become productive because internal documentation is scattered, outdated, and impossible to navigate without asking someone'
  ],
  'Open to a quick demo using a sample runbook or architecture doc from your team?'
WHERE NOT EXISTS (
  SELECT 1 FROM campaigns WHERE name = 'US SaaS — Engineering Team Knowledge Base'
);

INSERT INTO campaign_geos (campaign_id, geoname_id)
SELECT id, 6252001 FROM campaigns WHERE name = 'US SaaS — Engineering Team Knowledge Base'
ON CONFLICT DO NOTHING;

INSERT INTO campaigns (name, vertical, company_size_target, status, description, pain_points, call_to_action)
SELECT
  'SG Hospitality — Guest Services AI',
  'hospitality',
  'medium',
  'active',
  'CompanyBrain sits on top of a hotel or serviced apartment''s guest information — check-in procedures, amenity bookings, dining options, local recommendations, property policies — and answers guest enquiries instantly via chat, reducing pressure on front desk staff during peak periods.',
  ARRAY[
    'Front desk staff spend peak check-in and check-out periods fielding routine guest questions about amenities, dining, and local transport rather than focusing on high-value guest interactions',
    'Guest enquiries submitted via email or messaging apps outside staffed hours receive slow responses, leading to negative reviews that cite poor communication rather than poor service',
    'Inconsistent answers across shifts — particularly around policies for late checkout, booking amendments, and local recommendations — generate avoidable guest complaints'
  ],
  'Worth a 20-minute walkthrough using your property''s own guest information guide?'
WHERE NOT EXISTS (
  SELECT 1 FROM campaigns WHERE name = 'SG Hospitality — Guest Services AI'
);

INSERT INTO campaign_geos (campaign_id, geoname_id)
SELECT id, 1880251 FROM campaigns WHERE name = 'SG Hospitality — Guest Services AI'
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Dev / test leads — one per campaign above.
-- ---------------------------------------------------------------------------

-- Lead 1: AU Healthcare
WITH
  co AS (
    INSERT INTO companies (name, industry, company_size, location, source)
    SELECT 'Melbourne Private Hospital', 'healthcare', 'large', 'Melbourne, AU', 'seed'
    WHERE NOT EXISTS (SELECT 1 FROM companies WHERE name = 'Melbourne Private Hospital')
    RETURNING id
  ),
  cid AS (SELECT id FROM co UNION ALL SELECT id FROM companies WHERE name = 'Melbourne Private Hospital' LIMIT 1),
  le AS (
    INSERT INTO leads (company_id, name, email, role, is_verified, email_status, routing)
    SELECT (SELECT id FROM cid LIMIT 1), 'Rachel Chen', 'rachel.chen@melbprivate.com.au', 'Head of Patient Services', true, 'verified', 'auto_queue'
    WHERE NOT EXISTS (SELECT 1 FROM leads WHERE email = 'rachel.chen@melbprivate.com.au')
    RETURNING id
  ),
  lid AS (SELECT id FROM le UNION ALL SELECT id FROM leads WHERE email = 'rachel.chen@melbprivate.com.au' LIMIT 1)
INSERT INTO campaign_leads (lead_id, campaign_id, source)
SELECT (SELECT id FROM lid LIMIT 1), (SELECT id FROM campaigns WHERE name = 'AU Healthcare — Patient Enquiry Automation' LIMIT 1), 'seed'
ON CONFLICT DO NOTHING;

-- Lead 2: US SaaS
WITH
  co AS (
    INSERT INTO companies (name, industry, company_size, location, source)
    SELECT 'Stackline Technologies', 'technology', 'medium', 'San Francisco, US', 'seed'
    WHERE NOT EXISTS (SELECT 1 FROM companies WHERE name = 'Stackline Technologies')
    RETURNING id
  ),
  cid AS (SELECT id FROM co UNION ALL SELECT id FROM companies WHERE name = 'Stackline Technologies' LIMIT 1),
  le AS (
    INSERT INTO leads (company_id, name, email, role, is_verified, email_status, routing)
    SELECT (SELECT id FROM cid LIMIT 1), 'Marcus Johnson', 'marcus.johnson@stackline.io', 'VP Engineering', true, 'verified', 'auto_queue'
    WHERE NOT EXISTS (SELECT 1 FROM leads WHERE email = 'marcus.johnson@stackline.io')
    RETURNING id
  ),
  lid AS (SELECT id FROM le UNION ALL SELECT id FROM leads WHERE email = 'marcus.johnson@stackline.io' LIMIT 1)
INSERT INTO campaign_leads (lead_id, campaign_id, source)
SELECT (SELECT id FROM lid LIMIT 1), (SELECT id FROM campaigns WHERE name = 'US SaaS — Engineering Team Knowledge Base' LIMIT 1), 'seed'
ON CONFLICT DO NOTHING;

-- Lead 3: SG Hospitality
WITH
  co AS (
    INSERT INTO companies (name, industry, company_size, location, source)
    SELECT 'Marina Bay Suites', 'hospitality', 'medium', 'Singapore', 'seed'
    WHERE NOT EXISTS (SELECT 1 FROM companies WHERE name = 'Marina Bay Suites')
    RETURNING id
  ),
  cid AS (SELECT id FROM co UNION ALL SELECT id FROM companies WHERE name = 'Marina Bay Suites' LIMIT 1),
  le AS (
    INSERT INTO leads (company_id, name, email, role, is_verified, email_status, routing)
    SELECT (SELECT id FROM cid LIMIT 1), 'Priya Nair', 'priya.nair@marinabaysuites.com.sg', 'Director of Guest Experience', true, 'verified', 'auto_queue'
    WHERE NOT EXISTS (SELECT 1 FROM leads WHERE email = 'priya.nair@marinabaysuites.com.sg')
    RETURNING id
  ),
  lid AS (SELECT id FROM le UNION ALL SELECT id FROM leads WHERE email = 'priya.nair@marinabaysuites.com.sg' LIMIT 1)
INSERT INTO campaign_leads (lead_id, campaign_id, source)
SELECT (SELECT id FROM lid LIMIT 1), (SELECT id FROM campaigns WHERE name = 'SG Hospitality — Guest Services AI' LIMIT 1), 'seed'
ON CONFLICT DO NOTHING;

