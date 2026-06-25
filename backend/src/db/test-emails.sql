-- ---------------------------------------------------------------------------
-- Test: ACME Corp (fictional, SG / education) + 12 leads, no campaign assignment
-- ---------------------------------------------------------------------------

-- Company: ACME (fictional, SG, education)
WITH co AS (
  INSERT INTO companies (name, industry, company_size, location, source)
  SELECT 'ACME', 'education', 'medium', 'Singapore', 'seed'
  WHERE NOT EXISTS (SELECT 1 FROM companies WHERE name = 'ACME')
  RETURNING id
)
SELECT id FROM co;

-- Leads
INSERT INTO leads (company_id, name, email, is_verified, email_status, routing)
SELECT (SELECT id FROM companies WHERE name = 'ACME' LIMIT 1), 'Jachin Khoo', 'jachinkhoo@gmail.com', false, 'pattern_guessed', 'auto_queue'
WHERE NOT EXISTS (SELECT 1 FROM leads WHERE email = 'jachinkhoo@gmail.com');

INSERT INTO leads (company_id, name, email, is_verified, email_status, routing)
SELECT (SELECT id FROM companies WHERE name = 'ACME' LIMIT 1), 'Jachin Foo', 'jachin.khoo.2025@computing.smu.edu.sg', true, 'verified', 'auto_queue'
WHERE NOT EXISTS (SELECT 1 FROM leads WHERE email = 'jachin.khoo.2025@computing.smu.edu.sg');

INSERT INTO leads (company_id, name, email, is_verified, email_status, routing)
SELECT (SELECT id FROM companies WHERE name = 'ACME' LIMIT 1), 'Jachin New', 'j61084603@gmail.com', false, 'pattern_guessed', 'auto_queue'
WHERE NOT EXISTS (SELECT 1 FROM leads WHERE email = 'j61084603@gmail.com');

INSERT INTO leads (company_id, name, email, is_verified, email_status, routing)
SELECT (SELECT id FROM companies WHERE name = 'ACME' LIMIT 1), 'Jachin Khoo', '2021.jachin.khoo@ejc.edu.sg', true, 'verified', 'auto_queue'
WHERE NOT EXISTS (SELECT 1 FROM leads WHERE email = '2021.jachin.khoo@ejc.edu.sg');

INSERT INTO leads (company_id, name, email, is_verified, email_status, routing)
SELECT (SELECT id FROM companies WHERE name = 'ACME' LIMIT 1), 'Tori Ng', 'tori.ng.xc@gmail.com', false, 'pattern_guessed', 'auto_queue'
WHERE NOT EXISTS (SELECT 1 FROM leads WHERE email = 'tori.ng.xc@gmail.com');

INSERT INTO leads (company_id, name, email, is_verified, email_status, routing)
SELECT (SELECT id FROM companies WHERE name = 'ACME' LIMIT 1), 'Hope Wellspring', 'wellspring0fhope77@gmail.com', false, 'pattern_guessed', 'auto_queue'
WHERE NOT EXISTS (SELECT 1 FROM leads WHERE email = 'wellspring0fhope77@gmail.com');

INSERT INTO leads (company_id, name, email, is_verified, email_status, routing)
SELECT (SELECT id FROM companies WHERE name = 'ACME' LIMIT 1), 'Tori Ng', 'tori.ng.2023@scis.smu.edu.sg', true, 'verified', 'auto_queue'
WHERE NOT EXISTS (SELECT 1 FROM leads WHERE email = 'tori.ng.2023@scis.smu.edu.sg');

INSERT INTO leads (company_id, name, email, is_verified, email_status, routing)
SELECT (SELECT id FROM companies WHERE name = 'ACME' LIMIT 1), 'Kiara Desai', 'kiaradesai.2024@gmail.com', false, 'pattern_guessed', 'auto_queue'
WHERE NOT EXISTS (SELECT 1 FROM leads WHERE email = 'kiaradesai.2024@gmail.com');

INSERT INTO leads (company_id, name, email, is_verified, email_status, routing)
SELECT (SELECT id FROM companies WHERE name = 'ACME' LIMIT 1), 'Nikukiaan', 'nikukiaan.2025@gmail.com', false, 'pattern_guessed', 'auto_queue'
WHERE NOT EXISTS (SELECT 1 FROM leads WHERE email = 'nikukiaan.2025@gmail.com');

INSERT INTO leads (company_id, name, email, is_verified, email_status, routing)
SELECT (SELECT id FROM companies WHERE name = 'ACME' LIMIT 1), 'Kiara Desai', 'kiara.desai.2024@smu.edu.sg', true, 'verified', 'auto_queue'
WHERE NOT EXISTS (SELECT 1 FROM leads WHERE email = 'kiara.desai.2024@smu.edu.sg');

INSERT INTO leads (company_id, name, email, is_verified, email_status, routing)
SELECT (SELECT id FROM companies WHERE name = 'ACME' LIMIT 1), 'Twenty Something', 'smthsmth224@gmail.com', false, 'pattern_guessed', 'auto_queue'
WHERE NOT EXISTS (SELECT 1 FROM leads WHERE email = 'smthsmth224@gmail.com');

INSERT INTO leads (company_id, name, email, is_verified, email_status, routing)
SELECT (SELECT id FROM companies WHERE name = 'ACME' LIMIT 1), 'My NRIC', 't05759945@gmail.com', false, 'pattern_guessed', 'auto_queue'
WHERE NOT EXISTS (SELECT 1 FROM leads WHERE email = 't05759945@gmail.com');
