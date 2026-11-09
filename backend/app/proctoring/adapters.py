"""Replaceable inference transports and calibrated temporal policy; no identity imports."""
import asyncio
import base64
import logging
import time
from collections import OrderedDict
from dataclasses import dataclass
from datetime import datetime
from typing import Callable, Protocol, Sequence
from uuid import UUID, uuid4
import httpx
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field
from app.core.config import settings
from app.proctoring.contracts import EvidenceSummary, ModelConfig, NormalizedProctorEvent, SafeMetadata
from app.proctoring.diagnostics import diagnostic


@dataclass(frozen=True)
class AdapterContext:
    exam_id: UUID
    attempt_id: UUID
    student_id: UUID


@dataclass(frozen=True)
class MonitoringFrame:
    content: bytes
    content_type: str
    occurred_at: datetime
    trace_id: str | None = None


class RawPrediction(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)
    label: str = Field(max_length=64)
    active: bool = True
    confidence: float | None = Field(default=None, ge=0, le=1)
    occurred_at: AwareDatetime
    metadata: SafeMetadata = Field(default_factory=SafeMetadata)
    evidence: EvidenceSummary | None = None


class ProctorModelAdapter(Protocol):
    async def start(self, context: AdapterContext) -> None: ...
    async def process_frame(self, frame: MonitoringFrame) -> Sequence[RawPrediction]: ...
    async def stop(self) -> None: ...


class HTTPModelAdapter:
    """Optional protected inference transport. An unset endpoint produces no predictions."""
    def __init__(self, config: ModelConfig):
        self.config = config
        self.client: httpx.AsyncClient | None = None

    async def start(self, context):
        url = httpx.URL(self.config.endpoint or '')
        if url.scheme not in {'http','https'} or not url.host or url.username or url.password:
            raise ValueError('Invalid server-configured inference endpoint')
        self.client = httpx.AsyncClient(timeout=settings.PROCTOR_MODEL_TIMEOUT, follow_redirects=False, trust_env=False)

    async def process_frame(self, frame):
        if self.client is None: raise RuntimeError('Adapter not started')
        # Frames remain in memory. Do not include student identity, log payloads or follow redirects.
        async with self.client.stream('POST', self.config.endpoint, json={
            'image_base64':base64.b64encode(frame.content).decode('ascii'),
            'content_type':frame.content_type,'occurred_at':frame.occurred_at.isoformat()}) as response:
            response.raise_for_status()
            body = bytearray()
            async for chunk in response.aiter_bytes():
                body.extend(chunk)
                if len(body)>16384: raise ValueError('Oversized inference response')
        import json
        data = json.loads(body)
        predictions = data.get('predictions') if isinstance(data,dict) else None
        if not isinstance(predictions,list) or len(predictions)>32: raise ValueError('Invalid inference response')
        return [RawPrediction.model_validate({**item,'occurred_at':item.get('occurred_at',frame.occurred_at)}) for item in predictions]

    async def stop(self):
        if self.client: await self.client.aclose()
        self.client = None


@dataclass
class TemporalState:
    first: datetime
    last: datetime
    emitted: datetime | None = None
    frames: int = 1


class TemporalPolicy:
    def __init__(self):
        self.states: dict[str,TemporalState] = {}

    def normalize(self, context, provider, config, predictions, *, trace=None):
        output, present = [], set()
        for prediction in predictions:
            kind = config.label_map.get(prediction.label)
            policy = config.policies.get(kind)
            if not kind or not policy or not policy.calibrated: continue
            if not prediction.active or (policy.confidence_threshold is not None and
                (prediction.confidence is None or prediction.confidence<policy.confidence_threshold)):
                self.states.pop(kind,None); continue
            present.add(kind)
            stamp = prediction.occurred_at
            state = self.states.get(kind)
            if state and stamp <= state.last: continue
            if not state or (stamp-state.last).total_seconds()*1000>policy.maximum_gap_ms:
                if state: diagnostic('temporal_reset', trace=trace, provider=provider, event_type=kind,
                    reason='observation_gap', gap_ms=round((stamp-state.last).total_seconds()*1000), maximum_gap_ms=policy.maximum_gap_ms)
                state = TemporalState(stamp,stamp); self.states[kind]=state
            else:
                state.last=stamp; state.frames+=1
            if (stamp-state.first).total_seconds()*1000<policy.minimum_duration_ms: continue
            if state.emitted and (stamp-state.emitted).total_seconds()*1000<policy.cooldown_ms: continue
            state.emitted=stamp
            output.append(NormalizedProctorEvent(external_id=uuid4(),provider=provider,exam_id=context.exam_id,
                attempt_id=context.attempt_id,student_id=context.student_id,source=config.source,event_type=kind,
                severity=policy.severity_for(prediction.confidence),confidence=prediction.confidence,occurred_at=stamp,first_seen=state.first,last_seen=stamp,
                metadata=prediction.metadata.model_copy(update={'frame_count':state.frames}),evidence=prediction.evidence))
        for kind in set(self.states)-present: self.states.pop(kind,None)
        return output


Factory = Callable[[ModelConfig], ProctorModelAdapter]
factories: dict[str,Factory] = {}
logger = logging.getLogger(__name__)


def register_model(provider: str, factory: Factory):
    """Register code at application startup, never accept/import code from an HTTP request."""
    import re
    if provider in {'legacy','browser_signals','test_simulator'} or not re.fullmatch(r'[a-z][a-z0-9_-]{0,63}',provider): raise ValueError('Reserved or invalid provider')
    factories[provider] = factory


