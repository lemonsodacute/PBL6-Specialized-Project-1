# ONLINE CLASS RECORDING

Verified locally on 26 October 2026 against the production Next.js build, FastAPI, PostgreSQL, the existing native LiveKit SFU 1.13.9, and LiveKit Egress 1.15.0 in Docker.

Provider: **LiveKit**, using the server-side `StartEgress` API with the standard speaker template and a private H.264/AAC MP4 output.

| Requested check | Result | Evidence |
| --- | --- | --- |
| Server-side recording | PASS | Actual Egress output finalized and decoded in the browser; no browser recorder or generated substitute file |
| Teacher start | PASS | Explicit confirmation; Cancel creates no recording; Student start is denied |
| Teacher stop | PASS | Provider stop, processing, then verified private MP4 readiness |
| Recording indicator | PASS | Teacher, connected Student and late-joining Student; prejoin notice verified |
| Automatic stop on class end | PASS | Separate real Egress test ends the class during recording and waits for READY |
| Processing state | PASS | Separate metadata lifecycle; pending/failed outputs cannot be played or published |
| Teacher preview | PASS | HTML5 video decodes, advances and seeks before publication |
| Publish | PASS | Confirmation, published status, enrolled Student access and notification |
| Unpublish | PASS | Open Student player clears and its previous media ticket is rejected |
| Student playback | PASS | Actual MP4 playback, 1.5x speed and position restored after reload |
| Enrollment authorization | PASS | Outsider receives no player; backend also rechecks enrollment and active-account status |
| Protected media | PASS | Authorized range streaming, short-lived tickets, revocation, missing/changed-file rejection |
| Notifications | PASS | Existing classroom notification is created on publication; no completion-only notification |
| Mobile playback | PASS | Chrome at 390×844, Student shell retained, no horizontal overflow |

Recording default: **OFF**. Runtime capability is enabled in the explicitly configured local environment; each class still requires its Teacher to confirm Start.

Secret exposed to frontend: **NO**. The actual LiveKit API key/secret and JWT signing secret were checked against generated browser JavaScript bundles and were absent. Only short-lived, purpose-bound media tickets reach the player.

Public recording URL: **NO**. Storage is private; the media route validates current authorization even when a ticket is still cryptographically valid.

Face Verification changed: **NO**.

Proctoring system changed by recording: **NO**. Separate user requests remove the Monitoring overview KPI/chart block and repair the exam-specific monitoring report/review flow; see [that report](proctoring-report-fix.md).

## Migration

`0025_class_recordings`, after the existing `0024_classroom_controls`, was applied to the local database. It adds the independent recording table, lifecycle check, provider/output uniqueness, class/time index and one-active-recording constraint. Existing class deletion cascades are retained.

## Files changed for recording

| Area | Files |
| --- | --- |
| Configuration and schema | `backend/.env.example`, `backend/app/core/config.py`, `backend/app/models/entities.py`, `backend/alembic/versions/0025_class_recordings.py`, `backend/requirements.txt` |
| Private media and provider | `backend/app/services/recording_storage.py`, `backend/app/services/recording_provider.py`, `backend/app/services/class_recordings.py` |
| API and lifecycle integration | `backend/app/api/v1/class_recordings.py`, `backend/app/api/v1/router.py`, `backend/app/api/v1/live_classes.py`, `backend/app/services/classroom_lifecycle.py`, `backend/app/services/classroom_controls.py`, `backend/app/main.py` |
| Client transport and API | `lib/class-recordings.ts`, `lib/classroom.ts`, `lib/classroom-livekit.ts`, `lib/api.ts` |
| Recording and review UI | `components/live-class/ClassRecordingControls.tsx`, `components/live-class/ClassRecordingsSection.tsx`, `components/live-class/MeetingRoom.tsx`, `app/live-class/[id]/page.tsx`, `app/live-class/[id]/recordings/[recordingId]/page.tsx`, `app/student/live-classes/page.tsx`, `app/classroom.css` |
| Local runtime | `infra/livekit/recording.compose.yaml`, `backend/scripts/classroom_recording_runtime.py`, `scripts/start-classroom-recording.ps1`, `scripts/start-classroom-sfu.ps1` |
| Tests and documentation | `backend/tests/test_class_recordings.py`, `backend/tests/test_live_classroom.py`, `backend/tests/test_classroom_postgres.py`, `tests/e2e/live-classroom.spec.ts`, `tests/e2e/live-class-shell.spec.ts`, this report and `docs/online-class-recording.md` |
| Separate monitoring request | `components/teacher/MonitorCollection.tsx` |

Some integration files also contain earlier classroom upgrades. This table identifies the recording integration surfaces rather than claiming every existing worktree change belongs to this feature.

## Tests and build

