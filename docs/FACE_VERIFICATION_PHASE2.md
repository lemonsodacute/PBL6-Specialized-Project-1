# AI PROCTO — Face Verification Phase 2

Ngày kiểm tra: **04/10/2026, Asia/Saigon**.

**Cập nhật collection tool (04/10/2026):** đã tạo công cụ thu dataset local và
thư mục `data/face_verification/` trống. **DATASET_INSUFFICIENT** vẫn đúng vì chưa
có participant images. Xem mục Local Dataset Collection ở cuối báo cáo.

**Preflight Phase 2.6 trước khi tạo collector (04/10/2026): DATASET_INSUFFICIENT.** Đã chạy validator
tại đường dẫn dataset trong README nhưng thư mục không tồn tại trong workspace
hiện tại. Chưa chạy real-data baseline, calibration hoặc test evaluation. Xem
các section Real Dataset Summary → Decision Gate ở cuối báo cáo.

**Pipeline Phase 2.1–2.5 đã triển khai và kiểm thử bằng dữ liệu tổng hợp/unit tests.
Awaiting labeled real-world dataset.** Chưa chạy baseline/calibration trên người
thật; chưa training, so sánh candidate hoặc export model. **Production changed: NO.**

## Kiểm tra codebase và khả năng training trước implementation

Đã đọc service, benchmark Phase 1, test recognition, identity API, face config,
requirements và `FACE_VERIFICATION_ANALYSIS.md`; kiểm tra thư mục model/data/test.
Không thấy Dockerfile/Compose, `.git`, dataset reference/webcam có nhãn hoặc
checkpoint `.pth/.pt/.ckpt` trong project ngoài môi trường/package dependencies.
Git không có trên PATH. Không đọc nội dung ảnh private của ứng dụng hoặc DB để
tự tạo dataset. Có 93 tests hiện hữu pass trước thay đổi.

| Current model | Kết quả kiểm tra local |
|---|---|
| Detector | `face_detection_yunet_2023mar.onnx`, 232,589 bytes |
| Recognition | `face_recognition_sface_2021dec.onnx`, 38,696,353 bytes (~36.9 MiB) |
| Input | JPEG/PNG/WEBP bytes → decode/EXIF → RGB thumbnail ≤1280 → BGR uint8 → YuNet → 5-point `alignCrop`, 112×112 BGR |
| Quality | Exactly one face; finite bbox/landmarks, bbox ≥80 px; gray mean ≥35; Laplacian variance ≥15 |
| Embedding | `float32 (128,)` |
| Normalization | Production L2 normalization; OpenCV SFace owns its tensor preprocessing |
| Similarity | Production `compare_embeddings()`, cosine, decision `score >= threshold` |
| Live policy | Median of 3 reference webcam scores; configured threshold unchanged |

