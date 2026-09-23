// Names the domain prompts refer to, from the space config. Defaults are neutral so a fresh
// install never talks about someone else's people.
import { CFG } from '../config.js';

export const ME = CFG.me?.name || '我';
export const THEM = CFG.target?.name || '对方';
export const HER = CFG.target?.pronoun || 'TA';                       // 她 / 他 / TA
export const ORG = CFG.org?.name || CFG.name || '团队';
