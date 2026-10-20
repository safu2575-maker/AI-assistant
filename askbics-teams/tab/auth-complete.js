/* The result is redeemed separately using a private, single-use proof. */
if (window.microsoftTeams) microsoftTeams.app.initialize().then(() => microsoftTeams.authentication.notifySuccess('complete')).catch(() => {});
// A regular browser popup has no Teams parent; close it after the parent redeems the result.
setTimeout(() => { if (window.opener) window.close(); }, 2500);
