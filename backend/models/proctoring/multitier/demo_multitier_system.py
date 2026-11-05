"""
=============================================================================
demo_multitier_system.py — Hệ thống giám sát thi trực tuyến Đa tầng (Multi-tier)
Kết hợp: YOLO26n Phát hiện vật thể cấm + MediaPipe Theo dõi hướng nhìn & tư thế đầu
Thư mục: lich su train lan 3
Trường Đại học Bách Khoa - Đại học Đà Nẵng (DUT)
=============================================================================

Cấu trúc Đa tầng (Two-Tier Architecture):
  - TẦNG 1 (Physical Evidence): YOLO26n (7 classes)
      + Phát hiện: phone, book, laptop, headphone, smartwatch, tv, person
      + Khoanh vùng Bounding Box minh chứng rõ ràng
  - TẦNG 2 (Behavioral Gaze & Head Pose): MediaPipe Face Mesh + solvePnP
      + Ước lượng Pitch, Yaw, Roll và Iris Gaze Ratio
      + Cảnh báo quay đầu, liếc tài liệu hoặc cúi nhìn dưới bàn
  - TỔNG HỢP NGUY CƠ (Risk Assessment Engine):
      + MỨC ĐỘ NGUY HIỂM CAO (ĐỎ): Phát hiện điện thoại/sách/tai nghe HOẶC nhìn lệch > 2.0s
      + MỨC ĐỘ CHÚ Ý (VÀNG): Hướng nhìn lệch nhẹ
      + AN TOÀN (XANH): Bình thường, không có vật thể cấm

Cách chạy:
  python demo_multitier_system.py

Phím tắt:
  Q / ESC : Thoát chương trình
  S       : Chụp lưu biên bản vi phạm vào 'screenshots/'
  + / -   : Tăng / giảm ngưỡng tin cậy YOLO (+-5%)
  SPACE   : Tạm dừng / tiếp tục luồng video
=============================================================================
"""

import os
import sys
import time
from datetime import datetime
import cv2
import numpy as np

# Nạp module Gaze Tracker từ file cùng thư mục
try:
    from gaze_tracking import GazeAndHeadTracker, ALERT_DURATION_SECONDS
except ImportError:
    # Nếu chạy từ thư mục cha
    sys.path.append(os.path.dirname(os.path.abspath(__file__)))
    from gaze_tracking import GazeAndHeadTracker, ALERT_DURATION_SECONDS

# Kiểm tra thư viện YOLO Ultralytics
try:
    from ultralytics import YOLO
    HAS_YOLO = True
except ImportError:
    HAS_YOLO = False
    print("⚠️ Chưa cài đặt ultralytics: pip install ultralytics")

# =============================================================================
# CẤU HÌNH HỆ THỐNG
# =============================================================================
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
WEIGHTS_PATH = os.path.join(SCRIPT_DIR, "yolo26_results", "yolo26n_7cls", "weights", "best.pt")

CAMERA_INDEX = 0
IMGSZ = 640
CONF_THRESHOLD = 0.25
IOU_THRESHOLD = 0.45

# Danh sách vật phẩm cấm nghiêm ngặt (kích hoạt báo động đỏ ngay khi thấy)
PROHIBITED_CLASSES = {"cell phone", "book", "headphone", "smartwatch"}

# Bảng màu đại diện 7 class (BGR)
CLASS_COLORS = {
    "person":     (235, 120, 42),    # Xanh dương
    "book":       (52, 104, 235),    # Đỏ cam (CẤM)
    "cell phone": (0, 0, 230),       # Đỏ sẫm (CẤM)
    "laptop":     (0, 161, 237),     # Vàng cam
    "tv":         (164, 123, 232),   # Tím hồng
    "headphone":  (0, 131, 0),       # Xanh lục đậm (CẤM)
    "smartwatch": (214, 80, 98),     # Tím lam (CẤM)
}
DEFAULT_COLOR = (0, 255, 0)

SCREENSHOT_DIR = os.path.join(os.path.dirname(SCRIPT_DIR), "screenshots")
os.makedirs(SCREENSHOT_DIR, exist_ok=True)


