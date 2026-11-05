# Hệ Thống Giám Sát Thi Trực Tuyến Đa Tầng (Multi-tier Online Exam Proctoring)

> **Trường Đại học Bách Khoa - Đại học Đà Nẵng (DUT)**  
> Khoa Công nghệ Thông tin — Môn học: Thị giác Máy tính (Computer Vision)  
> _Lịch sử Train Lần 3 — Hướng đi mới: Phát hiện Vật thể Cấm + Giám sát Hướng nhìn_

---

## Nội Dung Thư Mục Này

```
lich su train lan 3/
├── gaze_tracking.py          <- Module nhận diện hướng nhìn & tư thế đầu 3D (độc lập)
├── demo_multitier_system.py  <- Demo tích hợp đa tầng: YOLO26n + Gaze Tracking
├── yolo26_results/           <- Kết quả training YOLO26n phát hiện 7 vật thể
│   └── yolo26n_7cls/
│       └── weights/
│           └── best.pt       <- Trọng số YOLO26n tốt nhất (cần có để chạy demo)
└── notebook2812822fe0.ipynb  <- Notebook training YOLO26n gốc (Kaggle)
```

---

## Cài Đặt Môi Trường

### Bước 1: Tạo Virtual Environment

```powershell
cd "lich su train lan 3"
uv venv
.venv\Scripts\activate
```

### Bước 2: Cài đặt thư viện cần thiết

```powershell
uv pip install opencv-python mediapipe numpy ultralytics
```

Hoặc dùng pip thông thường:

```powershell
pip install opencv-python mediapipe numpy ultralytics
```

### Yêu Cầu Tối Thiểu

| Thư Viện | Phiên Bản Khuyến Nghị | Mục Đích |
|---|---|---|
| `opencv-python` | >= 4.8 | Xử lý ảnh, vẽ HUD, kết nối webcam |
| `mediapipe` | >= 0.10 | Face Mesh 468 landmarks + Iris Tracking |
| `numpy` | >= 1.24 | Tính toán ma trận, tư thế 3D |
| `ultralytics` | >= 8.0 | YOLO26n inference |

> **Lưu ý:** Python 3.9+ được khuyến nghị. Script đã được kiểm tra trên Python 3.13.

---

## File 1: `gaze_tracking.py` — Nhận Diện Hướng Nhìn & Tư Thế Đầu 3D

### Mô tả

Module **độc lập** phân tích khuôn mặt thí sinh từ webcam theo thời gian thực, kết hợp:

- **Ước lượng tư thế đầu 3D** bằng `cv2.solvePnP` (6 điểm mốc khuôn mặt chuẩn)
- **Theo dõi con ngươi** (Iris Tracking) qua MediaPipe Face Mesh (10 điểm iris landmarks)
- **Bộ đếm thời gian vi phạm** — chỉ cảnh báo khi nhìn lệch **liên tục > 2.0 giây**

### Cách Chạy

```powershell
python gaze_tracking.py
```

### Các Góc Và Ngưỡng Phát Hiện

| Hành Vi | Góc / Tỷ Lệ | Mô Tả |
|---|---|---|
| Quay mặt sang **Trái** | Yaw < -18 do | Nhìn sang màn hình phụ hoặc tài liệu bên trái |
| Quay mặt sang **Phải** | Yaw > +18 do | Nhìn sang người ngồi cạnh |
| Cúi **Xuống bàn** | Pitch < -14 do | Nhìn tài liệu/điện thoại giấu dưới ngăn bàn |
| Ngửa **Lên trên** | Pitch > +18 do | Nhìn trần nhà, tư thế bất thường |
| **Liếc** trái (con ngươi) | Gaze Ratio > 0.63 | Mặt hướng màn hình nhưng mắt liếc sang trái |
| **Liếc** phải (con ngươi) | Gaze Ratio < 0.37 | Mặt hướng màn hình nhưng mắt liếc sang phải |
| **Không thấy mặt** | — | Thí sinh rời khỏi tầm camera |

### Phím Tắt

