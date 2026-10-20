const state = new URLSearchParams(location.search).get('state');
Promise.race([microsoftTeams.app.initialize().catch(() => {}), new Promise(resolve => setTimeout(resolve, 1500))]).then(() => {
  if (state) location.replace(`/ask/auth/authorize?state=${encodeURIComponent(state)}`);
});
