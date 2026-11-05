import { ClassCollectionList, type ClassCollectionListProps } from './ClassCollectionList';

export function TeacherClassList(props: ClassCollectionListProps) {
  return <ClassCollectionList {...props} audience="teacher" />;
}
