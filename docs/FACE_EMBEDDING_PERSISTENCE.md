# Phase 2 — Face embedding persistence

Hoàn tất ngày **03/10/2026, Asia/Saigon**. Phạm vi: infrastructure lưu/đọc embedding, chưa tích hợp reference mới hoặc thay đổi verification. **Phase 2 complete** ở mức code, migration và tests; chưa áp dụng migration vào PostgreSQL đang chạy. Phase 3 chưa triển khai.

## Architecture

```text
Internal caller với SQLAlchemy Session
  → save_face_embedding(student_id, float32 vector, metadata)
      → validate metadata + shape/finite/norm
      → serialize little-endian float32
      → lock users row → insert/replace student_face_embeddings → flush
  → caller commit hoặc rollback

get_face_embedding(student_id)
  → đọc DB, refresh cả khi ORM đã cache record
  → validate model/preprocessing/dimension
  → deserialize + copy + validate finite/norm
  → ndarray float32 (128,) cho internal caller

delete_face_embedding(student_id)
  → lock users row → xóa template hiện hành, kể cả version cũ
  → caller commit hoặc rollback
```

Service tuân theo convention nhận `Session` và để caller quản lý transaction, giống các service hiện có. Không thêm repository framework hoặc Pydantic request/response mới vì chưa có endpoint mới. Không load model, khởi động inference, truy cập config DB hoặc tự mở session trong service persistence.

Verification hiện hữu vẫn đọc **ba ảnh front/left/right**, trích embedding bằng Phase 1, lấy **median ba cosine scores**, so bằng `>= FACE_MATCH_THRESHOLD`. Enrollment, frontend, auth, exam attempt và threshold giữ nguyên. Không có backfill hoặc tự động lưu embedding từ ba selfie.

## Database schema

Table: **`student_face_embeddings`**.

| Column | PostgreSQL type | Contract |
|---|---|---|
| `id` | UUID | Primary key, default `gen_random_uuid()` |
| `student_id` | UUID | NOT NULL, FK `users.id`, ON DELETE CASCADE |
| `embedding` | BYTEA | NOT NULL, canonical float32 bytes |
| `model_name` | VARCHAR(64) | NOT NULL |
| `model_version` | VARCHAR(64) | NOT NULL |
| `preprocessing_version` | VARCHAR(128) | NOT NULL |
| `embedding_dimension` | INTEGER | NOT NULL, positive |
| `created_at` | TIMESTAMPTZ | NOT NULL, default now(), giữ nguyên khi replace |
| `updated_at` | TIMESTAMPTZ | NOT NULL, default now(), service cập nhật khi save |

Constraints/indexes:

- Primary key index trên `id`.
- `uq_student_face_embeddings_student`: UNIQUE(`student_id`), đồng thời cung cấp index lookup; không thêm index trùng lặp.
- `ck_student_face_embeddings_dimension`: `embedding_dimension > 0`.
- `ck_student_face_embeddings_bytes`: `length(embedding) = embedding_dimension * 4`.
- Foreign key và mọi trường NOT NULL như bảng trên. Finite/norm/version được kiểm tra trong service; DB không giải mã nội dung float.

Quyết định lifecycle: **một record hiện hành cho mỗi student**, không lưu lịch sử vector. Save thay thế payload/metadata trong record hiện hành và giữ id/created_at. Metadata nhận vào phải khớp contract hiện tại; record cũ không tương thích chỉ được thay bằng một lần save có chủ đích với vector được tạo lại, không tự relabel vector cũ khi đọc. Delete xóa cả record compatible hoặc incompatible.

PostgreSQL `SELECT users.id ... FOR UPDATE` serialize save/delete cho cùng student, kể cả lần insert chưa có embedding. Unique constraint vẫn bảo vệ trước SQL writers không đi qua service. Transaction của caller giữ lock đến commit/rollback; không chạy inference trong khoảng giữ lock. Service không tự retry lỗi transaction. Caller chỉ được gọi sau khi user đã tồn tại; FK theo convention dự án không tự kiểm tra role/ownership, phần đó thuộc caller được phép sử dụng.

## Storage decision / serialization

| Lựa chọn | Đánh giá |
|---|---|
| **BYTEA — chọn** | Không thêm extension, giữ byte float32 chính xác, định dạng nhỏ và xác định; phù hợp đọc cả vector để cosine trong service. |
| ARRAY(Float) | Dùng được trên PostgreSQL nhưng cần chọn rõ REAL/double precision; không có nhu cầu query phần tử và không có array convention cho embedding trong project. |
| JSON/JSONB | Dễ xem nhưng thêm text/number conversion và overhead; không cần query từng tọa độ. |
| pgvector | Chưa có trong code/migrations; không thêm extension cho nhu cầu persistence 1:1 này. |

