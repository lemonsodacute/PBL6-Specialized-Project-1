r"""Add a connected academic semester using existing accounts only.

Run from backend: .venv\Scripts\python.exe -m scripts.seed_realistic_demo_data [--dry-run]
No external notifications, AI calls, provider sessions or recordings are created.
"""
import argparse
from collections import Counter
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import hashlib
import json
from pathlib import Path
import sys
from uuid import NAMESPACE_URL, uuid5

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from sqlalchemy import func, select, text
from app.core.database import SessionLocal, engine
from app.models.entities import (Answer, AttendanceStatus, Class, ClassAttendance, ClassEnrollment, Exam,
    ExamAssignment, ExamAttempt, ExamQuestion, ExamStatus, LiveClass, LiveClassStatus, Notification,
    NotificationType, Question, QuestionBank, QuestionDifficulty, QuestionType, User, UserRole, AttemptStatus)
from app.services.grading import grade_attempt
from scripts.academic_demo_catalog import CATALOG, CLASSES

NAMESPACE = 'realistic-academic-demo-v1'
SEMESTER = 'Học kỳ 1 - 2026/2027'


def key(value):
    return uuid5(NAMESPACE_URL, NAMESPACE + ':' + value)


def fingerprint(db, table):
    rows = db.execute(select(table).order_by(table.c.id)).mappings().all()
    def stable(value):
        if isinstance(value,(bytes,bytearray,memoryview)):return bytes(value).hex()
        return str(value)
    return hashlib.sha256(json.dumps([dict(row) for row in rows], sort_keys=True, default=stable).encode()).hexdigest()


