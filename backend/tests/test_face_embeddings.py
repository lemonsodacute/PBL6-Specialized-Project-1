"""Synthetic templates only; isolated SQLite DB plus PostgreSQL migration DDL."""
from dataclasses import asdict, replace
from datetime import datetime, timezone
import importlib.util
from io import StringIO
from pathlib import Path
import struct
import traceback
from unittest import TestCase
from uuid import uuid4

from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory
import numpy as np
from sqlalchemy import Column, MetaData, Numeric, create_engine, event, func, inspect, select, text, update
from sqlalchemy.dialects import postgresql
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.schema import CreateTable

from app.core.face_config import EMBEDDING_DIM
from app.models.entities import StudentCardReference, StudentFaceEmbedding, StudentIdentity, User, UserRole
from app.services.face_embeddings import (
    CURRENT_FACE_METADATA, FaceEmbeddingError, delete_face_embedding,
    deserialize_embedding, get_face_embedding, save_face_embedding, serialize_embedding,
)

BACKEND = Path(__file__).resolve().parents[1]
REVISION = '0007_student_face_embeddings'
spec = importlib.util.spec_from_file_location(REVISION, BACKEND / 'alembic' / 'versions' / f'{REVISION}.py')
migration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(migration)


def template():
    vector = np.random.default_rng(7).normal(size=EMBEDDING_DIM).astype(np.float32)
    return vector / np.linalg.norm(vector)


class SerializationTests(TestCase):
    def assert_corrupted(self, function, value):
        with self.assertRaises(FaceEmbeddingError) as raised:
            function(value)
        self.assertEqual(raised.exception.code, 'FACE_EMBEDDING_CORRUPTED')
        self.assertEqual(str(raised.exception), raised.exception.code)

    def test_float32_round_trip_is_bit_exact_and_owns_memory(self):
        original = template()
        payload = serialize_embedding(original)
        result = deserialize_embedding(payload)
        self.assertIsInstance(payload, bytes)
        self.assertEqual(len(payload), 512)
        self.assertEqual(result.shape, (128,))
        self.assertEqual(result.dtype, np.float32)
        self.assertEqual(result.tobytes(), original.tobytes())
        self.assertTrue(result.flags.owndata)
        self.assertTrue(result.flags.writeable)
        result[:] = 0
        np.testing.assert_array_equal(deserialize_embedding(payload), original)

    def test_canonical_little_endian_including_non_native_input(self):
        vector = np.zeros(128, dtype=np.float32)
        vector[:2] = [.6, .8]
        expected = struct.pack('<128f', *vector)
        self.assertEqual(serialize_embedding(vector), expected)
        self.assertEqual(serialize_embedding(vector.astype('>f4')), expected)
        np.testing.assert_array_equal(deserialize_embedding(expected), vector)

    def test_strided_input_is_supported_without_mutation(self):
        backing = np.zeros(256, dtype=np.float32)
        backing[::2] = template()
        original = backing.copy()
        result = deserialize_embedding(serialize_embedding(backing[::2]))
        np.testing.assert_array_equal(result, backing[::2])
        np.testing.assert_array_equal(backing, original)

    def test_wrong_dimension_and_dtype_are_rejected(self):
        for value in (np.ones(127, dtype=np.float32), np.ones(129, dtype=np.float32),
                      template().reshape(1, 128), template().reshape(2, 64),
                      template().astype(np.float64), template().astype(complex),
                      np.ones(128, dtype=np.int32), template().tolist(), None):
            with self.subTest(shape=np.shape(value)):
                self.assert_corrupted(serialize_embedding, value)

    def test_nan_inf_zero_and_non_unit_vectors_are_rejected(self):
        for value in (np.nan, np.inf, -np.inf, 0.0, 1.0):
            with self.subTest(value=value):
                self.assert_corrupted(serialize_embedding, np.full(128, value, dtype=np.float32))

    def test_corrupted_binary_is_rejected(self):
        valid = serialize_embedding(template())
        for payload in (b'', valid[:-1], valid + b'x', valid[:128], None, 'not binary',
                        np.zeros(128, dtype='<f4').tobytes(),
                        np.full(128, np.nan, dtype='<f4').tobytes(),
                        np.full(128, np.inf, dtype='<f4').tobytes(),
                        (template() * 2).astype('<f4').tobytes()):
            with self.subTest(length=len(payload) if payload is not None else None):
                self.assert_corrupted(deserialize_embedding, payload)

    def test_driver_memoryview_and_bytearray_are_copied(self):
        original = template()
        for wrap in (bytearray, memoryview):
            payload = bytearray(serialize_embedding(original))
            result = deserialize_embedding(wrap(payload))
            payload[:] = b'\0' * len(payload)
            np.testing.assert_array_equal(result, original)


