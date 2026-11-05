import { borderProps } from '@/components/ui/Border';
import {
  ArrowRight, BookOpen, Check, ClipboardCheck, FileText,
  GraduationCap, Layers3, LibraryBig, MessageCircle,
  Monitor, ScanFace, ScrollText, ShieldCheck, Users, Video, BarChart3,
} from 'lucide-react';
import { PublicHero } from './PublicHero';
import { PublicHomeMotion } from './PublicHomeMotion';
import { PublicBrand } from './PublicBrand';
import { PublicHeader } from './PublicHeader';
import { PublicSessionRedirect } from './PublicSessionRedirect';
import styles from './PublicHome.module.css';
import { publicTypography } from './typography';
import { publicHomeSessionBootstrap } from '@/lib/public-home-navigation';

const register = '/login?mode=register';
const features = [
  { icon: ClipboardCheck, borderRole: 'exams' as const, title: 'Thi trực tuyến', description: 'Tạo, giao và tham gia bài thi trong thời gian được quy định.' },
  { icon: ScanFace, borderRole: 'users' as const, title: 'Xác minh danh tính', description: 'Kiểm tra thẻ sinh viên và khuôn mặt trước những kỳ thi có yêu cầu.' },
  { icon: Monitor, borderRole: 'warning' as const, title: 'Giám sát thi', description: 'Theo dõi phiên thi và xem lại các sự kiện được ghi nhận trong quá trình làm bài.' },
  { icon: LibraryBig, borderRole: 'exams' as const, title: 'Ngân hàng câu hỏi', description: 'Quản lý câu hỏi theo ngân hàng và tạo câu hỏi từ tài liệu để rà soát, sử dụng.' },
  { icon: Video, borderRole: 'classes' as const, title: 'Lớp học trực tuyến', description: 'Quản lý lớp học phần, lên lịch và tổ chức các buổi học trực tuyến.' },
  { icon: BarChart3, borderRole: 'success' as const, title: 'Kết quả & báo cáo', description: 'Xem lịch sử làm bài, chấm điểm và theo dõi báo cáo theo quyền truy cập.' },
];
const roles = [
  { icon: GraduationCap, title: 'Sinh viên', description: 'Chủ động theo dõi việc học và các kỳ thi.', items: ['Xem lịch học, lịch thi', 'Tham gia bài kiểm tra', 'Xác minh danh tính', 'Theo dõi kết quả'] },
  { icon: BookOpen, title: 'Giảng viên', description: 'Chuẩn bị, tổ chức và đánh giá bài thi.', items: ['Quản lý lớp học', 'Xây dựng ngân hàng câu hỏi', 'Tạo và giao đề thi', 'Giám sát, chấm điểm'] },
  { icon: Users, title: 'Quản trị viên', description: 'Quản lý vận hành trong một không gian riêng.', items: ['Quản lý người dùng và lớp', 'Xác minh hồ sơ sinh viên', 'Theo dõi báo cáo', 'Tra cứu nhật ký hệ thống'] },
];
const steps = [
  { title: 'Truy cập hệ thống', description: 'Đăng nhập bằng tài khoản được cấp hoặc đăng ký tài khoản mới.' },
  { title: 'Kết nối lớp học', description: 'Tham gia hoặc quản lý lớp học theo vai trò của bạn.' },
  { title: 'Tổ chức và làm bài', description: 'Tạo hoặc tham gia kỳ thi. Hoàn tất xác minh, kiểm tra thiết bị khi được yêu cầu.' },
  { title: 'Theo dõi kết quả', description: 'Xem bài đã nộp, điểm số và báo cáo sau kỳ thi.' },
];

