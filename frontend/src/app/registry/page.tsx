import { auth } from "@/auth";
import RegistryClient from "./registry-client";

export default async function RegistryPage() {
  const session = await auth();
  const isAdmin = session?.user?.role === "admin";
  return <RegistryClient isAdmin={isAdmin} />;
}
