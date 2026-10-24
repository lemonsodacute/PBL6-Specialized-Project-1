"""Card/profile atomicity with actual row locks in a disposable database."""
import os
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from tempfile import TemporaryDirectory
from threading import Barrier
from unittest import TestCase, skipUnless
from unittest.mock import patch
from uuid import uuid4
from pathlib import Path

import numpy as np
from fastapi import HTTPException
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.base import Base
from app.models.entities import StudentCardReference, StudentFaceEmbedding, User, UserRole
from app.services import student_card_identity as cards, student_card_previews as previews
from app.services.student_card_matching import PARSER_VERSION, MATCHING_VERSION
from app.services.student_card_ocr import MODEL_VERSION


@skipUnless(os.environ.get('CARD_PROFILE_TEST_POSTGRES') == '1', 'Explicit disposable PostgreSQL card/profile test')
class CardProfilePostgresTests(TestCase):
    @classmethod
    def setUpClass(cls):
        cls.name = 'ai_procto_card_profile_test_'+uuid4().hex
        cls.control = create_engine(settings.DATABASE_URL, isolation_level='AUTOCOMMIT')
        with cls.control.connect() as connection:
            connection.execute(text(f'CREATE DATABASE "{cls.name}"'))
        cls.addClassCleanup(cls.cleanup_database)
        cls.engine = create_engine(cls.control.url.set(database=cls.name))
        cls.addClassCleanup(cls.engine.dispose)
        Base.metadata.create_all(cls.engine)

    @classmethod
    def cleanup_database(cls):
        if not re.fullmatch(r'ai_procto_card_profile_test_[0-9a-f]{32}', cls.name):
            raise RuntimeError('Unexpected scratch database name')
        with cls.control.connect() as connection:
            connection.execute(text(f'DROP DATABASE "{cls.name}"'))
        cls.control.dispose()

    def fields(self, code):
        return ({'full_name': 'Synthetic Student', 'student_code': code, 'class_name': '22T1'},
                {'full_name': .99, 'student_code': .99, 'class_name': .99})

    def preview(self, db, user, code):
        fields, confidence = self.fields(code)
        return previews.create_preview(db, user.id, user.identity_profile_version,
            original=b'synthetic-card', card=b'synthetic-card-preview', face=b'synthetic-sanitized-face',
            extracted=fields, confidence=confidence, validation={},
            ocr_model_version=MODEL_VERSION, parser_version=PARSER_VERSION, matching_version=MATCHING_VERSION)

    def user(self, db):
        user = User(id=uuid4(), full_name='Synthetic Student', email=uuid4().hex+'@example.test',
                    password_hash='unused', role=UserRole.student, is_active=True, student_code=None,
                    identity_profile_status='VERIFIED', identity_verified_at=datetime.now(timezone.utc))
        db.add(user); db.commit()
        return user

    def run_race(self, same_owner):
        code = 'SYN'+uuid4().hex[:12].upper()
        barrier = Barrier(2)
        vector = np.zeros(128, dtype=np.float32); vector[0] = 1
        def infer(*args, **kwargs):
            barrier.wait(timeout=15)
            return vector
        with TemporaryDirectory() as directory, patch.object(previews, 'PREVIEW_ROOT', Path(directory)/'previews'):
            with Session(self.engine, expire_on_commit=False) as db:
                first = self.user(db)
                second = first if same_owner else self.user(db)
                first_preview = self.preview(db, first, code)
                second_preview = first_preview if same_owner else self.preview(db, second, code)
                pairs = [(first.id, first_preview.id), (second.id, second_preview.id)]
                self.assertIsNone(db.get(User, first.id).student_code)
                self.assertIsNone(db.get(User, first.id).class_name)
            def confirm(pair):
                with Session(self.engine, expire_on_commit=False) as db:
                    try:
                        cards.confirm_card(db, db.get(User, pair[0]), pair[1])
                        return 200
                    except HTTPException as error:
                        return error.status_code
            with patch.object(cards, 'read_card_fields', return_value=self.fields(code)), patch.object(cards, 'get_face_engine') as face:
                face.return_value.extract_embedding.side_effect = infer
                with ThreadPoolExecutor(max_workers=2) as pool:
                    outcomes = list(pool.map(confirm, pairs))
            self.assertEqual(sorted(outcomes), [200, 409])
            # Prove the persisted result in an independent connection/session.
            with Session(self.engine) as db:
                users = list(db.scalars(select(User).where(User.id.in_({first.id, second.id}))))
                filled = [user for user in users if user.student_code == code]
                self.assertEqual(len(filled), 1)
                self.assertEqual(filled[0].class_name, '22T1')
                self.assertEqual(filled[0].student_card_status, 'VERIFIED')
                reference = cards.active_reference(db, filled[0])
                self.assertIsNotNone(reference)
                self.assertEqual(reference.identity_profile_version, filled[0].identity_profile_version)
                self.assertEqual(db.scalar(select(StudentFaceEmbedding).where(StudentFaceEmbedding.student_id == filled[0].id)).reference_version, reference.id)
                if not same_owner:
                    other = next(user for user in users if user.id != filled[0].id)
                    self.assertIsNone(other.student_code); self.assertIsNone(other.class_name)
                    self.assertIsNone(db.scalar(select(StudentCardReference).where(StudentCardReference.student_id == other.id)))

    def test_two_confirmations_of_one_card_commit_one_profile_and_reference(self):
        self.run_race(same_owner=True)

    def test_two_students_cannot_claim_the_same_missing_mssv(self):
        self.run_race(same_owner=False)
