// Runs before paint; the per-account cache reduces flash, then authenticated
// GET /settings/me remains authoritative. Kept outside the client boundary.
export const themeBootstrap = `try{var u=JSON.parse(sessionStorage.getItem('ai-proctoring-current-user')||'null');var p=u&&localStorage.getItem('ai-proctoring-theme:'+u.id);if(!['light','dark','system'].includes(p))p='system';var t=p==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):p;document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=t;}catch(e){}`;
