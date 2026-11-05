"""LiveKit server-side room composite Egress. No browser capture or secrets."""
from pathlib import PurePosixPath
import aiohttp
from fastapi import HTTPException
from livekit import api
from app.core.config import get_settings
from app.services.classroom_provider import LiveKitProvider


class LiveKitRecordingProvider:
    async def available(self):
        settings = get_settings()
        if not settings.CLASS_RECORDING_ENABLED or not settings.LIVEKIT_EGRESS_HEALTH_URL:
            return False
        try:
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=2)) as client:
                async with client.get(settings.LIVEKIT_EGRESS_HEALTH_URL, allow_redirects=False) as response:
                    return response.status == 200
        except (aiohttp.ClientError, TimeoutError):
            return False

    async def _call(self, method, request):
        try:
            boundary = LiveKitProvider()
            boundary._validate()
            settings = boundary.settings
            async with api.LiveKitAPI(settings.LIVEKIT_API_URL or settings.LIVEKIT_URL, settings.LIVEKIT_API_KEY,
                    settings.LIVEKIT_API_SECRET, timeout=aiohttp.ClientTimeout(total=30)) as client:
                return await getattr(client.egress, method)(request)
        except (api.TwirpError, aiohttp.ClientError, TimeoutError) as cause:
            raise HTTPException(503, detail={'code': 'RECORDING_PROVIDER_UNAVAILABLE', 'message': 'Ghi hình hiện không khả dụng. Vui lòng thử lại sau.'}) from cause

    async def start(self, room, key):
        output = str(PurePosixPath(get_settings().LIVEKIT_EGRESS_OUTPUT_ROOT) / key)
        return await self._call('start_egress', api.StartEgressRequest(
            room_name=room, template=api.TemplateSource(layout='speaker'),
            advanced=api.EncodingOptions(width=1280, height=720, framerate=get_settings().RECORDING_FRAMERATE,
                video_codec=api.VideoCodec.H264_MAIN, video_bitrate=1800, audio_codec=api.AudioCodec.AAC, audio_bitrate=64, key_frame_interval=2),
            outputs=[api.Output(file=api.FileOutput(file_type=api.EncodedFileType.MP4, filepath=output, disable_manifest=True))]))

    async def stop(self, provider_id):
        return await self._call('stop_egress', api.StopEgressRequest(egress_id=provider_id))

    async def list(self, room):
        result = await self._call('list_egress', api.ListEgressRequest(room_name=room))
        return list(result.items)


def get_recording_provider():
    return LiveKitRecordingProvider()
