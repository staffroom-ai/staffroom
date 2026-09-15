/**
 * agents.yaml: the roster, the office name, and the default model.
 *
 * This is the file owners edit most, usually by hand or with an AI's help, so the
 * schema is strict: an unknown key is a typo we should name, not a setting we
 * should ignore.
 */
import { z } from "zod";

export const DEPARTMENT_ID = /^[a-z][a-z0-9-]{1,23}$/;
export const AGENT_ID = /^[a-z][a-z0-9-]{1,39}$/;
/** provider/model, where the model half may itself contain slashes (openrouter). */
export const MODEL_ID = /^[a-z0-9-]+\/[A-Za-z0-9._:/-]+$/;

/** At most six pods in the office, and the pod holding the reception desk seats five. */
export const MAX_DEPARTMENTS = 6;
export const MAX_AGENTS = 35;
export const MAX_SEATS_PER_DEPARTMENT = 6;
export const RECEPTION_POD_INDEX = 4;
export const MAX_SEATS_RECEPTION_POD = 5;

export function isIanaTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const DepartmentId = z.string().regex(DEPARTMENT_ID);

export const AgentSchema = z
  .object({
    id: z.string().regex(AGENT_ID),
    department: DepartmentId,
    /** Unnamed agents are named by their lead the first time work is routed to them. */
    name: z.string().min(1).max(40).optional(),
    role: z.string().min(1).max(60),
    does: z.string().min(10).max(400),
    model: z.string().regex(MODEL_ID).optional(),
    tools: z.array(z.string()).default([]),
    lead: z.boolean().default(false),
    /** Owner's own words, rendered as <owner_instructions> in the prompt. */
    instructions: z.string().max(4000).optional(),
  })
  .strict();

export const AgentsFileSchema = z
  .object({
    version: z.literal(1),
    office: z.object({
      name: z.string().min(1).max(60),
      timezone: z.string().refine(isIanaTimezone, { message: "not an IANA timezone" }),
    }),
    default_model: z.string().regex(MODEL_ID).optional(),
    departments: z.record(DepartmentId, z.string().min(1).max(40)).default({}),
    agents: z.array(AgentSchema).min(1).max(MAX_AGENTS),
  })
  .strict();

export type AgentConfig = z.infer<typeof AgentSchema>;
export type AgentsFile = z.infer<typeof AgentsFileSchema>;
