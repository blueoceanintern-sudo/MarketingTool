import { Suspense } from "react";
import DraftsClient from "./drafts-client";

export default function DraftsPage() {
  return (
    <Suspense>
      <DraftsClient />
    </Suspense>
  );
}
