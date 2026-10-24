"use client";

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="route-error" role="alert"><div className="route-error-card"><p className="eyebrow">Có lỗi xảy ra</p><h1>Không thể tải trang</h1><p>Đã xảy ra lỗi tạm thời. Vui lòng thử tải lại trang.</p><button className="ui-button ui-button-warning ui-button-md" onClick={() => reset()}>Thử lại</button></div></main>;
}
