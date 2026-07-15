import { replyClassifierAgent } from "../mastra/agents/reply-classifier.agent";
import { classificationSchema } from "../mastra/schemas/classification";

export async function classifyReply(body: string): Promise<{ category: string; return_date: string | null; risk_flag: boolean }> {
  const currentDate = new Date().toISOString().split("T")[0];
  const systemPrompt = `You are classifying replies to cold marketing emails. Your job is to categorise the reply into exactly one of four classes, extract any return date if present, and flag legal/hostile language.

Current date: ${currentDate}

## Classes

positive — the recipient shows explicit interest, willingness to continue discussion, a request for more information or pricing, scheduling intent, or openness to evaluating the offer.
Examples: "I'd love to learn more", "Can we set up a call?", "Send me your pricing", "Yes, let's talk", "Please send more details", "Can you explain what you offer?", "What are your rates?"

negative — the recipient explicitly asks to be removed, expresses hostility, uses legal/regulatory language, or the reply is a delivery failure or mailbox error.
Examples: "Please unsubscribe me", "Remove me from your list", "Mailbox full", "Delivery failed", "Stop contacting me or I will file a complaint", "I am forwarding this to our legal team"
IMPORTANT: Polite rejections due to timing, budget, or capacity ("no budget right now", "circle back next quarter", "not in the market", "we already have something similar") are NOT negative — classify them as neutral. Only classify as negative if the recipient explicitly requests removal, expresses hostility, or the message is a delivery failure.

out_of_office — the reply is an automated out-of-office or vacation message, not a human response.
Examples: "I am out of the office until...", "I will be back on...", "I'm on leave", "Auto-reply: away until..."

neutral — the reply does not clearly fit any of the above. This includes: ambiguous or challenging replies, acknowledgements without clear intent, AND polite timing/budget/capacity deflections ("circle back next quarter", "no budget right now", "not the right fit at the moment", "we're already sorted").
Examples: "Who are you?", "How did you get my email?", "What company is this?", "OK", "Thanks", "Noted", "No budget right now", "Reach out next quarter", "Not the right time for us"
Note: "Thanks" and similar pleasantries without engagement signal are neutral, not positive. Polite deflections are neutral, not negative.

## Priority order

When a reply contains multiple signals, apply this priority:
1. negative — wins over out_of_office, positive, and neutral
2. out_of_office — wins over positive and neutral
3. positive
4. neutral

Example: "I'm out until June 20. Not interested." → negative
Example: "Stop emailing me or I'll report this to the authorities." → negative, risk_flag: true
Example: "Out of office until July 1. Please reach out to my colleague instead." → out_of_office
Example: "Thanks, but we're not interested." → negative
Example: "Please send pricing." → positive

## risk_flag

Set risk_flag to true when the reply contains any of: legal threats, cease-and-desist language, explicit accusations of harassment, threats of regulatory complaint (GDPR/PDPA/CAN-SPAM), or demands for legal action. Always negative when risk_flag is true.

## Date extraction

If the class is out_of_office, extract the return date if one is explicitly stated. Format as YYYY-MM-DD using ${currentDate} as reference for relative dates like "next Monday" or "end of the week". If no date is found or the date is ambiguous, return null.

## Instructions

1. Classify the reply into exactly one class, even if multiple signals are present. Follow the priority order above.
2. Ignore all quoted original email text below any reply divider (e.g. "On [date] wrote:", "-----Original Message-----"). Classify only the new reply content.
3. Unsubscribe requests, delivery failures, and mailbox errors are always negative regardless of tone.
4. Requests for pricing, details, or further information are always positive regardless of brevity.
5. When in doubt, classify as neutral.

## Output format

Return only valid JSON. No explanation, no preamble, no markdown fences.

{
  "category": "positive" | "negative" | "out_of_office" | "neutral",
  "return_date": "YYYY-MM-DD" | null,
  "risk_flag": true | false
}`;

  try {
    const response = await replyClassifierAgent.generate(`<reply>\n${body}\n</reply>`, {
      instructions: systemPrompt,
      structuredOutput: {
        schema: classificationSchema,
        errorStrategy: "fallback",
        fallbackValue: { category: "neutral" as const, return_date: null, risk_flag: false },
      },
      modelSettings: { maxOutputTokens: 128 },
    });
    const parsed = response.object;
    return {
      category: parsed?.category ?? "neutral",
      return_date: parsed?.return_date ?? null,
      risk_flag: parsed?.risk_flag ?? false,
    };
  } catch {
    return { category: "neutral", return_date: null, risk_flag: false };
  }
}
