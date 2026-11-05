"""Explicit synthetic transport fixtures. No model output is faked in application code."""
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from unittest import TestCase
from unittest.mock import patch
from uuid import uuid4
from sqlalchemy import func, select
from starlette.websockets import WebSocketDisconnect
from app.core.config import settings
from app.core.security import create_access_token, create_refresh_token
from app.models.entities import (AuditLog, DetectionEvent, ExamStatus, AttemptStatus, Notification,
    ProctorEventReceipt, ProctorModelHealth, ProctoringSession, SupportConversation, UserSettings)
from app.proctoring.contracts import ModelConfig
from app.proctoring.adapters import AdapterContext, RawPrediction, TemporalPolicy
from tests import test_teacher_results as fixtures


class ProctorAlertsTests(TestCase):
    def setUp(self):
        self.fixture=fixtures.TeacherResultsTests();self.fixture.setUp();self.addCleanup(self.fixture.doCleanups)
        self.db,self.client=self.fixture.db,self.fixture.client
        for model in (ProctorEventReceipt,ProctorModelHealth,SupportConversation,Notification,UserSettings):
            model.__table__.create(self.db.bind)
        self.config={'enabled':True,'source':'MULTI_PERSON','label':'Test fixture module',
            'label_map':{'many':'multiple_faces'},'policies':{'multiple_faces':{
                'minimum_duration_ms':0,'maximum_gap_ms':1000,'cooldown_ms':5000,'severity':'high','confidence_threshold':None}}}
        self.enterContext(patch.object(settings,'PROCTOR_MODEL_ENABLED',True))
        self.enterContext(patch.object(settings,'PROCTOR_MODELS',{'fixture_model':self.config}))
        self.enterContext(patch.object(settings,'PROCTOR_INGEST_KEY','unit-test-only-internal-key-0123456789'))
        self.enterContext(patch.object(settings,'PROCTOR_SIMULATOR_ENABLED',False))
        self.enterContext(patch.object(settings,'ENVIRONMENT','test'))

    def payload(self, **changes):
        f=self.fixture
        result={'external_id':str(uuid4()),'provider':'fixture_model','exam_id':str(f.exam.id),
            'attempt_id':str(f.progress.id),'student_id':str(f.active.id),'source':'MULTI_PERSON',
            'event_type':'multiple_faces','severity':'high','confidence':None,'occurred_at':datetime.now(timezone.utc).isoformat()}
        return {**result,**changes}

    def ingest(self, payload=None, **kwargs):
        return self.client.post('/api/v1/proctoring/events',json=payload or self.payload(),headers={'X-Proctor-Service-Key':settings.PROCTOR_INGEST_KEY},**kwargs)

    def call(self, method,path,actor=None,**kwargs):
        return self.client.request(method,'/api/v1/proctoring'+path,headers=self.fixture.headers(actor),**kwargs)

    def test_trusted_channel_and_legacy_browser_ai_endpoint_denied(self):
        for actor in (self.fixture.active,self.fixture.teacher,self.fixture.admin):
            response=self.client.post('/api/v1/proctoring/events',json=self.payload(),headers=self.fixture.headers(actor))
            self.assertEqual(response.status_code,401,response.text)
        old=self.client.post('/api/v1/proctoring/detection-events',json={'severity':'critical'},headers=self.fixture.headers(self.fixture.active))
        self.assertEqual(old.status_code,403)
        self.assertEqual(self.db.scalar(select(func.count()).select_from(DetectionEvent)),0)

    def test_valid_event_persisted_nullable_confidence_notifications_and_no_score_effect(self):
        f=self.fixture;score=f.progress.score;risk=f.progress.risk_score;count=f.progress.violation_count
        response=self.ingest();self.assertEqual(response.status_code,200,response.text)
        event=response.json()['data']['event']
        self.assertIsNone(event['confidence']);self.assertIsNone(event['max_confidence'])
        self.assertEqual(event['status'],'NEW');self.assertFalse(event['is_simulated'])
        self.db.refresh(f.progress)
        self.assertEqual((f.progress.score,f.progress.risk_score,f.progress.violation_count),(score,risk,count))
        notices=self.db.scalars(select(Notification)).all();self.assertEqual(len(notices),2)
        self.assertEqual({row.recipient_user_id for row in notices},{f.teacher.id,f.admin.id})
        self.assertTrue(all(str(row.related_proctor_event_id)==event['id'] for row in notices))
        bell=self.client.get('/api/v1/notifications',headers=f.headers()).json()['data'][0]
        self.assertEqual(bell['related_proctor_event_id'],event['id'])
        self.assertFalse(bell['proctor_event_simulated'])

    def test_invalid_confidence_time_links_sources_severity_and_metadata_rejected(self):
        for values in ({'confidence':1.2},{'confidence':-.1},{'student_id':str(self.fixture.student.id)},
            {'exam_id':str(uuid4())},{'source':'FACE'},{'event_type':'unsupported_model'}, {'severity':'critical'},
            {'occurred_at':(datetime.now(timezone.utc)+timedelta(hours=1)).isoformat()},
            {'occurred_at':'2026-01-01T00:00:00'}, {'metadata':{'image_base64':'private image'}},
            {'evidence':{'snapshot_url':'https://public.example/frame.jpg'}}):
            response=self.ingest(self.payload(**values))
            self.assertIn(response.status_code,(404,422),response.text)
        raw=self.client.post('/api/v1/proctoring/events',content='{"confidence":NaN}',headers={'X-Proctor-Service-Key':settings.PROCTOR_INGEST_KEY})
        self.assertEqual(raw.status_code,422)

    def test_transport_payload_limit_before_parsing_and_model_disabled_no_fallback(self):
        response=self.client.post('/api/v1/proctoring/events',content=b'x'*17000,headers={'X-Proctor-Service-Key':settings.PROCTOR_INGEST_KEY})
        self.assertEqual(response.status_code,413)
        with patch.object(settings,'PROCTOR_MODEL_ENABLED',False):
            self.assertEqual(self.ingest().status_code,503)
        self.config['policies']['multiple_faces']['minimum_duration_ms']=None
        self.assertEqual(self.ingest().status_code,422)
        self.assertEqual(self.db.scalar(select(func.count()).select_from(DetectionEvent)),0)

    def test_inactive_submitted_and_closed_exam_rejected_without_changing_attempt(self):
        f=self.fixture
        self.assertEqual(self.ingest(self.payload(attempt_id=str(f.submitted.id),student_id=str(f.student.id))).status_code,409)
        f.exam.status=ExamStatus.closed;self.db.commit()
        self.assertEqual(self.ingest().status_code,409)
        self.assertEqual(f.progress.status,AttemptStatus.in_progress)

    def test_cooldown_aggregation_retry_keys_and_max_confidence(self):
        first=self.payload(confidence=.72);result=self.ingest(first).json()['data'];identifier=result['event']['id']
        for confidence in (.8,.91,.6):
            result=self.ingest(self.payload(confidence=confidence)).json()['data']
            self.assertEqual(result['event']['id'],identifier);self.assertFalse(result['created'])
        self.assertEqual(result['event']['occurrence_count'],4)
        self.assertAlmostEqual(float(result['event']['max_confidence']),.91)
        repeat=self.ingest(first).json()['data'];self.assertTrue(repeat['duplicate'])
        self.assertEqual(repeat['event']['occurrence_count'],4)
        self.assertEqual(self.db.scalar(select(func.count()).select_from(Notification)),2)

    def test_thresholds_suppress_and_rate_limit_bounds_meaningful_emissions(self):
        self.config['policies']['multiple_faces']['confidence_threshold']=.8
        response=self.ingest(self.payload(confidence=.79)).json()['data'];self.assertFalse(response['stored'])
        self.assertEqual(response['suppressed'],'confidence_threshold')
        with patch.object(settings,'PROCTOR_INGEST_PER_MINUTE',1):
            self.assertEqual(self.ingest(self.payload(confidence=.9)).status_code,200)
            self.assertEqual(self.ingest(self.payload(confidence=.9)).status_code,429)

    def test_review_ack_confirm_conflict_history_refresh_and_teacher_permissions(self):
        event=self.ingest().json()['data']['event'];path=f'/events/{event["id"]}'
        self.assertEqual(self.call('GET',path,actor=self.fixture.other).status_code,403)
        self.assertEqual(self.call('GET',path,actor=self.fixture.active).status_code,403)
        ack=self.call('PATCH',path+'/review',json={'status':'REVIEWED','expected_version':0}).json()['data']
        self.assertEqual(ack['review_version'],1)
        conflict=self.call('PATCH',path+'/review',json={'status':'DISMISSED','expected_version':0})
        self.assertEqual(conflict.status_code,409)
        decision=self.call('PATCH',path+'/review',json={'status':'CONFIRMED','expected_version':1,'note':'Requires human follow-up.'})
        self.assertEqual(decision.status_code,200,decision.text)
        refreshed=self.call('GET',path).json()['data']
        self.assertEqual(refreshed['status'],'CONFIRMED');self.assertEqual(refreshed['reviewed_by'],str(self.fixture.teacher.id))
        self.assertEqual(len(refreshed['history']),3)
        self.ingest()
        self.assertEqual(self.call('GET',path).json()['data']['status'],'CONFIRMED')
        notice=self.db.scalar(select(Notification).where(Notification.recipient_user_id==self.fixture.teacher.id))
        self.db.refresh(notice);self.assertTrue(notice.is_read)

    def test_dismissal_and_post_exam_report_retain_real_statuses(self):
        event=self.ingest().json()['data']['event']
        self.call('PATCH',f'/events/{event["id"]}/review',json={'status':'DISMISSED','expected_version':0})
        self.fixture.exam.status=ExamStatus.closed;self.db.commit()
        report=self.call('GET',f'/exams/{self.fixture.exam.id}/report').json()['data']
        self.assertEqual(report['summary']['total'],1);self.assertEqual(report['summary']['dismissed'],1)
        self.assertEqual(report['summary']['new'],0);self.assertEqual(report['students_requiring_review'],[])
        self.assertEqual(report['types'],[{'event_type':'multiple_faces','count':1}])

    def test_simulator_both_guards_clear_label_and_separate_metrics(self):
        path='/dev/simulate';body={'attempt_id':str(self.fixture.progress.id),'event_type':'multiple_faces'}
        self.assertEqual(self.call('POST',path,json=body).status_code,404)
        with patch.object(settings,'PROCTOR_SIMULATOR_ENABLED',True):
            with patch.object(settings,'ENVIRONMENT','production'):
                self.assertEqual(self.call('POST',path,json=body).status_code,404)
            self.assertEqual(self.call('POST',path,actor=self.fixture.active,json=body).status_code,403)
            simulated=self.call('POST',path,json=body).json()['data']['event']
        self.assertEqual(simulated['source'],'TEST_SIMULATOR');self.assertTrue(simulated['is_simulated'])
        normal=self.call('GET',f'/exams/{self.fixture.exam.id}/events').json()
        self.assertEqual(normal['data'],[]);self.assertEqual(normal['meta']['summary']['total'],0)
        test=self.call('GET',f'/exams/{self.fixture.exam.id}/events?simulated=true').json()
        self.assertEqual(test['meta']['summary']['total'],1)
        notice=self.db.scalar(select(Notification));self.assertTrue(notice.title.startswith('[Mô phỏng]'))

    def test_student_input_has_no_fake_model_or_monitoring_details(self):
        f=self.fixture
        cap=self.call('GET',f'/sessions/{f.progress.id}/input-capabilities',actor=f.active).json()['data']
        self.assertEqual(cap,{'enabled':False,'frame_interval_ms':None,'gaze_calibration_enabled':False})
        self.ingest()
        timeline=self.client.get(f'/api/v1/attempts/{f.progress.id}/timeline',headers=f.headers(f.active)).json()['data']
        self.assertEqual(timeline,[])
        self.assertEqual(self.call('GET',f'/exams/{f.exam.id}/events',actor=f.active).status_code,403)

    def test_real_browser_signal_is_low_self_reported_and_never_authoritative_ai(self):
        f=self.fixture
        response=self.client.post(f'/api/v1/attempts/{f.progress.id}/violations',headers=f.headers(f.active),
            json={'type':'tab_switch','severity':'critical'})
        self.assertEqual(response.status_code,200,response.text)
        row=self.call('GET',f'/exams/{f.exam.id}/events').json()['data'][0]
        self.assertEqual(row['source'],'TAB_SWITCH');self.assertEqual(row['provider'],'browser_signals')
        self.assertEqual(row['severity'],'low');self.assertIsNone(row['confidence'])

    def test_websocket_commit_delivery_authorization_and_origin(self):
        f=self.fixture
        with self.client.websocket_connect('/api/v1/proctoring/ws') as socket:
            socket.send_json({'type':'auth','token':create_access_token(str(f.teacher.id),'teacher')})
            self.assertEqual(socket.receive_json()['type'],'ready')
            event=self.ingest().json()['data']['event']
            message=socket.receive_json()
            while message['type']=='resync': message=socket.receive_json()
            self.assertEqual(message['type'],'proctor_event_created')
            self.assertEqual(message['data']['id'],event['id']);self.assertNotIn('student',message['data'])
        for actor,token in [(f.active,create_access_token(str(f.active.id),'student')),(f.teacher,create_refresh_token(str(f.teacher.id)))]:
            with self.assertRaises(WebSocketDisconnect):
                with self.client.websocket_connect('/api/v1/proctoring/ws') as socket:
                    socket.send_json({'type':'auth','token':token});socket.receive_json()
        with self.assertRaises(WebSocketDisconnect):
            with self.client.websocket_connect('/api/v1/proctoring/ws',headers={'origin':'https://untrusted.example'}): pass

    def test_unrelated_teacher_receives_no_identifiers_and_scoped_access_revoked(self):
        f=self.fixture
        with self.client.websocket_connect('/api/v1/proctoring/ws') as socket:
            socket.send_json({'type':'auth','token':create_access_token(str(f.other.id),'teacher')})
            self.assertEqual(socket.receive_json()['type'],'ready')
            self.ingest();socket.send_text('ping')
            message=socket.receive_json()
            while message['type']=='resync': message=socket.receive_json()
            self.assertEqual(message['type'],'ping')
        with self.assertRaises(WebSocketDisconnect):
            with self.client.websocket_connect(f'/api/v1/ws/monitor/{f.exam.id}') as socket:
                socket.send_json({'type':'auth','token':create_access_token(str(f.other.id),'teacher')});socket.receive_json()

    def test_review_does_not_enter_legacy_risk_formula(self):
        from app.services.risk import calculate_risk_score
        self.ingest(self.payload(confidence=.99))
        self.assertEqual(calculate_risk_score(self.db,self.fixture.progress.id),Decimal('0.00'))

    def test_health_expiry_and_technical_details_admin_only(self):
        f=self.fixture
        body={'status':'DEGRADED','error_code':'MODEL_TIMEOUT'}
        response=self.client.post('/api/v1/proctoring/modules/fixture_model/heartbeat',json=body,headers={'X-Proctor-Service-Key':settings.PROCTOR_INGEST_KEY})
        self.assertEqual(response.status_code,200,response.text)
        teacher=self.call('GET',f'/exams/{f.exam.id}/health').json()['data']['modules'][0]
        self.assertEqual(teacher['status'],'DEGRADED');self.assertNotIn('error_code',teacher);self.assertNotIn('endpoint',teacher)
        admin=self.call('GET',f'/exams/{f.exam.id}/health',actor=f.admin).json()['data']['modules'][0]
        self.assertEqual(admin['error_code'],'MODEL_TIMEOUT')
        row=self.db.get(ProctorModelHealth,'fixture_model');row.updated_at=datetime.now(timezone.utc)-timedelta(minutes=2);self.db.commit()
        self.assertEqual(self.call('GET',f'/exams/{f.exam.id}/health').json()['data']['modules'][0]['status'],'UNAVAILABLE')

    def test_camera_input_uses_registered_adapter_and_student_gets_only_transport_ack(self):
        from io import BytesIO
        from PIL import Image
        from app.proctoring.adapters import factories,register_model
        f=self.fixture;calls=[]
        class Adapter:
            async def start(_,context):calls.append('start')
            async def process_frame(_,frame):return [RawPrediction(label='many',occurred_at=frame.occurred_at,confidence=.9)]
            async def stop(_):calls.append('stop')
        self.enterContext(patch.dict(factories,{},clear=True))
        register_model('fixture_model',lambda config:Adapter())
        self.config['frame_interval_ms']=250
        f.exam.require_camera=True;self.db.commit()
        self.assertEqual(self.call('POST',f'/sessions/{f.progress.id}',actor=f.active).status_code,200)
        image=BytesIO();Image.new('RGB',(2,2)).save(image,format='JPEG')
        response=self.call('POST',f'/sessions/{f.progress.id}/frame',actor=f.active,files={'frame':('camera.jpg',image.getvalue(),'image/jpeg')})
        self.assertEqual(response.status_code,200,response.text);self.assertEqual(response.json()['data'],{'processed':True})
        event=self.call('GET',f'/exams/{f.exam.id}/events').json()['data'][0]
        self.assertEqual(event['source'],'MULTI_PERSON');self.assertEqual(float(event['confidence']),.9)
        self.assertEqual(self.call('DELETE',f'/sessions/{f.progress.id}/input',actor=f.active).status_code,200)
        self.assertEqual(calls,['start','stop'])
        f.progress.status=AttemptStatus.submitted;self.db.commit()
        self.assertEqual(self.call('POST',f'/sessions/{f.progress.id}/frame',actor=f.active,files={'frame':('camera.jpg',image.getvalue(),'image/jpeg')}).status_code,409)

    def test_timeline_only_real_events_review_actor_and_actual_session_milestones(self):
        f=self.fixture;event=self.ingest().json()['data']['event']
        self.call('PATCH',f'/events/{event["id"]}/review',json={'status':'DISMISSED','expected_version':0,'note':'Human review'})
        f.progress.status=AttemptStatus.submitted;f.progress.submitted_at=datetime.now(timezone.utc);self.db.commit()
        entries=self.call('GET',f'/attempts/{f.progress.id}/timeline').json()['data']['entries']
        self.assertEqual(entries[0]['kind'],'started');self.assertEqual(entries[-1]['kind'],'submitted')
        self.assertEqual(len([item for item in entries if item['kind']=='event']),1)
        review=[item for item in entries if item['kind']=='review'][0]
        self.assertEqual(review['actor'],f.teacher.full_name);self.assertEqual(review['status'],'DISMISSED')

    def test_browser_recording_policy_is_preserved_when_review_envelope_is_rate_limited(self):
        f=self.fixture
        with patch.object(settings,'PROCTOR_INGEST_PER_MINUTE',1):
            self.ingest()
            response=self.client.post(f'/api/v1/attempts/{f.progress.id}/violations',headers=f.headers(f.active),json={'type':'tab_switch','severity':'low'})
            self.assertEqual(response.status_code,200,response.text)
            self.assertEqual(response.json()['data']['violation']['type'],'tab_switch')

    def test_existing_legacy_evidence_remains_private_and_path_checked(self):
        from tempfile import TemporaryDirectory
        from pathlib import Path
        event=self.ingest().json()['data']['event'];row=self.db.get(DetectionEvent,__import__('uuid').UUID(event['id']))
        row.source='LEGACY';name='a'*32+'.png';row.snapshot_url='/uploads/'+name;self.db.commit()
        with TemporaryDirectory() as temporary:
            root=Path(temporary);(root/name).write_bytes(b'fixture-only-private-file')
            with patch('app.services.snapshots.UPLOAD_DIR',root):
                path=f'/events/{event["id"]}/evidence'
                response=self.call('GET',path)
                self.assertEqual(response.status_code,200);self.assertIn('no-store',response.headers['cache-control'])
                self.assertEqual(self.call('GET',path,actor=self.fixture.active).status_code,403)
                self.assertEqual(self.call('GET',path,actor=self.fixture.other).status_code,403)
                row.snapshot_url='/uploads/../private.png';self.db.commit()
                self.assertEqual(self.call('GET',path).status_code,404)


