import { Suspense } from "react";
import AnalyticsClient from "./analytics-client";
import AnalyticsLoading from "./loading";

export default function AnalyticsPage() {
  return (
    <Suspense fallback={<AnalyticsLoading />}>
      <AnalyticsClient />
    </Suspense>
  );
}
