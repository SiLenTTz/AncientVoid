// Fixture: zwei geforderte Funde (JSX-Text + title-Attribut), Baseline 1 → ROT.
export function Dirty() {
  return (
    <div title="Neue Session anlegen">
      <span>Session gestoppt</span>
      <span>{"gelöscht" /* i18n-ignore: Test */}</span>
      <input placeholder="Suchen" />
    </div>
  );
}
