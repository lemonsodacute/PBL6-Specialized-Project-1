"""
=============================================================================
gaze_tracking.py — Phát hiện hướng nhìn & tư thế đầu (Gaze & Head Pose Tracking)
Phục vụ giám sát thi trực tuyến (Online Exam Proctoring)
Thư mục: lich su train lan 3
=============================================================================

Công nghệ sử dụng:
  - MediaPipe Face Mesh (468 facial landmarks + 10 iris landmarks)
  - OpenCV solvePnP: Ước lượng tư thế đầu 3D (Pitch, Yaw, Roll)
  - Iris Tracking: Tính toán tỷ lệ vị trí con ngươi mắt (Gaze Ratio)
  - Behavioral Fusion: Kết hợp góc quay đầu và hướng nhìn để phát hiện vi phạm:
      + Nhìn lệch trái / phải (Looking Left / Right)
      + Cúi nhìn tài liệu / điện thoại dưới bàn (Looking Down)
      + Nhìn lên trên / quay đầu ra ngoài (Looking Up / Away)
      + Vắng mặt khỏi khung hình (No Face Detected)
  - Bộ đếm thời gian vi phạm (Warning Timer): Kích hoạt cảnh báo khi nhìn lệch > 2.0 giây

Cách chạy:
  python gaze_tracking.py

Yêu cầu cài đặt:
  pip install opencv-python mediapipe numpy

Tương thích MediaPipe:
  - MediaPipe 0.10.x: dùng mp.solutions.face_mesh (API cũ)
  - MediaPipe 1.x   : dùng mediapipe.tasks FaceLandmarker (API mới)
============================================================================="""

import sys
import time
import math
import os
from datetime import datetime
import cv2
import numpy as np

# Kiểm tra thư viện MediaPipe và phát hiện phiên bản API
try:
    import mediapipe as mp
    HAS_MEDIAPIPE = True
    # MediaPipe 1.x loại bỏ mp.solutions — kiểm tra trước
    _mp_version = tuple(int(x) for x in mp.__version__.split(".")[:2])
    HAS_SOLUTIONS_API = hasattr(mp, "solutions")  # True với 0.10.x
except ImportError:
    HAS_MEDIAPIPE = False
    HAS_SOLUTIONS_API = False
    print("=" * 65)
    print("WARNING: Chua tim thay thu vien 'mediapipe'.")
    print("Hay cai dat bang lenh: pip install mediapipe opencv-python")
    print("=" * 65)

# =============================================================================
# CẤU HÌNH THÔNG SỐ GIÁM SÁT
# =============================================================================
CAMERA_INDEX = 0
FRAME_WIDTH = 1280
FRAME_HEIGHT = 720

# Ngưỡng góc quay đầu (độ)
YAW_THRESHOLD_LEFT = -18.0    # Quay mặt sang trái > 18 độ
YAW_THRESHOLD_RIGHT = 18.0    # Quay mặt sang phải > 18 độ
PITCH_THRESHOLD_DOWN = -14.0  # Cúi đầu nhìn xuống bàn > 14 độ
PITCH_THRESHOLD_UP = 18.0     # Ngửa đầu nhìn lên > 18 độ
ROLL_THRESHOLD_TILT = 22.0    # Nghiêng đầu bất thường

# Ngưỡng tỷ lệ con ngươi (Gaze Ratio)
# Gaze Ratio = (Vị trí con ngươi - khóe mắt trong) / khoảng cách 2 khóe mắt
GAZE_RATIO_LEFT = 0.63
GAZE_RATIO_RIGHT = 0.37

# Ngưỡng thời gian vi phạm liên tục để kích hoạt BÁO ĐỘNG (giây)
ALERT_DURATION_SECONDS = 2.0

# Thư mục lưu ảnh vi phạm
SCREENSHOT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "screenshots_gaze")
os.makedirs(SCREENSHOT_DIR, exist_ok=True)


