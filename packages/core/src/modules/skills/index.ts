/** Public API of this module (ADR-0020). Other modules import only from here. */
export { scanProjectSkills, recommendForPrompt, writeProjectArtifact, resolveSkillChain, withSkillChain, type SkillOrAgent, type PromptRecommendation, type ResolvedSkillChain } from "./skills.ts";
export { ensureBaseSkills } from "./base-skills.ts";
