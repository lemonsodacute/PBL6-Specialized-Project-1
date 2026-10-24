import type { Page } from '@playwright/test';
import type { ActivityData } from '@/components/admin/ai-activity';
import { uiSession } from './ui-fixtures';

const ratio = (numerator:number,denominator:number) => ({numerator,denominator,rate:denominator ? numerator/denominator : null});
/** Synthetic browser fixtures, never product defaults or backend writes. */
export const activitySample:ActivityData = {
  question:{requests:6,success:5,failures:1,requested_questions:30,generated_questions:22,grounded_questions:22,questions_with_source:22,image_questions:4,
    provider_failure_count:1,retry_count:1,average_latency_ms:1250,structured_parse_success_rate:ratio(5,6),reviewed:10,
    acceptance_rate:ratio(7,10),edit_rate:ratio(2,10),reject_rate:ratio(1,10),insufficient_reviewed_samples:true,average_teacher_rating:4.3,teacher_rating_count:10},
  support:{sessions:4,resolved_by_ai_count:0,escalated_count:2,escalation_rate:ratio(2,4),retrieval_hit_rate:ratio(1,2),kb_not_found_count:1,
    provider_failure_count:1,average_response_latency_ms:870,helpful_rate:ratio(0,2)},
  rate_limit_errors:0,
  health:{provider:'gemini-openai-compatible',configured:true,question_model:'configured',support_model:'configured',
    last_success_at:'2026-10-18T14:08:00Z',last_error_at:'2026-10-18T14:09:00Z',last_error_code:'AI_PROVIDER_UNAVAILABLE',provider_tier:'configured externally'},
};

export async function activitySession(page:Page,data:ActivityData = structuredClone(activitySample)) {
  await page.clock.setFixedTime(new Date('2026-10-22T14:30:00Z'));
  await uiSession(page,'admin');
  await page.context().addCookies([{name:'auth_token',value:`fixture.${Buffer.from(JSON.stringify({role:'admin'})).toString('base64url')}.fixture`,url:process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000'}]);
  const state={data,status:200,requests:[] as string[],exportFailure:false};
  await page.route('**/api/v1/admin/ai-support/**',async route=>{
    const headers={'access-control-allow-origin':route.request().headers().origin??'http://localhost:3000','access-control-allow-credentials':'true','access-control-allow-headers':'authorization,content-type','access-control-allow-methods':'GET,OPTIONS'};
    if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
    const path=new URL(route.request().url()).pathname;
    state.requests.push(route.request().url());
    if(path.includes('/export/'))return state.exportFailure
      ? route.fulfill({status:503,headers,json:{error:{code:'AI_PROVIDER_UNAVAILABLE',message:'fixture-only-secret'}}})
      : route.fulfill({headers,contentType:'text/csv',body:'timestamp,requested,generated\n2026-10-22,30,22\n'});
    if(path.endsWith('/articles'))return route.fulfill({headers,json:{data:{articles:[],categories:{student:[],teacher:[]},routes:{student:[],teacher:[]}}}});
    return route.fulfill({status:state.status,headers,json:state.status===200?{data:state.data}:{error:{code:'AI_PROVIDER_UNAVAILABLE',message:'fixture-only-secret SQL password=test'}}});
  });
  return state;
}
