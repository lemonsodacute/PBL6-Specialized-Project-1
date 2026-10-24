# Local face verification dataset

**Awaiting labeled real-world dataset.** The local `face_verification/` directory
has been created but contains no participant images yet.
Images, embeddings, manifests with paths and experiment outputs must stay local.
Do not upload them to third-party services or commit them to Git.

Use opaque identity folders, with exactly one trusted reference and at least 3 webcam
images per person. The reference must come from an approved student-ID/profile
source; a self-selected avatar is not automatically trusted.

```text
data/face_verification/
  person_001/
    reference/
      reference.jpg
    webcam/
      front_01.jpg
      front_02.jpg
      left.jpg
      right.jpg
      low_light.jpg
  person_002/
    reference/
      reference.jpg
    webcam/
      front_01.jpg
      ...
  metadata.json
```

These filenames are examples; no images are supplied. Keep only the two domain
directories under each identity and only image files within them. Choose one
reference in advance; do not choose the best reference by looking at test scores.
The current protocol does not aggregate multiple references.

Minimum prototype: **10 identities**. Recommended PBL benchmark: **20–30**.
Better coverage: **50+**. Target **1 reference + 5 webcam probes per identity**;
at least 3 valid webcam images are required for a complete collection.
These targets do not establish statistical reliability or a low FAR guarantee.
Use actual
laptop/webcam devices and varied sessions: frontal/good lighting, mild dim light,
mild left/right pose, and glasses if normally worn. Avoid adjacent video frames
as substitutes for independent sessions. Preserve originals; validator never
writes crops or changes source images. JPEG/PNG/WEBP must satisfy production
size and quality gates. Corrupt/unsupported image files are recorded as rejects.

## Local collection tool

Run from the project root. This Python CLI is separate from the application and
does not change the FastAPI/Next.js identity flow. It uses existing OpenCV
`VideoCapture` and a Tkinter/Pillow window. The installed OpenCV is headless, so
there is no `cv2.imshow` dependency and no need to replace the production wheel.

```powershell
# --consent means the participant has already consented to local project use.
& './backend/.venv/Scripts/python.exe' backend/scripts/collect_face_dataset.py --person person_001 --reference 'D:/images/trusted_reference.jpg' --consent

# Or omit --reference and choose a local path when prompted.
& './backend/.venv/Scripts/python.exe' backend/scripts/collect_face_dataset.py --person person_002

# Import just the reference; this never opens the camera.
& './backend/.venv/Scripts/python.exe' backend/scripts/collect_face_dataset.py --person person_003 --reference 'D:/images/trusted_reference.png' --reference-only --consent

# Resume a person using the existing reference; another camera can be selected.
& './backend/.venv/Scripts/python.exe' backend/scripts/collect_face_dataset.py --person person_001 --camera 1 --consent

# Fallback when Tkinter/display is unavailable.
& './backend/.venv/Scripts/python.exe' backend/scripts/collect_face_dataset.py --person person_001 --no-preview --consent
```

Without `--consent`, the tool asks for `YES` before any collection. Anonymous IDs
are `person_` plus 3–6 ASCII digits with a nonzero value: `person_001`,
`person_002`, etc. Do not encode real student IDs in these numbers.

The reference comes from a trusted/profile/student-card file outside the dataset,
never from this webcam flow. A validated **JPEG copy** is saved as
`reference/reference.jpg`; the original stays untouched. To support PNG/WEBP,
correct EXIF orientation and remove EXIF metadata, the tool re-encodes a copy at
JPEG quality 95 using the production decoder/thumbnail policy (long edge ≤1280).
It then validates the exact JPEG bytes that will be stored. It does not save a
face crop or synthetically change the participant's face.

| Key in preview | Action |
|---|---|
| SPACE | Capture the current frame, validate and freeze it for review |
| S or Enter | Save a valid pending capture, then move to the next missing label |
| R | Discard pending capture and retry; after a save, return to that label |
| 1–5 | Select front_01, front_02, left, right, low_light |
| Q / close window | Quit; discard pending capture, keep all saved images |

