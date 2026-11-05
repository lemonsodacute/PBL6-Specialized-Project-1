"""Single-image, stateless adaptation of the supplied GazeAndHeadTracker."""
import math
import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks.python import BaseOptions
from mediapipe.tasks.python.vision import FaceLandmarker, FaceLandmarkerOptions
from .protocol import Gaze, MODELS, reference_state

def head_pose(transform):
    # MediaPipe maps its canonical face to the metric camera, both y-up/z-out.
    # Convert both bases to x-right/y-down/z-in, so a frontal rotation is identity.
    basis = np.diag([1., -1., -1.])
    rotation = basis @ np.asarray(transform)[:3, :3] @ basis
    u, _, vt = np.linalg.svd(rotation)
    r = u @ vt  # Remove scale before extracting Euler angles.
    if np.linalg.det(r) <= 0:
        raise ValueError('Invalid face rotation')
    # Rz(roll) Ry(yaw) Rx(tilt). Negate tilt for positive pitch looking up.
    yaw = math.atan2(-r[2, 0], math.hypot(r[0, 0], r[1, 0]))
    pitch = -math.atan2(r[2, 1], r[2, 2])
    roll = math.atan2(r[1, 0], r[0, 0])
    return tuple(map(math.degrees, (yaw, pitch, roll)))


class GazeAndHeadTracker:
    def __init__(self):
        options = FaceLandmarkerOptions(base_options=BaseOptions(
            model_asset_path=str(MODELS / 'face_landmarker.task')), num_faces=1, output_facial_transformation_matrixes=True)
        self.mesh = FaceLandmarker.create_from_options(options)

    def close(self):
        self.mesh.close()

    def analyze_frame(self, bgr):
        h, w = bgr.shape[:2]
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        result = self.mesh.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb))
        if not result.face_landmarks:
            return Gaze(status='OK', face_detected=False, raw_status='KHONG_THAY_MAT')
        xy = np.array([(p.x*w, p.y*h) for p in result.face_landmarks[0]])
        yaw, pitch, roll = head_pose(result.facial_transformation_matrixes[0])
        ratios = []
        for start, end, iris in ((33, 133, 468), (362, 263, 473)):
            width = np.linalg.norm(xy[end] - xy[start])
            if width < 1:
                raise ValueError('Iris measurement unavailable')
            ratios.append(np.linalg.norm(xy[iris] - xy[start]) / width)
        ratio = float(np.mean(ratios))
        return Gaze(status='OK', face_detected=True, yaw=yaw, pitch=pitch, roll=roll,
                    gaze_ratio=ratio, raw_status=reference_state(yaw, pitch, ratio))
