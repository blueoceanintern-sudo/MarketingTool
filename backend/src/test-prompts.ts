import Anthropic from "@anthropic-ai/sdk";
import { and, eq } from "drizzle-orm";
import { db } from "./db";
import { promptTemplates } from "./db/schema";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const LEAD = {
  contact_name: "Sarah Chen",
  role: "Head of Admissions",
  company_name: "Meridian International School",
  industry: "Education",
  company_size: "medium",
  location: "Singapore",
};

const CAMPAIGN = {
  description:
    "BlueOcean helps independent schools streamline admissions and student operations workflows. We reduce manual coordination across enquiries, enrolment, and reporting — giving operations teams cleaner visibility and fewer bottlenecks.",
  painPoints: [
    "Student enquiries managed across multiple spreadsheets with no central tracking",
    "Admissions pipeline status invisible to leadership without manual collation",
    "High admin overhead during peak enrolment periods slows response times",
  ],
};

function buildLeadBlock() {
  return `## Lead data
- contact_name: ${LEAD.contact_name}
- role: ${LEAD.role}
- company_name: ${LEAD.company_name}
- industry: ${LEAD.industry}
- company_size: ${LEAD.company_size}
- location: ${LEAD.location}`;
}

function buildInitialUserMsg() {
  return `${buildLeadBlock()}

## What we offer
${CAMPAIGN.description}

## Campaign context
- campaign_pain_points:
${CAMPAIGN.painPoints.map((p) => `  • ${p}`).join("\n")}`;
}

function buildFollowUpUserMsg(originalSubject: string, previousAngleTags: string[]) {
  return `${buildLeadBlock()}

## Product context
${CAMPAIGN.description}

## Campaign context
- original_subject: ${originalSubject}
- previous_angle_tags: ${previousAngleTags.length > 0 ? previousAngleTags.join(", ") : "none"}
- campaign_pain_points:
${CAMPAIGN.painPoints.map((p) => `  • ${p}`).join("\n")}`;
}

async function getTemplate(type: string) {
  const [tmpl] = await db
    .select({ id: promptTemplates.id, systemPrompt: promptTemplates.systemPrompt, name: promptTemplates.name })
    .from(promptTemplates)
    .where(and(eq(promptTemplates.active, true), eq(promptTemplates.templateType, type)))
    .limit(1);
  if (!tmpl) throw new Error(`No active template for type: ${type}`);
  return tmpl;
}

async function call(systemPrompt: string, userMsg: string) {
  const res = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 400,
    system: systemPrompt,
    messages: [{ role: "user", content: userMsg }],
  });
  const text = res.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new Error("No text in response");
  const match = text.text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON in response:\n" + text.text);
  return JSON.parse(match[0]) as Record<string, unknown>;
}

function print(label: string, result: Record<string, unknown>) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  ${label}`);
  console.log("=".repeat(60));
  console.log(`SUBJECT:    ${result.subject}`);
  if (result.angle_tag) console.log(`ANGLE TAG:  ${result.angle_tag}`);
  console.log(`CONFIDENCE: ${result.confidenceScore}`);
  console.log(`\nBODY:\n${result.body}`);
}

async function main() {
  console.log("Testing all 4 email prompts with sample lead data...\n");

  // 1. Initial email
  const initialTmpl = await getTemplate("initial");
  const initialResult = await call(initialTmpl.systemPrompt, buildInitialUserMsg());
  print("1. INITIAL EMAIL", initialResult);

  const originalSubject = initialResult.subject as string;

  // 2. Follow-up 1 (no prior angle tags)
  const fu1Tmpl = await getTemplate("followup_1");
  const fu1Result = await call(fu1Tmpl.systemPrompt, buildFollowUpUserMsg(originalSubject, []));
  print("2. FOLLOW-UP 1 (New angle)", fu1Result);

  const angleTag1 = (fu1Result.angle_tag as string) ?? "manual_workload";

  // 3. Follow-up 2 (angle from attempt 1 excluded)
  const fu2Tmpl = await getTemplate("followup_2");
  const fu2Result = await call(fu2Tmpl.systemPrompt, buildFollowUpUserMsg(originalSubject, [angleTag1]));
  print("3. FOLLOW-UP 2 (Reframe)", fu2Result);

  const angleTag2 = (fu2Result.angle_tag as string) ?? "reporting_visibility";

  // 4. Break-up (angles from attempts 1 & 2 excluded)
  const breakupTmpl = await getTemplate("breakup");
  const breakupResult = await call(
    breakupTmpl.systemPrompt,
    buildFollowUpUserMsg(originalSubject, [angleTag1, angleTag2]),
  );
  print("4. BREAK-UP EMAIL", breakupResult);

  console.log("\n" + "=".repeat(60));
  console.log("Done.");

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
