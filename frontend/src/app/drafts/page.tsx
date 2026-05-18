import { getDraftQueue } from "@/lib/api";
import DraftsClient from "./drafts-client";

export default async function DraftsPage() {
  const drafts = await getDraftQueue();
  return <DraftsClient initialDrafts={drafts} />;
}
