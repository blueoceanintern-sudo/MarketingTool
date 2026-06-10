export interface AssignerConfig {
  topN: number;
  defaultCampaignId: string | null;
  geoAliases: Record<string, string[]>;
  verticalAliases: Record<string, string[]>;
  roleScoreWeight: number;
  sizeScoreWeight: number;
  roleScoreThreshold: number;
}

export const defaultConfig: AssignerConfig = {
  topN: 3,
  defaultCampaignId: process.env.DEFAULT_CAMPAIGN_ID ?? null,

  geoAliases: {
    SG: ["singapore", "sg"],
    AU: [
      "australia", "au",
      "sydney", "melbourne", "brisbane", "perth", "adelaide",
      "canberra", "hobart", "darwin",
      "new south wales", "victoria", "queensland",
      "western australia", "south australia", "tasmania",
      "northern territory", "nsw", "vic", "qld", "wa", "sa", "tas", "act", "nt",
    ],
    US: [
      "united states", "us", "usa", "america",
      "new york", "california", "texas", "florida", "illinois",
      "pennsylvania", "ohio", "georgia", "north carolina", "michigan",
    ],
  },

  verticalAliases: {
    education: [
      "education", "school", "university", "college",
      "k-12", "k12", "academy", "institute", "learning",
      "tutoring", "preschool", "kindergarten", "primary", "secondary",
      "higher education", "vocational", "edtech", "training",
    ],
  },

  // Weights must sum to 1.0 for a clean [0,1] final score.
  roleScoreWeight: 0.6,
  sizeScoreWeight: 0.4,

  // Minimum combined score (from stages 2+3) for a campaign to remain in the
  // final selection. 0.0 keeps all geo+vertical matches regardless of scoring.
  roleScoreThreshold: 0.0,
};
