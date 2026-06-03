import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { getQueryClient } from "@/lib/query-client";
import { templatesOptions, templateEngagementOptions } from "@/lib/queries";
import TemplatesClient from "./templates-client";

export default async function TemplatesPage() {
  const queryClient = getQueryClient();
  await Promise.all([
    queryClient.prefetchQuery(templatesOptions()),
    queryClient.prefetchQuery(templateEngagementOptions()),
  ]);

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <TemplatesClient />
    </HydrationBoundary>
  );
}
