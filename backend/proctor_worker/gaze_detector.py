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


def eye_from_blendshapes(scores):
    """Convert MediaPipe eyeLook* scores into horizontal/vertical gaze and blink.

    Positive horizontal means right of the displayed camera image; positive
    vertical means up. These are *relative measurements*, not cheating scores.
    """
    value = lambda name: float(scores.get(name, 0.0))
    horizontal = ((value('eyeLookOutLeft') + value('eyeLookInRight'))
                  - (value('eyeLookInLeft') + value('eyeLookOutRight'))) / 2
    vertical = ((value('eyeLookUpLeft') + value('eyeLookUpRight'))
                - (value('eyeLookDownLeft') + value('eyeLookDownRight'))) / 2
    blink = (value('eyeBlinkLeft') + value('eyeBlinkRight')) / 2 > .5
    return horizontal, vertical, blink


class GazeAndHeadTracker:
    def __init__(self):
        options = FaceLandmarkerOptions(base_options=BaseOptions(
            model_asset_path=str(MODELS / 'face_landmarker.task')), num_faces=1,
            output_face_blendshapes=True, output_facial_transformation_matrixes=True)
        self.mesh = FaceLandmarker.create_from_options(options)

    def close(self):
        self.mesh.close()

    def analyze_frame(self, bgr):
        h, w = bgr.shape[:2]
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        result = self.mesh.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb))
        if not result.face_landmarks:
            return Gaze(status='OK', face_detected=False, raw_status='KHONG_THAY_MAT')
        if not result.facial_transformation_matrixes:
            return Gaze(status='UNAVAILABLE')
        yaw, pitch, roll = head_pose(result.facial_transformation_matrixes[0])
        # Keep the legacy iris ratio for diagnostics/older callers, but do not
        # use it as the sole direction detector. Its absolute thresholds vary
        # substantially with camera position and eye geometry.
        ratio = None
        xy = np.array([(p.x*w, p.y*h) for p in result.face_landmarks[0]])
        if len(xy) > 473:
            ratios = []
            for start, end, iris in ((33, 133, 468), (362, 263, 473)):
                width = np.linalg.norm(xy[end] - xy[start])
                if width >= 1:
                    ratios.append(np.linalg.norm(xy[iris] - xy[start]) / width)
            if len(ratios) == 2:
                ratio = float(np.mean(ratios))
        if not result.face_blendshapes:
            if ratio is None:
                return Gaze(status='UNAVAILABLE')
            return Gaze(status='OK', face_detected=True, yaw=yaw, pitch=pitch, roll=roll,
                        gaze_ratio=ratio, raw_status=reference_state(yaw, pitch, ratio))
        scores = {category.category_name: category.score for category in result.face_blendshapes[0]}
        eye_h, eye_v, blink = eye_from_blendshapes(scores)
        return Gaze(status='OK', face_detected=True, yaw=yaw, pitch=pitch, roll=roll,
                    gaze_ratio=ratio, eye_h=eye_h, eye_v=eye_v, blink=blink,
                    raw_status=reference_state(yaw, pitch, ratio) if ratio is not None else 'BINH_THUONG')
