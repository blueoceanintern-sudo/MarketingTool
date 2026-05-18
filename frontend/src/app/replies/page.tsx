import { getReplies } from "@/lib/api";
import RepliesClient from "./replies-client";

export default async function RepliesPage() {
  const replies = await getReplies();
  return <RepliesClient initialReplies={replies} />;
}
