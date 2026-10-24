import asyncio
from collections import defaultdict
from typing import Any
from uuid import UUID

from fastapi import WebSocket
from fastapi.encoders import jsonable_encoder


class ConnectionManager:
    def __init__(self) -> None:
        self._connections: dict[UUID, set[WebSocket]] = defaultdict(set)
        self._lock = asyncio.Lock()

    async def connect(self, exam_id: UUID, websocket: WebSocket) -> None:
        async with self._lock:
            self._connections[exam_id].add(websocket)

    async def disconnect(self, exam_id: UUID, websocket: WebSocket) -> None:
        async with self._lock:
            connections = self._connections.get(exam_id)
            if not connections:
                return
            connections.discard(websocket)
            if not connections:
                self._connections.pop(exam_id, None)

    async def broadcast(self, exam_id: UUID, message: dict[str, Any]) -> None:
        message = jsonable_encoder(message)
        async with self._lock:
            connections = list(self._connections.get(exam_id, set()))
        dead: list[WebSocket] = []
        for websocket in connections:
            try:
                await websocket.send_json(message)
            except Exception:
                dead.append(websocket)
        for websocket in dead:
            await self.disconnect(exam_id, websocket)


manager = ConnectionManager()
