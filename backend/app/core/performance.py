"""Development-only timings. Never record SQL, query strings, bodies or identity data."""
from contextvars import ContextVar
from dataclasses import dataclass, field
import logging
import json
from time import perf_counter, time_ns

from sqlalchemy import event

logger = logging.getLogger('app.performance')


@dataclass
class RequestTiming:
    started: float = field(default_factory=perf_counter)
    query_ms: list[float] = field(default_factory=list)
    query_offsets: list[tuple[float, float]] = field(default_factory=list)


current_timing: ContextVar[RequestTiming | None] = ContextVar('request_timing', default=None)


def install_query_timing(engine):
    if getattr(engine, '_development_timing_installed', False):
        return
    engine._development_timing_installed = True

    @event.listens_for(engine, 'before_cursor_execute')
    def before_execute(_connection, _cursor, _statement, _parameters, context, _many):
        if current_timing.get() is not None:
            context._development_query_start = perf_counter()

    @event.listens_for(engine, 'after_cursor_execute')
    def after_execute(_connection, _cursor, _statement, _parameters, context, _many):
        timing = current_timing.get()
        started = getattr(context, '_development_query_start', None)
        if timing is not None and started is not None:
            timing.query_ms.append((perf_counter() - started) * 1000)
            timing.query_offsets.append(((started - timing.started) * 1000, (perf_counter() - timing.started) * 1000))


def install_request_timing(app, engine, *, enabled: bool):
    if not enabled:
        return
    install_query_timing(engine)

    @app.middleware('http')
    async def development_timing(request, call_next):
        timing = RequestTiming()
        received_epoch_ms = time_ns() / 1_000_000
        token = current_timing.set(timing)
        started = timing.started
        try:
            response = await call_next(request)
            total_ms = (perf_counter() - started) * 1000
            db_ms = sum(timing.query_ms)
            response.headers['Server-Timing'] = f'app;dur={total_ms:.2f}, db;dur={db_ms:.2f};desc="{len(timing.query_ms)} queries"'
            response.headers['X-Development-Timing'] = json.dumps({
                'receive_epoch_ms': round(received_epoch_ms, 2),
                'db_first_ms': round(min((row[0] for row in timing.query_offsets), default=0), 2),
                'db_last_ms': round(max((row[1] for row in timing.query_offsets), default=0), 2),
                'non_db_ms': round(max(0, total_ms - db_ms), 2),
            }, separators=(',', ':'))
            if total_ms > 500:
                route = request.scope.get('route')
                path = getattr(route, 'path', '/unmatched')
                logger.warning('slow_request method=%s path=%s status=%s total_ms=%.2f db_ms=%.2f queries=%s max_query_ms=%.2f non_db_ms=%.2f',
                               request.method, path, response.status_code, total_ms, db_ms,
                               len(timing.query_ms), max(timing.query_ms, default=0), max(0, total_ms - db_ms))
            return response
        finally:
            current_timing.reset(token)
