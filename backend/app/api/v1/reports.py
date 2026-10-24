import csv
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal
from app.schemas.collections import CollectionParams
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from io import StringIO
from app.core.database import SessionLocal
from sqlalchemy.orm import Session
from app.api.deps import roles
from app.api.responses import ok
from app.core.database import get_db
from app.models.entities import User, UserRole, AttemptStatus, SeverityLevel
from app.services.reports import _report, reports_overview, attempt_report

router = APIRouter()
@router.get('/teacher/reports')
def teacher_reports(exam_id: UUID | None = None,params:CollectionParams=Depends(),status:AttemptStatus|None=None,
                    risk_min:float|None=Query(None,ge=0,le=100),has_risk:bool|None=None,
                    format:Literal['json','csv']='json',
                    db: Session = Depends(get_db), user: User = Depends(roles(UserRole.admin, UserRole.teacher))):
    if format=='csv':
        from app.services.reports import _exam_for_user
        from app.services.report_collections import attempt_projection
        if exam_id:_exam_for_user(exam_id,db,user)
        statement=attempt_projection(db,user,exam_id,params.q,status,risk_min,has_risk)
        def generate():
            stream=StringIO();writer=csv.writer(stream)
            writer.writerow(['Exam','MSSV','Student Name','Status','Attempt Number','Score','Max Score','Percentage','Submitted At','Violation Count','Risk Score'])
            yield '\ufeff'+stream.getvalue();stream.seek(0);stream.truncate(0)
            # Separate read session stays alive for the entire streaming download.
            with SessionLocal() as export_db:
                for row in export_db.execute(statement.execution_options(yield_per=200)).mappings():
                    values=[row[key] for key in ('exam_title','student_code','full_name','status','attempt_number','score','max_score','percentage','submitted_at','violation_count','risk_score')]
                    cells=[]
                    for value in values:
                        if hasattr(value,'value'):value=value.value
                        text='' if value is None else str(value)
                        if text[:1] in ('=','+','-','@','\t','\r'):text="'"+text
                        cells.append(text)
                    writer.writerow(cells);yield stream.getvalue();stream.seek(0);stream.truncate(0)
        return StreamingResponse(generate(),media_type='text/csv',headers={'Content-Disposition':'attachment; filename="teacher-reports.csv"','Cache-Control':'private, no-store'})
    return ok(reports_overview(db, user, exam_id,params,status,risk_min,has_risk))

@router.get('/reports/attempts/{attempt_id}')
def report_detail(attempt_id: UUID, params:CollectionParams=Depends(),severity:SeverityLevel|None=None,source:Literal['browser','detector']|None=None, db: Session = Depends(get_db), user: User = Depends(roles(UserRole.admin, UserRole.teacher))):
    return ok(attempt_report(attempt_id, db, user,params,severity,source))
@router.get('/exams/{exam_id}/report')
def exam_report(exam_id: UUID, params: CollectionParams=Depends(), status: AttemptStatus|None=None, grading: Literal['pending','graded']|None=None, db: Session = Depends(get_db), user: User = Depends(roles(UserRole.admin, UserRole.teacher))): return ok(_report(exam_id, db, user,params,status,grading))

@router.post('/exams/{exam_id}/report/export')
def export_report(exam_id: UUID, format: Literal['csv','xlsx'] = 'xlsx', db: Session = Depends(get_db), user: User = Depends(roles(UserRole.admin, UserRole.teacher))):
    report = _report(exam_id, db, user); folder = Path(__file__).resolve().parents[3] / 'uploads' / 'reports'; folder.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'); filename = f'exam-{exam_id}-{stamp}.{format}'; path = folder / filename
    headers = ['student_code','student_name','student_email','attempt_number','status','score','max_score','rank','violation_count','risk_score','submitted_at']
    def safe_cell(value):
        if isinstance(value, str) and value[:1] in ('=', '+', '-', '@', '\t', '\r'):
            return "'" + value
        return '' if value is None else value
    rows = [[safe_cell(row.get(key)) for key in headers] for row in report['attempts']]
    if format == 'csv':
        with path.open('w', newline='', encoding='utf-8-sig') as stream:
            writer = csv.writer(stream); writer.writerow(headers); writer.writerows(rows)
    else:
        try: from openpyxl import Workbook
        except ImportError as exc: raise HTTPException(503, detail={'code':'EXPORT_DEPENDENCY_MISSING','message':'Install openpyxl to export XLSX','details':None}) from exc
        workbook = Workbook(); sheet = workbook.active; sheet.title = 'Results'; sheet.append(headers)
        for row in rows: sheet.append(row)
        sheet.freeze_panes = 'A2'; sheet.auto_filter.ref = sheet.dimensions; workbook.save(path)
    return ok({'format':format,'filename':filename,'url':f'/uploads/reports/{filename}','statistics':report['statistics']})

@router.get('/reports/exams/{exam_id}')
def legacy_exam_report(exam_id: UUID, params: CollectionParams=Depends(), status: AttemptStatus|None=None, grading: Literal['pending','graded']|None=None, db: Session = Depends(get_db), user: User = Depends(roles(UserRole.admin, UserRole.teacher))): return ok(_report(exam_id, db, user,params,status,grading))
