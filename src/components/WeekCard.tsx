import { KeyboardEvent, useEffect, useRef, useState, memo } from 'react';
import { EventItem } from './EventItem';
import { Event, Routine, RoutineCompletion, Todo, WeekOrder } from '../types';
import { RoutineIcon } from './RoutineIcon';
import { TodoList } from './TodoList';
import { Trash2 } from 'lucide-react';
import { useSelection } from '../contexts/SelectionContext';
import styles from './WeekCard.module.css';

interface WeekCardProps {
  weekStart: Date;
  todoWeekStart: string; // Key for todo lookup (may differ from weekStart for sun-start weeks)
  events: Event[];
  routines: Routine[];
  routineCompletions: RoutineCompletion[];
  todos: Todo[];
  dayDefinitions: Record<string, string>;
  weekOrder: WeekOrder;
  onDateClick: (date: string, anchorEl?: HTMLElement) => void;
  onEventDoubleClick: (event: Event, anchorEl?: HTMLElement) => void;
  onDeleteEvent: (eventId: string) => void;
  onToggleRoutine: (routineId: string, date: string) => void;
  onAddTodo: (weekStart: string, text: string) => void;
  onToggleTodo: (todoId: string) => void;
  onUpdateTodo: (todoId: string, text: string) => void;
  onDeleteTodo: (todoId: string) => void;
  onSaveDayDefinition: (date: string, text: string) => void;
  onDeleteDayDefinition: (date: string) => void;
  onOpenDiary: (date: string) => void;
  diaryCompletions: Record<string, boolean>;
  weekStatus: 'current' | 'prev' | 'next' | 'other';
  showRoutines: boolean;
  showTodos: boolean;
}

const DIARY_ROUTINE: Routine = {
  id: 'diary',
  name: '일기쓰기',
  icon: 'NotebookPen',
  color: '#8b5cf6',
  days: [],
};

