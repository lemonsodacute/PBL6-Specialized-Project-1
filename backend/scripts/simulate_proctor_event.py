"""Explicit DEV/test helper; sends through the same authenticated simulator API.

Set PROCTOR_SIMULATOR_TOKEN to an owning teacher/admin access token in this
process environment. The token is never printed or placed in a command URL.
"""
import argparse
import os
import sys
from pathlib import Path
from uuid import UUID, uuid4
import httpx
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from app.services.proctor_events import simulator_enabled


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('attempt_id',type=UUID)
    parser.add_argument('event_type',choices=['multiple_faces','gaze_away'])
    parser.add_argument('--api',default='http://localhost:8000')
    parser.add_argument('--external-id',type=UUID,default=None,help='Reuse to test a retry')
    args=parser.parse_args()
    if not simulator_enabled(): parser.error('Requires development/test and PROCTOR_SIMULATOR_ENABLED=true')
    token=os.environ.get('PROCTOR_SIMULATOR_TOKEN')
    if not token: parser.error('Missing PROCTOR_SIMULATOR_TOKEN')
    try:
        response=httpx.post(args.api.rstrip('/')+'/api/v1/proctoring/dev/simulate',timeout=10,
            headers={'Authorization':'Bearer '+token},json={'attempt_id':str(args.attempt_id),
                'event_type':args.event_type,'external_id':str(args.external_id or uuid4())},follow_redirects=False)
        response.raise_for_status()
        data=response.json()['data']
        print(f"Mô phỏng: event={data['event']['id']} created={data['created']} duplicate={data['duplicate']}")
    except Exception:
        print('Simulator request failed. Check authorization, flags and active attempt.',file=sys.stderr)
        raise SystemExit(1) from None


if __name__=='__main__': main()
