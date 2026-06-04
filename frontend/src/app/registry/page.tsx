import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { getQueryClient } from "@/lib/query-client";
import { registrySourcesOptions, directoryConfigsOptions, activeCombinationsOptions } from "@/lib/queries";
import RegistryClient from "./registry-client";

export default async function RegistryPage() {
  const queryClient = getQueryClient();
  await Promise.all([
    queryClient.prefetchQuery(registrySourcesOptions()),
    queryClient.prefetchQuery(directoryConfigsOptions()),
    queryClient.prefetchQuery(activeCombinationsOptions()),
  ]);

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <RegistryClient />
    </HydrationBoundary>
  );
}
