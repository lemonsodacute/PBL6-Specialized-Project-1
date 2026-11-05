import argparse
import os
from pathlib import Path
import secrets
from .protocol import KEY_FILE

def main():
    parser = argparse.ArgumentParser()
    action = parser.add_mutually_exclusive_group()
    action.add_argument('--init-key', action='store_true')
    action.add_argument('--calibrate', type=Path, metavar='IMAGE')
    args = parser.parse_args()
    if args.init_key:
        KEY_FILE.parent.mkdir(exist_ok=True)
        try:
            with KEY_FILE.open('x', encoding='ascii') as handle:
                handle.write(secrets.token_hex(32))
        except FileExistsError:
            if len(KEY_FILE.read_text(encoding='ascii').strip()) < 32:
                raise RuntimeError('Invalid existing local key')
    elif args.calibrate:
        if os.environ.get('PROCTOR_WORKER_ENV') != 'development':
            parser.error('Calibration requires PROCTOR_WORKER_ENV=development')
        from .gaze_detector import GazeAndHeadTracker
        import cv2
        frame = cv2.imread(str(args.calibrate))
        if frame is None:
            parser.error('Image could not be decoded')
        tracker = GazeAndHeadTracker()
        try:
            print(tracker.analyze_frame(frame).model_dump_json())
        finally:
            tracker.close()
    else:
        import uvicorn
        uvicorn.run('proctor_worker.main:app', host='127.0.0.1', port=8765, workers=1,
                    proxy_headers=False, access_log=False)

if __name__ == '__main__':
    main()