class DatabaseFixture(TestCase):
    def setUp(self):
        self.engine = create_engine('sqlite:///:memory:')
        self.addCleanup(self.engine.dispose)

        @event.listens_for(self.engine, 'connect')
        def sqlite_contract(connection, _):
            connection.execute('PRAGMA foreign_keys=ON')
            # SQLite lacks PostgreSQL's UUID default; this shim is test-only.
            connection.create_function('gen_random_uuid', 0, lambda: uuid4().hex)

        with self.engine.begin() as connection:
            User.__table__.create(connection)
            StudentIdentity.__table__.create(connection)
            with Operations.context(MigrationContext.configure(connection)):
                migration.upgrade()
                StudentCardReference.__table__.create(connection)
                from tests.schema_helpers import install_avatar_foreign_key
                install_avatar_foreign_key(connection)
                with Operations.context(MigrationContext.configure(connection)) as ops:
                    with ops.batch_alter_table('student_face_embeddings') as batch:
                        batch.add_column(Column('reference_version', postgresql.UUID(as_uuid=True)))
                        batch.create_foreign_key('fk_embedding_reference', 'student_card_references', ['reference_version'], ['id'])
        self.db = Session(self.engine, autoflush=False, expire_on_commit=False)
        self.addCleanup(self.db.close)
        self.student_id = uuid4()
        self.db.add(User(id=self.student_id, full_name='Synthetic student',
                         email=f'{self.student_id}@example.test', password_hash='unused', role=UserRole.student))
        self.db.commit()
        self.vector = template()

    def record(self, **overrides):
        values = dict(id=uuid4(), student_id=self.student_id, embedding=serialize_embedding(self.vector),
                      **asdict(CURRENT_FACE_METADATA))
        return StudentFaceEmbedding(**(values | overrides))

    def assert_error(self, code, function, *args):
        with self.assertRaises(FaceEmbeddingError) as raised:
            function(*args)
        self.assertEqual(raised.exception.code, code)


