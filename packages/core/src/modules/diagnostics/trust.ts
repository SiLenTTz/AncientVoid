import type { ProjectTrust } from "@ancientvoid/contracts";
import type { HubDatabase } from "../../platform/index.ts";

/** ADR-0058 §9: Projekt-Freigabe für Prüfer, die Projektcode starten (tsc aus node_modules). Nur ein Mensch setzt sie. */
export class ProjectTrustStore {
  private readonly db: HubDatabase;

  constructor(db: HubDatabase) {
    this.db = db;
  }

  get(project: string): ProjectTrust {
    const row = this.db.prepare("SELECT project, trusted_by, trusted_at FROM trusted_projects WHERE project = ?").get(project) as
      | { project: string; trusted_by: string | null; trusted_at: string }
      | undefined;
    return row ? { trusted: true, project, by: row.trusted_by, at: row.trusted_at } : { trusted: false, project, by: null, at: null };
  }

  set(project: string, trusted: boolean, by: string | null): ProjectTrust {
    if (trusted) {
      this.db
        .prepare("INSERT INTO trusted_projects (project, trusted_by, trusted_at) VALUES (?, ?, ?) ON CONFLICT(project) DO UPDATE SET trusted_by = excluded.trusted_by, trusted_at = excluded.trusted_at")
        .run(project, by, new Date().toISOString());
    } else {
      this.db.prepare("DELETE FROM trusted_projects WHERE project = ?").run(project);
    }
    return this.get(project);
  }
}
