"""Bound request bodies before multipart/JSON parsing can allocate/spool them."""
from starlette.responses import JSONResponse


class ProctorBodyLimit:
    def __init__(self, app): self.app=app

    async def __call__(self, scope, receive, send):
        path=scope.get('path','')
        if scope['type']!='http' or scope.get('method') not in {'POST','PATCH'} or not path.startswith('/api/v1/proctoring/') or path.endswith('/recording'):
            return await self.app(scope,receive,send)
        limit=1024*1024+65536 if path.endswith('/frame') else 16384
        headers=dict(scope.get('headers',[]))
        length=headers.get(b'content-length',b'0')
        too_large=False
        try: too_large=int(length)>limit
        except ValueError: too_large=True
        chunks=[];size=0
        if not too_large:
            while True:
                message=await receive()
                if message['type']=='http.disconnect': return
                chunk=message.get('body',b'');size+=len(chunk)
                if size>limit: too_large=True;break
                chunks.append(chunk)
                if not message.get('more_body',False): break
        if too_large:
            return await JSONResponse({'error':{'code':'PROCTOR_PAYLOAD_TOO_LARGE','message':'Monitoring payload exceeds the transport limit.','details':None}},status_code=413)(scope,receive,send)
        body=b''.join(chunks);replayed=False
        async def replay():
            nonlocal replayed
            if not replayed:
                replayed=True;return {'type':'http.request','body':body,'more_body':False}
            return await receive()
        await self.app(scope,replay,send)