# =============================================================================
# MÔ HÌNH KHUÔN MẶT 3D CHUẨN (Dùng cho solvePnP)
# =============================================================================
# 6 điểm mốc 3D tiêu chuẩn của khuôn mặt người (đơn vị: mm)
MODEL_POINTS_3D = np.array([
    (0.0, 0.0, 0.0),          # 1. Đỉnh mũi (Nose tip)
    (0.0, -330.0, -65.0),     # 2. Cằm (Chin)
    (-225.0, 170.0, -135.0),  # 3. Khóe mắt ngoài bên trái (Left eye left corner)
    (225.0, 170.0, -135.0),   # 4. Khóe mắt ngoài bên phải (Right eye right corner)
    (-150.0, -150.0, -125.0), # 5. Khóe miệng trái (Left mouth corner)
    (150.0, -150.0, -125.0)   # 6. Khóe miệng phải (Right mouth corner)
], dtype=np.float64)

# Chỉ số landmark tương ứng trên MediaPipe Face Mesh
LANDMARK_IDS_3D = [1, 152, 33, 263, 61, 291]

# Chỉ số landmark mắt & tròng mắt (Iris)
# Mắt trái
LEFT_EYE_CORNER_LEFT = 33
LEFT_EYE_CORNER_RIGHT = 133
LEFT_EYE_TOP = 159
LEFT_EYE_BOTTOM = 145
LEFT_IRIS_CENTER = 468

# Mắt phải
RIGHT_EYE_CORNER_LEFT = 362
RIGHT_EYE_CORNER_RIGHT = 263
RIGHT_EYE_TOP = 386
RIGHT_EYE_BOTTOM = 374
RIGHT_IRIS_CENTER = 473