class PersistenceTests(DatabaseFixture):
    def test_insert_and_read_from_a_new_session(self):
        row = save_face_embedding(self.db, self.student_id, self.vector)
        self.assertIsNotNone(row.id)
        self.assertIsNotNone(row.created_at)
        self.assertIsNotNone(row.updated_at)
        self.assertEqual(row.embedding, serialize_embedding(self.vector))
        for name, expected in asdict(CURRENT_FACE_METADATA).items():
            self.assertEqual(getattr(row, name), expected)
        self.db.commit()
        with Session(self.engine) as reader:
            result = get_face_embedding(reader, self.student_id)
        np.testing.assert_array_equal(result, self.vector)

    def test_save_updates_one_record_preserving_id_and_created_at(self):
        row = save_face_embedding(self.db, self.student_id, self.vector)
        old_id, created_at = row.id, row.created_at
        row.updated_at = datetime(2000, 1, 1, tzinfo=timezone.utc)
        self.db.commit()
        updated = save_face_embedding(self.db, self.student_id, -self.vector)
        self.db.commit()
        self.assertEqual(updated.id, old_id)
        self.assertEqual(updated.created_at.replace(tzinfo=timezone.utc), created_at)
        self.assertGreater(updated.updated_at.year, 2000)
        self.assertEqual(self.db.scalar(select(func.count()).select_from(StudentFaceEmbedding)), 1)
        np.testing.assert_array_equal(get_face_embedding(self.db, self.student_id), -self.vector)

    def test_uniqueness_is_enforced_by_database(self):
        save_face_embedding(self.db, self.student_id, self.vector)
        self.db.commit()
        self.db.add(self.record())
        with self.assertRaises(IntegrityError):
            self.db.flush()
        self.db.rollback()
        np.testing.assert_array_equal(get_face_embedding(self.db, self.student_id), self.vector)

    def test_missing_student_and_foreign_key_are_rejected(self):
        missing = uuid4()
        self.assert_error('FACE_EMBEDDING_STUDENT_NOT_FOUND', save_face_embedding, self.db, missing, self.vector)
        self.db.add(self.record(student_id=missing))
        with self.assertRaises(IntegrityError):
            self.db.flush()
        self.db.rollback()

    def test_missing_embedding_has_explicit_error(self):
        self.assert_error('FACE_EMBEDDING_NOT_FOUND', get_face_embedding, self.db, self.student_id)

    def test_delete_is_idempotent_and_invalidates_the_record(self):
        save_face_embedding(self.db, self.student_id, self.vector)
        self.db.commit()
        self.assertTrue(delete_face_embedding(self.db, self.student_id))
        self.db.commit()
        self.assertFalse(delete_face_embedding(self.db, self.student_id))
        self.assertFalse(delete_face_embedding(self.db, uuid4()))
        self.assert_error('FACE_EMBEDDING_NOT_FOUND', get_face_embedding, self.db, self.student_id)

    def test_user_deletion_cascades_to_embedding(self):
        save_face_embedding(self.db, self.student_id, self.vector)
        self.db.commit()
        self.db.delete(self.db.get(User, self.student_id))
        self.db.commit()
        self.assertEqual(self.db.scalar(select(func.count()).select_from(StudentFaceEmbedding)), 0)

    def test_insert_rollback_keeps_user_and_removes_template(self):
        save_face_embedding(self.db, self.student_id, self.vector)
        self.db.rollback()
        self.assertIsNotNone(self.db.get(User, self.student_id))
        self.assert_error('FACE_EMBEDDING_NOT_FOUND', get_face_embedding, self.db, self.student_id)

    def test_update_rollback_restores_previous_vector(self):
        save_face_embedding(self.db, self.student_id, self.vector)
        self.db.commit()
        save_face_embedding(self.db, self.student_id, -self.vector)
        self.db.rollback()
        np.testing.assert_array_equal(get_face_embedding(self.db, self.student_id), self.vector)

    def test_delete_rollback_restores_previous_vector(self):
        save_face_embedding(self.db, self.student_id, self.vector)
        self.db.commit()
        delete_face_embedding(self.db, self.student_id)
        self.db.rollback()
        np.testing.assert_array_equal(get_face_embedding(self.db, self.student_id), self.vector)

    def test_version_and_dimension_mismatches_are_rejected_on_read(self):
        row = save_face_embedding(self.db, self.student_id, self.vector)
        self.db.commit()
        for field, value in (('model_name', 'other-model'), ('model_version', 'other-version'),
                             ('preprocessing_version', 'other-preprocessing'), ('embedding_dimension', 256)):
            with self.subTest(field=field):
                setattr(row, field, value)
                if field == 'embedding_dimension':
                    row.embedding = b'\0' * (value * 4)
                self.db.flush()
                self.assert_error('FACE_EMBEDDING_INCOMPATIBLE', get_face_embedding, self.db, self.student_id)
                self.db.rollback()

    def test_version_is_revalidated_with_a_cached_orm_record(self):
        row = save_face_embedding(self.db, self.student_id, self.vector)
        self.db.commit()
        with self.engine.begin() as connection:
            connection.execute(update(StudentFaceEmbedding).values(model_version='other-version'))
        self.assertEqual(row.model_version, CURRENT_FACE_METADATA.model_version)
        self.assert_error('FACE_EMBEDDING_INCOMPATIBLE', get_face_embedding, self.db, self.student_id)

    def test_incompatible_record_can_be_explicitly_replaced_or_deleted(self):
        row = save_face_embedding(self.db, self.student_id, self.vector)
        row.model_version = 'old-version'
        self.db.commit()
        updated = save_face_embedding(self.db, self.student_id, -self.vector)
        self.assertEqual(updated.model_version, CURRENT_FACE_METADATA.model_version)
        updated.preprocessing_version = 'old-preprocessing'
        self.db.commit()
        self.assertTrue(delete_face_embedding(self.db, self.student_id))
        self.db.commit()

    def test_invalid_metadata_and_input_never_replace_valid_data(self):
        save_face_embedding(self.db, self.student_id, self.vector)
        self.db.commit()
        for field, value in (('model_name', 'other-model'), ('model_version', 'other-version'),
                             ('preprocessing_version', 'other-preprocessing'), ('embedding_dimension', 512)):
            self.assert_error('FACE_EMBEDDING_INCOMPATIBLE', save_face_embedding,
                              self.db, self.student_id, -self.vector, replace(CURRENT_FACE_METADATA, **{field: value}))
        self.assert_error('FACE_EMBEDDING_CORRUPTED', save_face_embedding,
                          self.db, self.student_id, np.zeros(128, dtype=np.float32))
        np.testing.assert_array_equal(get_face_embedding(self.db, self.student_id), self.vector)

    def test_non_finite_zero_and_non_unit_persisted_bytes_are_rejected(self):
        row = save_face_embedding(self.db, self.student_id, self.vector)
        self.db.commit()
        for value in (np.nan, np.inf, 0.0, 1.0):
            with self.subTest(value=value):
                row.embedding = np.full(128, value, dtype='<f4').tobytes()
                self.db.flush()
                self.assert_error('FACE_EMBEDDING_CORRUPTED', get_face_embedding, self.db, self.student_id)
                self.db.rollback()

    def test_database_rejects_wrong_byte_length_null_and_non_positive_dimension(self):
        save_face_embedding(self.db, self.student_id, self.vector)
        self.db.commit()
        for values in ({'embedding': b'bad'}, {'embedding': None}, {'embedding_dimension': 0},
                       {'embedding_dimension': -1}, {'embedding_dimension': 127}):
            with self.subTest(fields=list(values)), self.assertRaises(IntegrityError):
                with self.db.begin_nested():
                    self.db.execute(update(StudentFaceEmbedding).values(**values))
        np.testing.assert_array_equal(get_face_embedding(self.db, self.student_id), self.vector)

    def test_driver_error_details_and_bound_bytes_are_not_exposed(self):
        self.db.execute(text("CREATE TRIGGER fail_template_insert BEFORE INSERT ON student_face_embeddings "
                             "BEGIN SELECT RAISE(ABORT, 'SENSITIVE_DRIVER_MESSAGE'); END"))
        self.db.commit()
        with self.assertRaises(FaceEmbeddingError) as raised:
            save_face_embedding(self.db, self.student_id, self.vector)
        error = raised.exception
        self.assertEqual(str(error), 'FACE_EMBEDDING_STORAGE_ERROR')
        rendered = ''.join(traceback.format_exception(error))
        self.assertNotIn('SENSITIVE_DRIVER_MESSAGE', rendered)
        self.assertNotIn(repr(serialize_embedding(self.vector)), rendered)
        self.db.rollback()
        self.assert_error('FACE_EMBEDDING_NOT_FOUND', get_face_embedding, self.db, self.student_id)


