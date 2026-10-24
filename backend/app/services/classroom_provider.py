"""SFU boundary for online classrooms. Exam calls use their existing transport."""
from datetime import timedelta
from typing import Protocol
from uuid import UUID
from urllib.parse import urlsplit

import aiohttp
from fastapi import HTTPException
from livekit import api

from app.core.config import get_settings


def room_name(session_id: UUID) -> str:
    return f'classroom-{session_id}'


class ClassroomProvider(Protocol):
    async def ensure_room(self, name: str) -> None: ...
    async def close_room(self, name: str) -> None: ...
    async def participant(self, name: str, identity: str): ...
    async def remove(self, name: str, identity: str) -> None: ...
    def token(self, name: str, identity: str, display_name: str) -> dict: ...
    def webhook(self, body: str, authorization: str): ...


class LiveKitProvider:
    def __init__(self):
        self.settings = get_settings()

    def _validate(self):
        s = self.settings
        if not (s.LIVEKIT_URL and s.LIVEKIT_API_KEY and s.LIVEKIT_API_SECRET):
            self._configuration_error()
        try:
            public = urlsplit(s.LIVEKIT_URL)
            internal = urlsplit(s.LIVEKIT_API_URL or s.LIVEKIT_URL)
            valid = public.scheme in ('ws', 'wss') and public.hostname and public.port != 0 and not (public.username or public.password or public.query or public.fragment)
            valid = valid and internal.scheme in ('http', 'https', 'ws', 'wss') and internal.hostname
            if s.ENVIRONMENT.lower() in ('prod', 'production') and public.scheme != 'wss':
                valid = False
        except ValueError:
            valid = False
        if not valid:
            self._configuration_error()

    @staticmethod
    def _configuration_error():
        raise HTTPException(503, detail={'code': 'REALTIME_CONFIG_MISSING', 'message': 'Dịch vụ lớp học trực tuyến chưa được cấu hình.'})

    def _client(self):
        self._validate()
        s = self.settings
        return api.LiveKitAPI(s.LIVEKIT_API_URL or s.LIVEKIT_URL, s.LIVEKIT_API_KEY, s.LIVEKIT_API_SECRET, timeout=aiohttp.ClientTimeout(total=6))

    async def _call(self, method: str, request, *, missing_ok=False):
        try:
            async with self._client() as client:
                return await getattr(client.room, method)(request)
        except api.TwirpError as exc:
            if missing_ok and exc.code == 'not_found':
                return None
            code = 'REALTIME_CONFIG_MISSING' if exc.code in ('unauthenticated', 'permission_denied') else 'REALTIME_CONNECTION_FAILED'
            raise HTTPException(503, detail={'code': code, 'message': 'Không thể kết nối máy chủ phòng học. Vui lòng thử lại.'}) from exc
        except (aiohttp.ClientError, TimeoutError) as exc:
            raise HTTPException(503, detail={'code': 'REALTIME_CONNECTION_FAILED', 'message': 'Không thể kết nối máy chủ phòng học. Vui lòng thử lại.'}) from exc

    async def ensure_room(self, name: str):
        # Only the authorized backend creates rooms. SFU auto_create MUST be false.
        await self._call('create_room', api.CreateRoomRequest(name=name, empty_timeout=300, departure_timeout=60))

    async def close_room(self, name: str):
        await self._call('delete_room', api.DeleteRoomRequest(room=name), missing_ok=True)

    async def participant(self, name: str, identity: str):
        return await self._call('get_participant', api.RoomParticipantIdentity(room=name, identity=identity), missing_ok=True)

    async def remove(self, name: str, identity: str):
        await self._call('remove_participant', api.RoomParticipantIdentity(room=name, identity=identity), missing_ok=True)

    def token(self, name: str, identity: str, display_name: str):
        self._validate()
        s = self.settings
        jwt = (api.AccessToken(s.LIVEKIT_API_KEY, s.LIVEKIT_API_SECRET)
               .with_identity(identity).with_name(display_name).with_ttl(timedelta(seconds=60))
               .with_grants(api.VideoGrants(room_join=True, room=name, room_create=False, room_admin=False,
                                           can_publish=True, can_subscribe=True, can_publish_data=True,
                                           can_publish_sources=['camera', 'microphone'], can_update_own_metadata=False))
               .to_jwt())
        return {'provider': 'livekit', 'url': s.LIVEKIT_URL, 'server_url': s.LIVEKIT_URL, 'room_name': name, 'token': jwt}

    def webhook(self, body: str, authorization: str):
        s = self.settings
        return api.WebhookReceiver(api.TokenVerifier(s.LIVEKIT_API_KEY, s.LIVEKIT_API_SECRET)).receive(body, authorization)


def get_classroom_provider() -> ClassroomProvider:
    return LiveKitProvider()