The preview shows the exact saved orientation and is not mirrored. Follow the
on-screen prompts: frontal, another frontal view, mildly left, mildly right,
and mildly reduced lighting. These are operator labels, not automated pose or
lighting classification. The same five filenames are used when resuming. To
retake a saved image, capture and save again; replacement requires confirmation
(`YES` in terminal, Yes in the local window). Cancelling preserves the old image.
A second reference under a different filename is refused; nothing is deleted.

In `--no-preview` mode, type SPACE/Enter to capture, `s` to save, `r` to retake,
`1`–`5` to select a label, or `q` to quit, followed by Enter. Camera frames are
continuously read while waiting for terminal input so a capture is current.
If camera access fails, check OS permissions, close other camera applications,
or select another `--camera` index. Camera hardware operation still needs an
operator check on the intended laptop.

Each capture reuses `FaceEngine.extract_embedding()` for decode, exactly-one-face,
size, alignment, dark/blur and finite-model-output gates. Similarity is never used
to decide whether an image is saved. `NO_FACE_DETECTED`,
`MULTIPLE_FACES_DETECTED`, `FACE_TOO_SMALL`, `INVALID_IMAGE` and other production
quality errors are displayed; invalid images stay out of the final dataset.
Model errors stop collection. An embedding is computed transiently because the
shared production pipeline returns it, then discarded; it is never logged/saved.

This quality-filtered collection alone cannot estimate the rejection rate of
all raw capture attempts: rejected attempts are not stored. The later dataset
validator reports failures in the images actually supplied to it. A dark image
rejected by the production gate must not be relabeled as a successful low-light
sample. Quit early is allowed, but fewer than 3 probes is reported **INCOMPLETE**.

## Metadata and collection summary

`metadata.json` is at the **dataset root**, outside all identity/image folders,
so the existing Phase 2 discovery/validator accepts the directory structure.
Each image row has:

```text
person_id, type, capture_label, filename (anonymous relative path),
width, height, face_bbox_size [width, height], captured_at (UTC), sha256
```

Dimensions describe the stored JPEG, and bbox size uses the same image coordinate
space. For references, `captured_at` means import time, not the original photo's
creation time. The detector observer records only dimensions from the existing
YuNet call; there is no second detection implementation. No source filenames,
real names, email, student IDs, raw landmarks or raw vectors are stored in metadata.

The collector serializes writes using `.collection.lock`, exclusively creates
new image files and atomically updates metadata. Handled disk-write failures
restore the prior image. An abrupt process/power failure may leave stale
metadata; the read-only summary detects hash mismatches. Close collectors before
validation/benchmarking. After a crash, remove a leftover `.collection.lock`
only after confirming no collector process is running.

```powershell
# Works with a single/incomplete identity; does not require a train/test split.
& './backend/.venv/Scripts/python.exe' backend/scripts/validate_face_dataset.py --dataset data/face_verification

# Includes counts, quality errors, collection-label coverage and metadata issues.
& './backend/.venv/Scripts/python.exe' backend/scripts/validate_face_dataset.py --dataset data/face_verification --json
```

Summary checks all images through the production engine without changing them.
It counts identities/reference/webcam/valid/rejected images, duplicate bytes,
incomplete identities and stale/missing metadata. Exit 0 means collection is ready
for **preparation**, not that recognition accuracy is proven; exit 2 means empty,
too few identities or collection issues; fatal access/model/metadata errors exit 1.
It requires ≥10 complete identities for `READY_FOR_PREPARATION`, and each must
have exactly one valid reference and at least three valid webcam images.

## Benchmark annotations and frozen splits

One real person must have one folder. Manually inspect labels and near-duplicate
photos before freezing a split. SHA-256 detects byte-identical duplicates, not
all re-encodings/crops or one person placed under different folder names.

