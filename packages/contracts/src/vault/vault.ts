/** EPIC-P49 (ADR-0063): Knowledge Vault — Notizen des Nutzers in einem gewählten Ordner. */

export interface VaultState {
  configured: boolean;
  /** Absoluter, realer Pfad des Vault-Root (nie in Events/Telemetrie). */
  root: string | null;
  /** Anzeigename (letzter Ordnername) für Kopfzeilen. */
  label: string | null;
}

/** Der Verzeichnis-Browser zur Root-Wahl: nur Ordner, Startpunkte serverseitig. */
export interface VaultBrowseEntry {
  name: string;
  path: string;
}

export interface VaultBrowse {
  path: string;
  parent: string | null;
  dirs: VaultBrowseEntry[];
  /** Startpunkte (projectRoots + Home), falls die Anfrage ohne Pfad kam. */
  roots: VaultBrowseEntry[];
}

export interface VaultFile {
  /** Posix-relativer Pfad im Vault. */
  path: string;
  bytes: number;
  modifiedAt: string;
  /** Nur `.md` ist editierbar; alles andere ist reine Ansicht. */
  editable: boolean;
}

export interface VaultListing {
  files: VaultFile[];
  truncated: boolean;
}

export interface VaultRead {
  path: string;
  revision: string;
  bytes: number;
  text: string | null;
}

/** Namens-Regex für neue Notizen (ohne Endung); der Server hängt `.md` an. */
export const VAULT_NAME_PATTERN = /^[A-Za-z0-9ÄÖÜäöüß][A-Za-z0-9 ._-]{0,120}$/;
/** Eintrags-Cap der rekursiven Liste; darüber ehrlich `truncated`. */
export const VAULT_MAX_LIST = 5000;
/** Größte Notiz, die gelesen/geschrieben wird. */
export const VAULT_MAX_BYTES = 1024 * 1024;
/** SettingsStore-Key des Vault-Root. */
export const VAULT_ROOT_KEY = "vault.root";
