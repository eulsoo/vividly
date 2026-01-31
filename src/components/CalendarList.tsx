import { memo } from 'react';
import { WeekCard } from './WeekCard';
import { useData } from '../contexts/DataContext';
import { Event, Todo, Routine, RoutineCompletion, WeekOrder } from '../types';
import styles from '../App.module.css';

interface CalendarListProps {
  weeksData: any[];
  eventsByWeek: Record<string, Event[]>;
  todosByWeek: Record<string, Todo[]>;
  routines: Routine[];
  routineCompletions: RoutineCompletion[];
  dayDefinitions: Record<string, string>;
  weekOrder: WeekOrder;
  diaryCompletionMap: Record<string, boolean>;
  showRoutines: boolean;
  showTodos: boolean;
  onDateClick: (date: string, anchorEl?: HTMLElement) => void;
  onEventDoubleClick: (event: Event, anchorEl?: HTMLElement) => void;
  onDeleteEvent: (eventId: string) => void; // Added Prop
  onOpenDiary: (date: string) => void;
  topSentinelRef: React.RefObject<HTMLDivElement>;
  bottomSentinelRef: React.RefObject<HTMLDivElement>;
}

const EMPTY_LIST: any[] = [];

export const CalendarList = memo(({
  weeksData,
  eventsByWeek,
  todosByWeek,
  routines,
  routineCompletions,
  dayDefinitions,
  weekOrder,
  diaryCompletionMap,
  showRoutines,
  showTodos,
  onDateClick,
  onEventDoubleClick,
  onDeleteEvent, // Received from MainLayout
  onOpenDiary,
  topSentinelRef,
  bottomSentinelRef
}: CalendarListProps) => {
  const {
    // deleteEvent, // Don't use local deleteEvent
    toggleRoutine,
    addTodo,
    toggleTodo,
    updateTodo,
    deleteTodo,
    saveDayDefinition,
    deleteDayDefinition,
  } = useData();

  return (
    <div className={styles.appWeeksList}>
      <div ref={topSentinelRef} className={styles.appSentinel} />
      {weeksData.map(({ weekStart, weekStartStr, todoWeekStartStr, weekStatus }) => (
        <div key={weekStartStr} id={weekStatus === 'current' ? 'current-week' : undefined}>
          <WeekCard
            weekStart={weekStart}
            todoWeekStart={todoWeekStartStr}
            events={eventsByWeek[weekStartStr] || EMPTY_LIST}
            routines={routines}
            routineCompletions={routineCompletions}
            todos={todosByWeek[todoWeekStartStr] || EMPTY_LIST}
            dayDefinitions={dayDefinitions}

            weekOrder={weekOrder}
            onDateClick={onDateClick}
            onEventDoubleClick={onEventDoubleClick}

            onDeleteEvent={onDeleteEvent} // Pass the wrapper
            onToggleRoutine={toggleRoutine}
            onAddTodo={addTodo}
            onToggleTodo={toggleTodo}
            onUpdateTodo={updateTodo}
            onDeleteTodo={deleteTodo}
            onSaveDayDefinition={saveDayDefinition}
            onDeleteDayDefinition={deleteDayDefinition}

            onOpenDiary={onOpenDiary}
            diaryCompletions={diaryCompletionMap}
            weekStatus={weekStatus}
            showRoutines={showRoutines}
            showTodos={showTodos}
          />
        </div>
      ))}
      <div ref={bottomSentinelRef} className={styles.appSentinel} />
    </div>
  );
});
