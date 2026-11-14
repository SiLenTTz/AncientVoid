export const STATUS_NOTE_EVENT = "ancientvoid:status-note";
const key = (id: string) => `ancientvoid.status-note.${id}`;
export function readStatusNote(id: string): string {
  return (localStorage.getItem(key(id)) ?? "").slice(0, 400);
}
export function saveStatusNote(id: string, text: string): void {
  if (text.trim()) localStorage.setItem(key(id), text.slice(0, 400)); else localStorage.removeItem(key(id));
  window.dispatchEvent(new CustomEvent(STATUS_NOTE_EVENT));
}
