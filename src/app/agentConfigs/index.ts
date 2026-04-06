import type { RealtimeAgent } from "@openai/agents/realtime";

// The emailTriage agent is now created dynamically via createEmailTriageAgent().
// This registry is kept for compatibility with other agent sets.
export const allAgentSets: Record<string, RealtimeAgent[]> = {};

export const defaultAgentSetKey = "emailTriage";
