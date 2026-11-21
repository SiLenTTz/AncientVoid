// Fixture: sauber — alles über t(), Ausnahmen per i18n-ignore.
export function Clean() {
  return (
    <div title={t("session.create")}>
      <span>{t("session.stopped")}</span>
      <span>{"gelöscht, wirklich?" /* i18n-ignore: Test */}</span>
      <input placeholder={t("search.placeholder")} aria-label={t("nav.search")} />
    </div>
  );
}