**SFace fine-tuning assessment:** local artifact là ONNX đang được OpenCV DNN
load để inference; không có trainable checkpoint, optimizer state hoặc recipe
gắn với đúng file đó trong project. OpenCV Zoo mô tả model là MobileFaceNet được
train bằng SFace loss và convert từ code tác giả. Không có đường fine-tune trực
tiếp được xác minh từ artifact hiện có. Điều này không có nghĩa mọi ONNX trên thế
giới đều không thể dùng để training. [OpenCV Zoo SFace](https://github.com/opencv/opencv_zoo/blob/main/models/face_recognition_sface/README.md).

Tác giả **có** training code chính thức MxNet/PyTorch. README PyTorch minh họa
IR_50 + SFace trên CASIA, yêu cầu GPU trong recipe cũ; không chứng minh checkpoint
đó khớp MobileFaceNet/128D ONNX local. Vì vậy giữ SFace baseline, không dựng
pseudo-training bằng cách gọi inference rồi giả lập loss/backprop.
[SFace tác giả](https://github.com/zhongyy/SFace),
[PyTorch recipe](https://github.com/zhongyy/SFace/blob/main/SFace_torch/README.md).

| Available infrastructure | Trước implementation / cập nhật |
|---|---|
| Python | Backend `.venv`: 3.12.10 |
| PyTorch / TensorFlow | Chưa cài trong backend env; không cài cho task này |
| ONNX / ONNX Runtime | Chưa cài; ONNX models hiện được đọc bởi OpenCV |
| OpenCV | `opencv-python-headless` 4.14.0.94 |
| NumPy / Pillow | 2.5.3 / 12.3.0 |
| Matplotlib | Ban đầu chưa có; đã cài 3.11.2 cùng dependencies để kiểm tra plot, khai báo riêng trong `requirements-face-experiments.txt` |
| CUDA | Có RTX 4050 Laptop GPU ~6 GiB, driver 610.78; chưa xác minh CUDA toolkit hoặc training runtime |
| CPU | Intel Core i5-12450H, 8 cores / 12 logical CPUs |
| RAM | Windows báo usable physical memory 8,280,305,664 bytes (~7.71 GiB) |

Matplotlib chỉ phục vụ offline report. Không sửa `requirements.txt` hoặc
`requirements-dev.txt`, không thêm dependency training vào service.

## A. Dataset

| Hạng mục | Hiện trạng |
|---|---|
| Labeled identities | 0 được cung cấp cho protocol này |
| Trusted reference images | 0 được cung cấp |
| Webcam images | 0 được cung cấp |
| Rejected real images | N/A — chưa chạy validator trên dataset thật |

Đã thêm [hướng dẫn dataset](../data/README.md), không chứa ảnh. Thu 20–30 người
cho pilot, ưu tiên 50+; mỗi người một reference đáng tin cậy và 3–8 webcam qua
điều kiện/phiên chụp thật. Đây là cỡ prototype, không phải bằng chứng FAR thấp.

`prepare_face_dataset.py` dùng adapter `SFaceEngine` có sẵn, adapter gọi đúng
`FaceEngine.extract_embedding()`. Do đó decode/EXIF, bbox, kích thước mặt,
alignment, quality và output contract đều dùng production code. Embedding tạm
thời bị bỏ sau kiểm tra; không lưu crop, ảnh hoặc vector. Metadata lưu status,
source SHA-256, model/service fingerprint, split và category. Bbox/landmark raw
không được export; status `valid` nghĩa là đã qua toàn bộ production gates.

Report validator có `total_images`, `valid`, `rejected_images`, `status_counts`,
counts reference/webcam/identities, coverage annotation và số người có <3 webcam.
Lỗi `MODEL_ERROR` dừng run; không bị biến thành rejected image rồi tiếp tục.
Không overwrite ảnh gốc/output cũ. Các thư mục biometric và artifacts đã được
ignore; không có ignore rule chung cho public/synthetic fixtures trong tests.

## B. Split

Train identities: **N/A**. Calibration/validation identities: **N/A**.
Test identities: **N/A**. Không gán số giả khi chưa có dataset.

Default `60/20/20`; hỗ trợ `70/15/15` và hai tập calibration/test bằng hai ratios.
Allocation largest-remainder với seed 42, thứ tự identity sort rồi shuffle;
mỗi split tối thiểu hai identities. Chia trước quality rejection, mọi ảnh của
một identity ở cùng split. Không dùng train để calibration. Manifest cố định
được lưu để dùng lại; thay dataset/model buộc tạo manifest version mới.

Schema validation từ chối identity leakage, duplicate ID/path/byte content,
path escape, role/path sai, metadata/category không hợp lệ. Không tự phát hiện
mọi near-duplicate hay một người bị gán hai labels; cần audit nhãn thủ công.

## C. SFace Baseline

Embedding: **128D**. Latency trên dataset thật: **N/A**.
ROC/AUC/EER/FAR/FRR: **N/A**. Không dùng model-zoo accuracy hoặc noise smoke
để điền vào bảng kết quả nội bộ.

Runner mới [benchmark_face_phase2.py](../backend/scripts/benchmark_face_phase2.py)
giữ benchmark Phase 1 nguyên trạng, tái sử dụng adapter SFace và production
comparison. Protocol là **một trusted reference vs một webcam**, không phải
median ba webcam của endpoint. Genuine A↔A; impostor A↔B chỉ trong cùng split.

All-pairs là mặc định. `--max-impostors` lấy mẫu uniform without replacement
trên toàn bộ impostor population, deterministic theo seed; không mặc định cân
bằng impostor với genuine. Báo số pair có thể tạo, số được chọn và sampling rate.
Generator không dựng toàn bộ tích Descartes trước khi sampling, nhưng runner
giữ các pair đã chọn trong RAM; dataset lớn nên đặt cap có chủ đích từ trước.

Khi có dữ liệu thật, report sinh distributions, ROC, trapezoidal AUC, empirical
FAR/FRR/TAR/accuracy/balanced accuracy, EER nội suy và điểm empirical gần EER
cùng độ lệch FAR–FRR. EER nội suy không nhất thiết đạt được bằng một threshold
đơn lẻ khi có ties. Reject-all dùng `nextafter(max_score,+inf)` hữu hạn; nếu
score max=1 thì threshold có thể >1, **chỉ là sentinel báo cáo, không deploy**.

FAR/FRR chuẩn tính trên pairs có score. Báo riêng planned/scored/missing pairs,
genuine nonaccept rate có cả lỗi quality và false accepts/planned impostors.
Nếu một split không còn cả hai loại score, dừng thay vì xuất accuracy vô nghĩa.

CPU benchmark: default 10 warmup + 100 runs **cho từng phép đo**, mean/median/p95.
Đo OpenCV `feature()` riêng (gồm preprocessing bên trong OpenCV, chưa gồm L2),
`extract_embedding(encoded_image)` đầy đủ và hai extractions + cosine cho pair.
Timing wrapper chỉ chuyển tiếp nguyên input/output, phục hồi recognizer sau đo.
Dữ liệu timing lấy từ calibration, không chỉnh tham số theo test.
Model load time, RSS/peak RSS, model bytes/hash, CPU/RAM/runtime versions đi kèm.
Load time chỉ là một lần tạo engine trong process, không phải phân phối cold boot.
RSS là toàn process benchmark, gồm thư viện báo cáo; không phải riêng model.

## D. Threshold Calibration

Validation threshold: **N/A — Awaiting labeled real-world dataset.**
Expected tradeoff: chưa định lượng; chưa có business target FAR/FRR/latency.

Các threshold được tính **chỉ từ calibration**, trước inference trên test:

- `eer`: điểm empirical có |FAR−FRR| nhỏ nhất, tie ưu tiên FAR thấp.
- `security`: TAR cao nhất với empirical FAR ≤ `--security-target-far`; tie
  ưu tiên FAR thấp rồi threshold chặt hơn. Tham số này bắt buộc nhập.
- `ux_balanced`: tối thiểu hóa FAR+FRR, tương đương maximize balanced accuracy;
  trọng số bằng nhau là policy exploratory được ghi rõ, không phải yêu cầu thi.

Grid 0.36/0.40/0.45/0.50/0.55/0.60 chỉ dùng bảng khảo sát, số FAR/FRR lấy từ
dataset lúc chạy. Không có số metric minh họa bị trình bày như kết quả thật.
Test dùng nguyên thresholds đã freeze; ROC/EER/TAR-at-FAR trên test chỉ diagnostic,
không dùng threshold test cho recommendation. Không chọn policy bằng test.

TAR@FAR 10%/5%/1% chỉ hiển thị nếu `N_impostor × target >= 10`; đây là heuristic
về số lượng, không phải confidence guarantee. Dưới mức đó để `null`. FAR step
`1/N` và upper bound IID khi zero accepts được ghi rõ chỉ là minh họa vì pairs
chia sẻ người/ảnh. Không công bố FAR 0.1% đáng tin trên pilot nhỏ.

## E. Training Decision

Training performed: **NO**. Training needed: **chưa thể kết luận YES/NO**.
Gate hiện tại: **AWAITING_DATASET**, không có đủ bằng chứng để ra lệnh training.

Khi chạy baseline, thiếu bộ acceptance FAR/FRR/CPU p95 thì gate trả
`AWAITING_REQUIREMENTS`. Các tham số `--acceptance-max-far`,
`--acceptance-max-frr`, `--acceptance-max-latency-ms` phải được cung cấp cùng nhau.
Gate chỉ dùng calibration và CPU timing; FRR requirement xét cả quality rejects.
Đạt các yêu cầu empirical: `KEEP_SFACE`, ghi “Training/fine-tuning không chứng
minh được lợi ích cần thiết.” Không đạt: `REVIEW_EXPERIMENT`, cần phân tích overlap,
quality errors và chi phí CPU/model trước khi quyết định fine-tune. Script không
tự bắt đầu training; model load/RAM/size và held-out results vẫn cần review.

Dataset 20–100 người quá nhỏ cho face recognition from scratch đáng tin cậy.
Chỉ dùng benchmark/calibration/domain validation hoặc controlled fine-tuning
từ pretrained backbone phù hợp. Loss giảm không chứng minh verification tốt hơn.
Không train YuNet. Không tạo `train_face_recognition.py` khi gate chưa có dữ liệu.

## F. Candidate Model

**Chỉ shortlist nghiên cứu; chưa chọn checkpoint, chưa tải weights.** Ưu tiên
MobileFaceNet + ArcFace, sau đó IResNet18, cuối cùng IResNet50. Lý do ưu tiên
model nhỏ là target CPU; chưa có phép đo local chứng minh latency của ứng viên.
Official `arcface_torch` hỗ trợ cả `mbf`, `r18`, `r50` và export ONNX.
[Backbone registry](https://github.com/deepinsight/insightface/blob/master/recognition/arcface_torch/backbones/__init__.py),
[official training](https://github.com/deepinsight/insightface/tree/master/recognition/arcface_torch).

| Option | Parameters / model bytes | Embedding cấu hình upstream | CPU latency | Training complexity | ONNX |
|---|---|---|---|---|---|
| MobileFaceNet + ArcFace | Chờ instantiate đúng variant/checkpoint | 512 mặc định | Chưa đo | Ưu tiên thử đầu, controlled fine-tuning | Có upstream exporter; cần parity |
| IResNet18 + ArcFace | Chờ checkpoint | 512 | Chưa đo | Phương án kế tiếp | Như trên |
| IResNet50 + ArcFace | Chờ checkpoint | 512 | Chưa đo | Chỉ thử nếu lợi ích đủ bù chi phí | Như trên |

Không lấy parameter count/size của một MobileFaceNet variant khác gán cho
checkpoint chưa chọn. Khi mở experiment phải đo `numel`, file bytes, CPU p95,
RAM và load time. Pretrained source dự kiến: official InsightFace model zoo,
**phải xác minh checkpoint thực sự trainable, hash và quyền dùng cụ thể**.
Upstream nêu pretrained models dành cho non-commercial research; code license
không thay thế quyền weights. [Model zoo policy](https://github.com/deepinsight/insightface/tree/master/recognition/arcface_torch#model-zoo).

Nếu được mở gate: dùng loss upstream đã có, không tự viết additive margin mới.
ArcFace class công bố `margin=0.5` rad, `scale=64`; normalized embeddings và
class weights tạo cosine logits. Đây là cấu hình tham chiếu, chưa là hyperparameter
đã validation của project. [Loss](https://github.com/deepinsight/insightface/blob/master/recognition/arcface_torch/losses.py),
[normalization](https://github.com/deepinsight/insightface/blob/master/recognition/arcface_torch/partial_fc_v2.py).

Contract dự kiến cho đúng checkpoint `arcface_torch`: aligned 112×112 **RGB**,
float32 NCHW, `(pixel/255 − 0.5)/0.5` → [-1,1], mean/std=(0.5,0.5,0.5)
sau ToTensor; output 512D rồi L2. Phải kiểm chứng với checkpoint cụ thể, không
reuse scale=1/mean=0 của SFace. [Training transform](https://github.com/deepinsight/insightface/blob/master/recognition/arcface_torch/dataset.py),
[export normalization](https://github.com/deepinsight/insightface/blob/master/recognition/arcface_torch/torch2onnx.py).

Controlled fine-tuning sau này: pretrained backbone, freeze phần đầu rồi chỉ mở
những block đã định trước, learning rate nhỏ và validation verification metrics.
Seed Python/NumPy/PyTorch; lưu config, optimizer/scheduler, epochs, margin/scale,
source/hash checkpoint, source commit, timestamp, best validation checkpoint;
NaN detection, early stopping và không dùng test để chọn epoch. Augmentation nhẹ:
flip, brightness/contrast/color jitter, blur/JPEG nhẹ, affine nếu alignment còn
hợp lý; giữ domain reference/webcam. Không rotate 90°, distortion hay erasing lớn.

Head ArcFace dùng labels của train identities để học embedding rồi bỏ ở inference;
đó không phải API phân loại Student001/Student002. Người chưa từng thấy vẫn được
verify bằng embedding → cosine → threshold. Mỗi model cần MODEL_NAME,
MODEL_VERSION, PREPROCESSING_VERSION, EMBEDDING_DIMENSION riêng.

## G. Training Result

Epochs: **0**. Best checkpoint: **N/A**. Validation metrics: **N/A**.
Không tuyên bố train thành công, không tạo checkpoint placeholder.

## H. SFace vs Candidate

| Metric | SFace | Candidate |
|---|---|---|
| Embedding dimension | 128 | Chưa chọn; shortlist dự kiến 512 |
| Model size | 38,696,353 bytes | N/A |
| CPU latency | Chờ dataset thật | N/A |
| ROC AUC / EER | N/A | N/A |
| FAR / FRR / TAR @ frozen threshold | N/A | N/A |
| Model load time / RAM benchmark | Chưa có baseline dataset run | N/A |
| ONNX export | ONNX inference artifact có sẵn | Chưa export/parity |
| Integration complexity | Service hiện có | Thêm training/runtime/preprocessing/versioning cần đánh giá |

Fair comparison sau này dùng **cùng manifest, identities, planned pairs và
sampling seed/cap**; calibrate mỗi model trên cùng calibration split, freeze rồi
test cùng test split. Không loại ảnh khó riêng để tạo lợi thế; so coverage/end-to-end
cùng conditional metrics. Nếu dùng test nhiều vòng chọn model phải có final
holdout mới. Không đánh giá bằng closed-set classification accuracy.

Chỉ khi candidate thắng rõ mới export và kiểm tra PyTorch vs ONNX trên cùng
aligned input; định trước tolerances embedding/cosine và kiểm tra quyết định gần
threshold. Chưa thực hiện export/parity vì chưa có candidate hoặc bằng chứng thắng.

## I. Production Recommendation

**KEEP_SFACE.** Đây là giữ nguyên hệ thống trong khi chờ bằng chứng, không phải
tuyên bố SFace đã đạt FAR/FRR yêu cầu. Không đổi YuNet/SFace, API, auth, DB,
frontend, attempt flow hoặc threshold. Không auto-deploy bất kỳ candidate nào.

Next step: thu dataset theo [README](../data/README.md), cố định labels/split và
yêu cầu FAR/FRR/CPU; chạy validator → baseline → calibration → review gate.

Sau khi có dữ liệu thật, runner tạo trong một output directory mới:

```text
roc.png
similarity_distribution.png
metrics.json
threshold_report.csv
benchmark_report.md
roc_calibration.csv
roc_test.csv
pair_protocol.csv
failure_analysis.csv
```

Failure analysis chứa opaque pair_id, similarity, loại false accept/reject/quality
reject và categories reference/webcam; không chứa ảnh, vectors hoặc source paths.
Metadata giúp tìm mối liên quan low resolution/blur/pose/glasses/reference quality;
không tự kết luận nhân quả hoặc lỗi alignment chỉ từ similarity. Runtime metadata,
script/model/source hashes, seed và config nằm trong metrics.json. Git commit
để null khi workspace không có Git. Metadata/score vẫn cần giữ local.

Artifact plots/metrics thật chưa được tạo vì chưa có dataset. Integration test đã
tạo và kiểm tra chúng trong thư mục tạm từ synthetic scores rồi dọn bằng test
fixture; không công bố chúng thành baseline nhận diện.

## J. Limitations

- Dataset size: chưa có dataset có nhãn; minimum để script chạy không tương đương
  minimum để chứng minh yêu cầu nghiệp vụ.
- Demographic coverage: chưa biết; chưa thể khẳng định hiệu năng giữa các nhóm.
- Device coverage: chưa biết; máy chạy benchmark không đại diện mọi webcam.
- Lighting/pose/glasses coverage: chưa có metadata thật; unknown không được đoán.
- Statistical confidence: pairs tương quan; số impostor lớn từ ít người không đủ
  cho FAR hiếm. Chưa có identity-cluster confidence intervals hoặc population guarantee.
- Reference trust/label quality cần quản lý ngoài model. Byte hash không phát hiện
  mọi dạng cùng người/ảnh bị đổi encoding.
- Model pretraining identity overlap chưa được xác minh; split nội bộ không tự
  chứng minh không overlap với nguồn pretraining.
- CPU benchmark không thay thế endpoint/concurrency/retry/three-reference testing.
- Candidate dependencies/checkpoint license/ONNX parity và training safety loop
  chỉ được triển khai sau khi gate có bằng chứng cần thiết.

## Files và validation

Tạo `.gitignore`, `data/README.md`, report này, `backend/requirements-face-experiments.txt`,
`backend/scripts/face_dataset.py`, `prepare_face_dataset.py`, `face_metrics.py`,
`benchmark_face_phase2.py`, `backend/tests/test_face_phase2.py`.

32 Phase 2 tests kiểm tra deterministic identity/pair generation, genuine/impostor
labels, leakage/duplicate/path/metadata, decode/EXIF qua production engine,
quality failure accounting, AUC/EER/ties/boundaries, threshold freeze trước test,
gate requirements, CPU repetitions và PNG/JSON/CSV/report privacy trong tempdir.
Không unit-test framework internals hoặc dùng ảnh người thật cho tests.

Các lệnh kiểm tra từ `backend/`:

```powershell
& '.venv/Scripts/python.exe' -m unittest discover -s tests -p test_face_phase2.py -v
& '.venv/Scripts/python.exe' -m unittest discover -s tests -v
& '.venv/Scripts/python.exe' scripts/benchmark_face_verification.py --self-test
& '.venv/Scripts/python.exe' scripts/benchmark_face_verification.py --smoke --threads 1 --warmup 10
```

Final validation: **125/125 tests pass**, gồm 93 tests hiện hữu + 32 tests Phase 2.
Benchmark Phase 1 self-test và model smoke pass (10 warmup + 20 synthetic crop
inferences; chỉ runtime/shape, không phải accuracy). `compileall`, hai CLI `--help`
và `pip check` pass. Cảnh báo Starlette/httpx và Alembic đã tồn tại từ baseline;
không đổi các dependency đó trong task.

CLI validator đã chạy với model YuNet/SFace local trên 8 ảnh nền tổng hợp trong
tempdir: cả 8 bị từ chối `NO_FACE_DETECTED`. Runner dừng đúng khi không có cả hai
loại score, không tạo baseline artifacts. CLI thiếu dataset trả thông báo
“Awaiting labeled real-world dataset.” và không tạo output directory.

Đối chiếu SHA-256 trước/sau **161 file** trong service/API/config, model files,
frontend, migrations, requirements gốc và benchmark Phase 1: **0 file thay đổi**.
Evidence local nằm ở `artifacts/face_verification_checks/validation_summary.json`
và snapshot hashes; không thay thế Git history vì workspace không có `.git`.
Không có thay đổi production, không deploy.

## Real Dataset Summary

Kiểm tra Phase 2.6 ngày **04/10/2026, Asia/Saigon**, trong workspace
`D:/ChauAnh/PBL6 new`. Yêu cầu cho biết dataset đã được đặt theo README, nhưng
filesystem hiện có `data/README.md` và **không có `data/face_verification/`**.
Các vị trí `datasets/`, `backend/data/face_verification/`, `backend/datasets/`
cũng không tồn tại. Kiểm tra các thư mục project ngoài dependencies, build outputs,
test screenshots và application private/uploads không tìm thấy cấu trúc
`reference/webcam`, manifest/annotations dataset hoặc archive dataset.
Không kết luận dataset không tồn tại ở một đường dẫn khác trên máy; đã yêu cầu
cung cấp đường dẫn thực tế. Không đọc ảnh enrollment private hoặc DB làm dataset.

Đã chạy lệnh thực, không chỉ kiểm tra CLI help:

```powershell
& './backend/.venv/Scripts/python.exe' backend/scripts/prepare_face_dataset.py --dataset data/face_verification --output artifacts/face_verification/prepared-real-20261004 --ratios 0.6 0.4 --seed 42 --threads 1
```

Exit code **1**, thông báo:

```text
Dataset validation stopped: Dataset directory is missing. Awaiting labeled real-world dataset.
```

Validator dừng trước split/model inference, không tạo output directory, không
đọc/overwrite ảnh gốc. Không có validation report về chất lượng ảnh thật.

| Dataset field | Kết quả lần kiểm tra này |
|---|---|
| Identities tìm thấy theo protocol | 0 |
| Reference images tìm thấy | 0 |
| Webcam images tìm thấy | 0 |
| Ảnh đã đưa qua validator | 0 |
| Valid images | N/A — chưa có ảnh để kiểm tra |
| NO_FACE_DETECTED | N/A |
| MULTIPLE_FACES_DETECTED | N/A |
| FACE_TOO_SMALL | N/A |
| INVALID_IMAGE | N/A |
| Các rejection khác | N/A |

Webcam trung bình/người, front/left/right pose, lighting, glasses và device
coverage: **N/A** vì chưa có dataset/metadata. Không suy đoán demographic
attributes hoặc suy ra chất lượng từ các ảnh ngoài dataset.

Calibration/test 60/40, seed 42 là cấu hình lệnh dự định dùng khi chưa training;
**chưa có split được tạo**. Số identity đã phân vào train/calibration/test đều
bằng 0. Assertion chống leakage trong helper hiện có chưa được chạy trên dataset
thật ở lượt này. Các unit tests của lượt trước không thay thế kiểm tra nhãn thật.

## SFace Baseline

**NOT_RUN — DATASET_INSUFFICIENT.** Không thực hiện model extraction hoặc comparison
trên dữ liệu người thật. Genuine pairs đã tạo: **0**; impostor pairs đã tạo: **0**.
Đây là số pair đã thực sự xử lý, không phải kết quả match/non-match.

SFace/YuNet và preprocessing production giữ nguyên. Sau khi đường dẫn được xác
định, phải validate toàn bộ dữ liệu và kiểm tra đủ số người/ảnh hợp lệ trước khi
benchmark; không chỉ dựa vào minimum hai identities/split để gọi là đáng tin.

## Similarity Distribution

Genuine và impostor mean/median/std/min/max: **N/A**. Chưa có cosine scores.
Không tạo histogram hoặc ROC plot giả, không sử dụng synthetic scores/noise của
unit tests làm kết quả trên dataset thật, không đưa face images vào báo cáo.

## Calibration

ROC/AUC/EER và threshold tại EER: **N/A**. FAR/FRR/TAR/accuracy ở các threshold:
**N/A**. Chưa có threshold grid được lựa chọn cho lượt benchmark thật.

Khi có dữ liệu, grid phải lấy theo distribution của **calibration**; không dùng
một dải cố định không phù hợp hoặc điều chỉnh theo test. Các option EER,
security theo FAR target và UX chỉ được tính sau validation. Chưa xác lập yêu cầu
FAR/FRR nghiệp vụ; không tuyên bố FAR 1% hay thấp hơn từ dữ liệu hiện không có.

## Frozen Threshold

Frozen threshold: **NONE**. Chưa chọn hoặc ghi ngưỡng mới. Config threshold
production không thay đổi. Khi có baseline, freeze từ calibration trước khi
đánh giá test; không retune bằng test set.

## Test Results

Test evaluation: **NOT_RUN**. TP/TN/FP/FN, FAR/FRR/TAR/TPR, accuracy, ROC AUC
và descriptive EER đều **N/A**. Không ghi 0 lỗi hoặc 100% accuracy khi không có
phép thử. Chưa có test identities hoặc ảnh test được dùng để tune.

## False Accept Analysis

**N/A** — chưa có impostor scores hoặc quyết định đối chiếu. Không thể xác định
FP hay liên hệ lỗi với blur/reference/alignment/face size/pose/lighting. Không
xuất dữ liệu giả danh giả hoặc copy ảnh mặt để lấp report.

## False Reject Analysis

**N/A** — chưa có genuine scores hoặc quyết định đối chiếu. Không thể xác định
FN hay liên hệ với glasses/side pose/old reference/resolution/compression/lighting.
Khi có dữ liệu, chỉ dùng opaque pair IDs và categorical metadata trong analysis.

## CPU Performance

Model load, face detection, alignment + embedding và end-to-end verification
latency cho real-data baseline: **NOT_MEASURED**. Mean/median/p95: **N/A**.
Không dùng latency smoke trên crop synthetic từ lượt trước thay cho số đo
baseline lần này. Cấu hình dự kiến sau khi đủ dữ liệu: 10 warmup, ít nhất 100 runs
nếu runtime cho phép; ghi CPU model cùng kết quả thực.

## Decision Gate

Lượt Phase 2.6 dừng ở dataset validation theo điều kiện dừng của yêu cầu. Chưa có
bằng chứng FAR/FRR, overlap hoặc latency để kết luận `KEEP_SFACE` vì đạt yêu cầu
hay `EXPERIMENT_WITH_ARCFACE` vì baseline chưa đạt. Khuyến nghị giữ nguyên hệ thống
ở phần I trước đó là trạng thái vận hành, **không phải quyết định từ real-data
baseline**. Không training và không tạo proposal fine-tuning thiếu căn cứ.

Thay đổi của lượt này chỉ là cập nhật báo cáo và ghi evidence kiểm tra local ở
`artifacts/face_verification_checks/phase26_dataset_preflight.json`; không sửa
pipeline/scripts, model, threshold, FastAPI flow, DB hoặc frontend. Không chạy
lại full test suite vì không có thay đổi code; kết quả 125/125 ở phần trước là
kết quả đã thực hiện ở lượt triển khai Phase 2.1–2.5.

**Production changed: NO. Training performed: NO.**

**Decision: DATASET_INSUFFICIENT**

**Reason:** Không tìm thấy dataset reference/webcam tại đường dẫn quy định hoặc
vị trí dataset khác trong phạm vi workspace đã kiểm tra. Cần đường dẫn thực tế
tới dataset có nhãn để tiếp tục validation và đánh giá số lượng/coverage. Không
fabricate metrics hoặc ra quyết định đổi model khi chưa chạy baseline.

## Local Dataset Collection

Đã thêm [collect_face_dataset.py](../backend/scripts/collect_face_dataset.py),
[validate_face_dataset.py](../backend/scripts/validate_face_dataset.py) và
[25 tests collection](../backend/tests/test_face_dataset_collection.py).
Hướng dẫn đầy đủ và lệnh chạy nằm trong [data/README.md](../data/README.md).
Đây là Python CLI local, không tích hợp production frontend/API.

Môi trường OpenCV headless báo `GUI: NONE`; camera đọc qua `VideoCapture`,
preview dùng Tkinter/Pillow đã có sẵn. Không thay OpenCV wheel hoặc requirements.
Có `--no-preview` để thu trong terminal, `--reference-only` để import reference
mà không mở webcam, và `--camera` chọn thiết bị. Công cụ xác nhận participant
consent trước khi đọc ảnh/mở camera; `--consent` ghi nhận operator đã có sự đồng ý.

Flow: chọn trusted source → tạo JPEG copy, giữ nguyên source → validate exact
saved bytes bằng `FaceEngine.extract_embedding()` → webcam preview → SPACE
capture/validate → S/Enter save hoặc R retake → Q quit. Ảnh không hợp lệ không
được lưu; lỗi hiển thị theo production code. Không gọi similarity để lọc ảnh.
Detector wrapper chỉ quan sát bbox size từ lần YuNet chạy trong service;
không viết lại preprocessing/detection. Raw embedding tạm thời bị bỏ ngay.

Dataset dùng anonymous `person_001`, `person_002`, …; mỗi người
`reference/reference.jpg` và webcam `front_01.jpg`, `front_02.jpg`, `left.jpg`,
`right.jpg`, `low_light.jpg`. Reference được lấy từ file trusted/profile/card,
không lấy từ webcam flow. JPEG copy dùng production decode/EXIF/thumbnail,
quality 95, loại EXIF; ảnh gốc không bị sửa hoặc xóa. File hiện có chỉ bị thay
khi operator xác nhận, duplicate reference khác tên bị từ chối. Phiên có thể
được resume; <3 webcam được báo incomplete, target là 5.

`metadata.json` ở gốc dataset để giữ tương thích discovery Phase 2. Metadata
có person_id/type/capture_label/relative filename, width/height, face_bbox_size,
timestamp UTC và SHA-256; không chứa tên nguồn, danh tính thật hoặc vectors.
Timestamp reference là thời điểm import. Label góc/ánh sáng là hướng dẫn cho
operator, không phải model tự phân loại; không tự suy đoán demographics.

Summary CLI đọc mọi ảnh qua production engine, hỗ trợ cả empty/incomplete dataset,
không cần split và không ghi ảnh. Nó báo identities/reference/webcam/valid/rejected,
error codes, >=3 valid probes, duplicate content và stale/missing metadata.
10 complete identities là minimum prototype để chuyển sang prepare, 20–30 là
recommended PBL, 50+ tốt hơn; các cỡ này không tự bảo đảm FAR thấp đáng tin.
`READY_FOR_PREPARATION` không có nghĩa đủ chất lượng/statistical confidence để deploy.

Privacy: thu có đồng ý cho thử nghiệm project, giữ local ngoài cloud sync, không
upload hoặc commit, xóa khi không còn cần. Đã ignore riêng optional
`data/face_verification_private_mapping.csv`; không tạo mapping vì tool và
benchmark không cần. `data/README.md` vẫn không bị ignore. Dataset root hiện
trống; không tạo ảnh mặt giả hoặc dữ liệu sinh viên mẫu.

Giới hạn: các ảnh lưu đã qua quality filter nên không dùng số ảnh đó để ước tính
tỷ lệ reject của mọi lần bấm capture. Metadata updates atomic theo file và handled
write errors rollback ảnh; power/process interruption có thể để lại metadata
cũ hoặc lock, được summary/checks phát hiện. Không chạy benchmark đồng thời thu dữ liệu.

Validation lượt này: **150/150 tests PASS** (125 tests cũ + 25 collection tests).
Kiểm thử gồm IDs/path/filenames, directory creation, duplicate reference,
no-overwrite, confirmed replacement, metadata, rollback, consent cancellation,
capture/retake/resume, EXIF, gates production, read-only summary và compatibility
với `discover_dataset`/identity split. `compileall`, CLI help và `pip check` pass.
Tkinter/Pillow preview render smoke pass với cửa sổ ẩn và pixels tổng hợp.
CLI dùng YuNet/SFace local từ chối ảnh nền `NO_FACE_DETECTED`, không lưu ảnh
invalid, giữ nguyên file nguồn, và summary đếm đúng identity chưa đủ ảnh.
**Chưa mở hoặc kiểm thử webcam hardware**, đúng phạm vi test yêu cầu.

Đối chiếu snapshot SHA-256 **165 file production và pipeline Phase 2 cũ**:
0 file thay đổi. Evidence ở
`artifacts/face_verification_checks/collection_validation_summary.json`.
File mới: 2 scripts + 1 test file. File cập nhật: `.gitignore`, `data/README.md`,
report này. Thư mục dataset local đã tạo, không có biometric images.

**Production changed: NO. Training performed: NO.**

**Decision: DATASET_INSUFFICIENT.** Collection tool sẵn sàng để operator thu dữ
liệu có nhãn; chưa có real-data baseline/calibration/threshold mới.
