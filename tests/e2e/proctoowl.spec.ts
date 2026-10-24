import { expect, test } from '@playwright/test';
import { uiSession } from './ui-fixtures';

test('owl pupils and soft beams follow the pointer, settle, and respect reduced motion',async({page})=>{
  await page.emulateMedia({reducedMotion:'no-preference',colorScheme:'light'});
  await page.goto('/');
  const hero=page.locator('#trang-chu'), lights=hero.locator('[class*="eyeLights"]');
  await expect(hero).toHaveAttribute('data-eye-tracking','enabled');
  const box=(await hero.boundingBox())!;
  const headline=await page.locator('#hero-title').innerHTML();
  await page.mouse.move(box.x+90,box.y+box.height*.55);
  await expect.poll(async()=>Number(await lights.evaluate(el=>el.style.opacity))).toBeGreaterThan(.95);
  const initial=await hero.locator('[data-eye-beam="left"]').getAttribute('d');
  expect(initial).toMatch(/^M [\d.]+ [\d.]+ L /);
  const offsets=await hero.locator('[data-pupil]').evaluateAll(nodes=>nodes.map(el=>el.getAttribute('transform')));
  expect(offsets.every(value=>value?.startsWith('translate(-'))).toBe(true);
  const geometry=await hero.evaluate(root=>{
    const rect=root.getBoundingClientRect();
    return ['left','right'].map(side=>{
      const eye=root.querySelector(`[data-eye-origin="${side}"]`)!.getBoundingClientRect();
      const path=root.querySelector(`[data-eye-beam="${side}"]`)!.getAttribute('d')!.match(/[\d.-]+/g)!.map(Number);
      return {x:path[0],y:path[1],expectedX:eye.left+eye.width/2-rect.left,expectedY:eye.top+eye.height/2-rect.top};
    });
  });
  for(const eye of geometry){expect(Math.abs(eye.x-eye.expectedX)).toBeLessThan(1);expect(Math.abs(eye.y-eye.expectedY)).toBeLessThan(1);}
  await page.screenshot({path:'artifacts/proctoowl-redesign/eye-spotlight-left.png'});
  await page.setViewportSize({width:1560,height:960});
  const resized=(await hero.boundingBox())!;
  await page.mouse.move(resized.x+90,resized.y+resized.height*.55);
  await expect.poll(async()=>{
    const numbers=(await hero.locator('[data-eye-beam="left"]').getAttribute('d'))!.match(/[\d.-]+/g)!.map(Number);
    return Math.abs((numbers[2]+numbers[6])/2-90);
  }).toBeLessThan(1);
  await page.setViewportSize({width:1440,height:960});
  await page.mouse.move(box.x+box.width-40,box.y+box.height*.4);
  await expect.poll(()=>hero.locator('[data-eye-beam="left"]').getAttribute('d')).not.toBe(initial);
  await expect.poll(()=>hero.locator('[data-pupil="right"]').getAttribute('transform')).toMatch(/^translate\([\d.]+ /);
  await page.screenshot({path:'artifacts/proctoowl-redesign/eye-spotlight-right.png'});
  await page.mouse.move(8,950);
  await expect.poll(async()=>Number(await lights.evaluate(el=>el.style.opacity))).toBe(0);
  await expect(hero.locator('[data-pupil="left"]')).toHaveAttribute('transform','translate(0 0)');
  await page.emulateMedia({reducedMotion:'reduce'});await expect(hero).toHaveAttribute('data-eye-tracking','static');
  const stopped=await hero.locator('[data-eye-beam="left"]').getAttribute('d');
  await page.mouse.move(box.x+180,box.y+220);await expect(lights).toBeHidden();
  expect(await hero.locator('[data-eye-beam="left"]').getAttribute('d')).toBe(stopped);
  expect(await page.locator('#hero-title').innerHTML()).toBe(headline);
});

test('touch has a static owl and the existing registration CTA stays usable',async({browser})=>{
  const context=await browser.newContext({viewport:{width:390,height:900},isMobile:true,hasTouch:true,reducedMotion:'no-preference'});
  try {
    const page=await context.newPage();await page.goto(process.env.PLAYWRIGHT_BASE_URL??'http://localhost:3000');
    await expect(page.locator('[data-owl="proctoowl"]')).toBeVisible();
    await expect(page.locator('#trang-chu')).toHaveAttribute('data-eye-tracking','static');
    await expect(page.locator('[class*="eyeLights"]')).toBeHidden();
    await page.getByRole('link',{name:'Bắt đầu ngay',exact:true}).tap();
    await expect(page).toHaveURL(/\/login\?mode=register$/);
    await expect(page.getByRole('heading',{name:'Đăng ký',exact:true})).toBeVisible();
    await expect(page.getByRole('link',{name:'ProctoOwl — Trang chủ',exact:true})).toBeVisible();
  }finally{await context.close();}
});

for(const width of [1440,1024,768,390])for(const theme of ['light','dark']as const)test(`ProctoOwl hero ${width}px ${theme}: hierarchy, real sections and clean identity`,async({page})=>{
  await page.setViewportSize({width,height:1000});await page.emulateMedia({colorScheme:theme,reducedMotion:'no-preference'});await page.goto('/');
  const heading=page.getByRole('heading',{level:1}), visual=page.locator('figure');await expect(heading).toHaveText(/Giám thị AI\s*không bao giờ\s*chớp mắt\./);
  await expect(page.getByRole('banner').getByRole('link',{name:'ProctoOwl — Trang chủ'})).toBeVisible();
  await expect(page.locator('body')).not.toContainText(/AI PROCTO|AI Proctoring|Bảng giá|testimonial|10K|50M|Dùng thử miễn phí/);
  await expect(page.locator('figure')).toContainText('Giao diện minh họa');
  await expect(page.locator('figure')).toContainText('Không phải dữ liệu phiên thi thực tế');
  await expect(page.locator('figure')).toContainText('Giảng viên xem xét và đưa ra quyết định');
  await expect(visual.locator('[class*="previewGrid"] > div')).toHaveCount(8);
  await expect(visual.getByRole('link',{name:'Tìm hiểu tính năng',exact:true})).toHaveAttribute('href','#tinh-nang');
  const card=(await visual.locator('[class*="monitorPreview"]').boundingBox())!,caption=(await visual.locator('figcaption').boundingBox())!;
  expect(card.y+card.height+8).toBeLessThanOrEqual(caption.y);
  for(const id of ['tinh-nang','cach-hoat-dong','ho-tro','huong-dan'])await expect(page.locator(`#${id}`)).toHaveCount(1);
  const a=(await heading.boundingBox())!,b=(await visual.boundingBox())!;
  if(width>900)expect(b.x).toBeGreaterThan(a.x+a.width);else expect(b.y).toBeGreaterThan(a.y+a.height);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  for(const text of [page.getByRole('banner').getByRole('link',{name:'ProctoOwl — Trang chủ'}),page.locator('footer a[href="/"]'),heading,page.locator('[class*="heroDescription"]')]){
    const contrast=await text.evaluate(el=>{
      const rgb=(color:string)=>(color.match(/[\d.]+/g)??[]).slice(0,3).map(Number);
      const luminance=(values:number[])=>values.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
      let node:Element|null=el,bg='rgba(0, 0, 0, 0)';
      while(node&&(bg==='transparent'||bg==='rgba(0, 0, 0, 0)')){bg=getComputedStyle(node).backgroundColor;node=node.parentElement;}
      const a=luminance(rgb(getComputedStyle(el).color)),b=luminance(rgb(bg));return(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
    });
    expect(contrast).toBeGreaterThanOrEqual(4.5);
  }
  await page.evaluate(()=>document.fonts.ready);
  await page.screenshot({path:`artifacts/proctoowl-redesign/hero-${width}-${theme}.png`});
  if(width===1440||width===390)await page.screenshot({path:`artifacts/proctoowl-redesign/home-${width}-${theme}.png`,fullPage:true});
});

for(const role of ['student','teacher','admin'])test(`${role}: only workspace identity changes`,async({page})=>{
  await uiSession(page,role);await page.context().addCookies([{name:'auth_token',value:`fixture.${Buffer.from(JSON.stringify({role})).toString('base64url')}.signature`,url:process.env.PLAYWRIGHT_BASE_URL??'http://localhost:3000'}]);
  await page.goto(role==='student'?'/student':role==='teacher'?'/teacher':'/admin');
  await expect(page.locator('.sidebar').getByRole('link',{name:'ProctoOwl — Trang chủ'})).toBeVisible();
  await expect(page.locator('.sidebar')).not.toContainText(/AI PROCTO|AI Proctoring/);
  await expect(page.locator('[data-owl]')).toHaveCount(0);
  expect(await page.locator('.sidebar').evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgb(0, 109, 119)');
  await expect(page).toHaveTitle('ProctoOwl - Hệ thống thi trực tuyến');
  await page.screenshot({path:`artifacts/proctoowl-redesign/brand-${role}.png`});
});

test('login, registration and recovery keep their forms with the new visible brand',async({page})=>{
  await page.goto('/login');await expect(page.getByRole('link',{name:'ProctoOwl — Trang chủ',exact:true})).toBeVisible();
  await page.getByLabel('Email',{exact:true}).fill('student@example.com');
  await page.getByRole('button',{name:'Quên mật khẩu?',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Quên mật khẩu',exact:true})).toBeVisible();
  await expect(page.getByRole('link',{name:'ProctoOwl — Trang chủ',exact:true})).toBeVisible();
  await page.goto('/login?mode=register');await expect(page.getByRole('heading',{name:'Đăng ký',exact:true})).toBeVisible();
  await expect(page.locator('.login-heading')).toContainText('ProctoOwl');
  await expect(page.locator('body')).not.toContainText(/AI PROCTO|AI Proctoring/);
  await page.screenshot({path:'artifacts/proctoowl-redesign/brand-register.png'});
});
