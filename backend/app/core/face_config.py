"""Current face template contract; bump versions when model/preprocessing changes."""
from dataclasses import dataclass

SFACE_MODEL_NAME = 'sface'
SFACE_MODEL_VERSION = '2021dec'
FACE_PREPROCESSING_VERSION = 'yunet-sface-v1'
EMBEDDING_DIM = 128
FACE_EMBEDDING_DTYPE = '<f4'  # Canonical IEEE-754 float32, little-endian.
FACE_EMBEDDING_NORM_TOLERANCE = 1e-5


@dataclass(frozen=True)
class FaceQualityConfig:
    min_face_size: float
    min_brightness: float
    min_blur: float
    detection_scale: int = 1
    min_face_size_floor: float = 0
    min_width_ratio: float = 0
    min_height_ratio: float = 0


LIVE_MIN_FACE_SIZE = 80
CARD_MIN_FACE_SIZE = 36  # Pixels in the original, EXIF-oriented image.
LIVE_FACE_QUALITY = FaceQualityConfig(LIVE_MIN_FACE_SIZE, 35, 15)
# The supplied 720x454 card scores 13.42 after 2x detection/alignment.
# Printed portraits need a separate blur gate; flat/dark crops still fail.
# Ratios permit 32-36px portraits only when they occupy enough of the card.
CARD_FACE_QUALITY = FaceQualityConfig(
    CARD_MIN_FACE_SIZE, 30, 8, detection_scale=2,
    min_face_size_floor=32, min_width_ratio=0.04, min_height_ratio=0.06,
)