def populate(db, anchor):
    counts = Counter(); inventory = {}; owned = {}; members = {}; exam_records = {}; attempt_records = {}
    # Read-only account reuse: this module never constructs or mutates a User.
    users = list(db.scalars(select(User).order_by(User.created_at, User.id)))
    teachers = [user for user in users if user.role == UserRole.teacher and user.is_active]
    students = [user for user in users if user.role == UserRole.student and user.is_active]
    if not teachers or not students: raise RuntimeError('At least one existing active Teacher and Student are required. No accounts were created.')

    def ensure(model, identifier, **values):
        inventory.setdefault(model.__tablename__,set()).add(identifier)
        row = db.get(model, identifier)
        if row is None:
            row = model(id=identifier, **values); db.add(row); db.flush(); counts[model.__tablename__] += 1
        return row

    # Reuse the initial anchor on every rerun, preserving historical dates.
    existing = db.get(Exam, key('exam:web-1:past'))
    if existing:
        anchor = datetime.fromisoformat(existing.extra_settings_json['seed_anchor'])
    local = anchor.astimezone(timezone(timedelta(hours=7)))
    day = local.replace(hour=9, minute=0, second=0, microsecond=0)
    groups = {}
    for index, (slug, subject, title) in enumerate(CLASSES):
        teacher = teachers[index % len(teachers)]
        course_name=f'{title} · HK1 2026/2027'
        duplicate=db.scalar(select(Class.id).where(Class.name==course_name,Class.homeroom_teacher_id==teacher.id,Class.id!=key('class:'+slug)))
        if duplicate:raise RuntimeError('An existing semester class has the same name and owner; no duplicate was created.')
        cls = ensure(Class, key('class:' + slug), name=course_name, homeroom_teacher_id=teacher.id,
            description=f'{SEMESTER}. Học phần {title.split(" - ")[0]}, kết hợp kiến thức nền tảng, bài tập thực hành và đánh giá theo tiến độ.')
        teacher=db.get(User,cls.homeroom_teacher_id)
        if not teacher or teacher not in teachers:raise RuntimeError('A seed class owner is no longer an active existing Teacher.')
        owned[slug] = teacher; groups[slug] = cls; members[slug] = []
    for index, student in enumerate(students):
        cohort = 'web-1' if index % 2 == 0 else 'web-2'
        electives = ('network', 'security', 'ai', 'python')
        for slug in (cohort, 'database', 'software', electives[index % len(electives)]):
            cls = groups[slug]
            ensure(ClassEnrollment, key(f'member:{slug}:{student.id}'), class_id=cls.id, student_id=student.id)
            members[slug].append(student)
    banks = {}; questions = {}
    for slug, subject, _ in CLASSES:
        teacher = owned[slug]; owner_scope = f'{subject}:{teacher.id}'
        if owner_scope in banks: continue
        banks[owner_scope] = []; questions[owner_scope] = []
        for bank_index, (name, lines) in enumerate(CATALOG[subject]):
            bank = ensure(QuestionBank, key(f'bank:{owner_scope}:{bank_index}'), name=name, subject=groups[slug].name.split(' - ')[0],
                description=f'{SEMESTER}. Câu hỏi ôn tập và đánh giá {name.lower()}.', created_by=teacher.id, is_active=True)
            banks[owner_scope].append(bank)
            for index, line in enumerate(lines.strip().splitlines()):
                parts = line.split('|'); prompt, correct = parts[:2]; essay = len(parts) == 2
                if len(parts) not in (2,4): raise ValueError(f'Invalid curriculum entry in {name}')
                option_rows = [{'id': chr(97+i), 'text': value} for i,value in enumerate(parts[1:])]
                if not essay:
                    offset = index % len(option_rows); option_rows = option_rows[offset:] + option_rows[:offset]
                question = ensure(Question, key(f'question:{owner_scope}:{bank_index}:{index}'), question_bank_id=bank.id,
                    type=QuestionType.essay if essay else QuestionType.mcq_single, content=prompt, default_points=Decimal('.5'),
                    topic=name, difficulty=(QuestionDifficulty.easy,QuestionDifficulty.medium,QuestionDifficulty.hard)[min(2,index//3)],
                    options_json=None if essay else {'options':option_rows},
                    correct_answer_json=None if essay else {'correct_option_id':'a'},
                    explanation=correct if essay else f'Đáp án đúng: {correct}.', is_active=True)
                questions[owner_scope].append(question)
    # Both Web groups have all three states; every existing Student sees them.
    plan = [(slug,state) for slug in ('web-1','web-2') for state in ('past','current','upcoming')]
    plan += [('database','past'),('database','upcoming'),('network','current'),('security','upcoming'),('software','past'),('python','current')]
    for number,(slug,state) in enumerate(plan):
        teacher=owned[slug];subject=next(subject for code,subject,_ in CLASSES if code==slug)
        if state=='past': start=day-timedelta(days=14-number%3); end=start+timedelta(days=1,hours=9)
        elif state=='current': start=anchor-timedelta(hours=3); end=day+timedelta(days=3,hours=12)
        else: start=day+timedelta(days=2+number%5); end=start+timedelta(days=2,hours=9)
        label={'past':'Kiểm tra giữa kỳ','current':'Bài kiểm tra ôn tập','upcoming':'Đánh giá cuối chương'}[state]
        title=f'{label} {groups[slug].name.split(" - ")[0]}'
        if slug.startswith('web-'): title+=f' - Nhóm {slug[-1]}'
        exam=ensure(Exam,key(f'exam:{slug}:{state}'),title=title,description=f'{SEMESTER}. Nội dung bám sát hai chủ đề đã học; điểm tối đa 10.',
            created_by=teacher.id,start_time=start,end_time=end,duration_minutes=45 if state=='past' else 60,
            status=ExamStatus.closed if state=='past' else ExamStatus.published,require_camera=state!='current',require_mic=state=='upcoming',
            require_fullscreen=state!='current',allow_review=True,max_attempts=1,shuffle_questions=True,shuffle_options=True,
            passing_score=Decimal('5'),extra_settings_json={'seed_namespace':NAMESPACE,'seed_anchor':anchor.isoformat(),'show_answers':True})
        ensure(ExamAssignment,key(f'assignment:{slug}:{state}'),exam_id=exam.id,class_id=groups[slug].id)
        selected=questions[f'{subject}:{teacher.id}'];links=[]
        for index,question in enumerate(selected):
            links.append(ensure(ExamQuestion,key(f'link:{exam.id}:{question.id}'),exam_id=exam.id,question_id=question.id,order_index=index,points=Decimal('.5')))
        exam_records[(slug,state)]=exam
        if state!='past': continue
        for index,student in enumerate(members[slug]):
            identifier=key(f'attempt:{exam.id}:{student.id}')
            inventory.setdefault('exam_attempts',set()).add(identifier)
            inventory.setdefault('answers',set()).update(key(f'answer:{identifier}:{question.id}') for question in selected)
            attempt=db.get(ExamAttempt,identifier)
            if attempt is None:
                began=exam.start_time+timedelta(hours=1,minutes=index%10)
                deadline=began+timedelta(minutes=exam.duration_minutes)
                automatic=index%5==0
                attempt=ensure(ExamAttempt,identifier,exam_id=exam.id,student_id=student.id,attempt_number=1,
                    started_at=began,server_deadline_at=deadline,submitted_at=deadline if automatic else began+timedelta(minutes=30+index%10),
                    status=AttemptStatus.auto_submitted if automatic else AttemptStatus.submitted,violation_count=0,
                    user_agent=NAMESPACE,question_order_json={'question_ids':[str(q.id) for q in selected],'option_orders':{}})
                # 7–14 of 16 objective answers correct plus four guided essays:
                # 5.5–9.0/10. Use the existing grader rather than invent a score.
                correct_objectives=7+(index+number)%8; objective_index=0
                for question in selected:
                    essay=question.type==QuestionType.essay
                    if essay:
                        content={'text':question.explanation};manual=Decimal('.5')
                    else:
                        content={'selected_option_id':'a' if objective_index<correct_objectives else 'b'};manual=None;objective_index+=1
                    ensure(Answer,key(f'answer:{attempt.id}:{question.id}'),attempt_id=attempt.id,question_id=question.id,answer_content=content,
                        points_awarded=manual,graded_by=teacher.id if essay else None,graded_at=attempt.submitted_at if essay else None,answered_at=attempt.submitted_at)
                grade_attempt(db,attempt);db.flush()
            attempt_records.setdefault(student.id,attempt)
    for slug,cls in groups.items():
        teacher=owned[slug]
        for phase in ('past','upcoming'):
            start=day+timedelta(days=-3 if phase=='past' else 2,hours=9)
            lesson=ensure(LiveClass,key(f'live:{slug}:{phase}'),class_id=cls.id,teacher_id=teacher.id,
                title=f'{"Chữa bài giữa kỳ" if phase=="past" else "Ôn tập và giải đáp"} {cls.name.split(" - ")[0]}',
                description=f'{SEMESTER}. Trao đổi bài tập và củng cố kiến thức học phần.',scheduled_start=start,scheduled_end=start+timedelta(hours=1),
                actual_start=start if phase=='past' else None,actual_end=start+timedelta(hours=1) if phase=='past' else None,
                status=LiveClassStatus.ended if phase=='past' else LiveClassStatus.scheduled,classroom_state={})
            if phase=='past':
                for index,student in enumerate(members[slug]):
                    late=index%4==1;absent=index%7==6
                    joined=lesson.actual_start+timedelta(minutes=10 if late else 0)
                    left=lesson.actual_end-timedelta(minutes=12 if index%4==2 else 0)
                    ensure(ClassAttendance,key(f'attendance:{lesson.id}:{student.id}'),live_class_id=lesson.id,student_id=student.id,
                        joined_at=None if absent else joined,left_at=None if absent else left,active_since=None,
                        duration_sec=0 if absent else int((left-joined).total_seconds()),
                        status=AttendanceStatus.absent if absent else AttendanceStatus.late if late else AttendanceStatus.present)
        if slug.startswith('web-'):
            ensure(LiveClass,key(f'live:{slug}:due'),class_id=cls.id,teacher_id=teacher.id,title='Ôn tập REST API trước kỳ thi',
                description=f'{SEMESTER}. Đang đến giờ học; giảng viên bắt đầu phòng học khi sẵn sàng.',
                scheduled_start=anchor-timedelta(minutes=5),scheduled_end=anchor+timedelta(minutes=55),status=LiveClassStatus.scheduled,classroom_state={})
    for student in students:
        slug=next(code for code in ('web-1','web-2') if student in members[code]);exam=exam_records[(slug,'upcoming')]
        ensure(Notification,key(f'notice:upcoming:{student.id}'),recipient_user_id=student.id,type=NotificationType.exam_summary,
            title='Lịch đánh giá cuối chương đã được công bố',message=f'{exam.title} mở từ {exam.start_time.astimezone(timezone(timedelta(hours=7))):%d/%m/%Y %H:%M}.',related_exam_id=exam.id,is_read=False)
        attempt=attempt_records.get(student.id)
        if attempt:
            ensure(Notification,key(f'notice:result:{student.id}'),recipient_user_id=student.id,type=NotificationType.exam_summary,
                title='Điểm bài kiểm tra giữa kỳ đã được công bố',message=f'Bạn có thể xem kết quả và phần nhận xét trong lịch sử làm bài ({SEMESTER}).',
                related_exam_id=attempt.exam_id,related_attempt_id=attempt.id,is_read=False)
    for teacher in teachers:
        ensure(Notification,key(f'notice:teaching:{teacher.id}'),recipient_user_id=teacher.id,type=NotificationType.classroom_activity,
            title='Lịch ôn tập học phần sắp diễn ra',message=f'Kiểm tra các buổi học đã lên lịch trong {SEMESTER}.',is_read=False)
    # Validate seed-owned relations and scores without changing existing attempts.
    for (slug,state),exam in exam_records.items():
        if not exam.start_time < exam.end_time: raise RuntimeError('Invalid exam availability window')
        links=list(db.scalars(select(ExamQuestion).where(ExamQuestion.exam_id==exam.id)))
        if len(links)!=20 or sum(link.points for link in links)!=Decimal('10'):raise RuntimeError('Invalid exam question mapping')
        if state=='past':
            for attempt in db.scalars(select(ExamAttempt).where(ExamAttempt.exam_id==exam.id)):
                if attempt.student_id not in {student.id for student in members[slug]}:raise RuntimeError('Attempt without class membership')
                awarded=db.scalar(select(func.sum(Answer.points_awarded)).where(Answer.attempt_id==attempt.id)) or Decimal('0')
                if awarded!=attempt.score or attempt.max_score!=Decimal('10') or not 0<=attempt.score<=attempt.max_score:raise RuntimeError('Inconsistent historical score')
                if not exam.start_time<=attempt.started_at<=attempt.submitted_at<=attempt.server_deadline_at<=exam.end_time:raise RuntimeError('Invalid attempt timestamps')
    return counts,{'reused_teachers':len(teachers),'reused_students':len(students),'existing_admins':sum(u.role==UserRole.admin for u in users),
        'inventory':{table:len(ids) for table,ids in sorted(inventory.items())},'exams_by_state':{'past':4,'current':4,'upcoming':4},
        'ongoing_provider_rooms_created':0,'recordings_created':0,'production_ai_events_created':0},anchor


def run(dry_run=False):
    if engine.dialect.name!='postgresql': raise RuntimeError('This seed targets the configured PostgreSQL database only.')
    with SessionLocal() as db:
        try:
            db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:namespace))"),{'namespace':NAMESPACE})
            # Fingerprints cover every account column and all stored identity/card references.
            protected=[table for name,table in User.metadata.tables.items() if name=='users' or 'face_reference' in name or 'student_card_reference' in name]
            before={table.name:fingerprint(db,table) for table in protected}
            count_before=db.scalar(select(func.count()).select_from(User))
            counts,reused,anchor=populate(db,datetime.now(timezone.utc))
            count_after=db.scalar(select(func.count()).select_from(User))
            if count_after!=count_before or any(fingerprint(db,table)!=before[table.name] for table in protected):
                raise RuntimeError('Account or identity preservation assertion failed; transaction rolled back.')
            # Database FK/check/unique constraints are enforced by flush and commit.
            db.flush()
            result={'namespace':NAMESPACE,'semester':SEMESTER,'anchor':anchor.isoformat(),'dry_run':dry_run,
                'USER_COUNT_BEFORE':count_before,'USER_COUNT_AFTER':count_after,'NEW_ACCOUNTS_CREATED':0,
                'identity_changed':False,**reused,'created':dict(sorted(counts.items()))}
            if dry_run: db.rollback()
            else: db.commit()
            print(json.dumps(result,ensure_ascii=False,indent=2))
            return result
        except BaseException:
            db.rollback();raise


if __name__=='__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--dry-run',action='store_true')
    run(parser.parse_args().dry_run)
