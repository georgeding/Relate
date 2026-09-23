// Domain selector: the engine imports `domain` and calls domain.tagMessage / .persona /
// .observePrompt / .todoPrompt — no scattered `if (business)` checks. A space picks its domain via
// `template` (relationship | business | team) and may override the assistant persona with `persona`.
import { CONTEXT_TYPE, CFG } from '../config.js';
import relationship from './relationship.js';
import business from './business.js';
import team from './team.js';
import { pluginDomains } from '../plugins.js';

export const DOMAINS = { relationship, business, team, ...(await pluginDomains()) };   // plugins may add templates
const base = DOMAINS[CONTEXT_TYPE] || relationship;
export const domain = CFG.persona ? { ...base, persona: String(CFG.persona) } : base;
