from datetime import datetime, timezone
from unittest import TestCase
from unittest.mock import patch
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from tests import test_student_identity_profile as fixtures
from app.models.entities import Notification, ProfileVerificationRequest
from app.services import profile_requests


class ProfileRequestTests(TestCase):
    # Reuse the isolated API fixture without inheriting/rerunning its tests.
    setUp = fixtures.StudentIdentityProfileTests.setUp
    make_user = fixtures.StudentIdentityProfileTests.make_user
    headers = fixtures.StudentIdentityProfileTests.headers
    update = fixtures.StudentIdentityProfileTests.update
    verify = fixtures.StudentIdentityProfileTests.verify

    def send(self, actor=None, **kwargs):
        return self.client.post('/api/v1/identity/profile-verification/request', headers=self.headers(actor or self.student), **kwargs)

    def status(self, actor=None):
        return self.client.get('/api/v1/identity/profile-verification/status', headers=self.headers(actor or self.student)).json()['data']

    def rows(self):
        return list(self.db.scalars(select(ProfileVerificationRequest).order_by(ProfileVerificationRequest.requested_at)))

    def reject(self, request_id=None, actor=None, **kwargs):
        return self.client.post(f'/api/v1/users/profile-verification/requests/{request_id or self.rows()[-1].id}/reject',
            headers=self.headers(actor), json={'identity_profile_version': self.student.identity_profile_version,
                'rejection_reason': ' MSSV chưa chính xác. ', **kwargs})

    def test_request_is_owned_persistent_idempotent_and_does_not_verify(self):
        self.assertEqual(self.status()['verification_request_status'], 'NOT_REQUESTED')
        first = self.send()
        self.assertEqual(first.status_code, 200, first.text)
        for _ in range(10):
            self.assertEqual(self.send(json={}).json(), first.json())
        self.assertEqual(len(self.rows()), 1)
        self.assertEqual(self.rows()[0].student_id, self.student.id)
        self.assertEqual(self.student.identity_profile_status, 'PENDING')
        self.assertEqual(self.student.student_card_status, 'NOT_SUBMITTED')
        self.db.expire_all()
        self.assertEqual(self.status(), first.json()['data'])
        self.assertEqual(self.status(self.other)['verification_request_status'], 'NOT_REQUESTED')
        self.assertEqual(set(self.status()), {'identity_profile_status', 'verification_request_status', 'verification_requested_at', 'verification_rejection_reason'})

    def test_auth_role_disabled_and_untrusted_fields(self):
        self.assertEqual(self.client.post('/api/v1/identity/profile-verification/request').status_code, 401)
        for actor in (self.admin, self.teacher):
            self.assertEqual(self.send(actor).status_code, 403)
        for body in ({'student_id': str(self.other.id)}, {'role': 'admin'}, {'status': 'COMPLETED'}, {'student_code': '001'}, {'rejection_reason': 'override'}):
            self.assertEqual(self.send(json=body).status_code, 422)
        self.student.is_active = False
        self.db.commit()
        self.assertEqual(self.send().status_code, 401)
        self.assertEqual(self.rows(), [])

    def test_only_active_admins_notified_once_without_email(self):
        second = self.make_user('admin')
        disabled = self.make_user('admin')
        disabled.is_active = False
        self.db.commit()
        with patch('app.services.notifications.get_email_sender') as sender:
            self.send()
            self.send()
            sender.assert_not_called()
        notifications = list(self.db.scalars(select(Notification)))
        self.assertEqual({n.recipient_user_id for n in notifications}, {self.admin.id, second.id})
        self.assertEqual(len(notifications), 2)
        self.assertTrue(all(n.related_student_id == self.student.id for n in notifications))

    def test_queue_and_review_require_admin(self):
        self.send()
        for actor in (self.student, self.teacher):
            self.assertEqual(self.client.get('/api/v1/users/profile-verification/requests', headers=self.headers(actor)).status_code, 403)
            self.assertEqual(self.reject(actor=actor).status_code, 403)
            self.assertEqual(self.verify(actor).status_code, 403)
        queue = self.client.get('/api/v1/users/profile-verification/requests', headers=self.headers()).json()
        self.assertEqual(queue['meta']['total'], 1)
        self.assertEqual(queue['data'][0]['student']['id'], str(self.student.id))
        self.assertNotIn('password_hash', queue['data'][0]['student'])
        other = self.client.get(f'/api/v1/users/profile-verification/requests?student_id={self.other.id}', headers=self.headers()).json()
        self.assertEqual(other['data'], [])

    def test_existing_approval_completes_request_and_notifies_once(self):
        self.send()
        self.assertEqual(self.verify().status_code, 200)
        self.assertIsNone(self.student.student_code)  # Learned only from a confirmed card.
        row = self.rows()[0]
        self.assertEqual(row.status, 'COMPLETED')
        self.assertEqual(row.reviewed_by, self.admin.id)
        self.assertIsNotNone(row.reviewed_at)
        self.assertEqual(self.student.identity_profile_status, 'VERIFIED')
        self.assertEqual(self.student.identity_verified_by, self.admin.id)
        self.assertEqual(self.verify().status_code, 200)
        self.assertEqual(len(list(self.db.scalars(select(Notification).where(Notification.recipient_user_id == self.student.id)))), 1)
        self.assertEqual(self.send().status_code, 409)
        self.assertEqual(self.status()['verification_request_status'], 'NOT_REQUESTED')

    def test_reject_reason_and_resend_preserve_history(self):
        self.send()
        original = self.rows()[0].id
        self.assertEqual(self.reject().status_code, 200)
        state = self.status()
        self.assertEqual(state['verification_request_status'], 'REJECTED')
        self.assertEqual(state['verification_rejection_reason'], 'MSSV chưa chính xác.')
        self.assertEqual(self.student.identity_profile_status, 'PENDING')
        self.assertEqual(self.rows()[0].reviewed_by, self.admin.id)
        self.assertEqual(self.send().status_code, 200)
        self.assertEqual([row.status for row in self.rows()], ['REJECTED', 'PENDING'])
        self.assertIsNone(self.status()['verification_rejection_reason'])
        self.assertEqual(self.reject(request_id=original).status_code, 409)
        self.assertEqual(self.rows()[-1].status, 'PENDING')

    def test_reject_validates_reason_version_and_payload(self):
        self.send()
        for reason in ('', '  ', 'x'*501, 'internal\ntrace', 'bad\x00value'):
            self.assertEqual(self.reject(rejection_reason=reason).status_code, 422)
        self.assertEqual(self.reject(student_id=str(self.other.id)).status_code, 422)
        self.assertEqual(self.reject(identity_profile_version=99).status_code, 409)
        self.assertEqual(self.reject(request_id=uuid4()).status_code, 404)
        self.assertEqual(self.rows()[0].status, 'PENDING')

    def test_profile_edits_preserve_pending_but_completed_never_reverify(self):
        self.send()
        version = self.student.identity_profile_version
        self.update(full_name='Nguyễn Văn An', student_code='001IT123')
        self.assertEqual(self.rows()[0].status, 'PENDING')
        self.assertEqual(self.verify(version=version).status_code, 409)
        self.assertEqual(self.reject(identity_profile_version=version).status_code, 409)
        self.assertEqual(self.verify().status_code, 200)
        self.update(full_name='Nguyễn Văn Bình')
        self.assertEqual(self.student.identity_profile_status, 'PENDING')
        self.assertEqual(self.status()['verification_request_status'], 'NOT_REQUESTED')
        self.assertEqual(self.rows()[0].status, 'COMPLETED')
        self.assertEqual(self.send().status_code, 200)
        self.assertEqual(self.rows()[-1].status, 'PENDING')

    def test_ineligible_account_cancels_pending(self):
        self.send()
        self.assertEqual(self.update(is_active=False).status_code, 200)
        self.assertEqual(self.rows()[0].status, 'CANCELLED')
        self.update(is_active=True)
        self.send()
        self.assertEqual(self.update(role='teacher').status_code, 200)
        self.assertEqual([row.status for row in self.rows()], ['CANCELLED', 'CANCELLED'])

    def test_failed_notification_rolls_back_request_and_hides_internal_error(self):
        with patch.object(profile_requests, 'create_notification', side_effect=SQLAlchemyError('private SQL trace')):
            response = self.send()
        self.assertEqual(response.status_code, 503)
        self.assertNotIn('private SQL trace', response.text)
        self.assertEqual(self.rows(), [])
        self.assertEqual(self.send().status_code, 200)

    def test_database_enforces_one_pending_per_student(self):
        self.send()
        self.db.add(ProfileVerificationRequest(id=uuid4(), student_id=self.student.id, status='PENDING', requested_at=datetime.now(timezone.utc)))
        with self.assertRaises(IntegrityError):
            self.db.commit()
        self.db.rollback()
        self.assertEqual(len(self.rows()), 1)

    def test_notifications_are_recipient_scoped_for_all_roles(self):
        self.send()
        self.reject()
        def notifications(actor):
            return self.client.get('/api/v1/notifications', headers=self.headers(actor)).json()['data']
        admin_notice = notifications(self.admin)[0]
        student_notice = notifications(self.student)[0]
        self.assertEqual(notifications(self.other), [])
        self.assertEqual(notifications(self.teacher), [])
        self.assertEqual(self.client.patch(f"/api/v1/notifications/{admin_notice['id']}/read", headers=self.headers(self.student)).status_code, 404)
        self.assertEqual(self.client.patch('/api/v1/notifications/read-all', headers=self.headers(self.student)).json()['data']['updated'], 1)
        self.assertFalse(notifications(self.admin)[0]['is_read'])
        self.assertTrue(notifications(self.student)[0]['is_read'])
        self.assertEqual(self.client.patch(f"/api/v1/notifications/{student_notice['id']}/read", headers=self.headers(self.admin)).status_code, 404)