class GazeAndHeadTracker:
    """Module chuyên biệt ước lượng tư thế đầu 3D và theo dõi ánh mắt."""

    def __init__(self):
        if not HAS_MEDIAPIPE:
            self.face_mesh = None
            self._use_tasks = False
            return

        if HAS_SOLUTIONS_API:
            # ----- MediaPipe 0.10.x: API cũ (mp.solutions) -----
            self._use_tasks = False
            self.mp_face_mesh = mp.solutions.face_mesh
            self.face_mesh = self.mp_face_mesh.FaceMesh(
                max_num_faces=1,
                refine_landmarks=True,  # Bật nhận diện 10 điểm tròng mắt (Iris landmarks)
                min_detection_confidence=0.6,
                min_tracking_confidence=0.6
            )
        else:
            # ----- MediaPipe 1.x: Tasks API mới -----
            self._use_tasks = True
            self._init_face_landmarker()

    def _init_face_landmarker(self):
        """Khởi tạo FaceLandmarker theo Tasks API (MediaPipe >= 1.0)."""
        import urllib.request, os
        from mediapipe.tasks import python as mp_python
        from mediapipe.tasks.python import vision as mp_vision

        # Tải model .task nếu chưa có
        model_path = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                   "face_landmarker.task")
        if not os.path.exists(model_path):
            print("[GazeTracker] Dang tai face_landmarker.task (~6 MB)...")
            url = ("https://storage.googleapis.com/mediapipe-models/"
                   "face_landmarker/face_landmarker/float16/latest/face_landmarker.task")
            urllib.request.urlretrieve(url, model_path)
            print("[GazeTracker] Tai xong:", model_path)

        base_opts = mp_python.BaseOptions(model_asset_path=model_path)
        opts = mp_vision.FaceLandmarkerOptions(
            base_options=base_opts,
            output_face_blendshapes=False,
            output_facial_transformation_matrixes=False,
            num_faces=1,
        )
        self.face_mesh = mp_vision.FaceLandmarker.create_from_options(opts)
        self._mp_image = mp.Image  # dùng khi convert frame

    def estimate_head_pose(self, landmarks, frame_w, frame_h):
        """
        Tính toán góc Pitch (Gật), Yaw (Lắc), Roll (Nghiêng) bằng cv2.solvePnP.
        """
        image_points = []
        for idx in LANDMARK_IDS_3D:
            lm = landmarks[idx]
            x, y = int(lm.x * frame_w), int(lm.y * frame_h)
            image_points.append([x, y])
        image_points = np.array(image_points, dtype=np.float64)

        # Ma trận nội suy camera giả định (Camera Matrix)
        focal_length = frame_w
        center = (frame_w / 2, frame_h / 2)
        camera_matrix = np.array([
            [focal_length, 0, center[0]],
            [0, focal_length, center[1]],
            [0, 0, 1]
        ], dtype=np.float64)

        dist_coeffs = np.zeros((4, 1), dtype=np.float64)

        success, rot_vec, trans_vec = cv2.solvePnP(
            MODEL_POINTS_3D,
            image_points,
            camera_matrix,
            dist_coeffs,
            flags=cv2.SOLVEPNP_ITERATIVE
        )

        if not success:
            return 0.0, 0.0, 0.0, None, None

        # Ma trận xoay -> Góc Euler
        rot_mat, _ = cv2.Rodrigues(rot_vec)
        pose_mat = cv2.hconcat((rot_mat, trans_vec))
        _, _, _, _, _, _, euler_angles = cv2.decomposeProjectionMatrix(pose_mat)

        pitch = float(euler_angles[0, 0])
        yaw = float(euler_angles[1, 0])
        roll = float(euler_angles[2, 0])

        # Điểm chiếu 3D trục tọa độ từ đỉnh mũi
        nose_end_point2D, _ = cv2.projectPoints(
            np.array([(0.0, 0.0, 1000.0), (0.0, 500.0, 0.0), (500.0, 0.0, 0.0)]),
            rot_vec, trans_vec, camera_matrix, dist_coeffs
        )

        nose_tip_2d = tuple(image_points[0].astype(int))
        return pitch, yaw, roll, nose_tip_2d, nose_end_point2D

    def compute_gaze_ratio(self, landmarks, frame_w, frame_h):
        """
        Tính toán tỷ lệ vị trí con ngươi mắt so với độ rộng mắt.
        """
        def _get_pt(idx):
            return np.array([landmarks[idx].x * frame_w, landmarks[idx].y * frame_h])

        # Mắt trái
        l_corner_l = _get_pt(LEFT_EYE_CORNER_LEFT)
        l_corner_r = _get_pt(LEFT_EYE_CORNER_RIGHT)
        l_iris = _get_pt(LEFT_IRIS_CENTER)
        l_width = np.linalg.norm(l_corner_r - l_corner_l)
        l_dist = np.linalg.norm(l_iris - l_corner_l)
        l_ratio = l_dist / l_width if l_width > 0 else 0.5

        # Mắt phải
        r_corner_l = _get_pt(RIGHT_EYE_CORNER_LEFT)
        r_corner_r = _get_pt(RIGHT_EYE_CORNER_RIGHT)
        r_iris = _get_pt(RIGHT_IRIS_CENTER)
        r_width = np.linalg.norm(r_corner_r - r_corner_l)
        r_dist = np.linalg.norm(r_iris - r_corner_l)
        r_ratio = r_dist / r_width if r_width > 0 else 0.5

        # Trung bình tỷ lệ con ngươi 2 mắt
        avg_ratio = (l_ratio + r_ratio) / 2.0
        return avg_ratio, (l_iris.astype(int), r_iris.astype(int))

    def analyze_frame(self, frame):
        """Phân tích 1 frame hình ảnh và trả về kết quả hướng nhìn + tư thế đầu."""
        h, w, _ = frame.shape
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

        if not self.face_mesh:
            return {
                "detected": False,
                "reason": "Thiếu thư viện mediapipe",
                "pitch": 0.0, "yaw": 0.0, "roll": 0.0,
                "gaze_ratio": 0.5,
                "status": "CHUA_CAI_DAT_MEDIAPIPE",
                "is_suspicious": False,
                "alert_text": "Vui long pip install mediapipe"
            }

        # --- Gọi Face Mesh tương thích cả 2 API ---
        if self._use_tasks:
            # MediaPipe 1.x: Tasks API
            mp_img = self._mp_image(image_format=mp.ImageFormat.SRGB, data=rgb)
            det = self.face_mesh.detect(mp_img)
            if not det.face_landmarks:
                return {
                    "detected": False,
                    "reason": "Không phát hiện khuôn mặt",
                    "pitch": 0.0, "yaw": 0.0, "roll": 0.0,
                    "gaze_ratio": 0.5,
                    "status": "KHONG_THAY_MAT",
                    "is_suspicious": True,
                    "alert_text": "CANH BAO: KHONG PHAT HIEN THI SINH!"
                }
            # Tasks API trả về NormalizedLandmark objects (có .x .y .z)
            landmarks = det.face_landmarks[0]
        else:
            # MediaPipe 0.10.x: solutions API
            results = self.face_mesh.process(rgb)
            if not results.multi_face_landmarks:
                return {
                    "detected": False,
                    "reason": "Không phát hiện khuôn mặt",
                    "pitch": 0.0, "yaw": 0.0, "roll": 0.0,
                    "gaze_ratio": 0.5,
                    "status": "KHONG_THAY_MAT",
                    "is_suspicious": True,
                    "alert_text": "CANH BAO: KHONG PHAT HIEN THI SINH!"
                }
            landmarks = results.multi_face_landmarks[0].landmark

        # 1. Tính tư thế đầu (Head Pose)
        pitch, yaw, roll, nose_pt, axes_pts = self.estimate_head_pose(landmarks, w, h)

        # 2. Tính hướng nhìn con ngươi (Eye Gaze)
        gaze_ratio, iris_pts = self.compute_gaze_ratio(landmarks, w, h)

        # 3. Kết hợp suy luận hành vi (Behavioral Fusion)
        status = "BINH_THUONG"
        alert_text = "BINH THUONG (Tap trung vao man hinh)"
        is_suspicious = False

        if yaw < YAW_THRESHOLD_LEFT:
            status = "QUAY_SANG_TRAI"
            alert_text = "CANH BAO: QUAY MAT SANG TRAI"
            is_suspicious = True
        elif yaw > YAW_THRESHOLD_RIGHT:
            status = "QUAY_SANG_PHAI"
            alert_text = "CANH BAO: QUAY MAT SANG PHAI"
            is_suspicious = True
        elif pitch < PITCH_THRESHOLD_DOWN:
            status = "CUI_XUONG_BAN"
            alert_text = "CANH BAO: CUI DAU XUONG BAN / TAI LIEU"
            is_suspicious = True
        elif pitch > PITCH_THRESHOLD_UP:
            status = "NGUA_LEN_TREN"
            alert_text = "CANH BAO: NHIN LEN TRAN NHA"
            is_suspicious = True
        elif gaze_ratio > GAZE_RATIO_LEFT:
            status = "LIEC_SANG_TRAI"
            alert_text = "CANH BAO: LIEC MAT SANG TRAI"
            is_suspicious = True
        elif gaze_ratio < GAZE_RATIO_RIGHT:
            status = "LIEC_SANG_PHAI"
            alert_text = "CANH BAO: LIEC MAT SANG PHAI"
            is_suspicious = True

        return {
            "detected": True,
            "pitch": pitch,
            "yaw": yaw,
            "roll": roll,
            "gaze_ratio": gaze_ratio,
            "status": status,
            "is_suspicious": is_suspicious,
            "alert_text": alert_text,
            "nose_pt": nose_pt,
            "axes_pts": axes_pts,
            "iris_pts": iris_pts
        }