| Phím | Chức năng |
|---|---|
| `Q` / `ESC` | Thoát chương trình |
| `S` | Chụp lưu ảnh thủ công vào `screenshots_gaze/` |
| `R` | Đặt lại bộ đếm thời gian vi phạm |

### Kết Quả Đầu Ra

- **HUD thời gian thực**: Hiển thị Pitch, Yaw, Roll, Gaze Ratio và thời gian nhìn lệch.
- **Trục tọa độ 3D trên mũi**: Trực quan hóa hướng nhìn (trục X/Y/Z màu đỏ/xanh/xanh dương).
- **Tự động lưu bằng chứng**: Khi nhìn lệch liên tục >= 2.0s, ảnh tự động lưu vào `screenshots_gaze/alert_<STATUS>_<timestamp>.jpg`.

### API Module (dùng cho các script khác)

```python
from gaze_tracking import GazeAndHeadTracker, ALERT_DURATION_SECONDS

tracker = GazeAndHeadTracker()
result = tracker.process_frame(frame)  # frame: numpy array từ cv2

# result chứa:
# result["status"]       - trạng thái: NORMAL / LOOKING_LEFT / LOOKING_RIGHT / ...
# result["pitch"]        - góc cúi đầu (độ)
# result["yaw"]          - góc quay trái-phải (độ)
# result["roll"]         - góc nghiêng (độ)
# result["gaze_ratio"]   - tỷ lệ vị trí con ngươi (0.0 - 1.0)
# result["violation_sec"]- thời gian nhìn lệch liên tục (giây)
# result["alert"]        - True nếu đang ở trạng thái cảnh báo
# result["frame"]        - frame đã được vẽ annotations
```

---

## File 2: `demo_multitier_system.py` — Demo Hệ Thống Giám Sát Đa Tầng

### Mô tả

Hệ thống tích hợp **hai tầng** chạy đồng thời trên cùng một luồng webcam:

```
Webcam Frame
    |
    +-- [TANG 1] YOLO26n --> Phat hien & khoanh vung 7 vat the cam
    |                        (cell phone, book, headphone, smartwatch, laptop, tv, person)
    |
    +-- [TANG 2] MediaPipe Gaze Tracker --> Goc dau 3D & vi tri trong mat
                                            (Pitch, Yaw, Roll, Gaze Ratio)
         |
         +-- [RISK ENGINE] --> Danh gia muc do nguy co & Xuat canh bao
```

### Cách Chạy

```powershell
python demo_multitier_system.py
```

> **Yêu cầu**: File trọng số YOLO phải có sẵn tại `yolo26_results/yolo26n_7cls/weights/best.pt`.  
> Nếu thiếu, chương trình vẫn chạy ở chế độ **Gaze Only** (chỉ theo dõi hướng nhìn).

### Mức Độ Cảnh Báo (Risk Assessment Engine)

| Mức Độ | Màu Viền | Điều Kiện Kích Hoạt |
|---|---|---|
| **NGUY HIỂM CAO** | Đỏ đậm | Phát hiện `cell phone` / `book` / `headphone` / `smartwatch` HOẶC nhìn lệch liên tục > 2.0s |
| **CHÚ Ý** | Cam vàng | Hướng nhìn lệch nhẹ (< 2.0s) |
| **AN TOÀN** | Xanh lá | Không có vật thể cấm, nhìn thẳng màn hình |

### Phím Tắt

| Phím | Chức năng |
|---|---|
| `Q` / `ESC` | Thoát chương trình |
| `S` | Chụp lưu biên bản vi phạm vào `../screenshots/manual_snap_<timestamp>.jpg` |
| `+` / `=` | Tăng ngưỡng confidence YOLO (+5%) |
| `-` / `_` | Giảm ngưỡng confidence YOLO (-5%) |
| `SPACE` | Tạm dừng / tiếp tục luồng video |

### Kết Quả Đầu Ra

- **Bounding Box** với nhãn tên vật thể và phần trăm tin cậy trực tiếp trên khung hình.
- **HUD tổng hợp**: Trạng thái Tầng 1 (vật thể), Tầng 2 (hướng nhìn), góc đầu, thời gian vi phạm.
- **Tự động lưu biên bản**: Ảnh chứng cứ vi phạm lưu vào `../screenshots/evidence_<timestamp>.jpg`.

