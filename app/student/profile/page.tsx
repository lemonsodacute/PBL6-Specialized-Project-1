'use client';



import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useAuth } from '@/components/auth/AuthContext';
import { Badge, Button, Card, LoadingSkeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { type UserProfile } from '@/lib/profile';
import { ProfileAvatar } from '@/components/profile/ProfileAvatar';
import styles from './profile.module.css';
import { ProfileIdentitySection } from '@/components/student/ProfileIdentitySection';
import { StudentPageHeader } from '@/components/student/StudentPageHeader';
import { PhoneEditor } from '@/components/student/PhoneEditor';

type ProfileClass = { id: string; name: string };
const display = (value?: string | null) => value?.trim() || 'Chưa cập nhật';
const dateLabel = (value?: string | null) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString('vi-VN') : 'Chưa cập nhật';
};

function ProfilePhoto({ profile }: { profile: UserProfile }) {
  return <section className={styles.photoSection} aria-labelledby="profile-photo-heading">
    <h2 id="profile-photo-heading">Ảnh hồ sơ sinh viên</h2>
    <ProfileAvatar user={profile} className={styles.photo} fallbackClassName={styles.placeholder} />
    <p>{profile.avatar_source === 'STUDENT_CARD' ? 'Ảnh đại diện được lấy từ thẻ sinh viên đã xác thực.' : 'Chưa có ảnh hồ sơ'}</p>
  </section>;
}

export default function StudentProfilePage() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [classes, setClasses] = useState<ProfileClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [classesError, setClassesError] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!user) return;
    setProfile(current => current?.id === user.id ? { ...current,
      ...(user.student_code !== undefined ? { student_code: user.student_code } : {}),
      ...(user.class_name !== undefined ? { class_name: user.class_name } : {}),
      ...(user.student_card_status !== undefined ? { student_card_status: user.student_card_status } : {}),
      ...(user.identity_profile_status !== undefined ? { identity_profile_status: user.identity_profile_status } : {}),
      ...(user.avatar_url !== undefined ? { avatar_url: user.avatar_url, avatar_source: user.avatar_source,
        avatar_reference_id: user.avatar_reference_id, avatar_updated_at: user.avatar_updated_at } : {}) } : current);
  }, [user?.id, user?.student_code, user?.class_name, user?.student_card_status, user?.identity_profile_status,
    user?.avatar_url, user?.avatar_source, user?.avatar_reference_id, user?.avatar_updated_at]);

  useEffect(() => {
    if (user?.role !== 'student') return;
    let active = true;
    setLoading(true);
    setProfile(null);
    setError('');
    setClassesError('');
    void Promise.allSettled([api.auth.me(), api.classes.list()]).then(([account, enrolledClasses]) => {
      if (!active) return;
      if (account.status === 'fulfilled' && account.value.user) setProfile(account.value.user);
      else setError('Không tải được hồ sơ sinh viên. Vui lòng kiểm tra kết nối và thử lại.');
      if (enrolledClasses.status === 'fulfilled') {
        setClasses((enrolledClasses.value as { data?: ProfileClass[] }).data ?? []);
      } else {
        setClasses([]);
        setClassesError('Không tải được danh sách lớp học phần.');
      }
      setLoading(false);
    });
    return () => { active = false; };
  }, [user?.id, user?.role, reload]);

  return <div className={`workspace-page ${styles.page}`}><StudentPageHeader title="Hồ sơ sinh viên"/>
    
    {user?.role !== 'student' ? <Card><p>Trang hồ sơ này dành cho sinh viên.</p></Card>
      : loading ? <Card aria-busy="true"><LoadingSkeleton rows={3} /></Card>
      : error ? <Card className={styles.error} role="alert"><h2>Không tải được hồ sơ</h2><p>{error}</p>
        <Button type="button" variant="warning" onClick={() => setReload((value) => value + 1)}>Thử lại</Button></Card>
      : profile && <><Card borderRole="users" className={styles.profileCard}>
        <ProfilePhoto profile={profile} />
        <section className={styles.information} aria-label="Thông tin sinh viên">
          <dl className={styles.summary}>
            <div><dt className={styles.visuallyHidden}>Họ và tên</dt><dd><h2>{display(profile.full_name)}</h2></dd></div>
            <div><dt>Email</dt><dd>{display(profile.email)}</dd></div>
            <div className={styles.cardField}><dt>Mã sinh viên</dt><dd>{display(profile.student_code)}</dd></div>
            <div className={styles.cardField}><dt>Lớp</dt><dd>{display(profile.class_name)}</dd></div>
            <div><dt>Trạng thái tài khoản</dt><dd>{typeof profile.is_active === 'boolean'
              ? <Badge tone={profile.is_active ? 'success' : 'neutral'}>{profile.is_active ? 'Đang hoạt động' : 'Đã vô hiệu hóa'}</Badge>
              : 'Chưa cập nhật'}</dd></div>
            {profile.student_card_status === 'VERIFIED' && <div><dt className={styles.visuallyHidden}>Thẻ sinh viên</dt><dd><Badge tone="success">Đã xác minh</Badge></dd></div>}
          </dl>
        </section>
      </Card><Card borderRole="users" className={styles.personal}>
        <ProfileIdentitySection key={profile.id} verified={profile.identity_profile_status === 'VERIFIED'} />
      </Card><Card borderRole="users" className={styles.personal}>
        <h2>Thông tin cá nhân</h2>
        <dl className={styles.details}>
          <PhoneEditor key={profile.id} phone={profile.phone ?? null} onSaved={phone => setProfile(current => current?.id === profile.id ? { ...current, phone } : current)} />
          <div><dt>Vai trò</dt><dd>Sinh viên</dd></div>
        </dl>
      </Card><div className={styles.sections}>
          <Card borderRole="classes" className={styles.classes}>
            <h2>Thông tin học tập</h2><h3>Lớp học phần</h3>
            {classesError ? <div role="alert"><p>{classesError}</p><Button type="button" variant="warning" onClick={() => setReload((value) => value + 1)}>Tải lại lớp học phần</Button></div>
              : classes.length ? <ul>{classes.map((item) => <li key={item.id}><Link href={`/student/classes/${item.id}`}>{display(item.name)}<span aria-hidden="true"> ↗</span></Link></li>)}</ul>
              : <p>Bạn chưa tham gia lớp học phần nào.</p>}
          </Card>
          <Card borderRole="users" className={styles.account}>
            <h2>Thông tin tài khoản</h2>
            <dl className={styles.details}><div><dt>Ngày tạo tài khoản</dt><dd>{dateLabel(profile.created_at)}</dd></div></dl>
            <p>Liên hệ quản trị viên nếu thông tin hồ sơ cần được cập nhật.</p>
          </Card>
      </div></>}
  </div>;
}
