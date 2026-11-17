# Troubleshooting [API unavailable] on Teacher Dashboard (Next.js 15)

The teacher analytics request is GET /api/v1/teacher/reports. The frontend uses the public NEXT_PUBLIC_API_URL (default http://localhost:8000). A browser fetch TypeError is a **transport failure** (Backend stopped, port wrong, CORS, mixed content, or networking), not evidence of an AI statistics/database calculation error. The UI must keep showing an inline retryable failure; do not synthesize real analytics data.

## Windows / PowerShell

1. Start PostgreSQL and the application's Backend in a separate terminal:

    cd "D:\ChauAnh\PBL6 new\backend"
    .\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

2. In a browser open http://localhost:8000/api/v1/health. A JSON response (status ok or degraded) means FastAPI is responding; if unavailable, inspect the Backend terminal, PostgreSQL and port 8000 first.

3. From project root start Next.js in another terminal:

    cd "D:\ChauAnh\PBL6 new"
    $env:NEXT_PUBLIC_API_URL="http://localhost:8000"
    npm run dev

4. Confirm the browser address (localhost vs 127.0.0.1) matches Backend CORS_ORIGINS. The code default and the *example* now list both local port-3000 origins. If backend/.env already defines CORS_ORIGINS, that existing file overrides the default: add the actual frontend origin there and restart FastAPI. If Next uses port 3001, explicitly add that origin too.

5. After editing NEXT_PUBLIC_API_URL restart Next.js: public environment variables are built into its browser bundle. In DevTools Network, look for /api/v1/teacher/reports and its HTTP status or blocked/failed reason. An HTTP 401 means the browser reached Backend but needs a new login; do not solve it by disabling auth.

## Code behavior

- lib/api.ts normalizes a network TypeError as ApiError(status=0, code=NETWORK_ERROR) and timeouts as ApiError(status=408, code=API_TIMEOUT). Expected offline conditions log a development warning instead of console.error so Next.js does not open a console-error overlay.
- lib/teacher-reports.ts shows a helpful error for these conditions; the existing Retry button reloads real data after Backend becomes available.
- The backend default and .env.example permit both localhost:3000 and 127.0.0.1:3000 for local development. No wildcard CORS and no authentication bypass.
- Tests simulate a blocked request, assert inline guidance without the old console error, then restore the connection and retry.

This patch cannot make a stopped local Backend run automatically. Never hide an actual connectivity failure by replacing it with fabricated chart values.
