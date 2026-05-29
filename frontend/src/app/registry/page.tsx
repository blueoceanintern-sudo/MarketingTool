import { getActiveCombinations, getDirectoryConfigs, getRegistrySources } from "@/lib/api";
import RegistryClient from "./registry-client";

export default async function RegistryPage() {
  const [sources, directoryConfigs, activeCombinations] = await Promise.all([
    getRegistrySources(),
    getDirectoryConfigs(),
    getActiveCombinations(),
  ]);
  return (
    <RegistryClient
      initialSources={sources}
      directoryConfigs={directoryConfigs}
      activeCombinations={activeCombinations}
    />
  );
}
