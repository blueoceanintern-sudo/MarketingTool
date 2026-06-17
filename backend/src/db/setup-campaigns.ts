/**
 * Resets campaigns: deletes all existing campaigns and dependent rows,
 * then creates 3 CompanyBrain campaigns across different verticals and target personas.
 *
 * Usage: bun run src/db/setup-campaigns.ts
 */

import { db, client } from "./index";
import {
  campaigns,
  campaignLeads,
  companies,
  emailDrafts,
  scrapeJobs,
  followUps,
  demos,
  suppressionList,
  campaignLeadExclusions,
  enrichmentRecords,
} from "./schema";

async function main() {
  console.log("[setup] deleting existing campaign data...");

  // Delete dependent rows in FK order (no cascade on most of these)
  await db.delete(demos);
  await db.delete(followUps);
  await db.delete(emailDrafts);
  await db.delete(scrapeJobs);
  // Null out optional campaign FK on enrichment_records rather than deleting records
  await db.update(enrichmentRecords).set({ campaignId: null });
  // These three cascade from campaigns but deleting explicitly is cleaner
  await db.delete(campaignLeadExclusions);
  await db.delete(suppressionList);
  await db.delete(campaignLeads);
  await db.delete(campaigns);

  console.log("  ✓ all existing campaigns and dependent rows removed");

  console.log("[setup] creating 3 new CompanyBrain campaigns...");

  const rows = await db
    .insert(campaigns)
    .values([
      // -----------------------------------------------------------------------
      // Campaign 1 — Education / SG International Schools
      // Persona: Admissions Directors, Head of Admissions
      // Problem: parent enquiry volume buries admissions staff
      // -----------------------------------------------------------------------
      {
        name: "SG International Schools — Parent Enquiry AI",
        vertical: "education",
        geography: "SG",
        companySizeTarget: "medium",
        status: "active",
        description:
          "CompanyBrain sits on top of a school's admissions knowledge base — fees, curriculum, intake timelines, campus visit process — and answers parent enquiries instantly, in plain language, without routing every question through the admissions team.",
        painPoints: [
          "Admissions coordinators spend the majority of their week answering the same parent questions over email and WhatsApp, leaving less time for actual enrolment work",
          "Enquiries sent outside office hours go unanswered for days, and prospective families move on to schools that respond faster",
          "When multiple staff handle parent queries, answers are inconsistent — parents get different information depending on who they reach, which erodes trust before enrolment even begins",
        ],
        callToAction:
          "Open to a 20-minute walkthrough using your school's own admissions content?",
      },

      // -----------------------------------------------------------------------
      // Campaign 2 — Law / AU Law Firms
      // Persona: HR Managers, Office Managers, Managing Partners
      // Problem: associate onboarding and internal knowledge retrieval waste billable hours
      // -----------------------------------------------------------------------
      {
        name: "AU Law Firms — Associate Onboarding & Internal Knowledge",
        vertical: "law",
        geography: "AU",
        companySizeTarget: "medium",
        status: "active",
        description:
          "CompanyBrain indexes a firm's internal documentation — billing codes, matter file protocols, precedents, HR policies — so new associates get answers instantly without pulling senior staff away from billable work.",
        painPoints: [
          "New associates spend weeks navigating unstructured internal documentation before becoming productive, while experienced staff field the same procedural questions repeatedly",
          "Senior lawyers lose billable time answering routine process queries — billing code lookups, file-naming protocols, know-your-client procedures — that don't require their expertise",
          "When a senior partner leaves, institutional knowledge walks out with them; there is no reliable way for the remaining team to recover firm-specific context stored only in individuals",
        ],
        callToAction:
          "Happy to show you a quick demo using a sample matter-management knowledge base — worth 15 minutes?",
      },

      // -----------------------------------------------------------------------
      // Campaign 3 — Corporate HR / SG Companies
      // Persona: HR Directors, People & Culture leads, CHROs
      // Problem: routine employee policy questions consume HR bandwidth at scale
      // -----------------------------------------------------------------------
      {
        name: "SG Corporates — HR Policy Self-Service",
        vertical: "corporate",
        geography: "SG",
        companySizeTarget: "large",
        status: "active",
        description:
          "CompanyBrain sits on top of a company's HR documentation — leave policies, benefits, payroll schedules, reimbursement procedures — and gives employees instant, accurate answers without routing every query to the HR team.",
        painPoints: [
          "HR teams field hundreds of routine employee questions about leave entitlements, benefit claims, and payroll timelines — queries that consume significant bandwidth but require no human judgement",
          "Policy documents are scattered across intranets, email threads, and outdated PDFs; employees cannot find answers independently and escalate to HR even for straightforward queries",
          "Policy updates propagate unevenly — employees continue referencing outdated documentation and HR spends additional time correcting misunderstandings that a single authoritative source would prevent",
        ],
        callToAction:
          "Open to a short demo using your existing HR policy documents as the knowledge base?",
      },
    ])
    .returning({ id: campaigns.id, name: campaigns.name });

  for (const row of rows) {
    console.log(`  ✓ created: "${row.name}" (${row.id})`);
  }

  const [eduCampaign, lawCampaign, hrCampaign] = rows as NonNullable<typeof rows>;

  console.log("[setup] inserting fake leads (one per campaign)...");

  // Use raw client for lead inserts — Drizzle includes unmigrated columns (e.g.
  // last_delivered_template_id) as DEFAULT even when not provided, which fails
  // until migrations are applied.
  async function insertLead(
    companyId: string,
    fullName: string,
    email: string,
    role: string,
  ): Promise<string> {
    const name = fullName.trim() || null;
    const [row] = await client<{ id: string }[]>`
      INSERT INTO leads (company_id, name, email, role, is_verified, status, email_status, routing)
      VALUES (${companyId}, ${name}, ${email}, ${role}, true, 'new', 'verified', 'auto_queue')
      RETURNING id
    `;
    return row!.id;
  }

  // --- Education campaign lead ---
  const [eduCompany] = await db
    .insert(companies)
    .values({ name: "Stamford International School", industry: "education", companySize: "medium", location: "Singapore", source: "seed" })
    .returning({ id: companies.id });

  const eduLeadId = await insertLead(eduCompany!.id, "Sarah Tan", "sarah.tan@stamford-school.edu.sg", "Head of Admissions");
  await db.insert(campaignLeads).values({ leadId: eduLeadId, campaignId: eduCampaign!.id, source: "seed" });
  console.log(`  ✓ edu lead: Sarah Tan → "${eduCampaign!.name}"`);

  // --- Law campaign lead ---
  const [lawCompany] = await db
    .insert(companies)
    .values({ name: "Ashurst Australia", industry: "law", companySize: "medium", location: "Sydney, AU", source: "seed" })
    .returning({ id: companies.id });

  const lawLeadId = await insertLead(lawCompany!.id, "James Whitfield", "james.whitfield@ashurst.com.au", "HR Manager");
  await db.insert(campaignLeads).values({ leadId: lawLeadId, campaignId: lawCampaign!.id, source: "seed" });
  console.log(`  ✓ law lead: James Whitfield → "${lawCampaign!.name}"`);

  // --- Corporate HR campaign lead ---
  const [hrCompany] = await db
    .insert(companies)
    .values({ name: "Grab Holdings", industry: "technology", companySize: "large", location: "Singapore", source: "seed" })
    .returning({ id: companies.id });

  const hrLeadId = await insertLead(hrCompany!.id, "Michelle Lim", "michelle.lim@grab.com", "HR Director");
  await db.insert(campaignLeads).values({ leadId: hrLeadId, campaignId: hrCampaign!.id, source: "seed" });
  console.log(`  ✓ hr lead: Michelle Lim → "${hrCampaign!.name}"`);

  console.log("[setup] done.");
  await client.end();
}

main().catch((err) => {
  console.error("[setup] failed:", err);
  process.exit(1);
});