SQLAlchemy `LargeBinary` được compile thành PostgreSQL BYTEA, SQLite BLOB. [SQLAlchemy type documentation](https://docs.sqlalchemy.org/en/20/core/type_basics.html#sqlalchemy.types.LargeBinary). `length(bytea)` đếm byte trong constraint PostgreSQL. [PostgreSQL binary functions](https://www.postgresql.org/docs/current/functions-binarystring.html).

- dtype: IEEE-754 **float32**, canonical NumPy dtype **`<f4`**.
- dimension: **128**, shape chính xác `(128,)`.
- endianness: **little-endian**, C-order, **512 bytes**; không header, compression hoặc pickle.
- Serialize chỉ nhận ndarray float32 đã normalized; chấp nhận endian khác và strided array rồi canonicalize. Float64/int/complex/list bị từ chối, tránh cast mất chính xác âm thầm.
- Read dùng `np.frombuffer(..., dtype='<f4')`, chuyển về native float32 và **copy buffer**, rồi validate. bytes/bytearray/memoryview đều được hỗ trợ. [NumPy frombuffer](https://numpy.org/doc/stable/reference/generated/numpy.frombuffer.html).
- Kiểm tra shape, finite và `abs(L2 norm - 1) <= 1e-5`, norm tính ở float64. Zero/non-unit bị từ chối; **không normalize lại** để giữ round-trip bit-exact.
- Format/version validation phát hiện dữ liệu sai contract; đây không phải checksum hoặc cơ chế phát hiện mọi thay đổi dữ liệu có chủ đích.

## Version contract

Nguồn hằng số chung: [backend/app/core/face_config.py](../backend/app/core/face_config.py).

| Field | Current value |
|---|---|
| `model_name` | `sface` |
| `model_version` | `2021dec` |
| `preprocessing_version` | `yunet-sface-v1` |
| `embedding_dimension` | `128` |

Preprocessing version này đại diện pipeline Phase 1: decode/EXIF, giới hạn cạnh dài 1280, YuNet 2023mar, năm landmarks, SFace alignCrop 112×112, quality gates, SFace preprocessing và L2 normalization. Khi đổi model artifact hoặc preprocessing phải bump version phù hợp và regenerate template; service không silently reuse dữ liệu khác version. Migration đóng băng schema, không import runtime constants.

`face_recognition.py` chỉ chuyển `EMBEDDING_DIM` sang import từ hằng số chung; tên export cũ còn dùng được. Không thay implementation extraction, comparison, locking hoặc error taxonomy Phase 1.

## Internal API and errors

Trong [face_embeddings.py](../backend/app/services/face_embeddings.py):

```python
# Caller đã có student_id được phép sử dụng và vector từ nguồn phù hợp.
# Đây chỉ là ví dụ integration tương lai; Phase 2 chưa gọi từ API.
with SessionLocal.begin() as db:
    row = save_face_embedding(db, student_id, vector, CURRENT_FACE_METADATA)

with SessionLocal() as db:
    vector = get_face_embedding(db, student_id)

with SessionLocal.begin() as db:
    deleted = delete_face_embedding(db, student_id)
```

Save trả internal ORM record; get trả ndarray; delete trả bool và idempotent khi chưa có record. Không đưa raw record/vector vào `ok()`, Pydantic response hoặc endpoint.

| Internal error code | Điều kiện |
|---|---|
| `FACE_EMBEDDING_NOT_FOUND` | Student chưa có record |
| `FACE_EMBEDDING_INCOMPATIBLE` | Model name/version, preprocessing version hoặc dimension khác current contract |
| `FACE_EMBEDDING_CORRUPTED` | Payload sai kiểu/độ dài, vector sai shape/dtype, NaN/Inf, zero hoặc norm ngoài tolerance; áp dụng cả invalid input khi save |
| `FACE_EMBEDDING_STUDENT_NOT_FOUND` | Save cho user chưa tồn tại |
| `FACE_EMBEDDING_STORAGE_ERROR` | SQLAlchemy/driver lỗi; caller phải rollback khi transaction lỗi |

Không map các lỗi mới ra public API ở Phase 2. Chỉ catch `SQLAlchemyError` tại persistence boundary; thông báo driver có thể chứa binary parameters nên được thay bằng code cố định và suppress exception chaining. Không catch programming errors tổng quát, không tự rollback transaction của caller.

## Migration

File: [0007_student_face_embeddings.py](../backend/alembic/versions/0007_student_face_embeddings.py).

- Revision `0007_student_face_embeddings` nối `0006_identity_verifications`.
- Upgrade chỉ tạo bảng mới cùng constraints; không alter/drop bảng cũ, không backfill, không thêm extension.
- Downgrade chỉ drop bảng mới; dữ liệu embedding trong bảng này sẽ mất nếu thực sự chạy downgrade.
- Không sửa `schema.sql`: migration `0001_schema` thực thi file bootstrap đó; thêm bảng mới vào cả bootstrap và migration 0007 sẽ tạo trùng bảng. Không sửa các revision cũ.
- Bỏ file rỗng `backend/alembic/__init__.py`: file này che package Alembic khi chạy Python từ backend, làm `python -m alembic` và import migration tests thất bại. `env.py` và các revision cũ không đổi.

Lệnh từ `backend/` để áp dụng sau khi xác nhận DB mục tiêu đang ở 0006 (chưa chạy trên DB thật trong lượt này):

```powershell
& '.\.venv\Scripts\python.exe' -m alembic upgrade 0007_student_face_embeddings
# Chỉ khi chủ động rollback bảng mới và chấp nhận mất dữ liệu của bảng:
& '.\.venv\Scripts\python.exe' -m alembic downgrade 0006_identity_verifications
```

Đã chạy thành công validation offline, không kết nối DB:

```powershell
& '.\.venv\Scripts\python.exe' -m alembic upgrade '0006_identity_verifications:0007_student_face_embeddings' --sql
& '.\.venv\Scripts\python.exe' -m alembic downgrade '0007_student_face_embeddings:0006_identity_verifications' --sql
```

Validation tập trung trên transition 0006↔0007, không tuyên bố đã kiểm tra toàn bộ bootstrap database từ revision 0001. [Alembic offline migrations](https://alembic.sqlalchemy.org/en/latest/offline.html).

## Tests and quality checks

**Old regression: 47 passed. New persistence tests: 28 passed. Total: 75 passed.**

Tests mới bao gồm round-trip bit-exact, canonical endianness, strided/buffer ownership, dimension/dtype, NaN/Inf/zero/non-unit, corrupted bytes, model/preprocessing mismatch, insert/read/replace, uniqueness/FK/check constraints, delete/cascade, rollback insert/update/delete, ORM cache refresh, exception privacy, revision chain, migration/ORM parity và PostgreSQL DDL.

Database tests chạy SQLAlchemy thật và migration upgrade thật trên SQLite in-memory, không mock SQLAlchemy internals, không dùng dữ liệu sinh viên. SQLite bật foreign keys; test shim cung cấp `gen_random_uuid()`. Reflection của PostgreSQL UUID trên SQLite trả NUMERIC nên schema-parity test chỉ loại khác biệt cụ thể này; kiểu UUID PostgreSQL được kiểm tra riêng trên DDL.

Giới hạn: SQLite dùng BLOB, không có native PostgreSQL UUID/TIMESTAMPTZ hoặc row-level FOR UPDATE. Tests chưa chứng minh concurrent transaction behavior trên PostgreSQL thật; cần kiểm thử tích hợp khi đưa store vào flow ứng dụng.

Checks đã chạy:

```powershell
# cwd backend
& '.\.venv\Scripts\python.exe' -m unittest discover -s tests -v
# cwd project root
& '.\backend\.venv\Scripts\python.exe' -m compileall -q backend/app backend/alembic backend/tests
```

Unittest, compile và migration validation đều PASS. Không có ruff/black/mypy/pyright/flake8 cài sẵn hoặc cấu hình trong project; không cài dependency. Có warning hiện hữu về Starlette/httpx và Alembic `path_separator`; không ảnh hưởng kết quả test.

## Security/privacy

Embedding là dữ liệu sinh trắc. Service không log vector, không log binary payload, không có raw data trong thông báo exception và không thêm public API. Không dùng pickle. Không thêm audit event ở infrastructure khi chưa có actor/context nghiệp vụ; integration tương lai chỉ audit identifiers/version thích hợp. DB vẫn cần quyền truy cập và retention phù hợp; Phase 2 không tự bổ sung mã hóa payload hoặc thay cấu hình logging toàn ứng dụng. Không bật SQL parameter logging cho workload sinh trắc.

## Files changed

- MODIFY `backend/app/models/entities.py`: thêm ORM entity.
- MODIFY `backend/app/services/face_recognition.py`: dùng dimension constant chung, behavior không đổi.
- CREATE `backend/app/core/face_config.py`: version/storage constants.
- CREATE `backend/app/services/face_embeddings.py`: serializer, validation và transaction-aware persistence.
- CREATE `backend/alembic/versions/0007_student_face_embeddings.py`: migration additive.
- CREATE `backend/tests/test_face_embeddings.py`: 28 tests mới.
- CREATE `docs/FACE_EMBEDDING_PERSISTENCE.md`: tài liệu này.
- DELETE empty `backend/alembic/__init__.py`: sửa import shadowing.

## Remaining TODOs — các phase sau

- Trusted student-card reference.
- Generate/store embedding from trusted reference.
- Verification using stored embedding.
- Threshold calibration.
- Real-world validation, gồm PostgreSQL integration/concurrency và accuracy trên ảnh được phép sử dụng.
- Tích hợp invalidation/retention khi enrollment thay đổi hoặc bị xóa trước khi sử dụng store trong API.

Phase 3 chưa bắt đầu.
