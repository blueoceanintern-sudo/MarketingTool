import { getRegistrySources } from "@/lib/api";
import RegistryClient from "./registry-client";

export default async function RegistryPage() {
  const sources = await getRegistrySources();
  return <RegistryClient initialSources={sources} />;
}
