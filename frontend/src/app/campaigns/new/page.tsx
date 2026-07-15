"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export default function NewCampaignPage() {
  const router = useRouter();
  const [brief, setBrief] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [questions, setQuestions] = useState<string[]>([]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!brief.trim()) return;
    setLoading(true);
    setError(null);
    setQuestions([]);

    try {
      const res = await fetch(`${BASE}/api/v1/campaigns/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ brief: brief.trim() }),
      });

      const data = await res.json() as {
        id?: string;
        clarification_needed?: boolean;
        questions?: string[];
        error?: string;
      };

      if (!res.ok) {
        if (data.clarification_needed && data.questions?.length) {
          setQuestions(data.questions);
          return;
        }
        setError(data.error ?? `Request failed (${res.status})`);
        return;
      }

      router.push(`/campaigns/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl py-12 px-4">
      <h1 className="text-2xl font-semibold mb-2">Create Campaign with AI</h1>
      <p className="text-sm text-muted-foreground mb-8">
        Describe your target market and product. The AI will create the campaign,
        discover lead sources, and start filling the pipeline automatically.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <Textarea
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          placeholder={`e.g. "Find Australian independent schools to sell our AI-powered timetabling tool. It saves admins 10 hours a week on scheduling and integrates with SEQTA."`}
          rows={6}
          disabled={loading}
          className="resize-none"
        />

        {questions.length > 0 && (
          <div className="rounded-md border border-yellow-200 bg-yellow-50 p-4 space-y-2">
            <p className="text-sm font-medium text-yellow-800">
              A few things need clarification — add the answers to your brief and resubmit:
            </p>
            <ul className="list-disc list-inside space-y-1">
              {questions.map((q, i) => (
                <li key={i} className="text-sm text-yellow-700">{q}</li>
              ))}
            </ul>
          </div>
        )}

        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={loading || !brief.trim()}>
            {loading ? "Creating campaign…" : "Create Campaign"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => router.back()}
            disabled={loading}
          >
            Cancel
          </Button>
        </div>

        {loading && (
          <p className="text-sm text-muted-foreground">
            Parsing brief and resolving geographies… this takes 10–20 seconds.
          </p>
        )}
      </form>
    </div>
  );
}