class TemporalPolicyTests(TestCase):
    def test_unconfigured_temporal_values_disabled_and_real_duration_confidence_respected(self):
        context=AdapterContext(uuid4(),uuid4(),uuid4());policy=TemporalPolicy()
        config=ModelConfig(source='GAZE',label='Test only',enabled=True,label_map={'away':'gaze_away'},policies={'gaze_away':{}})
        start=datetime.now(timezone.utc)
        prediction=lambda ms,**kwargs:RawPrediction(label='away',occurred_at=start+timedelta(milliseconds=ms),**kwargs)
        self.assertEqual(policy.normalize(context,'fixture',config,[prediction(0)]),[])
        config.policies['gaze_away']=config.policies['gaze_away'].model_copy(update={
            'minimum_duration_ms':1000,'maximum_gap_ms':600,'cooldown_ms':2000,'confidence_threshold':.8})
        self.assertEqual(policy.normalize(context,'fixture',config,[prediction(0,confidence=.9)]),[])
        self.assertEqual(policy.normalize(context,'fixture',config,[prediction(500,confidence=.9)]),[])
        emitted=policy.normalize(context,'fixture',config,[prediction(1000,confidence=.9)])
        self.assertEqual(len(emitted),1);self.assertEqual(emitted[0].confidence,.9)
        self.assertEqual(policy.normalize(context,'fixture',config,[prediction(1100,confidence=.9)]),[])
        self.assertEqual(policy.normalize(context,'fixture',config,[prediction(1200,confidence=.2)]),[])
        self.assertEqual(policy.normalize(context,'fixture',config,[prediction(1500,confidence=.9)]),[])
