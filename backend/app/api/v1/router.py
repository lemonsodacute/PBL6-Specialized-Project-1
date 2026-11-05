from fastapi import APIRouter
from app.api.v1 import chat
from app.api.v1 import class_recordings
from app.api.v1 import proctor_alerts
from app.api.v1 import support_assistant
from app.api.v1 import ai_management
from app.api.v1 import ai_provider
from app.api.v1 import student_card
from app.api.v1 import settings
from app.api.v1 import student_card_admin
from app.api.v1 import profile_avatar
from app.api.v1 import teacher_profile
from app.api.v1 import question_images
from app.api.v1 import profile_requests
from app.api.v1 import health, auth, users, exams, attempts, violations, reports, proctoring, question_banks, classes, live_classes, assignments, answers, dashboard, audit_logs, notifications, calls, webrtc_config, identity
router=APIRouter()
router.include_router(chat.router, tags=['support-chat'])
router.include_router(support_assistant.router, tags=['support-assistant'])
router.include_router(ai_management.router, tags=['ai-evaluation'])
router.include_router(ai_provider.router, tags=['ai-provider'])
router.include_router(settings.router, tags=['settings'])
router.include_router(profile_avatar.router, tags=['profile-avatar'])
router.include_router(teacher_profile.router, tags=['teacher-profile'])
router.include_router(student_card_admin.router, tags=['student-card-admin'])
router.include_router(question_images.router, tags=['question-images'])
router.include_router(health.router)
router.include_router(auth.router,prefix='/auth',tags=['auth'])
router.include_router(users.router,prefix='/users',tags=['users'])
router.include_router(profile_requests.router,tags=['profile-verification'])
router.include_router(exams.router,prefix='/exams',tags=['exams'])
router.include_router(attempts.router,prefix='/attempts',tags=['attempts'])
router.include_router(violations.router,tags=['violations'])
router.include_router(reports.router,tags=['reports'])
router.include_router(dashboard.router,tags=['dashboard'])
router.include_router(audit_logs.router,tags=['audit'])
router.include_router(proctoring.router,prefix='/proctoring',tags=['proctoring'])
router.include_router(proctor_alerts.router,prefix='/proctoring',tags=['proctoring-alerts'])
router.include_router(question_banks.router,prefix='/question-banks',tags=['question-banks'])
router.include_router(classes.router,prefix='/classes',tags=['classes'])
router.include_router(live_classes.router,prefix='/live-classes',tags=['live-classes'])
router.include_router(class_recordings.router,tags=['class-recordings'])
router.include_router(assignments.router,prefix='/exam-assignments',tags=['exam-assignments'])
router.include_router(answers.router,tags=['answers'])
router.include_router(notifications.router,tags=['notifications'])
router.include_router(webrtc_config.router,tags=['config'])
router.include_router(identity.router,prefix='/identity',tags=['identity'])
router.include_router(student_card.router,prefix='/identity/student-card',tags=['identity'])
# Backward-compatible URL used by the existing frontend monitor client.
router.add_api_websocket_route('/ws/monitor/{exam_id}', proctoring.monitor)
router.add_api_websocket_route('/ws/call/{attempt_id}', calls.relay_call)
