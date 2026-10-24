# Tài khoản dev

> Chỉ dùng cho môi trường local/demo. Không dùng các mật khẩu này trên production.

Mật khẩu chung:

```text
Password123!
```

## Admin

```text
Email: admin@example.com
Password: Password123!
Role: admin
```

## Giáo viên

```text
teacher1@example.com
teacher2@example.com
```

Mật khẩu cả hai tài khoản: `Password123!`

## Sinh viên

```text
student1@example.com
student2@example.com
student3@example.com
student4@example.com
student5@example.com
student6@example.com
student7@example.com
student8@example.com
```

Mật khẩu tất cả tài khoản: `Password123!`

# Terminal 1 — Backend
cd "D:\ChauAnh\PBL6 new\backend"
$env:PYTHONPATH="."
.\.venv\Scripts\Activate.ps1
uvicorn app.main:app --reload --port 8000
# Terminal 2 — Frontend
cd "D:\ChauAnh\PBL6 new"
npm.cmd run dev

Frontend: http://localhost:3000
Backend:  http://localhost:8000/docs
