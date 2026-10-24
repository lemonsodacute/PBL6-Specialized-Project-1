"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <html lang="vi"><body><main className="route-error" role="alert"><div className="route-error-card"><p className="eyebrow">Hệ thống</p><h1>Ứng dụng cần được tải lại</h1><p>Đã xảy ra lỗi ngoài dự kiến.</p><button className="ui-button ui-button-warning ui-button-md" onClick={() => reset()}>Tải lại</button></div></main></body></html>;
}
