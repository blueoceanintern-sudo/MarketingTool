-- ---------------------------------------------------------------------------
-- Test: ACME Corp (fictional, SG / education) + 12 test leads
-- ---------------------------------------------------------------------------

-- Campaign: SG Education
INSERT INTO campaigns (name, vertical, geography, company_size_target, status, description, pain_points, call_to_action)
SELECT
  'SG Education — Staff & Student Knowledge Base',
  'education',
  'SG',
  'medium',
  'active',
  'CompanyBrain sits on top of a school or institution''s internal knowledge — curriculum guides, enrolment procedures, policy FAQs, timetabling, exam schedules — and answers routine staff and student enquiries instantly, without routing every question through admin.',
  ARRAY[
    'Admin staff spend significant time answering repetitive questions from students and parents about enrolment, fees, timetables, and campus policies',
    'Students and staff outside office hours cannot get answers to urgent questions, causing delays in decisions and unnecessary stress',
    'Inconsistent answers across departments or staff members erode trust in institutional communication'
  ],
  'Happy to show you a 15-minute walkthrough using your school''s own knowledge base — worth a look?'
WHERE NOT EXISTS (
  SELECT 1 FROM campaigns WHERE name = 'SG Education — Staff & Student Knowledge Base'
);

-- Company: ACME (fictional, SG, education)
WITH co AS (
  INSERT INTO companies (name, industry, company_size, location, source)
  SELECT 'ACME', 'education', 'medium', 'SG', 'seed'
  WHERE NOT EXISTS (SELECT 1 FROM companies WHERE name = 'ACME')
  RETURNING id
)
SELECT id FROM co; -- no-op select to flush the CTE

-- ---------------------------------------------------------------------------
-- Leads 1–12 — all assigned to ACME + SG Education campaign
-- ---------------------------------------------------------------------------

-- Lead 1: jachinkhoo@gmail.com
WITH
  le AS (
    INSERT INTO leads (company_id, name, email, role, is_verified, email_status, routing)
    SELECT (SELECT id FROM companies WHERE name = 'ACME' LIMIT 1), 'Jachin Khoo', 'jachinkhoo@gmail.com', 'Student', true, 'verified', 'auto_queue'
    WHERE NOT EXISTS (SELECT 1 FROM leads WHERE email = 'jachinkhoo@gmail.com')
    RETURNING id
  ),
  lid AS (SELECT id FROM le UNION ALL SELECT id FROM leads WHERE email = 'jachinkhoo@gmail.com' LIMIT 1)
INSERT INTO campaign_leads (lead_id, campaign_id, source)
SELECT
  (SELECT id FROM lid LIMIT 1),
  (SELECT id FROM campaigns WHERE name = 'SG Education — Staff & Student Knowledge Base' LIMIT 1),
  'seed'
ON CONFLICT DO NOTHING;

-- Lead 2: jachin.khoo.2025@computing.smu.edu.sg
WITH
  le AS (
    INSERT INTO leads (company_id, name, email, role, is_verified, email_status, routing)
    SELECT (SELECT id FROM companies WHERE name = 'ACME' LIMIT 1), 'Jachin Khoo', 'jachin.khoo.2025@computing.smu.edu.sg', 'Student', true, 'verified', 'auto_queue'
    WHERE NOT EXISTS (SELECT 1 FROM leads WHERE email = 'jachin.khoo.2025@computing.smu.edu.sg')
    RETURNING id
  ),
  lid AS (SELECT id FROM le UNION ALL SELECT id FROM leads WHERE email = 'jachin.khoo.2025@computing.smu.edu.sg' LIMIT 1)
INSERT INTO campaign_leads (lead_id, campaign_id, source)
SELECT
  (SELECT id FROM lid LIMIT 1),
  (SELECT id FROM campaigns WHERE name = 'SG Education — Staff & Student Knowledge Base' LIMIT 1),
  'seed'
ON CONFLICT DO NOTHING;

-- Lead 3: j61084603@gmail.com
WITH
  le AS (
    INSERT INTO leads (company_id, name, email, role, is_verified, email_status, routing)
    SELECT (SELECT id FROM companies WHERE name = 'ACME' LIMIT 1), 'Test User', 'j61084603@gmail.com', 'Student', true, 'verified', 'auto_queue'
    WHERE NOT EXISTS (SELECT 1 FROM leads WHERE email = 'j61084603@gmail.com')
    RETURNING id
  ),
  lid AS (SELECT id FROM le UNION ALL SELECT id FROM leads WHERE email = 'j61084603@gmail.com' LIMIT 1)
