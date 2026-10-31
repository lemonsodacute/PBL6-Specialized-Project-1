// A section link explicitly opens the public site, even with an active session.
// Visiting the bare root still opens the user's workspace as before.
export const PUBLIC_HOME_HREF = '/#trang-chu';
const publicHomeSections = ['#trang-chu', '#noi-dung', '#tinh-nang', '#cach-hoat-dong', '#ho-tro', '#huong-dan'];

export function isExplicitPublicHomeVisit(hash: string) {
  return publicHomeSections.includes(hash);
}

// Keep the pre-paint guard and the client redirect in agreement on initial loads.
export const publicHomeSessionBootstrap = `try{if(!${JSON.stringify(publicHomeSections)}.includes(location.hash)&&sessionStorage.getItem('ai-proctoring-current-user'))document.documentElement.dataset.publicHomeAuth='pending';}catch(e){}`;
