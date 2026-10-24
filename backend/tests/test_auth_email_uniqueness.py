from unittest import TestCase
from unittest.mock import patch
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.api.v1 import auth
from app.core.database import get_db
from app.core.security import hash_password
from app.main import app
from app.models.entities import User, UserRole


class EmailUniquenessTests(TestCase):
    emails = ('student@example.com', 'Student@Example.com', 'STUDENT@EXAMPLE.COM')
    password = 'synthetic-password'

    def setUp(self):
        engine = create_engine('sqlite://', poolclass=StaticPool,
                               connect_args={'check_same_thread': False})
        self.addCleanup(engine.dispose)
        with engine.connect() as connection:
            connection.connection.create_function('gen_random_uuid', 0, lambda: uuid4().hex)
        User.__table__.create(engine)
        self.db = self.enterContext(Session(engine))
        self.enterContext(patch.dict(app.dependency_overrides, {get_db: lambda: self.db}))
        self.enterContext(patch.dict(auth._failed_logins, {}, clear=True))
        self.enterContext(patch.object(auth, 'record_audit'))
        self.client = self.enterContext(TestClient(app))

    def register(self, email):
        return self.client.post('/api/v1/auth/register', json={
            'full_name': 'Synthetic Student', 'email': email, 'password': self.password,
        })

    def test_registration_variants_share_one_account_and_can_all_log_in(self):
        for index, email in enumerate(self.emails):
            with self.subTest(email=email):
                response = self.register(email)
                self.assertEqual(response.status_code, 200 if index == 0 else 409)
                if index:
                    self.assertEqual(response.json()['error']['code'], 'EMAIL_EXISTS')
                    self.assertNotIn('set-cookie', response.headers)
                login = self.client.post('/api/v1/auth/login', json={
                    'email': email, 'password': self.password,
                })
                self.assertEqual(login.status_code, 200)
                self.assertEqual(login.json()['user']['email'], self.emails[0])
        self.assertEqual(self.db.scalar(select(func.count()).select_from(User)), 1)

    def test_existing_mixed_case_email_cannot_be_registered_again(self):
        self.db.add(User(full_name='Existing Student', email=self.emails[1],
                         password_hash=hash_password(self.password),
                         role=UserRole.student, is_active=True))
        self.db.commit()
        for email in self.emails:
            with self.subTest(email=email):
                response = self.register(email)
                self.assertEqual(response.status_code, 409)
                self.assertEqual(response.json()['error']['code'], 'EMAIL_EXISTS')
                self.assertNotIn('set-cookie', response.headers)
        self.assertEqual(self.db.scalar(select(func.count()).select_from(User)), 1)
