from datetime import datetime, timezone
from unittest import TestCase
from unittest.mock import patch
from uuid import uuid4
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from app.models.entities import AuditLog, Notification, ProfileVerificationRequest, StudentCardReference, User, UserRole
from app.services import student_card_admin as management, student_card_identity as identity
from tests import test_student_card_api as fixtures


class CardAdminTests(TestCase):
    setUp = fixtures.CardAPITests.setUp
    make_student = fixtures.CardAPITests.make_student
    headers = fixtures.CardAPITests.headers
    upload = fixtures.CardAPITests.upload
    preview = fixtures.CardAPITests.preview
    confirm = fixtures.CardAPITests.confirm

    def endpoint(self, suffix='', student=None):
        return f'/api/v1/admin/student-cards/{(student or self.user).id}{suffix}'

    def detail(self):
        response = self.client.get(self.endpoint(), headers=self.headers(self.admin))
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()['data']

    def snapshot(self, reason='Ảnh thẻ cần cập nhật.'):
        data = self.detail()
        return {'identity_profile_version': data['identity_profile_version'], 'card_admin_version': data['card_admin_version'],
            'reference_id': data['reference']['id'] if data['reference'] else None, 'reason': reason}

    def action(self, action='revoke', body=None, actor=None):
        return self.client.post(self.endpoint('/' + action), headers=self.headers(actor or self.admin), json=body if body is not None else self.snapshot())

    def verified(self):
        response = self.confirm(self.preview())
        self.assertEqual(response.status_code, 200, response.text)
        return self.db.scalar(select(StudentCardReference).where(StudentCardReference.status == 'ACTIVE'))

    def test_confirmation_records_actual_actor_versions_and_audits(self):
        ref = self.verified()
        data = self.detail()
        self.assertEqual(ref.verified_by_user_id, self.user.id)
        self.assertEqual(ref.verified_by_role, 'student')
        self.assertEqual(ref.verification_source, 'STUDENT_SELF_CONFIRM')
        self.assertTrue(all(data['reference'][key] for key in ('ocr_model_version', 'parser_version', 'matching_version', 'face_model_version')))
        audit = list(self.db.scalars(management.history_query(self.user.id)))
        self.assertEqual({row.action for row in audit}, {'CARD_VERIFIED', 'CARD_NOTIFICATION_SENT'})
        self.assertTrue(all(row.user_id == self.user.id and row.metadata_json['actor_role'] == 'student' for row in audit))
        self.assertNotIn('embedding', str(data).lower())
        self.assertNotIn('image_key', str(data).lower())
        image = self.client.get(data['face_preview_url'], headers=self.headers(self.admin))
        self.assertEqual(image.content, b'clean-face')
        self.assertEqual(image.headers['cache-control'], 'no-store')

    def test_all_admin_endpoints_enforce_role_on_server(self):
        self.verified()
        teacher = User(id=uuid4(), full_name='Synthetic Teacher', email='teacher@example.test', password_hash='unused', role=UserRole.teacher)
        self.db.add(teacher); self.db.commit()
        for actor in (self.user, self.other, teacher):
            for path in ('/api/v1/admin/student-cards', self.endpoint(), self.endpoint('/history'), self.detail()['face_preview_url']):
                self.assertEqual(self.client.get(path, headers=self.headers(actor)).status_code, 403)
            for action in ('revoke', 'request-update'):
                self.assertEqual(self.action(action, actor=actor).status_code, 403)
            self.assertEqual(self.client.post(self.endpoint('/notifications'), headers=self.headers(actor), json={'title': 'Thẻ', 'message': 'Cập nhật'}).status_code, 403)
        self.assertEqual(self.client.get('/api/v1/admin/student-cards').status_code, 401)
        self.admin.is_active = False; self.db.commit()
        self.assertEqual(self.client.get(self.endpoint(), headers=self.headers(self.admin)).status_code, 401)

    def test_revoke_blocks_reference_old_pending_preview_and_face_photo(self):
        ref = self.verified(); original_version = self.user.identity_profile_version
        photo_url = self.detail()['face_preview_url']; pending = self.preview()
        response = self.action()
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['data']['management_status'], 'REVOKED')
        self.db.refresh(ref)
        self.assertEqual(ref.status, 'INVALIDATED'); self.assertIsNone(ref.sanitized_face)
        self.assertEqual(ref.revoked_by, self.admin.id); self.assertIsNotNone(ref.revoked_at)
        self.assertEqual(ref.revoke_reason, 'Ảnh thẻ cần cập nhật.')
        self.assertEqual(self.user.identity_profile_version, original_version)
        self.assertIsNone(identity.active_reference(self.db, self.user))
        with self.assertRaises(HTTPException) as error:
            identity.require_reference(self.db, self.user)
        self.assertEqual(error.exception.detail['code'], 'REFERENCE_REQUIRED')
        self.assertEqual(self.confirm(pending).status_code, 409)
        self.assertEqual(self.client.get(photo_url, headers=self.headers(self.admin)).status_code, 404)
        status = self.client.get('/api/v1/identity/student-card/status', headers=self.headers()).json()['data']
        self.assertFalse(status['has_reference']); self.assertTrue(status['was_revoked']); self.assertEqual(status['update_reason'], ref.revoke_reason)
        self.assertEqual(status['reference_status'], 'INVALIDATED')
        self.assertFalse(status['update_requested'])

    def test_request_update_replacement_restores_trust_but_not_previous_version(self):
        from types import SimpleNamespace
        from app.api.v1.identity import verification_is_current
        previous = self.verified()
        verification = SimpleNamespace(status='verified', reference_version=previous.id, created_at=datetime.now(timezone.utc))
        self.assertTrue(verification_is_current(verification, previous, datetime.now(timezone.utc)))
        self.assertEqual(self.action('request-update').status_code, 200)
        self.assertEqual(self.user.student_card_status, 'NEEDS_REUPLOAD')
        self.assertIsNone(identity.active_reference(self.db, self.user))
        status = self.client.get('/api/v1/identity/student-card/status', headers=self.headers()).json()['data']
        self.assertEqual(status['reference_status'], 'INVALIDATED')
        self.assertTrue(status['update_requested'])
        self.assertEqual(self.confirm(self.preview()).status_code, 200)
        current = identity.require_reference(self.db, self.user)
        self.assertNotEqual(current.id, previous.id)
        self.db.refresh(previous); self.assertEqual(previous.status, 'INVALIDATED')
        self.assertFalse(verification_is_current(verification, previous, datetime.now(timezone.utc)))
        self.assertFalse(verification_is_current(verification, current, datetime.now(timezone.utc)))
        self.assertIsNone(self.user.card_update_reason)
        actions = list(self.db.scalars(management.history_query(self.user.id)))
        self.assertIn('CARD_REPLACED', [row.action for row in actions])
        self.assertIn('CARD_UPDATE_REQUESTED', [row.action for row in actions])

    def test_stale_admin_action_cannot_revoke_new_reference_or_new_profile(self):
        self.verified(); body = self.snapshot()
        self.assertEqual(self.confirm(self.preview()).status_code, 200)
        response = self.action(body=body)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()['error']['code'], 'CARD_CHANGED')
        self.assertIsNotNone(identity.active_reference(self.db, self.user))
        body = self.snapshot(); body['identity_profile_version'] += 1
        self.assertEqual(self.action(body=body).status_code, 409)

    def test_revocation_during_face_inference_cannot_commit_old_preview(self):
        self.verified(); pending = self.preview(); body = self.snapshot()
        def revoke_during_inference(*args, **kwargs):
            self.assertEqual(self.action(body=body).status_code, 200)
            return self.vector
        self.face.extract_embedding.side_effect = revoke_during_inference
        self.assertEqual(self.confirm(pending).status_code, 409)
        self.assertIsNone(identity.active_reference(self.db, self.user))

    def test_request_update_during_ocr_cannot_publish_old_preview(self):
        self.verified(); body = self.snapshot(); original_ocr = self.ocr.return_value
        def update_during_ocr(*args):
            self.assertEqual(self.action('request-update', body).status_code, 200)
            return original_ocr
        self.ocr.side_effect = update_during_ocr
        response = self.upload()
        self.assertEqual(response.status_code, 409, response.text)
        self.assertEqual(self.user.student_card_status, 'NEEDS_REUPLOAD')

    def test_required_reason_untrusted_fields_and_recipient_are_rejected(self):
        ref = self.verified(); body = self.snapshot()
        for values in ({'reason': ''}, {'reason': '   '}, {'reason': 'x' * 1001}, {'embedding': [1]}, {'reference_version': str(uuid4())}, {'ocr_result': {}}, {'recipient_user_id': str(self.other.id)}, {'card_admin_version': True}):
            self.assertEqual(self.action(body=body | values).status_code, 422)
        self.assertEqual(identity.require_reference(self.db, self.user).id, ref.id)
        response = self.client.post(self.endpoint('/notifications'), headers=self.headers(self.admin), json={'title': 'Thẻ', 'message': 'Cập nhật', 'recipient_user_id': str(self.other.id)})
        self.assertEqual(response.status_code, 422)

    def test_manual_and_automatic_notifications_reach_only_selected_student(self):
        self.verified()
        with patch('app.services.notifications.get_email_sender') as email:
            self.assertEqual(self.action('request-update').status_code, 200)
            response = self.client.post(self.endpoint('/notifications'), headers=self.headers(self.admin), json={'title': ' Đối chiếu thẻ ', 'message': ' Vui lòng cập nhật ảnh. '})
            self.assertEqual(response.status_code, 200, response.text); email.assert_not_called()
        notices = list(self.db.scalars(select(Notification)))
        self.assertTrue(all(row.recipient_user_id == self.user.id and row.related_student_id == self.user.id for row in notices))
        own = self.client.get('/api/v1/notifications', headers=self.headers()).json()['data']
        other = self.client.get('/api/v1/notifications', headers=self.headers(self.other)).json()['data']
        self.assertEqual(len(own), 3); self.assertEqual(other, [])
        self.assertIn('Đối chiếu thẻ', [row['title'] for row in own])
        self.assertEqual(self.client.patch(f'/api/v1/notifications/{own[0]["id"]}/read', headers=self.headers(self.other)).status_code, 404)

    def test_notification_failure_rolls_back_revoke_audit_and_preview_changes(self):
        ref = self.verified(); pending = self.preview(); body = self.snapshot()
        count = len(list(self.db.scalars(management.history_query(self.user.id))))
        with patch.object(management, 'create_notification', side_effect=SQLAlchemyError('synthetic')):
            self.assertEqual(self.action(body=body).status_code, 503)
        self.db.expire_all()
        self.assertEqual(identity.require_reference(self.db, self.user).id, ref.id)
        self.assertEqual(len(list(self.db.scalars(management.history_query(self.user.id)))), count)
        self.assertEqual(self.confirm(pending).status_code, 200)

    def test_search_filters_and_historical_actor_are_truthful(self):
        ref = self.verified()
        ref.verification_source = 'SYSTEM_MIGRATION'; ref.verified_by_user_id = None; ref.verified_by_role = None
        self.db.commit()
        data = self.detail()['reference']
        self.assertEqual(data['verification_source'], 'SYSTEM_MIGRATION'); self.assertIsNone(data['verified_by_user_id'])
        for q in (self.user.student_code, self.user.email, self.user.full_name):
            response = self.client.get('/api/v1/admin/student-cards', params={'q': q}, headers=self.headers(self.admin))
            self.assertEqual(response.status_code, 200, response.text)
            self.assertIn(str(self.user.id), [row['student_id'] for row in response.json()['data']])
        self.assertEqual(self.action().status_code, 200)
        revoked = self.client.get('/api/v1/admin/student-cards?status=REVOKED', headers=self.headers(self.admin)).json()
        needs = self.client.get('/api/v1/admin/student-cards?status=NEEDS_REUPLOAD', headers=self.headers(self.admin)).json()
        self.assertEqual(revoked['meta']['total'], 1); self.assertEqual(needs['meta']['total'], 0)
        self.assertEqual(self.client.get('/api/v1/admin/student-cards?q=%25', headers=self.headers(self.admin)).json()['data'], [])

    def test_admin_profile_change_increments_profile_and_notifies_without_restoring_card(self):
        ProfileVerificationRequest.__table__.create(self.engine)
        ref = self.verified(); version = self.user.identity_profile_version
        response = self.client.patch(f'/api/v1/users/{self.user.id}', headers=self.headers(self.admin), json={'full_name': 'Nguyễn Văn Khác'})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.user.identity_profile_version, version + 1)
        self.assertEqual(self.user.identity_profile_status, 'PENDING')
        self.assertEqual(self.user.student_card_status, 'NEEDS_REUPLOAD')
        self.assertIsNone(identity.active_reference(self.db, self.user))
        self.db.refresh(ref); self.assertEqual(ref.status, 'INVALIDATED')
        self.assertIn('CARD_UPDATE_REQUESTED', [row.action for row in self.db.scalars(management.history_query(self.user.id))])
        self.assertEqual(len(list(self.db.scalars(select(Notification)))), 2)

    def test_repeat_revoke_preserves_original_revocation_metadata_and_history(self):
        ref = self.verified()
        self.assertEqual(self.action().status_code, 200)
        self.db.refresh(ref); revoked_at = ref.revoked_at
        event_count = len(list(self.db.scalars(management.history_query(self.user.id))))
        self.assertEqual(self.action(body=self.snapshot('Lý do mới')).status_code, 409)
        self.db.refresh(ref)
        self.assertEqual(ref.revoked_at, revoked_at)
        self.assertEqual(ref.revoke_reason, 'Ảnh thẻ cần cập nhật.')
        self.assertEqual(len(list(self.db.scalars(management.history_query(self.user.id)))), event_count)

    def test_user_management_deep_link_data_is_admin_only_and_has_no_password(self):
        path = f'/api/v1/users/{self.user.id}'
        response = self.client.get(path, headers=self.headers(self.admin))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['data']['id'], str(self.user.id))
        self.assertNotIn('password_hash', response.json()['data'])
        self.assertEqual(self.client.get(path, headers=self.headers()).status_code, 403)
        self.assertEqual(self.client.get(self.endpoint(student=self.admin), headers=self.headers(self.admin)).status_code, 404)
        self.assertEqual(self.client.post(self.endpoint('/notifications', self.admin), headers=self.headers(self.admin), json={'title': 'Thẻ', 'message': 'Thẻ mới'}).status_code, 404)
