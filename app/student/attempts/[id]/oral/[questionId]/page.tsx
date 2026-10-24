import {redirect} from 'next/navigation';

export default async function RetiredOralAttempt({params}:{params:Promise<{id:string;questionId:string}>}){
  const { id } = await params;
  redirect(`/student/attempts/${encodeURIComponent(id)}`);
}