export function LandingPage() {
  return <>
    {/* Hide the public page before paint only while an existing session is restored. */}
    <script dangerouslySetInnerHTML={{ __html: publicHomeSessionBootstrap }} />
    <PublicSessionRedirect />
    <div className={styles.sessionNotice} role="status">Đang mở không gian làm việc…</div>
    <PublicHomeMotion className={`${styles.page} ${styles.theme} ${publicTypography}`}>
      <a href="#noi-dung" className={styles.skipLink}>Đến nội dung chính</a>
      <PublicHeader />
      <main id="noi-dung" tabIndex={-1}>
        <PublicHero>
          <div className={styles.heroCopy}>
            <h1 id="hero-title">Giám thị AI<br /><span className={styles.heroEmphasis}>không bao giờ</span><br />chớp mắt.</h1>
            <p className={styles.heroDescription}>ProctoOwl hỗ trợ xác minh danh tính, giám sát khi thí sinh làm bài và ghi nhận sự kiện, giúp giảng viên xem lại thông tin trước khi đưa ra quyết định.</p>
            <div className={styles.heroActions}>
              <a href={register} className={`${styles.button} ${styles.primaryButton}`}>Bắt đầu ngay<ArrowRight size={18} aria-hidden="true" /></a>
              <a href="/login" className={`${styles.button} ${styles.secondaryButton}`}>Đăng nhập</a>
            </div>
            <p className={styles.heroTrust}><ShieldCheck size={18} aria-hidden="true" /><span>AI chỉ gợi ý. Giảng viên là người xem xét và đưa ra quyết định cuối cùng.</span></p>
          </div>
        </PublicHero>

        <section id="tinh-nang" aria-labelledby="features-title" className={`${styles.container} ${styles.section}`}>
          <div className={styles.sectionHeading}><p className={styles.eyebrow}>TỪ CHUẨN BỊ ĐẾN HOÀN THÀNH</p><h2 id="features-title">Một nền tảng cho toàn bộ quá trình thi</h2><p>Mỗi công việc một không gian rõ ràng. Bạn chỉ cần tập trung vào việc học và giảng dạy.</p></div>
          <div className={styles.featureGrid}>{features.map(({ icon: Icon, title, description, borderRole }) => <article className={styles.feature} key={title} {...borderProps(borderRole)}>
            <Icon size={24} strokeWidth={1.7} aria-hidden="true" /><h3>{title}</h3><p>{description}</p>
          </article>)}</div>
        </section>

        <section className={styles.rolesSection} aria-labelledby="roles-title">
          <div className={`${styles.container} ${styles.section}`}>
            <div className={styles.sectionHeading}><p className={styles.eyebrow}>KHÔNG GIAN LÀM VIỆC PHÙ HỢP</p><h2 id="roles-title">Dành cho mọi vai trò</h2><p>Cùng một hệ thống, với công cụ phù hợp cho từng người.</p></div>
            <div className={styles.rolesGrid}>{roles.map(({ icon: Icon, title, description, items }) => <article className={styles.role} key={title}>
              <Icon size={28} strokeWidth={1.6} aria-hidden="true" /><h3>{title}</h3><p>{description}</p><ul>{items.map(item => <li key={item}><Check size={16} aria-hidden="true" />{item}</li>)}</ul>
            </article>)}</div>
          </div>
        </section>

        <section id="cach-hoat-dong" aria-labelledby="how-title" className={`${styles.container} ${styles.section}`}>
          <div className={styles.sectionHeading}><p className={styles.eyebrow}>BẮT ĐẦU TỪ NHỮNG BƯỚC ĐƠN GIẢN</p><h2 id="how-title">Cách hoạt động</h2></div>
          <ol className={styles.steps}>{steps.map((step, index) => <li key={step.title}><span className={styles.stepNumber}>0{index + 1}</span><h3>{step.title}</h3><p>{step.description}</p></li>)}</ol>
        </section>

        <section className={`${styles.container} ${styles.aiSection}`} aria-labelledby="ai-title">
          <div className={styles.aiIntro}><span className={styles.iconTile}><Layers3 size={25} strokeWidth={1.6} aria-hidden="true" /></span><h2 id="ai-title">AI hỗ trợ đúng lúc</h2><p>Hỗ trợ chuẩn bị nội dung và sử dụng hệ thống, để giảng viên và người học tập trung vào công việc chính.</p><p className={styles.aiNote}>AI là công cụ hỗ trợ. Việc xem xét và quyết định cuối cùng thuộc giảng viên hoặc quản trị viên.</p></div>
          <div className={styles.aiFeatures}>
            <article><FileText size={21} aria-hidden="true" /><div><h3>Tạo câu hỏi từ tài liệu</h3><p>Chuẩn bị câu hỏi từ nội dung tài liệu, sau đó rà soát và chỉnh sửa trước khi sử dụng.</p></div></article>
            <article><MessageCircle size={21} aria-hidden="true" /><div><h3>Hỗ trợ trong quá trình sử dụng</h3><p>AI Support giúp tìm hướng dẫn về các chức năng trong hệ thống sau khi đăng nhập.</p></div></article>
            <article><ScanFace size={21} aria-hidden="true" /><div><h3>Hỗ trợ xác minh và giám sát</h3><p>Các module hỗ trợ kiểm tra danh tính và ghi nhận sự kiện trong phiên thi.</p></div></article>
          </div>
        </section>

        <section aria-labelledby="trust-title" className={`${styles.container} ${styles.section} ${styles.trustSection}`}>
          <div className={styles.sectionHeading}><p className={styles.eyebrow}>VẬN HÀNH CÓ KIỂM SOÁT</p><h2 id="trust-title">An toàn và rõ ràng</h2></div>
          <div className={styles.trustGrid}>
            <article><ShieldCheck size={22} aria-hidden="true" /><h3>Phân quyền theo vai trò</h3><p>Mỗi vai trò có không gian làm việc và quyền truy cập phù hợp.</p></article>
            <article><ScanFace size={22} aria-hidden="true" /><h3>Xác minh trước kỳ thi</h3><p>Kiểm tra hồ sơ, danh tính và thiết bị theo yêu cầu của bài thi.</p></article>
            <article><ScrollText size={22} aria-hidden="true" /><h3>Tra cứu hoạt động</h3><p>Nhật ký giúp người quản trị xem lại các thay đổi trong hệ thống.</p></article>
          </div>
        </section>

        <section id="ho-tro" aria-labelledby="support-title" className={`${styles.container} ${styles.section} ${styles.supportSection}`}>
          <div className={styles.supportIntro}><p className={styles.eyebrow}>GIẢI ĐÁP TRƯỚC KHI BẮT ĐẦU</p><h2 id="support-title">Cần hỗ trợ?</h2><p>Một vài thông tin để bạn chuẩn bị. Hướng dẫn theo vai trò và AI Support có sẵn trong hệ thống sau khi đăng nhập.</p><div className={styles.supportActions}><a href="#huong-dan" className={`${styles.button} ${styles.secondaryButton}`}>Trợ giúp</a><a href="/login" className={`${styles.button} ${styles.primaryButton}`}>Đăng nhập</a></div></div>
          <div id="huong-dan" tabIndex={-1} className={styles.faq}>
            <details><summary>Tôi cần chuẩn bị gì trước kỳ thi?</summary><p>Kiểm tra lịch thi và yêu cầu của đề. Nếu bài thi yêu cầu giám sát, hãy hoàn tất xác minh danh tính và kiểm tra camera, microphone trước khi bắt đầu.</p></details>
            <details><summary>Làm thế nào để có tài khoản giảng viên?</summary><p>Sinh viên có thể dùng chức năng đăng ký. Tài khoản giảng viên do quản trị viên cấp; hãy liên hệ đơn vị quản lý lớp học của bạn.</p></details>
            <details><summary>Tôi gặp vấn đề khi đăng nhập?</summary><p>Chọn “Quên mật khẩu?” tại <a href="/login">trang đăng nhập</a> để bắt đầu khôi phục, hoặc liên hệ quản trị viên để được hỗ trợ tài khoản.</p></details>
          </div>
        </section>

        <section className={`${styles.container} ${styles.finalSection}`} aria-labelledby="start-title">
          <div className={styles.finalCta}><div><h2 id="start-title">Sẵn sàng bắt đầu?</h2><p>Quản lý quá trình học và thi trực tuyến<br className={styles.desktopBreak} /> trong một hệ thống thống nhất.</p></div><div className={styles.finalActions}><a href="/login" className={`${styles.button} ${styles.primaryButton}`}>Đăng nhập<ArrowRight size={18} aria-hidden="true" /></a><a href={register} className={`${styles.button} ${styles.secondaryButton}`}>Tạo tài khoản</a></div></div>
        </section>
      </main>
      <footer className={styles.footer}>
        <div className={`${styles.container} ${styles.footerInner}`}><div><PublicBrand /><p>Hệ thống thi trực tuyến<br />hỗ trợ xác minh và giám sát.</p></div><nav aria-label="Liên kết cuối trang"><a href="#trang-chu">Trang chủ</a><a href="/login">Đăng nhập</a><a href={register}>Đăng ký</a><a href="#ho-tro">Trợ giúp</a></nav><small>© 2026 ProctoOwl</small></div>
      </footer>
    </PublicHomeMotion>
  </>;
}
