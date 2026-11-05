"""Initial review policies for the isolated worker. Directions require calibration."""
def local_models():
    def profile(source, title, interval, mapping, duration, gap):
        policies = {kind: dict(minimum_duration_ms=duration, maximum_gap_ms=gap,
                    cooldown_ms=15000, severity='low' if kind in ('face_not_detected','object_prohibited') else 'medium')
                    for kind in mapping.values()}
        return dict(enabled=True, source=source, label=title, frame_interval_ms=interval,
                    label_map=mapping, policies=policies)

    return {
        'local_yolo': profile('OBJECT', 'Giám sát vật thể', 250,
            {'cell phone':'object_phone', 'book':'object_book', 'smartwatch':'object_prohibited',
             'multiple_people':'person_in_background'}, 450, 900),
        'local_gaze': profile('FACE', 'Theo dõi hiện diện', 100,
            {'KHONG_THAY_MAT':'face_not_detected'}, 2000, 600),
    }