def draw_yolo_boxes(frame, yolo_results, conf_thresh):
    """Vẽ bounding box của các vật thể phát hiện được."""
    detected_prohibited = []
    total_objects = 0

    if not yolo_results:
        return frame, detected_prohibited, total_objects

    for r in yolo_results:
        boxes = r.boxes
        if boxes is None or len(boxes) == 0:
            continue
        for box in boxes:
            conf = float(box.conf[0])
            if conf < conf_thresh:
                continue

            total_objects += 1
            cls_id = int(box.cls[0])
            cls_name = r.names.get(cls_id, str(cls_id)).lower()

            is_prohibited = cls_name in PROHIBITED_CLASSES
            if is_prohibited:
                detected_prohibited.append((cls_name, conf))

            color = CLASS_COLORS.get(cls_name, DEFAULT_COLOR)
            line_thickness = 3 if is_prohibited else 2

            x1, y1, x2, y2 = map(int, box.xyxy[0].tolist())
            cv2.rectangle(frame, (x1, y1), (x2, y2), color, line_thickness)

            # Nhãn hiển thị
            tag_text = f"CẤM: {cls_name} {conf:.0%}" if is_prohibited else f"{cls_name} {conf:.0%}"
            (tw, th), _ = cv2.getTextSize(tag_text, cv2.FONT_HERSHEY_SIMPLEX, 0.55, 1)
            cv2.rectangle(frame, (x1, max(0, y1 - th - 8)), (x1 + tw + 6, y1), color, -1)
            cv2.putText(frame, tag_text, (x1 + 3, max(th, y1 - 4)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 1, cv2.LINE_AA)

    return frame, detected_prohibited, total_objects


def draw_multitier_hud(frame, yolo_prohibited, gaze_result, fps, conf_thresh, violation_sec):
    """Vẽ bảng HUD tổng hợp trạng thái đa tầng của hệ sinh thái giám sát."""
    h, w, _ = frame.shape

    # Xác định mức độ rủi ro (Risk Level)
    has_prohibited_obj = len(yolo_prohibited) > 0
    gaze_alarming = violation_sec >= ALERT_DURATION_SECONDS
    gaze_suspicious = gaze_result.get("is_suspicious", False)

    if has_prohibited_obj or gaze_alarming:
        risk_level = "MUC DO: NGUY HIEM CAO (VI PHAM)"
        border_color = (0, 0, 240) # Đỏ
        top_color = (0, 0, 200)
    elif gaze_suspicious or violation_sec > 0:
        risk_level = "MUC DO: CHU Y (CANH BAO)"
        border_color = (0, 165, 255) # Vàng cam
        top_color = (0, 130, 220)
    else:
        risk_level = "MUC DO: AN TOAN (BINH THUONG)"
        border_color = (0, 180, 0) # Xanh lá
        top_color = (15, 15, 15)

    # 1. Viền cảnh báo
    if has_prohibited_obj or gaze_alarming:
        cv2.rectangle(frame, (0, 0), (w, h), border_color, 8)

    # 2. Thanh Header trên cùng
    cv2.rectangle(frame, (0, 0), (w, 55), top_color, -1)
    header_title = f"DUT PROCTORING — {risk_level}"
    cv2.putText(frame, header_title, (20, 37), cv2.FONT_HERSHEY_DUPLEX, 0.8, (255, 255, 255), 2, cv2.LINE_AA)
    cv2.putText(frame, f"FPS: {int(fps)}", (w - 120, 37), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (200, 255, 200), 2)

    # 3. Bảng HUD hiển thị trạng thái 2 tầng (Góc trên bên trái)
    hud_bg = frame.copy()
    cv2.rectangle(hud_bg, (15, 65), (420, 260), (15, 15, 15), -1)
    cv2.addWeighted(hud_bg, 0.75, frame, 0.25, 0, frame)

    # Tầng 1: Vật thể
    if has_prohibited_obj:
        obj_names = ", ".join([f"{name} ({c:.0%})" for name, c in yolo_prohibited])
        t1_str = f"TANG 1 (Vat the): PHAT HIEN CUC BI CAM -> {obj_names}"
        t1_color = (0, 0, 255)
    else:
        t1_str = "TANG 1 (Vat the): Khong phat hien vat the cam"
        t1_color = (0, 255, 100)

    # Tầng 2: Hướng nhìn
    gaze_status = gaze_result.get("alert_text", "Binh thuong")
    t2_color = (0, 0, 255) if gaze_alarming else ((0, 180, 255) if gaze_suspicious else (0, 255, 100))

    lines = [
        ("=== HE THONG GIAM SAT THI DA TANG ===", (255, 200, 0)),
        (t1_str, t1_color),
        (f"TANG 2 (Huong nhin): {gaze_status}", t2_color),
        (f"Goc dau: Pitch={gaze_result.get('pitch', 0):+.0f} | Yaw={gaze_result.get('yaw', 0):+.0f} | Roll={gaze_result.get('roll', 0):+.0f}", (200, 200, 200)),
        (f"Nguong YOLO: {conf_thresh:.0%} (+/- de chinh)", (180, 180, 180)),
        (f"Thoi gian lech mat: {violation_sec:.1f}s / {ALERT_DURATION_SECONDS:.1f}s", (0, 0, 255) if gaze_alarming else (220, 220, 220)),
    ]

    for i, (text, col) in enumerate(lines):
        cv2.putText(frame, text, (22, 90 + i * 26), cv2.FONT_HERSHEY_SIMPLEX, 0.48, col, 1, cv2.LINE_AA)

    # 4. Thanh Footer
    cv2.rectangle(frame, (0, h - 35), (w, h), (20, 20, 20), -1)
    cv2.putText(frame, "Phim: 'Q': Thoat | 'S': Chup bien ban | 'SPACE': Tam dung | '+/-': Nguong YOLO",
                (20, h - 11), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (180, 180, 180), 1, cv2.LINE_AA)

    return frame


def main():
    print("=" * 70)
    print("🚀 KHỞI ĐỘNG HỆ THỐNG GIÁM SÁT THI TRỰC TUYẾN ĐA TẦNG (TWO-TIER PROCTORING)")
    print("   Trường Đại học Bách Khoa - Đại học Đà Nẵng (DUT)")
    print("=" * 70)

    # 1. Khởi tạo YOLO26n
    yolo_model = None
    if HAS_YOLO:
        if os.path.isfile(WEIGHTS_PATH):
            print(f"📦 Đang nạp trọng số YOLO26n từ: {WEIGHTS_PATH} ...")
            yolo_model = YOLO(WEIGHTS_PATH)
            print("✅ Đã nạp thành công YOLO26n! Danh sách class:", yolo_model.names)
        else:
            print(f"⚠️ Không tìm thấy file model YOLO tại: {WEIGHTS_PATH}")
            print("Hệ thống sẽ chạy ở chế độ chỉ giám sát hướng nhìn (Gaze Only).")

    # 2. Khởi tạo Gaze Tracker
    tracker = GazeAndHeadTracker()

    # 3. Mở Webcam
    cap = cv2.VideoCapture(CAMERA_INDEX)
    if not cap.isOpened():
        print(f"❌ Không thể kết nối tới webcam (Index={CAMERA_INDEX}).")
        return

    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)

    win_name = "DUT - He Thong Giam Sat Thi Da Tang (YOLO26 + Gaze)"
    cv2.namedWindow(win_name, cv2.WINDOW_NORMAL)

    conf_thresh = CONF_THRESHOLD
    paused = False
    prev_time = time.time()
    fps = 0.0

    violation_start_time = None
    violation_duration = 0.0

    print("\n--- SẴN SÀNG GIÁM SÁT ---")
    print("Nhấn 'Q' để dừng chương trình.\n")

    while True:
        if not paused:
            ret, frame = cap.read()
            if not ret:
                print("Lỗi: Không đọc được frame từ camera.")
                break

            # Lật ảnh gương
            frame = cv2.flip(frame, 1)

            # Tính FPS
            now = time.time()
            dt = now - prev_time
            prev_time = now
            if dt > 0:
                fps = 0.85 * fps + 0.15 * (1.0 / dt)

            # --- TẦNG 1: DỰ ĐOÁN VẬT THỂ BẰNG YOLO26n ---
            yolo_results = None
            if yolo_model:
                yolo_results = yolo_model.predict(
                    frame,
                    imgsz=IMGSZ,
                    conf=max(conf_thresh - 0.05, 0.05),
                    iou=IOU_THRESHOLD,
                    verbose=False
                )

            # --- TẦNG 2: PHÂN TÍCH HƯỚNG NHÌN & TƯ THẾ ĐẦU ---
            gaze_analysis = tracker.analyze_frame(frame)

            # Đo thời gian nhìn lệch liên tục
            if gaze_analysis.get("is_suspicious"):
                if violation_start_time is None:
                    violation_start_time = now
                violation_duration = now - violation_start_time
            else:
                violation_start_time = None
                violation_duration = 0.0

            # Vẽ kết quả Bounding Box vật thể
            frame, prohibited_items, total_objs = draw_yolo_boxes(frame, yolo_results, conf_thresh)

            # Vẽ HUD tổng hợp
            display_frame = draw_multitier_hud(frame, prohibited_items, gaze_analysis, fps, conf_thresh, violation_duration)

            # Tự động lưu bằng chứng nếu phát hiện gian lận nghiêm trọng
            if len(prohibited_items) > 0 or violation_duration >= ALERT_DURATION_SECONDS:
                if int(violation_duration * 10) % 25 == 0 or len(prohibited_items) > 0:
                    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
                    evidence_file = os.path.join(SCREENSHOT_DIR, f"evidence_{ts}.jpg")
                    cv2.imwrite(evidence_file, display_frame)

        cv2.imshow(win_name, display_frame)

        key = cv2.waitKey(1) & 0xFF
        if key in (ord('q'), ord('Q'), 27):
            break
        elif key in (ord('s'), ord('S')):
            ts = datetime.now().strftime("%Y%m%d_%H%M%S")
            manual_file = os.path.join(SCREENSHOT_DIR, f"manual_snap_{ts}.jpg")
            cv2.imwrite(manual_file, display_frame)
            print(f"📸 Đã lưu biên bản giám sát: {manual_file}")
        elif key in (ord('+'), ord('=')):
            conf_thresh = min(conf_thresh + 0.05, 0.95)
            print(f"Ngưỡng confidence YOLO: {conf_thresh:.0%}")
        elif key in (ord('-'), ord('_')):
            conf_thresh = max(conf_thresh - 0.05, 0.05)
            print(f"Ngưỡng confidence YOLO: {conf_thresh:.0%}")
        elif key == 32: # SPACE
            paused = not paused
            print("Tạm dừng stream" if paused else "Tiếp tục stream")

    cap.release()
    cv2.destroyAllWindows()
    print("🛑 Đã tắt hệ thống giám sát đa tầng.")


if __name__ == "__main__":
    main()
