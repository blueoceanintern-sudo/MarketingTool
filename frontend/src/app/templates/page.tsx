import { getPromptTemplates, getTemplateEngagement } from "@/lib/api";
import TemplatesClient from "./templates-client";

export default async function TemplatesPage() {
  const [templates, engagement] = await Promise.all([
    getPromptTemplates(),
    getTemplateEngagement(),
  ]);
  return <TemplatesClient initialTemplates={templates} initialEngagement={engagement} />;
}
