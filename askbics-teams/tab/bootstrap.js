// Initialize the Teams host before the larger visual bundle is evaluated.
const systemTheme = matchMedia('(prefers-color-scheme: dark)');
let hostTheme = false;
const applyTheme = theme => document.documentElement.dataset.theme = theme === 'dark' || theme === 'contrast' ? theme : 'light';
applyTheme(systemTheme.matches ? 'dark' : 'light');
systemTheme.addEventListener('change', e => { if (!hostTheme) applyTheme(e.matches ? 'dark' : 'light'); });
window.askbicsTeamsReady = (async () => {
  try {
    if (!window.microsoftTeams) return false;
    await microsoftTeams.app.initialize();
    microsoftTeams.app.notifySuccess();
    if (microsoftTeams.app.getContext) {
      const context = await microsoftTeams.app.getContext();
      hostTheme = true; applyTheme(context.app?.theme);
      microsoftTeams.app.registerOnThemeChangeHandler(theme => applyTheme(theme));
    }
    return true;
  } catch { return false; }
})();
window.setTimeout(() => {
  if (!window.askbicsVisualReady) {
    document.getElementById('recovery').hidden = false;
    const status = document.getElementById('status');
    if (status) status.textContent = 'askBICS could not finish loading. Check the server/tunnel connection and use Reload app.';
  }
}, 12000);
document.getElementById('reload-app')?.addEventListener('click', () => location.reload());
