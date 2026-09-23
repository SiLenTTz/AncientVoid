import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Base skills live one level above the projects, where every repo shares
 * one catalog. A project skill names `extends: <base>` and only records
 * the difference. The chain is a tree: task is the form, the others
 * specialize it.
 */
const BASE_SKILLS: { name: string; body: string }[] = [
  {
    name: "task",
    body: `---
name: task
description: "Gemeinsame Form jeder Aufgabe: Ziel, Scope, Constraints, Erfolgskriterium."
---

# Skill: task

Schnittstelle für jede Aufgabe. Ein Projekt-Skill nennt \`extends: task\` und schreibt nur die Abweichung.

## Form
- Ziel
- Scope
- Constraints
- Erfolgskriterium
`,
  },
  {
    name: "investigate",
    body: `---
name: investigate
description: "Ursache lesen und belegen, ohne Dateien zu ändern."
extends: task
---

# Skill: investigate

Erweitert \`task\`. Lesen, nachstellen, Befund. Keine Änderung am Projekt.
`,
  },
  {
    name: "change",
    body: `---
name: change
description: "Eine abgegrenzte Änderung mit Test, der das Erfolgskriterium prüft."
extends: task
---

# Skill: change

Erweitert \`task\`. Die Änderung bleibt im Scope. Ein Test oder ein beobachtbarer Lauf belegt das Erfolgskriterium.
`,
  },
  {
    name: "review",
    body: `---
name: review
description: "Vorhandene Änderung prüfen, ohne selbst zu schreiben."
extends: task
---

# Skill: review

Erweitert \`task\`. Befund zu Korrektheit, Lücken und Risiko. Kein eigener Edit.
`,
  },
];

/** Creates missing base skills. Existing files stay untouched. */
export async function ensureBaseSkills(rootDir: string): Promise<void> {
  const dir = join(rootDir, ".claude", "skills");
  await mkdir(dir, { recursive: true });
  for (const skill of BASE_SKILLS) {
    const file = join(dir, skill.name, "SKILL.md");
    await mkdir(join(dir, skill.name), { recursive: true });
    try {
      await writeFile(file, skill.body, { flag: "wx" });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
  }
}
