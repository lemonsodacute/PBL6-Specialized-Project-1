"""Explicit synthetic adapters exercise failure isolation; never registered by production."""
import asyncio
import time
from datetime import datetime,timedelta,timezone
from unittest import IsolatedAsyncioTestCase,TestCase
from unittest.mock import MagicMock
from threading import Event
from unittest.mock import patch
from uuid import uuid4
import httpx
from app.core.config import settings
from app.proctoring.adapters import (AdapterContext,AdapterRuntime,HTTPModelAdapter,MonitoringFrame,
    RawPrediction,TemporalPolicy,factories,register_model)
from app.proctoring.contracts import ModelConfig


def calibrated(**updates):
    return {'enabled':True,'source':'GAZE','label':'Fixture only','frame_interval_ms':250,
        'label_map':{'away':'gaze_away'},'policies':{'gaze_away':{
            'minimum_duration_ms':0,'maximum_gap_ms':1000,'cooldown_ms':3000,'severity':'medium'}},**updates}


class AdapterTests(IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.runtime=AdapterRuntime();self.context=AdapterContext(uuid4(),uuid4(),uuid4())
        self.frame=MonitoringFrame(b'test-only-image','image/jpeg',datetime.now(timezone.utc))
        self.enterContext(patch.object(settings,'PROCTOR_MODEL_ENABLED',True))
        self.enterContext(patch.object(settings,'PROCTOR_MODELS',{'fixture':calibrated()}))
        self.enterContext(patch.object(settings,'PROCTOR_MODEL_TIMEOUT',.1))
        self.enterContext(patch.dict(factories,{},clear=True))
        self.addAsyncCleanup(self.runtime.close)

    async def test_lifecycle_nullable_confidence_cadence_and_stop(self):
        calls=[]
        class Adapter:
            async def start(_,context): calls.append('start')
            async def process_frame(_,frame):
                calls.append('frame');return [RawPrediction(label='away',occurred_at=frame.occurred_at)]
            async def stop(_): calls.append('stop')
        register_model('fixture',lambda config:Adapter())
        events,health=await self.runtime.process_frame(self.context,self.frame)
        self.assertEqual(len(events),1);self.assertIsNone(events[0].confidence)
        self.assertEqual(health,[('fixture','ACTIVE',None)])
        self.assertEqual(await self.runtime.process_frame(self.context,self.frame),([],[]))
        await self.runtime.stop(self.context.attempt_id)
        self.assertEqual(calls,['start','frame','stop']);self.assertFalse(self.runtime.sessions)

    async def test_timeout_crash_and_invalid_prediction_never_fabricate_event(self):
        stopped=[]
        for failure in ('timeout','crash','invalid'):
            class Adapter:
                async def start(_,context): pass
                async def process_frame(_,frame):
                    if failure=='timeout': await asyncio.sleep(1)
                    if failure=='crash': raise RuntimeError('Private model internals')
                    return [{'label':'away','occurred_at':frame.occurred_at,'confidence':8}]
                async def stop(_): stopped.append(True)
            register_model('fixture',lambda config:Adapter())
            events,health=await self.runtime.process_frame(self.context,self.frame)
            self.assertEqual(events,[])
            self.assertEqual(health[0][1],'DEGRADED' if failure=='timeout' else 'UNAVAILABLE')
            self.assertFalse(self.runtime.sessions);self.assertNotIn('Private',str(health))
        self.assertEqual(len(stopped),3)

    async def test_backpressure_and_stop_during_frame_do_not_resurrect_session(self):
        entered=asyncio.Event();release=asyncio.Event();stopped=[]
        class Adapter:
            async def start(_,context): pass
            async def process_frame(_,frame): entered.set();await release.wait();return []
            async def stop(_): stopped.append(True)
        register_model('fixture',lambda config:Adapter())
        task=asyncio.create_task(self.runtime.process_frame(self.context,self.frame));await entered.wait()
        self.assertEqual(await self.runtime.process_frame(self.context,self.frame),([] ,[(None,'DEGRADED','BACKPRESSURE')]))
        await self.runtime.stop(self.context.attempt_id);release.set();await task
        self.assertEqual(stopped,[True]);self.assertFalse(self.runtime.sessions)
        self.runtime.busy={uuid4() for _ in range(32)}
        self.assertEqual((await self.runtime.process_frame(self.context,self.frame))[1][0][2],'BACKPRESSURE')

    async def test_disabled_no_adapter_and_idle_resource_cleanup(self):
        stopped=[]
        class Adapter:
            async def start(_,context): pass
            async def process_frame(_,frame): return []
            async def stop(_): stopped.append(True)
        self.assertEqual(await self.runtime.process_frame(self.context,self.frame),([],[]))
        register_model('fixture',lambda config:Adapter())
        await self.runtime.process_frame(self.context,self.frame)
        for key in self.runtime.last_used:self.runtime.last_used[key]=time.monotonic()-121
        await self.runtime.cleanup();self.assertEqual(stopped,[True])
        with patch.object(settings,'PROCTOR_MODEL_ENABLED',False):
            self.assertEqual(await self.runtime.process_frame(self.context,self.frame),([],[]))

    async def test_http_transport_bounded_response_no_identity_and_no_fake_fallback(self):
        config=ModelConfig.model_validate(calibrated(endpoint='http://inference.internal/predict'))
        adapter=HTTPModelAdapter(config);await adapter.start(self.context)
        self.addAsyncCleanup(adapter.stop)
        await adapter.client.aclose()
        observed=[]
        def response(request):
            observed.append(request.content)
            return httpx.Response(200,json={'predictions':[{'label':'away'}]})
        adapter.client=httpx.AsyncClient(transport=httpx.MockTransport(response))
        predictions=await adapter.process_frame(self.frame)
        self.assertEqual(len(predictions),1);self.assertIsNone(predictions[0].confidence)
        self.assertNotIn(str(self.context.student_id).encode(),observed[0])
        await adapter.client.aclose()
        adapter.client=httpx.AsyncClient(transport=httpx.MockTransport(lambda request:httpx.Response(200,content=b'x'*17000)))
        with self.assertRaises(ValueError):await adapter.process_frame(self.frame)


class TemporalContinuityTests(TestCase):
    def test_absence_negative_low_confidence_and_gap_reset_continuity(self):
        config=ModelConfig.model_validate(calibrated())
        config.policies['gaze_away'].minimum_duration_ms=1000
        config.policies['gaze_away'].maximum_gap_ms=600
        policy=TemporalPolicy();context=AdapterContext(uuid4(),uuid4(),uuid4());start=datetime.now(timezone.utc)
        def process(ms,active=True):
            return policy.normalize(context,'fixture',config,[RawPrediction(label='away',active=active,occurred_at=start+timedelta(milliseconds=ms))])
        self.assertEqual(process(0),[]);self.assertEqual(process(500),[])
        self.assertEqual(process(600,False),[]);self.assertEqual(process(1000),[])
        self.assertEqual(process(1700),[]);self.assertEqual(process(2200),[])
        self.assertEqual(len(process(2700)),1)
        policy.normalize(context,'fixture',config,[])
        self.assertEqual(process(3000),[])


class TransactionSchedulingTests(IsolatedAsyncioTestCase):
    async def test_database_lock_wait_does_not_block_response_cleanup_or_websocket_loop(self):
        from app.api.v1.proctor_alerts import persist
        from app.services.proctor_events import IngestResult
        entered,release=Event(),Event();db=MagicMock()
        db.bind.dialect.name='sqlite'
        def waiting_transaction(*args,**kwargs):
            entered.set()
            if not release.wait(timeout=1): raise TimeoutError('The event loop could not release the competing transaction')
            return IngestResult(None,suppressed='test_only')
        async def release_from_loop():
            while not entered.is_set(): await asyncio.sleep(.001)
            await asyncio.sleep(.02);release.set()
        cleanup=asyncio.create_task(release_from_loop())
        try:
            with patch('app.api.v1.proctor_alerts.domain.ingest',waiting_transaction):
                result=await persist(db,object())
            self.assertFalse(result['data']['stored']);db.commit.assert_called_once()
        finally:
            release.set();await cleanup