def configured_models():
    if not settings.PROCTOR_MODEL_ENABLED: return []
    result = []
    for provider,raw in list(settings.PROCTOR_MODELS.items())[:16]:
        if provider in {'legacy','browser_signals','test_simulator'}: continue
        try: config = ModelConfig.model_validate(raw)
        except ValueError:
            diagnostic('profile_skipped', reason='invalid_configuration'); continue
        if not config.enabled or not config.policies or not all(policy.calibrated for policy in config.policies.values()):
            diagnostic('profile_skipped', provider=provider, reason='disabled_or_uncalibrated'); continue
        factory = factories.get(provider) or (HTTPModelAdapter if config.endpoint else None)
        if factory and config.frame_interval_ms is not None: result.append((provider,config,factory))
        else: diagnostic('profile_skipped', provider=provider, reason='transport_or_cadence_missing')
    return result


class AdapterRuntime:
    def __init__(self):
        self.sessions = OrderedDict()
        self.busy: set[UUID] = set()
        self.last_used = {}
        self.pending_stop: set[UUID] = set()

    async def stop(self, attempt_id):
        if attempt_id in self.busy:
            self.pending_stop.add(attempt_id); return
        for key in [key for key in self.sessions if key[0]==attempt_id]:
            adapter,_,_ = self.sessions.pop(key)
            self.last_used.pop(key,None)
            try: await asyncio.wait_for(adapter.stop(),timeout=settings.PROCTOR_MODEL_TIMEOUT)
            except Exception: pass

    async def cleanup(self):
        stale={key[0] for key,stamp in list(self.last_used.items()) if time.monotonic()-stamp>120}
        for attempt_id in stale-self.busy: await self.stop(attempt_id)

    async def close(self):
        for attempt_id in {key[0] for key in self.sessions}: await self.stop(attempt_id)

    def calibration_sample(self, attempt_id):
        if settings.ENVIRONMENT.lower() not in {'development', 'dev', 'local'} or not settings.PROCTOR_GAZE_CALIBRATION:
            return None
        record = self.sessions.get((attempt_id, 'local_gaze'))
        return getattr(record[0], 'latest_calibration_sample', None) if record else None

    async def process_frame(self, context: AdapterContext, frame: MonitoringFrame):
        if context.attempt_id in self.busy or len(self.busy)>=32:
            return [],[(None,'DEGRADED','BACKPRESSURE')]
        self.busy.add(context.attempt_id)
        output,health = [],[]
        try:
            for provider,config,factory in configured_models():
                key=(context.attempt_id,provider)
                adapter=None
                try:
                    record=self.sessions.get(key)
                    if not record:
                        if len(self.sessions)>=128:
                            old=next((item[0] for item in self.sessions if item[0] not in self.busy),None)
                            if old is None: raise RuntimeError('Runtime capacity reached')
                            await self.stop(old)
                        adapter=factory(config)
                        await asyncio.wait_for(adapter.start(context),timeout=settings.PROCTOR_MODEL_TIMEOUT)
                        record=(adapter,TemporalPolicy(),None)
                        self.sessions[key]=record
                    adapter,policy,previous=record
                    if previous and (frame.occurred_at-previous).total_seconds()*1000<config.frame_interval_ms: continue
                    predictions=await asyncio.wait_for(adapter.process_frame(frame),timeout=settings.PROCTOR_MODEL_TIMEOUT)
                    if len(predictions)>32: raise ValueError('Too many predictions')
                    predictions=[RawPrediction.model_validate(item) for item in predictions]
                    if any(abs((item.occurred_at-frame.occurred_at).total_seconds())>30 for item in predictions):
                        raise ValueError('Prediction timestamp does not match input')
                    normalized=policy.normalize(context,provider,config,predictions,trace=frame.trace_id)
                    output.extend(normalized)
                    diagnostic('temporal_policy', trace=frame.trace_id, provider=provider, predictions=len(predictions),
                        active_states=len(policy.states), emitted=[event.event_type for event in normalized])
                    self.sessions[key]=(adapter,policy,frame.occurred_at);self.sessions.move_to_end(key)
                    self.last_used[key]=time.monotonic()
                    health.append((provider,'ACTIVE',None))
                except Exception as error:
                    diagnostic('adapter_failed', trace=frame.trace_id, provider=provider, error_type=type(error).__name__)
                    logger.warning('proctor_adapter_failed provider=%s category=%s',provider,'timeout' if isinstance(error,(asyncio.TimeoutError,httpx.TimeoutException)) else 'invalid_or_unavailable')
                    health.append((provider,'DEGRADED' if isinstance(error,(asyncio.TimeoutError,httpx.TimeoutException)) else 'UNAVAILABLE',
                        'MODEL_TIMEOUT' if isinstance(error,(asyncio.TimeoutError,httpx.TimeoutException)) else 'INVALID_MODEL_OUTPUT' if isinstance(error,ValueError) else 'MODEL_UNAVAILABLE'))
                    if key in self.sessions:
                        adapter,_,_=self.sessions.pop(key)
                        self.last_used.pop(key,None)
                    if adapter is not None:
                        try: await asyncio.wait_for(adapter.stop(),timeout=settings.PROCTOR_MODEL_TIMEOUT)
                        except Exception: pass
            return output,health
        finally:
            self.busy.discard(context.attempt_id)
            if context.attempt_id in self.pending_stop:
                self.pending_stop.discard(context.attempt_id)
                await self.stop(context.attempt_id)


def _local_factory(module):
    def factory(config):
        from app.proctoring.local_worker import LocalWorkerAdapter
        return LocalWorkerAdapter(module)
    return factory


register_model('local_yolo', _local_factory('object_detection'))
register_model('local_gaze', _local_factory('gaze'))
runtime = AdapterRuntime()