INSERT INTO campaign_leads (lead_id, campaign_id, source)
SELECT
  (SELECT id FROM lid LIMIT 1),
  (SELECT id FROM campaigns WHERE name = 'SG Education — Staff & Student Knowledge Base' LIMIT 1),
  'seed'
ON CONFLICT DO NOTHING;

-- Lead 4: 2021.jachin.khoo@ejc.edu.sg
WITH
  le AS (
    INSERT INTO leads (company_id, name, email, role, is_verified, email_status, routing)
    SELECT (SELECT id FROM companies WHERE name = 'ACME' LIMIT 1), 'Jachin Khoo', '2021.jachin.khoo@ejc.edu.sg', 'Student', true, 'verified', 'auto_queue'
    WHERE NOT EXISTS (SELECT 1 FROM leads WHERE email = '2021.jachin.khoo@ejc.edu.sg')
    RETURNING id
  ),
  lid AS (SELECT id FROM le UNION ALL SELECT id FROM leads WHERE email = '2021.jachin.khoo@ejc.edu.sg' LIMIT 1)
INSERT INTO campaign_leads (lead_id, campaign_id, source)
SELECT
  (SELECT id FROM lid LIMIT 1),
  (SELECT id FROM campaigns WHERE name = 'SG Education — Staff & Student Knowledge Base' LIMIT 1),
  'seed'
ON CONFLICT DO NOTHING;

-- Lead 5: tori.ng.xc@gmail.com
WITH
  le AS (
    INSERT INTO leads (company_id, name, email, role, is_verified, email_status, routing)
    SELECT (SELECT id FROM companies WHERE name = 'ACME' LIMIT 1), 'Tori Ng', 'tori.ng.xc@gmail.com', 'Staff', true, 'verified', 'auto_queue'
    WHERE NOT EXISTS (SELECT 1 FROM leads WHERE email = 'tori.ng.xc@gmail.com')
    RETURNING id
  ),
  lid AS (SELECT id FROM le UNION ALL SELECT id FROM leads WHERE email = 'tori.ng.xc@gmail.com' LIMIT 1)
INSERT INTO campaign_leads (lead_id, campaign_id, source)
SELECT
  (SELECT id FROM lid LIMIT 1),
  (SELECT id FROM campaigns WHERE name = 'SG Education — Staff & Student Knowledge Base' LIMIT 1),
  'seed'
ON CONFLICT DO NOTHING;

-- Lead 6: wellspring0fhope77@gmail.com
WITH
  le AS (
    INSERT INTO leads (company_id, name, email, role, is_verified, email_status, routing)
    SELECT (SELECT id FROM companies WHERE name = 'ACME' LIMIT 1), 'Test User', 'wellspring0fhope77@gmail.com', 'Staff', true, 'verified', 'auto_queue'
    WHERE NOT EXISTS (SELECT 1 FROM leads WHERE email = 'wellspring0fhope77@gmail.com')
    RETURNING id
  ),
  lid AS (SELECT id FROM le UNION ALL SELECT id FROM leads WHERE email = 'wellspring0fhope77@gmail.com' LIMIT 1)
INSERT INTO campaign_leads (lead_id, campaign_id, source)
SELECT
  (SELECT id FROM lid LIMIT 1),
  (SELECT id FROM campaigns WHERE name = 'SG Education — Staff & Student Knowledge Base' LIMIT 1),
  'seed'
ON CONFLICT DO NOTHING;

-- Lead 7: tori.ng.2023@scis.smu.edu.sg
WITH
  le AS (
    INSERT INTO leads (company_id, name, email, role, is_verified, email_status, routing)
    SELECT (SELECT id FROM companies WHERE name = 'ACME' LIMIT 1), 'Tori Ng', 'tori.ng.2023@scis.smu.edu.sg', 'Staff', true, 'verified', 'auto_queue'
    WHERE NOT EXISTS (SELECT 1 FROM leads WHERE email = 'tori.ng.2023@scis.smu.edu.sg')
    RETURNING id
  ),
  lid AS (SELECT id FROM le UNION ALL SELECT id FROM leads WHERE email = 'tori.ng.2023@scis.smu.edu.sg' LIMIT 1)
INSERT INTO campaign_leads (lead_id, campaign_id, source)
SELECT
  (SELECT id FROM lid LIMIT 1),
  (SELECT id FROM campaigns WHERE name = 'SG Education — Staff & Student Knowledge Base' LIMIT 1),
  'seed'
ON CONFLICT DO NOTHING;

