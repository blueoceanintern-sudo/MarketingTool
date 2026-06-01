import { getDraftQueue, getDraftsByStatus } from "@/lib/api";
import DraftsClient from "./drafts-client";

export default async function DraftsPage() {
  const [queue, scheduled, sent] = await Promise.all([
    getDraftQueue(),
    getDraftsByStatus("scheduled"),
    getDraftsByStatus("sent"),
  ]);
  return <DraftsClient initialQueue={queue} initialScheduled={scheduled} initialSent={sent} />;
}