---

## Kiến Trúc Kỹ Thuật Chi Tiết

### Tầng 1: YOLO26n Object Detection

- **Mô hình**: `YOLO26n` (Ultralytics) — Nano, 2.53M tham số
- **mAP50**: 73.97% | **mAP50-95**: 41.44%
- **Tốc độ**: ~3.9ms/frame (GPU Tesla T4) | ~87ms/frame (CPU laptop)

**7 Class phát hiện và kết quả:**

| Class | AP50 | Ghi Chú |
|---|---|---|
| `tv / monitor` | 97.6% | Màn hình phụ |
| `person` | 95.1% | Thí sinh |
| `cell phone` | 79.5% | Vật thể cấm |
| `laptop` | 74.4% | Máy tính bổ sung |
| `book` | 72.1% | Vật thể cấm |
| `smartwatch` | 61.5% | Vật thể cấm |
| `headphone` | 37.7% | Vật thể cấm (recall thấp — cần cải thiện) |

### Tầng 2: MediaPipe Gaze & Head Pose Tracking

- **MediaPipe Face Mesh**: 468 facial landmarks + 10 iris landmarks (tổng 478 điểm)
- **Head Pose** via `cv2.solvePnP`:
  - Ma trận camera giả định từ kích thước frame
  - Giải hệ PnP (Perspective-n-Point) với 6 điểm mốc khuôn mặt chuẩn
  - Phân rã ma trận xoay Rodrigues → Góc Euler (Pitch, Yaw, Roll)
- **Iris Gaze Ratio**: Tỷ lệ khoảng cách từ con ngươi tới 2 khóe mắt, lấy trung bình cả 2 mắt

---

## Bối Cảnh Nghiên Cứu

Đây là **hướng đi mới** được đề xuất sau khi phát hiện hạn chế của phương pháp **phân loại ảnh nhị phân** tại _lịch sử train lần 2_:

| Tiêu chí | Train Lần 2 (CNN Classification) | Train Lần 3 (Multi-tier) |
|---|---|---|
| Cơ chế | Phân loại toàn khung hình (Black-box) | Khoanh vùng vật thể + Theo dõi mắt 3D |
| Bằng chứng vi phạm | Chỉ có xác suất % | Bounding Box + Góc lệch cụ thể |
| Nguy cơ bắt lỗi oan | Cao (chống cằm = gian lận) | Thấp (có bộ đếm thời gian 2s) |
| Phát hiện liếc mắt | Không | Có (Iris Gaze Ratio) |

---

## Lưu Ý Khi Sử Dụng

1. **Ánh sáng**: Hệ thống cần ánh sáng đủ sáng và đồng đều. Tránh ngược sáng hoặc ánh sáng chiếu thẳng vào mặt.
2. **Góc camera**: Webcam nên đặt ngang tầm mắt, cách mặt 50–80cm để MediaPipe nhận diện chính xác nhất.
3. **Điều chỉnh ngưỡng**: Có thể thay đổi `YAW_THRESHOLD_LEFT/RIGHT`, `PITCH_THRESHOLD_DOWN/UP` trong `gaze_tracking.py` cho phù hợp điều kiện phòng thi.
4. **Thiếu model YOLO**: Nếu không có `best.pt`, hệ thống tự động chạy chế độ Gaze-Only với thông báo cảnh báo.

---

## Tham Khảo

- **MediaPipe** — Google LLC: https://mediapipe.dev
- **Ultralytics YOLO** — https://ultralytics.com
- **Paper gốc**: _"Deep Learning-Based Suspicious Activity Detection in Online Proctored Examinations"_, CMC 2025, DOI: 10.32604/cmc.2025.067359
- **Dataset**: MSU Online Exam Proctoring Dataset (OEP) — Kaggle: `raajanwankhade/oep-dataset`

---

_Đề tài: Nghiên cứu & Phát triển Hệ thống Giám sát Thi Trực tuyến Đa tầng — Trường Đại học Bách Khoa, Đại học Đà Nẵng._