-- Lead 8: kiaradesai.2024@gmail.com
WITH
  le AS (
    INSERT INTO leads (company_id, name, email, role, is_verified, email_status, routing)
    SELECT (SELECT id FROM companies WHERE name = 'ACME' LIMIT 1), 'Kiara Desai', 'kiaradesai.2024@gmail.com', 'Admin', true, 'verified', 'auto_queue'
    WHERE NOT EXISTS (SELECT 1 FROM leads WHERE email = 'kiaradesai.2024@gmail.com')
    RETURNING id
  ),
  lid AS (SELECT id FROM le UNION ALL SELECT id FROM leads WHERE email = 'kiaradesai.2024@gmail.com' LIMIT 1)
INSERT INTO campaign_leads (lead_id, campaign_id, source)
SELECT
  (SELECT id FROM lid LIMIT 1),
  (SELECT id FROM campaigns WHERE name = 'SG Education — Staff & Student Knowledge Base' LIMIT 1),
  'seed'
ON CONFLICT DO NOTHING;

-- Lead 9: nikukiaan.2025@gmail.com
WITH
  le AS (
    INSERT INTO leads (company_id, name, email, role, is_verified, email_status, routing)
    SELECT (SELECT id FROM companies WHERE name = 'ACME' LIMIT 1), 'Nikukiaan', 'nikukiaan.2025@gmail.com', 'Student', true, 'verified', 'auto_queue'
    WHERE NOT EXISTS (SELECT 1 FROM leads WHERE email = 'nikukiaan.2025@gmail.com')
    RETURNING id
  ),
  lid AS (SELECT id FROM le UNION ALL SELECT id FROM leads WHERE email = 'nikukiaan.2025@gmail.com' LIMIT 1)
INSERT INTO campaign_leads (lead_id, campaign_id, source)
SELECT
  (SELECT id FROM lid LIMIT 1),
  (SELECT id FROM campaigns WHERE name = 'SG Education — Staff & Student Knowledge Base' LIMIT 1),
  'seed'
ON CONFLICT DO NOTHING;

-- Lead 10: kiara.desai.2024@smu.edu.sg
WITH
  le AS (
    INSERT INTO leads (company_id, name, email, role, is_verified, email_status, routing)
    SELECT (SELECT id FROM companies WHERE name = 'ACME' LIMIT 1), 'Kiara Desai', 'kiara.desai.2024@smu.edu.sg', 'Admin', true, 'verified', 'auto_queue'
    WHERE NOT EXISTS (SELECT 1 FROM leads WHERE email = 'kiara.desai.2024@smu.edu.sg')
    RETURNING id
  ),
  lid AS (SELECT id FROM le UNION ALL SELECT id FROM leads WHERE email = 'kiara.desai.2024@smu.edu.sg' LIMIT 1)
INSERT INTO campaign_leads (lead_id, campaign_id, source)
SELECT
  (SELECT id FROM lid LIMIT 1),
  (SELECT id FROM campaigns WHERE name = 'SG Education — Staff & Student Knowledge Base' LIMIT 1),
  'seed'
ON CONFLICT DO NOTHING;

-- Lead 11: smthsmth224@gmail.com
WITH
  le AS (
    INSERT INTO leads (company_id, name, email, role, is_verified, email_status, routing)
    SELECT (SELECT id FROM companies WHERE name = 'ACME' LIMIT 1), 'Test User', 'smthsmth224@gmail.com', 'Student', true, 'verified', 'auto_queue'
    WHERE NOT EXISTS (SELECT 1 FROM leads WHERE email = 'smthsmth224@gmail.com')
    RETURNING id
  ),
  lid AS (SELECT id FROM le UNION ALL SELECT id FROM leads WHERE email = 'smthsmth224@gmail.com' LIMIT 1)
INSERT INTO campaign_leads (lead_id, campaign_id, source)
SELECT
  (SELECT id FROM lid LIMIT 1),
  (SELECT id FROM campaigns WHERE name = 'SG Education — Staff & Student Knowledge Base' LIMIT 1),
  'seed'
ON CONFLICT DO NOTHING;

-- Lead 12: t05759945@gmail.com
WITH
  le AS (
    INSERT INTO leads (company_id, name, email, role, is_verified, email_status, routing)
    SELECT (SELECT id FROM companies WHERE name = 'ACME' LIMIT 1), 'Test User', 't05759945@gmail.com', 'Student', true, 'verified', 'auto_queue'
    WHERE NOT EXISTS (SELECT 1 FROM leads WHERE email = 't05759945@gmail.com')
    RETURNING id
  ),
  lid AS (SELECT id FROM le UNION ALL SELECT id FROM leads WHERE email = 't05759945@gmail.com' LIMIT 1)
INSERT INTO campaign_leads (lead_id, campaign_id, source)
SELECT
  (SELECT id FROM lid LIMIT 1),
  (SELECT id FROM campaigns WHERE name = 'SG Education — Staff & Student Knowledge Base' LIMIT 1),
  'seed'
ON CONFLICT DO NOTHING;
