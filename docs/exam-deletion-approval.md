# Teacher-authorized deletion of completed exams

## Workflow
1. The original Teacher may request Admin deletion only for an exam with existing attempts, after the exam ends or closes and all attempts are finished.
2. The Teacher supplies a 10–500-character reason. The API stores a PENDING request in the exam's protected internal JSON settings and audits it.
3. Teacher can cancel while pending; Admin alone can approve or reject.
4. Approval checks the original Teacher identity, request status, unchanged attempt count/end time, and no active attempts.
5. Approval sets exams.deleted_at (soft deletion), not a hard SQL deletion. Exam attempts, answers, scores, and AI evidence remain in PostgreSQL. Admin action is audited.
6. The exam disappears from regular exam catalogs. Historical records remain in the database, but this PR does not add a separate archive browser or restore interface.

## API and guards
- POST /api/v1/exams/{exam_id}/deletion-request : owning Teacher only; JSON body contains reason.
- DELETE /api/v1/exams/{exam_id}/deletion-request : owning Teacher cancel.
- POST /api/v1/exams/{exam_id}/deletion-request/review : Admin only; JSON body includes approve boolean and optional note.
- DELETE /api/v1/exams/{exam_id} remains forbidden when any attempt exists, even for Admin.
- Generic exam creation and updates cannot set the reserved _admin_deletion_request metadata; only audited workflow routes may change it.
- Source of truth is current database state, not a frontend flag.

## Verification on Windows
1. cd backend
2. .\.venv\Scripts\python.exe -m pytest tests/test_exam_deletion_request.py tests/test_teacher_results.py -q
3. cd ..
4. npx tsc --noEmit
5. npx playwright test tests/e2e/exam-actions.spec.ts

Do not merge before these tests pass on your repository checkout. This is not physical erasure of submitted exam data and does not change student exam grading.