# =============================================================================
# HÀM VẼ GIAO DIỆN HUD ĐỒ HỌA TRỰC QUAN
# =============================================================================
def draw_visual_feedback(frame, result, fps, violation_duration):
    h, w, _ = frame.shape

    # 1. Vẽ trục tọa độ 3D trên mũi (nếu nhận diện thành công)
    if result.get("detected") and result.get("nose_pt") is not None and result.get("axes_pts") is not None:
        p1 = result["nose_pt"]
        axes = result["axes_pts"]
        try:
            # Trục Z (Màu xanh dương - Hướng nhìn thẳng ra)
            p_z = (int(axes[0][0][0]), int(axes[0][0][1]))
            cv2.line(frame, p1, p_z, (255, 0, 0), 3)

            # Trục Y (Màu xanh lá - Hướng xuống)
            p_y = (int(axes[1][0][0]), int(axes[1][0][1]))
            cv2.line(frame, p1, p_y, (0, 255, 0), 2)

            # Trục X (Màu đỏ - Hướng sang phải)
            p_x = (int(axes[2][0][0]), int(axes[2][0][1]))
            cv2.line(frame, p1, p_x, (0, 0, 255), 2)
        except Exception:
            pass

    # 2. Vẽ vị trí tròng mắt (Iris Center)
    if result.get("detected") and "iris_pts" in result:
        l_iris, r_iris = result["iris_pts"]
        cv2.circle(frame, tuple(l_iris), 4, (0, 255, 255), -1)
        cv2.circle(frame, tuple(r_iris), 4, (0, 255, 255), -1)

    # 3. Viền cảnh báo toàn màn hình (ĐỎ nếu vi phạm liên tục)
    is_alarming = violation_duration >= ALERT_DURATION_SECONDS
    if is_alarming:
        cv2.rectangle(frame, (0, 0), (w, h), (0, 0, 240), 10)
    elif result.get("is_suspicious"):
        cv2.rectangle(frame, (0, 0), (w, h), (0, 165, 255), 4)

    # 4. Thanh Header trên cùng
    header_color = (0, 0, 200) if is_alarming else ((20, 20, 20) if not result.get("is_suspicious") else (0, 120, 220))
    cv2.rectangle(frame, (0, 0), (w, 55), header_color, -1)

    status_str = result.get("alert_text", "DANG KHOI TAO...")
    cv2.putText(frame, status_str, (20, 38), cv2.FONT_HERSHEY_DUPLEX, 0.85, (255, 255, 255), 2, cv2.LINE_AA)
    cv2.putText(frame, f"FPS: {int(fps)}", (w - 130, 38), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (200, 255, 200), 2)

    # 5. Bảng thông số chi tiết HUD (Góc trên bên trái)
    hud_overlay = frame.copy()
    cv2.rectangle(hud_overlay, (15, 70), (380, 230), (15, 15, 15), -1)
    cv2.addWeighted(hud_overlay, 0.75, frame, 0.25, 0, frame)

    pitch = result.get("pitch", 0.0)
    yaw = result.get("yaw", 0.0)
    roll = result.get("roll", 0.0)
    gaze_ratio = result.get("gaze_ratio", 0.5)

    info_lines = [
        f"Goc Gat (Pitch - Len/Xuong) : {pitch:+.1f} deg",
        f"Goc Lac (Yaw - Trai/Phai)   : {yaw:+.1f} deg",
        f"Goc Nghieng (Roll)          : {roll:+.1f} deg",
        f"Ty le trong mat (Gaze Ratio): {gaze_ratio:.2f}",
        f"Thoi gian lech man hinh     : {violation_duration:.1f}s / {ALERT_DURATION_SECONDS:.1f}s",
    ]

    for i, line in enumerate(info_lines):
        color = (255, 255, 255)
        if "Thoi gian" in line and is_alarming:
            color = (0, 0, 255)
        elif "Thoi gian" in line and violation_duration > 0:
            color = (0, 200, 255)
        cv2.putText(frame, line, (25, 95 + i * 26), cv2.FONT_HERSHEY_SIMPLEX, 0.52, color, 1, cv2.LINE_AA)

    # 6. Thanh Footer dưới cùng (Hướng dẫn phím tắt)
    cv2.rectangle(frame, (0, h - 35), (w, h), (20, 20, 20), -1)
    cv2.putText(frame, "DUT Computer Vision - Gaze Tracking | Phim: 'Q': Thoat | 'S': Chup anh | 'R': Reset timer",
                (20, h - 11), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (180, 180, 180), 1, cv2.LINE_AA)

    return frame


