from unittest import TestCase
from unittest import skipUnless
from unittest.mock import patch
from uuid import UUID, uuid4
import os
from pathlib import Path
from alembic.config import Config
from alembic.script import ScriptDirectory
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, text
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from app.models.entities import AuditLog, Notification, ProfileVerificationRequest, StudentCardReference, StudentFaceEmbedding, User, UserRole
from app.services import profile_avatar as avatars, student_card_identity as cards
from app.services.student_identity_profile import update_profile
from tests import test_student_card_api as fixtures


@skipUnless(os.environ.get('AVATAR_TEST_POSTGRES') == '1', 'Opt-in PostgreSQL avatar migration test in temporary tables')
class AvatarMigrationTests(TestCase):
    def test_backfill_current_confirmed_face_only_and_fk_privacy_cleanup(self):
        from app.core.config import settings
        engine = create_engine(settings.DATABASE_URL)
        self.addCleanup(engine.dispose)
        config = Config(str(Path(__file__).resolve().parents[1] / 'alembic.ini'))
        config.set_main_option('script_location', str(Path(__file__).resolve().parents[1] / 'alembic'))
        migration = ScriptDirectory.from_config(config).get_revision('0015_student_card_avatar').module
        with engine.begin() as connection:
            # All unqualified objects below resolve ONLY to this connection's temp schema.
            # Real application tables and data cannot be addressed by this migration run.
            connection.execute(text('SET LOCAL search_path TO pg_temp'))
            connection.execute(text('''CREATE TEMP TABLE users (id uuid PRIMARY KEY, role text, is_active boolean,
                identity_profile_status text, student_card_status text, identity_profile_version integer, avatar_url text) ON COMMIT DROP'''))
            connection.execute(text('''CREATE TEMP TABLE student_card_references (id uuid PRIMARY KEY, student_id uuid,
                identity_profile_version integer, status text, sanitized_face bytea, created_at timestamptz) ON COMMIT DROP'''))
            connection.execute(text('''CREATE TEMP TABLE student_face_embeddings (student_id uuid, reference_version uuid) ON COMMIT DROP'''))
            ids = []
            for status, ref_status, face in (('VERIFIED', 'ACTIVE', b'face'), ('PENDING_CONFIRMATION', 'ACTIVE', b'face'), ('VERIFIED', 'INVALIDATED', b'face'), ('VERIFIED', 'ACTIVE', None)):
                user_id, ref_id = uuid4(), uuid4(); ids.append((user_id, ref_id))
                connection.execute(text("INSERT INTO users VALUES (:id, 'student', true, 'VERIFIED', :status, 1, NULL)"), {'id': user_id, 'status': status})
                connection.execute(text('INSERT INTO student_card_references VALUES (:id, :student, 1, :status, :face, now())'), {'id': ref_id, 'student': user_id, 'status': ref_status, 'face': face})
                connection.execute(text('INSERT INTO student_face_embeddings VALUES (:student, :ref)'), {'student': user_id, 'ref': ref_id})
            with Operations.context(MigrationContext.configure(connection)):
                migration.upgrade()
            rows = connection.execute(text('SELECT id, avatar_source, avatar_reference_id, avatar_url FROM users')).all()
            derived = [row for row in rows if row.avatar_source == 'STUDENT_CARD']
            self.assertEqual(len(derived), 1)
            self.assertEqual(derived[0].id, ids[0][0]); self.assertEqual(derived[0].avatar_reference_id, ids[0][1])
            self.assertEqual(derived[0].avatar_url, f'/api/v1/users/{ids[0][0]}/avatar/{ids[0][1]}')
            connection.execute(text('DELETE FROM student_card_references WHERE id=:id'), {'id': ids[0][1]})
            self.assertIsNone(connection.scalar(text('SELECT avatar_reference_id FROM users WHERE id=:id'), {'id': ids[0][0]}))
            with Operations.context(MigrationContext.configure(connection)):
                migration.downgrade()
            self.assertEqual(connection.scalar(text('SELECT count(*) FROM users')), 4)
            self.assertEqual(connection.scalar(text('SELECT count(*) FROM users WHERE avatar_url IS NOT NULL')), 0)
            self.assertEqual(connection.scalar(text('SELECT count(*) FROM student_card_references')), 3)