export const WeekCard = memo(function WeekCard({
  weekStart,
  todoWeekStart,
  events,
  routines,
  routineCompletions,
  todos,
  dayDefinitions,
  weekOrder,
  onDateClick,
  onEventDoubleClick,
  onDeleteEvent,
  onToggleRoutine,
  onAddTodo,
  onToggleTodo,
  onUpdateTodo,
  onDeleteTodo,
  onSaveDayDefinition,
  onDeleteDayDefinition,
  onOpenDiary,
  diaryCompletions,
  weekStatus,
  showRoutines,
  showTodos,
}: WeekCardProps) {
  const { clearSelection, setHoveredDate } = useSelection();
  // Performance Monitoring

  const [draftDefinitions, setDraftDefinitions] = useState<Record<string, string>>({});
  const [activeDefinitionDate, setActiveDefinitionDate] = useState<string | null>(null);
  const dayDefinitionInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    setDraftDefinitions(dayDefinitions);
  }, [dayDefinitions]);

  useEffect(() => {
    if (!activeDefinitionDate) return;
    const target = dayDefinitionInputRefs.current[activeDefinitionDate];
    if (target) {
      target.focus();
      target.select();
    }
  }, [activeDefinitionDate]);

  const days = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(weekStart);
    date.setDate(date.getDate() + i);
    return date;
  });

  const getWeekLabelInfo = () => {
    const getWeekOfMonth = (targetDate: Date) => {
      const year = targetDate.getFullYear();
      const monthIndex = targetDate.getMonth();
      const firstDayOfMonth = new Date(year, monthIndex, 1);
      const firstWeekStart = new Date(firstDayOfMonth);
      const firstDayOfWeek = firstDayOfMonth.getDay();
      const daysToWeekStart = weekOrder === 'sun'
        ? -firstDayOfWeek
        : (firstDayOfWeek === 0 ? -6 : 1 - firstDayOfWeek);
      firstWeekStart.setDate(firstDayOfMonth.getDate() + daysToWeekStart);

      const diffTime = weekStart.getTime() - firstWeekStart.getTime();
      const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
      return Math.floor(diffDays / 7) + 1;
    };

    const monthEntries = new Map<string, Date>();
    days.forEach(date => {
      const key = `${date.getFullYear()}-${date.getMonth()}`;
      if (!monthEntries.has(key)) {
        monthEntries.set(key, date);
      }
    });

    const parts = Array.from(monthEntries.values()).map(date => {
      const month = date.getMonth() + 1;
      const weekOfMonth = getWeekOfMonth(date);
      return `${month}월 ${weekOfMonth}주차`;
    });

    return {
      label: `${parts.join(' / ')}`,
      isMultiMonth: parts.length > 1,
    };
  };

  const isToday = (date: Date) => {
    const today = new Date();
    return date.toDateString() === today.toDateString();
  };

  const getEventsForDate = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`;
    return events.filter(event => event.date === dateStr);
  };

  const getRoutinesForDay = (dayIndex: number) => {
    return routines.filter(routine => routine.days.includes(dayIndex));
  };

  const isRoutineCompleted = (routineId: string, date: string) => {
    const completion = routineCompletions.find(
      rc => rc.routineId === routineId && rc.date === date
    );
    return completion?.completed || false;
  };

  const shouldShowRoutine = (routine: Routine, date: Date) => {
    // 1. Future check
    const checkDate = new Date(date);
    checkDate.setHours(0, 0, 0, 0);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (checkDate > today) return false;

    // 2. Creation check
    if (routine.createdAt) {
      const createdDate = new Date(routine.createdAt);
      createdDate.setHours(0, 0, 0, 0);
      if (checkDate < createdDate) return false;
    }

    return true;
  };



  const getWeekCardClassName = () => {
    if (weekStatus === 'current') {
      return `${styles.weekCard} ${styles.weekCardCurrent}`;
    } else if (weekStatus === 'prev' || weekStatus === 'next') {
      return `${styles.weekCard} ${styles.weekCardPrevNext}`;
    }
    return `${styles.weekCard} ${styles.weekCardOther}`;
  };

  const handleDefinitionSave = (dateKey: string) => {
    const value = (draftDefinitions[dateKey] ?? '').trim();
    setDraftDefinitions(prev => ({ ...prev, [dateKey]: value }));
    onSaveDayDefinition(dateKey, value);
    setActiveDefinitionDate(null);
  };

  const handleDefinitionDelete = (dateKey: string) => {
    onDeleteDayDefinition(dateKey);
    setDraftDefinitions(prev => {
      const next = { ...prev };
      delete next[dateKey];
      return next;
    });
    setActiveDefinitionDate(null);
  };

  const handleDefinitionKeyDown = (event: KeyboardEvent<HTMLInputElement>, dateKey: string) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleDefinitionSave(dateKey);
    }
    if (event.key === 'Escape') {
      setActiveDefinitionDate(null);
    }
  };

  const handleDefinitionClick = (dateKey: string) => {
    setActiveDefinitionDate(dateKey);
  };

  // 주간 고유 ID 생성 (스크롤 복원용)
  const weekId = `${weekStart.getFullYear()}-${String(weekStart.getMonth() + 1).padStart(2, '0')}-${String(weekStart.getDate()).padStart(2, '0')}`;

  return (
    <div className={getWeekCardClassName()} data-week-id={weekId}>
      {/* 7일 그리드 */}
      <div className={styles.weekGrid}>
        {days.map((date, index) => {
          const dayEvents = getEventsForDate(date);
          const routineDayIndex = weekOrder === 'sun' ? (index === 0 ? 6 : index - 1) : index;
          const dayRoutines = getRoutinesForDay(routineDayIndex);
          const year = date.getFullYear();
          const month = String(date.getMonth() + 1).padStart(2, '0');
          const day = String(date.getDate()).padStart(2, '0');
          const dateStr = `${year}-${month}-${day}`;
          const today = isToday(date);
          const dayNames = weekOrder === 'sun'
            ? ['일', '월', '화', '수', '목', '금', '토']
            : ['월', '화', '수', '목', '금', '토', '일'];
          const isWeekend = routineDayIndex === 5 || routineDayIndex === 6;
          const visibleRoutines = dayRoutines.filter(r => shouldShowRoutine(r, date));
          const shouldShowDiaryRoutine = true;
          const dayDefinition = (draftDefinitions[dateStr] ?? dayDefinitions[dateStr] ?? '').trim();
          const isDefinitionHidden = !dayDefinition && activeDefinitionDate !== dateStr;

          return (
            <div
              key={dateStr}
              id={`day-cell-${dateStr}`}
              className={`${styles.dayCell} ${isWeekend ? styles.dayCellWeekend : ''}`}
              onMouseEnter={() => setHoveredDate(dateStr)}
              onMouseLeave={() => setHoveredDate(null)}
            >
              {/* 날짜 헤더 */}
              <div className={styles.dayHeader}>
                <div
                  className={`${styles.dayDefinition} ${activeDefinitionDate === dateStr ? styles.dayDefinitionActive : ''
                    } ${isDefinitionHidden ? styles.dayDefinitionHidden : ''} ${dayDefinition ? styles.dayDefinitionFilled : ''
                    }`}
                  onClick={() => handleDefinitionClick(dateStr)}
                  title={dayDefinition || undefined}
                >
                  {activeDefinitionDate === dateStr ? (
                    <input
                      ref={(el) => {
                        dayDefinitionInputRefs.current[dateStr] = el;
                      }}
                      className={styles.dayDefinitionInput}
                      value={draftDefinitions[dateStr] ?? ''}
                      onChange={(e) => setDraftDefinitions(prev => ({ ...prev, [dateStr]: e.target.value }))}
                      placeholder="하루 정의 입력"
                      onBlur={() => handleDefinitionSave(dateStr)}
                      onKeyDown={(event) => handleDefinitionKeyDown(event, dateStr)}
                    />
                  ) : (
                    <>
                      <span
                        className={`${styles.dayDefinitionText} ${dayDefinition ? '' : styles.dayDefinitionPlaceholder
                          }`}
                      >
                        {dayDefinition || '하루 정의 추가'}
                      </span>
                      {dayDefinition && (
                        <button
                          className={styles.dayDefinitionDelete}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDefinitionDelete(dateStr);
                          }}
                          aria-label="하루 정의 삭제"
                          title="삭제"
                        >
                          <Trash2 className={styles.dayDefinitionDeleteIcon} />
                        </button>
                      )}
                    </>
                  )}
                </div>

                <div className={styles.dayMeta}>
                  <span
                    className={`${styles.dayName} ${isWeekend ? styles.dayNameWeekend : styles.dayNameWeekday
                      }`}
                  >
                    {dayNames[index]}
                  </span>
                  <div
                    className={`${styles.dayNumber} ${today
                      ? styles.dayNumberToday
                      : isWeekend
                        ? styles.dayNumberWeekend
                        : styles.dayNumberWeekday
                      }`}
                  >
                    {date.getDate()}
                  </div>
                </div>
              </div>

              {/* 이벤트 영역 */}
              <div
                id={`day-events-${dateStr}`}
                className={styles.dayEvents}
                onClick={(e) => {
                  // 이벤트 버블링 방지: 자식 요소(일정) 클릭 시에는 무시
                  if (e.target !== e.currentTarget && (e.target as HTMLElement).closest('[data-event-item]')) {
                    return;
                  }
                  clearSelection();
                  // 빈 공간 클릭 동작 (필요 시 선택 해제 로직 등 추가 가능)
                }}
                onDoubleClick={(e) => {
                  // 빈 공간 더블 클릭 시 새로운 일정 생성
                  if (e.target !== e.currentTarget && (e.target as HTMLElement).closest('[data-event-item]')) {
                    return;
                  }
                  onDateClick(dateStr, e.currentTarget as HTMLElement);
                }}
              >
                <div className={styles.eventsList}>
                  {dayEvents.map(event => (
                    <EventItem
                      key={event.id}
                      event={event}
                      onEventDoubleClick={onEventDoubleClick}
                      onDeleteEvent={onDeleteEvent}
                    />
                  ))}
                </div>
              </div>

              {/* 루틴 영역 */}
              {showRoutines && (
                <div className={styles.dayRoutine}>
                  {visibleRoutines.map(routine => {
                    const completed = isRoutineCompleted(routine.id, dateStr);
                    return (
                      <div key={routine.id} className={styles.dayRoutineItem}>
                        <RoutineIcon
                          routine={routine}
                          completed={completed}
                          enabled={true}
                          onClick={() => onToggleRoutine(routine.id, dateStr)}
                        />
                      </div>
                    );
                  })}
                  {shouldShowDiaryRoutine && (
                    <div
                      className={`${styles.dayRoutineItem} ${styles.dayRoutineDiary} ${diaryCompletions[dateStr] ? styles.dayRoutineDiaryCompleted : styles.dayRoutineDiaryHidden
                        }`}
                    >
                      <RoutineIcon
                        routine={DIARY_ROUTINE}
                        completed={Boolean(diaryCompletions[dateStr])}
                        enabled={true}
                        onClick={() => onOpenDiary(dateStr)}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 투두 리스트 */}
      {showTodos && (() => {
        const { label, isMultiMonth } = getWeekLabelInfo();
        return (
          <TodoList
            todos={todos}
            onAdd={(text) => onAddTodo(todoWeekStart, text)}
            onToggle={onToggleTodo}
            onUpdate={onUpdateTodo}
            onDelete={onDeleteTodo}
            weekLabel={label}
            isMultiMonthWeek={isMultiMonth}
          />
        );
      })()}
    </div>
  );
});