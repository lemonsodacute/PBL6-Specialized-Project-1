"""One model per child. Framed stdin carries JPEG/PNG bytes, stdout carries bounded JSON lines."""
import json
import os
from pathlib import Path
import struct
import sys

def serve():
    # Libraries may log to stdout (including native code). Reserve an independent protocol fd.
    wire = os.fdopen(os.dup(sys.stdout.fileno()), 'w', encoding='utf-8', buffering=1)
    os.dup2(sys.stderr.fileno(), sys.stdout.fileno())
    os.environ['YOLO_OFFLINE'] = 'true'
    import cv2
    import numpy as np
    from ultralytics import YOLO
    weights = Path(__file__).resolve().parents[2] / 'models/proctoring/multitier/yolo26_results/yolo26n_7cls/weights/best.pt'
    if not weights.is_file():
        raise FileNotFoundError(weights.name)
    model = YOLO(str(weights), task='detect')
    names = list(model.names.values())
    if names != ['person', 'book', 'cell phone', 'laptop', 'tv', 'headphone', 'smartwatch']:
        raise ValueError('Unexpected checkpoint classes')
    model.predict(np.zeros((640, 640, 3), dtype=np.uint8), imgsz=640, device='cpu', verbose=False, save=False)
    print('{"ready":true}', file=wire)
    stream = sys.stdin.buffer
    while header := stream.read(4):
        size, = struct.unpack('!I', header)
        if not 0 < size <= 1048576:
            raise ValueError('Invalid frame size')
        data = stream.read(size)
        if len(data) != size:
            break
        try:
            frame = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
            if frame is None:
                raise ValueError('Invalid image')
            boxes = model.predict(frame, imgsz=640, conf=.25, iou=.45, device='cpu',
                                  max_det=100, verbose=False, save=False)[0].boxes
            detections = [dict(class_id=int(i), class_name=names[int(i)], confidence=float(c), bbox=b)
                          for i, c, b in zip(boxes.cls.tolist(), boxes.conf.tolist(), boxes.xyxyn.tolist())]
            reply = dict(status='OK', detections=detections)
        except Exception:
            reply = dict(status='UNAVAILABLE', detections=[])
        print(json.dumps(reply, allow_nan=False), file=wire)

if __name__ == '__main__':
    serve()
