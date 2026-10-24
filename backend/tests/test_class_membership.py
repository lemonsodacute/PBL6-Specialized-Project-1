from unittest import TestCase
from unittest.mock import patch
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.api.v1.classes import enroll_student
from app.models.entities import Class, ClassEnrollment, User, UserRole
from app.schemas.content import EnrollmentCreate
from tests import test_teacher_results as fixtures


class ClassMembershipTests(TestCase):
    def setUp(self):
        self.fixture = fixtures.TeacherResultsTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.db, self.client = self.fixture.db, self.fixture.client
        self.cls, self.teacher = self.fixture.cls, self.fixture.teacher
        self.available = self.fixture.direct
        self.available.full_name = 'Nguyễn Minh Ngọc'
        self.available.student_code = 'AVAILABLE01'
        self.db.commit()
        self.path = f'/api/v1/classes/{self.cls.id}/enrollments'

    def get_available(self, query='', actor=None):
        return self.client.get(self.path + '/available' + query, headers=self.fixture.headers(actor))

    def count(self, student_id):
        return self.db.scalar(select(func.count()).select_from(ClassEnrollment).where(
            ClassEnrollment.class_id == self.cls.id, ClassEnrollment.student_id == student_id))

    def test_available_excludes_entire_roster_before_pagination_and_search(self):
        for index in range(45):
            student = User(id=uuid4(), full_name=f'Nguyễn candidate {index:02}', email=f'candidate-{index}@example.test',
                           student_code=f'CAN{index:03}', password_hash='unused', role=UserRole.student, is_active=True)
            self.db.add(student)
        self.fixture.student.full_name = 'Nguyễn enrolled'
        self.db.commit()
        first = self.get_available('?q=nguyen&page=1&limit=20&sort=name').json()
        third = self.get_available('?q=nguyen&page=3&limit=20&sort=name').json()
        self.assertEqual(first['meta']['total'], 46)
        self.assertEqual(len(first['data']), 20)
        self.assertEqual(len(third['data']), 6)
        self.assertNotIn(str(self.fixture.student.id), {row['id'] for row in first['data'] + third['data']})
        self.assertEqual(self.get_available('?q=REALCODE01').json()['data'], [])
        for query in ('?q=AVAILABLE01', '?q=minh ngoc', f'?q={self.available.email}'):
            response = self.get_available(query)
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual([row['id'] for row in response.json()['data']], [str(self.available.id)])

    def test_available_only_active_students_and_current_class(self):
        other_class = Class(id=uuid4(), name='Other class', homeroom_teacher_id=self.teacher.id)
        self.db.add(other_class); self.db.flush()
        self.db.add(ClassEnrollment(class_id=other_class.id, student_id=self.available.id)); self.db.commit()
        rows = self.get_available().json()['data']
        self.assertEqual([row['id'] for row in rows], [str(self.available.id)])
        self.available.is_active = False; self.db.commit()
        self.assertEqual(self.get_available().json()['meta']['total'], 0)

    def test_add_and_remove_update_both_collections(self):
        headers = self.fixture.headers()
        added = self.client.post(self.path, headers=headers, json={'student_id': str(self.available.id)})
        self.assertEqual(added.status_code, 200, added.text)
        self.assertEqual(self.count(self.available.id), 1)
        self.assertEqual(self.get_available('?q=AVAILABLE01').json()['data'], [])
        members = self.client.get(self.path + '?q=AVAILABLE01', headers=headers).json()
        self.assertEqual(members['meta']['total'], 1)
        removed = self.client.delete(self.path + f'/{self.available.id}', headers=headers)
        self.assertEqual(removed.status_code, 200, removed.text)
        self.assertEqual(self.count(self.available.id), 0)
        self.assertEqual(self.client.get(self.path + '?q=AVAILABLE01', headers=headers).json()['meta']['total'], 0)
        self.assertEqual(self.get_available('?q=AVAILABLE01').json()['data'][0]['id'], str(self.available.id))

    def test_duplicate_returns_conflict_without_new_row(self):
        for actor in (self.teacher, self.fixture.admin):
            result = self.client.post(self.path, headers=self.fixture.headers(actor), json={'student_id': str(self.fixture.student.id)})
            self.assertEqual(result.status_code, 409, result.text)
            self.assertEqual(result.json()['error']['code'], 'STUDENT_ALREADY_ENROLLED')
            self.assertEqual(self.count(self.fixture.student.id), 1)

    def test_unique_constraint_rejects_duplicate_even_without_api(self):
        self.db.add(ClassEnrollment(class_id=self.cls.id, student_id=self.fixture.student.id))
        with self.assertRaises(IntegrityError): self.db.commit()
        self.db.rollback()
        self.assertEqual(self.count(self.fixture.student.id), 1)

    def test_race_after_precheck_returns_same_conflict_and_session_recovers(self):
        # The first SELECT sees no membership; the unique constraint sees the
        # row committed by the competing request. Exercise the real DB failure.
        scalar = self.db.scalar
        with patch.object(self.db, 'scalar', side_effect=[None, scalar(select(ClassEnrollment.id).where(
                ClassEnrollment.class_id == self.cls.id, ClassEnrollment.student_id == self.fixture.student.id))]):
            with self.assertRaises(HTTPException) as caught:
                enroll_student(self.cls.id, EnrollmentCreate(student_id=self.fixture.student.id), self.db, self.teacher)
        self.assertEqual(caught.exception.status_code, 409)
        self.assertEqual(caught.exception.detail['code'], 'STUDENT_ALREADY_ENROLLED')
        self.assertEqual(self.count(self.fixture.student.id), 1)
        response = self.client.post(self.path, headers=self.fixture.headers(), json={'student_id': str(self.available.id)})
        self.assertEqual(response.status_code, 200, response.text)

    def test_unrelated_integrity_failure_is_not_duplicate(self):
        with patch.object(self.db, 'commit', side_effect=IntegrityError('unrelated', {}, Exception('failure'))):
            with self.assertRaises(IntegrityError):
                enroll_student(self.cls.id, EnrollmentCreate(student_id=self.available.id), self.db, self.teacher)
        self.assertEqual(self.count(self.available.id), 0)

    def test_existing_permissions_are_preserved(self):
        for actor, status in ((self.fixture.other, 404), (self.fixture.student, 403)):
            self.assertEqual(self.get_available(actor=actor).status_code, status)
            result = self.client.post(self.path, headers=self.fixture.headers(actor), json={'student_id': str(self.available.id)})
            self.assertEqual(result.status_code, status)
        self.assertEqual(self.get_available(actor=self.fixture.admin).status_code, 200)
        self.assertEqual(self.count(self.available.id), 0)
