import { Activity, BookOpen } from 'lucide-react';
import styles from './AISupportPage.module.css';

export function AISupportHeader({ selected }: { selected: 'activity' | 'knowledge' }) {
  const activity = selected === 'activity';
  const Icon = activity ? Activity : BookOpen;
  return <header className={styles.hero}>
    <span className={styles.heroIcon}><Icon size={30} aria-hidden="true" /></span>
    <div><h1>{activity ? 'Hoạt động AI' : 'Kho tri thức'}</h1>
      <p>{activity ? 'Theo dõi tình trạng dịch vụ AI, tạo câu hỏi và hỗ trợ người dùng.' : 'Quản lý bài hướng dẫn hỗ trợ người dùng theo từng vai trò.'}</p>
    </div>
  </header>;
}
