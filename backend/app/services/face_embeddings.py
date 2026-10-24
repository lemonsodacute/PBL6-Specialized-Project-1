"""Internal embedding persistence. Caller owns commit/rollback and authorization.

Confirmed student cards and exam verification share this store. Do not log
vectors or return these ORM records from public endpoints.
"""
from dataclasses import dataclass
from datetime import datetime, timezone
from uuid import UUID, uuid4

import numpy as np
from numpy.typing import NDArray
from sqlalchemy import delete, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.face_config import (
    EMBEDDING_DIM, FACE_EMBEDDING_DTYPE, FACE_EMBEDDING_NORM_TOLERANCE,
    FACE_PREPROCESSING_VERSION, SFACE_MODEL_NAME, SFACE_MODEL_VERSION,
)
from app.models.entities import StudentFaceEmbedding, User


@dataclass(frozen=True)
class FaceEmbeddingMetadata:
    model_name: str = SFACE_MODEL_NAME
    model_version: str = SFACE_MODEL_VERSION
    preprocessing_version: str = FACE_PREPROCESSING_VERSION
    embedding_dimension: int = EMBEDDING_DIM


CURRENT_FACE_METADATA = FaceEmbeddingMetadata()


class FaceEmbeddingError(ValueError):
    """Stable internal code only: never include vector bytes or SQL parameters."""
    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


def _validate_metadata(metadata: FaceEmbeddingMetadata) -> None:
    if metadata != CURRENT_FACE_METADATA:
        raise FaceEmbeddingError('FACE_EMBEDDING_INCOMPATIBLE')


def _validate_embedding(vector: NDArray[np.float32]) -> None:
    if (not isinstance(vector, np.ndarray) or vector.shape != (EMBEDDING_DIM,)
            or vector.dtype.kind != 'f' or vector.dtype.itemsize != 4
            or not np.isfinite(vector).all()):
        raise FaceEmbeddingError('FACE_EMBEDDING_CORRUPTED')
    # Validate instead of re-normalizing: preserve all float32 bits on round-trip.
    norm = np.linalg.norm(vector.astype(np.float64))
    if abs(float(norm) - 1.0) > FACE_EMBEDDING_NORM_TOLERANCE:
        raise FaceEmbeddingError('FACE_EMBEDDING_CORRUPTED')


def serialize_embedding(embedding: NDArray[np.float32]) -> bytes:
    """A normalized float32 vector -> canonical little-endian bytes, no pickle."""
    _validate_embedding(embedding)
    return embedding.astype(FACE_EMBEDDING_DTYPE, copy=False).tobytes(order='C')


def deserialize_embedding(content: bytes) -> NDArray[np.float32]:
    """A canonical BYTEA value -> validated native float32 with an owned buffer."""
    if not isinstance(content, (bytes, bytearray, memoryview)):
        raise FaceEmbeddingError('FACE_EMBEDDING_CORRUPTED')
    payload = bytes(content)
    if len(payload) != EMBEDDING_DIM * np.dtype(FACE_EMBEDDING_DTYPE).itemsize:
        raise FaceEmbeddingError('FACE_EMBEDDING_CORRUPTED')
    vector = np.frombuffer(payload, dtype=FACE_EMBEDDING_DTYPE).astype(np.float32, copy=True)
    _validate_embedding(vector)
    return vector


def save_face_embedding(
    db: Session, student_id: UUID, embedding: NDArray[np.float32],
    metadata: FaceEmbeddingMetadata = CURRENT_FACE_METADATA,
) -> StudentFaceEmbedding:
    """Insert/replace the current template; flush, but never commit or rollback.

    PostgreSQL locks the parent user even on the first insert. All writers using
    this service serialize per student; the unique constraint also guards SQL
    writers outside the service. Regeneration may replace incompatible metadata.
    """
    _validate_metadata(metadata)
    payload = serialize_embedding(embedding)
    try:
        student = db.scalar(select(User.id).where(User.id == student_id).with_for_update())
        if student is None:
            raise FaceEmbeddingError('FACE_EMBEDDING_STUDENT_NOT_FOUND')
        row = db.scalar(select(StudentFaceEmbedding).where(
            StudentFaceEmbedding.student_id == student_id,
        ).execution_options(populate_existing=True))
        now = datetime.now(timezone.utc)
        if row is None:
            row = StudentFaceEmbedding(id=uuid4(), student_id=student_id, created_at=now)
            db.add(row)
        row.embedding = payload
        # Only the card-confirm transaction may bind a newly written template
        # to a trusted reference. Other internal writers invalidate that binding.
        row.reference_version = None
        row.model_name = metadata.model_name
        row.model_version = metadata.model_version
        row.preprocessing_version = metadata.preprocessing_version
        row.embedding_dimension = metadata.embedding_dimension
        row.updated_at = now
        db.flush()
    except SQLAlchemyError:
        # Driver errors may contain bound biometric bytes. Caller must rollback.
        raise FaceEmbeddingError('FACE_EMBEDDING_STORAGE_ERROR') from None
    return row


def get_face_embedding(db: Session, student_id: UUID) -> NDArray[np.float32]:
    """Load only a current, compatible template; stale/corrupted data fails closed."""
    try:
        row = db.scalar(select(StudentFaceEmbedding).where(
            StudentFaceEmbedding.student_id == student_id,
        ).execution_options(populate_existing=True))
    except SQLAlchemyError:
        raise FaceEmbeddingError('FACE_EMBEDDING_STORAGE_ERROR') from None
    if row is None:
        raise FaceEmbeddingError('FACE_EMBEDDING_NOT_FOUND')
    _validate_metadata(FaceEmbeddingMetadata(
        row.model_name, row.model_version, row.preprocessing_version, row.embedding_dimension,
    ))
    return deserialize_embedding(row.embedding)


def delete_face_embedding(db: Session, student_id: UUID) -> bool:
    """Invalidate by deleting any current/stale template; caller owns transaction."""
    try:
        student = db.scalar(select(User.id).where(User.id == student_id).with_for_update())
        if student is None:
            return False
        result = db.execute(delete(StudentFaceEmbedding).where(StudentFaceEmbedding.student_id == student_id))
        return result.rowcount > 0
    except SQLAlchemyError:
        raise FaceEmbeddingError('FACE_EMBEDDING_STORAGE_ERROR') from None
