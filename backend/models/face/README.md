# Local face models

Run `python scripts/setup_face_models.py` from `backend/` to download YuNet (2023mar) and SFace (2021dec). The downloader validates each file against the SHA-256 in the upstream Git LFS pointer and saves each model's license alongside it.

Sources: [OpenCV Zoo](https://github.com/opencv/opencv_zoo), [OpenCV face recognition tutorial](https://docs.opencv.org/4.12.0/d0/dd4/tutorial_dnn_face.html).

Models are loaded once per backend worker. Images and inference remain on the backend machine. Missing dependencies/models produce a 503 error; they never produce a successful verification.