An optional local `annotations.json`, passed with `--annotations`, maps relative
paths to categorical metadata. Omitted categories become `unknown`; the scripts
never guess lighting/pose from filenames or similarity. No names, student IDs,
emails or free text are accepted as annotation values.

```json
{
  "person_001/reference/reference.jpg": {
    "reference_quality": "original_portrait",
    "device": "scanner"
  },
  "person_001/webcam/front_01.jpg": {
    "lighting": "good",
    "pose": "front",
    "glasses": "yes",
    "device": "laptop_webcam"
  }
}
```

| Field | Allowed values |
|---|---|
| lighting | unknown, good, dim, backlit |
| pose | unknown, front, mild_left, mild_right, large_pose |
| glasses | unknown, yes, no |
| resolution | unknown, low, normal |
| reference_quality | unknown, original_portrait, printed_card, glare, aged |
| device | unknown, laptop_webcam, usb_webcam, phone, scanner |

Run from the project root using the backend Python environment:

```powershell
# Plotting dependencies are separate from production requirements.
& './backend/.venv/Scripts/python.exe' -m pip install -r backend/requirements-face-experiments.txt

# Default: 60/20/20 train/calibration/test, all splits disjoint by identity.
& './backend/.venv/Scripts/python.exe' backend/scripts/prepare_face_dataset.py --dataset data/face_verification --output artifacts/face_verification/prepared-v1 --ratios 0.6 0.2 0.2 --seed 42

# After collecting real labeled data. 0.01 is an EXPLORATORY example, not an exam requirement.
& './backend/.venv/Scripts/python.exe' backend/scripts/benchmark_face_phase2.py --dataset data/face_verification --manifest artifacts/face_verification/prepared-v1/manifest.json --output artifacts/face_verification/sface-v1 --security-target-far 0.01 --seed 42 --threads 1 --warmup 10 --runs 100
```

For calibration-only work, use `--ratios 0.6 0.4`. Each requested split needs at
least two identities just to form impostor pairs; that minimum is **not** enough
for reliable calibration. Splits are assigned before image quality validation,
so difficult images cannot silently disappear from end-to-end denominators.

Keep `prepared-v1/manifest.json` unchanged. It records opaque IDs, local relative
paths, image hashes, categorical annotations, validation results, identity splits
and model fingerprints. It is private, not an anonymized public artifact. The
benchmark verifies image hashes and model/preprocessing before evaluation.
Keep the same manifest and `pair_protocol.csv` for every candidate comparison.

All output directories must be new and outside the dataset. Default is all-pairs;
for a larger dataset set a deliberate `--max-impostors` cap per split. Sampling is
uniform without replacement over the full impostor population and seeded.
Record any cap before seeing results; genuine pairs are never downsampled.

## Privacy and retention

Collect only with participant consent, solely for project experiments. Keep the
dataset on a local disk outside cloud-synced folders; **do not upload to cloud,
public hosting or third-party APIs**. Do not commit it to Git. Delete images and
local copies/backups when no longer needed under the agreed retention policy.
Anonymous folder names do not make face images non-biometric.

If an identity mapping is truly needed, maintain it separately and locally at
`data/face_verification_private_mapping.csv`. This optional file is explicitly
ignored by Git; the tool does not create it and the benchmark never needs it.
`data/face_verification/` is ignored; `data/README.md` remains trackable. Custom
`--dataset` locations need their own ignore/access controls if inside a repository.
Do not use force-add to bypass ignore rules; ignore patterns do not untrack data
that was already committed.

Reports contain aggregate metrics, plots and opaque failure-pair IDs with
categorical metadata. No raw face images or vectors are exported. Even these
scores and IDs should remain access-controlled locally. Store any identity-to-
folder mapping separately; decide consent, access and retention for the dataset
before collection. No script reads the application database or reuses private
enrollment images as research data.

See [Phase 2 report](../docs/FACE_VERIFICATION_PHASE2.md) for the training gate,
calibration interpretation and statistical limitations.