class ProfileAvatarTests(TestCase):
    setUp = fixtures.CardAPITests.setUp
    make_student = fixtures.CardAPITests.make_student
    headers = fixtures.CardAPITests.headers
    upload = fixtures.CardAPITests.upload
    preview = fixtures.CardAPITests.preview
    confirm = fixtures.CardAPITests.confirm

    def profile(self, actor=None):
        response = self.client.get('/api/v1/auth/me', headers=self.headers(actor))
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()['user']

    def verified(self):
        result = self.confirm(self.preview())
        self.assertEqual(result.status_code, 200, result.text)
        return cards.require_reference(self.db, self.user)

    def action(self, action='revoke'):
        reference = cards.require_reference(self.db, self.user)
        return self.client.post(f'/api/v1/admin/student-cards/{self.user.id}/{action}', headers=self.headers(self.admin), json={
            'reference_id': str(reference.id), 'identity_profile_version': self.user.identity_profile_version,
            'card_admin_version': self.user.card_admin_version, 'reason': 'Cần cập nhật thẻ.'})

    def test_preview_never_sets_avatar_and_confirmation_reuses_exact_sanitized_face(self):
        preview = self.preview()
        self.assertIsNone(self.user.avatar_source)
        self.assertIsNone(self.profile()['avatar_url'])
        response = self.confirm(preview)
        self.assertEqual(response.status_code, 200, response.text)
        ref = cards.require_reference(self.db, self.user)
        self.db.refresh(self.user)
        self.assertEqual(self.user.avatar_source, 'STUDENT_CARD')
        self.assertEqual(self.user.avatar_reference_id, ref.id)
        self.assertIsNotNone(self.user.avatar_updated_at)
        profile = self.profile()
        self.assertEqual(profile['avatar_reference_id'], str(ref.id))
        self.assertEqual(profile['avatar_url'], self.user.avatar_url)
        image = self.client.get(profile['avatar_url'], headers=self.headers())
        self.assertEqual(image.status_code, 200)
        self.assertEqual(image.content, ref.sanitized_face)
        self.assertEqual(image.content, b'clean-face')
        self.assertEqual(image.headers['content-type'], 'image/jpeg')
        self.assertEqual(image.headers['cache-control'], 'no-store')
        self.assertEqual(image.headers['x-content-type-options'], 'nosniff')
        self.face.prepare_card.assert_called_once()
        self.face.extract_embedding.assert_called_once()
        self.assertNotIn('embedding', str(profile)); self.assertNotIn('image_key', str(profile))

    def test_protected_avatar_is_owner_or_admin_only_and_admin_uses_same_source(self):
        self.verified(); profile = self.profile(); url = profile['avatar_url']
        teacher = User(id=uuid4(), full_name='Synthetic Teacher', email='teacher@example.test', password_hash='unused', role=UserRole.teacher)
        self.db.add(teacher); self.db.commit()
        self.assertEqual(self.client.get(url).status_code, 401)
        self.assertEqual(self.client.get(url, headers=self.headers(self.other)).status_code, 403)
        self.assertEqual(self.client.get(url, headers=self.headers(teacher)).status_code, 403)
        self.assertEqual(self.client.get(url, headers=self.headers(self.admin)).content, b'clean-face')
        admin_profile = self.client.get(f'/api/v1/users/{self.user.id}', headers=self.headers(self.admin)).json()['data']
        admin_card = self.client.get(f'/api/v1/admin/student-cards/{self.user.id}', headers=self.headers(self.admin)).json()['data']
        for view in (admin_profile, admin_card):
            self.assertEqual(view['avatar_url'], url)
            self.assertEqual(view['avatar_reference_id'], profile['avatar_reference_id'])
        self.user.is_active = False; self.db.commit()
        self.assertEqual(self.client.get(url, headers=self.headers(self.admin)).status_code, 404)

    def test_replacement_changes_avatar_url_and_old_image_becomes_unavailable(self):
        first = self.verified(); old = self.profile(); embedding = self.db.scalar(select(StudentFaceEmbedding))
        template_before = embedding.embedding
        self.face.prepare_card.return_value = (b'new-clean-card', b'new-clean-face')
        second = self.verified(); new = self.profile()
        self.assertNotEqual(first.id, second.id)
        self.assertNotEqual(new['avatar_url'], old['avatar_url'])
        self.assertEqual(self.user.avatar_reference_id, second.id)
        self.assertEqual(self.client.get(old['avatar_url'], headers=self.headers()).status_code, 404)
        self.assertEqual(self.client.get(new['avatar_url'], headers=self.headers()).content, b'new-clean-face')
        self.db.refresh(embedding); self.assertEqual(embedding.embedding, template_before)
        self.assertEqual(embedding.reference_version, second.id)

    def test_revoke_and_request_update_clear_avatar_then_new_confirm_restores_it(self):
        for action in ('revoke', 'request-update'):
            self.verified(); before = self.profile()
            result = self.action(action)
            self.assertEqual(result.status_code, 200, result.text)
            self.db.refresh(self.user)
            for field in ('avatar_url', 'avatar_source', 'avatar_reference_id', 'avatar_updated_at'):
                self.assertIsNone(getattr(self.user, field)); self.assertIsNone(self.profile()[field])
            self.assertEqual(self.client.get(before['avatar_url'], headers=self.headers(self.admin)).status_code, 404)
            self.assertEqual(self.confirm(self.preview()).status_code, 200)
            self.assertIsNotNone(self.profile()['avatar_url'])

    def test_authoritative_identity_change_removes_avatar(self):
        self.verified(); url = self.profile()['avatar_url']; version = self.user.identity_profile_version
        update_profile(self.db, self.user, {'full_name': 'Nguyễn Văn Mới'})
        self.db.commit()
        self.assertEqual(self.user.identity_profile_version, version + 1)
        self.assertIsNone(self.user.avatar_reference_id); self.assertIsNone(self.profile()['avatar_url'])
        self.assertEqual(self.client.get(url, headers=self.headers(self.admin)).status_code, 404)

    def test_metadata_failure_after_identity_commit_does_not_fail_confirmation(self):
        preview = self.preview(); commit = self.db.commit; calls = 0
        def fail_avatar_commit():
            nonlocal calls
            calls += 1
            if calls == 2:
                raise SQLAlchemyError('synthetic avatar failure')
            commit()
        with patch.object(self.db, 'commit', side_effect=fail_avatar_commit):
            response = self.confirm(preview)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.json()['data']['has_reference'])
        self.db.refresh(self.user); self.assertIsNone(self.user.avatar_reference_id)
        profile = self.profile(); ref = cards.require_reference(self.db, self.user)
        self.assertEqual(profile['avatar_reference_id'], str(ref.id))
        self.assertEqual(self.client.get(profile['avatar_url'], headers=self.headers()).content, ref.sanitized_face)
        avatars.sync_card_avatar(self.db, self.user.id, ref.id)
        self.assertEqual(self.user.avatar_reference_id, ref.id)

    def test_delayed_old_avatar_sync_cannot_overwrite_new_reference(self):
        old = self.verified(); new = self.verified()
        avatars.sync_card_avatar(self.db, self.user.id, old.id)
        self.db.refresh(self.user); self.assertEqual(self.user.avatar_reference_id, new.id)

    def test_missing_sanitized_face_or_deleted_reference_falls_back_without_files(self):
        ref = self.verified(); old = self.profile()
        ref.sanitized_face = None; self.db.commit()
        self.assertIsNotNone(cards.active_reference(self.db, self.user))
        self.assertIsNone(self.profile()['avatar_url'])
        self.assertEqual(self.client.get(old['avatar_url'], headers=self.headers()).status_code, 404)
        embedding = self.db.scalar(select(StudentFaceEmbedding)); self.db.delete(embedding); self.db.commit()
        self.db.delete(ref); self.db.commit(); self.db.refresh(self.user)
        self.assertIsNone(self.user.avatar_reference_id)
        self.assertIsNone(self.profile()['avatar_source'])

    def test_student_and_admin_cannot_assign_arbitrary_avatar_fields(self):
        ref = self.verified(); before = self.profile()['avatar_url']
        for method in ('POST', 'PUT', 'PATCH', 'DELETE'):
            self.assertEqual(self.client.request(method, before, headers=self.headers(), json={'avatar_url': 'https://example.test/arbitrary.jpg'}).status_code, 405)
        for body in ({'avatar_url': 'https://example.test/image.jpg'}, {'avatar_source': 'STUDENT_CARD'}, {'avatar_reference_id': str(uuid4())}, {'avatar_updated_at': '2026-01-01T00:00:00Z'}):
            self.assertEqual(self.client.patch('/api/v1/auth/me', headers=self.headers(), json=body).status_code, 422)
            self.assertEqual(self.client.patch(f'/api/v1/users/{self.user.id}', headers=self.headers(), json=body).status_code, 403)
            self.assertEqual(self.client.patch(f'/api/v1/users/{self.user.id}', headers=self.headers(self.admin), json=body).status_code, 422)
        self.assertEqual(self.profile()['avatar_url'], before)
        self.assertEqual(cards.require_reference(self.db, self.user).id, ref.id)
