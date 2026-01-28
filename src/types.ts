
export interface Event {
  id: string;
  date: string;
  title: string;
  memo?: string;
  startTime?: string;
  endTime?: string;
  color: string;
  calendarUrl?: string;
  caldavUid?: string;
  source?: 'manual' | 'caldav';
  isLocal?: boolean;
}

export interface Routine {
  id: string;
  name: string;
  icon: string;
  color: string;
  days: number[]; // 0=월, 1=화, 2=수, 3=목, 4=금, 5=토, 6=일
  createdAt?: string;
}

export interface RoutineCompletion {
  routineId: string;
  date: string;
  completed: boolean;
}

export interface Todo {
  id: string;
  weekStart: string; // 주의 시작 날짜
  text: string;
  completed: boolean;
}

export interface DiaryEntry {
  date: string;
  title: string;
  content: string;
  updatedAt?: string;
}

export interface DayDefinition {
  id: string;
  date: string;
  text: string;
}

export type WeekOrder = 'mon' | 'sun';