- **54 distinct backend tests passed**: 23 recording cases and 31 existing classroom cases. These cover defaults, host authorization, provider failure, lost start response, idempotent stop, end-of-class ordering, signed webhooks, real-output readiness, publication, ranges, enrollment/account revocation, expiry, physical deletion, audit, multiple segments and bounded processing failures. The 23 recording cases were rerun after the async row-lock fix.
- **1 focused PostgreSQL concurrency regression passed**, using existing fixture accounts in the isolated QA database and two independent connections. A webhook waits for a held recording-row lock while the event loop releases that transaction; the prior synchronous lock acquisition would time out. No application account was created for this check.
- **2 real recording scenarios passed together in the final 2.7-minute run**: full opt-in/review/publication/protected playback/revocation/deletion flow, plus automatic stop and finalization when ending an active class. The full flow used three live meeting participants. On this 8GB host, the final run used `CLASSROOM_RECORDING_LOW_RESOURCE=1`: the Teacher publishes camera/audio and screen share; Students join in listen-only mode, including the late joiner. This flag affects test devices only, with all recording/access/playback assertions retained. An earlier three-publisher recording run also passed. Browser media sources are deterministic; the API, SFU, Egress worker and MP4 decoding are real.
- **All 8 existing real classroom scenarios were verified across regression runs**. The final targeted host-controls scenario passed with a deliberately lost HTTP response after server-side removal, proving the confirmation dialog closes and the Teacher can still end the class. This is not a claim that one uninterrupted eight-case run was entirely green: transient device-track/host-dialog failures and their follow-ups are described below.
- **16 UI tests passed**: 10 shell/admission/ended-state cases and 6 monitoring cases, including 375/768/1440px monitoring layouts, filtering and pagination. Student shell tests include light/dark modes at 390/1024/1440px.
- **TypeScript passed**: `npx tsc --noEmit`.
- **Production build passed**: `npm run build`. The application was then exercised with `next start`. Existing repository lint warnings remain; the build has no blocking compile, lint or type errors.
- PowerShell SFU setup script syntax check passed.

The media run initially exposed a local networking issue: Egress signaling connected, but its peer connection could not reach the native Windows SFU. Preserving internal ICE candidates alongside the LAN mapping fixed it; the setup script now retains that configuration. See [LiveKit's troubleshooting guidance](https://livekit.com/blog/troubleshooting-egress) for the distinction between accepted Egress requests and a started recording.

One initial classroom regression run reported an unfinished synthetic media track after device toggles and a page reload. Its isolated rerun passed twice. A later host-controls run exposed a removal confirmation that remained open when the server applied removal but its HTTP response was lost. `MeetingRoom` now closes that completed action's confirmation in `finally`, leaving the existing global error visible and the Teacher's controls reachable. The targeted real-provider regression passed after deliberately reproducing that lost response. No unrelated media behavior was changed to make the track assertion pass.

A later cold-start recording run also exposed synchronous recording-row lock waits in async webhook/stop/reconciliation code. Under contention with a rejected deletion of a still-processing segment, that wait could prevent request cleanup from releasing its transaction. Those lock waits and recording commits now run off the event loop; the two-connection PostgreSQL regression passed. A stalled provider finalization also has a configurable 30-minute failure bound, with no player/publication for incomplete media.

The final real files measured **26 seconds / 584,938 bytes** and **5 seconds / 140,073 bytes**. Both were finalized by Egress and then removed through the authorized recording API after verification. Remaining recording-test sessions from interrupted runs were ended; the final database check reported zero blocked sessions. Account, attempt and original browser-log fingerprints were still identical, with 20 users.

Local verification artifacts (ignored by Git):

- `artifacts/class-recording/accepted-recording.log`
- `artifacts/class-recording/internal-network.log`
- `artifacts/class-recording/ui.log`
- `artifacts/class-recording/build-release.log`
- `artifacts/class-recording/host-fixed-final.log`
- `artifacts/class-recording/recording-handoff.log`
- `artifacts/class-recording/handoff-screenshots/recording-playback-mobile.png`
- `backend/private/livekit-recording/recording-threaded-unit.log`
- `backend/private/livekit-recording/recording-postgres-lock.log`
- `artifacts/class-recording/teacher-recording-preview.png`
- `artifacts/class-recording/recording-playback-mobile.png`

Test MP4 files are private and deleted through the authorized recording API after verification. Screenshots show deterministic test media.

## Known limitations

- The implemented storage driver is a private local filesystem shared with Egress. Cloud/object-storage drivers are not configured by this change.
- Egress needs dedicated resources. The local container is limited to six CPUs; production should use an appropriately sized worker. [LiveKit recommends at least four CPUs and 4 GB RAM](https://docs.livekit.io/transport/self-hosting/egress/). Recording acceptance was verified on this resource-constrained Windows/Docker environment after fixing its ICE routing.
- Running Docker Egress and multiple publishing browser contexts on this 8GB Windows host also produced an overloaded provider pipeline (`pipeline frozen`) in a heavier rerun. The application kept that segment failed, without a player or publication. The final listen-only-Student fixture reduces local test contention; it does not establish production recording capacity for a shared 8GB machine.
- Layout follows the provider's speaker/screen-share composition, rather than reproducing the custom application canvas. There is no unsupported Pause feature.
- A room-template segment can finalize when all participants leave. A later recording is a new segment; files are never overwritten.
- Native player capabilities were verified in desktop Chrome and an emulated mobile viewport. Physical iOS/Safari devices were not tested.
- No Student download action is provided. This is not DRM: an authorized browser receives playable media bytes, and previously buffered bytes cannot be recalled after access is revoked.
- Expiry denies playback immediately; physical retention cleanup and retry require the backend lifecycle worker to be running. Retention defaults to 30 days.

Setup, API and lifecycle details: [online-class-recording.md](online-class-recording.md).
