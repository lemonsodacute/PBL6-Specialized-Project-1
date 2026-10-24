import type { Answer, ExamAttempt, JsonValue } from '@/types';
import { attempts as seedAttempts } from './attempts';
import { answers as seedAnswers } from './answers';

let runtimeAttempts = [...seedAttempts];
let runtimeAnswers = [...seedAnswers];

export const getRuntimeAttempts = () => runtimeAttempts;
export const getRuntimeAnswers = () => runtimeAnswers;

export function addRuntimeAttempt(attempt: ExamAttempt) {
  runtimeAttempts = [...runtimeAttempts, attempt];
  return attempt;
}

export function updateRuntimeAttempt(id: string, patch: Partial<ExamAttempt>) {
  runtimeAttempts = runtimeAttempts.map((attempt) => attempt.id === id ? { ...attempt, ...patch, updated_at: new Date().toISOString() } : attempt);
}

export function upsertRuntimeAnswer(answer: Answer) {
  const exists = runtimeAnswers.some((item) => item.id === answer.id);
  runtimeAnswers = exists ? runtimeAnswers.map((item) => item.id === answer.id ? answer : item) : [...runtimeAnswers, answer];
}

export function createRuntimeAnswer(attemptId: string, questionId: string, answerContent: JsonValue): Answer {
  const now = new Date().toISOString();
  const answer: Answer = { id: `answer-local-${attemptId}-${questionId}`, attempt_id: attemptId, question_id: questionId, answer_content: answerContent, is_correct: null, points_awarded: null, graded_by: null, graded_at: null, answered_at: now, updated_at: now };
  upsertRuntimeAnswer(answer);
  return answer;
}