class MigrationTests(DatabaseFixture):
    def test_revision_extends_existing_head(self):
        config = Config(str(BACKEND / 'alembic.ini'))
        config.set_main_option('script_location', str(BACKEND / 'alembic'))
        scripts = ScriptDirectory.from_config(config)
        self.assertIn(REVISION, {revision.revision for revision in scripts.walk_revisions()})
        self.assertEqual(scripts.get_revision(REVISION).down_revision, '0006_identity_verifications')

    def test_migrated_schema_matches_orm(self):
        metadata = MetaData()
        for table in (User.__table__, StudentIdentity.__table__, StudentCardReference.__table__, StudentFaceEmbedding.__table__):
            table.to_metadata(metadata)

        def compare_type(context, inspected_column, metadata_column, inspected_type, metadata_type):
            # SQLite reflects the existing PG UUID declaration as NUMERIC.
            # PostgreSQL's actual UUID DDL is checked separately below.
            if isinstance(metadata_type, postgresql.UUID) and isinstance(inspected_type, Numeric):
                return False
            return None

        with self.engine.connect() as connection:
            context = MigrationContext.configure(connection, opts={'compare_type': compare_type})
            differences = compare_metadata(context, metadata)
            self.assertEqual(differences, [])
            constraints = inspect(connection).get_check_constraints('student_face_embeddings')
        self.assertEqual({item['sqltext'] for item in constraints},
                         {'embedding_dimension > 0', 'length(embedding) = embedding_dimension * 4'})

    def test_upgrade_downgrade_preserve_existing_tables_and_user_data(self):
        self.db.close()
        with self.engine.begin() as connection:
            with Operations.context(MigrationContext.configure(connection)):
                migration.downgrade()
                self.assertNotIn('student_face_embeddings', inspect(connection).get_table_names())
                self.assertIn('student_identities', inspect(connection).get_table_names())
                self.assertEqual(connection.scalar(select(func.count()).select_from(User)), 1)
                migration.upgrade()
            self.assertIn('student_face_embeddings', inspect(connection).get_table_names())

    def test_postgresql_ddl_has_bytea_uuid_timestamps_and_constraints(self):
        output = StringIO()
        context = MigrationContext.configure(dialect_name='postgresql', opts={'as_sql': True, 'output_buffer': output})
        with Operations.context(context):
            migration.upgrade()
        sql = output.getvalue()
        orm_sql = str(CreateTable(StudentFaceEmbedding.__table__).compile(dialect=postgresql.dialect()))
        for ddl in (sql, orm_sql):
            for fragment in ('embedding BYTEA NOT NULL', 'id UUID DEFAULT gen_random_uuid()',
                             'TIMESTAMP WITH TIME ZONE', 'UNIQUE (student_id)',
                             'REFERENCES users (id) ON DELETE CASCADE',
                             'CHECK (embedding_dimension > 0)',
                             'CHECK (length(embedding) = embedding_dimension * 4)'):
                self.assertIn(fragment, ddl)
            self.assertNotIn('CREATE EXTENSION', ddl)
            self.assertNotIn('ALTER TABLE', ddl)