# =============================================================================
# CHƯƠNG TRÌNH CHÍNH (VÒNG LẶP WEBCAM THỜI GIAN THỰC)
# =============================================================================
def main():
    print("=" * 65)
    print("🎥 HỆ THỐNG PHÁT HIỆN HƯỚNG NHÌN & TƯ THẾ ĐẦU (GAZE TRACKING)")
    print("   Trường Đại học Bách Khoa - ĐH Đà Nẵng (DUT)")
    print("=" * 65)

    tracker = GazeAndHeadTracker()

    cap = cv2.VideoCapture(CAMERA_INDEX)
    if not cap.isOpened():
        print(f"❌ KHÔNG THỂ MỞ WEBCAM (Index={CAMERA_INDEX})!")
        print("Vui lòng kiểm tra lại quyền camera hoặc cổng kết nối.")
        return

    cap.set(cv2.CAP_PROP_FRAME_WIDTH, FRAME_WIDTH)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, FRAME_HEIGHT)

    win_name = "DUT Proctoring - Gaze & Head Pose Tracking"
    cv2.namedWindow(win_name, cv2.WINDOW_NORMAL)

    prev_time = time.time()
    fps = 0.0
    violation_start_time = None
    violation_duration = 0.0

    print("\n👉 ĐANG CHẠY WEBCAM...")
    print("👉 Nhấn 'Q' để dừng chương trình.")
    print("👉 Nhấn 'S' để chụp ảnh vi phạm lưu vào 'screenshots_gaze/'.\n")

    while True:
        ret, frame = cap.read()
        if not ret:
            print("⚠️ Không nhận được tín hiệu frame từ webcam.")
            break

        # Lật ảnh gương (Mirror)
        frame = cv2.flip(frame, 1)

        # Đo FPS mượt mà
        now = time.time()
        dt = now - prev_time
        prev_time = now
        if dt > 0:
            fps = 0.85 * fps + 0.15 * (1.0 / dt)

        # Phân tích hướng nhìn & tư thế đầu
        analysis = tracker.analyze_frame(frame)

        # Tính toán thời gian vi phạm liên tục
        if analysis.get("is_suspicious"):
            if violation_start_time is None:
                violation_start_time = now
            violation_duration = now - violation_start_time
        else:
            violation_start_time = None
            violation_duration = 0.0

        # Tự động chụp lưu chứng cứ khi vi phạm vượt ngưỡng cảnh báo (chỉ chụp 1 lần/lần vi phạm)
        if violation_duration >= ALERT_DURATION_SECONDS and int(violation_duration * 10) % 20 == 0:
            ts = datetime.now().strftime("%Y%m%d_%H%M%S")
            evidence_path = os.path.join(SCREENSHOT_DIR, f"alert_{analysis['status']}_{ts}.jpg")
            cv2.imwrite(evidence_path, frame)

        # Vẽ giao diện trực quan
        display_frame = draw_visual_feedback(frame, analysis, fps, violation_duration)
        cv2.imshow(win_name, display_frame)

        # Phím tắt
        key = cv2.waitKey(1) & 0xFF
        if key in (ord('q'), ord('Q'), 27):
            break
        elif key in (ord('s'), ord('S')):
            ts = datetime.now().strftime("%Y%m%d_%H%M%S")
            manual_path = os.path.join(SCREENSHOT_DIR, f"manual_{ts}.jpg")
            cv2.imwrite(manual_path, display_frame)
            print(f"📸 Đã lưu ảnh chụp tại: {manual_path}")
        elif key in (ord('r'), ord('R')):
            violation_start_time = None
            violation_duration = 0.0
            print("🔄 Đã đặt lại bộ đếm vi phạm.")

    cap.release()
    cv2.destroyAllWindows()
    print("🛑 Đã tắt webcam và đóng ứng dụng thành công.")


if __name__ == "__main__":
    main()
