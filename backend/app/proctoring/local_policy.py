"""Review-only severity policy for actual isolated-worker observations.

The worker returns detections and gaze states, NOT a severity label.
These are provisional PBL6 demonstration thresholds, not clinically or
empirically calibrated cheating assessments. A HIGH event requires human review
and does not change exam grades or automatically terminate an attempt.
"""


def _policy(*, duration, gap, severity, confidence=None, elevated_at=None, elevated=None):
    policy = dict(minimum_duration_ms=duration, maximum_gap_ms=gap,
                  cooldown_ms=15000, severity=severity)
    if confidence is not None:
        policy['confidence_threshold'] = confidence
    if elevated_at is not None:
        policy.update(elevated_confidence_threshold=elevated_at, elevated_severity=elevated)
    return policy


def local_models():
    # The worker already applies YOLO confidence >= 0.25. Keep weaker detections
    # visible for teacher review as MEDIUM, but do not mark them HIGH.
    object_policies = {
        'object_phone': _policy(duration=450, gap=900, severity='medium',
                                confidence=.25, elevated_at=.60, elevated='high'),
        'object_book': _policy(duration=450, gap=900, severity='medium',
                               confidence=.25, elevated_at=.60, elevated='high'),
        'object_prohibited': _policy(duration=450, gap=900, severity='medium',
                                     confidence=.25, elevated_at=.70, elevated='high'),
        # The headphone class has lower measured AP; require stronger evidence.
        'object_headphone': _policy(duration=900, gap=900, severity='medium',
                                    confidence=.25, elevated_at=.80, elevated='high'),
        # The worker labels this only after detecting at least TWO people.
        'person_in_background': _policy(duration=600, gap=900, severity='medium',
                                        confidence=.25, elevated_at=.70, elevated='high'),
    }
    gaze_policies = {
        'face_not_detected': _policy(duration=2000, gap=600, severity='low'),
        # Match the third-training demo: 2 continuous seconds before HIGH.
        # Gaze angles require local validation; these are review signals only.
        'gaze_away': _policy(duration=2000, gap=600, severity='high'),
        'head_turned': _policy(duration=2000, gap=600, severity='high'),
    }
    return {
        'local_yolo': dict(enabled=True, source='OBJECT', label='Giám sát vật thể',
            frame_interval_ms=250,
            label_map={
                'cell phone': 'object_phone', 'book': 'object_book',
                'smartwatch': 'object_prohibited', 'headphone': 'object_headphone',
                'multiple_people': 'person_in_background',
            }, policies=object_policies),
        'local_gaze': dict(enabled=True, source='FACE', label='Theo dõi hiện diện và hướng nhìn',
            frame_interval_ms=100,
            label_map={
                'KHONG_THAY_MAT': 'face_not_detected',
                'LIEC_SANG_TRAI': 'gaze_away', 'LIEC_SANG_PHAI': 'gaze_away',
                'QUAY_SANG_TRAI': 'head_turned', 'QUAY_SANG_PHAI': 'head_turned',
                'CUI_XUONG_BAN': 'head_turned', 'NGUA_LEN_TREN': 'head_turned',
            }, policies=gaze_policies),
    }
